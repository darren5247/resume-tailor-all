import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  ShadingType,
  TabStopPosition,
  TabStopType,
  TextRun,
  convertInchesToTwip,
} from "docx";
import type { ResumeDoc } from "../llm/schemas";
import type { TemplateId } from "../settings-schema";
import {
  bandContactColor,
  bandEdgeColor,
  bandHeadlineColor,
  formatContactLines,
  isCobaltRail,
  railColor,
  templateStyle,
  usesClearHierarchy,
  usesCompactRhythm,
  type TemplateStyle,
} from "./templates";

/**
 * Single column, no tables, no text boxes, no headers or footers, standard
 * section names. Layout variants (band / rail / cards) are paragraph borders
 * and shading only — ATS parsers still read a linear document.
 */
export async function renderResumeDocx(resume: ResumeDoc, templateId: TemplateId): Promise<Buffer> {
  const style = templateStyle(templateId);
  const children: Paragraph[] = [...header(resume, style)];

  if (resume.summary) {
    children.push(sectionHeading("PROFESSIONAL SUMMARY", style));
    children.push(body(resume.summary, style));
  }

  const skills = resume.skills.filter((group) => group.items.length > 0);
  if (skills.length > 0) {
    children.push(sectionHeading("TECHNICAL SKILLS", style));
    for (const group of skills) {
      children.push(
        new Paragraph({
          spacing: { after: usesCompactRhythm(style) ? 20 : 40, line: style.lineSpacing },
          children: [
            new TextRun({
              text: group.label ? `${group.label}: ` : "",
              bold: true,
              font: style.bodyFont,
              size: pt(style.bodySizePt),
              color: style.bodyColor,
            }),
            new TextRun({
              text: group.items.join(", "),
              font: style.bodyFont,
              size: pt(style.bodySizePt),
              color: style.bodyColor,
            }),
          ],
        }),
      );
    }
  }

  const roles = resume.experience.filter((entry) => entry.company || entry.role);
  if (roles.length > 0) {
    children.push(sectionHeading("WORK EXPERIENCE", style));
    for (const [index, role] of roles.entries()) {
      const isLast = index === roles.length - 1;
      children.push(...roleBlock(role, style, isLast));
    }
  }

  const projects = resume.projects.filter((project) => project.name);
  if (projects.length > 0) {
    children.push(sectionHeading("PROJECTS", style));
    for (const project of projects) {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 20, line: style.lineSpacing },
          children: [
            new TextRun({
              text: project.name,
              bold: true,
              font: style.bodyFont,
              size: pt(style.bodySizePt),
              color: style.bodyColor,
            }),
            project.tech.length > 0
              ? new TextRun({
                  text: ` — ${project.tech.join(", ")}`,
                  font: style.bodyFont,
                  size: pt(style.bodySizePt),
                  color: style.mutedColor,
                })
              : new TextRun(""),
          ],
        }),
      );
      if (project.description) children.push(body(project.description, style));
    }
  }

  const education = resume.education.filter((entry) => entry.degree || entry.school);
  if (education.length > 0) {
    children.push(sectionHeading("EDUCATION", style));
    for (const entry of education) {
      children.push(roleHeading(entry.degree || entry.school, entry.period, style, false));
      const detail = [entry.school && entry.degree ? entry.school : "", entry.location, entry.gpa ? `GPA ${entry.gpa}` : ""]
        .filter(Boolean)
        .join(" · ");
      if (detail) children.push(roleSubheading(detail, "", style, false));
    }
  }

  const certifications = resume.certifications.filter((entry) => entry.name);
  if (certifications.length > 0) {
    children.push(sectionHeading("CERTIFICATIONS", style));
    for (const entry of certifications) {
      children.push(certificationLine(entry.name, entry.url, style));
    }
  }

  const languages = resume.languages.filter((entry) => entry.name);
  if (languages.length > 0) {
    children.push(sectionHeading("LANGUAGES", style));
    children.push(
      body(languages.map((entry) => [entry.name, entry.level].filter(Boolean).join(" — ")).join(" · "), style),
    );
  }

  const compact = usesCompactRhythm(style);
  // Timeline rail is an experience gutter, not a page margin — keep full measure
  // for masthead / summary / skills so long headlines wrap cleanly.
  const leftMargin = convertInchesToTwip(compact ? 0.5 : 0.65);
  const verticalMargin = convertInchesToTwip(compact ? 0.48 : 0.7);
  const bottomMargin = convertInchesToTwip(compact ? 0.45 : 0.65);

  const document = new Document({
    creator: resume.name || "Resume Tailor",
    title: `${resume.name} — ${resume.headline}`,
    description: "Tailored resume",
    styles: { default: { document: { run: { font: style.bodyFont, size: pt(style.bodySizePt) } } } },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: verticalMargin,
              bottom: bottomMargin,
              left: leftMargin,
              right: leftMargin,
            },
          },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(document));
}

