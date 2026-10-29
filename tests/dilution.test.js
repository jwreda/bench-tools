// Ported from Tests/DilutionEngineTests.swift and Tests/DilutionModelTests.swift.
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const D = require("../dilution/engine.js");
const U = BM.units;
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("worked example: 10 mM → 50 µM in 10 mL", () => {
  const r = D.solve(U.molar.toBase("mM", 10), null, U.molar.toBase("uM", 50), U.volume.toBase("mL", 10));
  close(r.v1, 5e-5, 1e-9);
  close(r.diluentVolume, 0.00995, 1e-9);
  assert.equal(r.warnings.length, 0);
});

test("solves each missing field", () => {
  close(D.solve(null, 1, 0.5, 2).c1, 1, 1e-12);
  close(D.solve(1, null, 0.5, 2).v1, 1, 1e-12);
  close(D.solve(1, 1, null, 2).c2, 0.5, 1e-12);
  close(D.solve(1, 1, 0.5, null).v2, 2, 1e-12);
});

test("rejects wrong null count and division by zero", () => {
  assert.equal(D.solve(1, 1, 1, 1), null);
  assert.equal(D.solve(null, null, 1, 1), null);
  assert.equal(D.solve(0, null, 1, 1), null);
  assert.equal(D.solve(1, 1, null, 0), null);
});

test("guardrails", () => {
  assert.ok(D.solve(1e-3, 1e-3, 5e-3, null).warnings.some(w => w.kind === "cannotDiluteUp"));
  const r = D.solve(1, null, 1e-4, 1e-5);
  close(r.v1, 1e-9, 1e-15);
  assert.ok(r.warnings.some(w => w.kind === "subMicroliterStock"));
});

const base = () => ({
  mode: "molar", solvingFor: "v1",
  text: { c1: "10", v1: "", c2: "50", v2: "10" },
  units: { c1: "mM", c2: "uM", v1: "uL", v2: "mL" }, mw: ""
});

test("molar mode default", () => {
  const r = D.compute(base(), ".");
  assert.equal(r.solvedText, "50.00");
  assert.equal(r.unitLabel("c1"), "mM");
  assert.equal(r.recipe, "Take 50.00 µL stock + 9.950 mL diluent → 10.00 mL");
});

test("mixed: 1 mg/mL BSA to 1 µM in 10 mL needs 664.6 µL", () => {
  const s = { mode: "mixed", solvingFor: "v1", text: { c1: "1", v1: "", c2: "1", v2: "10" },
    units: { c1: "mgPerML", c2: "uM", v1: "uL", v2: "mL" }, mw: "" };
  let r = D.compute(s, ".");
  assert.ok(r.missingMW);
  assert.equal(r.solution, null);
  s.mw = "66463";
  r = D.compute(s, ".");
  close(r.solution.v1 * 1e6, 664.63, 0.01);
  assert.equal(r.solvedText, "664.6");
  assert.equal(r.conversions.length, 2);
});

test("mixed solves a concentration in its own unit", () => {
  const s = { mode: "mixed", solvingFor: "c2", text: { c1: "10", v1: "10", c2: "", v2: "1" },
    units: { c1: "mM", c2: "ugPerML", v1: "uL", v2: "mL" }, mw: "100" };
  const r = D.compute(s, ".");
  assert.equal(r.solvedText, "10.00");
  assert.equal(r.unitLabel("c2"), "µg/mL");
});

test("mixed with one basis needs no MW", () => {
  const s = base(); s.mode = "mixed";
  const r = D.compute(s, ".");
  assert.equal(r.needsMW, false);
  assert.equal(r.solvedText, "50.00");
  assert.equal(r.conversions.length, 0);
});

test("solveFor carries full precision", () => {
  let s = base();
  s.text = { c1: "3", v1: "", c2: "1", v2: "10" };
  assert.equal(D.compute(s, ".").solvedText, "3.333");
  s = D.solveFor(s, "c2", ".");
  assert.equal(s.text.v1, BM.format.editable(10 / 3, 6, "."));
  let r = D.compute(s, ".");
  assert.equal(r.solvedText, "1.000");
  close(r.solution.c2, 1e-6, 1e-15);
  s = D.solveFor(s, "v1", ".");
  close(D.compute(s, ".").solution.v1, 1e-5 / 3, 1e-15);
  s = D.solveFor(s, "c2", ".");
  s.text.v1 = "5";
  close(D.compute(s, ".").solution.c2, 1.5e-6, 1e-15);
});

test("solveFor never seeds scientific notation", () => {
  let s = base(); s.units.v1 = "L";
  assert.ok(D.compute(s, ".").solvedText.includes("×"));
  s = D.solveFor(s, "c2", ".");
  assert.ok(!s.text.v1.includes("×"));
  const r = D.compute(s, ".");
  close(r.solution.c2, 50e-6, 1e-15);
  assert.equal(r.solvedText, "50.00");
});

test("stock larger than final is an error", () => {
  const s = base(); s.solvingFor = "c2"; s.text = { c1: "10", v1: "20", c2: "", v2: "10" }; s.units.v1 = "mL";
  const r = D.compute(s, ".");
  assert.equal(r.status, "error");
});

test("1 µL guardrail: exactly 1 µL and zero don't warn", () => {
  // 1 mM → 10 µM in 100 µL = 1 µL of stock (float lands a hair under).
  const r = D.solve(1e-3, null, 1e-5, 100e-6);
  assert.ok(!r.warnings.some(w => w.kind === "subMicroliterStock"));
  const z = D.solve(1, 0, null, 1e-3);
  assert.ok(!z.warnings.some(w => w.kind === "subMicroliterStock"));
});
