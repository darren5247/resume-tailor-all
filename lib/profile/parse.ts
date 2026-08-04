import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LlmClient } from "../llm/client";
import type { Settings } from "../settings-schema";
import { ProfileSchema, inferCountryFromLocation, type Profile } from "./schema";

/** Same shape as the profile, minus the ids the model has no business inventing. */
const ImportSchema = z.object({
  fullName: z.string().default(""),
  headline: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  linkedin: z.string().default(""),
  website: z.string().default(""),
  github: z.string().default(""),
  yearsExperience: z.number().default(0),
  summary: z.string().default(""),
  experience: z
    .array(
      z.object({
        company: z.string().default(""),
        role: z.string().default(""),
        location: z.string().default(""),
        period: z.string().default(""),
        workingMethod: z.enum(["onsite", "hybrid", "remote", ""]).default(""),
        description: z.string().default(""),
        highlights: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        degree: z.string().default(""),
        school: z.string().default(""),
        location: z.string().default(""),
        period: z.string().default(""),
        gpa: z.string().default(""),
      }),
    )
    .default([]),
  skills: z
    .array(z.object({ label: z.string().default(""), items: z.array(z.string()).default([]) }))
    .default([]),
  languages: z.array(z.object({ name: z.string().default(""), level: z.string().default("") })).default([]),
  certifications: z
    .array(
      z.object({
        name: z.string().default(""),
        issuer: z.string().default(""),
        date: z.string().default(""),
        url: z.string().default(""),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().default(""),
        description: z.string().default(""),
        tech: z.array(z.string()).default([]),
        link: z.string().default(""),
      }),
    )
    .default([]),
});

const SYSTEM = `You convert a resume into structured profile data.

Rules:
- Transcribe, never embellish. Every value must come from the document.
- Keep dates exactly as written, e.g. "01/2020 - Present".
- certifications[].url: credential or verification link when the resume includes one.
- experience[].workingMethod: "onsite", "hybrid", "remote", or "" when the resume does not say.
- experience[].description: a plain summary of the role in your own words, drawn only from what the resume says.
- experience[].highlights: the achievement bullets as written, lightly cleaned of typos.
- Order experience newest first.
- skills: group by theme, e.g. "Languages & Frameworks", "Cloud & DevOps", "Data".
- yearsExperience: total professional years implied by the dates, as a number. Use 0 if unclear.
- Leave a field as an empty string when the resume does not state it. Never guess an email or a phone number.`;

export async function parseResumeFile(
  file: { name: string; buffer: Buffer },
  settings: Settings,
): Promise<Profile> {
  const text = await extractText(file);
  if (text.trim().length < 200) {
    throw new Error("Could not read enough text from that file. If it is a scanned PDF, paste the text instead.");
  }

  const llm = new LlmClient(settings);
  const imported = await llm.json({
    schema: ImportSchema,
    label: "profile",
    temperature: 0.1,
    system: SYSTEM,
    user: `--- RESUME TEXT ---\n${text.slice(0, 40_000)}`,
  });

  return ProfileSchema.parse({
    ...imported,
    country: inferCountryFromLocation(imported.location ?? ""),
    experience: imported.experience.map((entry) => ({ ...entry, id: randomUUID() })),
    education: imported.education.map((entry) => ({ ...entry, id: randomUUID() })),
    skills: imported.skills.map((entry) => ({ ...entry, id: randomUUID() })),
    languages: imported.languages.map((entry) => ({ ...entry, id: randomUUID() })),
    certifications: imported.certifications.map((entry) => ({ ...entry, id: randomUUID() })),
    projects: imported.projects.map((entry) => ({ ...entry, id: randomUUID() })),
  });
}

export async function extractText(file: { name: string; buffer: Buffer }): Promise<string> {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";

  if (extension === "pdf") {
    const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await extractPdfText(document, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }

  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (extension === "txt" || extension === "md") {
    return file.buffer.toString("utf8");
  }

  throw new Error(`Unsupported file type ".${extension}". Upload a PDF, DOCX, TXT or MD file.`);
}
