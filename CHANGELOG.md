# Changes

Each release stays online at its own address (`/v1.0.0/` and so on), exactly as it was
released, so a result can be checked later against the version that produced it.

## 1.0.0 — 2026-10-29

First release: Concentration, Dilution, Serial dilution, Reagent maker, Cell counting,
Count samples, Transfection, Magnetic sort and CellTrace, ported from the BenchMate iOS app.

- Same math, number formatting and warnings as the app (260 ported tests).
- Big numbers are read back under the field as you type ("= 2.5 × 10⁶ = 2,500,000 cells/mL").
- The 1 µL warning no longer fires at exactly 1 µL or at zero.
- Copied recipes include their warnings.
