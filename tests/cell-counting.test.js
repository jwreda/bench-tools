// Ported from Tests/CellCountingEngineTests.swift (engine + CellCountingModelTests) and the
// SPEC.md module 4 worked example.
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const C = require("../cell-counting/engine.js");
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const SEP = ".";

test("hemocytometer density", () => {
  close(C.density(50, 2), 1000000, 1e-6);
});

test("SPEC worked example: 2e6 stock, 1e5 cells/mL in 10 mL", () => {
  const cells = C.cellsNeededByVolume(1e5, 10);
  close(cells, 1000000, 1e-6);
  const r = C.seedingPlan(2e6, cells, 10);
  assert.ok(r.ok);
  close(r.plan.stockVolume, 0.5, 1e-9);
  close(r.plan.mediaVolume, 9.5, 1e-9);
  assert.equal(r.plan.warnings.length, 0);
});

test("quadrant summary averages only counted squares", () => {
  const s = C.summarizeSquares([
    { live: 90, dead: 10 }, { live: 110, dead: 10 }, { live: null, dead: null }, { live: 100, dead: null }
  ], 2);
  assert.equal(s.squaresCounted, 3);
  close(s.averageLive, 100, 1e-9);
  close(s.averageDead, 20 / 3, 1e-9);
  close(s.averageTotal, 320 / 3, 1e-9);
  close(s.viability, 300 / 320, 1e-9);
  close(s.viableDensity, 100 * 2 * 1e4, 1e-6);
  close(s.totalDensity, (320 / 3) * 2 * 1e4, 1e-6);
});

test("quadrant summary is null without counts; viability null with zero cells", () => {
  assert.equal(C.summarizeSquares([{}, {}].map(() => ({ live: null, dead: null })), 1), null);
  assert.equal(C.summarizeSquares([{ live: 5, dead: 5 }], 0), null);
  const zero = C.summarizeSquares([{ live: 0, dead: 0 }], 1);
  assert.notEqual(zero, null);
  assert.equal(zero.viability, null);
});

test("manual average with viability", () => {
  const s = C.summarizeAverage(200, 0.9, 1);
  close(s.totalDensity, 2e6, 1e-6);
  close(s.viableDensity, 1.8e6, 1e-6);
  close(s.averageDead, 20, 1e-9);
  const n = C.summarizeAverage(200, null, 1);
  close(n.viableDensity, 2e6, 1e-6);
  assert.equal(n.viability, null);
});

test("cells needed from an area target", () => {
  close(C.cellsNeededByArea(1e4, C.vessel("well6").areaCm2), 96000, 1e-3);
});

test("growth vessel reference table", () => {
  const areas = { well6: 9.6, well12: 3.8, well24: 1.9, well48: 0.95, well96: 0.32, t25: 25, t75: 75, t175: 175, t225: 225 };
  Object.keys(areas).forEach((id) => assert.equal(C.vessel(id).areaCm2, areas[id]));
  assert.equal(C.VESSELS.length, 9);
  assert.equal(C.vessel("well96").noun, "well");
  assert.equal(C.vessel("t75").noun, "flask");
});

test("guardrail: sub-microliter stock volume", () => {
  const r = C.seedingPlan(1e10, 1000, 10);
  assert.ok(r.ok);
  assert.ok(r.plan.warnings.some((w) => w.kind === "subMicroliterStockVolume"));
});

test("guardrail: exactly 1 µL (float) and zero don't warn (edge note P2)", () => {
  // 1e-3 mL of stock: 1 cell... pick numbers that land a hair under 1e-3 in floating point.
  const r = C.seedingPlan(1e6, 1000 * (1 - 1e-12), 10);
  assert.ok(r.ok);
  assert.equal(r.plan.warnings.length, 0);
  const zero = C.seedingPlan(1e6, 0, 10);
  assert.ok(zero.ok);
  assert.equal(zero.plan.warnings.length, 0);
});

test("stock too dilute fails without a recipe", () => {
  const r = C.seedingPlan(1e4, 1e6, 10);
  assert.equal(r.ok, false);
  assert.equal(r.failure.kind, "stockTooDilute");
  close(r.failure.neededML, 100, 1e-6);
});

