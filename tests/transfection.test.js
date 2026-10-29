// Ported from Tests/TransfectionEngineTests.swift, TransfectionBatchTests.swift, TransfectionRunTests.swift,
// TransfectionModelTests.swift and TransfectionBatchModelTests.swift, plus the SPEC worked examples.
// Left out: persistence/debounce, JSON decoding, the incubation timer and Live Activity, Markdown/CSV
// exports (not on the web page), UUID bookkeeping.
const test = require("node:test");
const assert = require("node:assert/strict");
const BM = require("../assets/bench.js");
const E = require("../transfection/engine.js");
require("../transfection/batch.js");
const M = require("../transfection/model.js");
const U = BM.units;
const T = E.Text, AL = E.Aligned, D = E.Defaults, R = E.Recipe;
const close = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what || ""} ${a} ≉ ${b}`);
const ngPerUL = (x) => U.massConc.toBase("ngPerUL", x);
const mgPerML = (x) => U.massConc.toBase("mgPerML", x);
const ugPerML = (x) => U.massConc.toBase("ugPerML", x);
const uL = (l) => l * 1e6, mL = (l) => l * 1e3, ug = (g) => g * 1e6;
const kinds = (p) => p.warnings.map((w) => (w.name ? w.kind + ":" + w.name : w.kind));
const perML = 1000; // cells/mL -> cells/L

// ---------------------------------------------------------------- Engine
// Spec worked example: 240 mL + 10 mL, 1 ug/mL, PEI:DNA 3:1, PEI 1 mg/mL, HC:LC 1:2, HC 500, LC 800 ng/uL.
function workedExample(mode, patch) {
  return Object.assign({
    cultureVolume: 0.24, mixVolume: 0.01, dnaDosePerLiter: ugPerML(1), peiToDNAMassRatio: 3,
    peiStockConcentration: mgPerML(1),
    plasmids: [
      { name: "Heavy chain", stockConcentration: ngPerUL(500), ratioPart: 1, sizeBasePairs: 7000 },
      { name: "Light chain", stockConcentration: ngPerUL(800), ratioPart: 2, sizeBasePairs: 6000 }
    ],
    ratioBasis: "mass", mixingMode: mode || "oneTube", excessFraction: 0, cellDensity: 2.5e6 * 1000
  }, patch || {});
}

test("worked example, one tube", () => {
  const p = E.plan(workedExample());
  close(ug(p.totalDNAMass), 240, 1e-9);
  close(ug(p.peiMass), 720, 1e-9);
  close(uL(p.peiStockVolume), 720, 1e-9);
  assert.equal(p.plasmids.length, 2);
  assert.equal(p.plasmids[0].name, "Heavy chain");
  close(ug(p.plasmids[0].mass), 80, 1e-9);
  close(uL(p.plasmids[0].stockVolume), 160, 1e-9);
  close(p.plasmids[0].massFraction, 1 / 3, 1e-12);
  close(ug(p.plasmids[1].mass), 160, 1e-9);
  close(uL(p.plasmids[1].stockVolume), 200, 1e-9);
  assert.equal(p.peiTube, null);
  close(mL(p.dnaTube.diluentVolume), 8.92, 1e-9);
  close(uL(p.dnaTube.peiVolume), 720, 1e-9);
  close(mL(p.dnaTube.totalVolume), 10, 1e-9);
  close(mL(p.mixVolume), 10, 1e-12);
  close(p.complexFractionOfCulture, 10 / 240, 1e-12);
  close(p.cellsNeeded, 6e8, 1e-3);
  assert.deepEqual(p.warnings, []);
});

test("worked example, two tubes", () => {
  const p = E.plan(workedExample("twoTubes"));
  close(mL(p.dnaTube.diluentVolume), 4.64, 1e-9);
  assert.equal(p.dnaTube.peiVolume, null);
  close(mL(p.dnaTube.totalVolume), 5, 1e-9);
  close(mL(p.peiTube.diluentVolume), 4.28, 1e-9);
  close(uL(p.peiTube.peiVolume), 720, 1e-9);
  assert.equal(p.peiTube.plasmids.length, 0);
  close(mL(p.peiTube.totalVolume), 5, 1e-9);
  assert.deepEqual(p.warnings, []);
});

test("molar ratio weights by plasmid size (1:1, 7000 bp and 6000 bp)", () => {
  const inputs = workedExample(); inputs.ratioBasis = "molar"; inputs.plasmids[1].ratioPart = 1;
  const p = E.plan(inputs);
  close(p.plasmids[0].massFraction, 7 / 13, 1e-12);
  close(ug(p.plasmids[0].mass), 240 * 7 / 13, 1e-9);
  close(ug(p.plasmids[1].mass), 240 * 6 / 13, 1e-9);
  close(ug(p.plasmids[0].mass + p.plasmids[1].mass), 240, 1e-9);
  assert.equal(T.number(ug(p.plasmids[0].mass), 1), "129.2"); // SPEC molar example
  assert.equal(T.number(ug(p.plasmids[1].mass), 1), "110.8");
});

test("molar ratio needs every size", () => {
  const inputs = workedExample(); inputs.ratioBasis = "molar"; inputs.plasmids[1].sizeBasePairs = null;
  assert.equal(E.plan(inputs), null);
  assert.equal(E.massFractions(inputs.plasmids, "molar"), null);
  assert.notEqual(E.massFractions(inputs.plasmids, "mass"), null);
  assert.equal(E.GRAMS_PER_MOLE_PER_BASE_PAIR, 650);
});

test("excess scales what you prepare but not what you add", () => {
  const p = E.plan(workedExample("oneTube", { excessFraction: 0.10 }));
  close(ug(p.totalDNAMass), 264, 1e-9);
  close(uL(p.plasmids[0].stockVolume), 176, 1e-9);
  close(uL(p.plasmids[1].stockVolume), 220, 1e-9);
  close(uL(p.peiStockVolume), 792, 1e-9);
  close(mL(p.dnaTube.diluentVolume), 9.812, 1e-9);
  close(mL(p.dnaTube.totalVolume), 11, 1e-9);
  close(mL(p.mixVolume), 10, 1e-12);
  close(p.complexFractionOfCulture, 10 / 240, 1e-12);
  assert.deepEqual(p.warnings, []);
});

test("the 125 mL preset is the 1 L protocol at 1/8 scale", () => {
  const big = E.plan(workedExample());
  const small = workedExample();
  small.cultureVolume = E.flaskById("mL125").culture;
  small.mixVolume = small.cultureVolume * D.mixFraction(D.lab());
  const p = E.plan(small);
  close(mL(small.mixVolume), 1.25, 1e-12);
  close(p.totalDNAMass, big.totalDNAMass / 8, 1e-15);
  close(p.peiStockVolume, big.peiStockVolume / 8, 1e-15);
  close(uL(p.plasmids[0].stockVolume), 20, 1e-9);
  close(uL(p.plasmids[1].stockVolume), 25, 1e-9);
  close(uL(p.peiStockVolume), 90, 1e-9);
  close(mL(p.dnaTube.diluentVolume), 1.115, 1e-9);
  close(p.dnaTube.diluentVolume, big.dnaTube.diluentVolume / 8, 1e-15);
  close(p.complexFractionOfCulture, big.complexFractionOfCulture, 1e-12);
  close(p.cellsNeeded, 7.5e7, 1e-3);
});

test("every flask preset is the same 24 % fill", () => {
  const size = { mL125: 0.125, mL250: 0.25, mL500: 0.5, L1: 1, L2: 2 };
  Object.keys(size).forEach((id) => close(E.flaskById(id).culture / size[id], 0.24, 1e-12, id));
  assert.equal(E.flaskById("custom").culture, null);
  assert.equal(E.cultureDescription(E.flaskById("custom")), null);
  close(E.flaskById("L1").culture, 0.24, 1e-15);
  close(E.flaskById("L2").culture, 0.48, 1e-15);
  assert.deepEqual(E.FLASK_PRESETS.map((p) => p.label), ["125 mL", "250 mL", "500 mL", "1 L", "2 L", "Custom"]);
  assert.deepEqual(E.FLASK_PRESETS.map(E.cultureDescription).filter(Boolean),
    ["30 mL cells", "60 mL cells", "120 mL cells", "240 mL cells", "480 mL cells"]);
});

test("flask preset matching", () => {
  assert.equal(E.flaskMatching(0.24).id, "L1");
  assert.equal(E.flaskMatching(U.volume.toBase("mL", 30)).id, "mL125");
  assert.equal(E.flaskMatching(U.volume.toBase("L", 0.48)).id, "L2");
  assert.equal(E.flaskMatching(U.volume.toBase("mL", 240.0000001)).id, "L1");
  assert.equal(E.flaskMatching(0.25).id, "custom");
  assert.equal(E.flaskMatching(0).id, "custom");
  assert.equal(E.flaskMatching(-0.24).id, "custom");
});

test("the owner's standard run, two tubes", () => {
  const d = D.lab();
  const p = E.plan({
    cultureVolume: 0.24, mixVolume: 0.24 * D.mixFraction(d), dnaDosePerLiter: ugPerML(1), peiToDNAMassRatio: 2,
    peiStockConcentration: mgPerML(1),
    plasmids: [{ name: "Plasmid", stockConcentration: ngPerUL(1000), ratioPart: 1 }], mixingMode: "twoTubes"
  });
  close(ug(p.totalDNAMass), 240, 1e-9);
  close(ug(p.peiMass), 480, 1e-9);
  close(uL(p.peiStockVolume), 480, 1e-9);
  close(uL(p.plasmids[0].stockVolume), 240, 1e-9);
  close(mL(p.dnaTube.diluentVolume), 4.76, 1e-9);
  close(mL(p.peiTube.diluentVolume), 4.52, 1e-9);
  close(mL(p.mixVolume), 10, 1e-9);
  assert.deepEqual(p.warnings, []);
});

test("SPEC lab-defaults example: HC 500 / LC 800 ng/µL, 1:2 by mass, PEI 2:1 (tubes 4.64 / 4.52 mL, one tube 9.16 mL)", () => {
  const inputs = (mode) => workedExample(mode, { peiToDNAMassRatio: 2 });
  const two = E.plan(inputs("twoTubes"));
  close(ug(two.totalDNAMass), 240, 1e-9);
  close(ug(two.plasmids[0].mass), 80, 1e-9); close(uL(two.plasmids[0].stockVolume), 160, 1e-9);
  close(ug(two.plasmids[1].mass), 160, 1e-9); close(uL(two.plasmids[1].stockVolume), 200, 1e-9);
  close(ug(two.peiMass), 480, 1e-9); close(uL(two.peiStockVolume), 480, 1e-9);
  close(mL(two.dnaTube.diluentVolume), 4.64, 1e-9);
  close(mL(two.peiTube.diluentVolume), 4.52, 1e-9);
  close(mL(E.plan(inputs("oneTube")).dnaTube.diluentVolume), 9.16, 1e-9);
  assert.equal((two.complexFractionOfCulture * 100).toFixed(2), "4.17");
  assert.deepEqual(two.warnings, []);
  // Cells: 1.04e6 x 240 mL = 2.496e8, 1.00e6/mL once the mix is in; from 2.0e6/mL: 124.8 mL + 115.2 mL.
  const cells = E.cellPlan(0.24, 1.04e6 * perML, 2.0e6 * perML, 0.01);
  close(cells.cellsNeeded, 2.496e8, 1);
  assert.equal(T.millions(cells.finalDensity / perML), "1.00 × 10⁶");
  assert.equal(AL.volume(cells.sourceVolume, "culture").text, "124.8 mL");
  assert.equal(AL.volume(cells.mediaVolume, "culture").text, "115.2 mL");
  assert.equal(D.incubationText(D.lab()), "9:30");
});

test("guardrail: no plasmids", () => {
  const p = E.plan(workedExample("oneTube", { plasmids: [] }));
  assert.deepEqual(kinds(p), ["noPlasmids"]);
  assert.equal(p.plasmids.length, 0);
  close(uL(p.peiStockVolume), 720, 1e-9);
});

test("guardrail: every ratio part zero", () => {
  const inputs = workedExample(); inputs.plasmids[0].ratioPart = 0; inputs.plasmids[1].ratioPart = 0;
  const p = E.plan(inputs);
  assert.deepEqual(kinds(p), ["ratioPartsZero"]);
  assert.deepEqual(p.plasmids.map((l) => l.mass), [0, 0]);
  assert.deepEqual(p.plasmids.map((l) => l.stockVolume), [0, 0]);
});

test("guardrail: sub-microliter plasmid volume", () => {
  const inputs = workedExample(); inputs.plasmids[0].stockConcentration = mgPerML(100); // 80 ug / 100 mg/mL = 0.8 uL
  const p = E.plan(inputs);
  assert.deepEqual(kinds(p), ["plasmidVolumeSubMicroliter:Heavy chain"]);
  close(uL(p.plasmids[0].stockVolume), 0.8, 1e-9);
});

test("guardrail: sub-microliter PEI volume, and just over 1 µL is fine", () => {
  const inputs = workedExample(); inputs.peiStockConcentration = mgPerML(1000);
  const p = E.plan(inputs);
  assert.deepEqual(kinds(p), ["peiVolumeSubMicroliter"]);
  close(uL(p.peiStockVolume), 0.72, 1e-9);
  assert.equal(E.isBlocking({ kind: "peiVolumeSubMicroliter" }), false);
  inputs.peiStockConcentration = mgPerML(700);
  assert.ok(!kinds(E.plan(inputs)).includes("peiVolumeSubMicroliter"));
});

test("1 µL guardrail has float slack and never warns on zero (edge-notes P2)", () => {
  // 1000 ng/µL stock and 1 µg of DNA: 1 µL up to rounding. 0.24 L x 1 ug/mL = 240 ug; use a tiny culture.
  const inputs = workedExample("twoTubes", {
    cultureVolume: 1e-3, mixVolume: 1e-4, peiToDNAMassRatio: 2,
    plasmids: [{ name: "p", stockConcentration: ngPerUL(1000), ratioPart: 1 }]
  });
  const p = E.plan(inputs); // DNA 1 ug -> exactly 1 µL (floating point may land a hair under)
  assert.ok(!kinds(p).includes("plasmidVolumeSubMicroliter:p"), kinds(p).join());
  const zero = E.plan(workedExample("oneTube", { cultureVolume: 0 }));
  assert.ok(!kinds(zero).some((k) => k.indexOf("SubMicroliter") >= 0));
});

test("guardrail: plasmid stock too dilute for one tube", () => {
  const inputs = workedExample(); inputs.plasmids[1].stockConcentration = ngPerUL(10); // 160 ug / 10 ng/uL = 16 mL > 10 mL
  const p = E.plan(inputs);
  assert.ok(kinds(p).includes("mixVolumeTooSmall"));
  assert.ok(kinds(p).includes("plasmidVolumeExceedsTube:Light chain"));
  assert.ok(!kinds(p).includes("plasmidVolumeExceedsTube:Heavy chain"));
  assert.ok(!kinds(p).includes("peiVolumeExceedsTube"));
  assert.equal(p.dnaTube.diluentVolume, 0);
});

test("guardrail: PEI stock too dilute for its tube", () => {
  const p = E.plan(workedExample("twoTubes", { peiStockConcentration: mgPerML(0.1) }));
  assert.deepEqual(kinds(p), ["mixVolumeTooSmall", "peiVolumeExceedsTube"]);
  close(mL(p.peiStockVolume), 7.2, 1e-9);
  assert.equal(p.peiTube.diluentVolume, 0);
  close(mL(p.dnaTube.diluentVolume), 4.64, 1e-9);
});

test("guardrail: mix too small without any single overflow", () => {
  const p = E.plan(workedExample("oneTube", { mixVolume: U.volume.toBase("uL", 1000) }));
  assert.deepEqual(kinds(p), ["mixVolumeTooSmall"]);
  assert.equal(p.dnaTube.diluentVolume, 0);
});

test("guardrail: complex fraction over 10 %", () => {
  assert.deepEqual(E.plan(workedExample("oneTube", { mixVolume: 0.024 })).warnings, []); // exactly 10 % is fine
  const p = E.plan(workedExample("oneTube", { mixVolume: 0.030 }));
  assert.deepEqual(kinds(p), ["complexFractionHigh"]);
  close(p.complexFractionOfCulture, 0.125, 1e-12);
});

test("guardrail: unusual PEI : DNA ratio", () => {
  assert.deepEqual(E.plan(workedExample("oneTube", { peiToDNAMassRatio: 6 })).warnings, []);
  assert.deepEqual(kinds(E.plan(workedExample("oneTube", { peiToDNAMassRatio: 8 }))), ["unusualRatio"]);
  assert.deepEqual(kinds(E.plan(workedExample("oneTube", { peiToDNAMassRatio: 0.5 }))), ["unusualRatio"]);
});

test("guardrail: unusual DNA dose", () => {
  const k = (dose) => kinds(E.plan(workedExample("oneTube", { dnaDosePerLiter: ugPerML(dose) })));
  assert.deepEqual(k(3), []);
  assert.deepEqual(k(0.25), []);
  assert.deepEqual(k(10), ["mixVolumeTooSmall", "unusualDose"]); // 2.4 mg of DNA also overflows the 10 mL mix
  assert.deepEqual(k(0.1), ["unusualDose"]);
});

test("cells needed is optional", () => {
  assert.equal(E.plan(workedExample("oneTube", { cellDensity: null })).cellsNeeded, null);
});

test("aligned mass", () => {
  const m = (g) => AL.mass(g).text;
  assert.equal(m(240e-6), "240 µg");
  assert.equal(m(12.5e-6), "12.5 µg");
  assert.equal(m(2.5e-6), "2.50 µg");
  assert.equal(m(9.996e-6), "10.0 µg");
  assert.equal(m(99.96e-6), "100 µg");
  assert.equal(m(999.96e-6), "1.000 mg");
  assert.equal(m(1.2e-3), "1.200 mg");
  assert.equal(m(0.004e-6), "0.0040 µg");
  assert.equal(m(0), "0 µg");
  assert.equal(m(-1), "0 µg");
  assert.equal(m(NaN), "0 µg");
  assert.equal(m(Infinity), "0 µg");
  assert.deepEqual(AL.column([AL.mass(1.2e-3), AL.mass(480e-6), AL.mass(12.5e-6)]), ["1.200   mg", "  480   µg", "   12.5 µg"]);
});

test("feasibility", () => {
  const ok = E.plan(workedExample());
  assert.equal(E.isFeasible(ok), true);
  assert.equal(E.infeasibleReason(ok), null);
  const bad = E.plan(workedExample("oneTube", { peiStockConcentration: mgPerML(0.05) }));
  assert.equal(E.isFeasible(bad), false);
  assert.ok(E.blockingWarnings(bad).some((w) => w.kind === "peiVolumeExceedsTube"));
  assert.ok(E.blockingWarnings(bad).every(E.isBlocking));
  assert.notEqual(E.infeasibleReason(bad), null);
  const advisory = E.plan(workedExample("oneTube", { peiToDNAMassRatio: 8 }));
  assert.deepEqual(kinds(advisory), ["unusualRatio"]);
  assert.equal(E.isFeasible(advisory), true);
});

test("an infeasible plan has no tube lines in the copy text, but the cells stay", () => {
  const dil = D.lab(); dil.peiStockMgPerML = 0.05; // 480 µg of PEI needs 9.6 mL: more than its 5 mL tube
  const inputs = workedExample("twoTubes");
  const batch = E.batchPlan(dil, [{ id: "r1", name: "T", cultureVolumePerFlask: 0.24, flaskCount: 1,
    plasmids: inputs.plasmids, ratioBasis: "mass" }], 0, 1.04e6 * perML, 3.12e6 * perML);
  const recipe = E.batchRecipe(dil, batch);
  const text = E.singlePlainText({
    date: new Date(2026, 9, 14), defaults: dil, run: batch.runs[0], recipe: recipe.runs[0].recipe, excessPct: 0,
    seedingDensityPerML: 1.04e6, sourceDensityPerML: 3.12e6, flaskTitle: "1 L", plasmidCount: 2, ratioBasis: "mass"
  });
  assert.ok(text.includes("Tubes not made: "));
  assert.ok(!text.includes("Tube A · DNA"));
  assert.ok(text.includes("Source culture"));
});

test("a source below the seeding density has no cell lines", () => {
  const p = E.plan(workedExample("twoTubes"));
  const cells = E.cellPlan(0.24, 1.04e9, 0.8e9, 0.01);
  assert.equal(cells.sourceBelowSeeding, true);
  assert.equal(cells.hasSource, false);
  assert.equal(cells.sourceProblem,
    "The source (0.80 × 10⁶/mL) is below the 1.04 × 10⁶/mL seeding density: no volume of it makes 240.0 mL. Recount, or concentrate the cells.");
  const recipe = R.build(D.lab(), p, cells, 0.24);
  assert.equal(R.section(recipe, "cells"), null);
  assert.ok(!R.allItems(recipe).some((i) => i.id.indexOf("cells.") === 0));
  assert.equal(E.cellPlan(0.24, 1.04e9, 3.12e9, 0.01).sourceProblem, null);
});

test("plasmid recipe ids follow the row", () => {
  const inputs = workedExample("twoTubes");
  inputs.plasmids[0].rowID = "rowA"; inputs.plasmids[1].rowID = "rowB";
  const p = E.plan(inputs);
  assert.deepEqual(p.plasmids.map((l) => l.rowID), ["rowA", "rowB"]);
  assert.deepEqual(R.section(R.build(D.lab(), p, null, 0.24), "a").items.map((i) => i.id), ["a.diluent", "a.plasmid.rowA", "a.plasmid.rowB"]);
  const anon = E.plan(workedExample("twoTubes"));
  assert.deepEqual(R.section(R.build(D.lab(), anon, null, 0.24), "a").items.map((i) => i.id), ["a.diluent", "a.plasmid.0", "a.plasmid.1"]);
});

// ---------------------------------------------------------------- Run pieces (defaults, cell plan, text, recipe)
function inputsFor(defaults, culture, plasmids) {
  return {
    cultureVolume: culture, mixVolume: culture * D.mixFraction(defaults), dnaDosePerLiter: ugPerML(defaults.doseUgPerML),
    peiToDNAMassRatio: defaults.peiToDNARatio, peiStockConcentration: mgPerML(defaults.peiStockMgPerML),
    plasmids: plasmids || [{ name: "Plasmid", stockConcentration: ngPerUL(1000), ratioPart: 1 }],
    mixingMode: defaults.mixingMode, excessFraction: E.excessFraction(defaults.excess), cellDensity: defaults.seedingDensityPerML * perML
  };
}
function cellsFor(source, culture) {
  culture = culture == null ? 0.24 : culture;
  return E.cellPlan(culture, 1.04e6 * perML, source == null ? null : source * perML, culture / 24);
}
function reportRecipe(defaults, source, plasmids) {
  defaults = defaults || D.lab();
  const plan = E.plan(inputsFor(defaults, 0.24, plasmids));
  return { plan, recipe: R.build(defaults, plan, cellsFor(source === undefined ? 3.12e6 : source), 0.24) };
}
const amt = (liters, scale) => AL.volume(liters, scale || "mix").text;

test("lab defaults are the owner's protocol", () => {
  const lab = D.lab();
  assert.equal(lab.peiToDNARatio, 2);
  assert.equal(lab.doseUgPerML, 1);
  assert.equal(lab.peiStockMgPerML, 1);
  assert.equal(lab.diluentName, "OptiPRO SFM");
  assert.equal(lab.mixingMode, "twoTubes");
  close(D.mixFraction(lab), 10 / 240, 1e-15);
  close(D.cultureToMixRatio(lab), 24, 1e-12);
  assert.equal(lab.seedingDensityPerML, 1.04e6);
  assert.equal(lab.excess, 0);
  assert.equal(lab.incubationSeconds, 570);
  assert.equal(lab.cultureUnit, "mL");
  assert.deepEqual(D.changedFields(lab), []);
  assert.equal(D.isUsable(lab), true);
});

test("defaults readings", () => {
  const lab = D.lab();
  assert.equal(D.ratioText(lab), "1 : 2");
  assert.equal(D.doseText(lab), "1 µg/mL culture");
  assert.equal(D.peiStockText(lab), "1 mg/mL");
  assert.equal(D.mixReferenceText(lab), "10 mL per 240 mL");
  assert.equal(D.cultureToMixText(lab), "24 : 1");
  assert.equal(D.seedingText(lab), "1.04 × 10⁶ live cells/mL");
  assert.equal(D.incubationText(lab), "9:30");
  const d = D.lab(); d.peiToDNARatio = 2.5; d.diluentName = "  ";
  assert.equal(D.ratioText(d), "1 : 2.5");
  assert.equal(D.diluentDisplayName(d), "Diluent");
});

test("culture : mix ratio both directions", () => {
  const d = D.lab();
  D.setCultureToMixRatio(d, 20);
  assert.equal(d.cultureReferenceML, 240);
  close(d.mixReferenceML, 12, 1e-12);
  close(D.mixFraction(d), 0.05, 1e-15);
  d.mixReferenceML = 10; d.cultureReferenceML = 480;
  close(D.cultureToMixRatio(d), 48, 1e-12);
  D.setCultureToMixRatio(d, 0); D.setCultureToMixRatio(d, -3); D.setCultureToMixRatio(d, Infinity);
  assert.equal(d.mixReferenceML, 10); // nonsense ignored
  d.mixReferenceML = 0;
  assert.equal(D.cultureToMixRatio(d), 0);
  assert.equal(D.mixFraction(d), 0);
  assert.equal(D.isUsable(d), false);
});

test("culture : mix ratio, linear multiples", () => {
  const d = D.lab(); d.mixReferenceML = 20; d.cultureReferenceML = 480;
  close(D.cultureToMixRatio(d), 24, 1e-12);
  close(D.mixFraction(d), D.mixFraction(D.lab()), 1e-15);
  D.setCultureToMixRatio(d, 16);
  assert.equal(d.cultureReferenceML, 480);
  close(d.mixReferenceML, 30, 1e-12);
  assert.equal(D.mixReferenceText(d), "30 mL per 480 mL");
  assert.equal(D.cultureToMixText(d), "16 : 1");
  D.setCultureToMixRatio(d, 24);
  close(d.mixReferenceML, 20, 1e-12);
});

test("changed fields mark only what differs", () => {
  const d = D.lab(); d.mixReferenceML = 20; d.cultureReferenceML = 480; // same 1 : 24
  assert.deepEqual(D.changedFields(d), []);
  d.peiToDNARatio = 3; d.mixingMode = "oneTube"; d.incubationSeconds = 600;
  assert.deepEqual(D.changedFields(d), ["ratio", "mixing", "incubation"]);
  assert.equal(D.FIELD_TITLES.ratio, "DNA : PEI");
});

test("cell plan, worked example", () => {
  const c = cellsFor(3.12e6);
  close(c.cellsNeeded, 2.496e8, 1);
  close(c.sourceVolume * 1000, 80, 1e-9);
  close(c.mediaVolume * 1000, 160, 1e-9);
  close(c.finalVolume * 1000, 250, 1e-9);
  close(c.finalDensity / perML, 0.9984e6, 1);
  assert.equal(T.millions(c.finalDensity / perML), "1.00 × 10⁶");
  assert.equal(c.seedingDensity, 1.04e9);
  assert.equal(c.sourceDensity, 3.12e9);
  assert.equal(c.hasSource, true);
  assert.equal(c.sourceBelowSeeding, false);
});

test("cell plan without a source density", () => {
  [null, 0, -1, NaN].forEach((s) => {
    const c = E.cellPlan(0.24, 1.04e9, s == null ? null : s * perML, 0.01);
    assert.equal(c.sourceVolume, null); assert.equal(c.mediaVolume, null);
    assert.equal(c.hasSource, false); assert.equal(c.sourceBelowSeeding, false);
    close(c.cellsNeeded, 2.496e8, 1);
  });
});

test("cell plan, source below seeding", () => {
  const c = cellsFor(0.8e6);
  assert.equal(c.sourceBelowSeeding, true);
  close(c.sourceVolume * 1000, 312, 1e-9);
  assert.equal(c.mediaVolume, 0); // clamped, never negative
  const even = cellsFor(1.04e6);
  assert.equal(even.sourceBelowSeeding, false);
  close(even.mediaVolume, 0, 1e-12);
  const thin = cellsFor(0.52e6);
  assert.equal(thin.sourceBelowSeeding, true);
  close(thin.cellsNeeded, 2.496e8, 1);
  close(thin.sourceVolume * 1000, 480, 1e-9);
  assert.equal(thin.mediaVolume, 0);
  const close1 = cellsFor(1.05e6);
  assert.equal(close1.sourceBelowSeeding, false);
  assert.ok(close1.mediaVolume > 0);
});

test("cell plan, zero / negative / NaN culture", () => {
  [0, -0.24, NaN].forEach((culture) => {
    const c = E.cellPlan(culture, 1.04e9, 3.12e9, 0);
    assert.equal(c.cultureVolume, 0); assert.equal(c.cellsNeeded, 0);
    assert.equal(c.sourceVolume, null); assert.equal(c.mediaVolume, null);
    assert.equal(c.finalDensity, 0); assert.equal(c.sourceBelowSeeding, false);
  });
});

test("cell plan, mix from the defaults and a large culture", () => {
  const mix = 0.24 * D.mixFraction(D.lab());
  close(mix * 1000, 10, 1e-12);
  const c = E.cellPlan(0.24, 1.04e9, 3.12e9, mix);
  close(c.mixVolume * 1000, 10, 1e-12);
  close(c.finalVolume * 1000, 250, 1e-9);
  assert.equal(T.scientific(c.cellsNeeded), "2.496 × 10⁸");
  assert.equal(AL.volume(c.sourceVolume, "culture").text, "80.0 mL");
  assert.equal(AL.volume(c.mediaVolume, "culture").text, "160.0 mL");
  const big = E.cellPlan(2.5, 1.04e9, 3.12e9, 2.5 / 24);
  close(big.cellsNeeded, 2.6e9, 1);
  const source = AL.volume(big.sourceVolume, "culture"), media = AL.volume(big.mediaVolume, "culture");
  assert.equal(source.text, "833.3 mL");
  assert.equal(media.text, "1.667 L");
  assert.deepEqual(AL.column([source, media]), ["  833.3 mL", "1.667   L "]);
  assert.equal(AL.volume(big.finalVolume, "culture").text, "2.604 L");
});

test("aligned amounts, worked example", () => {
  const a = (l, s) => { const x = AL.volume(l, s); return [x.whole, x.tail, x.unit]; };
  assert.deepEqual(a(4.52e-3, "mix"), ["4.520", "", "mL"]);
  assert.deepEqual(a(480e-6, "mix"), ["480", "", "µL"]);
  assert.deepEqual(a(12.5e-6, "mix"), ["12", ".5", "µL"]);
  assert.deepEqual(a(2.5e-6, "mix"), ["2", ".50", "µL"]);
  assert.equal(amt(4.76e-3), "4.760 mL");
  assert.equal(amt(10e-3), "10.000 mL");
  assert.equal(amt(0.08, "culture"), "80.0 mL");
  assert.equal(amt(0.16, "culture"), "160.0 mL");
  assert.equal(amt(0.24, "culture"), "240.0 mL");
  assert.equal(AL.volume(0.24, "culture").number, "240.0");
});

test("aligned column puts digits under digits", () => {
  const rows = AL.column([AL.volume(4.52e-3, "mix"), AL.volume(480e-6, "mix"), AL.volume(12.5e-6, "mix")]);
  assert.deepEqual(rows, ["4.520   mL", "  480   µL", "   12.5 µL"]);
  assert.deepEqual(rows.map((r) => r[4]), ["0", "0", "2"]);
  assert.equal(new Set(rows.map((r) => r.length)).size, 1);
  assert.deepEqual(rows.map((r) => r[8]), ["m", "µ", "µ"]);
  assert.deepEqual(AL.column([AL.volume(1.2, "culture"), AL.volume(0.08, "culture")]), ["1.200   L ", "   80.0 mL"]);
  assert.deepEqual(AL.column([]), []);
  const names = ["OptiPRO SFM", "PEI", "Plasmid 2"];
  const width = Math.max(...names.map((n) => n.length));
  const table = names.map((n, i) => n + " ".repeat(width - n.length) + "  " + rows[i]);
  assert.deepEqual(table, ["OptiPRO SFM  4.520   mL", "PEI            480   µL", "Plasmid 2       12.5 µL"]);
});

test("aligned amounts cross units when rounding", () => {
  assert.equal(amt(999.96e-6), "1.000 mL");
  assert.equal(amt(999.4e-6), "999 µL");
  assert.equal(amt(0.999 * 1e-3 - 1e-12), "999 µL");
  assert.equal(amt(999.96e-3, "culture"), "1.000 L");
  assert.equal(amt(999.94e-3, "culture"), "999.9 mL");
  assert.equal(amt(9.996e-6), "10.0 µL");
  assert.equal(amt(99.96e-6), "100 µL");
  assert.equal(amt(9.994e-6), "9.99 µL");
});

test("aligned amounts: zero, sub-microliter, clamps", () => {
  assert.equal(amt(0), "0 µL");
  assert.equal(amt(0, "culture"), "0.0 mL");
  assert.equal(amt(0.5e-6), "0.50 µL");
  assert.equal(amt(0.004e-6), "0.0040 µL");
  assert.equal(amt(0.00004, "culture"), "0.040 mL");
  assert.equal(amt(-5e-6), "0 µL");
  assert.equal(amt(NaN), "0 µL");
  assert.equal(amt(Infinity, "culture"), "0.0 mL");
  const q = AL.volume(0.25e-6, "mix"); assert.deepEqual([q.whole, q.tail, q.unit], ["0", ".25", "µL"]);
  const z = AL.volume(0, "mix"); assert.deepEqual([z.whole, z.tail, z.unit], ["0", "", "µL"]);
  assert.deepEqual(AL.column([AL.volume(5e-3, "mix"), AL.volume(0, "mix"), AL.volume(0.25e-6, "mix")]), ["5.000    mL", "    0    µL", "    0.25 µL"]);
  assert.deepEqual(AL.column([AL.volume(999.96e-6, "mix"), AL.volume(480e-6, "mix"), AL.volume(2.5e-6, "mix")]), ["1.000    mL", "  480    µL", "    2.50 µL"]);
  assert.ok(!amt(-1e-3).includes("-")); assert.ok(!amt(-2, "culture").includes("-"));
});

test("aligned amounts, large culture", () => {
  assert.equal(amt(2.5, "culture"), "2.500 L");
  assert.equal(amt(25, "culture"), "25.000 L");
  assert.equal(amt(2.5 / 24), "104.167 mL");
  assert.equal(amt(1, "culture"), "1.000 L");
  assert.equal(amt(1e-3), "1.000 mL");
});

test("number wording", () => {
  assert.equal(T.number(2), "2");
  assert.equal(T.number(1.04), "1.04");
  assert.equal(T.number(0.5), "0.5");
  assert.equal(T.number(-0.0001), "0");
  assert.equal(T.number(NaN), "–");
  assert.equal(T.millions(1.04e6), "1.04 × 10⁶");
  assert.equal(T.millions(0.9984e6), "1.00 × 10⁶");
  assert.equal(T.scientific(2.496e8), "2.496 × 10⁸");
  assert.equal(T.scientific(9.99996e8), "1.000 × 10⁹");
  assert.equal(T.scientific(0), "0");
  assert.equal(T.superscript(-12), "⁻¹²");
});

test("mass wording", () => {
  assert.equal(T.mass(240e-6), "240 µg");
  assert.equal(T.mass(12.5e-6), "12.5 µg");
  assert.equal(T.mass(0.48e-6), "0.48 µg");
  assert.equal(T.mass(9.996e-6), "10.0 µg");
  assert.equal(T.mass(999.7e-6), "1.00 mg");
  assert.equal(T.mass(2.4e-3), "2.40 mg");
  assert.equal(T.mass(0.001e-6), "0.0010 µg");
  assert.equal(T.mass(0), "0 µg");
  assert.equal(T.mass(-1), "0 µg");
  assert.equal(T.microgramsNumber(240e-6), "240");
});

test("clock", () => {
  assert.equal(T.clock(570), "9:30");
  assert.equal(T.clock(569.2), "9:30");
  assert.equal(T.clock(5), "0:05");
  assert.equal(T.clock(0), "0:00");
  assert.equal(T.clock(-3), "0:00");
  assert.equal(T.clock(3600), "60:00");
});

test("recipe, worked example, two tubes", () => {
  const { recipe: r } = reportRecipe();
  assert.deepEqual(r.sections.map((s) => s.id), ["cells", "a", "b", "finish"]);
  assert.deepEqual(r.sections.map((s) => s.title), ["Cells", "Tube A · DNA", "Tube B · PEI", "Combine"]);
  assert.deepEqual(R.allItems(r).map((i) => i.id), ["cells.source", "cells.media", "a.diluent", "a.plasmid.0", "b.diluent", "b.pei", "combine", "incubate", "add"]);
  const text = (id) => R.item(r, id).amount && R.item(r, id).amount.text;
  assert.equal(text("cells.source"), "80.0 mL");
  assert.equal(text("cells.media"), "160.0 mL");
  assert.equal(text("a.diluent"), "4.760 mL");
  assert.equal(text("a.plasmid.0"), "240 µL");
  assert.equal(text("b.diluent"), "4.520 mL");
  assert.equal(text("b.pei"), "480 µL");
  assert.equal(text("add"), "10.000 mL");
  assert.equal(R.item(r, "combine").amount, null);
  assert.equal(R.item(r, "a.diluent").name, "OptiPRO SFM");
  close(ug(R.item(r, "a.plasmid.0").mass), 240, 1e-9);
  close(ug(R.item(r, "b.pei").mass), 480, 1e-9);
  assert.equal(R.item(r, "a.diluent").mass, null);
  assert.equal(R.item(r, "cells.source").note, "from the source flask at 3.12 × 10⁶/mL");
  assert.equal(R.item(r, "cells.media").note, "makes 240.0 mL of culture");
  assert.equal(R.item(r, "a.plasmid.0").note, "1000 ng/µL stock");
  assert.equal(R.item(r, "b.pei").note, "1 mg/mL stock");
  assert.equal(R.item(r, "combine").name, "Combine A and B");
  assert.equal(R.item(r, "incubate").note, "9:30");
  assert.equal(R.item(r, "add").note, "→ 250.0 mL at ≈ 1.00 × 10⁶/mL");
  assert.equal(R.tubeLetter(R.section(r, "a")), "A");
  assert.equal(R.tubeLetter(R.section(r, "b")), "B");
  assert.equal(R.tubeLetter(R.section(r, "cells")), null);
  assert.deepEqual(R.tubeSections(r).map((s) => s.id), ["a", "b"]);
  assert.deepEqual(R.alignedAmounts(R.section(r, "b")), ["4.520 mL", "  480 µL"]);
  assert.deepEqual(R.alignedAmounts(R.section(r, "finish")), [null, null, "10.000 mL"]);
});

test("recipe, one tube", () => {
  const d = D.lab(); d.mixingMode = "oneTube";
  const { recipe: r } = reportRecipe(d);
  assert.deepEqual(r.sections.map((s) => s.id), ["cells", "mix", "finish"]);
  assert.deepEqual(R.section(r, "mix").items.map((i) => i.id), ["mix.diluent", "mix.plasmid.0", "mix.pei"]);
  assert.equal(R.item(r, "mix.diluent").amount.text, "9.280 mL");
  assert.equal(R.item(r, "combine").name, "Mix gently");
  assert.equal(R.tubeLetter(R.section(r, "mix")), null);
});

test("recipe without cells or without a source", () => {
  const plan = E.plan(inputsFor(D.lab(), 0.24));
  assert.deepEqual(R.build(D.lab(), plan, null, 0.24).sections.map((s) => s.id), ["a", "b", "finish"]);
  assert.equal(R.item(R.build(D.lab(), plan, null, 0.24), "add").note, null);
  assert.deepEqual(R.build(D.lab(), plan, cellsFor(null), 0.24).sections.map((s) => s.id), ["a", "b", "finish"]);
});

test("recipe, three plasmids align", () => {
  const { recipe: r } = reportRecipe(null, 3.12e6, [
    { name: "Heavy chain", stockConcentration: ngPerUL(1000), ratioPart: 1 },
    { name: "Light chain", stockConcentration: ngPerUL(800), ratioPart: 1 },
    { name: "Helper", stockConcentration: ngPerUL(2000), ratioPart: 1 }
  ]);
  assert.deepEqual(R.section(r, "a").items.map((i) => i.id), ["a.diluent", "a.plasmid.0", "a.plasmid.1", "a.plasmid.2"]);
  assert.deepEqual(R.alignedAmounts(R.section(r, "a")), ["4.780   mL", "   80.0 µL", "  100   µL", "   40.0 µL"]);
});

test("recipe, large culture moves tube lines into milliliters", () => {
  const plan = E.plan(inputsFor(D.lab(), 2.5));
  const r = R.build(D.lab(), plan, E.cellPlan(2.5, 1.04e9, 3.12e9, 2.5 / 24), 2.5);
  const t = (id) => R.item(r, id).amount.text;
  assert.equal(t("a.plasmid.0"), "2.500 mL");
  assert.equal(t("a.diluent"), "49.583 mL");
  assert.equal(t("b.pei"), "5.000 mL");
  assert.equal(t("b.diluent"), "47.083 mL");
  assert.equal(t("add"), "104.167 mL");
  assert.equal(t("cells.source"), "833.3 mL");
  assert.equal(t("cells.media"), "1.667 L");
  assert.deepEqual(R.alignedAmounts(R.section(r, "a")), ["49.583 mL", " 2.500 mL"]);
});

test("recipe ids are stable across recomputes", () => {
  const mk = (c) => R.build(D.lab(), E.plan(inputsFor(D.lab(), c)), cellsFor(3.12e6, c), c);
  const small = mk(0.24), big = mk(0.48);
  assert.deepEqual(R.allItems(small).map((i) => i.id), R.allItems(big).map((i) => i.id));
  assert.notEqual(R.item(small, "b.pei").amount.text, R.item(big, "b.pei").amount.text);
  assert.equal(new Set(R.allItems(small).map((i) => i.id)).size, R.allItems(small).length);
});

test("recipe, two plasmids in one and two tubes", () => {
  const two = [
    { name: "Heavy chain", stockConcentration: ngPerUL(1000), ratioPart: 1 },
    { name: "Light chain", stockConcentration: ngPerUL(1000), ratioPart: 2 }
  ];
  const twoTubes = reportRecipe(D.lab(), 3.12e6, two).recipe;
  assert.deepEqual(R.allItems(twoTubes).map((i) => i.id), ["cells.source", "cells.media", "a.diluent", "a.plasmid.0", "a.plasmid.1", "b.diluent", "b.pei", "combine", "incubate", "add"]);
  assert.equal(R.item(twoTubes, "a.plasmid.0").name, "Heavy chain");
  assert.equal(R.item(twoTubes, "a.plasmid.0").amount.text, "80.0 µL");
  assert.equal(R.item(twoTubes, "a.plasmid.1").amount.text, "160 µL");
  assert.equal(R.item(twoTubes, "a.diluent").amount.text, "4.760 mL");
  const one = D.lab(); one.mixingMode = "oneTube";
  const r = reportRecipe(one, 3.12e6, two).recipe;
  assert.deepEqual(R.allItems(r).map((i) => i.id), ["cells.source", "cells.media", "mix.diluent", "mix.plasmid.0", "mix.plasmid.1", "mix.pei", "combine", "incubate", "add"]);
  assert.deepEqual(r.sections.map((s) => s.title), ["Cells", "Transfection mix", "Combine"]);
  assert.deepEqual(R.tubeSections(r).map((s) => s.id), ["mix"]);
  assert.equal(R.item(r, "mix.diluent").amount.text, "9.280 mL");
  assert.equal(R.item(r, "add").amount.text, "10.000 mL");
});

test("single-run copy text aligns each block", () => {
  const plan = E.plan(inputsFor(D.lab(), 0.24));
  const batch = E.batchPlan(D.lab(), [{ id: "r1", name: "Transfection 1", cultureVolumePerFlask: 0.24, flaskCount: 1,
    plasmids: [{ name: "Plasmid", stockConcentration: ngPerUL(1000), ratioPart: 1 }], ratioBasis: "mass" }], 0, 1.04e6 * perML, 3.12e6 * perML);
  const rec = E.batchRecipe(D.lab(), batch);
  const text = E.singlePlainText({
    date: new Date(2026, 9, 14), defaults: D.lab(), run: batch.runs[0], recipe: rec.runs[0].recipe, excessPct: 0,
    seedingDensityPerML: 1.04e6, sourceDensityPerML: 3.12e6, flaskTitle: "1 L", plasmidCount: 1, ratioBasis: "mass"
  });
  const lines = text.split("\n");
  assert.equal(lines[0], "PEI transfection · 2026-10-14");
  assert.equal(lines[1], "1 L flask · 240.0 mL cells + 10.000 mL mix");
  assert.ok(text.includes("Tube A · DNA\nOptiPRO SFM  4.760 mL\nPlasmid        240 µL"), text);
  assert.ok(text.includes("Tube B · PEI\nOptiPRO SFM  4.520 mL\nPEI            480 µL"), text);
  assert.ok(text.includes("Source culture   80.0 mL\nFresh medium    160.0 mL"), text);
  assert.ok(text.includes("Combine A and B · mix gently\nIncubate · 9:30\nAdd to the culture  10.000 mL"), text);
  assert.ok(lines.every((l) => !/ $/.test(l)));
  assert.equal(plan.warnings.length, 0);
});

test("single-run copy text without a source, and the report readings", () => {
  const mk = (source) => {
    const batch = E.batchPlan(D.lab(), [{ id: "r1", name: "T", cultureVolumePerFlask: 0.24, flaskCount: 1,
      plasmids: [{ name: "Plasmid", stockConcentration: ngPerUL(1000), ratioPart: 1 }], ratioBasis: "mass" }], 0, 1.04e6 * perML, source == null ? null : source * perML);
    return { batch, rep: { date: new Date(2026, 9, 14), defaults: D.lab(), run: batch.runs[0], recipe: E.batchRecipe(D.lab(), batch).runs[0].recipe,
      excessPct: 0, seedingDensityPerML: 1.04e6, sourceDensityPerML: source, flaskTitle: "1 L", plasmidCount: 1, ratioBasis: "mass" } };
  };
  assert.ok(E.singlePlainText(mk(null).rep).includes("Cells: 2.496 × 10⁸ live\n(count the source flask for source and medium volumes)"));
  const r = E.reportReadings(mk(3.12e6).rep);
  assert.equal(r.cultureText, "240.0 mL");
  assert.equal(r.mixText, "10.000 mL");
  assert.equal(r.flaskText, "1 L flask");
  close(r.finalDensityPerML, 0.9984e6, 1);
  assert.deepEqual(r.resultRows.map((x) => x[0]), ["Total DNA", "PEI", "Cells needed", "Source + medium", "Final volume"]);
  assert.deepEqual(r.resultRows.map((x) => x[1]), ["240 µg", "480 µg = 480 µL of stock", "2.496 × 10⁸ live cells", "80.0 mL + 160.0 mL", "250.0 mL"]);
  assert.ok(!r.settingsRows.some((x) => x[0] === "Ratio basis"));
  assert.deepEqual(r.settingsRows.filter((x) => ["Culture : mix", "Incubation", "Mixing"].includes(x[0])),
    [["Mixing", "Two tubes"], ["Culture : mix", "24 : 1"], ["Incubation", "9:30"]]);
  const src = E.singlePlainText(mk(0.5e6).rep);
  assert.ok(src.includes("is below the 1.04 × 10⁶/mL seeding density"));
  assert.ok(!src.includes("Source culture"));
  assert.ok(E.reportReadings(mk(0.5e6).rep).resultRows.every((x) => x[0] !== "Source + medium"));
});

// ---------------------------------------------------------------- Batch (the brief's worked example)
// T1 "mAb-1 ×3": 240 mL x 3 flasks, one plasmid at 1000 ng/µL.
// T2 "Reporter": 60 mL x 1 flask, two plasmids 1 : 1 at 500 and 2000 ng/µL.
// Lab defaults, seeding 1.04e6/mL from a 3.12e6/mL source.
const seeding = 1.04e6 * perML, source = 3.12e6 * perML;
const plasmid = (name, stock, part) => ({ name, stockConcentration: ngPerUL(stock), ratioPart: part == null ? 1 : part });
const t1 = () => ({ id: "t1", name: "mAb-1 ×3", cultureVolumePerFlask: 0.24, flaskCount: 3, plasmids: [plasmid("pHC", 1000)], ratioBasis: "mass" });
const t2 = () => ({ id: "t2", name: "Reporter", cultureVolumePerFlask: 0.06, flaskCount: 1, plasmids: [plasmid("pGFP", 500), plasmid("pLuc", 2000)], ratioBasis: "mass" });
const batch = (runs, o) => {
  o = o || {};
  return E.batchPlan(o.defaults || D.lab(), runs || [t1(), t2()], o.excess || 0, seeding, "source" in o ? o.source : source);
};
const assertML = (liters, want, what) => { assert.notEqual(liters, null, what); close(liters * 1000, want, 1e-6, what); };
const assertUG = (grams, want, what) => { assert.notEqual(grams, null, what); close(grams * 1e6, want, 1e-6, what); };
const litersOf = (a) => {
  if (!a) return null;
  const v = parseFloat(a.number.replace(/,/g, ""));
  return a.unit === "µL" ? v * 1e-6 : (a.unit === "mL" ? v * 1e-3 : v);
};
const lineOf = (tube, name) => tube.plasmids.filter((l) => l.name === name)[0];

test("T1 solves all three flasks from one set of tubes", () => {
  const r = batch().run("t1");
  assert.equal(r.name, "mAb-1 ×3"); assert.equal(r.flaskCount, 3);
  assertML(r.cultureVolumePerFlask, 240); assertML(r.totalCulture, 720); assertML(r.mixVolumePerFlask, 10);
  assertUG(r.plan.totalDNAMass, 720); assertUG(r.plan.peiMass, 1440); assertML(r.plan.peiStockVolume, 1.44); assertML(r.plan.mixVolume, 30);
  assertML(r.plan.dnaTube.totalVolume, 15); assertML(r.plan.dnaTube.diluentVolume, 14.28);
  assertML(lineOf(r.plan.dnaTube, "pHC").stockVolume, 0.72);
  assert.equal(r.plan.dnaTube.peiVolume, null);
  assertML(r.plan.peiTube.totalVolume, 15); assertML(r.plan.peiTube.diluentVolume, 13.56); assertML(r.plan.peiTube.peiVolume, 1.44);
  assert.equal(E.isFeasible(r.plan), true);
});

test("T2 splits its DNA 1:1 by mass", () => {
  const r = batch().run("t2");
  assert.equal(r.flaskCount, 1);
  assertML(r.totalCulture, 60); assertML(r.mixVolumePerFlask, 2.5); assertUG(r.plan.totalDNAMass, 60);
  assertUG(lineOf(r.plan.dnaTube, "pGFP").mass, 30); assertUG(lineOf(r.plan.dnaTube, "pLuc").mass, 30);
  assertML(lineOf(r.plan.dnaTube, "pGFP").stockVolume, 0.06); assertML(lineOf(r.plan.dnaTube, "pLuc").stockVolume, 0.015);
  assertML(r.plan.peiStockVolume, 0.12); assertML(r.plan.dnaTube.totalVolume, 1.25); assertML(r.plan.dnaTube.diluentVolume, 1.175);
  assertML(r.plan.peiTube.totalVolume, 1.25); assertML(r.plan.peiTube.diluentVolume, 1.13); assertML(r.plan.peiTube.peiVolume, 0.12);
});

test("runs keep their input order", () => {
  const p = batch([t2(), t1()]);
  assert.deepEqual(p.runs.map((r) => r.id), ["t2", "t1"]);
  assert.deepEqual(p.runs.map((r) => r.name), ["Reporter", "mAb-1 ×3"]);
});

test("cells are per flask", () => {
  const p = batch();
  const r1 = p.run("t1");
  assertML(r1.cells.cultureVolume, 240); assertML(r1.cells.sourceVolume, 80); assertML(r1.cells.mediaVolume, 160); assertML(r1.cells.mixVolume, 10);
  close(r1.cells.cellsNeeded, 2.496e8, 1);
  assert.equal(r1.cells.sourceBelowSeeding, false);
  const r2 = p.run("t2");
  assertML(r2.cells.sourceVolume, 20); assertML(r2.cells.mediaVolume, 40); assertML(r2.cells.mixVolume, 2.5);
});

test("the master mix makes every Tube B at once", () => {
  const m = batch().masterMix;
  assertML(m.diluentVolume, 14.69); assertML(m.peiVolume, 1.56); assertML(m.totalVolume, 16.25);
  assert.deepEqual(m.portions.map((p) => p.id), ["t1", "t2"]);
  assert.deepEqual(m.portions.map((p) => p.name), ["mAb-1 ×3", "Reporter"]);
  assertML(m.portions[0].volume, 15); assertML(m.portions[1].volume, 1.25);
  assertML(m.portions.reduce((a, p) => a + p.volume, 0), 16.25);
});

test("the master mix has one PEI concentration for every portion (96 µg/mL)", () => {
  const p = batch(), m = p.masterMix;
  close(m.peiVolume * 1 * 1e6 / (m.totalVolume * 1000), 96, 1e-9);
  p.runs.forEach((r) => close(r.plan.peiTube.peiVolume * 1e6 / (r.plan.peiTube.totalVolume * 1000), 96, 1e-9, r.name));
  close(m.peiConcentration(1) * 1000, 96, 1e-9);
  assertML(m.portion("t2").volume, 1.25);
  assert.equal(m.portion("nope"), null);
});

test("no master mix for one run, or in one-tube mode", () => {
  assert.equal(batch([t1()]).masterMix, null);
  assert.equal(batch([t2()]).masterMix, null);
  const d = D.lab(); d.mixingMode = "oneTube";
  const p = batch(null, { defaults: d });
  assert.equal(p.masterMix, null);
  assert.ok(p.runs.every((r) => r.plan.peiTube === null));
  assertML(p.run("t1").plan.dnaTube.diluentVolume, 27.84);
  assertML(p.totals.diluentVolume, 27.84 + (2.5 - 0.075 - 0.12));
  assertML(p.totals.peiStockVolume, 1.56);
});

test("totals for the shelf", () => {
  const t = batch().totals;
  assert.equal(t.runCount, 2); assert.equal(t.flaskCount, 4);
  assertML(t.culture, 780); assertML(t.mix, 32.5); assertUG(t.dnaMass, 780); assertUG(t.peiMass, 1560); assertML(t.peiStockVolume, 1.56);
  assertML(t.diluentVolume, 30.145);
  close(t.cellsNeeded, 1.04e9 * 0.78, 1e3);
  assertML(t.sourceVolume, 260); assertML(t.mediaVolume, 520);
});

test("total diluent equals the Tube A diluents plus the master mix", () => {
  const p = batch();
  const tubeA = p.runs.reduce((a, r) => a + r.plan.dnaTube.diluentVolume, 0);
  assertML(p.totals.diluentVolume, (tubeA + p.masterMix.diluentVolume) * 1000);
});

test("totals per plasmid", () => {
  const t = batch().totals;
  assert.deepEqual(t.plasmids.map((p) => p.name), ["pHC", "pGFP", "pLuc"]);
  const hc = t.plasmids.filter((p) => p.name === "pHC")[0];
  assertUG(hc.mass, 720); assertML(hc.volume, 0.72); assert.equal(hc.runCount, 1);
  close(hc.stockConcentration, ngPerUL(1000), 1e-12);
  assertML(t.plasmids[1].volume, 0.06); assertML(t.plasmids[2].volume, 0.015);
  assertUG(t.plasmids.reduce((a, p) => a + p.mass, 0), 780);
});

test("the same plasmid across runs is one total; a different stock or name stays separate", () => {
  const t3 = { id: "t3", name: "mAb-1 small", cultureVolumePerFlask: 0.12, flaskCount: 2, plasmids: [plasmid("pHC", 1000)], ratioBasis: "mass" };
  const t = batch([t1(), t2(), t3]).totals;
  const hc = t.plasmids.filter((p) => p.name === "pHC");
  assert.equal(hc.length, 1); assert.equal(hc[0].runCount, 2);
  assertUG(hc[0].mass, 720 + 240); assertML(hc[0].volume, 0.96);
  assert.equal(t.plasmids.length, 3);
  assert.equal(new Set(t.plasmids.map((p) => p.id)).size, t.plasmids.length);
  const newPrep = { id: "t4", name: "New prep", cultureVolumePerFlask: 0.24, flaskCount: 1, plasmids: [plasmid("pHC", 2000)], ratioBasis: "mass" };
  const two = batch([t1(), newPrep]).totals.plasmids.filter((p) => p.name === "pHC");
  assert.equal(two.length, 2);
  assertML(two.filter((p) => p.stockConcentration === ngPerUL(1000))[0].volume, 0.72);
  assertML(two.filter((p) => p.stockConcentration === ngPerUL(2000))[0].volume, 0.12);
  const other = { id: "t5", name: "Other", cultureVolumePerFlask: 0.24, flaskCount: 1, plasmids: [plasmid("pLC", 1000)], ratioBasis: "mass" };
  assert.deepEqual(batch([t1(), other]).totals.plasmids.map((p) => p.name), ["pHC", "pLC"]);
});

test("source totals need every run's source", () => {
  const t = batch(null, { source: null }).totals;
  assert.equal(t.sourceVolume, null); assert.equal(t.mediaVolume, null);
  close(t.cellsNeeded, 1.04e9 * 0.78, 1e3);
  const thin = batch(null, { source: 0.8e6 * perML }).totals;
  assert.equal(thin.sourceVolume, null); assert.equal(thin.mediaVolume, null);
});

test("excess scales every tube and the master mix but not the flask dose", () => {
  const p = batch(null, { excess: 0.05 });
  const r1 = p.run("t1");
  assertML(r1.mixVolumePerFlask, 10); assertML(r1.plan.mixVolume, 30); assertUG(r1.plan.totalDNAMass, 756);
  assertML(r1.plan.dnaTube.totalVolume, 15.75); assertML(r1.plan.dnaTube.diluentVolume, 15.75 - 0.756);
  assertML(r1.plan.peiTube.totalVolume, 15.75); assertML(r1.plan.peiTube.peiVolume, 1.512);
  const r2 = p.run("t2");
  assertML(r2.mixVolumePerFlask, 2.5); assertML(r2.plan.dnaTube.totalVolume, 1.3125);
  assertML(lineOf(r2.plan.dnaTube, "pGFP").stockVolume, 0.063); assertML(lineOf(r2.plan.dnaTube, "pLuc").stockVolume, 0.01575);
  const m = p.masterMix;
  assertML(m.totalVolume, 17.0625); assertML(m.peiVolume, 1.638); assertML(m.portions[0].volume, 15.75); assertML(m.portions[1].volume, 1.3125);
  assertML(p.totals.peiStockVolume, 1.638); assertUG(p.totals.dnaMass, 819); assertML(p.totals.diluentVolume, 30.145 * 1.05);
  assertML(p.totals.mix, 32.5); assertML(p.totals.sourceVolume, 260);
});

test("an infeasible run makes the batch infeasible and names the run", () => {
  const bad = t2(); bad.plasmids = [plasmid("pDilute", 10)]; // 60 µg at 10 ng/µL = 6 mL > T2's 1.25 mL Tube A
  const p = batch([t1(), bad]);
  assert.equal(p.isFeasible, false);
  assert.equal(E.isFeasible(p.run("t1").plan), true);
  assert.equal(E.isFeasible(p.run("t2").plan), false);
  assert.ok(kinds(p.run("t2").plan).includes("plasmidVolumeExceedsTube:pDilute"));
  assert.equal(batch().isFeasible, true);
  assert.deepEqual(p.infeasibleRuns.map((x) => x.name), ["Reporter"]);
  assert.ok(p.infeasibleRuns[0].reason.length > 0);
  assert.deepEqual(batch().infeasibleRuns, []);
  // Overflowing batch: no master mix, no totals, each run keeps its own Tube B lines.
  assert.equal(p.masterMix, null);
  assert.equal(p.showsTotals, false);
  assert.equal(p.suggestsMasterMixExcess(0), false);
  const recipe = E.batchRecipe(D.lab(), p);
  assert.equal(recipe.masterMix, null);
  assert.deepEqual(recipe.portionItems, []);
  assert.deepEqual(R.section(recipe.group("t1").recipe, "b").items.map((i) => i.name), ["OptiPRO SFM", "PEI"]);
  assert.equal(batch().showsTotals, true);
});

test("a molar run without a size has no batch; no runs, no batch", () => {
  const molar = t2(); molar.ratioBasis = "molar";
  assert.equal(batch([t1(), molar]), null);
  assert.equal(batch([]), null);
});

test("a flask count below one reads as one", () => {
  const zero = t2(); zero.flaskCount = 0;
  const r = batch([zero]).run("t2");
  assert.equal(r.flaskCount, 1); assertML(r.plan.mixVolume, 2.5); assertML(r.totalCulture, 60);
});

test("one run, one flask is the single-run plan", () => {
  const one = { id: "t1", name: "Transfection 1", cultureVolumePerFlask: 0.24, flaskCount: 1, plasmids: [plasmid("Plasmid", 1000)], ratioBasis: "mass" };
  const p = batch([one]);
  const d = D.lab();
  const single = E.plan({
    cultureVolume: 0.24, mixVolume: 0.24 * D.mixFraction(d), dnaDosePerLiter: ugPerML(d.doseUgPerML), peiToDNAMassRatio: d.peiToDNARatio,
    peiStockConcentration: mgPerML(d.peiStockMgPerML), plasmids: [plasmid("Plasmid", 1000)], ratioBasis: "mass", mixingMode: d.mixingMode,
    excessFraction: 0, cellDensity: seeding
  });
  assert.deepEqual(p.runs[0].plan, single);
  assert.equal(p.masterMix, null);
  const cells = E.cellPlan(0.24, seeding, source, 0.24 * D.mixFraction(d));
  assert.deepEqual(p.runs[0].cells, cells);
  const br = E.batchRecipe(d, p);
  const recipe = R.build(d, single, cells, 0.24);
  assert.equal(br.masterMix, null);
  assert.deepEqual(br.runs[0].recipe, recipe);
  assert.deepEqual(br.allItems.map((i) => i.id), R.allItems(recipe).map((i) => i.id));
  assert.deepEqual(br.runs[0].recipe.sections.map(R.tubeLetter).filter(Boolean), ["A", "B"]);
  assertML(p.totals.diluentVolume, 4.76 + 4.52); assertML(p.totals.peiStockVolume, 0.48);
  assertML(p.totals.sourceVolume, 80); assertML(p.totals.mediaVolume, 160);
});

test("recipe ids are unique across the batch and carry their run", () => {
  const t3 = { id: "t3", name: "mAb-1 again", cultureVolumePerFlask: 0.24, flaskCount: 1, plasmids: [plasmid("pHC", 1000)], ratioBasis: "mass" };
  const recipe = E.batchRecipe(D.lab(), batch([t1(), t2(), t3]));
  const ids = recipe.allItems.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, ids.sort().join());
  const sectionIDs = (recipe.masterMix ? [recipe.masterMix.id] : []).concat(recipe.runs.flatMap((g) => g.recipe.sections.map((s) => s.id)));
  assert.equal(new Set(sectionIDs).size, sectionIDs.length);
  assert.deepEqual(recipe.runs.map((g) => g.id), ["t1", "t2", "t3"]);
  const r = E.batchRecipe(D.lab(), batch());
  r.runs.forEach((g) => R.allItems(g.recipe).forEach((i) => assert.ok(i.id.indexOf(g.id) === 0, i.id)));
  r.runs.forEach((g) => assert.ok(g.recipe.sections.map(R.tubeLetter).includes("A"), g.name));
  assert.equal(R.tubeLetter(r.runs[0].recipe.sections.filter(R.tubeLetter)[0]), "A");
  assert.deepEqual(r.runs.map((g) => g.name), ["mAb-1 ×3", "Reporter"]);
  assert.deepEqual(r.runs.map((g) => g.flaskCount), [3, 1]);
});

test("master mix section, and the checklist pipettes each reagent once", () => {
  const p = batch();
  const recipe = E.batchRecipe(D.lab(), p);
  const master = recipe.masterMix;
  assertML(litersOf(master.items.filter((i) => i.name === "OptiPRO SFM")[0].amount), 14.69);
  const pei = master.items.filter((i) => i.name === "PEI")[0];
  assertML(litersOf(pei.amount), 1.56); assertUG(pei.mass, 1560);
  assert.equal(E.batchRecipe(D.lab(), batch([t1()])).masterMix, null);
  assertML(recipe.allItems.filter((i) => i.name === "PEI").map((i) => litersOf(i.amount)).filter((x) => x != null).reduce((a, b) => a + b, 0), 1.56);
  assertML(recipe.allItems.filter((i) => i.name === "OptiPRO SFM").map((i) => litersOf(i.amount)).reduce((a, b) => a + b, 0), 30.145);
  assertUG(recipe.allItems.filter((i) => ["pHC", "pGFP", "pLuc"].includes(i.name)).map((i) => i.mass).reduce((a, b) => a + b, 0), 780);
  assert.ok(master.items[0].note.includes("50 mL conical"), master.items[0].note);
  assert.ok(master.items[1].note.includes("96"), master.items[1].note);
});

test("run groups have their Tube A and per-flask cells; the add line is per flask", () => {
  const recipe = E.batchRecipe(D.lab(), batch(null, { excess: 0.05 }));
  const g1 = recipe.group("t1");
  const a = g1.recipe.sections.filter((s) => R.tubeLetter(s) === "A")[0];
  assertML(litersOf(a.items.filter((i) => i.name === "OptiPRO SFM")[0].amount), 15.75 - 0.756 - 0, "T1 Tube A diluent +5%");
  assertML(litersOf(R.allItems(g1.recipe).filter((i) => i.name === "Source culture")[0].amount), 80);
  assertML(litersOf(R.allItems(g1.recipe).filter((i) => i.name === "Fresh medium")[0].amount), 160);
  assertML(litersOf(R.allItems(g1.recipe).filter((i) => /add$/.test(i.id))[0].amount), 10, "nominal per flask even with excess");
  assertML(litersOf(R.allItems(recipe.group("t2").recipe).filter((i) => /add$/.test(i.id))[0].amount), 2.5);
  assert.ok(R.allItems(g1.recipe).filter((i) => R.baseID(i.id) === "add")[0].name.includes("3 flasks"));
});

test("one shared Incubate for the batch", () => {
  const recipe = E.batchRecipe(D.lab(), batch());
  assert.equal(recipe.incubate.id, "incubate");
  assert.equal(recipe.allItems.filter((i) => i.name === "Incubate").length, 1);
  recipe.runs.forEach((g) => assert.ok(!R.allItems(g.recipe).some((i) => i.name === "Incubate"), g.name));
  const one = E.batchRecipe(D.lab(), batch([t1()]));
  assert.equal(one.incubate, null);
  assert.notEqual(R.item(one.runs[0].recipe, "incubate"), null);
});

test("each run's Tube B is its master mix portion", () => {
  const recipe = E.batchRecipe(D.lab(), batch());
  assert.deepEqual(recipe.portionItems.map((p) => p.id), ["t1", "t2"]);
  assert.deepEqual(recipe.portionItems.map((p) => p.name), ["mAb-1 ×3", "Reporter"]);
  assertML(litersOf(recipe.portionItems[0].item.amount), 15); assertML(litersOf(recipe.portionItems[1].item.amount), 1.25);
  recipe.runs.forEach((g) => {
    const b = R.section(g.recipe, "b");
    assert.equal(R.tubeLetter(b), "B");
    assert.equal(b.items.length, 1);
    assert.deepEqual(b.items[0], g.portionItem);
    assert.equal(b.items[0].id, g.id + ".b.master");
  });
  assert.ok(recipe.portionItems.every((p) => recipe.allItems.indexOf(p.item) >= 0));
  const oneTube = D.lab(); oneTube.mixingMode = "oneTube";
  assert.deepEqual(E.batchRecipe(oneTube, batch(null, { defaults: oneTube })).portionItems, []);
  const single = E.batchRecipe(D.lab(), batch([t1()]));
  assert.deepEqual(single.portionItems, []);
  assert.equal(single.runs[0].portionItem, null);
  assert.equal(R.section(single.runs[0].recipe, "b").items.map((i) => i.name).pop(), "PEI");
});

test("section lookup sees through run prefixes", () => {
  const recipe = E.batchRecipe(D.lab(), batch());
  const g1 = recipe.group("t1");
  assert.equal(R.section(g1.recipe, "a").id, "t1.a");
  assert.equal(R.baseID(R.section(g1.recipe, "a").id), "a");
  assert.deepEqual(R.tubeSections(g1.recipe).map((s) => R.baseID(s.id)), ["a", "b"]);
  assert.deepEqual(R.tubeSections(g1.recipe).map(R.tubeLetter), ["A", "B"]);
  assert.equal(recipe.group("nope"), null);
  assert.notEqual(recipe.item("master.pei"), null);
  assert.equal(recipe.group("t1").flasksText, "240 mL × 3 flasks");
  assert.equal(recipe.group("t2").flasksText, "60 mL");
});

test("one run, many flasks reads per flask", () => {
  const p = batch([t1()]);
  assert.equal(p.masterMix, null);
  const recipe = E.batchRecipe(D.lab(), p);
  close(litersOf(recipe.item("a.diluent").amount), 0.01428, 1e-9);
  assertML(litersOf(recipe.runs[0].recipe.sections.reduce((a, s) => a.concat(s.items), []).filter((i) => i.id === "add")[0].amount), 10);
  assertML(litersOf(R.item(recipe.runs[0].recipe, "cells.source").amount), 80);
});

test("flasks text", () => {
  assert.equal(T.flasks(3, 0.24), "240 mL × 3 flasks");
  assert.equal(T.flasks(1, 0.24), "240 mL");
  assert.equal(T.flasks(1, 0.06), "60 mL");
  assert.equal(T.flasks(2, 1), "1 L × 2 flasks");
  assert.equal(T.flaskCount(1), "1 flask");
  assert.equal(T.flaskCount(4), "4 flasks");
});

test("tube hint thresholds (90 % fill)", () => {
  const cases = [[0, "1.5 mL tube"], [1.25, "1.5 mL tube"], [1.35, "1.5 mL tube"], [1.4, "5 mL tube"], [1.5, "5 mL tube"],
    [4.5, "5 mL tube"], [4.6, "15 mL conical"], [5, "15 mL conical"], [13.5, "15 mL conical"], [13.6, "50 mL conical"],
    [15, "50 mL conical"], [16.25, "50 mL conical"], [45, "50 mL conical"], [45.5, "bottle"], [50, "bottle"], [500, "bottle"]];
  cases.forEach(([ml, hint]) => assert.equal(T.tubeHint(ml / 1000), hint, ml + " mL"));
  assert.equal(T.tubeHint(NaN), "1.5 mL tube");
  assert.equal(T.tubeHint(-1), "1.5 mL tube");
});

test("tube hints for the worked example", () => {
  const p = batch();
  const r1 = p.run("t1");
  assert.equal(r1.plan.dnaTube.tubeHint, "50 mL conical"); // a full 15 mL conical leaves no room to mix
  assert.equal(r1.plan.peiTube.tubeHint, "50 mL conical");
  const r2 = p.run("t2");
  assert.equal(r2.plan.dnaTube.tubeHint, "1.5 mL tube"); assert.equal(r2.plan.peiTube.tubeHint, "1.5 mL tube");
  assert.equal(p.masterMix.tubeHint, "50 mL conical");
  assert.equal(batch(null, { excess: 0.2 }).run("t2").plan.dnaTube.tubeHint, "5 mL tube");
});

test("master mix excess hint", () => {
  const p = batch();
  assert.equal(p.suggestsMasterMixExcess(0), true);
  assert.equal(p.suggestsMasterMixExcess(5), false);
  assert.equal(p.suggestsMasterMixExcess(20), false);
  assert.equal(batch([t1()]).suggestsMasterMixExcess(0), false);
  const oneTube = D.lab(); oneTube.mixingMode = "oneTube";
  assert.equal(batch(null, { defaults: oneTube }).suggestsMasterMixExcess(0), false);
  assert.ok(T.masterMixExcessHint.includes("+5 %"));
});

test("reagent lines for the shelf", () => {
  const lines = E.reagentLines(batch(), D.lab());
  const hcID = "plasmid.pHC|" + ngPerUL(1000);
  assert.equal(lines[0].id, "pei");
  assert.deepEqual(lines.slice(0, 2).map((l) => l.id), ["pei", "diluent"]);
  assert.deepEqual(lines.slice(-3).map((l) => l.id), ["cells", "source", "medium"]);
  assert.deepEqual(lines.filter((l) => l.id.indexOf("plasmid.") === 0).map((l) => l.name), ["pHC", "pGFP", "pLuc"]);
  assert.equal(new Set(lines.map((l) => l.id)).size, lines.length);
  const line = (id) => lines.filter((l) => l.id === id)[0];
  assertML(litersOf(line("pei").amount), 1.56); assertUG(line("pei").mass, 1560);
  assert.equal(line("pei").text, "1.560 mL");
  assertML(litersOf(line("diluent").amount), 30.145);
  assert.equal(line("diluent").name, "OptiPRO SFM");
  assertML(litersOf(line(hcID).amount), 0.72); assertUG(line(hcID).mass, 720);
  assertML(litersOf(line("source").amount), 260); assertML(litersOf(line("medium").amount), 520);
  assert.equal(line("cells").amount, null);
  assert.ok(line("cells").text.length > 0);
  assert.equal(line("pei").note, "1 mg/mL stock");
  assert.equal(line("diluent").note, "every Tube A + the master mix");
  assert.equal(line(hcID).note, "1000 ng/µL · 1 transfection");
});

test("reagent lines count transfections per plasmid, and skip volumes without a source", () => {
  const t3 = { id: "t3", name: "mAb-1 small", cultureVolumePerFlask: 0.12, flaskCount: 2, plasmids: [plasmid("pHC", 1000)], ratioBasis: "mass" };
  const hc = E.reagentLines(batch([t1(), t2(), t3]), D.lab()).filter((l) => l.name === "pHC")[0];
  assert.ok(hc.note.includes("2 transfections"), hc.note);
  assertML(litersOf(hc.amount), 0.96);
  const lines = E.reagentLines(batch(null, { source: null }), D.lab());
  assert.notEqual(lines.filter((l) => l.id === "cells")[0], undefined);
  assert.equal(lines.filter((l) => l.id === "source")[0], undefined);
  assert.equal(lines.filter((l) => l.id === "medium")[0], undefined);
});

test("batch copy text carries the shelf check, master mix, run blocks, hint and warnings", () => {
  const p = batch(null, { excess: 0 });
  const rep = { date: new Date(2026, 9, 15), defaults: D.lab(), excessPct: 0, seedingDensityPerML: 1.04e6, batch: p, recipe: E.batchRecipe(D.lab(), p) };
  const text = E.batchPlainText(rep);
  assert.ok(text.startsWith("PEI transfections · 2026-10-15\n2 transfections · 4 flasks · 780.0 mL of culture\n"), text);
  assert.ok(text.includes("Reagents needed"));
  assert.ok(text.includes("PEI master mix · 16.250 mL in a 50 mL conical"));
  assert.ok(text.includes("→ mAb-1 ×3"));
  assert.ok(text.includes("! " + T.masterMixExcessHint));
  assert.ok(text.includes("== mAb-1 ×3 · 240 mL × 3 flasks =="));
  assert.ok(text.includes("== Reporter · 60 mL =="));
  assert.ok(text.includes("Incubate all together · 9:30, then add each to its flasks"));
  assert.ok(text.split("\n").every((l) => !/\s$/.test(l)));
  // An overflowing run: no totals, the run says why.
  const bad = t2(); bad.plasmids = [plasmid("pDilute", 10)];
  const q = batch([t1(), bad]);
  const t = E.batchPlainText({ date: new Date(2026, 9, 15), defaults: D.lab(), excessPct: 0, seedingDensityPerML: 1.04e6, batch: q, recipe: E.batchRecipe(D.lab(), q) });
  assert.ok(t.includes("Totals not worked out until every transfection's tubes fit:"));
  assert.ok(t.includes("Reporter: ") && t.includes("pDilute's stock is too dilute"));
  assert.ok(t.includes("Tubes not made: "));
  assert.ok(!t.includes("30.145 mL"));
  assert.equal(E.headline(batch()), "2 transfections · 4 flasks · 780.0 mL of culture");
  assert.equal(E.protocolRows(D.lab(), 0, 1.04e6, null)[9][1], "not counted");
});

// ---------------------------------------------------------------- Model (typed text -> plan)
const defaultsRaw = () => ({
  ratio: "2", dose: "1", peiStock: "1", diluent: "OptiPRO SFM", mixingMode: "twoTubes", mixRef: "10", cultureRef: "240",
  incubationMin: "9", incubationSec: "30", cultureUnit: "mL", seedingMillions: "1.04", excessPct: 0
});
function rawExample() {
  // T1 "mAb-1 ×3" 240 mL x 3 at 1000 ng/µL; T2 "Reporter" 60 mL, pGFP 500 + pLuc 2000; source 3.12e6/mL.
  const r1 = M.newRun(), r2 = M.newRun();
  r1.nameText = "mAb-1 ×3"; r1.flaskText = "3"; r1.plasmids[0].nameText = "pHC"; r1.plasmids[0].stockText = "1000";
  r2.nameText = "Reporter"; r2.cultureText = "60"; r2.plasmids[0].nameText = "pGFP"; r2.plasmids[0].stockText = "500";
  const p2 = M.newPlasmidRow(); p2.nameText = "pLuc"; p2.stockText = "2000"; r2.plasmids.push(p2);
  return { defaults: defaultsRaw(), sourceMillions: "3.12", runs: [r1, r2] };
}
const compute = (raw) => M.compute(raw, ".");

test("model: the worked example through the typed fields", () => {
  const r = compute(rawExample());
  assert.equal(r.message, null);
  assert.equal(r.isBatch, true);
  assert.deepEqual(r.batch.runs.map((x) => x.name), ["mAb-1 ×3", "Reporter"]);
  assertML(r.batch.masterMix.diluentVolume, 14.69); assertML(r.batch.masterMix.peiVolume, 1.56); assertML(r.batch.masterMix.totalVolume, 16.25);
  assertML(r.batch.totals.diluentVolume, 30.145); assertUG(r.batch.totals.dnaMass, 780);
  assertML(r.batch.totals.sourceVolume, 260); assertML(r.batch.totals.mediaVolume, 520);
  assert.deepEqual(r.batch.totals.plasmids.map((p) => p.name), ["pHC", "pGFP", "pLuc"]);
  assert.equal(r.batch.isFeasible, true);
  assert.deepEqual(r.warnings, []);
});

test("model: one run is not a batch and reads like today's single recipe", () => {
  const raw = { defaults: defaultsRaw(), sourceMillions: "3.12", runs: [M.newRun()] };
  raw.runs[0].plasmids[0].stockText = "1000";
  const r = compute(raw);
  assert.equal(r.isBatch, false);
  const g = r.recipe.runs[0];
  const t = (id) => R.item(g.recipe, id).amount.text;
  assert.equal(t("a.diluent"), "4.760 mL"); assert.equal(t("a.plasmid.p" + raw.runs[0].plasmids[0].id.slice(1)), "240 µL");
  assert.equal(t("b.diluent"), "4.520 mL"); assert.equal(t("b.pei"), "480 µL");
  assert.equal(t("cells.source"), "80.0 mL"); assert.equal(t("cells.media"), "160.0 mL"); assert.equal(t("add"), "10.000 mL");
  assert.equal(g.name, "Transfection 1");
  assert.equal(r.batch.totals.plasmids.map((p) => p.name)[0], "Plasmid");
  raw.runs[0].flaskText = "2";
  assert.equal(compute(raw).isBatch, true);
});

test("model: mix volume follows the settings ratio", () => {
  const raw = { defaults: defaultsRaw(), sourceMillions: "3.12", runs: [M.newRun()] };
  raw.runs[0].plasmids[0].stockText = "1000";
  raw.defaults.mixRef = "12"; // 12 mL per 240 mL
  let r = compute(raw);
  assert.equal(R.item(r.recipe.runs[0].recipe, "add").amount.text, "12.000 mL");
  assertML(r.batch.runs[0].cells.finalVolume, 252);
  raw.defaults.mixRef = "10";
  raw.runs[0].cultureText = "2.5"; raw.runs[0].cultureUnit = "L";
  r = compute(raw);
  assert.equal(R.item(r.recipe.runs[0].recipe, "add").amount.text, "104.167 mL");
  raw.defaults.mixRef = "0";
  r = compute(raw);
  assert.equal(r.batch, null);
  assert.ok(r.message.indexOf("defaults") >= 0, r.message);
});

test("model: flask presets, units and the culture field", () => {
  assert.equal(M.volumeText(0.03, "mL"), "30"); assert.equal(M.volumeText(0.48, "mL"), "480");
  assert.equal(M.volumeText(0.48, "L"), "0.48"); assert.equal(M.volumeText(0.06, "L"), "0.06");
  assert.equal(M.switchUnit("240", "mL", "L", "."), "0.24");
  assert.equal(M.switchUnit("0.24", "L", "mL", "."), "240");
  assert.equal(M.switchUnit("240", "mL", "mL", "."), "240");
  assert.equal(M.switchUnit("", "mL", "L", "."), "");
  assert.equal(M.flaskFor("0.25", "L", ".").id, "custom");
  assert.equal(M.flaskFor("0.24", "L", ".").id, "L1");
  assert.equal(M.flaskFor("240,0", "mL", ",").id, "L1"); // a decimal comma reads as a point where it's the mark
  assert.equal(M.flaskFor("", "mL", ".").id, "custom");
  [["0.03", "mL125"], ["0.06", "mL250"], ["0.12", "mL500"], ["0.24", "L1"], ["0.48", "L2"]].forEach(([text, id]) => assert.equal(M.flaskFor(text, "L", ".").id, id));
  close(M.cultureLiters("2.5", "L", "."), 2.5, 1e-12);
  assert.equal(M.flaskFor("0.12", "L", ".").id, "mL500");
});

test("model: culture field nonsense gives no numbers", () => {
  ["0", "-240", "abc", "  "].forEach((text) => {
    const raw = { defaults: defaultsRaw(), sourceMillions: "", runs: [M.newRun()] };
    raw.runs[0].plasmids[0].stockText = "1000"; raw.runs[0].cultureText = text;
    const r = compute(raw);
    assert.equal(r.batch, null, text);
    assert.equal(r.message, "Enter the culture volume.");
  });
});

test("model: cell plan from the fields and an unusable source", () => {
  const raw = { defaults: defaultsRaw(), sourceMillions: "3.12", runs: [M.newRun()] };
  raw.runs[0].plasmids[0].stockText = "1000";
  let r = compute(raw);
  assertML(r.batch.runs[0].cells.sourceVolume, 80); assertML(r.batch.runs[0].cells.mediaVolume, 160);
  close(r.batch.runs[0].cells.finalDensity / 1000, 0.9984e6, 1);
  raw.sourceMillions = "abc";
  r = compute(raw);
  assert.equal(r.sourceDensityInvalid, true);
  assert.equal(r.batch.runs[0].cells.sourceVolume, null);
  assert.ok(r.warnings.some((w) => /source density/i.test(w.text)));
  raw.sourceMillions = "";
  assert.equal(compute(raw).sourceDensityInvalid, false);
  raw.defaults.seedingMillions = "";
  r = compute(raw);
  assert.equal(r.batch, null);
  assert.equal(r.message, "Enter the seeding density.");
});

test("model: one plasmid ignores part and basis; adding a second brings them back", () => {
  const raw = { defaults: defaultsRaw(), sourceMillions: "", runs: [M.newRun()] };
  const run = raw.runs[0];
  run.plasmids[0].stockText = "1000"; run.plasmids[0].partText = "0"; run.ratioBasis = "molar";
  let r = compute(raw);
  run.ratioBasis = "molar";
  assert.equal(r.runInputs[0].ratioBasis, "mass");
  assert.equal(r.runInputs[0].plasmids[0].ratioPart, 1);
  assert.equal(r.runInputs[0].plasmids[0].sizeBasePairs, null);
  assertUG(r.batch.runs[0].plan.plasmids[0].mass, 240);
  run.plasmids[0].partText = "abc"; run.plasmids[0].sizeText = "xyz";
  assert.notEqual(compute(raw).batch, null);
  run.plasmids[0].partText = "1"; run.plasmids[0].sizeText = "";
  run.ratioBasis = "mass";
  run.plasmids.push(M.newPlasmidRow());
  r = compute(raw);
  assert.equal(r.batch, null);
  assert.equal(r.message, "Enter the stock for Plasmid 2.");
  assert.equal(M.plasmidDisplayName(run.plasmids[0], run, raw.runs), "Plasmid 1");
  run.plasmids[1].stockText = "500"; run.plasmids[0].partText = "1"; run.plasmids[1].partText = "2";
  assertUG(compute(raw).batch.runs[0].plan.plasmids[1].mass, 160);
  run.ratioBasis = "molar";
  r = compute(raw);
  assert.equal(r.batch, null);
  assert.equal(r.message, "Molar ratios need a size (bp) for Plasmid 1.");
  run.plasmids.pop();
  assert.equal(M.plasmidDisplayName(run.plasmids[0], run, raw.runs), "Plasmid");
  assertUG(compute(raw).batch.runs[0].plan.plasmids[0].mass, 240); // part "1" and molar basis ignored again
});

test("model: messages name the transfection and what it needs", () => {
  const raw = rawExample();
  raw.runs[1].cultureText = "";
  assert.equal(compute(raw).batch, null);
  assert.equal(compute(raw).message, "Enter the culture volume for Reporter.");
  raw.runs[1].cultureText = "0";
  assert.equal(compute(raw).message, "Enter the culture volume for Reporter.");
  raw.runs[1].cultureText = "60";
  raw.runs[1].plasmids[1].stockText = "";
  assert.equal(compute(raw).message, "Enter the stock for pLuc of Reporter.");
  raw.runs[1].plasmids[1].stockText = "2000";
  raw.runs[1].plasmids[1].partText = "";
  assert.equal(compute(raw).message, "Enter a ratio part for pLuc of Reporter.");
  raw.runs[1].plasmids[1].partText = "1";
  raw.runs[1].ratioBasis = "molar";
  assert.equal(compute(raw).message, "Molar ratios need a size (bp) for pGFP of Reporter.");
  raw.runs[1].plasmids[0].sizeText = "5000"; raw.runs[1].plasmids[1].sizeText = "5000";
  assert.notEqual(compute(raw).batch, null);
  // The first incomplete run is named.
  const bad = rawExample();
  bad.runs[0].plasmids[0].stockText = ""; bad.runs[1].cultureText = "";
  assert.ok(compute(bad).message.indexOf("mAb-1 ×3") >= 0);
  // A third blank transfection.
  const third = rawExample(); third.runs.push(M.newRun());
  assert.equal(compute(third).message, "Enter the stock for Plasmid of Transfection 3.");
  third.runs[2].plasmids[0].stockText = "1000";
  assert.notEqual(compute(third).batch, null);
});

test("model: shared settings that block the plan", () => {
  const raw = rawExample();
  raw.defaults.dose = "0";
  assert.ok(compute(raw).message.indexOf("defaults") >= 0);
  raw.defaults.dose = "1"; raw.defaults.peiStock = "0";
  assert.ok(compute(raw).message.indexOf("defaults") >= 0);
  raw.defaults.peiStock = "1"; raw.defaults.seedingMillions = "";
  assert.equal(compute(raw).message, "Enter the seeding density.");
});

test("model: unnamed plasmids across transfections stay separate", () => {
  const raw = { defaults: defaultsRaw(), sourceMillions: "3.12", runs: [M.newRun(), M.newRun()] };
  raw.runs.forEach((r) => { r.plasmids[0].stockText = "1000"; });
  let b = compute(raw).batch;
  assert.equal(b.totals.plasmids.length, 2);
  assert.ok(b.totals.plasmids.every((p) => p.runCount === 1));
  assert.equal(new Set(b.totals.plasmids.map((p) => p.name)).size, 2);
  assert.ok(b.totals.plasmids[0].name.indexOf("Transfection 1") >= 0);
  assert.ok(b.totals.plasmids[1].name.indexOf("Transfection 2") >= 0);
  assertML(b.totals.plasmids[0].volume, 0.24); assertML(b.totals.plasmids[1].volume, 0.24);
  raw.runs[0].plasmids[0].nameText = "pX"; raw.runs[1].plasmids[0].nameText = "pX";
  b = compute(raw).batch;
  assert.equal(b.totals.plasmids.length, 1); assert.equal(b.totals.plasmids[0].runCount, 2);
  assertML(b.totals.plasmids[0].volume, 0.48);
  const one = { defaults: defaultsRaw(), sourceMillions: "", runs: [M.newRun()] };
  one.runs[0].plasmids[0].stockText = "1000";
  assert.deepEqual(compute(one).batch.totals.plasmids.map((p) => p.name), ["Plasmid"]);
});

test("model: the overflowing run is named and warnings are prefixed with it", () => {
  const raw = rawExample();
  raw.runs[1].plasmids[0].stockText = "10"; // 30 µg at 10 ng/µL = 3 mL > 1.25 mL
  const r = compute(raw);
  assert.equal(r.batch.isFeasible, false);
  assert.deepEqual(r.batch.infeasibleRuns.map((x) => x.name), ["Reporter"]);
  assert.ok(r.warnings.some((w) => w.level === "error" && w.text.indexOf("Reporter: pGFP's stock is too dilute") === 0));
  const copy = E.batchPlainText({ date: new Date(), defaults: r.settings, excessPct: 0, seedingDensityPerML: 1.04e6, batch: r.batch, recipe: r.recipe });
  assert.ok(copy.indexOf("Reporter") >= 0);
  assert.ok(copy.indexOf("30.145 mL") < 0);
});

test("model: the master mix excess hint follows the excess", () => {
  const raw = rawExample();
  assert.equal(compute(raw).batch.suggestsMasterMixExcess(raw.defaults.excessPct), true);
  raw.defaults.excessPct = 5;
  assert.equal(compute(raw).batch.suggestsMasterMixExcess(raw.defaults.excessPct), false);
  const one = { defaults: defaultsRaw(), sourceMillions: "", runs: [M.newRun()] };
  one.runs[0].plasmids[0].stockText = "1000";
  assert.equal(compute(one).batch.suggestsMasterMixExcess(0), false);
});

test("model: warnings read in words", () => {
  const raw = { defaults: defaultsRaw(), sourceMillions: "3.12", runs: [M.newRun()] };
  raw.runs[0].plasmids[0].stockText = "1000";
  assert.deepEqual(compute(raw).warnings, []); // the standard run is clean
  raw.sourceMillions = "0.5";
  assert.ok(compute(raw).warnings[0].text.indexOf("is below the 1.04 × 10⁶/mL seeding density") >= 0);
  raw.sourceMillions = "3.12"; raw.runs[0].plasmids[0].nameText = "pDilute"; raw.runs[0].plasmids[0].stockText = "0.4";
  const w = compute(raw).warnings;
  assert.ok(w.some((x) => x.text === "pDilute's stock is too dilute: its volume alone overfills the tube." && x.level === "error"), JSON.stringify(w));
  assert.ok(w.every((x) => x.text && /\.$/.test(x.text)));
});

test("model: ticks untick when the amount changes, are kept per run, and survive 1 -> 2 -> 1 runs", () => {
  const raw = { defaults: defaultsRaw(), sourceMillions: "3.12", runs: [M.newRun()] };
  raw.runs[0].plasmids[0].stockText = "1000";
  let r = compute(raw);
  const checks = {};
  let pei = R.item(r.recipe.runs[0].recipe, "b.pei"), combine = R.item(r.recipe.runs[0].recipe, "combine");
  M.toggle(checks, pei); M.toggle(checks, combine);
  assert.equal(M.isChecked(checks, pei), true); assert.equal(M.isChecked(checks, combine), true);
  raw.runs[0].plasmids[0].stockText = "800"; // same PEI volume, different plasmid
  r = compute(raw);
  assert.equal(M.isChecked(checks, R.item(r.recipe.runs[0].recipe, "b.pei")), true);
  raw.defaults.dose = "2"; // the PEI amount doubles: its tick no longer counts
  r = compute(raw);
  assert.equal(M.isChecked(checks, R.item(r.recipe.runs[0].recipe, "b.pei")), false);
  assert.equal(M.isChecked(checks, R.item(r.recipe.runs[0].recipe, "combine")), true); // an action line has no amount
  M.toggle(checks, R.item(r.recipe.runs[0].recipe, "b.pei"));
  checks.incubate = "";
  // 1 -> 2 runs: the first run's bare ticks move under its prefix; "incubate" stays shared.
  const firstID = raw.runs[0].id;
  const moved = M.rekeyChecks(checks, [firstID], [firstID, "r99"]);
  assert.equal(moved[firstID + ".b.pei"], checks["b.pei"]);
  assert.equal(moved[firstID + ".combine"], "");
  assert.equal(moved.incubate, "");
  assert.equal(moved["b.pei"], undefined);
  // 2 -> 1: the survivor's ticks go back to bare; the other run's and the master mix's are dropped.
  moved["r99.b.pei"] = "x"; moved["master.pei"] = "y";
  const back = M.rekeyChecks(moved, [firstID, "r99"], [firstID]);
  assert.deepEqual(Object.keys(back).sort(), ["b.pei", "combine", "incubate"].sort());
  // Removing a run drops its ticks.
  M.dropRunChecks(moved, "r99");
  assert.equal(moved["r99.b.pei"], undefined);
  assert.notEqual(moved[firstID + ".b.pei"], undefined);
});

test("model: master mix portion and the run's Tube B are one tick", () => {
  const r = compute(rawExample());
  const portion = r.recipe.portionItems[0];
  const checks = {};
  M.toggle(checks, portion.item);
  const b = R.section(r.recipe.runs[0].recipe, "b").items[0];
  assert.equal(M.isChecked(checks, b), true);
  assert.equal(b.id, r.recipe.runs[0].id + ".b.master");
});

// ---------------------------------------------------------------- Edge notes: number parsing
test("edge: \"7,000\" bp reads as 7000, not 7; sizes and flask counts are bounded", () => {
  assert.equal(M.sizeBP("7,000", "."), 7000);
  assert.equal(M.sizeBP("7000.4", "."), 7000);
  assert.equal(M.sizeBP("0", "."), null);
  assert.equal(M.sizeBP("-5", "."), null);
  assert.equal(M.sizeBP("1e300", "."), null);
  assert.equal(M.sizeBP("99999999999999999999", "."), null);
  assert.equal(M.flaskCount("3", "."), 3);
  assert.equal(M.flaskCount("0", "."), null);
  assert.equal(M.flaskCount("25", "."), null);
  assert.equal(M.flaskCount("2.5", "."), null);
  assert.equal(M.flaskCount("1e9", "."), null);
  assert.equal(M.flaskCount("", "."), null);
  // A molar run typed with grouped sizes: HC "7,000" and LC "6,000" bp -> 7000/13000 (SPEC molar example).
  const raw = { defaults: defaultsRaw(), sourceMillions: "", runs: [M.newRun()] };
  const run = raw.runs[0];
  run.plasmids[0].stockText = "1,000"; // grouped, too
  const p2 = M.newPlasmidRow(); p2.stockText = "1000"; run.plasmids.push(p2);
  run.ratioBasis = "molar"; run.plasmids[0].sizeText = "7,000"; run.plasmids[1].sizeText = "6,000";
  raw.defaults.peiToDNA = undefined;
  const r = compute(raw);
  assert.notEqual(r.batch, null);
  close(r.batch.runs[0].plan.plasmids[0].massFraction, 7 / 13, 1e-12);
  assert.equal(T.number(ug(r.batch.runs[0].plan.plasmids[0].mass), 1), "129.2");
  assert.equal(T.number(ug(r.batch.runs[0].plan.plasmids[1].mass), 1), "110.8");
  // A decimal-comma locale still reads "0,5" as 0.5 for the seeding density; "." locale refuses it.
  assert.equal(M.settingsFrom(Object.assign(defaultsRaw(), { seedingMillions: "1,04" }), ",").seedingDensityPerML, 1.04e6);
  assert.equal(M.settingsFrom(Object.assign(defaultsRaw(), { seedingMillions: "1,04" }), ".").seedingDensityPerML, 0);
  // An absurd flask count blocks the plan with a message instead of trapping.
  raw.runs[0].flaskText = "1e12";
  assert.equal(compute(raw).message, "Flasks must be a whole number from 1 to 24.");
});

test("model: settingsFrom reads the incubation and keeps the lab value for nonsense", () => {
  assert.equal(M.settingsFrom(defaultsRaw(), ".").incubationSeconds, 570);
  assert.equal(M.settingsFrom(Object.assign(defaultsRaw(), { incubationMin: "10", incubationSec: "" }), ".").incubationSeconds, 600);
  assert.equal(M.settingsFrom(Object.assign(defaultsRaw(), { incubationMin: "abc", incubationSec: "x" }), ".").incubationSeconds, 570);
  assert.equal(M.settingsFrom(Object.assign(defaultsRaw(), { excessPct: 7 }), ".").excess, 0);
  assert.equal(M.settingsFrom(Object.assign(defaultsRaw(), { excessPct: 10 }), ".").excess, 10);
});

// ---- web only: the field the "why there's no recipe" message points at

test("model: the message names the field to fill in", () => {
  const raw = rawExample();
  const [r1, r2] = raw.runs;
  r2.plasmids[1].stockText = "";
  let r = compute(raw);
  assert.match(r.message, /Enter the stock for pLuc of Reporter/);
  assert.deepEqual(r.messageField, { runID: r2.id, rowID: r2.plasmids[1].id, f: "stock" });
  r2.plasmids[1].stockText = "2000"; r2.plasmids[0].partText = "";
  assert.deepEqual(compute(raw).messageField, { runID: r2.id, rowID: r2.plasmids[0].id, f: "part" });
  r2.plasmids[0].partText = "1"; r2.ratioBasis = "molar";
  assert.deepEqual(compute(raw).messageField, { runID: r2.id, rowID: r2.plasmids[0].id, f: "size" });
  r1.flaskText = "0";
  assert.deepEqual(compute(raw).messageField, { runID: r1.id, rowID: null, f: "flasks" });
  r1.cultureText = "";
  assert.deepEqual(compute(raw).messageField, { runID: r1.id, rowID: null, f: "culture" });
  raw.defaults.seedingMillions = "";
  r = compute(raw);
  assert.equal(r.message, "Enter the seeding density.");
  assert.deepEqual(r.messageField, { id: "seeding" });
  assert.equal(compute(rawExample()).messageField, null);
});
