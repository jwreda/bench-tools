/*
 * Transfection (PEI, HEK293): DNA and PEI per flask. Ported from Sources/Core/TransfectionEngine.swift
 * (the plan), and from Sources/Core/TransfectionRun.swift (the standing defaults, cell plan, aligned
 * amounts, number wording and the checkable recipe). The batch (several transfections, PEI master
 * mix, shelf totals) is in batch.js; the screen's parsing and messages are in model.js.
 *
 * Everything is SI base: liters, grams, g/L, cells per liter. Pure functions, no DOM.
 * Needs assets/bench.js loaded first.
 *
 * Differences from the app (deep review 2026-10-28, edge-notes.md):
 *  - The "under 1 µL" guardrails compare against 1 µL * (1 - 1e-9) and skip an exact zero, so a
 *    round-number recipe that lands on 0.9999999999999997 µL doesn't warn.
 *  - Numbers are read by BM.format.parse (the model layer), never a bare Double()/"," replacement.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var F = BM.format, U = BM.units;

  var GRAMS_PER_MOLE_PER_BASE_PAIR = 650;
  var MICROLITER = 1e-6;
  // 1 µL guardrail with a hair of slack (P2 in edge-notes.md; the app compares against 1e-6 exactly).
  var BELOW_PIPETTABLE = MICROLITER * (1 - 1e-9);
  var MAX_COMPLEX_FRACTION = 0.10;
  var USUAL_DOSE_LOW = 0.25e-3, USUAL_DOSE_HIGH = 3e-3; // g/L: 0.25...3 ug/mL

  // ---------------------------------------------------------------- flask presets
  // The same 24 % fill (240 mL of cells in a 1 L flask) at every size.
  var FLASK_PRESETS = [
    { id: "mL125", label: "125 mL", culture: 30e-3, capacity: 125e-3 },
    { id: "mL250", label: "250 mL", culture: 60e-3, capacity: 250e-3 },
    { id: "mL500", label: "500 mL", culture: 120e-3, capacity: 500e-3 },
    { id: "L1", label: "1 L", culture: 240e-3, capacity: 1 },
    { id: "L2", label: "2 L", culture: 480e-3, capacity: 2 },
    { id: "custom", label: "Custom", culture: null, capacity: null }
  ];
  function flaskById(id) { return FLASK_PRESETS.filter(function (p) { return p.id === id; })[0]; }
  /** "30 mL cells", or null for Custom. */
  function cultureDescription(preset) {
    return preset.culture == null ? null : Math.round(preset.culture * 1000) + " mL cells";
  }
  /** The preset holding this culture volume (to ~1 ppm), else Custom. */
  function flaskMatching(cultureVolume) {
    for (var i = 0; i < FLASK_PRESETS.length; i++) {
      var c = FLASK_PRESETS[i].culture;
      if (c != null && Math.abs(c - cultureVolume) <= c * 1e-6) return FLASK_PRESETS[i];
    }
    return flaskById("custom");
  }

  // ---------------------------------------------------------------- number wording
  var T = {};
  /** Up to maxDecimals, trailing zeros dropped: 2 -> "2", 1.04 -> "1.04". */
  T.number = function (value, maxDecimals) {
    if (!isFinite(value)) return "–";
    var s = value.toFixed(Math.max(maxDecimals == null ? 3 : maxDecimals, 0));
    if (s.indexOf(".") >= 0) {
      s = s.replace(/0+$/, "");
      if (/\.$/.test(s)) s = s.slice(0, -1);
    }
    return s === "-0" ? "0" : s;
  };
  /** Cells/mL in millions, two decimals: 1.04e6 -> "1.04 × 10⁶". */
  T.millions = function (perML) { return (isFinite(perML) ? perML / 1e6 : 0).toFixed(2) + " × 10⁶"; };
  /** 2.496e8 -> "2.496 × 10⁸". */
  T.scientific = function (value, decimals) {
    decimals = decimals == null ? 3 : decimals;
    if (!isFinite(value) || value === 0) return "0";
    var exponent = Math.floor(Math.log10(Math.abs(value)));
    var mantissa = value / Math.pow(10, exponent);
    var p = Math.pow(10, decimals);
    if (Math.abs(Math.round(mantissa * p) / p) >= 10) {
      exponent += 1;
      mantissa = value / Math.pow(10, exponent);
    }
    return mantissa.toFixed(decimals) + " × 10" + F.superscript(exponent);
  };
  T.superscript = F.superscript;
  /** A DNA or PEI mass: "240 µg", "12.5 µg", "0.48 µg", "2.40 mg" (never a non-zero mass read as zero). */
  T.mass = function (grams) {
    var g = isFinite(grams) ? Math.max(grams, 0) : 0;
    if (g === 0) return "0 µg";
    function sig(x) {
      var d = x < 10 ? 2 : (x < 100 ? 1 : 0);
      var p = Math.pow(10, d);
      var r = Math.round(x * p) / p;
      if (r >= 1000) return { text: "", up: true };
      if (r >= 10 && d === 2) d = 1;
      if (r >= 100 && d === 1) d = 0;
      if (r === 0) d = Math.min(Math.floor(-Math.floor(Math.log10(x))) + 1, 9);
      return { text: x.toFixed(d), up: false };
    }
    var ug = g * 1e6;
    var u = sig(ug);
    if (!u.up) return u.text + " µg";
    var m = sig(ug / 1000);
    return m.up ? T.number(ug / 1e6, 3) + " g" : m.text + " mg";
  };
  /** The number in µg for a table cell: "240", "12.5", "0.48". */
  T.microgramsNumber = function (grams) { return T.number(grams * 1e6, 3); };

  /**
   * The vessel a volume of mix fits in with room to mix by gentle inversion: the smallest of
   * 1.5 mL tube, 5 mL tube, 15 mL conical, 50 mL conical filled to at most 90 %, else "bottle".
   */
  T.tubeFillLimit = 0.9;
  T.tubeHint = function (liters) {
    var mL = isFinite(liters) ? Math.max(liters, 0) * 1000 : 0;
    var sizes = [[1.5, "1.5 mL tube"], [5, "5 mL tube"], [15, "15 mL conical"], [50, "50 mL conical"]];
    for (var i = 0; i < sizes.length; i++) {
      if (mL <= sizes[i][0] * T.tubeFillLimit + 1e-9) return sizes[i][1];
    }
    return "bottle";
  };
  T.masterMixExcessHint = "Pipetting from a master mix leaves a little behind in the tube. Consider +5 % excess so the last portion is full.";
  /** "240 mL × 3 flasks" / "240 mL" (one flask): culture per flask in mL (L from 1000 mL). */
  T.flasks = function (count, cultureLiters) {
    var per = cultureLiters >= 1 - 1e-12
      ? T.number(cultureLiters, 3) + " L"
      : T.number(cultureLiters * 1000, 1) + " mL";
    return count > 1 ? per + " × " + count + " flasks" : per;
  };
  T.flaskCount = function (count) { return count === 1 ? "1 flask" : count + " flasks"; };
  /** "yyyy-MM-dd" in the browser's time zone. */
  T.day = function (date) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate());
  };
  /** "9:30" (counts up to the next whole second). */
  T.clock = function (seconds) {
    var s = isFinite(seconds) ? Math.max(Math.ceil(seconds), 0) : 0;
    var r = s % 60;
    return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
  };

  // ---------------------------------------------------------------- aligned amounts
  // A volume written so a column of them lines up digit for digit in a monospaced font. The larger
  // unit always shows three decimals, so its decimals ARE the smaller unit's whole digits.
  function amount(whole, tail, unit) {
    return { whole: whole, tail: tail, unit: unit, text: whole + tail + " " + unit, number: whole + tail };
  }
  function aligned(base, big, bigName, smallName, fixedSmallDigits) {
    var small = big / 1000;
    var l = isFinite(base) ? Math.max(base, 0) : 0;
    var v = l / small;
    if (v === 0 || !isFinite(v)) {
      return amount("0", fixedSmallDigits != null && fixedSmallDigits > 0 ? "." + new Array(fixedSmallDigits + 1).join("0") : "", smallName);
    }
    function digits(x) { return fixedSmallDigits != null ? fixedSmallDigits : (x < 10 ? 2 : (x < 100 ? 1 : 0)); }
    function rounded(x, d) { var p = Math.pow(10, d); return Math.round(x * p) / p; }
    var d = digits(v);
    var r = rounded(v, d);
    var settled = digits(r);
    if (settled < d) { d = settled; r = rounded(v, d); }
    if (r >= 1000) return amount((l / big).toFixed(3), "", bigName);
    if (r === 0) d = Math.min(-Math.floor(Math.log10(v)) + 1, 9);
    var s = v.toFixed(d);
    var dot = s.indexOf(".");
    if (dot < 0) return amount(s, "", smallName);
    return amount(s.slice(0, dot), s.slice(dot), smallName);
  }
  var AL = {
    /** scale "mix": mL (3 decimals) over µL. scale "culture": L (3 decimals) over mL (1 decimal). */
    volume: function (liters, scale) {
      var mix = scale === "mix";
      return aligned(liters, mix ? 1e-3 : 1, mix ? "mL" : "L", mix ? "µL" : "mL", mix ? null : 1);
    },
    /** mg (3 decimals) over µg, same rules as the mix volumes. */
    mass: function (grams) { return aligned(grams, 1e-3, "mg", "µg", null); },
    /** Each amount as one padded string that lines up in a monospaced font. */
    column: function (amounts) {
      var w = 0, t = 0, u = 0;
      amounts.forEach(function (a) { w = Math.max(w, a.whole.length); t = Math.max(t, a.tail.length); u = Math.max(u, a.unit.length); });
      function pad(n) { return n > 0 ? new Array(n + 1).join(" ") : ""; }
      return amounts.map(function (a) {
        return pad(w - a.whole.length) + a.whole + a.tail + pad(t - a.tail.length) + " " + a.unit + pad(u - a.unit.length);
      });
    }
  };

  // ---------------------------------------------------------------- standing defaults
  var EXCESS_PERCENTS = [0, 5, 10, 20];
  function excessText(pct) { return pct === 0 ? "0 %" : "+" + pct + " %"; }
  function excessFraction(pct) { return pct / 100; }

  var LAB = Object.freeze({
    peiToDNARatio: 2,          // PEI mass / DNA mass; the protocol is DNA : PEI 1 : 2 (w/w)
    doseUgPerML: 1,            // ug of DNA per mL of culture (before the mix goes in)
    peiStockMgPerML: 1,
    diluentName: "OptiPRO SFM",
    mixingMode: "twoTubes",    // "oneTube" | "twoTubes"
    mixReferenceML: 10,        // 10 mL of mix per 240 mL of cells; only the ratio matters
    cultureReferenceML: 240,
    seedingDensityPerML: 1.04e6,
    excess: 0,                 // percent: 0, 5, 10, 20
    incubationSeconds: 570,    // 9 min 30 s
    cultureUnit: "mL"
  });
  function labDefaults() { return Object.assign({}, LAB); }

  var Dflt = {
    lab: labDefaults,
    /** mix / culture (10 / 240 = 0.04167). */
    mixFraction: function (d) { return d.cultureReferenceML > 0 ? d.mixReferenceML / d.cultureReferenceML : 0; },
    /** culture : mix as "N : 1" (240 / 10 = 24). */
    cultureToMixRatio: function (d) { return d.mixReferenceML > 0 ? d.cultureReferenceML / d.mixReferenceML : 0; },
    /** Setting the ratio keeps cultureReferenceML and recomputes mixReferenceML; nonsense is ignored. Returns d. */
    setCultureToMixRatio: function (d, v) {
      if (v > 0 && isFinite(v)) d.mixReferenceML = d.cultureReferenceML / v;
      return d;
    },
    /** Every number the math needs is above zero (and the mix has a ratio). */
    isUsable: function (d) {
      var mf = Dflt.mixFraction(d);
      return [d.peiToDNARatio, d.doseUgPerML, d.peiStockMgPerML, mf].every(function (x) { return x > 0 && isFinite(x); });
    },
    diluentDisplayName: function (d) {
      var n = String(d.diluentName == null ? "" : d.diluentName).trim();
      return n === "" ? "Diluent" : n;
    },
    ratioText: function (d) { return "1 : " + T.number(d.peiToDNARatio, 2); },
    doseText: function (d) { return T.number(d.doseUgPerML, 3) + " µg/mL culture"; },
    peiStockText: function (d) { return T.number(d.peiStockMgPerML, 3) + " mg/mL"; },
    mixReferenceText: function (d) { return T.number(d.mixReferenceML, 3) + " mL per " + T.number(d.cultureReferenceML, 3) + " mL"; },
    cultureToMixText: function (d) { return T.number(Dflt.cultureToMixRatio(d), 2) + " : 1"; },
    seedingText: function (d) { return T.millions(d.seedingDensityPerML) + " live cells/mL"; },
    incubationText: function (d) { return T.clock(d.incubationSeconds); },
    mixingText: function (d) { return d.mixingMode === "oneTube" ? "One tube" : "Two tubes"; },
    /** The fields that differ from the lab defaults. The mix is compared by its ratio. */
    changedFields: function (d) {
      var lab = LAB, out = [];
      function differs(a, b) { return !(Math.abs(a - b) <= Math.max(Math.abs(b), 1e-12) * 1e-9); }
      if (differs(d.peiToDNARatio, lab.peiToDNARatio)) out.push("ratio");
      if (differs(d.doseUgPerML, lab.doseUgPerML)) out.push("dose");
      if (differs(d.peiStockMgPerML, lab.peiStockMgPerML)) out.push("peiStock");
      if (String(d.diluentName).trim() !== lab.diluentName) out.push("diluent");
      if (d.mixingMode !== lab.mixingMode) out.push("mixing");
      if (differs(Dflt.mixFraction(d), Dflt.mixFraction(lab))) out.push("mixVolume");
      if (differs(d.seedingDensityPerML, lab.seedingDensityPerML)) out.push("seeding");
      if (d.excess !== lab.excess) out.push("excess");
      if (d.incubationSeconds !== lab.incubationSeconds) out.push("incubation");
      if (d.cultureUnit !== lab.cultureUnit) out.push("cultureUnit");
      return out;
    },
    FIELD_TITLES: {
      ratio: "DNA : PEI", dose: "DNA dose", peiStock: "PEI stock", diluent: "Diluent", mixing: "Mixing",
      mixVolume: "Mix volume", seeding: "Seeding density", excess: "Excess", incubation: "Incubation", cultureUnit: "Culture unit"
    }
  };

  // ---------------------------------------------------------------- the plan
  /**
   * Mass fraction of each plasmid per basis ("mass" | "molar"). Returns null in molar mode if any
   * plasmid lacks a size. Zero parts (or no plasmids) yield all-zero fractions.
   */
  function massFractions(plasmids, basis) {
    var weights;
    if (basis === "mass") {
      weights = plasmids.map(function (p) { return Math.max(p.ratioPart, 0); });
    } else {
      weights = [];
      for (var i = 0; i < plasmids.length; i++) {
        var bp = plasmids[i].sizeBasePairs;
        if (!(bp > 0)) return null;
        weights.push(Math.max(plasmids[i].ratioPart, 0) * bp * GRAMS_PER_MOLE_PER_BASE_PAIR);
      }
    }
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    if (!(sum > 0)) return weights.map(function () { return 0; });
    return weights.map(function (w) { return w / sum; });
  }

  function tubeRecipe(diluent, plasmids, peiVolume) {
    var total = diluent + plasmids.reduce(function (a, p) { return a + p.stockVolume; }, 0) + (peiVolume == null ? 0 : peiVolume);
    return { diluentVolume: diluent, plasmids: plasmids, peiVolume: peiVolume, totalVolume: total, tubeHint: T.tubeHint(total) };
  }

  /**
   * inputs = { cultureVolume, mixVolume, dnaDosePerLiter, peiToDNAMassRatio, peiStockConcentration,
   *   plasmids: [{ name, stockConcentration, ratioPart, sizeBasePairs, rowID }], ratioBasis: "mass"|"molar",
   *   mixingMode: "oneTube"|"twoTubes", excessFraction, cellDensity }
   * Returns null only when molar mode is asked for and a plasmid has no size.
   * Warnings are { kind, name? }: noPlasmids, ratioPartsZero, plasmidVolumeExceedsTube(name),
   * peiVolumeExceedsTube, mixVolumeTooSmall, plasmidVolumeSubMicroliter(name), peiVolumeSubMicroliter,
   * complexFractionHigh, unusualRatio, unusualDose.
   */
  function plan(inputs) {
    var basis = inputs.ratioBasis || "mass", mode = inputs.mixingMode || "oneTube";
    var fractions = massFractions(inputs.plasmids, basis);
    if (fractions == null) return null;

    var scale = 1 + Math.max(inputs.excessFraction || 0, 0);
    var nominalDNA = inputs.dnaDosePerLiter * inputs.cultureVolume;
    var totalDNA = nominalDNA * scale;
    var peiMass = totalDNA * inputs.peiToDNAMassRatio;
    var peiVolume = inputs.peiStockConcentration > 0 ? peiMass / inputs.peiStockConcentration : 0;

    var lines = inputs.plasmids.map(function (p, i) {
      var mass = totalDNA * fractions[i];
      var volume = p.stockConcentration > 0 ? mass / p.stockConcentration : 0;
      return { name: p.name, mass: mass, stockVolume: volume, massFraction: fractions[i], rowID: p.rowID == null ? null : p.rowID };
    });
    var plasmidVolume = lines.reduce(function (a, l) { return a + l.stockVolume; }, 0);

    var warnings = [];
    if (inputs.plasmids.length === 0) warnings.push({ kind: "noPlasmids" });
    else if (fractions.every(function (f) { return f === 0; })) warnings.push({ kind: "ratioPartsZero" });

    var dnaTube, peiTube = null, tubeCapacity;
    if (mode === "oneTube") {
      tubeCapacity = inputs.mixVolume * scale;
      var diluent = tubeCapacity - plasmidVolume - peiVolume;
      dnaTube = tubeRecipe(Math.max(diluent, 0), lines, peiVolume);
      if (diluent < 0) warnings.push({ kind: "mixVolumeTooSmall" });
    } else {
      tubeCapacity = inputs.mixVolume * scale / 2;
      var dnaDiluent = tubeCapacity - plasmidVolume;
      var peiDiluent = tubeCapacity - peiVolume;
      dnaTube = tubeRecipe(Math.max(dnaDiluent, 0), lines, null);
      peiTube = tubeRecipe(Math.max(peiDiluent, 0), [], peiVolume);
      if (dnaDiluent < 0 || peiDiluent < 0) warnings.push({ kind: "mixVolumeTooSmall" });
    }

    lines.forEach(function (l) { if (l.stockVolume > tubeCapacity) warnings.push({ kind: "plasmidVolumeExceedsTube", name: l.name }); });
    if (peiVolume > tubeCapacity) warnings.push({ kind: "peiVolumeExceedsTube" });
    lines.forEach(function (l) {
      if (l.stockVolume > 0 && l.stockVolume < BELOW_PIPETTABLE) warnings.push({ kind: "plasmidVolumeSubMicroliter", name: l.name });
    });
    if (peiVolume > 0 && peiVolume < BELOW_PIPETTABLE) warnings.push({ kind: "peiVolumeSubMicroliter" });

    var complexFraction = inputs.cultureVolume > 0 ? inputs.mixVolume / inputs.cultureVolume : 0;
    if (complexFraction > MAX_COMPLEX_FRACTION * (1 + 1e-9)) warnings.push({ kind: "complexFractionHigh" });
    var ratio = inputs.peiToDNAMassRatio;
    if (!(ratio >= 1 && ratio <= 6)) warnings.push({ kind: "unusualRatio" });
    var dose = inputs.dnaDosePerLiter;
    if (dose < USUAL_DOSE_LOW * (1 - 1e-9) || dose > USUAL_DOSE_HIGH * (1 + 1e-9)) warnings.push({ kind: "unusualDose" });

    return {
      totalDNAMass: totalDNA, peiMass: peiMass, peiStockVolume: peiVolume, plasmids: lines,
      dnaTube: dnaTube, peiTube: peiTube, mixVolume: inputs.mixVolume,
      complexFractionOfCulture: complexFraction,
      cellsNeeded: inputs.cellDensity == null ? null : inputs.cellDensity * inputs.cultureVolume,
      warnings: warnings
    };
  }

  /** The warning in words (TransfectionReport.warningText). */
  function warningText(w) {
    switch (w.kind) {
      case "noPlasmids": return "No plasmids to transfect.";
      case "ratioPartsZero": return "Every ratio part is zero, so the DNA can't be split.";
      case "plasmidVolumeExceedsTube": return w.name + "'s stock is too dilute: its volume alone overfills the tube.";
      case "peiVolumeExceedsTube": return "The PEI stock is too dilute: its volume alone overfills the tube.";
      case "mixVolumeTooSmall": return "The components overfill the tube; the diluent is set to zero.";
      case "plasmidVolumeSubMicroliter": return w.name + " needs under 1 µL of stock; dilute it first.";
      case "peiVolumeSubMicroliter": return "The PEI needs under 1 µL of stock; dilute it first.";
      case "complexFractionHigh": return "The mix is more than 10 % of the culture volume.";
      case "unusualRatio": return "PEI : DNA is outside the usual 1 : 1 to 6 : 1 (w/w).";
      default: return "The DNA dose is outside the usual 0.25 to 3 µg/mL.";
    }
  }
  /** A tube overflows, so its diluent was clamped to zero; the rest are advisory. */
  function isBlocking(w) {
    return w.kind === "mixVolumeTooSmall" || w.kind === "peiVolumeExceedsTube" || w.kind === "plasmidVolumeExceedsTube";
  }
  function blockingWarnings(p) { return p.warnings.filter(isBlocking); }
  function isFeasible(p) { return blockingWarnings(p).length === 0; }
  /** Why the tubes can't be made, in words; null when feasible. */
  function infeasibleReason(p) {
    var b = blockingWarnings(p);
    return b.length === 0 ? null : b.map(warningText).join(" ");
  }
  /** The warnings as the page shows them: errors block the tubes, warnings are advisory. */
  function warningItems(p) {
    return p.warnings.map(function (w) { return { level: isBlocking(w) ? "error" : "warn", text: warningText(w) }; });
  }

  // ---------------------------------------------------------------- cell plan
  /**
   * All volumes liters, densities cells per liter. sourceDensity null or <= 0 skips the source and
   * medium volumes. Negative or non-finite inputs read as zero.
   */
  function cellPlan(cultureVolume, seedingDensity, sourceDensity, mixVolume) {
    function clean(x) { return isFinite(x) ? Math.max(x, 0) : 0; }
    var culture = clean(cultureVolume), seeding = clean(seedingDensity), mix = clean(mixVolume);
    var cells = seeding * culture;
    var source = null, media = null, below = false, counted = null;
    if (sourceDensity != null && isFinite(sourceDensity) && sourceDensity > 0) {
      counted = sourceDensity;
      if (culture > 0) {
        var v = cells / sourceDensity;
        source = v;
        media = Math.max(culture - v, 0);
        below = v > culture * (1 + 1e-9);
      }
    }
    var total = culture + mix;
    var c = {
      cultureVolume: culture, cellsNeeded: cells, sourceVolume: source, mediaVolume: media,
      finalDensity: total > 0 ? cells / total : 0, sourceBelowSeeding: below,
      mixVolume: mix, seedingDensity: seeding, sourceDensity: counted
    };
    c.finalVolume = c.cultureVolume + c.mixVolume;
    c.hasSource = c.sourceVolume != null && !c.sourceBelowSeeding;
    c.sourceProblem = null;
    if (below) {
      var cultureText = AL.volume(culture, "culture").text;
      var src = counted != null ? " (" + T.millions(counted / 1000) + "/mL)" : "";
      c.sourceProblem = "The source" + src + " is below the " + T.millions(seeding / 1000) + "/mL seeding density: " +
        "no volume of it makes " + cultureText + ". Recount, or concentrate the cells.";
    }
    return c;
  }

  // ---------------------------------------------------------------- the checkable recipe
  function item(id, name, amt, mass, note) {
    return { id: id, name: name, amount: amt || null, mass: mass == null ? null : mass, note: note == null ? null : note };
  }
  function baseID(id) { var i = id.lastIndexOf("."); return i >= 0 ? id.slice(i + 1) : id; }

  var R = {
    baseID: baseID,
    /** "A" / "B" for the two tubes (also on run-prefixed ids); null otherwise. */
    tubeLetter: function (s) { var b = baseID(s.id); return b === "a" ? "A" : (b === "b" ? "B" : null); },
    isTube: function (s) { return ["a", "b", "mix"].indexOf(baseID(s.id)) >= 0; },
    /** The section's amounts as padded strings that line up; null for action lines. */
    alignedAmounts: function (s) {
      var col = AL.column(s.items.filter(function (i) { return i.amount; }).map(function (i) { return i.amount; }));
      var k = 0;
      return s.items.map(function (i) { return i.amount ? col[k++] : null; });
    },
    allItems: function (r) { return r.sections.reduce(function (a, s) { return a.concat(s.items); }, []); },
    item: function (r, id) { return R.allItems(r).filter(function (i) { return i.id === id; })[0] || null; },
    /** By exact id, else by base id (a batch run's "<run>.a" is found by "a"). */
    section: function (r, id) {
      return r.sections.filter(function (s) { return s.id === id; })[0] ||
        r.sections.filter(function (s) { return baseID(s.id) === id; })[0] || null;
    },
    tubeSections: function (r) { return r.sections.filter(R.isTube); },

    /**
     * Several flasks of one culture fed from one set of tubes: `plan` is solved on all of them,
     * `cells` is ONE flask (or null). The cell lines are per flask and the add line is the nominal
     * mix for one flask. flaskCount defaults to 1.
     */
    build: function (defaults, plan, cells, cultureVolume, flaskCount) {
      var flasks = Math.max(flaskCount || 1, 1);
      var perFlask = flasks > 1 ? " · per flask, × " + flasks : "";
      var sections = [];
      var diluentName = Dflt.diluentDisplayName(defaults);
      // A source thinner than the seeding density has no volume that works: no cell lines at all.
      if (cells && !cells.sourceBelowSeeding) {
        var items = [];
        if (cells.sourceVolume != null) {
          var note = (cells.sourceDensity != null ? "from the source flask at " + T.millions(cells.sourceDensity / 1000) + "/mL" : "from the source flask") + perFlask;
          items.push(item("cells.source", "Source culture", AL.volume(cells.sourceVolume, "culture"), null, note));
        }
        if (cells.mediaVolume != null) {
          var total = AL.volume(cells.cultureVolume, "culture").text;
          items.push(item("cells.media", "Fresh medium", AL.volume(cells.mediaVolume, "culture"), null, "makes " + total + " of culture" + perFlask));
        }
        if (items.length) sections.push({ id: "cells", title: "Cells", items: items });
      }
      function tube(id, recipe) {
        var items = [item(id + ".diluent", diluentName, AL.volume(recipe.diluentVolume, "mix"), null, null)];
        recipe.plasmids.forEach(function (p, i) {
          var stock = p.stockVolume > 0 ? p.mass / p.stockVolume : 0;
          var note = stock > 0 ? T.number(stock * 1000, 1) + " ng/µL stock" : null;
          var key = p.rowID != null ? p.rowID : String(i);
          items.push(item(id + ".plasmid." + key, p.name, AL.volume(p.stockVolume, "mix"), p.mass, note));
        });
        if (recipe.peiVolume != null) {
          items.push(item(id + ".pei", "PEI", AL.volume(recipe.peiVolume, "mix"), plan.peiMass, Dflt.peiStockText(defaults) + " stock"));
        }
        return items;
      }
      if (plan.peiTube) {
        sections.push({ id: "a", title: "Tube A · DNA", items: tube("a", plan.dnaTube) });
        sections.push({ id: "b", title: "Tube B · PEI", items: tube("b", plan.peiTube) });
      } else {
        sections.push({ id: "mix", title: "Transfection mix", items: tube("mix", plan.dnaTube) });
      }
      var addNote = null;
      if (cells && cells.finalVolume > 0) {
        var final = AL.volume(cells.finalVolume, "culture").text;
        addNote = cells.cellsNeeded > 0
          ? "→ " + final + " at ≈ " + T.millions(cells.finalDensity / 1000) + "/mL"
          : "→ " + final;
      }
      sections.push({ id: "finish", title: "Combine", items: [
        item("combine", plan.peiTube ? "Combine A and B" : "Mix gently", null, null, plan.peiTube ? "mix gently" : null),
        item("incubate", "Incubate", null, null, Dflt.incubationText(defaults)),
        item("add", flasks > 1 ? "Add to each of " + flasks + " flasks" : "Add to the culture",
          AL.volume(plan.mixVolume / flasks, "mix"), null, addNote)
      ] });
      return { sections: sections };
    }
  };

  // ---------------------------------------------------------------- incubation timer
  // The complexing timer as plain state (it stores when it ends, so a reload-free page can still
  // be driven by setInterval). Times are milliseconds since the epoch, durations seconds.
  var Timer = {
    create: function (duration) { return { duration: Math.max(duration, 0), state: "idle", endsAt: null, remaining: null }; },
    remaining: function (t, now) {
      if (t.state === "running") return Math.max((t.endsAt - now) / 1000, 0);
      if (t.state === "paused") return t.remaining;
      return t.duration;
    },
    isDone: function (t, now) { return t.state === "running" && now >= t.endsAt; },
    start: function (t, now) {
      if (t.state === "idle") { t.state = "running"; t.endsAt = now + t.duration * 1000; }
      else if (t.state === "paused") { t.state = "running"; t.endsAt = now + t.remaining * 1000; }
      return t;
    },
    pause: function (t, now) {
      if (t.state === "running") { t.remaining = Math.max((t.endsAt - now) / 1000, 0); t.state = "paused"; t.endsAt = null; }
      return t;
    },
    reset: function (t) { t.state = "idle"; t.endsAt = null; t.remaining = null; return t; }
  };

  var api = {
    GRAMS_PER_MOLE_PER_BASE_PAIR: GRAMS_PER_MOLE_PER_BASE_PAIR,
    BELOW_PIPETTABLE: BELOW_PIPETTABLE,
    FLASK_PRESETS: FLASK_PRESETS, flaskById: flaskById, flaskMatching: flaskMatching, cultureDescription: cultureDescription,
    EXCESS_PERCENTS: EXCESS_PERCENTS, excessText: excessText, excessFraction: excessFraction,
    Text: T, Aligned: AL, Defaults: Dflt, Recipe: R, Timer: Timer,
    massFractions: massFractions, plan: plan, cellPlan: cellPlan,
    warningText: warningText, isBlocking: isBlocking, blockingWarnings: blockingWarnings,
    isFeasible: isFeasible, infeasibleReason: infeasibleReason, warningItems: warningItems
  };
  BM.transfection = Object.assign(BM.transfection || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = BM.transfection;
})(typeof globalThis !== "undefined" ? globalThis : this);
