// Ported from Tests/ProtocolEngineTests.swift (EasySepEngineTests, EasySepScheduleTests,
// EasySepLiveRunTests) plus the derived values of EasySepModel.
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const E = require("../magnetic-sort/engine.js");
const S = require("../magnetic-sort/steps.js");
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

const cd8 = E.kit("19853"), cd4 = E.kit("19852");

test("kit doses match the sheets", () => {
  assert.deepEqual(cd8.reagents.map(r => r.microlitersPerML), [20, 50, 125]);
  assert.deepEqual(cd8.reagents.map(r => r.incubationMinutes).filter(m => m != null), [10, 5]);
  assert.deepEqual(cd4.reagents.map(r => r.microlitersPerML), [20, 50, 75]);
  assert.deepEqual(cd4.reagents.map(r => r.incubationMinutes).filter(m => m != null), [10, 2.5]);
  const naive = E.kit("19765");
  assert.deepEqual(naive.reagents.map(r => r.microlitersPerML), [10, 50, 50, 75]);
  assert.deepEqual(naive.reagents.map(r => r.incubationMinutes).filter(m => m != null), [7.5, 2.5, 2.5]);
  assert.deepEqual(naive.rangeEasySep, [0.1, 2]);
});

test("concentrate: 3 mL at 2e7 -> 0.6 mL", () => {
  const p = E.resuspension(2e7, 3, "concentrate");
  close(p.cells, 6e7, 1);
  close(p.sampleML, 0.6, 1e-9);
  assert.equal(p.diluentML, null);
  assert.equal(p.issue, null);
});

test("dilute portion: 0.4 mL + 0.6 mL buffer; short of cells", () => {
  const p = E.resuspension(2.5e8, 1, "dilutePortion", 1);
  close(p.suspensionML, 0.4, 1e-9);
  close(p.diluentML, 0.6, 1e-9);
  assert.equal(p.issue, null);
  const short = E.resuspension(2.5e8, 1, "dilutePortion", 3);
  assert.equal(short.issue.kind, "notEnoughCells");
  close(short.issue.neededML, 1.2, 1e-9);
});

test("dilute all: 0.5 mL at 3e8 -> 1.5 mL, add 1 mL; too thin", () => {
  const p = E.resuspension(3e8, 0.5, "diluteAll");
  close(p.sampleML, 1.5, 1e-9);
  close(p.diluentML, 1, 1e-9);
  assert.equal(E.resuspension(5e7, 1, "diluteAll").issue.kind, "tooDiluteToDilute");
});

test("rejects non-positive input", () => {
  assert.equal(E.resuspension(0, 1, "concentrate"), null);
  assert.equal(E.resuspension(1e8, 0, "concentrate"), null);
  assert.equal(E.resuspension(1e8, 1, "dilutePortion", null), null);
  assert.equal(E.resuspension(1e8, 1, "dilutePortion", 0), null);
  assert.equal(E.resuspension(1e8, 1, "concentrate").issue.kind, "alreadyConcentrated");
});

test("separation scales reagents: 1.5 mL CD8 in the 5 mL magnet", () => {
  const p = E.separation(cd8, "easySep", 1.5);
  assert.equal(p.tubes, 1);
  assert.deepEqual(p.lines.map(l => l.perTubeUL), [30, 75, 187.5]);
  assert.equal(p.topUpToML, 2.5);
  close(p.topUpAddML, 2.5 - 1.5 - 0.2925, 1e-9);
  assert.equal(p.issue, null);
});

test("separation splits 5 mL CD4 across three tubes", () => {
  const p = E.separation(cd4, "easySep", 5);
  assert.equal(p.tubes, 3);
  close(p.perTubeML, 5 / 3, 1e-9);
  assert.deepEqual(p.issue, { kind: "split", tubes: 3 });
  close(p.lines[2].totalUL, 375, 1e-9);
  assert.equal(E.separation(cd4, "easySep", 2).tubes, 1); // exactly the upper bound
});

test("Big Easy top up and below-range", () => {
  assert.equal(E.topUpVolume("bigEasy", 3.9), 5);
  assert.equal(E.topUpVolume("bigEasy", 4), 10);
  assert.deepEqual(E.separation(cd8, "easySep", 0.2).issue, { kind: "belowRange", minML: 0.25 });
});

