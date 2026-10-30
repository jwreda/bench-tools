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
const SKIP = new Set([".git", ".github", "_site", "scripts", "tests", "docs", "node_modules",
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Inter:wght@400;500;600;700&display=swap">
<script>
  // Before first paint: a saved light/dark choice (none = follow the system), and reveals on.
  document.documentElement.classList.add("js");
  try { var t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
</script>
<link rel="stylesheet" href="assets/bench.css">
</head>
<body>
<header class="topbar">
  <div class="inner">
    <a class="wordmark" href="index.html">BenchMate tools</a>
    <a class="back" href="index.html">All tools</a>
    <button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch theme">
      <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>
    </button>
  </div>
</header>
<main>
  <div class="page-head">
    <p class="eyebrow">Releases</p>
    <h1>Versions</h1>
    <p class="lede">The tools at the top level are always the latest. Every release also stays online, unchanged, at its own address.</p>
  </div>
  ${items.join("\n  ")}
</main>
<script src="assets/bench.js"></script>
</body>
</html>
`);
console.log(`Built ${OUT}/ with ${tags.length} archived release(s): ${tags.join(", ") || "none yet"}`);

// Stamp the local CSS and JS links in the latest copy with this commit, so a browser holding the
// last deploy's files (Pages lets them be cached for 10 minutes) fetches the new ones at once.
// Archived versions never change, so they keep plain links.
const STAMP = sh("git rev-parse --short HEAD");
const stampLinks = (html) => html.replace(/((?:src|href)=")((?![a-z]+:|\/\/)[^"?#]+\.(?:css|js))"/g, `$1$2?v=${STAMP}"`);
(function stampDir(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { if (dir !== OUT || !/^v\d/.test(name)) stampDir(p); }
    else if (name.endsWith(".html")) fs.writeFileSync(p, stampLinks(fs.readFileSync(p, "utf8")));
  }
})(OUT);
