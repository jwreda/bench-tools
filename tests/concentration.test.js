// Ported from Tests/ConcentrationEngineTests.swift and Tests/ConcentrationModelTests.swift.
const test = require("node:test");
const assert = require("node:assert/strict");
require("../assets/bench.js");
const C = require("../concentration/engine.js");
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const np = (input) => ({ kind: "notPositive", input });
const kda = { kind: "molecularWeightLooksLikeKDa" };

test("BSA mass to molar (SPEC: 2 mg/mL, MW 66,463 → 30.1 µM)", () => {
  close(C.molarFromMass(2, 66463), 3.0091931e-5, 1e-9);
  close(C.molarity(2, "mgPerML", 66463, "uM"), 30.1, 0.05);
});

test("IgG A280 to mass (SPEC: ε 210,000, MW 150,000 → E 1.40; A 1.40 → 1.0 mg/mL)", () => {
  const e = C.massExtinctionCoefficient(210000, 150000);
  close(e, 1.4, 1e-9);
  close(C.massConcentrationFromA280(1.4, 210000, 150000), 1.0, 1e-9);
  close(C.concentrationFromA280Mass(1.4, e), 1.0, 1e-9);
});

test("A280 molar, with path length", () => {
  close(C.concentrationFromA280Molar(1, 1000), 0.001, 1e-12);
  close(C.concentrationFromA280Molar(2, 1000, 2), 0.001, 1e-12);
});

test("mass/molar round trip", () => {
  const g = C.massFromMolar(3.0091931e-5, 66463);
  close(g, 2.0, 1e-6);
  close(C.molarFromMass(g, 66463), 3.0091931e-5, 1e-9);
});

test("unit-aware round trip", () => {
  const mg = C.massConcentration(10, "uM", 150000, "mgPerML");
  close(mg, 1.5, 1e-9);
  close(C.molarity(mg, "mgPerML", 150000, "uM"), 10, 1e-6);
});

test("clean BSA / IgG inputs raise no cautions", () => {
  assert.deepEqual(C.massMolarCautions(66463, 2), []);
  assert.deepEqual(C.a280Cautions(1.4, 210000, 1, 150000), []);
});

// CHANGED (edge notes): the mass ⇄ molar kDa caution is dropped, so Tris (121.14) is quiet.
test("mass ⇄ molar no longer flags small MWs; A280 keeps its kDa rule", () => {
  assert.deepEqual(C.massMolarCautions(66.463, 2), []);
  assert.deepEqual(C.massMolarCautions(121.14, 12), []);
  assert.deepEqual(C.massMolarCautions(150), []);
  assert.deepEqual(C.a280Cautions(1.4, 210000, 1, 150), [kda]);
  // A molar A280 result doesn't use the MW, so nothing is flagged.
  assert.deepEqual(C.a280Cautions(1.4, 210000, 1), []);
  assert.ok(C.cautionMessage(kda).includes("kDa"));
  // kDa slip needs a protein-sized ε too: MW 800 with ε 5500 is flagged, Tris-like MW with small ε is not.
  assert.deepEqual(C.a280Cautions(0.5, 5500, 1, 800), [kda]);
  assert.deepEqual(C.a280Cautions(0.5, 500, 1, 121.14), []);
});

test("mass extinction typed as molar is flagged", () => {
  assert.deepEqual(C.a280Cautions(0.5, 0.66, 1), [{ kind: "extinctionLooksLikeMassCoefficient" }]);
  assert.deepEqual(C.a280Cautions(0.5, 100, 1), []);
});

test("absorbance above two is outside the linear range", () => {
  assert.deepEqual(C.a280Cautions(2.5, 43824, 1), [{ kind: "absorbanceOutsideLinearRange" }]);
  assert.deepEqual(C.a280Cautions(2.0, 43824, 1), []);
});

test("zero or negative inputs are refused", () => {
  const mm = C.massMolarCautions(0, -1);
  assert.deepEqual(mm, [np("molecularWeight"), np("mass")]);
  assert.ok(mm.every(C.isRefusal));
  assert.deepEqual(C.a280Cautions(0, -5, 0), [np("absorbance"), np("extinctionCoefficient"), np("pathLength")]);
  assert.ok(!C.isRefusal({ kind: "absorbanceOutsideLinearRange" }));
});

