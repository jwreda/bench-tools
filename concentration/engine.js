/*
 * Concentration: mass/volume ⇄ molar, and A₂₈₀ → concentration. Ported from
 * Sources/Core/ConcentrationEngine.swift (the math and guardrails) and the ConcentrationModel in
 * Sources/Features/Concentration/ConcentrationView.swift (source field, units, status).
 * Pure functions only; index.html draws the page. Needs assets/bench.js loaded first.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var U = BM.units, F = BM.format;

  // ---------------------------------------------------------------- canonical core
  // Base units: g/L (= mg/mL) for mass, mol/L for molar.
  function molarFromMass(gramsPerLiter, molecularWeight) { return gramsPerLiter / molecularWeight; }
  function massFromMolar(molarity, molecularWeight) { return molarity * molecularWeight; }
  function concentrationFromA280Molar(absorbance, extinctionCoefficient, pathLengthCm) {
    return absorbance / (extinctionCoefficient * (pathLengthCm == null ? 1 : pathLengthCm));
  }
  function concentrationFromA280Mass(absorbance, massExtinctionCoefficient, pathLengthCm) {
    return absorbance / (massExtinctionCoefficient * (pathLengthCm == null ? 1 : pathLengthCm));
  }
  /** E = ε / MW: absorbance of a 1 mg/mL solution. */
  function massExtinctionCoefficient(molarExtinctionCoefficient, molecularWeight) {
    return molarExtinctionCoefficient / molecularWeight;
  }

  // Unit-aware (ids from BM.units.massConc / BM.units.molar)
  function molarity(mass, massUnit, molecularWeight, resultUnit) {
    return U.molar.fromBase(resultUnit || "M", molarFromMass(U.massConc.toBase(massUnit, mass), molecularWeight));
  }
  function massConcentration(molarityValue, molarUnit, molecularWeight, resultUnit) {
    return U.massConc.fromBase(resultUnit || "mgPerML", massFromMolar(U.molar.toBase(molarUnit, molarityValue), molecularWeight));
  }
  function molarityFromA280(absorbance, eps, pathLengthCm, resultUnit) {
    return U.molar.fromBase(resultUnit || "M", concentrationFromA280Molar(absorbance, eps, pathLengthCm));
  }
  function massConcentrationFromA280(absorbance, eps, molecularWeight, pathLengthCm, resultUnit) {
    var e = massExtinctionCoefficient(eps, molecularWeight);
    return U.massConc.fromBase(resultUnit || "mgPerML", concentrationFromA280Mass(absorbance, e, pathLengthCm));
  }

  // ---------------------------------------------------------------- guardrails
  // A caution is { kind, input? }. "notPositive" is a refusal (no result); the rest sit
  // beside the result.
  var INPUT_NAMES = {
    molecularWeight: "Molecular weight", mass: "Mass concentration", molarity: "Molarity",
    absorbance: "Absorbance", extinctionCoefficient: "Extinction coefficient", pathLength: "Path length"
  };
  var proteinMolecularWeightFloor = 1000;
  var proteinExtinctionFloor = 1000;
  var molarExtinctionFloor = 100;
  var linearAbsorbanceCeiling = 2;

  function isRefusal(c) { return c.kind === "notPositive"; }
  function cautionMessage(c) {
    switch (c.kind) {
      case "notPositive": return INPUT_NAMES[c.input] + " must be above zero.";
      case "molecularWeightLooksLikeKDa": return "MW looks like kDa; enter g/mol, e.g. 66,463 for BSA.";
      case "extinctionLooksLikeMassCoefficient":
        return "ε looks like E0.1% (A of 1 mg/mL); enter the molar ε in M⁻¹cm⁻¹, e.g. 43,824 for BSA.";
      default: return "A₂₈₀ above 2 is outside the linear range; dilute and re-read.";
    }
  }
  var notPositive = function (input) { return { kind: "notPositive", input: input }; };

  /**
   * Mass ⇄ molar. Pass only what has been typed (null for blank fields).
   * CHANGED from the app (deep review 2026-10-28, P2): the app flags any MW under 1,000 g/mol
   * as "looks like kDa", which fires on every ordinary small molecule (Tris 121.14) while the
   * mass ⇄ molar screen has nothing else to tell kDa from Da. No clear rule exists here, so the
   * caution is dropped; only the zero/negative refusals remain. (The A₂₈₀ screen keeps its
   * rule, which also needs a protein-sized ε.)
   */
  function massMolarCautions(molecularWeight, mass, molarityValue) {
    var out = [];
    if (molecularWeight != null && molecularWeight <= 0) out.push(notPositive("molecularWeight"));
    if (mass != null && mass <= 0) out.push(notPositive("mass"));
    if (molarityValue != null && molarityValue <= 0) out.push(notPositive("molarity"));
    return out;
  }

  /** A₂₈₀. Pass molecularWeight only when the result uses it (mass output). */
  function a280Cautions(absorbance, eps, pathLengthCm, molecularWeight) {
    var out = [];
    if (absorbance != null && absorbance <= 0) out.push(notPositive("absorbance"));
    if (eps != null && eps <= 0) out.push(notPositive("extinctionCoefficient"));
    if (pathLengthCm != null && pathLengthCm <= 0) out.push(notPositive("pathLength"));
    if (molecularWeight != null && molecularWeight <= 0) out.push(notPositive("molecularWeight"));
    if (molecularWeight != null && molecularWeight > 0 && molecularWeight < proteinMolecularWeightFloor &&
        eps != null && eps > proteinExtinctionFloor) out.push({ kind: "molecularWeightLooksLikeKDa" });
    if (eps != null && eps > 0 && eps < molarExtinctionFloor) out.push({ kind: "extinctionLooksLikeMassCoefficient" });
    if (absorbance != null && absorbance > linearAbsorbanceCeiling) out.push({ kind: "absorbanceOutsideLinearRange" });
    return out;
  }

  /**
   * A refusal outranks the "enter MW" prompt; cautions turn Exact into approximate, all
   * messages shown. Returns { kind: "error" | "info" | "approx" | "exact", message? }.
   */
  function status(cautions, missingMolecularWeight) {
    var refusal = cautions.filter(isRefusal)[0];
    if (refusal) return { kind: "error", message: cautionMessage(refusal) };
    if (missingMolecularWeight) return { kind: "info", message: "Enter molecular weight" };
    if (cautions.length) return { kind: "approx", message: cautions.map(cautionMessage).join(" ") };
    return { kind: "exact" };
  }

  // ---------------------------------------------------------------- the screen
  /**
   * state = {
   *   mode: "massMolar" | "a280",
   *   mw, massRaw, molarRaw, massUnit, molarUnit,   // typed text, unit ids
   *   source: "mass" | "molar",                      // which of the two was typed last
   *   absorbance, epsilon, pathLength, a280Output: "molar" | "mass", a280MolarUnit, a280MassUnit
   * }
   * decimalSeparator is optional (tests pass "." to stay locale-free).
   */
  function compute(state, decimalSeparator) {
    var parse = function (t) { return F.parse(t == null ? "" : t, decimalSeparator); };
    var mwTyped = parse(state.mw);
    var mw = mwTyped != null && mwTyped > 0 ? mwTyped : null;
    var out = { mode: state.mode };

    if (state.mode === "a280") {
      var a = parse(state.absorbance), eps = parse(state.epsilon), l = parse(state.pathLength);
      var result = null;
      if (a != null && a > 0 && eps != null && eps > 0 && l != null && l > 0) {
        if (state.a280Output === "molar") result = molarityFromA280(a, eps, l, state.a280MolarUnit);
        else if (mw != null) result = massConcentrationFromA280(a, eps, mw, l, state.a280MassUnit);
      }
      var massOut = state.a280Output === "mass";
      out.value = result;
      out.eyebrow = "Concentration from A₂₈₀";
      out.unit = massOut ? U.massConc.get(state.a280MassUnit).label : U.molar.get(state.a280MolarUnit).label;
      out.cautions = a280Cautions(a, eps, l, massOut ? typedOrNull(state.mw, parse) : null);
      out.status = status(out.cautions, massOut && mw == null);
    } else {
      var sourceIsMass = state.source !== "molar";
      // Derived values are blank (not stale) whenever an input they need is blank.
      var massTyped = parse(state.massRaw), molarTyped = parse(state.molarRaw);
      var computedMolar = mw != null && massTyped != null && massTyped > 0
        ? molarity(massTyped, state.massUnit, mw, state.molarUnit) : null;
      var computedMass = mw != null && molarTyped != null && molarTyped > 0
        ? massConcentration(molarTyped, state.molarUnit, mw, state.massUnit) : null;
      out.sourceIsMass = sourceIsMass;
      out.computedMolar = computedMolar;
      out.computedMass = computedMass;
      out.value = sourceIsMass ? computedMolar : computedMass;
      out.unit = sourceIsMass ? U.molar.get(state.molarUnit).label : U.massConc.get(state.massUnit).label;
      out.eyebrow = sourceIsMass ? "Molarity" : "Mass concentration";
      // Text for the field that is NOT the source ("" when there is nothing to show).
      out.derivedText = out.value == null ? "" : F.number(out.value);
      out.cautions = massMolarCautions(
        typedOrNull(state.mw, parse),
        sourceIsMass ? massTyped : null,
        sourceIsMass ? null : molarTyped);
      out.status = status(out.cautions, mw == null);
    }
    out.valueText = out.value == null ? "—" : F.number(out.value);
    out.warnings = out.cautions.map(function (c) {
      return { level: isRefusal(c) ? "error" : "warn", text: cautionMessage(c) };
    });
    return out;
  }
  function typedOrNull(text, parse) { return parse(text); }

  var api = {
    molarFromMass: molarFromMass, massFromMolar: massFromMolar,
    concentrationFromA280Molar: concentrationFromA280Molar, concentrationFromA280Mass: concentrationFromA280Mass,
    massExtinctionCoefficient: massExtinctionCoefficient,
    molarity: molarity, massConcentration: massConcentration,
    molarityFromA280: molarityFromA280, massConcentrationFromA280: massConcentrationFromA280,
    massMolarCautions: massMolarCautions, a280Cautions: a280Cautions,
    cautionMessage: cautionMessage, isRefusal: isRefusal, status: status, compute: compute
  };
  BM.concentration = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