test("edge: absurd or invalid samples are refused, not trapped", () => {
  assert.equal(E.separation(cd8, "easySep", 1e12), null);
  assert.equal(E.separation(cd8, "easySep", Infinity), null);
  assert.equal(E.separation(cd8, "easySep", 0), null);
  assert.equal(E.separation(cd8, "easySep", NaN), null);
});

// ---- schedule
const A8 = E.actions(cd8, "easySep"), A4 = E.actions(cd4, "easySep");

test("actions merge FcR with the cocktail", () => {
  assert.deepEqual(A8.map(a => a.id), ["cocktail", "spheres", "magnet", "pour"]);
  assert.deepEqual(A8[0].reagents.map(r => r.id), ["fcr", "cocktail"]);
  assert.deepEqual(A8.map(a => a.wait), [600, 300, 150, 0]);
  const naive = E.actions(E.kit("19765"), "easySep");
  assert.deepEqual(naive.map(a => a.id), ["cocktail", "depletion", "spheres", "magnet", "pour"]);
});

function assertNoClash(s) {
  s.actions.forEach((x, i) => s.actions.slice(i + 1).forEach(y => {
    assert.ok(Math.abs(x.at - y.at) >= 60 - 1e-9, `${x.id} vs ${y.id}`);
  }));
}

test("two magnets stagger by one action", () => {
  const s = E.schedule(A8, A4, 60, 2);
  assert.deepEqual(s.starts, [0, 60]);
  assertNoClash(s);
});

test("one magnet keeps the magnet stands apart", () => {
  const s = E.schedule(A8, A4, 60, 1);
  assertNoClash(s);
  const spans = [0, 1].map(sample => {
    const mine = s.actions.filter(a => a.sample === sample);
    const start = mine.find(a => a.action.kind === "topUpAndMagnet").at;
    return [start, mine.find(a => a.action.kind === "pourOff").at + 60];
  });
  assert.ok(!(spans[0][0] < spans[1][1] && spans[1][0] < spans[0][1]));
  assert.ok(s.end < (21.5 + 18) * 60);
  assert.equal(Math.min(...s.starts), 0);
});

test("schedule needs actions and positive handling", () => {
  assert.equal(E.schedule([], A4), null);
  assert.equal(E.schedule(A8, A4, 0), null);
});

// ---- live run
const t0 = 800000000;
function live(magnets = 1, done = {}) {
  const s = E.schedule(A8, A4, 60, magnets);
  const d = {};
  Object.keys(done).forEach(k => { d[k] = t0 + done[k]; });
  return E.liveRun(s, t0, 60, magnets, d);
}

test("on-time run matches the plan", () => {
  const base = live();
  const first = base.schedule.actions[0];
  const done = {};
  base.schedule.actions.forEach(a => { done[a.id] = a.at + 60; });
  const r = live(1, done);
  r.schedule.actions.filter(a => a.id !== first.id).forEach(a => close(r.due(a, t0) - t0, a.at, 1e-6));
});

test("a late step keeps the full incubation", () => {
  const r0 = live();
  const spheres = r0.schedule.actions.find(a => a.action.id === "spheres" && a.sample === 1);
  const magnet = r0.schedule.actions.find(a => a.action.id === "magnet" && a.sample === 1);
  const done = {};
  r0.schedule.actions.filter(a => a.at < spheres.at).forEach(a => { done[a.id] = a.at + 60; });
  done[spheres.id] = spheres.at + 60 + 120;
  const r = live(1, done);
  const doneAt = t0 + done[spheres.id];
  close(r.due(magnet, doneAt) - doneAt, spheres.action.wait, 1e-6);
  close(r.behind(magnet, doneAt), 120, 1e-6);
  assert.ok(r.isTimed(magnet));
});

test("an untapped step is projected from now", () => {
  const r = live();
  const first = r.schedule.actions[0];
  const second = r.schedule.actions.find(a => a.sample === first.sample && a.at > first.at);
  assert.ok(!r.isTimed(second));
  const now = t0 + 300;
  close(r.due(second, now) - now, 60 + first.action.wait, 1e-6);
  assert.deepEqual(r.ready(now).map(a => a.id), [first.id]);
});

