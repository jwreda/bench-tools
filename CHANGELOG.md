# Changes

Each release stays online at its own address (`/v1.0.0/` and so on), exactly as it was
released, so a result can be checked later against the version that produced it.

## 1.2.0 — 2026-10-29

- Impossible plans now say so plainly instead of printing a recipe that can't work: why it
  fails, the volume the inputs would still take, and one tap to fix it where there is a clear
  fix (Magnetic sort: "Spin down instead" or "Make 2.500 mL instead"). Dilution and Cell
  counting get the same card; other errors turn their result card rose with the number dimmed.
- Copy as Markdown on every tool page: every field, choice, result, step and warning as you
  filled them in, ready for a notebook or ELN.
- Copy buttons fall back to a text selection where the clipboard is blocked.
- Step checklists (Magnetic sort, CellTrace) pick up the new colours.

## 1.1.0 — 2026-10-29

New look, matching joereda.phd: warm paper, forest green actions, caramel labels and a faint
wisteria wash, set in Newsreader and Inter. No change to any calculation.

- Light and dark themes, following the system with a toggle in the new top bar.
- Tools on the home page carry a category tag (Solutions, Cell culture, Cell prep).
- Results sit on a solid, faintly green card; warnings use warm amber and rose.

## 1.0.0 — 2026-10-29

First release: Concentration, Dilution, Serial dilution, Reagent maker, Cell counting,
Count samples, Transfection, Magnetic sort and CellTrace, ported from the BenchMate iOS app.

- Same math, number formatting and warnings as the app (260 ported tests).
- Big numbers are read back under the field as you type ("= 2.5 × 10⁶ = 2,500,000 cells/mL").
- The 1 µL warning no longer fires at exactly 1 µL or at zero.
- Copied recipes include their warnings.
