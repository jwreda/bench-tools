// Ported from Tests/ReagentMakerEngineTests.swift, plus the SPEC worked example and the screen's derived values.
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const R = require("../reagent-maker/engine.js");
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("Tris worked example: 500 mL of 1 M, MW 121.14 → 60.57 g", () => {
  close(R.massFromMolarity(1, 0.5, 121.14), 60.57, 1e-9);
});

test("percent w/v", () => {
  close(R.massForPercentWV(10, 200), 20, 1e-9);
  close(R.percentWV(20, 200), 10, 1e-9);
});

test("percent v/v", () => {
  close(R.volumeForPercentVV(5, 100), 5, 1e-9);
  close(R.percentVV(5, 100), 5, 1e-9);
});

test("unweighable mass is flagged", () => {
  const g = R.massFromMolarity(1e-3, 0.01, 121.14);
  assert.deepEqual(R.massCautions(g), [{ kind: "belowWeighableMass", grams: g }]);
  assert.ok(R.cautionMessage({ kind: "belowWeighableMass", grams: g }).includes("1.211 mg"));
  assert.deepEqual(R.massCautions(0.005), []);
  assert.deepEqual(R.massCautions(60.57), []);
  assert.deepEqual(R.massCautions(2000), [{ kind: "implausiblyLargeMass", grams: 2000 }]);
});

test("percent over 100 is flagged", () => {
  assert.deepEqual(R.percentCautions(150, 750), [{ kind: "percentOver100" }]);
  assert.deepEqual(R.percentCautions(10, 50), []);
  assert.deepEqual(R.percentCautions(0.001, 0.001), [{ kind: "belowWeighableMass", grams: 0.001 }]);
  assert.deepEqual(R.percentCautions(120, null), [{ kind: "percentOver100" }]);
});

// ---- the screen
const molar = (o) => Object.assign({ mode: "molar", molarity: "1", molarityUnit: "M", volume: "500", volumeUnit: "mL", mw: "121.14" }, o);
const pct = (o) => Object.assign({ mode: "percent", basis: "wv", percent: "10", percentVolume: "500", amount: "" }, o);

test("screen: Tris 60.57 g", () => {
  const r = R.compute(molar(), ".");
  close(r.value, 60.57, 1e-9);
  assert.deepEqual(r.hero, { value: "60.57", unit: "g" });
  assert.equal(r.status, "exact");
  assert.equal(r.copyText, "Reagent maker: 1 M in 500 mL (MW 121.14) → 60.57 g");
});

// CHANGED (edge notes): the hero uses BM.format.mass, so it agrees with the warning.
test("screen: 10 mL of 1 mM Tris reads in mg, matching the warning", () => {
  const r = R.compute(molar({ molarity: "1", molarityUnit: "mM", volume: "10" }), ".");
  assert.deepEqual(r.hero, { value: "1.211", unit: "mg" });
  assert.equal(r.status, "approx");
  assert.ok(r.warnings[0].text.startsWith("Only 1.211 mg"));
  assert.ok(r.copyText.endsWith("1.211 mg"));
});

test("screen: blank or non-positive inputs give no result", () => {
  assert.equal(R.compute(molar({ mw: "" }), ".").kind, null);
  assert.equal(R.compute(molar({ molarity: "0" }), ".").kind, null);
  assert.equal(R.compute(molar({ volume: "-5" }), ".").kind, null);
});

test("screen: percent w/v and v/v", () => {
  let r = R.compute(pct({ percentVolume: "200" }), ".");
  assert.equal(r.kind, "amount");
  assert.deepEqual(r.hero, { value: "20.00", unit: "g" });
  assert.equal(r.eyebrow, "Mass to weigh out");
  r = R.compute(pct({ basis: "vv", percent: "5", percentVolume: "100" }), ".");
  assert.deepEqual(r.hero, { value: "5.000", unit: "mL" });
  assert.equal(r.eyebrow, "Solute volume needed");
});

test("screen: percent wins over amount; blank percent solves from amount", () => {
  let r = R.compute(pct({ percentVolume: "200", amount: "50" }), ".");
  assert.equal(r.kind, "amount");
  r = R.compute(pct({ percent: "", percentVolume: "200", amount: "20" }), ".");
  assert.equal(r.kind, "percent");
  assert.deepEqual(r.hero, { value: "10.00", unit: "%" });
  assert.equal(r.eyebrow, "Concentration");
  assert.equal(R.compute(pct({ percent: "", amount: "" }), ".").kind, null);
  assert.equal(R.compute(pct({ percentVolume: "0" }), ".").kind, null);
});

test("screen: over 100% warns", () => {
  const r = R.compute(pct({ percent: "150", percentVolume: "500" }), ".");
  assert.equal(r.status, "approx");
  assert.deepEqual(r.cautions.map(c => c.kind), ["percentOver100"]);
  assert.equal(r.warnings[0].text, "Over 100% — double-check your inputs.");
});

test("screen: solved percent from a mass over 100% g/100 mL warns", () => {
  const r = R.compute(pct({ percent: "", percentVolume: "100", amount: "150" }), ".");
  assert.deepEqual(r.cautions.map(c => c.kind), ["percentOver100"]);
});

test("screen: tiny w/v mass warns", () => {
  const r = R.compute(pct({ percent: "0.001", percentVolume: "100" }), ".");
  assert.deepEqual(r.cautions.map(c => c.kind), ["belowWeighableMass"]);
});
