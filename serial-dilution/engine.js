/*
 * Serial dilution. Ported from Sources/Core/SerialDilutionEngine.swift (the math) and the
 * SerialDilutionModel in Sources/Features/SerialDilution/SerialDilutionView.swift (parsing,
 * unit canonicalizing, ladder readout, tube-volume line, warning text, copy text).
 * Pure functions only; index.html draws the page. Needs assets/bench.js loaded first.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var U = BM.units, F = BM.format;
  var MICROLITER = 1e-6;
  // The 1 µL guardrail compares with a hair of slack so a round-number recipe that lands on
  // 0.9999999999999997 µL doesn't warn (deep review 2026-10-28, P2; the app compares against
  // 1e-6 exactly). The app already skips zero volumes with `> 0`; kept here.
  var BELOW_PIPETTABLE = MICROLITER * (1 - 1e-9);
  var STEP_RANGE = { min: 1, max: 24 };

  /** Tube i concentration = C0 / factor^i for i in 1...steps. Same unit as c0. */
  function ladder(c0, factor, steps) {
    var tubes = [];
    for (var i = 1; i <= steps; i++) tubes.push({ index: i, concentration: c0 / Math.pow(factor, i) });
    return tubes;
  }

  /** Diluent per tube (liters): Vd = Vt × (factor − 1). */
  function diluentPerTube(transferVolume, factor) { return transferVolume * (factor - 1); }

  /**
   * Full ladder + volumes + guardrails. A factor ≤ 1 isn't a dilution: only
   * { kind: "invalidFactor" } comes back, with no tubes or volumes.
   * Warning kinds: invalidFactor, subMicroliterTransferVolume, subMicroliterDiluentVolume.
   */
  function plan(c0, factor, steps, transferVolume) {
    if (!(factor > 1)) {
      return { tubes: [], transferVolume: transferVolume, diluentPerTube: 0, totalDiluent: 0,
        volumePerTube: 0, finalTubeVolume: 0, warnings: [{ kind: "invalidFactor" }] };
    }
    var tubes = ladder(c0, factor, steps);
    var perTube = diluentPerTube(transferVolume, factor);
    var warnings = [];
    if (transferVolume > 0 && transferVolume < BELOW_PIPETTABLE) warnings.push({ kind: "subMicroliterTransferVolume", liters: transferVolume });
    if (perTube > 0 && perTube < BELOW_PIPETTABLE) warnings.push({ kind: "subMicroliterDiluentVolume", liters: perTube });
    return {
      tubes: tubes, transferVolume: transferVolume, diluentPerTube: perTube,
      totalDiluent: perTube * steps,
      // A tube gets Vd + Vt and passes Vt on, so it keeps Vd; the last tube keeps Vd + Vt.
      volumePerTube: perTube, finalTubeVolume: perTube + transferVolume, warnings: warnings
    };
  }

  // Display steps below the pickers' smallest unit (pM, fM / pg/mL, fg/mL); display only.
  var SUB_MOLAR = [{ label: "pM", base: 1e-12 }, { label: "fM", base: 1e-15 }];
  var SUB_MASS = [{ label: "pg/mL", base: 1e-9 }, { label: "fg/mL", base: 1e-12 }];
  // "Reads ≥ 1", allowing for C0 / factorⁱ landing a hair under a power of ten.
  var WHOLE_UNIT_FLOOR = 1 - 1e-9;

  /**
   * A tube concentration (mol/L in "molar" mode, g/L in "mass" mode) in the largest unit where
   * it reads ≥ 1; steps on through pM → fM (pg/mL → fg/mL); below that, scientific in M (mg/mL).
   */
  function formatConcentration(canonical, mode) {
    if (!isFinite(canonical)) return "—";
    var mag = Math.abs(canonical);
    var set = mode === "molar" ? U.molar : U.massConc;
    var sub = mode === "molar" ? SUB_MOLAR : SUB_MASS;
    var unit = set.best(canonical);
    if (mag === 0 || mag / unit.mult >= WHOLE_UNIT_FLOOR) return F.number(canonical / unit.mult) + " " + unit.label;
    for (var i = 0; i < sub.length; i++) {
      if (mag / sub[i].base >= WHOLE_UNIT_FLOOR) return F.number(canonical / sub[i].base) + " " + sub[i].label;
    }
    return F.scientific(canonical) + " " + (mode === "molar" ? "M" : "mg/mL");
  }

  /** One line on what each tube ends up holding. */
  function tubeVolumeText(p) {
    var kept = F.volume(p.volumePerTube), transfer = F.volume(p.transferVolume);
    if (p.tubes.length <= 1) {
      return "The tube ends with " + F.volume(p.finalTubeVolume) + "; discard " + transfer + " to leave " + kept + ".";
    }
    return "Each tube ends with " + kept + " after passing " + transfer + " on; the final tube keeps " +
      F.volume(p.finalTubeVolume) + " unless you discard " + transfer + " from it.";
  }

  function friendlyWarning(w) {
    switch (w.kind) {
      case "invalidFactor":
        return { level: "error", text: "A serial dilution needs a factor above 1, e.g. 10 for 1:10." };
      case "subMicroliterTransferVolume":
        return { level: "warn", text: "Transfer volume (" + F.volume(w.liters) + ") is below ~1 µL — not reliably pipettable. Try a larger transfer volume." };
      default:
        return { level: "warn", text: "Diluent per tube (" + F.volume(w.liters) + ") is below ~1 µL — not reliably pipettable. Try a larger transfer volume." };
    }
  }

  /** Whole steps clamped to 1...24 (non-numbers fall back to the minimum). */
  function clampSteps(n) {
    if (n == null || !isFinite(n)) return STEP_RANGE.min;
    return Math.min(STEP_RANGE.max, Math.max(STEP_RANGE.min, Math.round(n)));
  }

  /**
   * The whole screen as data in, results out.
   * state = { mode: "molar" | "mass", text: { c0, factor, transfer }, steps,
   *           units: { molar: "mM", mass: "mgPerML", transfer: "uL" } }
   * decimalSeparator is optional (tests pass "." to stay locale-free).
   * Returns { plan, factorTooLow, warnings: [{level,text}], total, lines, copyText, ... }.
   */
  function compute(state, decimalSeparator) {
    var parse = function (t) { return F.parse(t, decimalSeparator); };
    var mode = state.mode, units = state.units || {};
    var unitSet = mode === "molar" ? U.molar : U.massConc;
    var unitId = mode === "molar" ? units.molar : units.mass;
    var steps = clampSteps(state.steps);
    var c0 = parse(state.text.c0), factor = parse(state.text.factor), transfer = parse(state.text.transfer);
    var out = {
      plan: null, steps: steps, concentrationUnitLabel: unitSet.get(unitId).label,
      factorTooLow: factor != null && factor <= 1,
      total: null, perTubeText: null, tubeText: null, tubes: [], warnings: [], copyText: ""
    };
    if (c0 == null || c0 < 0 || factor == null || !(factor > 1) || transfer == null || !(transfer > 0)) {
      if (out.factorTooLow) out.warnings = [friendlyWarning({ kind: "invalidFactor" })];
      return out;
    }
    var p = plan(unitSet.toBase(unitId, c0), factor, steps, U.volume.toBase(units.transfer, transfer));
    out.plan = p;
    out.total = F.volumeParts(p.totalDiluent);
    out.perTubeText = F.volume(p.diluentPerTube) + " diluent per tube, transferring " + F.volume(p.transferVolume) + " forward each step.";
    out.tubeText = tubeVolumeText(p);
    out.tubes = p.tubes.map(function (t) {
      return { index: t.index, isFinal: t.index === p.tubes.length, text: formatConcentration(t.concentration, mode) };
    });
    out.warnings = p.warnings.map(friendlyWarning);

    var lines = ["Serial dilution: " + state.text.c0 + " " + out.concentrationUnitLabel + ", 1:" + state.text.factor +
      " per step, " + steps + " steps, " + state.text.transfer + " " + U.volume.get(units.transfer).label + " transfer"];
    out.tubes.forEach(function (t) { lines.push("Tube " + t.index + ": " + t.text); });
    lines.push("Diluent per tube: " + F.volume(p.diluentPerTube));
    lines.push("Total diluent: " + F.volume(p.totalDiluent));
    lines.push(out.tubeText);
    out.warnings.forEach(function (w) { lines.push(w.text); });
    out.copyText = lines.join("\n");
    return out;
  }

  var api = {
    STEP_RANGE: STEP_RANGE, ladder: ladder, diluentPerTube: diluentPerTube, plan: plan,
    formatConcentration: formatConcentration, tubeVolumeText: tubeVolumeText,
    friendlyWarning: friendlyWarning, clampSteps: clampSteps, compute: compute
  };
  BM.serialDilution = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
