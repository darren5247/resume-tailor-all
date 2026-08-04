import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun, convertInchesToTwip } from "docx";
import type { CoverLetter, JobSpec, ResumeDoc } from "../llm/schemas";
import type { TemplateId } from "../settings-schema";
import { formatContactLines, templateStyle, type TemplateStyle } from "./templates";

export async function renderCoverLetterDocx(
  letter: CoverLetter,
  resume: ResumeDoc,
  job: JobSpec,
  templateId: TemplateId,
): Promise<Buffer> {
  const style = templateStyle(templateId);
  // Band templates use white nameColor for the resume masthead — letterhead needs ink.
  const nameInk = style.nameColor.toUpperCase() === "FFFFFF" ? style.accent : style.nameColor;
  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: resume.name,
          bold: true,
          font: style.headingFont,
          size: pt(style.nameSizePt - 4),
          color: nameInk,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 260 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: style.accent, space: 6 } },
      children: [
        new TextRun({
          text: formatContactLines(resume.contactLine).join("  ·  ") || resume.contactLine.join("  ·  "),
          font: style.bodyFont,
          size: pt(style.bodySizePt - 1),
          color: style.mutedColor,
        }),
      ],
    }),
  ];

  const target = [job.title, job.company].filter(Boolean).join(" — ");
  if (target) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: `Re: ${target}`,
            bold: true,
            font: style.bodyFont,
            size: pt(style.bodySizePt),
            color: style.bodyColor,
          }),
        ],
      }),
    );
  }

  children.push(paragraph(letter.greeting || "Dear Hiring Manager,", style, 160));
  for (const text of letter.paragraphs) children.push(paragraph(text, style, 160));
  children.push(paragraph(letter.closing || "Sincerely,", style, 40));
  children.push(paragraph(resume.name, style, 0));

  const document = new Document({
    creator: resume.name || "Resume Tailor",
    title: `Cover letter — ${target || resume.name}`,
    styles: { default: { document: { run: { font: style.bodyFont, size: pt(style.bodySizePt) } } } },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.8),
              right: convertInchesToTwip(0.8),
            },
          },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(document));
}

function paragraph(text: string, style: TemplateStyle, after: number): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after, line: 288 },
    children: [
      new TextRun({ text, font: style.bodyFont, size: pt(style.bodySizePt), color: style.bodyColor }),
    ],
  });
}

function pt(value: number): number {
  return Math.round(value * 2);
}
