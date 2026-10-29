/*
 * Reagent maker: mass for a target molarity, and % w/v / % v/v solutions. Ported from
 * Sources/Core/ReagentMakerEngine.swift and the ReagentMakerModel in
 * Sources/Features/ReagentMaker/ReagentMakerView.swift. Pure functions; index.html draws the page.
 * Needs assets/bench.js loaded first.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var U = BM.units, F = BM.format;

  function massFromMolarity(molarity, volumeLiters, molecularWeight) { return molarity * volumeLiters * molecularWeight; }
  function massForPercentWV(percent, volumeML) { return percent * volumeML / 100; }
  function percentWV(massGrams, volumeML) { return massGrams / volumeML * 100; }
  function volumeForPercentVV(percent, totalVolumeML) { return percent * totalVolumeML / 100; }
  function percentVV(soluteVolumeML, totalVolumeML) { return soluteVolumeML / totalVolumeML * 100; }

  // ---------------------------------------------------------------- guardrails
  var minimumWeighableGrams = 0.005;

  /** Caution kinds: belowWeighableMass {grams}, implausiblyLargeMass {grams}, percentOver100. */
  function cautionMessage(c) {
    switch (c.kind) {
      // BM.format.mass picks the unit (deep review P2: the app printed "1.211 × 10⁻⁴ g" in the
      // hero next to "Only 121.1 µg" in this message).
      case "belowWeighableMass":
        return "Only " + F.mass(c.grams) + " — too little to weigh accurately. Make a larger volume, or a concentrated stock to dilute.";
      case "implausiblyLargeMass": return "That's a lot of powder — double-check your units.";
      default: return "Over 100% — double-check your inputs.";
    }
  }

  function massCautions(grams) {
    if (grams > 1000) return [{ kind: "implausiblyLargeMass", grams: grams }];
    if (grams > 0 && grams < minimumWeighableGrams) return [{ kind: "belowWeighableMass", grams: grams }];
    return [];
  }
  function percentCautions(percent, massGrams) {
    var out = [];
    if (percent > 100) out.push({ kind: "percentOver100" });
    if (massGrams != null) out = out.concat(massCautions(massGrams));
    return out;
  }

  // ---------------------------------------------------------------- the screen
  /**
   * state = {
   *   mode: "molar" | "percent",
   *   molarity, molarityUnit, volume, volumeUnit, mw,       // molar mode (text, unit ids)
   *   basis: "wv" | "vv", percent, percentVolume, amount     // % solution mode (text, mL)
   * }
   * Returns { kind: "amount" | "percent" | "mass" | null, value, eyebrow, unit, valueText,
   * cautions, warnings, status, copyText }. `mass`/`amount` values are grams or mL.
   */
  function compute(state, decimalSeparator) {
    var parse = function (t) { return F.parse(t == null ? "" : t, decimalSeparator); };
    var r = { kind: null, value: null, hero: null, cautions: [], warnings: [], status: "info", copyText: "" };

    function finish() {
      r.warnings = r.cautions.map(function (c) { return { level: "warn", text: cautionMessage(c) }; });
      r.status = r.value == null ? "info" : r.cautions.length ? "approx" : "exact";
      return r;
    }

    if (state.mode !== "percent") {
      var m = parse(state.molarity), v = parse(state.volume), mw = parse(state.mw);
      r.eyebrow = "Mass to weigh out";
      if (m != null && m > 0 && v != null && v > 0 && mw != null && mw > 0) {
        r.kind = "mass";
        r.value = massFromMolarity(U.molar.toBase(state.molarityUnit, m), U.volume.toBase(state.volumeUnit, v), mw);
        r.hero = massParts(r.value);
        r.cautions = massCautions(r.value);
        r.copyText = "Reagent maker: " + state.molarity + " " + U.molar.get(state.molarityUnit).label +
          " in " + state.volume + " " + U.volume.get(state.volumeUnit).label +
          " (MW " + state.mw + ") → " + F.mass(r.value);
      }
      return finish();
    }

    var wv = state.basis !== "vv";
    var vol = parse(state.percentVolume);
    var unit = wv ? "g" : "mL";
    var pct = parse(state.percent), amt = parse(state.amount);
    if (vol != null && vol > 0) {
      // Percent is the primary input; the amount only solves when percent is blank.
      if ((state.percent || "") !== "" && pct != null && pct > 0) {
        r.kind = "amount";
        r.value = wv ? massForPercentWV(pct, vol) : volumeForPercentVV(pct, vol);
      } else if ((state.amount || "") !== "" && amt != null && amt > 0) {
        r.kind = "percent";
        r.value = wv ? percentWV(amt, vol) : percentVV(amt, vol);
      }
    }
    if (r.kind === "amount") {
      r.eyebrow = wv ? "Mass to weigh out" : "Solute volume needed";
      r.hero = wv ? massParts(r.value) : { value: F.number(r.value), unit: "mL" };
      r.copyText = "Reagent maker: " + state.percent + (wv ? "% w/v" : "% v/v") + " in " + state.percentVolume +
        " mL → " + (wv ? F.mass(r.value) : F.number(r.value) + " mL");
    } else if (r.kind === "percent") {
      r.eyebrow = "Concentration";
      r.hero = { value: F.number(r.value), unit: "%" };
      r.copyText = "Reagent maker: " + state.amount + " " + unit + " in " + state.percentVolume +
        " mL → " + F.number(r.value) + "%";
    } else {
      r.eyebrow = "Result";
    }
    if (r.kind) {
      var percent = r.kind === "percent" ? r.value : (pct == null ? 0 : pct);
      var mass = wv ? (r.kind === "amount" ? r.value : amt) : null;
      r.cautions = percentCautions(percent, mass);
    }
    return finish();
  }

  /** { value, unit } of a mass in grams, in its most readable unit. */
  function massParts(grams) {
    var u = U.mass.best(grams);
    return { value: F.number(grams / u.mult), unit: u.label };
  }

  var api = {
    massFromMolarity: massFromMolarity, massForPercentWV: massForPercentWV, percentWV: percentWV,
    volumeForPercentVV: volumeForPercentVV, percentVV: percentVV,
    massCautions: massCautions, percentCautions: percentCautions, cautionMessage: cautionMessage,
    minimumWeighableGrams: minimumWeighableGrams, massParts: massParts, compute: compute
  };
  BM.reagentMaker = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
