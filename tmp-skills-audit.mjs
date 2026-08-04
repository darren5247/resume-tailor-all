import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function docxText(docxPath) {
  const tmp = path.join(process.env.TEMP, `sk-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const ps = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem;
      [IO.Compression.ZipFile]::ExtractToDirectory('${docxPath.replace(/'/g, "''")}', '${tmp.replace(/'/g, "''")}')
    `;
    spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
    const xml = fs.readFileSync(path.join(tmp, "word", "document.xml"), "utf8");
    return xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function skillsBlock(text) {
  const m =
    text.match(/TECHNICAL SKILLS\s*\n([\s\S]*?)\nWORK EXPERIENCE/i) ||
    text.match(/TECHNICAL SKILLS\s*\n([\s\S]*?)\nEXPERIENCE/i);
  return (m ? m[1] : "").trim();
}

const out = "d:/US-Resume-tailor/output";
const dirs = fs
  .readdirSync(out)
  .filter(
    (d) =>
      d.startsWith("2026-08-03_") &&
      fs.existsSync(path.join(out, d, "Resume-Juan.docx")) &&
      fs.existsSync(path.join(out, d, "metadata.json")),
  )
  .map((d) => ({ d, mtime: fs.statSync(path.join(out, d, "metadata.json")).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, 10);

for (const { d } of dirs) {
  const meta = JSON.parse(fs.readFileSync(path.join(out, d, "metadata.json"), "utf8"));
  const text = docxText(path.join(out, d, "Resume-Juan.docx"));
  const skills = skillsBlock(text);
  const firstGroup = skills.split("\n").find((l) => l.includes(":")) || "(none)";
  console.log("====", d);
  console.log("role:", meta.role, "| ATS:", meta.atsScore);
  console.log("FIRST SKILL GROUP:", firstGroup.slice(0, 220));
  console.log("missing (up to 10):", (meta.missingKeywords || []).slice(0, 10).join(" | ") || "(none)");
  console.log("");
}

console.log("==== BAKEOFF ====");
for (const f of fs.readdirSync(path.join(out, "_bakeoff")).filter((x) => x.endsWith(".txt"))) {
  const text = fs.readFileSync(path.join(out, "_bakeoff", f), "utf8");
  const m = text.match(/SKILLS\n([\s\S]*?)\n\nEXPERIENCE/);
  const skills = (m ? m[1] : "").trim();
  console.log(f);
  console.log(skills.split("\n").slice(0, 3).join("\n"));
  console.log("");
}