test("undiluted stock is still a recipe", () => {
  const r = C.seedingPlan(1e5, 1e6, 10);
  assert.ok(r.ok);
  close(r.plan.stockVolume, 10, 1e-12);
  close(r.plan.mediaVolume, 0, 1e-12);
});

test("viability outside 0…1 has no summary", () => {
  assert.equal(C.summarizeAverage(100, 1.2, 2), null);
  assert.equal(C.summarizeAverage(100, -0.1, 2), null);
  assert.notEqual(C.summarizeAverage(100, 1, 2), null);
  assert.notEqual(C.summarizeAverage(100, 0, 2), null);
});

test("count plausibility range", () => {
  assert.deepEqual(C.countWarnings(9.5), [{ kind: "tooFewCells", averagePerSquare: 9.5 }]);
  assert.deepEqual(C.countWarnings(10), []);
  assert.deepEqual(C.countWarnings(300), []);
  assert.deepEqual(C.countWarnings(301), [{ kind: "tooManyCells", averagePerSquare: 301 }]);
});

// ---- CellCountingModelTests: the model's defaults and derived values.

function model(over) {
  return Object.assign({
    mode: "squares", stain: "trypanBlue", squares: [{ live: "", dead: "" }, { live: "", dead: "" }, { live: "", dead: "" }, { live: "", dead: "" }],
    average: "100", viability: "", counter: "", dilution: "2",
    source: "measured", manualStock: "", targetMode: "densityVolume",
    targetDensity: "100000", targetPerCm2: "", vessel: "well6", volume: "10", vesselCount: "1"
  }, over);
}
const run = (s) => C.compute(s, SEP);

test("model: SPEC worked example with explicit factor", () => {
  const r = run(model({ mode: "average", average: "200", dilution: "1" }));
  close(r.count.summary.viableDensity, 2e6, 1e-6);
  close(r.seeding.result.plan.stockVolume, 0.5, 1e-12);
  close(r.seeding.result.plan.mediaVolume, 9.5, 1e-12);
});

test("model: trypan blue defaults to factor 2, default average gives 2e6", () => {
  assert.equal(C.STAINS.trypanBlue.mixFactor, 2);
  close(run(model({ mode: "average" })).count.summary.viableDensity, 2e6, 1e-6);
});

test("model: stain sets the factor unless one is typed", () => {
  const f = C.factorTextAfterStainChange;
  assert.equal(f("trypanBlue", "unstained", "2", SEP), "1");
  assert.equal(f("unstained", "aoPI", "1", SEP), "2");
  assert.equal(f("aoPI", "trypanBlue", "", SEP), "2");
  assert.equal(f("trypanBlue", "unstained", "10", SEP), "10");
  assert.equal(f("unstained", "trypanBlue", "10", SEP), "10");
});

test("model: viability over 100 is an error, not clamped", () => {
  let r = run(model({ mode: "average", viability: "920" }));
  assert.equal(r.count.viabilityInvalid, true);
  assert.equal(r.count.summary, null);
  assert.equal(r.seeding.result, null);
  assert.equal(r.densityWarnings[0].level, "error");

  r = run(model({ mode: "counter", viability: "920", counter: "2400000" }));
  assert.equal(r.count.summary, null);

  r = run(model({ mode: "counter", viability: "92", counter: "2400000" }));
  assert.equal(r.count.viabilityInvalid, false);
  assert.notEqual(r.count.summary, null);

  // Squares mode works viability out from the counts, so a stray typed figure is ignored.
  r = run(model({ mode: "squares", viability: "920" }));
  assert.equal(r.count.viabilityInvalid, false);
});

test("model: count warnings only for hemocytometer counts", () => {
  let r = run(model({ mode: "average", average: "400" }));
  assert.deepEqual(r.count.warnings, [{ kind: "tooManyCells", averagePerSquare: 400 }]);
  r = run(model({ mode: "counter", counter: "50000" }));
  assert.notEqual(r.count.summary, null);
  assert.deepEqual(r.count.warnings, []);
});

test("model: counter with viability backs out the total", () => {
  const r = run(model({ mode: "counter", counter: "2400000", viability: "80" }));
  close(r.count.summary.viableDensity, 2.4e6, 1e-3);
  close(r.count.summary.totalDensity, 3e6, 1e-3);
  assert.equal(run(model({ mode: "counter", counter: "2400000", viability: "0" })).count.summary, null);
});

