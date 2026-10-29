// Builds the published site into _site/:
//   _site/            the current files on this branch (the latest version)
//   _site/vX.Y.Z/     every tagged release, frozen as it was tagged
//   _site/versions.html  the list of releases with their CHANGELOG notes
// Run from the repo root: node scripts/build-site.mjs
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = "_site";
// What gets published from a checkout: everything except these.
const SKIP = new Set([".git", ".github", "_site", "scripts", "tests", "node_modules",
  "README.md", "CHANGELOG.md", "package.json", ".gitignore"]);

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

function copySite(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (SKIP.has(name) || /^v\d/.test(name)) continue;
    fs.cpSync(path.join(from, name), path.join(to, name), { recursive: true });
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copySite(".", OUT);

const tags = sh("git tag --list 'v*' --sort=-version:refname").split("\n").filter(Boolean);
for (const tag of tags) {
  const tmp = fs.mkdtempSync("/tmp/bench-tools-");
  execSync(`git archive ${tag} | tar -x -C ${tmp}`);
  const dest = path.join(OUT, tag);
  copySite(tmp, dest);
  // Archived copies say so on every page and link back to the latest.
  const js = path.join(dest, "assets", "bench.js");
  if (fs.existsSync(js)) {
    fs.writeFileSync(js, fs.readFileSync(js, "utf8").replace("BM.FROZEN = false;", "BM.FROZEN = true;"));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// versions.html from CHANGELOG.md: one section per "## X.Y.Z — date" heading.
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const sections = fs.readFileSync("CHANGELOG.md", "utf8").split(/^## /m).slice(1);
const items = sections.map((sec) => {
  const [head, ...body] = sec.split("\n");
  const version = head.split(/\s/)[0];
  const tag = "v" + version;
  const link = tags.includes(tag) ? ` · <a href="${tag}/index.html">Open v${esc(version)}</a>` : "";
  const html = [];
  let list = false;
  for (const line of body.join("\n").trim().split(/\n\s*\n/)) {
    if (line.startsWith("- ")) {
      html.push("<ul>" + line.split(/\n(?=- )/).map((l) => `<li>${inline(l.slice(2).replace(/\n\s*/g, " "))}</li>`).join("") + "</ul>");
    } else {
      html.push(`<p>${inline(line.replace(/\n/g, " "))}</p>`);
    }
  }
  return `<section class="card"><h3>${esc(head)}</h3>${html.join("")}<p class="hint">${link.replace(/^ · /, "")}</p></section>`;
});
fs.writeFileSync(path.join(OUT, "versions.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Versions · BenchMate tools</title>
<link rel="stylesheet" href="assets/bench.css">
</head>
<body>
<main>
  <header class="top"><a href="index.html">‹ All tools</a></header>
  <h1>Versions</h1>
  <p class="lede">The tools at the top level are always the latest. Every release also stays online, unchanged, at its own address.</p>
  ${items.join("\n  ")}
</main>
</body>
</html>
`);
console.log(`Built ${OUT}/ with ${tags.length} archived release(s): ${tags.join(", ") || "none yet"}`);
