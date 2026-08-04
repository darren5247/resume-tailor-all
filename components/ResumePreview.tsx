"use client";

import type { ResumeDoc } from "@/lib/llm/schemas";
import type { TemplateId } from "@/lib/settings-schema";
import {
  bandContactColor,
  bandEdgeColor,
  bandHeadlineColor,
  formatContactLines,
  hex,
  isCobaltRail,
  railColor,
  templateStyle,
  usesClearHierarchy,
  usesCompactRhythm,
} from "@/lib/docx/templates";

/**
 * HTML stand-in for the DOCX page. It mirrors fonts, accent colour, and layout
 * mode so picking a template on the left updates a readable paper preview.
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
  const contactLines = formatContactLines(resume.contactLine);
  const bandEdge = bandEdgeColor(style);
  const rail = hex(railColor(style));

  return (
    <div
      className="resume-preview origin-top rounded-sm bg-white text-black shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
      style={{
        fontFamily: `"${style.bodyFont}", ui-sans-serif, system-ui, sans-serif`,
        color: body,
        fontSize: `${style.bodySizePt * 0.95}px`,
        lineHeight: compact ? (cobalt ? 1.34 : 1.3) : hierarchy ? 1.42 : 1.35,
        width: "100%",
        maxWidth: "340px",
      }}
    >
      <div
        style={{
          padding: band ? "0" : "18px 18px 22px",
          textAlign: style.centerHeader ? "center" : "left",
        }}
      >
        <div
          style={
            band
              ? {
                  background: surface,
                  color: nameColor,
                  padding: compact ? (cobalt ? "15px 16px 12px" : "14px 16px 11px") : "16px 18px 14px",
                  marginBottom: compact ? 0 : "14px",
                  boxShadow: bandEdge ? `inset 0 -2px 0 ${hex(bandEdge)}` : undefined,
                  borderLeft: cobalt ? `3px solid ${rail}` : undefined,
                }
              : undefined
          }
        >
          <div
            style={{
              fontFamily: `"${style.headingFont}", Georgia, serif`,
              fontWeight: 700,
              fontSize: `${style.nameSizePt * 0.72}px`,
              letterSpacing: slateBar ? "0.06em" : compact ? (cobalt ? "0.055em" : "0.07em") : "0.04em",
              color: nameColor,
              lineHeight: 1.1,
            }}
          >
            {resume.name.toUpperCase()}
          </div>
          {resume.headline && (
            <div
              style={{
                marginTop: compact ? 3 : 4,
                color: band ? hex(bandHeadlineColor(style)) : muted,
                fontSize: `${style.headlineSizePt * 0.9}px`,
                lineHeight: cobalt ? 1.35 : undefined,
              }}
            >
              {resume.headline}
            </div>
          )}
          {contactLines.length > 0 && (
            <div
              style={{
                marginTop: compact ? 5 : 6,
                color: band ? hex(bandContactColor(style)) : muted,
                fontSize: `${Math.max(style.bodySizePt - 1.25, 7.5) * 0.95}px`,
                lineHeight: 1.35,
                borderBottom: !band && style.headerRule ? `1px solid ${accent}` : undefined,
                paddingBottom: !band && style.headerRule ? 6 : 0,
              }}
            >
              {contactLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: band ? (compact ? (cobalt ? "10px 16px 18px" : "8px 16px 18px") : "0 18px 22px") : 0 }}>
          {resume.summary && (
            <Section
              title="Professional Summary"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              surface={surface}
            >
              <p style={{ margin: 0 }}>{resume.summary}</p>
            </Section>
          )}

          {resume.skills.length > 0 && (
            <Section
              title="Technical Skills"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              surface={surface}
            >
              {resume.skills.map((group) => (
                <div key={group.label} style={{ marginBottom: compact ? (cobalt ? 2.5 : 1.5) : 3 }}>
                  <strong>{group.label}: </strong>
                  {group.items.join(", ")}
                </div>
              ))}
            </Section>
          )}

          {resume.experience.length > 0 && (
            <Section
              title="Work Experience"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              surface={surface}
            >
              <div style={{ position: "relative", paddingLeft: timeline ? (cobalt ? 16 : 14) : 0 }}>
                {timeline && (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: cobalt ? 4 : 3,
                      top: 6,
                      bottom: 6,
                      width: cobalt ? 1.5 : 2,
                      background: rail,
                      borderRadius: 2,
                    }}
                  />
                )}
                {resume.experience.map((role) => (
                  <div
                    key={`${role.company}-${role.period}`}
                    style={{
                      position: "relative",
                      marginBottom: compact ? (cobalt ? 11 : 8) : hierarchy ? 12 : 10,
                      padding: cards ? "8px 9px" : 0,
                      border: cards ? `1px solid ${accent}55` : undefined,
                      borderRadius: cards ? 4 : undefined,
                      background: cards ? `${surface}` : undefined,
                    }}
                  >
                    {timeline && (
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          left: cobalt ? -16 : -14,
                          top: 4,
                          width: cobalt ? 9 : 8,
                          height: cobalt ? 9 : 8,
                          borderRadius: "50%",
                          background: rail,
                          boxShadow: cobalt ? `0 0 0 2px #fff, 0 0 0 3px ${rail}55` : "0 0 0 2px #fff",
                        }}
                      />
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <strong style={{ color: timeline || hierarchy ? accent : body }}>{role.company}</strong>
                      <span style={{ color: muted, whiteSpace: "nowrap", fontSize: "8.25px", letterSpacing: "0.01em" }}>
                        {role.period}
                      </span>
                    </div>
                    {(role.role || role.location) && (
                      <div
                        style={{
                          marginBottom: role.overview ? 2 : compact ? 2 : hierarchy ? 4 : 3,
                          marginTop: hierarchy ? 1 : 0,
                        }}
                      >
                        {hierarchy ? (
                          <>
                            {role.role && <span style={{ color: body }}>{role.role}</span>}
                            {role.role && role.location && <span style={{ color: muted }}> · </span>}
                            {role.location && (
                              <span style={{ color: muted, fontStyle: "italic", fontSize: "8.5px" }}>{role.location}</span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: muted, fontStyle: "italic" }}>
                            {[role.role, role.location].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                    )}
                    {role.overview && (
                      <p
                        style={{
                          margin: "0 0 3px",
                          fontStyle: "italic",
                          color: body,
                          fontSize: compact ? "8.75px" : undefined,
                        }}
                      >
                        {role.overview}
                      </p>
                    )}
                    <ul style={{ margin: 0, paddingLeft: 14 }}>
                      {role.bullets.map((bullet) => (
                        <li key={bullet} style={{ marginBottom: compact ? (cobalt ? 1.5 : 1) : 2 }}>
                          {bullet}
                        </li>
                      ))}
                    </ul>
                    {role.technologies.length > 0 && (
                      <p style={{ margin: "3px 0 0", fontStyle: "italic", fontSize: cobalt ? "7.75px" : "8.25px" }}>
                        <strong style={{ color: cobalt ? muted : body }}>{cobalt ? "Stack: " : "Technologies used: "}</strong>
                        <span style={{ color: muted }}>{role.technologies.join(", ")}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {resume.education.length > 0 && (
            <Section
              title="Education"
              accent={accent}
              rule={style.headingRule}
              ruleFullWidth={style.headingRuleFullWidth}
              slateBar={slateBar}
              compact={compact}
              cobalt={cobalt}
              surface={surface}
            >
              {resume.education.map((entry) => (
                <div key={`${entry.degree}-${entry.school}`} style={{ marginBottom: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ color: hierarchy ? accent : body }}>{entry.degree || entry.school}</strong>
                    <span style={{ color: muted, fontSize: "8.5px" }}>{entry.period}</span>
                  </div>
                  <div style={{ color: muted }}>
                    {[entry.school && entry.degree ? entry.school : "", entry.location, entry.gpa ? `GPA ${entry.gpa}` : ""]
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
              surface={surface}
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
              surface={surface}
            >
              <ul style={{ margin: 0, paddingLeft: 14 }}>
                {resume.certifications.map((entry) => (
                  <li key={entry.name}>
                    {entry.url?.trim() ? (
                      <a href={entry.url.trim()} target="_blank" rel="noopener noreferrer" style={{ color: accent }}>
                        {entry.name}
                      </a>
                    ) : (
                      entry.name
                    )}
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
  surface,
  children,
}: {
  title: string;
  accent: string;
  rule: boolean;
  ruleFullWidth: boolean;
  slateBar: boolean;
  compact: boolean;
  cobalt: boolean;
  surface: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: slateBar ? 14 : compact ? (cobalt ? 11 : 9) : 12 }}>
      <div
        style={{
          fontFamily: slateBar ? "Georgia, serif" : undefined,
          fontWeight: 700,
          letterSpacing: slateBar ? "0.12em" : compact ? (cobalt ? "0.11em" : "0.1em") : "0.08em",
          textTransform: "uppercase",
          fontSize: slateBar ? "8.5px" : compact ? "8px" : "9px",
          color: accent,
          marginBottom: slateBar ? 8 : compact ? (cobalt ? 5.5 : 5) : 6,
          paddingTop: slateBar ? 5 : 0,
          paddingRight: slateBar ? 8 : 0,
          paddingBottom: slateBar ? 5 : rule ? (compact ? 2.5 : 3) : 0,
          paddingLeft: slateBar ? 8 : 0,
          background: slateBar ? surface : undefined,
          borderLeft: slateBar ? `3px solid ${accent}` : undefined,
          borderBottom: rule && !slateBar ? `${cobalt ? 2 : 1.5}px solid ${accent}` : undefined,
          width: rule && !slateBar && !ruleFullWidth ? "42%" : undefined,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}
