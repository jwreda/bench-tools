/*
 * CellTrace Violet proliferation staining. Ported from Sources/Core/CellTraceEngine.swift (the
 * math) and CellTraceModel / CellTraceView (cells to stain, plan text, warnings).
 * Pure functions; index.html draws the page. Needs assets/bench.js loaded first.
 * Volumes are mL unless named µL; densities cells/mL.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var F = BM.format;

  // The 1 µL guardrail compares with a hair of slack so a round-number recipe landing on
  // 0.9999999999999997 µL doesn't warn (deep review 2026-10-28, P2; the app compares 1e-3 mL exactly).
  var ONE_MICROLITER_ML = 1e-3 * (1 - 1e-9);
  // Wells beyond this are a typo; the app trapped on Int(huge) (deep review P1).
  var MAX_WELLS = 1e6;

  /** The standing protocol. Defaults are the lab's example, not Thermo Fisher's instructions. */
  var STANDARD = { dmsoPerVialUL: 20, dyeDilution: 1000, stainingDensity: 5e6, stainMinutes: 20, quenchVolumes: 5 };
  var KEYS = Object.keys(STANDARD);

  function settings(over) {
    var s = {};
    KEYS.forEach(function (k) { s[k] = STANDARD[k]; });
    if (over) KEYS.forEach(function (k) { if (over[k] !== undefined) s[k] = over[k]; });
    return s;
  }
  function isUsable(s) {
    return s.dmsoPerVialUL > 0 && s.dyeDilution > 1 && s.stainingDensity > 0 && s.stainMinutes > 0 && s.quenchVolumes > 0;
  }
  function isStandard(s) { return KEYS.every(function (k) { return s[k] === STANDARD[k]; }); }
  /**
   * Tolerant decoding (Settings.init(from:)): a key that is missing or not a finite number
   * falls back to the standard value for that field alone.
   */
  function settingsFrom(obj) {
    var s = settings();
    if (obj && typeof obj === "object") {
      KEYS.forEach(function (k) {
        if (typeof obj[k] === "number" && isFinite(obj[k])) s[k] = obj[k];
      });
    }
    return s;
  }

  /** `cells` live cells stained at the protocol's density. Null unless cells > 0 and usable. */
  function stain(cells, p) {
    p = p || STANDARD;
    if (!(cells > 0) || !isUsable(p)) return null;
    var staining = cells / p.stainingDensity;
    var dyeUL = staining * 1000 / p.dyeDilution;
    var total = staining * (1 + p.quenchVolumes);
    var tube = total <= 15 ? "15 mL" : total <= 50 ? "50 mL" : null;
    var vials = Math.max(Math.ceil(dyeUL / p.dmsoPerVialUL - 1e-9), 1);
    if (!isFinite(vials)) return null;
    return { cells: cells, stainingML: staining, dyeUL: dyeUL, vials: vials,
      quenchAddML: staining * p.quenchVolumes, quenchTotalML: total, tube: tube };
  }

  /**
   * Mix for `wells` wells of `cellsPerWell` in `microlitersPerWell`, plus `excess` (0.1 = 10 %),
   * from a suspension at `density`. `availableML` (mL of suspension) flags a short mix.
   * issue: null | {kind: "tooDilute"} | {kind: "notEnoughCells", wells} | {kind: "subMicroliter"}.
   */
  function plate(density, cellsPerWell, microlitersPerWell, wells, excess, availableML) {
    if (!(density > 0 && cellsPerWell > 0 && microlitersPerWell > 0 && wells > 0 && wells <= MAX_WELLS && excess >= 0)) return null;
    var wellML = microlitersPerWell / 1000;
    var target = cellsPerWell / wellML;
    var total = wellML * wells * (1 + excess);
    var cells = target * total;
    var suspension = cells / density;
    var issue = null;
    if (suspension > total + 1e-12) {
      issue = { kind: "tooDilute" };
    } else if (availableML != null && suspension > availableML * (1 + 1e-9)) {
      issue = { kind: "notEnoughCells", wells: Math.floor((availableML * density) / (cellsPerWell * (1 + excess))) };
    } else if (suspension > 0 && suspension < ONE_MICROLITER_ML) {
      issue = { kind: "subMicroliter" };
    }
    return { density: target, totalML: total, cellsNeeded: cells, suspensionML: suspension,
      mediumML: Math.max(total - suspension, 0), issue: issue };
  }

  // ---------------------------------------------------------------- the model's derived values
  /** A typed positive number through BM.format.parse (CellTraceModel.number); null otherwise. */
  function number(text) {
    var v = F.parse(text);
    return v !== null && v > 0 ? v : null;
  }
  /** Percent fields: blank or unreadable reads 0, negative reads 0 (Double(text) ?? 0, max 0). */
  function percent(text) {
    var v = F.parse(text);
    return Math.max(v === null ? 0 : v, 0) / 100;
  }
  /** Wells rounded to whole wells; null unless at least one (and not absurd). */
  function wellCount(text) {
    var v = number(text);
    if (v === null || v > MAX_WELLS) return null;
    var n = Math.round(v);
    return n > 0 ? n : null;
  }

  /**
   * The model's typed fields: { densityText, volumeText, stainAmount: "total" | "wells",
   * cellsToStainText, stainOveragePercentText, cellsPerWellText, wellsText,
   * recountDensityText, recountVolumeText, microlitersPerWellText, excessPercentText }.
   */
  function availableCells(m) {
    var d = number(m.densityText), v = number(m.volumeText);
    return d !== null && v !== null ? d * v : null;
  }
  /** Cells per well × wells × (1 + overage). */
  function cellsForWells(m) {
    var perWell = number(m.cellsPerWellText), wells = wellCount(m.wellsText);
    if (perWell === null || wells === null) return null;
    return perWell * wells * (1 + percent(m.stainOveragePercentText));
  }
  /** The cells to stain: the typed number (else all of them), or what the wells call for. */
  function cellsToStain(m) {
    if (m.stainAmount === "wells") return cellsForWells(m);
    var typed = number(m.cellsToStainText);
    return typed !== null ? typed : availableCells(m);
  }
  function stainPlan(m, s) {
    var c = cellsToStain(m);
    return c === null ? null : stain(c, s);
  }
  function recountCells(m) {
    var d = number(m.recountDensityText), v = number(m.recountVolumeText);
    return d !== null && v !== null ? d * v : null;
  }
  function platePlan(m) {
    var density = number(m.recountDensityText), cells = number(m.cellsPerWellText);
    var uL = number(m.microlitersPerWellText), wells = wellCount(m.wellsText);
    if (density === null || cells === null || uL === null || wells === null) return null;
    return plate(density, cells, uL, wells, percent(m.excessPercentText), number(m.recountVolumeText));
  }

  // ---------------------------------------------------------------- text and warnings
  var mL = function (v) { return F.volume(v / 1000); };
  var uL = function (v) { return F.volume(v / 1e6); };

  /** Warnings for the Stain step. */
  function stainWarnings(plan, available, s) {
    var w = [];
    if (!isUsable(s)) {
      w.push({ level: "error", text: "The protocol needs positive values and a dye dilution above 1." });
    }
    if (plan && available != null && plan.cells > available * (1 + 1e-9)) {
      w.push({ level: "warn", text: "More cells than you counted (" + F.scientific(available) + ")" });
    }
    return w;
  }
  function quenchWarnings(plan) {
    return plan && plan.tube === null ? [{ level: "warn", text: "More than a 50 mL tube holds: split across tubes" }] : [];
  }
  function plateWarnings(plan) {
    var w = [];
    if (!plan || !plan.issue) return w;
    var i = plan.issue;
    if (i.kind === "tooDilute") w.push({ level: "warn", text: "Thinner than the wells need: spin and resuspend smaller" });
    else if (i.kind === "notEnoughCells") w.push({ level: "warn", text: "Enough cells for " + i.wells + " well" + (i.wells === 1 ? "" : "s") });
    else if (i.kind === "subMicroliter") w.push({ level: "warn", text: "Under 1 µL of cells: make an intermediate dilution" });
    return w;
  }

  /** The Stain result: { value, unit, lines }. */
  function describeStain(plan, s) {
    var v = F.volumeParts(plan.stainingML / 1000);
    return { value: v.value, unit: v.unit + " PBS",
      lines: ["+ " + uL(plan.dyeUL) + " dye stock for " + F.scientific(plan.cells) + " cells",
        plan.vials + " vial" + (plan.vials === 1 ? "" : "s") + " at " + uL(s.dmsoPerVialUL) + " DMSO each"] };
  }
  /** The Quench result: { value, unit, line }. */
  function describeQuench(plan, s) {
    var a = F.volumeParts(plan.quenchAddML / 1000);
    return { value: a.value, unit: a.unit,
      line: F.plain(s.quenchVolumes) + " volumes on the " + mL(plan.stainingML) + " of cells: " + mL(plan.quenchTotalML) + " in all." };
  }
  /** The Plate result: { value, unit, lines }. `perWellText` is the typed µL per well, as shown. */
  function describePlate(plan, perWellText) {
    var t = F.volumeParts(plan.suspensionML / 1000);
    return { value: t.value, unit: t.unit + " cells",
      lines: ["+ " + mL(plan.mediumML) + " medium → " + mL(plan.totalML) + " at " + F.scientific(plan.density) + " cells/mL",
        perWellText + " µL per well, " + F.scientific(plan.cellsNeeded) + " cells in all"] };
  }

  /** The Stain step's checklist (specs for BM.steps.list). */
  function stainSteps(plan, s) {
    return [
      { id: "solution", title: "Make the staining solution", note: "Dye into warm PBS; mix", amount: uL(plan.dyeUL), amountNote: "in " + mL(plan.stainingML) },
      { id: "spin1", title: "Spin the cells, pour off" },
      { id: "resuspend1", title: "Resuspend in the staining solution", note: "Pipette to a single-cell suspension", amount: mL(plan.stainingML) },
      { id: "stain", title: "Stain", note: "Example protocol: room temperature, rocking, wrapped in foil",
        timer: { key: "celltrace.stain", minutes: s.stainMinutes, label: "RT, rocking, in foil", message: "CellTrace staining done: quench now" } }
    ];
  }
  function quenchSteps(plan) {
    return [
      { id: "quench", title: "Add complete medium", note: plan.tube ? "In a " + plan.tube + " tube" : null, amount: mL(plan.quenchAddML) },
      { id: "spin2", title: "Spin, pour off" },
      { id: "resuspend", title: "Resuspend in fresh medium", note: "Warm complete medium, then recount on the next step" }
    ];
  }
  function prepSteps(s) {
    return [
      { id: "pbs", title: "Warm PBS to 37 °C", note: "Enough for the staining volume on the next step" },
      { id: "dmso", title: "DMSO into a dye vial", note: "Pipette until dissolved; keep it dark", amount: uL(s.dmsoPerVialUL) }
    ];
  }

  var api = {
    STANDARD: STANDARD, MAX_WELLS: MAX_WELLS, settings: settings, isUsable: isUsable, isStandard: isStandard, settingsFrom: settingsFrom,
    stain: stain, plate: plate,
    number: number, wellCount: wellCount, availableCells: availableCells, cellsForWells: cellsForWells, cellsToStain: cellsToStain,
    stainPlan: stainPlan, recountCells: recountCells, platePlan: platePlan,
    stainWarnings: stainWarnings, quenchWarnings: quenchWarnings, plateWarnings: plateWarnings,
    describeStain: describeStain, describeQuench: describeQuench, describePlate: describePlate,
    stainSteps: stainSteps, quenchSteps: quenchSteps, prepSteps: prepSteps
  };
  BM.celltrace = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
