# BenchMate tools (web)

Static, phone-first web versions of BenchMate's calculators and protocol helpers.
No build step, no framework, no network calls: copy this folder to any web host
(or open `index.html` from disk) and it works.

## Publishing and versions

GitHub Actions (`.github/workflows/pages.yml`) runs the tests on every push and publishes
the site to GitHub Pages from `main`:

- the files on `main` are the latest version, at the site root;
- every tag `vX.Y.Z` stays online unchanged at `/vX.Y.Z/`, with a note on each page that
  it's an archived version and a link to the latest;
- `versions.html` lists the releases with their notes from `CHANGELOG.md`.

To release: bump `BM.VERSION` in `assets/bench.js`, add a `## X.Y.Z — date` section to
`CHANGELOG.md`, commit, then `git tag vX.Y.Z && git push --tags`.
Build locally with `node scripts/build-site.mjs` (writes `_site/`).

## Layout

```
/
  index.html            list of tools + "Get the app" note
  assets/bench.css      the one stylesheet
  assets/bench.js       shared helpers: number parsing/formatting, units, page helpers (global BM)
  <tool>/index.html     the page: markup + a short script that reads fields and draws results
  <tool>/engine.js      the math, ported from the app's Swift; pure functions, no DOM
  tests/<tool>.test.js  ported from the app's XCTest files
```

## Rules for every tool

- **The math lives in `engine.js` and matches the app.** Port the Swift engine and the view
  model's derived values (warnings, recipe text, rounding) line by line, and port the
  matching XCTest cases into `tests/`. The page script only reads inputs, calls the engine
  and writes the results.
- **Numbers go through `BM.format`.** `BM.format.parse` reads every typed number (comma
  decimal marks, grouping) and `number` / `scientific` / `volume` / `mass` print every
  result, so a value prints the same on the phone and on the web.
- **Warnings are never dropped.** Every guardrail the app shows appears on the page, as
  `{ level: "warn" | "error", text }` rendered with `BM.ui.warnings`.
- **Plain HTML.** Inputs are `<input inputmode="decimal">`, choices are `<select>` or the
  `.segments` radio group, results go in `.result`. Use the classes in `bench.css`; add a
  class there rather than a style attribute when something is reused.
- Engines are plain scripts that attach to `BM` and also `module.exports`, so the same file
  runs in the browser and in `node --test`.

## Tests

```
node --test tests/*.test.js
```

## Number read-back

Add `data-sci` to a number input whose value can span orders of magnitude (cell densities,
counts, MW). A line under it reads the number back: "= 2.5 × 10⁶ = 2,500,000 cells/mL".
`data-sci-unit` adds the unit; `data-sci-scale="1e6"` when the field is typed in millions.

## App Store link

Set `BM.APP_STORE_URL` in `assets/bench.js` once BenchMate is live; every page's
"Coming soon to the App Store" note becomes a "Get BenchMate on the App Store" button.

## Source

Ported from the BenchMate iOS app (`phase2/shareable` at b0a1480, 2026-10-28). When the app's
math changes, port the change and its tests here.
