# Changes

Each release stays online at its own address (`/v1.0.0/` and so on), exactly as it was
released, so a result can be checked later against the version that produced it.

## 1.3.4 — 2026-10-29

Wisteria takes over the emphasis, matching joereda.phd's new signature colour. Links, selected
choices (including the flask chips in Count samples), checkboxes, focus rings, outline buttons,
the answer card and solved fields are now wisteria instead of green. Solid buttons and the
wordmark stay forest green. No change to any calculation.

## 1.3.3 — 2026-10-29

- Transfection: when the summary says what's missing ("Enter the stock for pLuc", a ratio part,
  a size, the culture volume, flasks or the seeding density), a button takes you to that field.
- Count samples: "Count on a hemocytometer" under each sample now has the four corner squares from
  Cell counting (live and dead per square, with the stain and dilution), or an average. The
  density reads back as you count, and "Use this count" fills in the live cells and viability.

## 1.3.1 — 2026-10-29

- Count samples: where a recipe says "Count this sample first" or asks for the target, a button
  now takes you to the field to fill in (scrolls it into view and puts the cursor there).

## 1.3.0 — 2026-10-29

- Plate by wells: Cell counting (Seeding) and Count samples (Passage) take a new **Per well**
  target. Enter the number of wells, cells per well and volume per well (µL or mL), plus an
  overage for pipetting loss (default +10 %, or a number of extra wells), and get the stock
  and medium to mix, the total cells and volume, the cells/mL, and what goes into each well.
  Typing a plating volume in mL works as before. Not in the app yet.
- Magnetic sort gets the same plating, from the isolated cells (with a "not enough cells: enough
  for N wells" check), and a **Stain with CellTrace Violet** button that opens CellTrace with the
  isolated count and the wells filled in.
- Count samples keeps its counts after a reload again (the samples and the other fields were
  saved under the same key, so changing a choice could drop the counts).

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
