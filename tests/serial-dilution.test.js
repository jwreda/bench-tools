// Ported from Tests/SerialDilutionEngineTests.swift (engine + model cases) and SPEC §3.
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const S = require("../serial-dilution/engine.js");
const U = BM.units;
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} ≉ ${b}`);
const fmt = (c, mode) => S.formatConcentration(c, mode);

test("worked example ladder: 1 mM, 1:10, 5 steps", () => {
  const tubes = S.ladder(U.molar.toBase("mM", 1), 10, 5);
  assert.equal(tubes.length, 5);
  assert.deepEqual(tubes.map(t => t.index), [1, 2, 3, 4, 5]);
  [1e-4, 1e-5, 1e-6, 1e-7, 1e-8].forEach((e, i) => close(tubes[i].concentration, e, 1e-14));
  close(U.molar.fromBase("uM", tubes[0].concentration), 100, 1e-9);
  close(U.molar.fromBase("uM", tubes[1].concentration), 10, 1e-9);
  close(U.molar.fromBase("uM", tubes[2].concentration), 1, 1e-9);
  close(U.molar.fromBase("nM", tubes[3].concentration), 100, 1e-6);
  close(U.molar.fromBase("nM", tubes[4].concentration), 10, 1e-6);
});

test("worked example diluent: 900 µL per tube, 4.5 mL total", () => {
  const vt = U.volume.toBase("uL", 100);
  const perTube = S.diluentPerTube(vt, 10);
  close(perTube, 9e-4, 1e-12);
  close(U.volume.fromBase("uL", perTube), 900, 1e-6);
  const p = S.plan(0.001, 10, 5, vt);
  close(p.totalDiluent, 4.5e-3, 1e-12);
  assert.equal(p.warnings.length, 0);
});

test("guardrail: factor <= 1 gives an empty plan", () => {
  for (const factor of [1, 0.5, 0, -10]) {
    const p = S.plan(0.001, factor, 3, 1e-4);
    assert.deepEqual(p.warnings, [{ kind: "invalidFactor" }], `factor ${factor}`);
    assert.equal(p.tubes.length, 0);
    assert.equal(p.diluentPerTube, 0);
    assert.equal(p.totalDiluent, 0);
    assert.equal(p.finalTubeVolume, 0);
  }
});

const base = () => ({
  mode: "molar", text: { c0: "1", factor: "10", transfer: "100" }, steps: 5,
  units: { molar: "mM", mass: "mgPerML", transfer: "uL" }
});
const calc = s => S.compute(s, ".");

test("model rejects factor at or below one, not unparseable", () => {
  for (const f of ["1", "0.5", "0"]) {
    const s = base(); s.text.factor = f;
    const r = calc(s);
    assert.equal(r.plan, null, f);
    assert.equal(r.factorTooLow, true, f);
    assert.equal(r.warnings[0].level, "error");
    assert.equal(r.warnings[0].text, "A serial dilution needs a factor above 1, e.g. 10 for 1:10.");
  }
  let s = base(); s.text.factor = "abc";
  assert.equal(calc(s).plan, null);
  assert.equal(calc(s).factorTooLow, false);
  s.text.factor = "1.5";
  assert.notEqual(calc(s).plan, null);
  assert.equal(calc(s).factorTooLow, false);
});

test("model parses with the shared parser; negative start is refused", () => {
  const s = base();
  s.text = { c0: " 1 ", factor: "10 ", transfer: " 100" };
  assert.notEqual(calc(s).plan, null);
  s.text.c0 = "-1";
  assert.equal(calc(s).plan, null);
});

test("guardrail: sub-microliter transfer volume", () => {
  const p = S.plan(0.001, 10, 3, 5e-7);
  assert.deepEqual(p.warnings, [{ kind: "subMicroliterTransferVolume", liters: 5e-7 }]);
  close(p.diluentPerTube, 4.5e-6, 1e-15);
  assert.equal(S.plan(0.001, 10, 3, 1e-6).warnings.length, 0); // 1 µL exactly is fine
});

test("1 µL guardrail tolerates float dust and never warns on zero (review P2)", () => {
  // 1 mM -> 10 µM in 100 µL style rounding: 9.999999999999997e-07 L is 1 µL.
  assert.equal(S.plan(0.001, 10, 3, 9.999999999999997e-7).warnings.length, 0);
  assert.equal(S.plan(0.001, 10, 3, 0).warnings.length, 0);
  assert.ok(S.plan(0.001, 10, 3, 9e-7).warnings.length > 0);
});

test("volume each tube ends with", () => {
  const vt = U.volume.toBase("uL", 100);
  const p = S.plan(0.001, 10, 5, vt);
  close(U.volume.fromBase("uL", p.volumePerTube), 900, 1e-9);
  close(U.volume.fromBase("uL", p.finalTubeVolume), 1000, 1e-9);
  assert.equal(p.transferVolume, vt);
  const r = calc(base());
  assert.equal(r.tubeText, "Each tube ends with 900.0 µL after passing 100.0 µL on; the final tube keeps 1.000 mL unless you discard 100.0 µL from it.");
  const one = base(); one.steps = 1;
  assert.equal(calc(one).tubeText, "The tube ends with 1.000 mL; discard 100.0 µL to leave 900.0 µL.");
});

test("guardrail: sub-microliter diluent per tube", () => {
  const p = S.plan(0.001, 2, 3, 1e-7);
  close(p.diluentPerTube, 1e-7, 1e-15);
  assert.ok(p.warnings.some(w => w.kind === "subMicroliterDiluentVolume"));
});

test("mass mode worked example: 10 mg/mL, 1:2, 6 steps, 50 µL", () => {
  const p = S.plan(U.massConc.toBase("mgPerML", 10), 2, 6, U.volume.toBase("uL", 50));
  assert.equal(p.tubes.length, 6);
  [5, 2.5, 1.25, 0.625, 0.3125, 0.15625].forEach((e, i) =>
    close(U.massConc.fromBase("mgPerML", p.tubes[i].concentration), e, 1e-12));
  close(U.volume.fromBase("uL", p.diluentPerTube), 50, 1e-9);
  close(U.volume.fromBase("uL", p.totalDiluent), 300, 1e-9);
  assert.equal(p.warnings.length, 0);
});

test("mass ladder display units step mg/mL -> µg/mL -> ng/mL", () => {
  const tubes = S.ladder(U.massConc.toBase("mgPerML", 1), 10, 6);
  const ids = tubes.map(t => U.massConc.best(t.concentration).id);
  assert.deepEqual(ids, ["ugPerML", "ugPerML", "ugPerML", "ngPerML", "ngPerML", "ngPerML"]);
  close(U.massConc.fromBase(ids[0], tubes[0].concentration), 100, 1e-9);
  close(U.massConc.fromBase(ids[3], tubes[3].concentration), 100, 1e-6);
  close(U.massConc.fromBase(ids[5], tubes[5].concentration), 1, 1e-6);
});

test("molar ladder display units; below 1 nM stays nM in the picker set", () => {
  const tubes = S.ladder(U.molar.toBase("mM", 1), 10, 8);
  const ids = tubes.map(t => U.molar.best(t.concentration).id);
  assert.deepEqual(ids, ["uM", "uM", "uM", "nM", "nM", "nM", "nM", "nM"]);
  close(U.molar.fromBase("nM", tubes[7].concentration), 0.01, 1e-9);
});

test("molar readout below nanomolar: nM -> pM -> fM -> scientific M", () => {
  const text = S.ladder(U.molar.toBase("mM", 1), 10, 24).map(t => fmt(t.concentration, "molar"));
  assert.equal(text[5], "1.000 nM");
  assert.equal(text[6], "100.0 pM");
  assert.equal(text[8], "1.000 pM");
  assert.equal(text[9], "100.0 fM");
  assert.equal(text[11], "1.000 fM");
  assert.equal(text[12], "1.0 × 10⁻¹⁶ M");
  assert.equal(text[23], "1.0 × 10⁻²⁷ M");
  assert.ok(!text.some(t => t.includes("nM") && t.includes("10⁻")));
});

test("mass readout below nanogram", () => {
  const text = S.ladder(U.massConc.toBase("mgPerML", 1), 10, 24).map(t => fmt(t.concentration, "mass"));
  assert.equal(text[5], "1.000 ng/mL");
  assert.equal(text[6], "100.0 pg/mL");
  assert.equal(text[8], "1.000 pg/mL");
  assert.equal(text[9], "100.0 fg/mL");
  assert.equal(text[11], "1.000 fg/mL");
  assert.equal(text[12], "1.0 × 10⁻¹³ mg/mL");
});

test("non-decade factor lands in the right sub-nM unit", () => {
  assert.equal(fmt(0.5e-9, "molar"), "500.0 pM");
  assert.equal(fmt(2.5e-13, "molar"), "250.0 fM");
  assert.equal(fmt(5e-4, "molar"), "500.0 µM");
});

test("switching modes never rescales the typed number", () => {
  const s = base();
  s.text = { c0: "10", factor: "2", transfer: "50" }; s.steps = 1;
  const molar = calc(s);
  close(molar.plan.tubes[0].concentration, 5e-3, 1e-15);
  assert.equal(molar.tubes[0].text, "5.000 mM");
  assert.equal(molar.concentrationUnitLabel, "mM");
  s.mode = "mass";
  const mass = calc(s);
  assert.equal(s.text.c0, "10");
  close(mass.plan.tubes[0].concentration, 5, 1e-12);
  assert.equal(mass.tubes[0].text, "5.000 mg/mL");
  assert.equal(mass.concentrationUnitLabel, "mg/mL");
});

test("step range caps ladder length; zero steps is empty", () => {
  assert.deepEqual(S.STEP_RANGE, { min: 1, max: 24 });
  assert.equal(S.ladder(1, 2, S.STEP_RANGE.max).length, 24);
  assert.equal(S.ladder(1, 10, 0).length, 0);
  assert.equal(S.clampSteps(500), 24);
  assert.equal(S.clampSteps(0), 1);
  assert.equal(S.clampSteps(null), 1);
  const s = base(); s.steps = 99;
  assert.equal(calc(s).plan.tubes.length, 24);
});

test("copy text and warnings travel together", () => {
  const r = calc(base());
  assert.equal(r.copyText.split("\n")[0], "Serial dilution: 1 mM, 1:10 per step, 5 steps, 100 µL transfer");
  assert.ok(r.copyText.includes("Tube 1: 100.0 µM"));
  assert.ok(r.copyText.includes("Diluent per tube: 900.0 µL"));
  assert.ok(r.copyText.includes("Total diluent: 4.500 mL"));
  const w = base(); w.text.transfer = "0.5";
  const rw = calc(w);
  assert.equal(rw.warnings.length, 1);
  assert.ok(rw.copyText.includes("is below ~1 µL"));
  assert.equal(rw.warnings[0].level, "warn");
});

test("hero total for the worked example", () => {
  assert.deepEqual(calc(base()).total, { value: "4.500", unit: "mL" });
});
