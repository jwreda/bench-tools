// Ported from Tests/PassagingEngineTests.swift and Tests/SerialCountingModelTests.swift
// (SerialCountingModelTests + FlaskWorkingVolumeTests).
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const P = require("../count-samples/passaging.js");
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const SEP = ".";
const rec = (stock, vol, amount) => { const r = P.recipe(stock, vol, amount); assert.ok(r && r.ok); return r.recipe; };
const total = (v) => ({ kind: "totalCells", value: v });
const dens = (v) => ({ kind: "density", value: v });

test("total cells recipe", () => {
  const r = rec(2e6, 10, total(1e6));
  close(r.suspensionVolume, 0.5, 1e-12);
  close(r.mediumVolume, 9.5, 1e-12);
  close(r.dilutionFactor, 20, 1e-9);
  close(r.finalDensity, 1e5, 1e-6);
  close(r.suspensionVolume + r.mediumVolume, r.finalVolume, 1e-12);
  assert.equal(r.warnings.length, 0);
});

test("density recipe matches total cells", () => {
  const a = rec(2e6, 10, dens(1e5)), b = rec(2e6, 10, total(1e6));
  assert.deepEqual(a, b);
  close(a.dilutionFactor, 2e6 / 1e5, 1e-9);
});

test("undiluted suspension is one in one", () => {
  const r = rec(1e6, 5, total(5e6));
  close(r.suspensionVolume, 5, 1e-12);
  close(r.mediumVolume, 0, 1e-12);
  close(r.dilutionFactor, 1, 1e-12);
});

test("too dilute fails", () => {
  const r = P.recipe(1e5, 10, total(2e6));
  assert.equal(r.ok, false);
  assert.deepEqual(r.failure, { kind: "suspensionTooDilute", neededML: 20 });
});

test("sub-microliter warning (and not at exactly 1 µL or zero)", () => {
  assert.deepEqual(rec(1e8, 1, total(5e4)).warnings, [{ kind: "subMicroliterSuspension", mL: 5e-4 }]);
  assert.equal(rec(1e8, 1, total(1e5 * (1 - 1e-12))).warnings.length, 0);
});

test("missing inputs give null", () => {
  assert.equal(P.recipe(0, 10, total(1e6)), null);
  assert.equal(P.recipe(1e6, 0, total(1e6)), null);
  assert.equal(P.recipe(1e6, 10, dens(0)), null);
  assert.equal(P.recipe(Infinity, 10, total(1e6)), null);
});

test("generic names", () => {
  assert.deepEqual([0, 1, 2].map((i) => P.genericName("sample", i)), ["Sample 1", "Sample 2", "Sample 3"]);
  assert.equal(P.genericName("letter", 0), "A");
  assert.equal(P.genericName("letter", 25), "Z");
  assert.equal(P.genericName("letter", 26), "AA");
  assert.equal(P.genericName("flask", 1), "Flask 2");
  assert.equal(P.genericName("well", 0), "A1");
  assert.equal(P.genericName("well", 11), "A12");
  assert.equal(P.genericName("well", 12), "B1");
});

test("generic and custom names", () => {
  const m = P.newState();
  assert.equal(P.name(m, 1), "Sample 2");
  m.samples[1].customName = "  WT day 3 ";
  assert.equal(P.name(m, 1), "WT day 3");
  m.naming = "letter";
  assert.equal(P.name(m, 0), "A");
  assert.equal(P.name(m, 1), "WT day 3");
  assert.equal(P.hasCustomNames(m), true);
  P.resetNames(m);
  assert.equal(P.name(m, 1), "B");
});

test("stepping down keeps entries", () => {
  const m = P.newState();
  m.samples[2].densityText = "2000000";
  m.sampleCount = 1;
  assert.deepEqual(P.indices(m), [0]);
  assert.equal(P.countedSamples(m, SEP), 0);
  m.sampleCount = 3;
  assert.equal(P.countedSamples(m, SEP), 1);
});

test("shared target recipe", () => {
  const m = P.newState();
  m.samples[0].densityText = "2000000";
  const r = P.sampleRecipe(m, 0, SEP).recipe;
  assert.equal(m.amountMode, "density");
  close(r.suspensionVolume, 0.5, 1e-12);
  close(r.mediumVolume, 9.5, 1e-12);
  assert.equal(P.sampleRecipe(m, 1, SEP), null);
});

test("density mode and per-sample targets", () => {
  const m = P.newState();
  m.samples[0].densityText = "4000000";
  m.samples[1].densityText = "1000000";
  m.amountMode = "density";
  m.sharedAmountText = "200000";
  m.sameTarget = false;
  P.splitTargets(m);
  m.samples[1].finalVolumeText = "5";
  const first = P.sampleRecipe(m, 0, SEP).recipe;
  close(first.dilutionFactor, 20, 1e-9);
  close(first.suspensionVolume, 0.5, 1e-12);
  const second = P.sampleRecipe(m, 1, SEP).recipe;
  close(second.suspensionVolume, 1, 1e-12);
  close(second.mediumVolume, 4, 1e-12);
  close(second.dilutionFactor, 5, 1e-9);
});