function roleBlock(
  role: {
    company: string;
    role: string;
    location: string;
    period: string;
    overview: string;
    bullets: string[];
    technologies: string[];
  },
  style: TemplateStyle,
  isLast: boolean,
): Paragraph[] {
  const card = style.layout === "cards";
  const rail = style.layout === "timeline";
  const decorated = card || rail;
  const hasTech = role.technologies.length > 0;
  const paragraphs: Paragraph[] = [
    roleHeading(role.company, role.period, style, decorated, true),
    roleSubheading(role.role, role.location, style, decorated),
  ];

  if (role.overview) {
    paragraphs.push(roleOverview(role.overview, style, decorated));
  }

  for (const [index, bullet] of role.bullets.entries()) {
    const isLastBullet = index === role.bullets.length - 1;
    const closeCard = card && isLastBullet && !hasTech && !isLast;
    paragraphs.push(bulletLine(bullet, style, decorated, closeCard));
  }

  if (hasTech) {
    paragraphs.push(technologiesLine(role.technologies, style, decorated, card && !isLast));
  }

  if (card && role.bullets.length === 0 && !hasTech) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 120 },
        border: cardBorder(style, "bottom"),
        children: [new TextRun("")],
      }),
    );
  }

  return paragraphs;
}

function header(resume: ResumeDoc, style: TemplateStyle): Paragraph[] {
  const alignment = style.centerHeader ? AlignmentType.CENTER : AlignmentType.LEFT;
  const band = style.layout === "band" || (style.layout === "timeline" && style.nameColor === "FFFFFF");
  const cobalt = isCobaltRail(style);
  const compact = usesCompactRhythm(style);
  const nameColor = band ? style.nameColor : style.nameColor;
  const headlineOnBand = band ? bandHeadlineColor(style) : style.mutedColor;
  const contactOnBand = band ? bandContactColor(style) : style.mutedColor;
  const contactLines = formatContactLines(resume.contactLine);
  const bandEdge = bandEdgeColor(style);

  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment,
      spacing: { after: compact ? 40 : 40 },
      shading: band ? { type: ShadingType.CLEAR, fill: style.surface } : undefined,
      border: cobalt && band
        ? { left: { style: BorderStyle.SINGLE, size: 28, color: railColor(style), space: 10 } }
        : undefined,
      children: [
        new TextRun({
          text: resume.name.toUpperCase(),
          bold: true,
          font: style.headingFont,
          size: pt(style.nameSizePt),
          color: nameColor,
          characterSpacing: compact ? (cobalt ? 32 : 40) : 0,
        }),
      ],
    }),
  ];

  if (resume.headline) {
    paragraphs.push(
      new Paragraph({
        alignment,
        spacing: { after: compact ? 40 : 40 },
        shading: band ? { type: ShadingType.CLEAR, fill: style.surface } : undefined,
        border: cobalt && band
          ? { left: { style: BorderStyle.SINGLE, size: 28, color: railColor(style), space: 10 } }
          : undefined,
        children: [
          new TextRun({
            text: resume.headline,
            font: style.bodyFont,
            size: pt(style.headlineSizePt),
            color: headlineOnBand,
          }),
        ],
      }),
    );
  }

  if (contactLines.length === 0) {
    paragraphs.push(
      new Paragraph({
        alignment,
        spacing: { after: band ? (compact ? 80 : 140) : 60 },
        shading: band ? { type: ShadingType.CLEAR, fill: style.surface } : undefined,
        border: style.headerRule && !band
          ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: style.accent, space: 6 } }
          : bandEdge
            ? {
                bottom: { style: BorderStyle.SINGLE, size: 18, color: bandEdge, space: 1 },
                ...(cobalt
                  ? { left: { style: BorderStyle.SINGLE, size: 28, color: railColor(style), space: 10 } }
                  : {}),
              }
            : undefined,
        children: [new TextRun("")],
      }),
    );
    return paragraphs;
  }

  for (const [index, line] of contactLines.entries()) {
    const isLast = index === contactLines.length - 1;
    paragraphs.push(
      new Paragraph({
        alignment,
        spacing: { after: isLast ? (band ? (compact ? 0 : 140) : 60) : compact ? 8 : 40 },
        shading: band ? { type: ShadingType.CLEAR, fill: style.surface } : undefined,
        border: {
          ...(cobalt && band
            ? { left: { style: BorderStyle.SINGLE, size: 28, color: railColor(style), space: 10 } }
            : {}),
          ...(isLast && style.headerRule && !band
            ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: style.accent, space: 6 } }
            : isLast && bandEdge
              ? { bottom: { style: BorderStyle.SINGLE, size: 18, color: bandEdge, space: 1 } }
              : {}),
        },
        children: [
          new TextRun({
            text: line,
            font: style.bodyFont,
            size: pt(Math.max(style.bodySizePt - (cobalt ? 0.5 : 0.75), 8)),
            color: contactOnBand,
          }),
        ],
      }),
    );
  }

  if (compact && band) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: cobalt ? 80 : 60 },
        children: [new TextRun("")],
      }),
    );
  }

  return paragraphs;
}

