// Ported from Tests/CellTraceModelTests.swift and the CellTrace parts of Tests/ProtocolEngineTests.swift,
// plus the SPEC worked example (4 mL PBS / 4 µL dye).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../celltrace/engine.js");
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

const model = (o) => Object.assign({ densityText: "", volumeText: "", stainAmount: "total", cellsToStainText: "",
  stainOveragePercentText: "20", cellsPerWellText: "100000", wellsText: "24", recountDensityText: "", recountVolumeText: "",
  microlitersPerWellText: "200", excessPercentText: "10" }, o);

test("stain: 2e7 cells -> 4 mL PBS, 4 µL dye, quench to 24 mL (SPEC example)", () => {
  const p = C.stain(2e7);
  close(p.stainingML, 4, 1e-9);
  close(p.dyeUL, 4, 1e-9);
  assert.equal(p.vials, 1);
  close(p.quenchAddML, 20, 1e-9);
  close(p.quenchTotalML, 24, 1e-9);
  assert.equal(p.tube, "50 mL");
  assert.equal(C.stain(1.5e8).vials, 2);
});

test("stain tube sizes and refusals", () => {
  assert.equal(C.stain(1e7).tube, "15 mL"); // 2 mL x 6 = 12
  assert.equal(C.stain(1e8).tube, null); // 20 mL x 6 = 120
  assert.equal(C.stain(0), null);
  assert.equal(C.stain(-1), null);
  assert.equal(C.stain(1e7, C.settings({ dyeDilution: 1 })), null);
  assert.equal(C.stain(1e7, C.settings({ quenchVolumes: 0 })), null);
});

test("plate: 60 wells, 10% excess, from 2e6/mL", () => {
  const p = C.plate(2e6, 1e5, 200, 60, 0.1);
  close(p.density, 5e5, 1e-6);
  close(p.totalML, 13.2, 1e-9);
  close(p.suspensionML, 3.3, 1e-9);
  close(p.mediumML, 9.9, 1e-9);
  assert.equal(p.issue, null);
});

test("plate issues", () => {
  assert.equal(C.plate(1e5, 1e5, 200, 4, 0).issue.kind, "tooDilute");
  const short = C.plate(2e6, 1e5, 200, 60, 0.1, 2);
  assert.deepEqual(short.issue, { kind: "notEnoughCells", wells: 36 });
});

test("1 µL guardrail has slack and never fires on zero (edge notes P2)", () => {
  // 1 µL of suspension: 1e3 cells/uL... 2e5 cells per mL needed in 10 wells of 100 µL
  const exactly = C.plate(1e9, 1e6, 1000, 1, 0); // suspension = 1e6/1e9 = 1e-3 mL = 1 µL
  assert.equal(exactly.issue, null);
  const under = C.plate(1e10, 1e6, 1000, 1, 0); // 0.1 µL
  assert.deepEqual(under.issue, { kind: "subMicroliter" });
});

test("edge: absurd well counts are refused", () => {
  assert.equal(C.plate(2e6, 1e5, 200, 1e12, 0), null);
  assert.equal(C.wellCount("1e12"), null);
  assert.equal(C.wellCount("24.4"), 24);
  assert.equal(C.wellCount("0"), null);
  assert.equal(C.wellCount("0.4"), null);
});

test("cells to stain from wells: 1e5 x 24 x 1.2 = 2.88e6", () => {
  const m = model({ stainAmount: "wells" });
  close(C.cellsToStain(m), 2.88e6, 1);
  close(C.stainPlan(m, C.settings()).cells, 2.88e6, 1);
});

test("from wells edge cases: blank overage, zero wells", () => {
  const m = model({ stainAmount: "wells", cellsPerWellText: "50000", wellsText: "10", stainOveragePercentText: "" });
  close(C.cellsToStain(m), 5e5, 1);
  assert.equal(C.cellsToStain(model({ stainAmount: "wells", wellsText: "0" })), null);
});

test("total mode: the typed number, else every counted cell", () => {
  const m = model({ densityText: "2000000", volumeText: "5" });
  close(C.cellsToStain(m), 1e7, 1);
  close(C.cellsToStain(model({ densityText: "2000000", volumeText: "5", cellsToStainText: "3000000" })), 3e6, 1);
  assert.equal(C.cellsToStain(model()), null);
});

test("numbers read through BM.format.parse (grouping, refused commas)", () => {
  close(C.cellsToStain(model({ densityText: "2,000,000", volumeText: "5" })), 1e7, 1);
  assert.equal(C.cellsToStain(model({ densityText: "2,0", volumeText: "5" })), null);
});