test("the second sort's start follows the first sort", () => {
  const r0 = live(2);
  const later = r0.schedule.starts[1] > r0.schedule.starts[0] ? 1 : 0;
  const laterStart = r0.schedule.actions.find(a => a.sample === later);
  const anchor = r0.anchor(laterStart);
  assert.notEqual(anchor.sample, laterStart.sample);
  const r = live(2, { [anchor.id]: anchor.at + 60 + 90 });
  const now = t0 + anchor.at + 150;
  close(r.behind(laterStart, now), 90, 1e-6);
});

test("one magnet is busy until the other pours off", () => {
  const r0 = live(1);
  const mags = r0.schedule.actions.filter(a => a.action.kind === "topUpAndMagnet");
  const firstIn = mags.reduce((a, b) => (b.at < a.at ? b : a));
  const secondIn = mags.reduce((a, b) => (b.at > a.at ? b : a));
  const done = {};
  r0.schedule.actions.filter(a => a.at <= firstIn.at).forEach(a => { done[a.id] = a.at + 60; });
  const r = live(1, done);
  const now = t0 + firstIn.at + 60;
  assert.notEqual(r.magnetFree(secondIn, now), null);
  assert.equal(r.magnetFree(firstIn, now), null);
});

test("tapping early never shortens the wait", () => {
  const r0 = live();
  const first = r0.schedule.actions[0];
  const r = live(1, { [first.id]: 10 });
  const next = r.schedule.actions.find(a => a.sample === first.sample && a.at > first.at);
  close(r.due(next, t0) - (t0 + 10), first.action.wait, 1e-6);
});

// ---- model values
const draft = (o) => Object.assign({ kitID: "19853", densityText: "", volumeText: "", mode: "concentrate", portionText: "1",
  sampleText: null, isolatedDensityText: "", isolatedVolumeText: "" }, o);

test("sample draft follows the Cells plan, or its own volume", () => {
  const s = E.sampleOf(draft({ densityText: "2e7", volumeText: "3" }), "easySep");
  close(s.sampleML, 0.6, 1e-9);
  close(s.inputCells, 6e7, 1);
  assert.deepEqual(s.separation.lines.map(l => l.perTubeUL).map(v => +v.toFixed(6)), [12, 30, 75]);
  const own = E.sampleOf(draft({ densityText: "2e7", volumeText: "3", sampleText: "1,5".replace(",", ".") }), "easySep");
  close(own.sampleML, 1.5, 1e-9);
});

test("a plan that can't be made gives no sample", () => {
  const thin = E.sampleOf(draft({ densityText: "5e7", volumeText: "1", mode: "diluteAll" }), "easySep");
  assert.equal(thin.plannedSampleML, null);
  assert.equal(thin.sampleML, null);
  const already = E.sampleOf(draft({ densityText: "2e8", volumeText: "1", mode: "concentrate" }), "easySep");
  close(already.plannedSampleML, 2, 1e-9);
});

test("suggestMode", () => {
  assert.equal(E.suggestMode("diluteAll", 5e7), "concentrate");
  assert.equal(E.suggestMode("dilutePortion", 5e7), "concentrate");
  assert.equal(E.suggestMode("concentrate", 2e8), "diluteAll");
  assert.equal(E.suggestMode("dilutePortion", 2e8), "dilutePortion");
  assert.equal(E.suggestMode("diluteAll", null), "diluteAll");
});

test("numbers go through BM.format.parse", () => {
  assert.equal(E.number("1,000,000"), 1e6);
  assert.equal(E.number(" 2.5 "), 2.5);
  assert.equal(E.number("0"), null);
  assert.equal(E.number("-1"), null);
  assert.equal(E.number("abc"), null);
  assert.equal(E.number(""), null);
});

test("yield and recovery", () => {
  const s = E.sampleOf(draft({ densityText: "2e7", volumeText: "3", isolatedDensityText: "1e7", isolatedVolumeText: "3" }), "easySep");
  close(s.isolatedCells, 3e7, 1);
  close(s.recoveryPercent, 50, 1e-9);
});