function sectionHeading(text: string, style: TemplateStyle): Paragraph {
  const bar = style.id === "executive-slate";
  const compact = usesCompactRhythm(style);
  const cobalt = isCobaltRail(style);
  return new Paragraph({
    spacing: { before: style.sectionSpaceBefore, after: bar ? 100 : compact ? (cobalt ? 60 : 50) : 80 },
    shading: bar ? { type: ShadingType.CLEAR, fill: style.surface } : undefined,
    border: bar
      ? {
          left: { style: BorderStyle.SINGLE, size: 24, color: style.accent, space: 10 },
        }
      : style.headingRule
        ? { bottom: { style: BorderStyle.SINGLE, size: compact ? (cobalt ? 10 : 7) : 6, color: style.accent, space: 3 } }
        : undefined,
    indent: bar ? { left: 80 } : undefined,
    children: [
      new TextRun({
        text,
        bold: true,
        font: style.headingFont,
        size: pt(style.headingSizePt),
        color: style.accent,
        characterSpacing: bar ? 40 : compact ? (cobalt ? 36 : 28) : 12,
      }),
    ],
  });
}

function roleHeading(
  left: string,
  right: string,
  style: TemplateStyle,
  decorated: boolean,
  openCard = false,
): Paragraph {
  const hierarchy = usesClearHierarchy(style);
  const compact = usesCompactRhythm(style);
  const cobalt = isCobaltRail(style);
  const timeline = style.layout === "timeline" && decorated;
  // Cobalt: left border is the rail — skip the ● glyph (double-marks + hurts ATS text).
  // Timeline Rail keeps a compact dot for chronology when there is no masthead band.
  const label = timeline && !cobalt ? `●  ${left}` : left;
  return new Paragraph({
    spacing: {
      before: decorated && openCard ? (compact ? (cobalt ? 120 : 100) : 160) : compact ? 70 : hierarchy ? 140 : 120,
      after: compact ? 4 : hierarchy ? 20 : 0,
      line: style.lineSpacing,
    },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    border: decorated ? experienceBorder(style, openCard ? "top" : "mid") : undefined,
    indent: timeline ? { left: cobalt ? 160 : 120 } : undefined,
    children: [
      new TextRun({
        text: label,
        bold: true,
        font: style.bodyFont,
        size: pt(style.bodySizePt + (compact ? 0.5 : hierarchy ? 0.75 : 0.5)),
        color: timeline || hierarchy ? style.accent : style.bodyColor,
      }),
      ...(right
        ? [
            new TextRun({
              text: `\t${right}`,
              font: style.bodyFont,
              size: pt(style.bodySizePt - (compact ? 0.5 : hierarchy ? 0.75 : 0.5)),
              color: style.mutedColor,
            }),
          ]
        : []),
    ],
  });
}

function roleSubheading(role: string, location: string, style: TemplateStyle, decorated: boolean): Paragraph {
  const hierarchy = usesClearHierarchy(style);
  const compact = usesCompactRhythm(style);
  const children = hierarchy
    ? [
        ...(role
          ? [
              new TextRun({
                text: role,
                font: style.bodyFont,
                size: pt(style.bodySizePt),
                color: style.bodyColor,
              }),
            ]
          : []),
        ...(role && location
          ? [
              new TextRun({
                text: "  ·  ",
                font: style.bodyFont,
                size: pt(style.bodySizePt),
                color: style.mutedColor,
              }),
            ]
          : []),
        ...(location
          ? [
              new TextRun({
                text: location,
                italics: true,
                font: style.bodyFont,
                size: pt(style.bodySizePt - 0.5),
                color: style.mutedColor,
              }),
            ]
          : []),
      ]
    : [
        new TextRun({
          text: [role, location].filter(Boolean).join(" · "),
          italics: true,
          font: style.bodyFont,
          size: pt(style.bodySizePt),
          color: style.mutedColor,
        }),
      ];

  const timeline = style.layout === "timeline" && decorated;
  const cobalt = isCobaltRail(style);
  return new Paragraph({
    spacing: { after: compact ? 16 : 40, line: style.lineSpacing },
    border: decorated ? experienceBorder(style, "mid") : undefined,
    indent: timeline ? { left: cobalt ? 160 : 120 } : undefined,
    children,
  });
}