// ---- model (state in, derived values out)
const base = { mode: "massMolar", mw: "", source: "mass", massRaw: "", molarRaw: "", massUnit: "mgPerML", molarUnit: "uM",
  absorbance: "", epsilon: "", pathLength: "1.0", a280Output: "molar", a280MolarUnit: "uM", a280MassUnit: "mgPerML" };
const st = (o) => Object.assign({}, base, o);

test("molarity stays the source after leaving the field", () => {
  let r = C.compute(st({ mw: "66463", massRaw: "2" }), ".");
  assert.equal(r.eyebrow, "Molarity");
  r = C.compute(st({ mw: "66463", massRaw: "2", molarRaw: "30.1234", source: "molar" }), ".");
  assert.equal(r.eyebrow, "Mass concentration");
  close(r.value, 30.1234e-6 * 66463, 1e-9);
});

test("small MW is no longer a caution in mass ⇄ molar; BSA in kDa computes and stays exact", () => {
  let r = C.compute(st({ mw: "66.463", massRaw: "2" }), ".");
  assert.deepEqual(r.cautions, []);
  assert.equal(r.status.kind, "exact");
  r = C.compute(st({ mw: "66463", massRaw: "2" }), ".");
  assert.equal(r.status.kind, "exact");
});

test("non-positive concentration is refused", () => {
  const r = C.compute(st({ mw: "66463", massRaw: "-2" }), ".");
  assert.equal(r.value, null);
  assert.equal(r.status.kind, "error");
  assert.equal(r.warnings[0].level, "error");
});

test("A280 cautions follow the typed fields", () => {
  let r = C.compute(st({ mode: "a280", absorbance: "2.6", epsilon: "0.66", pathLength: "1" }), ".");
  assert.deepEqual(r.cautions, [{ kind: "extinctionLooksLikeMassCoefficient" }, { kind: "absorbanceOutsideLinearRange" }]);
  assert.notEqual(r.value, null);
  assert.equal(r.status.kind, "approx");
  r = C.compute(st({ mode: "a280", absorbance: "0", epsilon: "0.66", pathLength: "1" }), ".");
  assert.equal(r.value, null);
  assert.equal(r.status.kind, "error");
});

test("A280 mass result needs an MW and prompts for it", () => {
  let r = C.compute(st({ mode: "a280", absorbance: "1.4", epsilon: "210000", a280Output: "mass" }), ".");
  assert.equal(r.value, null);
  assert.equal(r.status.kind, "info");
  r = C.compute(st({ mode: "a280", absorbance: "1.4", epsilon: "210000", a280Output: "mass", mw: "150000" }), ".");
  close(r.value, 1.0, 1e-9);
  assert.equal(r.valueText, "1.000");
  assert.equal(r.unit, "mg/mL");
});

// SPEC example through the screen: 2 mg/mL BSA → 30.09 µM (Format.number: 4 sig figs).
test("BSA through the screen", () => {
  const r = C.compute(st({ mw: "66463", massRaw: "2" }), ".");
  assert.equal(r.valueText, "30.09");
  assert.equal(r.unit, "µM");
  assert.equal(r.derivedText, "30.09");
});

// CHANGED (edge notes): clearing MW blanks the derived value instead of leaving a stale one.
test("clearing MW blanks the derived value", () => {
  const r = C.compute(st({ mw: "", massRaw: "2" }), ".");
  assert.equal(r.value, null);
  assert.equal(r.derivedText, "");
  assert.equal(r.status.kind, "info");
  const r2 = C.compute(st({ mw: "66463", massRaw: "" }), ".");
  assert.equal(r2.derivedText, "");
});

test("comma decimal marks read when the separator is a comma", () => {
  const r = C.compute(st({ mw: "66463", massRaw: "2,0" }), ",");
  assert.equal(r.valueText, "30.09");
});
