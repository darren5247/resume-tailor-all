"use client";

import type { ResumeDoc } from "@/lib/llm/schemas";
import type { TemplateId } from "@/lib/settings-schema";
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
} from "@/lib/docx/templates";

/** Preview width ÷ Letter width (612pt) — keeps type/margins proportional to the PDF. */
const PAGE_SCALE = 340 / 612;

/**
 * HTML stand-in for the generated PDF. Uses the same layout cues, denser body
 * size, and PDFKit font mapping so the Templates tab matches what downloads.
 */
export function ResumePreview({ resume, templateId }: { resume: ResumeDoc; templateId: TemplateId }) {
  const style = templateStyle(templateId);
  const accent = hex(style.accent);
  const surface = hex(style.surface);
  const body = hex(style.bodyColor);
  const muted = hex(style.mutedColor);
  const nameColor = hex(style.nameColor);
  const band =
    style.layout === "band" || (style.layout === "timeline" && style.nameColor.toUpperCase() === "FFFFFF");
  const timeline = style.layout === "timeline";
  const cards = style.layout === "cards";
  const slateBar = style.id === "executive-slate";
  const cobalt = isCobaltRail(style);
  const compact = usesCompactRhythm(style);
  const hierarchy = usesClearHierarchy(style);
  const stacked = usesStackedRolePlace(style);
  const contactLines = formatContactLines(resume.contactLine);
  const bandEdge = bandEdgeColor(style);
  const rail = hex(railColor(style));
  const bodyPt = previewBodySize(style) * PAGE_SCALE;
  const namePt = style.nameSizePt * PAGE_SCALE;
  const headingPt = style.headingSizePt * PAGE_SCALE;
  const contactPt = Math.max(previewBodySize(style) - (cobalt ? 0.25 : 0.5), 8) * PAGE_SCALE;
  const margins = pageMarginsInches(style);
  const marginX = margins.x * 72 * PAGE_SCALE;
  const marginY = margins.top * 72 * PAGE_SCALE;
  const gutter = timelineGutterPt(style) * PAGE_SCALE;
  const bodyFont = previewFontStack(style.bodyFont);
  const headingFont = previewFontStack(style.headingFont);
  const skills = resume.skills.filter((group) => group.items.length > 0);
  const roles = resume.experience.filter((entry) => entry.company || entry.role);
  const projects = resume.projects.filter((project) => project.name);
  const education = resume.education.filter((entry) => entry.degree || entry.school);

  return (
    <div
      className="resume-preview origin-top rounded-sm bg-white text-black shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
      style={{
        fontFamily: bodyFont,
        color: body,
        fontSize: `${bodyPt}px`,
        lineHeight: compact ? (cobalt ? 1.34 : 1.3) : hierarchy ? 1.42 : 1.35,
        width: "100%",
        maxWidth: "340px",
        minHeight: `${340 * (11 / 8.5)}px`,
      }}
    >
      <div style={{ padding: band ? "0" : `${marginY}px ${marginX}px` }}>
        <div
          style={
            band
              ? {
                  background: surface,
                  color: nameColor,
                  padding: compact
                    ? cobalt
                      ? `${14 * PAGE_SCALE}px ${marginX}px ${11 * PAGE_SCALE}px`
                      : `${12 * PAGE_SCALE}px ${marginX}px ${9 * PAGE_SCALE}px`
                    : `${18 * PAGE_SCALE}px ${marginX}px ${14 * PAGE_SCALE}px`,
                  marginBottom: 0,
                  boxShadow: bandEdge ? `inset 0 -2px 0 ${hex(bandEdge)}` : undefined,
                  borderLeft: cobalt ? `${3.5 * PAGE_SCALE}px solid ${rail}` : undefined,
                  textAlign: style.centerHeader ? "center" : "left",
                }
              : {
                  textAlign: style.centerHeader ? "center" : "left",
                }
          }
        >
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: `${namePt}px`,
              letterSpacing: slateBar
                ? "0.06em"
                : compact
                  ? cobalt
                    ? `${0.75 * PAGE_SCALE}px`
                    : `${0.9 * PAGE_SCALE}px`
                  : 0,
              color: nameColor,
              lineHeight: 1.1,
            }}
          >
            {resume.name.toUpperCase()}
          </div>
          {contactLines.length > 0 && (
            <div
              style={{
                marginTop: compact ? 2 * PAGE_SCALE : 4 * PAGE_SCALE,
                color: band ? hex(bandContactColor(style)) : muted,
                fontSize: `${contactPt}px`,
                lineHeight: 1.35,
                borderBottom: !band && style.headerRule ? `1px solid ${accent}` : undefined,
                paddingBottom: !band && style.headerRule ? 5 * PAGE_SCALE : 0,
                marginBottom: !band && style.headerRule ? 8 * PAGE_SCALE : 0,
              }}
            >
              {contactLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            padding: band
              ? `${(compact ? (cobalt ? 8 : 6) : 10) * PAGE_SCALE}px ${marginX}px ${marginY}px`
              : 0,
            textAlign: "left",
          }}
        >
          {resume.summary && (
            <Section
              title="Professional Summary"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              stacked={stacked}
              surface={surface}
              headingPt={headingPt}
              headingFont={headingFont}
            >
              <p style={{ margin: 0 }}>{resume.summary}</p>
            </Section>
          )}

          {skills.length > 0 && (
            <Section
              title="Technical Skills"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              stacked={stacked}
              surface={surface}
              headingPt={headingPt}
              headingFont={headingFont}
            >
              {skills.map((group) => (
                <div key={group.label} style={{ marginBottom: (compact ? (cobalt ? 1.1 : 0.4) : 1) * PAGE_SCALE }}>
                  <strong>{group.label}: </strong>
                  {group.items.join(", ")}
                </div>
              ))}
            </Section>
          )}

          {roles.length > 0 && (
            <Section
              title="Work Experience"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              stacked={stacked}
              surface={surface}
              headingPt={headingPt}
              headingFont={headingFont}
            >
              <div style={{ position: "relative", paddingLeft: gutter || 0 }}>
                {timeline && (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: gutter * 0.35,
                      top: 4 * PAGE_SCALE,
                      bottom: 2 * PAGE_SCALE,
                      width: cobalt ? 1.35 * PAGE_SCALE : 1.5 * PAGE_SCALE,
                      background: rail,
                      borderRadius: 1,
                      transform: "translateX(-50%)",
                    }}
                  />
                )}
                {roles.map((role, index) => {
                  const companySize = (previewBodySize(style) + (compact ? 1.75 : stacked || hierarchy ? 2.25 : 2)) * PAGE_SCALE;
                  const rightPrimary = stacked ? role.location : role.period;
                  return (
                    <div
                      key={`${role.company}-${role.period}`}
                      style={{
                        position: "relative",
                        marginBottom:
                          index === roles.length - 1
                            ? 0
                            : (compact ? (cobalt ? 2.4 : 1.6) : stacked ? 10 : 3.5) * PAGE_SCALE,
                        paddingLeft: cards ? 8 * PAGE_SCALE : 0,
                        borderLeft: cards ? `${1.6 * PAGE_SCALE}px solid ${accent}` : undefined,
                      }}
                    >
                      {timeline && (
                        <span
                          aria-hidden
                          style={{
                            position: "absolute",
                            left: gutter * 0.35 - gutter,
                            top: 4 * PAGE_SCALE,
                            width: (cobalt ? 4.7 : 5.2) * PAGE_SCALE,
                            height: (cobalt ? 4.7 : 5.2) * PAGE_SCALE,
                            borderRadius: "50%",
                            background: rail,
                            boxShadow: cobalt
                              ? `0 0 0 ${1.5 * PAGE_SCALE}px #fff, 0 0 0 ${2.2 * PAGE_SCALE}px ${rail}55`
                              : `0 0 0 ${1.5 * PAGE_SCALE}px #fff`,
                            transform: "translateX(-50%)",
                          }}
                        />
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <strong
                          style={{
                            color: timeline || hierarchy ? accent : body,
                            fontSize: `${companySize}px`,
                            fontWeight: 700,
                            flex: "1 1 64%",
                          }}
                        >
                          {role.company || role.role}
                        </strong>
                        <span
                          style={{
                            color: muted,
                            whiteSpace: "nowrap",
                            fontSize: `${bodyPt - 0.4 * PAGE_SCALE}px`,
                            flex: "0 0 36%",
                            textAlign: "right",
                          }}
                        >
                          {rightPrimary}
                        </span>
                      </div>
                      {stacked ? (
                        (role.role || role.period) && (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              alignItems: "baseline",
                              marginBottom: role.overview ? 2 * PAGE_SCALE : 3 * PAGE_SCALE,
                              marginTop: PAGE_SCALE,
                            }}
                          >
                            <span style={{ color: body, fontWeight: 400, flex: "1 1 64%" }}>
                              {role.role && role.company ? role.role : role.role}
                            </span>
                            <span
                              style={{
                                color: muted,
                                whiteSpace: "nowrap",
                                fontSize: `${bodyPt - 0.4 * PAGE_SCALE}px`,
                                flex: "0 0 36%",
                                textAlign: "right",
                              }}
                            >
                              {role.period}
                            </span>
                          </div>
                        )
                      ) : (
                        (role.role || role.location) && (
                          <div
                            style={{
                              marginBottom: role.overview
                                ? 2 * PAGE_SCALE
                                : compact
                                  ? 1.2 * PAGE_SCALE
                                  : hierarchy
                                    ? 2 * PAGE_SCALE
                                    : 2 * PAGE_SCALE,
                              marginTop: hierarchy ? PAGE_SCALE : 0,
                            }}
                          >
                            {hierarchy ? (
                              <>
                                {role.role && role.company && <span style={{ color: body }}>{role.role}</span>}
                                {role.role && role.company && role.location && (
                                  <span style={{ color: muted }}> · </span>
                                )}
                                {role.location && (
                                  <span
                                    style={{
                                      color: muted,
                                      fontStyle: "italic",
                                      fontSize: `${bodyPt - 0.4 * PAGE_SCALE}px`,
                                    }}
                                  >
                                    {role.location}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span
                                style={{
                                  color: muted,
                                  fontStyle: "italic",
                                  fontSize: `${bodyPt - 0.2 * PAGE_SCALE}px`,
                                }}
                              >
                                {[role.role && role.company ? role.role : "", role.location]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            )}
                          </div>
                        )
                      )}
                      {role.overview && (
                        <p
                          style={{
                            margin: `0 0 ${(compact ? 0.8 : 2) * PAGE_SCALE}px`,
                            fontStyle: "italic",
                            color: muted,
                            fontSize: compact ? `${bodyPt - 0.15 * PAGE_SCALE}px` : undefined,
                          }}
                        >
                          {role.overview}
                        </p>
                      )}
                      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                        {role.bullets.map((bullet) => (
                          <li
                            key={bullet}
                            style={{
                              display: "flex",
                              gap: 4 * PAGE_SCALE,
                              marginBottom: (compact ? 0.25 : 0.6) * PAGE_SCALE,
                            }}
                          >
                            <span aria-hidden style={{ flex: "0 0 auto", width: 11 * PAGE_SCALE }}>
                              •
                            </span>
                            <span style={{ flex: 1 }}>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                      {role.technologies.length > 0 && (
                        <p
                          style={{
                            margin: `${(compact ? 0.4 : 1) * PAGE_SCALE}px 0 0`,
                            fontStyle: "italic",
                            fontSize: `${Math.max(previewBodySize(style) - (cobalt ? 0.65 : 0.4), 7.75) * PAGE_SCALE}px`,
                          }}
                        >
                          <strong style={{ color: cobalt ? muted : body, fontStyle: "normal" }}>
                            {cobalt ? "Stack: " : "Technologies used: "}
                          </strong>
                          <span style={{ color: muted }}>{role.technologies.join(", ")}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {projects.length > 0 && (
            <Section
              title="Projects"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              stacked={stacked}
              surface={surface}
              headingPt={headingPt}
              headingFont={headingFont}
            >
              {projects.map((project) => (
                <div key={project.name} style={{ marginBottom: 2 * PAGE_SCALE }}>
                  <div>
                    <strong>{project.name}</strong>
                    {project.tech.length > 0 && (
                      <span style={{ color: muted }}> — {project.tech.join(", ")}</span>
                    )}
                  </div>
                  {project.description && <div>{project.description}</div>}
                </div>
              ))}
            </Section>
          )}

          {education.length > 0 && (
            <Section
              title="Education"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              stacked={stacked}
              surface={surface}
              headingPt={headingPt}
              headingFont={headingFont}
            >
              {education.map((entry) => (
                <div key={`${entry.degree}-${entry.school}`} style={{ marginBottom: (compact ? 1.5 : 3) * PAGE_SCALE }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ color: hierarchy ? accent : body, flex: "1 1 68%" }}>
                      {entry.school || entry.degree}
                    </strong>
                    <span style={{ color: muted, fontSize: `${bodyPt - 0.4 * PAGE_SCALE}px`, flex: "0 0 32%", textAlign: "right" }}>
                      {entry.period}
                    </span>
                  </div>
                  <div style={{ color: muted, fontSize: `${bodyPt - 0.2 * PAGE_SCALE}px` }}>
                    {[entry.degree && entry.school ? entry.degree : "", entry.location, entry.gpa ? `GPA ${entry.gpa}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {resume.languages.length > 0 && (
            <Section
              title="Languages"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              stacked={stacked}
              surface={surface}
              headingPt={headingPt}
              headingFont={headingFont}
            >
              <div>
                {resume.languages.map((entry) => [entry.name, entry.level].filter(Boolean).join(" — ")).join(" · ")}
              </div>
            </Section>
          )}

          {resume.certifications.length > 0 && (
            <Section
              title="Certifications"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              stacked={stacked}
              surface={surface}
              headingPt={headingPt}
              headingFont={headingFont}
            >
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                {resume.certifications.map((entry) => (
                  <li
                    key={entry.name}
                    style={{
                      display: "flex",
                      gap: 4 * PAGE_SCALE,
                      marginBottom: (compact ? 0.2 : 1) * PAGE_SCALE,
                    }}
                  >
                    <span aria-hidden style={{ flex: "0 0 auto", width: 11 * PAGE_SCALE }}>
                      •
                    </span>
                    <span style={{ flex: 1 }}>
                      {entry.url?.trim() ? (
                        <a
                          href={entry.url.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: accent, textDecoration: "underline" }}
                        >
                          {entry.name}
                        </a>
                      ) : (
                        entry.name
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  accent,
  rule,
  ruleFullWidth,
  slateBar,
  compact,
  cobalt,
  stacked,
  surface,
  headingPt,
  headingFont,
  children,
}: {
  title: string;
  accent: string;
  rule: boolean;
  ruleFullWidth: boolean;
  slateBar: boolean;
  compact: boolean;
  cobalt: boolean;
  stacked?: boolean;
  surface: string;
  headingPt: number;
  headingFont: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: (slateBar ? 8 : compact ? (cobalt ? 3.5 : 2.5) : stacked ? 12 : 6) * PAGE_SCALE }}>
      <div
        style={{
          fontFamily: headingFont,
          fontWeight: 700,
          letterSpacing: slateBar ? "0.11em" : compact ? (cobalt ? "0.085em" : "0.07em") : "0.06em",
          textTransform: "uppercase",
          fontSize: `${headingPt}px`,
          color: accent,
          marginBottom: (slateBar ? 6 : rule ? (compact ? (cobalt ? 4 : 3.2) : stacked ? 8 : 5) : 3) * PAGE_SCALE,
          paddingTop: slateBar ? 2 * PAGE_SCALE : 0,
          paddingRight: slateBar ? 6 * PAGE_SCALE : 0,
          paddingBottom: slateBar ? 2 * PAGE_SCALE : rule ? (compact ? 1.5 : 2) * PAGE_SCALE : 0,
          paddingLeft: slateBar ? 6 * PAGE_SCALE : 0,
          background: slateBar ? surface : undefined,
          borderLeft: slateBar ? `${2.5 * PAGE_SCALE}px solid ${accent}` : undefined,
          borderBottom:
            rule && !slateBar
              ? `${(compact ? (cobalt ? 1.5 : 1.25) : 1.15) * PAGE_SCALE}px solid ${accent}`
              : undefined,
          width: rule && !slateBar && !ruleFullWidth ? "42%" : undefined,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

/** Match PDF denser body sizing so long lists preview closer to the download. */
function previewBodySize(style: TemplateStyle): number {
  if (usesStackedRolePlace(style)) return style.bodySizePt;
  if (usesCompactRhythm(style)) return Math.max(8.4, style.bodySizePt - 0.65);
  return Math.max(8.75, style.bodySizePt - 1);
}

/** Mirror PDFKit's built-in face mapping so browser preview uses the same family. */
function previewFontStack(font: string): string {
  const lower = font.toLowerCase();
  if (
    lower.includes("times") ||
    lower.includes("georgia") ||
    lower.includes("garamond") ||
    lower.includes("serif")
  ) {
    return `"Times New Roman", Times, Georgia, serif`;
  }
  if (lower.includes("courier")) {
    return `"Courier New", Courier, monospace`;
  }
  return `Helvetica, Arial, "Helvetica Neue", sans-serif`;
}
