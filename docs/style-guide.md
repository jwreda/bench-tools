# Style guide

bench-tools matches Joe's professional site (joereda.phd, October 2026 design). The tokens
and components live in `assets/bench.css`; this page records the rules behind them so later
changes stay consistent.

## The feel

- Elegant, restrained, professional: a well-made lab notebook, not a product launch.
- Warm, never stark. Paper `#fefdfb` / warm near-black `#1f1c1a`, brown-leaning neutrals,
  caramel-tinted shadows.
- **Wisteria** carries the emphasis (since 1.3.4, Joe's call): links, selected segments,
  checked boxes, focus rings, secondary buttons, the faintly wisteria answer card and solved
  fields, plus the page wash behind each title and the frosted hover glass. This goes further
  than the site, where wisteria is kept for special moments; in a calculator the emphasis is
  the answer and the choices you made, and those are wisteria.
- **Forest green** anchors the brand: primary (solid) buttons and the wordmark, as on the site.
- **Caramel** labels and organises: uppercase eyebrow labels, units, hairlines.
- Glass only where things float or on hover. Inputs, results and tables sit on solid surfaces.
- Motion is soft and only responds: spring lifts on hover, a one-time blur-in on the home
  list. Nothing loops. Everything is instant under `prefers-reduced-motion`.
- Light and dark are both first class: system setting by default, manual toggle in the top bar
  (saved in `localStorage` as `theme`).
- Function is never compromised: no lower contrast for mood, results never animate.

## Palette

Build with the role tokens (`--bg`, `--surface`, `--text`, `--text-2`, `--text-3`,
`--border`, `--border-strong`, `--link`, `--brand`, `--btn-bg`, `--select-bg`, `--label`, ...),
never raw shades.
Tool-specific roles derived from the site: `--field-bg`, `--field-border`, `--unit`,
`--result-bg`, `--result-edge`, `--solved-bg`, `--warn-*`, `--error-*`.

Scales: forest green, caramel, warm neutrals, wisteria (50–900, see the top of bench.css).
No teal anywhere.

## Category tags

Pastel pills, deep ink on a 22% pastel fill in light, pastel ink on a 14% fill in dark.
Used on the home list, at most five:

| Category | Colour | Tools |
| --- | --- | --- |
| Solutions | celery | Concentration, Dilution, Serial dilution, Reagent maker |
| Cell culture | porsche | Cell counting, Count samples, Transfection |
| Cell prep | sky | Magnetic sort, CellTrace |

Magnetic sort also uses sky/porsche tags to tell its two sample lines apart.
Wewak and wisteria stay free (wewak-deep doubles as the error colour, porsche-deep as warning).

## Type

Newsreader 600 (−0.025em) for page titles and the wordmark; Inter for everything else,
16px body. Section titles are caramel eyebrow labels (14px uppercase Inter 500, 0.05em).
Inputs stay at 16px so iOS Safari doesn't zoom. Numbers use `tabular-nums`.

## Shape and components

Radii 4 / 8 / 12 / full. Cards: surface, 1px caramel-100 hairline (warm-700 dark), 12px radius,
warm shadow, 20px padding (16px on narrow phones). Primary button: green-600, white text, spring
lift on hover. Secondary: 2px wisteria outline (wisteria-600 light, wisteria-300 dark), wisteria
glass on hover. Selected segment: solid wisteria-600 with white text (wisteria-300 with
`#1f1c1a` in dark). The answer card is faintly wisteria; a result that can't be used stays rose. Home rows: the site's
Tools-page row link (slides 4px right, wisteria title and arrow on hover). Hover effects sit in
`@media (hover: hover)` so they don't stick after a tap on iPhone.

Step lists and the parallel run table show progress three ways: done rows are shaded
(`--step-done-bg`) and struck through with a filled tick, the current step (the first one not done,
across the whole page) gets a stronger tint (`--step-now-bg`) and a 3px wisteria bar
(`--step-now-edge`) plus `aria-current="step"`, and later steps sit in `--text-2`.

Every page has the same sticky top bar (95% paper, 4px blur, caramel hairline): wordmark,
"All tools" on tool pages, theme toggle. Each page header is a `.page-head` with an eyebrow,
the title and a lede, over the faint wisteria wash.

## Safari

Joe uses Safari: check changes in WebKit. Always pair `backdrop-filter` with
`-webkit-backdrop-filter`; `color-mix()` needs Safari 16.2+; never measure layout once at
script start (observe with `ResizeObserver` if an offset is ever needed); no lasting
`will-change` on text.

## Left out on purpose

Blobs, parallax, looping or bouncing animation, teal, gradient text, neon glows, emoji as
icons, glass on everything, and the site's whole-page film grain (too busy for a calculator).