test("fields use the shared parser", () => {
  const m = P.newState();
  m.samples[0].densityText = " 2 000 000 ";
  assert.equal(P.density(m, 0, SEP), 2e6);
  m.sharedFinalVolumeText = " 10 ";
  close(P.sampleRecipe(m, 0, SEP).recipe.suspensionVolume, 0.5, 1e-12);
});

test("viability is recorded within range", () => {
  const m = P.newState();
  assert.equal(P.viability(m, 0, SEP), null);
  m.samples[0].viabilityText = "92.5";
  assert.equal(P.viability(m, 0, SEP), 92.5);
  m.samples[0].viabilityText = "120";
  assert.equal(P.viability(m, 0, SEP), null);
  assert.match(P.sampleWarnings(m, 0, SEP)[0].text, /^Viability is a percentage/);
});

test("flask working volume is a quarter of the flask", () => {
  const f = (id) => P.FLASKS.find((x) => x.id === id);
  close(f("L1").workingVolumeL, 0.25, 1e-12);
  close(f("mL125").workingVolumeL, 0.03125, 1e-12);
  assert.deepEqual(P.FLASKS.map((x) => x.workingVolumeML), [31.25, 62.5, 125, 250, 500]);
  assert.equal(P.matchingFlask(0.5).id, "L2");
  assert.equal(P.matchingFlask(0.010), null);
  // Transfection's culture plus its 10 mL per 240 mL of mix fills the same working volume.
  close(0.24 * (1 + 10 / 240), f("L1").workingVolumeL, 1e-12);
});

test("text: dilution factor, recipe lines and copy", () => {
  assert.equal(P.dilutionText(20), "Dilution factor 20 (1 part cells + 19 parts medium)");
  assert.equal(P.dilutionText(2.8187), "Dilution factor 2.82 (1 part cells + 1.82 parts medium)");
  assert.equal(P.dilutionText(1), "Undiluted: use the suspension as is");
  assert.equal(P.factorText(41.666), "41.7");
  assert.equal(P.factorText(120.4), "120");
  const m = P.newState();
  m.samples[0].densityText = "2000000";
  m.samples[0].viabilityText = "94";
  m.samples[1].densityText = "1000";
  const r = P.sampleRecipe(m, 0, SEP).recipe;
  assert.equal(P.detailText(m, 0, r, SEP), "1.0 × 10⁶ cells at 1.0 × 10⁵ cells/mL, from 2.0 × 10⁶ live cells/mL · 94.00% viable");
  const t = P.copyText(m, SEP).split("\n");
  assert.equal(t[0], "Sample 1: 2.0 × 10⁶ live cells/mL, 94.00% viable → 500.0 µL cells + 9.500 mL medium = 10.00 mL, dilution factor 20, 1.0 × 10⁶ cells");
  assert.match(t[1], /^Sample 2: 1\.0 × 10³ live cells\/mL → too dilute \(needs 1\.000 L of suspension\)/);
  assert.match(t[2], /^  ✕ Too dilute/);
  assert.equal(t[3], "Sample 3: not counted");
});

test("SPEC: 1e6 cells from a 2e6 stock in 10 mL", () => {
  const r = rec(2e6, 10, dens(1e5));
  assert.equal(BM.format.volume(r.suspensionVolume / 1000), "500.0 µL");
});

// ---- plating by wells (web only; not in the app yet)

test("per well target: suspension and medium for wells × cells × volume + overage", () => {
  const st = P.newState();
  st.amountMode = "wells";
  st.samples[0].densityText = "2000000";
  const res = P.sampleRecipe(st, 0, SEP);
  assert.ok(res.ok);
  close(res.recipe.suspensionVolume, 0.66, 1e-12);
  close(res.recipe.finalVolume, 13.2, 1e-12);
  close(res.recipe.finalDensity, 1e5, 1e-6);
  assert.match(P.copyText(st, SEP), /Mix for 26\.4 wells \(24 \+ 10%\)\. Plate 500\.0 µL per well/);
});

test("per well target per sample, with its own unit and the shared overage", () => {
  const st = P.newState();
  st.amountMode = "wells";
  st.sameTarget = false;
  P.splitTargets(st);
  assert.equal(st.samples[1].wellsText, "24");
  assert.equal(st.samples[1].wellVolumeUnit, "uL");
  Object.assign(st.samples[1], { densityText: "1000000", wellsText: "6", cellsPerWellText: "300000", wellVolumeText: "2", wellVolumeUnit: "mL" });
  st.overageText = "1";
  st.overageKind = "wells";
  const r = P.sampleRecipe(st, 1, SEP).recipe;
  close(r.cells, 2.1e6, 1e-6);
  close(r.finalVolume, 14, 1e-12);
  close(r.suspensionVolume, 2.1, 1e-12);
  close(P.wellTarget(st, 0, SEP).plan.volumePerWell, 0.5, 1e-15);   // sample 1 keeps 500 µL
});

test("per well target: no overage warns, a negative one is an error", () => {
  const st = P.newState();
  st.amountMode = "wells";
  st.samples[0].densityText = "2000000";
  st.overageText = "0";
  assert.equal(P.sampleWarnings(st, 0, SEP)[0].level, "warn");
  st.overageText = "-3";
  assert.equal(P.sampleRecipe(st, 0, SEP), null);
  assert.equal(P.sampleWarnings(st, 0, SEP)[0].level, "error");
});
