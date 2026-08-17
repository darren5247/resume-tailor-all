"use client";

import { useEffect, useRef, useState } from "react";
import {
  PROFILE_COUNTRIES,
  PROFILE_COUNTRY_LABELS,
  WORKING_METHODS,
  targetRolesForCountry,
  type Profile,
  type ProfileCountry,
  type TargetRole,
  type WorkingMethod,
} from "@/lib/profile/schema";

type ListKey = "experience" | "education" | "certifications" | "projects";

export function ProfileForm({
  initial,
  profileLabel,
  profileId,
}: {
  initial: Profile;
  profileLabel: string;
  profileId: string;
}) {
  const [profile, setProfile] = useState<Profile>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "import" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // Switching profiles in the header refreshes this page with new props.
  useEffect(() => {
    setProfile(initial);
    setStatus(null);
    setError(null);
  }, [profileId, initial]);

  const save = async () => {
    setBusy("save");
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileRef.current),
      });
      const data = (await response.json()) as Profile & { error?: string };
      if (!response.ok) setError(data.error ?? "Could not save.");
      else {
        setProfile(data);
        setStatus(`Saved “${profileLabel}”.`);
        window.dispatchEvent(new Event("resume-tailor:profile-saved"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onHeaderSave = () => {
      void save();
    };
    window.addEventListener("resume-tailor:save-profile", onHeaderSave);
    return () => window.removeEventListener("resume-tailor:save-profile", onHeaderSave);
    // save uses profileRef so it always sees the latest form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLabel]);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((current) => ({ ...current, [key]: value }));

  const setBaseResume = (role: TargetRole, patch: Partial<Profile["baseResumes"][TargetRole]>) =>
    setProfile((current) => ({
      ...current,
      baseResumes: {
        ...current.baseResumes,
        [role]: { ...current.baseResumes[role], ...patch },
      },
    }));

  const updateItem = <K extends ListKey>(key: K, index: number, patch: Partial<Profile[K][number]>) =>
    setProfile((current) => ({
      ...current,
      [key]: current[key].map((item, position) => (position === index ? { ...item, ...patch } : item)),
    }));

  const addItem = <K extends ListKey>(key: K, blank: Omit<Profile[K][number], "id">) =>
    setProfile((current) => ({
      ...current,
      [key]: [...current[key], { ...blank, id: crypto.randomUUID() }],
    }));

  const removeItem = (key: ListKey, index: number) =>
    setProfile((current) => ({ ...current, [key]: current[key].filter((_, position) => position !== index) }));

  const importFile = async (file: File) => {
    setBusy("import");
    setError(null);
    setStatus(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/profile/import", { method: "POST", body });
      const data = (await response.json()) as Profile & { error?: string };
      if (!response.ok) setError(data.error ?? "Could not read that file.");
      else {
        // Keep the profile's market so Base resume role tracks stay correct.
        setProfile({ ...data, country: profileRef.current.country });
        setStatus("Imported. Review the fields below, then save.");
      }
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="panel p-5">
        <h2 className="text-base text-fg">Editing: {profileLabel}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Switch profiles from the header dropdown. Generate always uses the selected profile.
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="text-base text-fg">Start from your master resume</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Upload a PDF, DOCX, TXT or MD file. It is parsed into the fields below, which stay editable. Nothing is
          saved until you press Save profile.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <button className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {busy === "import" ? "Reading resume..." : "Choose file..."}
          </button>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-base text-fg">Personal</h2>
        <p className="mt-0.5 text-xs text-fg-muted">Appears in the resume header, exactly as typed.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input className="field" value={profile.fullName} onChange={(e) => set("fullName", e.target.value)} />
          </Field>
          <Field
            label="Country"
            hint={
              profile.country === "Colombia"
                ? "Colombia generation follows only the Resume prompt (plus Experience + job as data)."
                : "US profiles use per-role base resume tracks."
            }
          >
            <select
              className="field"
              value={profile.country}
              onChange={(e) => set("country", e.target.value as ProfileCountry)}
            >
              {PROFILE_COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {PROFILE_COUNTRY_LABELS[country]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email">
            <input className="field" value={profile.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="field" value={profile.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Location">
            <input className="field" value={profile.location} onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="LinkedIn">
            <input className="field" value={profile.linkedin} onChange={(e) => set("linkedin", e.target.value)} />
          </Field>
          <Field label="Website or GitHub">
            <input className="field" value={profile.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="Years of experience">
            <input
              type="number"
              min={0}
              className="field"
              value={profile.yearsExperience}
              onChange={(e) => set("yearsExperience", Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Headline" hint="Leave blank to let each job description drive the wording.">
            <input className="field" value={profile.headline} onChange={(e) => set("headline", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-base text-fg">Resume prompt</h2>
        {profile.country === "Colombia" ? (
          <p className="mt-0.5 text-xs text-fg-muted">
            Required. This is the only instruction set used when generating — tone, structure, emphasis, language,
            bullet style, skills layout, and how to use Experience and the job posting. No other house rules or ATS
            defaults are applied. Employers and dates still come from Experience.
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-fg-muted">
            Extra instructions for how AI should tailor this person&apos;s resume — tone, what to emphasize, what to
            avoid. Employers and dates still come only from Experience; Base resume is style/structure. This prompt
            cannot invent employers or dates.
          </p>
        )}
        <div className="mt-4">
          <Field
            label={profile.country === "Colombia" ? "Resume prompt" : "Custom instructions"}
            hint={
              profile.country === "Colombia"
                ? 'Write full generation instructions, e.g. language, bullet counts, what to emphasize, how to mirror the JD.'
                : 'Example: "Emphasize backend and platform work. Prefer concise bullets. Stress AWS and Postgres when the posting asks for them."'
            }
          >
            <textarea
              className={profile.country === "Colombia" ? "field h-56" : "field h-36"}
              placeholder={
                profile.country === "Colombia"
                  ? "Sole generation instructions: language, tone, structure, bullet style, emphasis, how to use the JD…"
                  : "How this resume should be written: tone, structure, bullet style, emphasis, uniqueness…"
              }
              value={profile.resumePrompt}
              onChange={(e) => set("resumePrompt", e.target.value)}
            />
          </Field>
        </div>
      </section>

      {profile.country !== "Colombia" && (
        <section className="panel p-5">
          <h2 className="text-base text-fg">
            Base resume
            <span className="ml-2 text-xs font-normal text-fg-muted">
              ({PROFILE_COUNTRY_LABELS[profile.country]})
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Enable the role tracks you apply for and paste a role-specific style sample for each. When you
            generate, the job is matched to a track for voice/structure; the JD drives tailored content.
          </p>

          <div className="mt-4 rounded-lg border border-line-soft bg-panel-2/40 p-4">
            <div className="flex flex-col gap-5">
              {targetRolesForCountry(profile.country).map((role) => {
                const entry = profile.baseResumes[role];
                return (
                  <div key={role} className="border-b border-line-soft pb-5 last:border-b-0 last:pb-0">
                    <Toggle
                      checked={entry.enabled}
                      onChange={(enabled) => setBaseResume(role, { enabled })}
                      label={role}
                      hint={
                        entry.enabled
                          ? "Paste a style sample (or role-focused bullet voice) for this track."
                          : "Check to include this role when generating."
                      }
                    />
                    {entry.enabled && (
                      <textarea
                        className="field mt-3 h-40"
                        placeholder={`Style sample for ${role} — sentence pattern, bullet voice, skills layout…`}
                        value={entry.content}
                        onChange={(e) => setBaseResume(role, { content: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base text-fg">Experience</h2>
          <span className="text-xs text-fg-muted">Newest first</span>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">
          {profile.country === "Colombia"
            ? "Employers, titles, and dates come from here. How they are written is controlled only by the Resume prompt."
            : "You give employers, titles, and dates. The model writes JD-tailored bullets for each role and cannot invent a company or a date that is not here. Leave title blank only if you want the model to fill the role line."}
        </p>

        <div className="mt-4">
          <Field
            label="Bullets per company"
            hint="Newest role first. Companies beyond the 3rd use the third value."
          >
            <div className="grid grid-cols-3 gap-2 sm:max-w-md">
              {(
                [
                  { index: 0 as const, label: "1st" },
                  { index: 1 as const, label: "2nd" },
                  { index: 2 as const, label: "3rd+" },
                ] as const
              ).map(({ index, label }) => (
                <label key={label} className="block">
                  <span className="mb-1 block text-[11px] text-fg-faint">{label}</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="field"
                    value={profile.bulletsPerCompany[index]}
                    onChange={(e) => {
                      const next = [...profile.bulletsPerCompany] as Profile["bulletsPerCompany"];
                      next[index] = Math.min(20, Math.max(1, Number(e.target.value) || 1));
                      set("bulletsPerCompany", next);
                    }}
                  />
                </label>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {profile.experience.map((entry, index) => (
            <Row key={entry.id} onRemove={() => removeItem("experience", index)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="field"
                  placeholder="Company"
                  value={entry.company}
                  onChange={(e) => updateItem("experience", index, { company: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Role (optional)"
                  value={entry.role}
                  onChange={(e) => updateItem("experience", index, { role: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="01/2020 - Present"
                  value={entry.period}
                  onChange={(e) => updateItem("experience", index, { period: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Location"
                  value={entry.location}
                  onChange={(e) => updateItem("experience", index, { location: e.target.value })}
                />
                <select
                  className="field sm:col-span-2"
                  value={entry.workingMethod}
                  onChange={(e) =>
                    updateItem("experience", index, {
                      workingMethod: e.target.value as WorkingMethod | "",
                    })
                  }
                >
                  <option value="">Working method (optional)</option>
                  {WORKING_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method === "onsite" ? "On-site" : method === "hybrid" ? "Hybrid" : "Remote"}
                    </option>
                  ))}
                </select>
              </div>
            </Row>
          ))}
        </div>

        <AddButton
          label="Add experience"
          onClick={() =>
            addItem("experience", {
              company: "",
              role: "",
              location: "",
              period: "",
              workingMethod: "",
              description: "",
              highlights: [],
            })
          }
        />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-base text-fg">Education</h2>
          <div className="mt-4 flex flex-col gap-3">
            {profile.education.map((entry, index) => (
              <Row key={entry.id} onRemove={() => removeItem("education", index)}>
                <div className="grid gap-3">
                  <input
                    className="field"
                    placeholder="B.S. Computer Science"
                    value={entry.degree}
                    onChange={(e) => updateItem("education", index, { degree: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="University name"
                    value={entry.school}
                    onChange={(e) => updateItem("education", index, { school: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="field"
                      placeholder="09/2013 - 05/2017"
                      value={entry.period}
                      onChange={(e) => updateItem("education", index, { period: e.target.value })}
                    />
                    <input
                      className="field"
                      placeholder="GPA (optional)"
                      value={entry.gpa}
                      onChange={(e) => updateItem("education", index, { gpa: e.target.value })}
                    />
                  </div>
                </div>
              </Row>
            ))}
          </div>
          <AddButton
            label="Add education"
            onClick={() => addItem("education", { degree: "", school: "", location: "", period: "", gpa: "" })}
          />
        </section>

        <section className="panel p-5">
          <h2 className="text-base text-fg">Certifications</h2>
          <p className="mt-0.5 text-xs text-fg-muted">Only certifications listed here can appear on a resume.</p>
          <div className="mt-4 flex flex-col gap-3">
            {profile.certifications.map((entry, index) => (
              <Row key={entry.id} onRemove={() => removeItem("certifications", index)}>
                <div className="grid gap-3">
                  <input
                    className="field"
                    placeholder="AWS Certified Solutions Architect"
                    value={entry.name}
                    onChange={(e) => updateItem("certifications", index, { name: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className="field"
                      placeholder="Issuer"
                      value={entry.issuer}
                      onChange={(e) => updateItem("certifications", index, { issuer: e.target.value })}
                    />
                    <input
                      className="field"
                      placeholder="01/2024"
                      value={entry.date}
                      onChange={(e) => updateItem("certifications", index, { date: e.target.value })}
                    />
                  </div>
                  <input
                    className="field"
                    placeholder="URL (optional)"
                    value={entry.url}
                    onChange={(e) => updateItem("certifications", index, { url: e.target.value })}
                  />
                </div>
              </Row>
            ))}
          </div>
          <AddButton
            label="Add certification"
            onClick={() => addItem("certifications", { name: "", issuer: "", date: "", url: "" })}
          />
        </section>
      </div>

      <section className="panel p-5">
        <h2 className="text-base text-fg">Projects</h2>
        <p className="mt-0.5 text-xs text-fg-muted">Optional. Only the ones relevant to a posting are included.</p>

        <div className="mt-4 flex flex-col gap-3">
          {profile.projects.map((entry, index) => (
            <Row key={entry.id} onRemove={() => removeItem("projects", index)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className="field"
                  placeholder="Project name"
                  value={entry.name}
                  onChange={(e) => updateItem("projects", index, { name: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Link (optional)"
                  value={entry.link}
                  onChange={(e) => updateItem("projects", index, { link: e.target.value })}
                />
              </div>
              <input
                className="field mt-3"
                placeholder="Tech, comma separated"
                value={entry.tech.join(", ")}
                onChange={(e) =>
                  updateItem("projects", index, {
                    tech: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                  })
                }
              />
              <textarea
                className="field mt-2 h-16"
                placeholder="What it does and what you built."
                value={entry.description}
                onChange={(e) => updateItem("projects", index, { description: e.target.value })}
              />
            </Row>
          ))}
        </div>

        <AddButton
          label="Add project"
          onClick={() => addItem("projects", { name: "", description: "", tech: [], link: "" })}
        />
      </section>

      <div className="sticky bottom-4 flex items-center gap-3 rounded-lg border border-line bg-panel/95 p-3 backdrop-blur">
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => void save()}>
          {busy === "save" ? "Saving..." : "Save profile"}
        </button>
        {status && <span className="text-xs text-accent">{status}</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#22c55e]"
      />
      <span>
        <span className="block text-xs text-fg">{label}</span>
        {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
      </span>
    </label>
  );
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="relative rounded-lg border border-line-soft bg-panel-2/40 p-3 pr-10">
      {children}
      <button
        className="absolute right-2 top-2 rounded px-2 py-1 text-xs text-fg-faint hover:bg-danger-deep hover:text-danger"
        onClick={onRemove}
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="mt-3 text-xs text-accent hover:underline" onClick={onClick}>
      + {label}
    </button>
  );
}