test("Cells card text", () => {
  const p = E.resuspension(2e7, 3, "concentrate");
  const c = E.describeResuspension(p, cd8, "easySep");
  assert.equal(c.eyebrow, "Resuspend to");
  assert.equal(c.value, "600.0");
  assert.equal(c.unit, "µL final");
  assert.equal(c.lines[1], "6.0 × 10⁷ cells at 1 × 10⁸/mL.");
  const portion = E.describeResuspension(E.resuspension(2.5e8, 1, "dilutePortion", 1), cd8, "easySep");
  assert.equal(portion.eyebrow, "Take");
  assert.equal(portion.value, "400.0");
  assert.equal(portion.lines[0], "+ 600.0 µL medium → 1.000 mL at 1 × 10⁸/mL (1.0 × 10⁸ cells).");
});

test("warnings: thin, concentrated, short, below range, split", () => {
  const w = (plan, k = cd8, m = "easySep") => E.describeResuspension(plan, k, m).warnings.map(x => x.text);
  assert.deepEqual(w(E.resuspension(5e7, 1, "diluteAll")), ["Thinner than 1 × 10⁸/mL: spin down instead"]);
  assert.deepEqual(w(E.resuspension(2e8, 1, "concentrate")), ["Already at 1 × 10⁸/mL or more: diluting is simpler"]);
  assert.deepEqual(w(E.resuspension(2.5e8, 1, "dilutePortion", 3)), ["Needs 1.200 mL of suspension; you have less"]);
  // 0.2 mL sample is below the 0.25 mL minimum
  assert.deepEqual(w(E.resuspension(1e8, 0.2, "concentrate")).slice(-1), ["Below the EasySep magnet's 250.0 µL minimum for this kit."]);
  const split = E.describeResuspension(E.resuspension(1e8, 5, "concentrate"), cd4, "easySep");
  assert.ok(split.lines.some(l => l.startsWith("More than one EasySep tube holds: split into 3 tubes of 1.667 mL")));
  assert.equal(E.splitNote(E.separation(cd4, "easySep", 5)), "Split into 3 tubes of 1.667 mL; amounts are per tube.");
  assert.deepEqual(E.separationWarnings(E.separation(cd8, "bigEasy", 0.2)).map(x => x.text),
    ["Below the 500.0 µL minimum for this kit in the Big Easy magnet."]);
});

test("reagent table and steps (worked example: 1.5 mL, CD8 kit)", () => {
  const sep = E.separation(cd8, "easySep", 1.5);
  const rows = E.reagentRows(sep);
  assert.deepEqual(rows.map(r => r.amount), ["30.00 µL", "75.00 µL", "187.5 µL", "+ 707.5 µL"]);
  assert.equal(rows[1].dose, "50 µL/mL × 1.500 mL");
  assert.equal(rows[1].note, "then 10 min at RT");
  assert.equal(rows[3].note, "to 2.5 mL with medium");
  const steps = E.singleSteps(sep, "CD8");
  assert.deepEqual(steps.map(s => s.id), ["sample", "fcr", "cocktail", "spheres", "topup", "magnet", "pour"]);
  assert.equal(steps.find(s => s.id === "spheres").timer.minutes, 5);
  assert.equal(steps.find(s => s.id === "magnet").timer.minutes, 2.5);
  assert.equal(steps.find(s => s.id === "fcr").timer, null);
});

test("amounts text for the parallel steps", () => {
  const sep = E.separation(cd8, "easySep", 1.5);
  const s = E.schedule(A8, A4, 60, 1);
  const a = s.actions.find(x => x.id === "0.cocktail");
  assert.equal(E.amountsText(a, sep), "30.00 µL + 75.00 µL, then 10 min");
  const m = s.actions.find(x => x.id === "0.magnet");
  assert.equal(E.amountsText(m, sep), "+ 707.5 µL medium to 2.5 mL, mix, then 2.5 min");
});

test("clock rounds up to m:ss", () => {
  assert.equal(S.clock(0), "0:00");
  assert.equal(S.clock(59.1), "1:00");
  assert.equal(S.clock(150), "2:30");
  assert.equal(S.clock(600), "10:00");
  assert.equal(S.clock(-5), "0:00");
  assert.equal(S.clock(Infinity), "0:00");
});

test("timer state", () => {
  S.startTimer("t", 1, 1000);
  assert.equal(S.timerState("t", 1000).state, "running");
  assert.equal(S.timerState("t", 61000).state, "done");
  S.resetTimer("t");
  assert.equal(S.timerState("t", 1000).state, "idle");
});
