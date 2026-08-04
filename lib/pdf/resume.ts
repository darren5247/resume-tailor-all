import PDFDocument from "pdfkit";
import type { ResumeDoc } from "../llm/schemas";
import type { TemplateId } from "../settings-schema";
import {
  bandContactColor,
  bandEdgeColor,
  formatContactLines,
  hex,
  isCobaltRail,
  pageMarginsInches,
  railColor,
  templateStyle,
  timelineGutterPt,
  usesClearHierarchy,
  usesCompactRhythm,
  usesStackedRolePlace,
  type TemplateStyle,
} from "../docx/templates";

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const BULLET = "•"; // U+2022 — present in Helvetica; avoid ● (U+25CF)

/**
 * ATS-safe Letter PDF that follows the active template colours / layout cues.
 * Tuned for density: long experience lists should land closer to 1–2 pages.
 */
export async function renderResumePdf(resume: ResumeDoc, templateId: TemplateId): Promise<Buffer> {
  const style = templateStyle(templateId);
  const band =
    style.layout === "band" || (style.layout === "timeline" && style.nameColor.toUpperCase() === "FFFFFF");
  const margins = pageMarginsInches(style);
  const left = margins.x * 72;
  const right = left;
  const marginTop = margins.top * 72;
  const marginBottom = margins.bottom * 72;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      // Keep a real top margin on all pages so continued bullets aren't flush to the edge.
      // Band headers paint into the top margin on page 1 only.
      margins: { top: marginTop, bottom: marginBottom, left, right },
      info: {
        Title: `${resume.name} — ${resume.headline}`.trim(),
        Author: resume.name || "Resume Tailor",
        Creator: "Resume Tailor",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      if (band) doc.y = 0;
      writeHeader(doc, resume, style, band, left);
      writeBody(doc, resume, style);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function writeHeader(
  doc: PDFKit.PDFDocument,
  resume: ResumeDoc,
  style: TemplateStyle,
  band: boolean,
  contentLeft: number,
): void {
  const accent = hex(style.accent);
  const surface = hex(style.surface);
  const nameColor = hex(style.nameColor);
  const muted = hex(style.mutedColor);
  const cobalt = isCobaltRail(style);
  const compact = usesCompactRhythm(style);
  const edge = bandEdgeColor(style);
  const align = style.centerHeader ? ("center" as const) : ("left" as const);
  const width = PAGE_WIDTH - contentLeft - doc.page.margins.right;
  const bodyPt = pdfBodySize(style);

  // Measure header block first so the band height matches real content.
  const nameFont = resolveFont(style.headingFont, true);
  const bodyFont = resolveFont(style.bodyFont, false);
  const nameH = heightOf(doc, resume.name.toUpperCase(), nameFont, style.nameSizePt, width);
  const contact = formatContactLines(resume.contactLine).join("\n");
  const contactPt = Math.max(bodyPt - (cobalt ? 0.25 : 0.5), 8);
  const contactH = contact
    ? heightOf(doc, contact, bodyFont, contactPt, width) + (compact ? 2 : 4)
    : 0;
  const padTop = compact ? (cobalt ? 14 : 12) : 18;
  const padBottom = compact ? (cobalt ? 11 : 9) : 14;
  const bandHeight = padTop + nameH + contactH + padBottom;

  if (band) {
    doc.save();
    doc.rect(0, 0, PAGE_WIDTH, bandHeight).fill(surface);
    if (edge) {
      doc.rect(0, bandHeight - 2, PAGE_WIDTH, 2).fill(hex(edge));
    }
    // Cobalt: thin left accent stripe so the masthead feels anchored, not flat.
    if (cobalt) {
      doc.rect(0, 0, 3.5, bandHeight).fill(hex(railColor(style)));
    }
    doc.restore();
    doc.y = padTop;
    doc.x = contentLeft;
  } else {
    doc.y = doc.page.margins.top;
  }

  doc
    .font(nameFont)
    .fontSize(style.nameSizePt)
    .fillColor(nameColor)
    .text(resume.name.toUpperCase(), contentLeft, doc.y, {
      align,
      width,
      lineGap: 0,
      characterSpacing: compact ? (cobalt ? 0.75 : 0.9) : 0,
    });

  if (contact) {
    doc.moveDown(compact ? 0.14 : 0.15);
    doc
      .font(bodyFont)
      .fontSize(contactPt)
      .fillColor(band ? hex(bandContactColor(style)) : muted)
      .text(contact, { align, width, lineGap: compact ? 1.2 : 1 });
  }

  if (!band && style.headerRule) {
    const y = doc.y + 5;
    strokeRule(doc, contentLeft, y, width, accent, 1);
    doc.y = y + 8;
  } else if (band) {
    doc.y = bandHeight + (compact ? (cobalt ? 8 : 6) : 10);
  } else {
    doc.moveDown(0.4);
  }
}

function writeBody(doc: PDFKit.PDFDocument, resume: ResumeDoc, style: TemplateStyle): void {
  const accent = hex(style.accent);
  const body = hex(style.bodyColor);
  const muted = hex(style.mutedColor);
  const surface = hex(style.surface);
  const slateBar = style.id === "executive-slate";
  const compact = usesCompactRhythm(style);
  const cobalt = isCobaltRail(style);
  const hierarchy = usesClearHierarchy(style);
  const stacked = usesStackedRolePlace(style);
  const timeline = style.layout === "timeline";
  const cards = style.layout === "cards";
  const left = doc.page.margins.left;
  const contentWidth = PAGE_WIDTH - left - doc.page.margins.right;
  const bodyPt = pdfBodySize(style);
  const bodyFont = resolveFont(style.bodyFont, false);
  const bodyBold = resolveFont(style.bodyFont, true);
  const bodyItalic = resolveFont(style.bodyFont, false, true);
  const headingFont = resolveFont(style.headingFont, true);
  const gutter = timelineGutterPt(style);
  const railX = left + (gutter > 0 ? gutter * 0.35 : -10);
  const rail = hex(railColor(style));
  // Stack reference (~13pt leading on 10pt): keep paragraph lineGap modest.
  const summaryGap = compact ? (cobalt ? 1.35 : 1.15) : stacked ? 2.8 : hierarchy ? 2.2 : 1.4;
  const bulletGap = compact ? (cobalt ? 0.35 : 0.2) : stacked ? 2.6 : 0.7;
  const roleGap = compact ? (cobalt ? 2.4 : 1.6) : stacked ? 10 : 3.5;

  const section = (title: string) => {
    ensureSpace(doc, compact ? 28 : stacked ? 40 : 36);
    doc.y += slateBar ? 8 : compact ? (cobalt ? 3.5 : 2.5) : stacked ? 12 : 6;
    const titleY = doc.y;
    const barHeight = style.headingSizePt + (slateBar ? 10 : 6);

    if (slateBar) {
      doc.save();
      doc.rect(left - 3, titleY - 3, contentWidth + 6, barHeight).fill(surface);
      doc.rect(left - 3, titleY - 3, 2.5, barHeight).fill(accent);
      doc.restore();
      doc.y = titleY;
    }

    doc
      .font(headingFont)
      .fontSize(style.headingSizePt)
      .fillColor(accent)
      .text(title.toUpperCase(), left + (slateBar ? 6 : 0), titleY + (slateBar ? 2 : 0), {
        width: contentWidth - (slateBar ? 6 : 0),
        // Keep compact close to default — large PDFKit characterSpacing inserts
        // spaces into extracted text and can hurt ATS keyword matching.
        characterSpacing: slateBar ? 1.1 : compact ? (cobalt ? 0.85 : 0.7) : 0.6,
        lineGap: 0,
        align: "left",
      });

    if (style.headingRule && !slateBar) {
      const y = doc.y + (compact ? 1.5 : 2);
      const ruleWidth = style.headingRuleFullWidth ? contentWidth : contentWidth * 0.42;
      strokeRule(doc, left, y, ruleWidth, accent, compact ? (cobalt ? 1.5 : 1.25) : 1.15);
      doc.y = y + (compact ? (cobalt ? 4 : 3.2) : stacked ? 8 : 5);
    } else if (slateBar) {
      doc.y = titleY - 3 + barHeight + 6;
    } else {
      doc.y += 3;
    }
  };

  if (resume.summary) {
    section("Professional Summary");
    doc
      .font(bodyFont)
      .fontSize(bodyPt)
      .fillColor(body)
      .text(resume.summary, left, doc.y, {
        width: contentWidth,
        lineGap: summaryGap,
        align: "left",
      });
  }

  const skills = resume.skills.filter((group) => group.items.length > 0);
  if (skills.length > 0) {
    section("Technical Skills");
    for (const group of skills) {
      ensureSpace(doc, 18);
      const label = group.label ? `${group.label}: ` : "";
      doc
        .font(bodyBold)
        .fontSize(bodyPt)
        .fillColor(body)
        .text(label, left, doc.y, {
          continued: Boolean(group.items.length),
          width: contentWidth,
          lineGap: compact ? 0.6 : 1,
          align: "left",
        });
      doc
        .font(bodyFont)
        .fillColor(body)
        .text(group.items.join(", "), { width: contentWidth, lineGap: compact ? 0.6 : 1, align: "left" });
      doc.y += compact ? (cobalt ? 1.1 : 0.4) : 1;
    }
  }

  const roles = resume.experience.filter((entry) => entry.company || entry.role);
  if (roles.length > 0) {
    section("Work Experience");

    let railCursorY: number | null = null;

    for (const [index, role] of roles.entries()) {
      const leftInset = gutter;
      const roleWidth = contentWidth - leftInset;
      const companyX = left + leftInset;
      const isLast = index === roles.length - 1;

      ensureSpace(doc, 54);
      // After a page break, restart the rail — don't draw across the page edge.
      if (railCursorY !== null && doc.y + 20 < railCursorY) {
        railCursorY = null;
      }

      const roleTop = doc.y;

      if (timeline) {
        const dotY = roleTop + 4.5;
        doc.save();
        if (railCursorY !== null && dotY > railCursorY + 2) {
          doc
            .moveTo(railX, railCursorY)
            .lineTo(railX, dotY)
            .lineWidth(cobalt ? 1.35 : 1.5)
            .strokeColor(rail)
            .stroke();
        }
        if (cobalt) {
          // Ring marker — cleaner against a continuous rail than a solid blob.
          doc.circle(railX, dotY, 3.1).fill("#FFFFFF");
          doc.circle(railX, dotY, 2.35).fill(rail);
        } else {
          doc.circle(railX, dotY, 2.6).fill(rail);
        }
        doc.restore();
        railCursorY = dotY;
      }

      // Stack place: Company | Location, then Role | Period (Juan.pdf).
      // Default hierarchy: Company | Period, then Role · Location.
      const company = role.company || role.role;
      const companyColor = timeline || hierarchy ? accent : body;
      // Clearly larger than role/body so company leads each entry.
      const companySize = bodyPt + (compact ? 1.75 : stacked || hierarchy ? 2.25 : 2);
      const leftWidth = roleWidth * 0.64;
      const rightWidth = roleWidth * 0.36;
      const rightText = stacked ? role.location : role.period;
      const companyH = heightOf(doc, company, bodyBold, companySize, leftWidth);
      const rightH = rightText
        ? heightOf(doc, rightText, bodyFont, bodyPt - 0.4, rightWidth)
        : 0;
      const rowH = Math.max(companyH, rightH);

      doc
        .font(bodyBold)
        .fontSize(companySize)
        .fillColor(companyColor)
        .text(company, companyX, roleTop, { width: leftWidth, lineGap: 0, align: "left" });
      if (rightText) {
        doc
          .font(bodyFont)
          .fontSize(bodyPt - 0.4)
          .fillColor(muted)
          .text(rightText, companyX + leftWidth, roleTop, {
            width: rightWidth,
            align: "right",
            lineGap: 0,
          });
      }
      doc.y = roleTop + rowH + (compact ? 1 : stacked ? 3 : hierarchy ? 2 : 1);

      if (stacked) {
        const roleTitle = role.role && role.company ? role.role : role.role || "";
        if (roleTitle || role.period) {
          const metaTop = doc.y;
          if (roleTitle) {
            doc
              .font(bodyFont)
              .fontSize(bodyPt)
              .fillColor(body)
              .text(roleTitle, companyX, metaTop, {
                width: leftWidth,
                lineGap: 0,
                align: "left",
              });
          }
          if (role.period) {
            doc
              .font(bodyFont)
              .fontSize(bodyPt - 0.4)
              .fillColor(muted)
              .text(role.period, companyX + leftWidth, metaTop, {
                width: rightWidth,
                align: "right",
                lineGap: 0,
              });
          }
          const titleH = roleTitle ? heightOf(doc, roleTitle, bodyFont, bodyPt, leftWidth) : 0;
          const periodH = role.period
            ? heightOf(doc, role.period, bodyFont, bodyPt - 0.4, rightWidth)
            : 0;
          doc.y = metaTop + Math.max(titleH, periodH) + (compact ? 1.2 : 3);
        }
      } else if (hierarchy) {
        const roleTitle = role.role && role.company ? role.role : "";
        if (roleTitle) {
          doc
            .font(bodyFont)
            .fontSize(bodyPt)
            .fillColor(body)
            .text(roleTitle, companyX, doc.y, {
              continued: Boolean(role.location),
              width: roleWidth,
              lineGap: 0,
              align: "left",
            });
          if (role.location) {
            doc
              .font(bodyItalic)
              .fontSize(bodyPt - 0.4)
              .fillColor(muted)
              .text(` · ${role.location}`, { width: roleWidth, lineGap: 0, align: "left" });
          }
          doc.y += compact ? 1.2 : 2;
        } else if (role.location) {
          doc
            .font(bodyItalic)
            .fontSize(bodyPt - 0.4)
            .fillColor(muted)
            .text(role.location, companyX, doc.y, { width: roleWidth, lineGap: 0, align: "left" });
          doc.y += compact ? 1.2 : 2;
        }
      } else {
        const meta = [role.role && role.company ? role.role : "", role.location].filter(Boolean).join(" · ");
        if (meta) {
          doc
            .font(bodyItalic)
            .fontSize(bodyPt - 0.2)
            .fillColor(muted)
            .text(meta, companyX, doc.y, { width: roleWidth, lineGap: 0, align: "left" });
          doc.y += 2;
        }
      }

      if (role.overview) {
        ensureSpace(doc, 28);
        if (timeline && railCursorY !== null && doc.y + 20 < railCursorY) {
          railCursorY = null;
        }
        doc
          .font(bodyItalic)
          .fontSize(compact ? bodyPt - 0.15 : bodyPt)
          .fillColor(muted)
          .text(role.overview, companyX, doc.y, {
            width: roleWidth,
            lineGap: compact ? 0.55 : 1.2,
            align: "left",
          });
        doc.y += compact ? 0.8 : 2;
      }

      const bulletIndent = 11;
      for (const bullet of role.bullets) {
        ensureSpace(doc, compact ? 16 : 22);
        if (timeline && railCursorY !== null && doc.y + 16 < railCursorY) {
          railCursorY = null;
        }
        const y = doc.y;
        doc.font(bodyFont).fontSize(bodyPt).fillColor(body);
        doc.text(BULLET, companyX, y, { width: bulletIndent, lineGap: 0, continued: false });
        doc.text(bullet, companyX + bulletIndent, y, {
          width: roleWidth - bulletIndent,
          lineGap: bulletGap,
          align: "left",
        });
        doc.y += compact ? 0.25 : 0.6;
      }

      if (role.technologies.length > 0) {
        ensureSpace(doc, 18);
        if (timeline && railCursorY !== null && doc.y + 16 < railCursorY) {
          railCursorY = null;
        }
        const techSize = Math.max(bodyPt - (cobalt ? 0.65 : 0.4), 7.75);
        doc
          .font(bodyBold)
          .fontSize(techSize)
          .fillColor(cobalt ? muted : body)
          .text(cobalt ? "Stack: " : "Technologies used: ", companyX, doc.y, {
            continued: true,
            width: roleWidth,
            lineGap: compact ? 0.6 : 1,
            align: "left",
          });
        doc
          .font(bodyItalic)
          .fillColor(muted)
          .text(role.technologies.join(", "), { width: roleWidth, lineGap: compact ? 0.6 : 1, align: "left" });
        doc.y += compact ? 0.4 : 1;
      }

      if (cards) {
        doc.save();
        doc
          .moveTo(companyX - 4, roleTop)
          .lineTo(companyX - 4, doc.y)
          .lineWidth(1.6)
          .strokeColor(accent)
          .stroke();
        doc.restore();
      }

      // Extend rail through the role body so chronology reads continuously.
      if (timeline && railCursorY !== null && doc.y > railCursorY + 6) {
        const railEnd = Math.min(doc.y - (isLast ? 2 : 0), PAGE_HEIGHT - doc.page.margins.bottom);
        if (railEnd > railCursorY + 4) {
          doc.save();
          doc
            .moveTo(railX, railCursorY)
            .lineTo(railX, railEnd)
            .lineWidth(cobalt ? 1.35 : 1.5)
            .strokeColor(rail)
            .stroke();
          doc.restore();
          railCursorY = railEnd;
        }
      }

      if (!isLast) doc.y += roleGap;
    }
  }

  const projects = resume.projects.filter((project) => project.name);
  if (projects.length > 0) {
    section("Projects");
    for (const project of projects) {
      ensureSpace(doc, 28);
      doc.font(bodyBold).fontSize(bodyPt).fillColor(body).text(project.name, left, doc.y, {
        continued: project.tech.length > 0,
        width: contentWidth,
        lineGap: 0,
        align: "left",
      });
      if (project.tech.length > 0) {
        doc.font(bodyFont).fillColor(muted).text(` — ${project.tech.join(", ")}`, {
          width: contentWidth,
          align: "left",
        });
      }
      if (project.description) {
        doc.font(bodyFont).fillColor(body).text(project.description, {
          width: contentWidth,
          lineGap: 1,
          align: "left",
        });
      }
      doc.y += 2;
    }
  }

  const education = resume.education.filter((entry) => entry.degree || entry.school);
  if (education.length > 0) {
    section("Education");
    for (const entry of education) {
      ensureSpace(doc, compact ? 22 : 28);
      const title = entry.school || entry.degree;
      const titleWidth = contentWidth * 0.68;
      const periodWidth = contentWidth * 0.32;
      const top = doc.y;
      doc.font(bodyBold).fontSize(bodyPt).fillColor(hierarchy ? accent : body);
      const titleH = heightOf(doc, title, bodyBold, bodyPt, titleWidth);
      doc.text(title, left, top, { width: titleWidth, lineGap: 0, align: "left" });
      if (entry.period) {
        doc
          .font(bodyFont)
          .fontSize(bodyPt - 0.4)
          .fillColor(muted)
          .text(entry.period, left + titleWidth, top, { width: periodWidth, align: "right", lineGap: 0 });
      }
      doc.y = top + titleH + (compact ? 0.5 : 1);
      const detail = [entry.degree && entry.school ? entry.degree : "", entry.location, entry.gpa ? `GPA ${entry.gpa}` : ""]
        .filter(Boolean)
        .join(" · ");
      if (detail) {
        doc.font(bodyFont).fillColor(muted).fontSize(bodyPt - 0.2).text(detail, left, doc.y, {
          width: contentWidth,
          lineGap: 0,
          align: "left",
        });
      }
      doc.y += compact ? 1.5 : 3;
    }
  }

  if (resume.languages.length > 0) {
    section("Languages");
    doc
      .font(bodyFont)
      .fontSize(bodyPt)
      .fillColor(body)
      .text(
        resume.languages.map((entry) => [entry.name, entry.level].filter(Boolean).join(" — ")).join(" · "),
        left,
        doc.y,
        { width: contentWidth, lineGap: 1, align: "left" },
      );
  }

  if (resume.certifications.length > 0) {
    section("Certifications");
    for (const entry of resume.certifications) {
      ensureSpace(doc, compact ? 13 : 18);
      const y = doc.y;
      const href = entry.url?.trim();
      doc.font(bodyFont).fontSize(bodyPt).fillColor(body);
      doc.text(BULLET, left, y, { width: 11, lineGap: 0 });
      doc
        .fillColor(href ? accent : body)
        .text(entry.name, left + 11, y, {
          width: contentWidth - 11,
          lineGap: compact ? 0.4 : 1,
          link: href || undefined,
          underline: Boolean(href),
          align: "left",
        });
      doc.y += compact ? 0.2 : 1;
    }
  }
}

/** Slightly denser than DOCX so long bullet lists stay readable on fewer pages. */
function pdfBodySize(style: TemplateStyle): number {
  // Stack reference keeps full 10pt body — don't compress Midnight Navy.
  if (usesStackedRolePlace(style)) return style.bodySizePt;
  if (usesCompactRhythm(style)) return Math.max(8.4, style.bodySizePt - 0.65);
  return Math.max(8.75, style.bodySizePt - 1);
}

function heightOf(
  doc: PDFKit.PDFDocument,
  text: string,
  font: string,
  size: number,
  width: number,
): number {
  doc.font(font).fontSize(size);
  return doc.heightOfString(text, { width, lineGap: 0 });
}

function strokeRule(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  color: string,
  weight: number,
): void {
  doc.save();
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(weight).strokeColor(color).stroke();
  doc.restore();
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const top = doc.page.margins.top;
  if (doc.y + needed > PAGE_HEIGHT - doc.page.margins.bottom) {
    doc.addPage();
    // Defensive: keep continued content below the top edge even if margins were overridden.
    if (doc.y < top) doc.y = top;
  }
}

/** Map Word template fonts onto PDFKit's built-in faces. */
function resolveFont(font: string, bold: boolean, italic = false): string {
  const lower = font.toLowerCase();
  if (lower.includes("times") || lower.includes("georgia") || lower.includes("garamond") || lower.includes("serif")) {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  if (lower.includes("courier")) {
    if (bold && italic) return "Courier-BoldOblique";
    if (bold) return "Courier-Bold";
    if (italic) return "Courier-Oblique";
    return "Courier";
  }
  if (bold && italic) return "Helvetica-BoldOblique";
  if (bold) return "Helvetica-Bold";
  if (italic) return "Helvetica-Oblique";
  return "Helvetica";
}