test("old settings missing a field still decode", () => {
  const s = C.settingsFrom({ dmsoPerVialUL: 40, dyeDilution: 2000, stainingDensity: 1e6, stainMinutes: 15 });
  assert.equal(s.dmsoPerVialUL, 40);
  assert.equal(s.dyeDilution, 2000);
  assert.equal(s.stainingDensity, 1e6);
  assert.equal(s.stainMinutes, 15);
  assert.equal(s.quenchVolumes, C.STANDARD.quenchVolumes);
});

test("an unreadable value falls back for that field alone; round trip unchanged", () => {
  const s = C.settingsFrom(JSON.parse('{"dmsoPerVialUL":"lots","dyeDilution":500,"quenchVolumes":4}'));
  assert.equal(s.dmsoPerVialUL, C.STANDARD.dmsoPerVialUL);
  assert.equal(s.dyeDilution, 500);
  assert.equal(s.quenchVolumes, 4);
  const custom = C.settings({ stainMinutes: 12 });
  assert.deepEqual(C.settingsFrom(JSON.parse(JSON.stringify(custom))), custom);
  assert.ok(C.isStandard(C.settings()));
  assert.ok(!C.isStandard(custom));
});

test("plate plan from the model, with the recount volume flagging a short mix", () => {
  const m = model({ recountDensityText: "2000000", recountVolumeText: "2", wellsText: "60" });
  const p = C.platePlan(m);
  assert.deepEqual(p.issue, { kind: "notEnoughCells", wells: 36 });
  assert.equal(C.platePlan(model({ recountDensityText: "" })), null);
  close(C.recountCells(m), 4e6, 1);
});

test("result text and warnings", () => {
  const s = C.settings();
  const d = C.describeStain(C.stain(2e7), s);
  assert.equal(d.value, "4.000");
  assert.equal(d.unit, "mL PBS");
  assert.deepEqual(d.lines, ["+ 4.000 µL dye stock for 2.0 × 10⁷ cells", "1 vial at 20.00 µL DMSO each"]);
  const q = C.describeQuench(C.stain(2e7), s);
  assert.equal(q.value, "20.00");
  assert.equal(q.unit, "mL");
  assert.equal(q.line, "5 volumes on the 4.000 mL of cells: 24.00 mL in all.");
  assert.deepEqual(C.quenchWarnings(C.stain(1e8)).map(w => w.text), ["More than a 50 mL tube holds: split across tubes"]);
  assert.deepEqual(C.quenchWarnings(C.stain(2e7)), []);
  assert.deepEqual(C.stainWarnings(C.stain(2e7), 1e7, s).map(w => w.text), ["More cells than you counted (1.0 × 10⁷)"]);
  assert.equal(C.stainWarnings(null, null, C.settings({ dyeDilution: 1 }))[0].level, "error");
  const p = C.describePlate(C.plate(2e6, 1e5, 200, 60, 0.1), "200");
  assert.equal(p.value, "3.300");
  assert.deepEqual(p.lines, ["+ 9.900 mL medium → 13.20 mL at 5.0 × 10⁵ cells/mL", "200 µL per well, 6.6 × 10⁶ cells in all"]);
  assert.deepEqual(C.plateWarnings(C.plate(2e6, 1e5, 200, 60, 0.1, 2)).map(w => w.text), ["Enough cells for 36 wells"]);
  assert.deepEqual(C.plateWarnings(C.plate(2e6, 1e5, 200, 60, 0.1, 0.05)).map(w => w.text).length, 1);
  assert.deepEqual(C.plateWarnings(C.plate(1e5, 1e5, 200, 4, 0)).map(w => w.text), ["Thinner than the wells need: spin and resuspend smaller"]);
  assert.deepEqual(C.plateWarnings(C.plate(1e10, 1e6, 1000, 1, 0)).map(w => w.text), ["Under 1 µL of cells: make an intermediate dilution"]);
});

test("steps", () => {
  const p = C.stain(2e7), s = C.settings();
  assert.equal(C.stainSteps(p, s)[3].timer.minutes, 20);
  assert.equal(C.stainSteps(p, s)[0].amount, "4.000 µL");
  assert.equal(C.quenchSteps(p)[0].note, "In a 50 mL tube");
  assert.equal(C.prepSteps(s)[1].amount, "20.00 µL");
});
