/*
 * Dilution: C₁V₁ = C₂V₂. Ported from Sources/Core/DilutionEngine.swift (the math) and
 * the DilutionModel in Sources/Features/Dilution/DilutionView.swift (units, Mixed mode, MW).
 * Pure functions only; index.html draws the page. Needs assets/bench.js loaded first.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var U = BM.units, F = BM.format;
  var MICROLITER = 1e-6;
  // The 1 µL guardrail compares with a hair of slack so a round-number recipe that lands on
  // 0.9999999999999997 µL doesn't warn, and an exact zero never warns "only 0 µL"
  // (deep review 2026-10-28, P2; the app still compares against 1e-6 exactly).
  var BELOW_PIPETTABLE = MICROLITER * (1 - 1e-9);

  /**
   * Pass null for exactly one of the four (canonical: concentrations in one shared unit,
   * volumes in liters). Returns null when the null count isn't one, or any value is
   * negative, non-finite, or needs a divide by zero.
   * Warnings: subMicroliterStock, subMicroliterDiluent, negativeDiluent, cannotDiluteUp.
   */
  function solve(c1, v1, c2, v2) {
    var r;
    var missing = [c1, v1, c2, v2].filter(function (x) { return x == null; }).length;
    if (missing !== 1) return null;
    if (v2 == null) { if (c2 === 0) return null; r = [c1, v1, c2, c1 * v1 / c2]; }
    else if (c2 == null) { if (v2 === 0) return null; r = [c1, v1, c1 * v1 / v2, v2]; }
    else if (v1 == null) { if (c1 === 0) return null; r = [c1, c2 * v2 / c1, c2, v2]; }
    else { if (v1 === 0) return null; r = [c2 * v2 / v1, v1, c2, v2]; }
    if (!r.every(function (x) { return isFinite(x) && x >= 0; })) return null;

    var s = { c1: r[0], v1: r[1], c2: r[2], v2: r[3] };
    s.diluentVolume = s.v2 - s.v1;
    s.warnings = [];
    if (s.v1 > 0 && s.v1 < BELOW_PIPETTABLE) s.warnings.push({ kind: "subMicroliterStock", liters: s.v1 });
    if (s.diluentVolume < 0) s.warnings.push({ kind: "negativeDiluent" });
    else if (s.diluentVolume > 0 && s.diluentVolume < BELOW_PIPETTABLE) s.warnings.push({ kind: "subMicroliterDiluent", liters: s.diluentVolume });
    if (s.c2 > s.c1) s.warnings.push({ kind: "cannotDiluteUp" });
    return s;
  }

  var LABELS = { c1: "Stock C₁", v1: "Stock V₁", c2: "Final C₂", v2: "Final V₂" };
  var SYMBOLS = { c1: "C₁", v1: "V₁", c2: "C₂", v2: "V₂" };

  /** "molar" or "mass" for a concentration unit id. */
  function basisOf(unitId) { return U.molar.get(unitId) ? "molar" : "mass"; }
  function concSet(unitId) { return basisOf(unitId) === "molar" ? U.molar : U.massConc; }

  /**
   * The whole screen as data in, results out.
   * state = {
   *   mode: "molar" | "mass" | "mixed",   // Molar / Mass/Vol pick both units from one list;
   *                                         // Mixed lets C₁ and C₂ each be molar or mass.
   *   solvingFor: "c1" | "v1" | "c2" | "v2",
   *   text: { c1, v1, c2, v2 },             // what's typed
   *   units: { c1, c2, v1, v2 },            // unit ids from BM.units
   *   mw: "66463",                          // g/mol, Mixed only
   *   seeds: { field: { text, value } }     // optional: full-precision values handed back
   * }                                       //   when the solved field moved (see solveFor)
   * decimalSeparator is optional (tests pass "." to stay locale-free).
   */
  function compute(state, decimalSeparator) {
    var parse = function (t) { return F.parse(t, decimalSeparator); };
    var seeds = state.seeds || {};
    var typed = function (f) {
      var t = state.text[f] || "";
      if (seeds[f] && seeds[f].text === t) return seeds[f].value;
      return parse(t);
    };
    var mwRaw = parse(state.mw || "");
    var mw = mwRaw != null && mwRaw > 0 ? mwRaw : null;

    var basis = function (f) { return basisOf(state.units[f]); };
    var b1 = basis("c1"), b2 = basis("c2");
    var needsMW = state.mode === "mixed" && b1 !== b2;
    var missingMW = needsMW && mw == null;
    var common = b1 === b2 ? b1 : (mw != null ? "molar" : null);

    var convert = function (v, from, to) {
      if (from === to) return v;
      if (mw == null) return null;
      return from === "mass" ? v / mw : v * mw;
    };
    var canonicalConc = function (f) {
      var v = typed(f);
      if (v == null || common == null) return null;
      return convert(concSet(state.units[f]).toBase(state.units[f], v), basis(f), common);
    };
    var displayConc = function (f, canonical) {
      var base = common != null ? convert(canonical, common, basis(f)) : canonical;
      return concSet(state.units[f]).fromBase(state.units[f], base);
    };
    var vol = function (f) {
      var v = typed(f);
      return v == null ? null : U.volume.toBase(state.units[f], v);
    };
    var finite = function (x) { return x != null && isFinite(x) ? x : null; };

    var s = state.solvingFor;
    var c1 = s === "c1" ? null : finite(canonicalConc("c1"));
    var v1 = s === "v1" ? null : finite(vol("v1"));
    var c2 = s === "c2" ? null : finite(canonicalConc("c2"));
    var v2 = s === "v2" ? null : finite(vol("v2"));
    var known = [c1, v1, c2, v2].filter(function (x) { return x != null; }).length;
    var sol = known === 3 ? solve(c1, v1, c2, v2) : null;

    var unitLabel = function (f) {
      return (f === "c1" || f === "c2" ? concSet(state.units[f]) : U.volume).get(state.units[f]).label;
    };
    var solvedValue = function (f) {
      if (!sol) return null;
      if (f === "c1" || f === "c2") return displayConc(f, sol[f]);
      return U.volume.fromBase(state.units[f], sol[f]);
    };

    var out = {
      solution: sol,
      needsMW: needsMW,
      missingMW: missingMW,
      solvedValue: solvedValue(s),
      solvedText: sol ? F.number(solvedValue(s)) : "",
      unitLabel: unitLabel,
      hero: null,
      recipe: null,
      steps: null,
      conversions: [],
      warnings: [],
      status: null
    };
    if (!sol) {
      out.prompt = missingMW
        ? "Add a molecular weight to convert between mass and molar."
        : "Enter the other three fields to solve for " + LABELS[s] + ".";
      return out;
    }

    // Hero: a solved volume in its most readable unit; a concentration in its own unit.
    out.hero = s === "v1" || s === "v2"
      ? F.volumeParts(sol[s])
      : { value: out.solvedText, unit: unitLabel(s) };

    var vu1 = U.volume.get(state.units.v1).label, vu2 = U.volume.get(state.units.v2).label;
    out.recipe = "Take " + F.number(U.volume.fromBase(state.units.v1, sol.v1)) + " " + vu1 +
      " stock + " + F.number(U.volume.fromBase(state.units.v2, sol.diluentVolume)) + " " + vu2 +
      " diluent → " + F.number(U.volume.fromBase(state.units.v2, sol.v2)) + " " + vu2;
    if (sol.diluentVolume >= 0) {
      out.steps = [
        { title: "Stock", value: F.volume(sol.v1) },
        { title: "Diluent", value: F.volume(sol.diluentVolume) },
        { title: "Final volume", value: F.volume(sol.v2), emphasized: true }
      ];
    }

    if (needsMW && mw != null) {
      out.conversions = ["c1", "c2"].map(function (f) {
        var molar = sol[f];
        var own = F.number(displayConc(f, molar)) + " " + unitLabel(f);
        var other;
        if (basis(f) === "molar") {
          var gpl = molar * mw, mu = U.massConc.best(gpl);
          other = F.number(gpl / mu.mult) + " " + mu.label;
        } else {
          var ru = U.molar.best(molar);
          other = F.number(molar / ru.mult) + " " + ru.label;
        }
        return SYMBOLS[f] + " " + own + " = " + other;
      });
    }

    out.warnings = sol.warnings.map(function (w) {
      switch (w.kind) {
        case "subMicroliterStock":
          return { level: "warn", text: "Stock volume is only " + F.number(w.liters * 1e6) + " µL — too small to pipette reliably. Try a more concentrated stock or an intermediate dilution." };
        case "subMicroliterDiluent":
          return { level: "warn", text: "Diluent volume is only " + F.number(w.liters * 1e6) + " µL — barely a dilution. Double-check your target." };
        case "negativeDiluent":
          return { level: "error", text: "Stock volume exceeds the final volume — that's not physically possible. Check your inputs." };
        default:
          return { level: "error", text: "Can't dilute up — try a higher stock concentration or an intermediate dilution." };
      }
    });
    out.status = out.warnings.some(function (w) { return w.level === "error"; }) ? "error"
      : out.warnings.length ? "approx" : "exact";
    return out;
  }

  /**
   * Move the solved field to `field`, handing the old answer back to its input as plain
   * digits with the exact value alongside (so numbers don't drift). Returns a new state.
   */
  function solveFor(state, field, decimalSeparator) {
    var next = JSON.parse(JSON.stringify(state));
    next.seeds = next.seeds || {};
    if (field === state.solvingFor) return next;
    var r = compute(state, decimalSeparator);
    if (r.solution) {
      var text = F.editable(r.solvedValue, 6, decimalSeparator);
      next.text[state.solvingFor] = text;
      next.seeds[state.solvingFor] = { text: text, value: r.solvedValue };
    }
    next.solvingFor = field;
    return next;
  }

  var api = { solve: solve, compute: compute, solveFor: solveFor, basisOf: basisOf, LABELS: LABELS, SYMBOLS: SYMBOLS };
  BM.dilution = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