function roleOverview(text: string, style: TemplateStyle, decorated: boolean): Paragraph {
  const compact = usesCompactRhythm(style);
  const timeline = style.layout === "timeline" && decorated;
  const cobalt = isCobaltRail(style);
  return new Paragraph({
    spacing: { after: compact ? 28 : 60, line: style.lineSpacing },
    border: decorated ? experienceBorder(style, "mid") : undefined,
    indent: timeline ? { left: cobalt ? 160 : 120 } : undefined,
    children: [
      new TextRun({
        text,
        italics: true,
        font: style.bodyFont,
        size: pt(compact ? style.bodySizePt - 0.25 : style.bodySizePt),
        color: style.bodyColor,
      }),
    ],
  });
}

function technologiesLine(
  technologies: string[],
  style: TemplateStyle,
  decorated: boolean,
  closeCard: boolean,
): Paragraph {
  const compact = usesCompactRhythm(style);
  const cobalt = isCobaltRail(style);
  const timeline = style.layout === "timeline" && decorated;
  return new Paragraph({
    spacing: { before: compact ? 4 : 20, after: closeCard ? 120 : compact ? 28 : 60, line: style.lineSpacing },
    border: decorated ? experienceBorder(style, closeCard ? "bottom" : "mid") : undefined,
    indent: timeline ? { left: cobalt ? 160 : 120 } : undefined,
    children: [
      new TextRun({
        text: cobalt ? "Stack: " : "Technologies used: ",
        bold: true,
        italics: true,
        font: style.bodyFont,
        size: pt(style.bodySizePt - (cobalt ? 0.75 : 0.5)),
        color: cobalt ? style.mutedColor : style.bodyColor,
      }),
      new TextRun({
        text: technologies.join(", "),
        italics: true,
        font: style.bodyFont,
        size: pt(style.bodySizePt - (cobalt ? 0.75 : 0.5)),
        color: style.mutedColor,
      }),
    ],
  });
}

function bulletLine(text: string, style: TemplateStyle, decorated: boolean, closeCard = false): Paragraph {
  const compact = usesCompactRhythm(style);
  const timeline = style.layout === "timeline" && decorated;
  const cobalt = isCobaltRail(style);
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: closeCard ? 120 : compact ? 16 : 40, line: style.lineSpacing },
    border: decorated ? experienceBorder(style, closeCard ? "bottom" : "mid") : undefined,
    indent: timeline ? { left: cobalt ? 160 : 120 } : undefined,
    children: [
      new TextRun({ text, font: style.bodyFont, size: pt(style.bodySizePt), color: style.bodyColor }),
    ],
  });
}

function certificationLine(name: string, url: string | undefined, style: TemplateStyle): Paragraph {
  const href = url?.trim();
  const compact = usesCompactRhythm(style);
  const runProps = {
    text: name,
    font: style.bodyFont,
    size: pt(style.bodySizePt),
    color: href ? style.accent : style.bodyColor,
    underline: href ? ({} as const) : undefined,
  };

  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: compact ? 20 : 40, line: style.lineSpacing },
    // Certifications are not on the career rail — keep them flush with other sections.
    children: href
      ? [new ExternalHyperlink({ children: [new TextRun(runProps)], link: href })]
      : [new TextRun(runProps)],
  });
}

function body(text: string, style: TemplateStyle): Paragraph {
  const compact = usesCompactRhythm(style);
  const hierarchy = usesClearHierarchy(style);
  return new Paragraph({
    spacing: { after: compact ? 48 : hierarchy ? 80 : 60, line: style.lineSpacing },
    alignment: AlignmentType.LEFT,
    children: [
      new TextRun({ text, font: style.bodyFont, size: pt(style.bodySizePt), color: style.bodyColor }),
    ],
  });
}

function experienceBorder(style: TemplateStyle, edge: "top" | "mid" | "bottom") {
  if (style.layout === "timeline") {
    const cobalt = isCobaltRail(style);
    return {
      left: {
        style: BorderStyle.SINGLE,
        size: cobalt ? 14 : 12,
        color: railColor(style),
        space: cobalt ? 10 : 8,
      },
    };
  }
  if (style.layout === "cards") {
    const side = { style: BorderStyle.SINGLE, size: 4, color: style.accent, space: 8 };
    return {
      left: side,
      right: side,
      top: edge === "top" || edge === "mid" ? (edge === "top" ? side : undefined) : undefined,
      bottom: edge === "bottom" ? side : undefined,
    };
  }
  return undefined;
}

function cardBorder(style: TemplateStyle, edge: "bottom") {
  return experienceBorder(style, edge);
}

function pt(value: number): number {
  return Math.round(value * 2);
}
