/*
 * Count samples: passaging math. Ported from Sources/Core/PassagingEngine.swift and the
 * SerialCountingModel / FlaskPreset working volumes (Sources/Features/CellCounting/SerialCountingView.swift,
 * Sources/Core/TransfectionEngine.swift). Densities are cells/mL, volumes mL.
 * Counting math itself lives in ../cell-counting/engine.js (BM.cellCounting); this file only
 * needs assets/bench.js. Pure functions; index.html draws the page.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var F = BM.format;
  var MICROLITER_IN_ML = 1e-3;
  // 1 µL guardrail with a hair of slack, never on an exact zero (deep review 2026-10-28, P2).
  var BELOW_PIPETTABLE_ML = MICROLITER_IN_ML * (1 - 1e-9);
  var SAMPLE_MIN = 1, SAMPLE_MAX = 24;

  /**
   * amount = { kind: "totalCells" | "density", value }. Returns null when an input is missing
   * or not positive; { ok: true, recipe } or { ok: false, failure: { neededML } } when the
   * suspension is too dilute for the final volume.
   */
  function recipe(stockDensity, finalVolumeML, amount) {
    if (!(stockDensity > 0) || !isFinite(stockDensity) || !(finalVolumeML > 0) || !isFinite(finalVolumeML)) return null;
    var cells = amount.kind === "totalCells" ? amount.value : amount.value * finalVolumeML;
    if (!(cells > 0) || !isFinite(cells)) return null;
    var suspension = cells / stockDensity;
    // Exactly the final volume is undiluted suspension, still a recipe (1 in 1).
    if (!(suspension <= finalVolumeML * (1 + 1e-12))) return { ok: false, failure: { kind: "suspensionTooDilute", neededML: suspension } };
    var warnings = [];
    if (suspension > 0 && suspension < BELOW_PIPETTABLE_ML) warnings.push({ kind: "subMicroliterSuspension", mL: suspension });
    return {
      ok: true,
      recipe: {
        cells: cells, suspensionVolume: suspension, mediumVolume: Math.max(finalVolumeML - suspension, 0),
        finalVolume: finalVolumeML, dilutionFactor: finalVolumeML / suspension, finalDensity: cells / finalVolumeML,
        warnings: warnings
      }
    };
  }

  // ---- sample names
  var NAMINGS = [
    { id: "sample", label: "Sample 1, 2…" },
    { id: "letter", label: "A, B, C…" },
    { id: "flask", label: "Flask 1, 2…" },
    { id: "well", label: "A1, A2… (plate)" }
  ];
  /** A…Z, then AA, AB… (spreadsheet columns). */
  function letters(index) {
    var n = index, result = "";
    do {
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return result;
  }
  /** Name of the sample at `index` (0-based). */
  function genericName(naming, index) {
    switch (naming) {
      case "letter": return letters(index);
      case "flask": return "Flask " + (index + 1);
      case "well": return letters(Math.floor(index / 12)) + (index % 12 + 1);   // plate order, 12 across
      default: return "Sample " + (index + 1);
    }
  }

  // ---- flask working volumes (a quarter of the flask), mL
  var FLASKS = [
    { id: "mL125", label: "125 mL", capacityL: 0.125 },
    { id: "mL250", label: "250 mL", capacityL: 0.25 },
    { id: "mL500", label: "500 mL", capacityL: 0.5 },
    { id: "L1", label: "1 L", capacityL: 1 },
    { id: "L2", label: "2 L", capacityL: 2 }
  ];
  FLASKS.forEach(function (f) { f.workingVolumeL = f.capacityL / 4; f.workingVolumeML = f.workingVolumeL * 1000; });
  /** The flask whose working volume (liters) this is, to ~1 ppm, else null (custom). */
  function matchingFlask(workingVolumeL) {
    for (var i = 0; i < FLASKS.length; i++) {
      if (Math.abs(FLASKS[i].workingVolumeL - workingVolumeL) <= FLASKS[i].workingVolumeL * 1e-6) return FLASKS[i];
    }
    return null;
  }

  // ---- model: state = { sampleCount, naming, samples: [{customName, densityText, countNote,
  //   viabilityText, finalVolumeText, amountText}] (storage; only the first sampleCount show),
  //   sameTarget, amountMode: "totalCells"|"density", sharedFinalVolumeText, sharedAmountText }
  function newSample() { return { customName: "", densityText: "", countNote: null, viabilityText: "", finalVolumeText: "", amountText: "" }; }
  function newState() {
    var samples = [];
    for (var i = 0; i < SAMPLE_MAX; i++) samples.push(newSample());
    return {
      sampleCount: 3, naming: "sample", samples: samples, sameTarget: true, amountMode: "density",
      sharedFinalVolumeText: "10", sharedAmountText: "100000"   // 1 × 10⁵ cells/mL in 10 mL
    };
  }
  function indices(st) {
    var n = Math.min(Math.max(st.sampleCount, SAMPLE_MIN), SAMPLE_MAX), out = [];
    for (var i = 0; i < n; i++) out.push(i);
    return out;
  }
  function name(st, i) {
    var custom = String(st.samples[i].customName).trim();
    return custom === "" ? genericName(st.naming, i) : custom;
  }
  function hasCustomNames(st) { return indices(st).some(function (i) { return st.samples[i].customName !== ""; }); }
  function resetNames(st) { st.samples.forEach(function (s) { s.customName = ""; }); }
  function density(st, i, sep) {
    var v = F.parse(st.samples[i].densityText, sep);
    return v != null && v > 0 ? v : null;
  }
  /** 0…100, null when blank or out of range. */
  function viability(st, i, sep) {
    var v = F.parse(st.samples[i].viabilityText, sep);
    return v != null && v >= 0 && v <= 100 ? v : null;
  }
  function countedSamples(st, sep) { return indices(st).filter(function (i) { return density(st, i, sep) != null; }).length; }
  function finalVolume(st, i, sep) { return F.parse(st.sameTarget ? st.sharedFinalVolumeText : st.samples[i].finalVolumeText, sep); }
  function amount(st, i, sep) {
    var v = F.parse(st.sameTarget ? st.sharedAmountText : st.samples[i].amountText, sep);
    return v == null ? null : { kind: st.amountMode, value: v };
  }
  function sampleRecipe(st, i, sep) {
    var d = density(st, i, sep), v = finalVolume(st, i, sep), a = amount(st, i, sep);
    if (d == null || v == null || a == null) return null;
    return recipe(d, v, a);
  }
  /** Turning "same for every sample" off starts each sample from the shared values. */
  function splitTargets(st) {
    st.samples.forEach(function (s) {
      if (s.finalVolumeText === "" && s.amountText === "") { s.finalVolumeText = st.sharedFinalVolumeText; s.amountText = st.sharedAmountText; }
    });
  }

  // ---- text
  function mLParts(mL) { return F.volumeParts(BM.units.volume.toBase("mL", mL)); }
  function mL(v) { var p = mLParts(v); return p.value + " " + p.unit; }

  /** "24", "41.7", "2.82": trailing zeros dropped, so a whole factor reads as one. */
  function factorText(value) {
    var t = value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
    if (t.indexOf(".") >= 0) t = t.replace(/0+$/, "").replace(/\.$/, "");
    return t;
  }
  /** "Dilution factor 20 (1 part cells + 19 parts medium)", spelled out: "1:20" is read both as 1 in 20 and as 1 + 20. */
  function dilutionText(factor) {
    if (!(factor > 1 + 1e-9)) return "Undiluted: use the suspension as is";
    return "Dilution factor " + factorText(factor) + " (1 part cells + " + factorText(factor - 1) + " parts medium)";
  }
  function warningText(w) {
    return "Only " + mL(w.mL) + " of suspension: below reliably pipettable volumes. Make an intermediate dilution first.";
  }
  function tooDiluteText(neededML) {
    return "Too dilute: this needs " + mL(neededML) + " of suspension, more than the final volume. Seed fewer cells, use a larger volume, or spin down and resuspend.";
  }
  var VIABILITY_TEXT = "Viability is a percentage, 0 to 100.";

  /** The detail line under a recipe. */
  function detailText(st, i, r, sep) {
    var v = viability(st, i, sep);
    return F.scientific(r.cells) + " cells at " + F.scientific(r.finalDensity) + " cells/mL, from " +
      F.scientific(r.cells / r.suspensionVolume) + " live cells/mL" + (v != null ? " · " + F.number(v) + "% viable" : "");
  }

  /** Warnings for one sample's recipe card, { level, text }. */
  function sampleWarnings(st, i, sep) {
    var out = [], res = sampleRecipe(st, i, sep);
    if (st.samples[i].viabilityText.trim() !== "" && viability(st, i, sep) == null) out.push({ level: "warn", text: VIABILITY_TEXT });
    if (res && res.ok) res.recipe.warnings.forEach(function (w) { out.push({ level: "warn", text: warningText(w) }); });
    else if (res) out.push({ level: "error", text: tooDiluteText(res.failure.neededML) });
    return out;
  }

  /** Copy text: the app's lines, plus each sample's warnings. */
  function copyText(st, sep) {
    var lines = [];
    indices(st).forEach(function (i) {
      var line = name(st, i), d = density(st, i, sep);
      if (d == null) { lines.push(line + ": not counted"); return; }
      line += ": " + F.scientific(d) + " live cells/mL";
      var v = viability(st, i, sep);
      if (v != null) line += ", " + F.number(v) + "% viable";
      if (st.samples[i].countNote) line += " (" + st.samples[i].countNote + ")";
      var res = sampleRecipe(st, i, sep);
      if (res && res.ok) {
        var r = res.recipe;
        line += " → " + mL(r.suspensionVolume) + " cells + " + mL(r.mediumVolume) + " medium = " + mL(r.finalVolume) +
          ", dilution factor " + factorText(r.dilutionFactor) + ", " + F.scientific(r.cells) + " cells";
      } else if (res) {
        line += " → too dilute (needs " + mL(res.failure.neededML) + " of suspension)";
      }
      lines.push(line);
      sampleWarnings(st, i, sep).forEach(function (w) { lines.push("  " + (w.level === "error" ? "✕ " : "⚠ ") + w.text); });
    });
    return lines.join("\n");
  }

  var api = {
    SAMPLE_MIN: SAMPLE_MIN, SAMPLE_MAX: SAMPLE_MAX, NAMINGS: NAMINGS, FLASKS: FLASKS,
    recipe: recipe, genericName: genericName, matchingFlask: matchingFlask,
    newState: newState, newSample: newSample, indices: indices, name: name, hasCustomNames: hasCustomNames, resetNames: resetNames,
    density: density, viability: viability, countedSamples: countedSamples, finalVolume: finalVolume, amount: amount,
    sampleRecipe: sampleRecipe, splitTargets: splitTargets,
    mL: mL, mLParts: mLParts, factorText: factorText, dilutionText: dilutionText, warningText: warningText,
    tooDiluteText: tooDiluteText, detailText: detailText, sampleWarnings: sampleWarnings, copyText: copyText
  };
  BM.passaging = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