test("model: too dilute stock is a failure", () => {
  const r = run(model({ source: "manual", manualStock: "50000" }));
  assert.equal(r.seeding.result.ok, false);
  close(r.seeding.result.failure.neededML, 20, 1e-9);
  assert.equal(r.seedingWarnings[0].level, "error");
  assert.match(r.seedingWarnings[0].text, /^Stock too dilute: this needs 20\.00 mL of stock, more than the 10\.00 mL total\./);
});

test("model: area target scales with vessel count", () => {
  const s = model({ source: "manual", manualStock: "1000000", targetMode: "densityArea", targetPerCm2: "10000", vessel: "well6", volume: "2", vesselCount: "6" });
  let r = run(s);
  assert.equal(r.seeding.totalPlatingVolume, 12);
  const plan = r.seeding.result.plan;
  close(plan.cellsNeeded, 9.6e4 * 6, 1e-6);
  close(plan.stockVolume, 0.576, 1e-12);
  close(plan.stockVolume + plan.mediaVolume, 12, 1e-12);
  assert.equal(C.vesselSplitText(s, plan, 6), "Per well of a 6-well plate: 2.000 mL, 9.6 × 10⁴ cells (mixed for 6 wells)");

  r = run(Object.assign({}, s, { vesselCount: "2.5" }));
  assert.equal(r.seeding.vesselsSeeded, null);
  assert.equal(r.seeding.result, null);
  r = run(Object.assign({}, s, { vesselCount: "0" }));
  assert.equal(r.seeding.result, null);
  // Absurd counts are refused rather than trapping.
  assert.equal(run(Object.assign({}, s, { vesselCount: "1e12" })).seeding.result, null);

  // Density × Volume ignores the vessel count: the plating volume is the total.
  r = run(Object.assign({}, s, { targetMode: "densityVolume" }));
  assert.equal(r.seeding.vesselsSeeded, 1);
  assert.equal(r.seeding.totalPlatingVolume, 2);
});

test("model: fields use the shared parser", () => {
  let r = run(model({ mode: "average", average: " 100 ", dilution: "abc" }));
  assert.equal(r.count.summary, null);
  r = run(model({ mode: "average", average: " 100 ", dilution: "2" }));
  assert.notEqual(r.count.summary, null);
  // Comma decimal marks read as decimals where the locale uses them.
  const c = C.count(model({ mode: "average", average: "12,5", dilution: "1" }), ",");
  close(c.summary.averageTotal, 12.5, 1e-12);
});

test("model: copy text carries the lines and every warning", () => {
  const r = run(model({ mode: "average", average: "400", viability: "90" }));
  assert.match(r.copyText, /^Cell density: 7\.2 × 10⁶ cells\/mL viable \(90\.00% viability, 8\.0 × 10⁶ cells\/mL total\) — avg 400\.0 cells\/square, dilution ×2, 1 large square = 0\.1 µL, Trypan blue/);
  assert.match(r.copyText, /⚠ 400\.0 cells per square: too crowded/);
});

test("display: densityLines and dilution text", () => {
  const s = model({ mode: "squares", squares: [{ live: "90", dead: "10" }, { live: "110", dead: "10" }, { live: "", dead: "" }, { live: "100", dead: "" }] });
  const r = run(s);
  const lines = C.densityLines(s, r.count, SEP);
  assert.equal(lines[1], "Average of 3 squares: 100.0 live + 6.667 dead per square");
  assert.equal(lines[2], "Dilution factor ×2 (trypan blue mixed 1:1)");
  assert.equal(lines[3], C.CHAMBER_NOTE);
  assert.equal(C.dilutionText(10, "trypanBlue"), "Dilution factor ×10");
  assert.equal(C.dilutionText(1, "unstained"), "Dilution factor ×1");
  assert.equal(C.formatArea(9.6), "9.6");
  assert.equal(C.formatArea(25), "25");
  assert.equal(C.formatArea(0.95), "0.95");
});

test("SPEC: hemocytometer example reads 2×10⁶ cells/mL", () => {
  const s = model({ mode: "average", average: "100" });
  assert.equal(BM.format.scientific(run(s).count.summary.viableDensity), "2.0 × 10⁶");
});
