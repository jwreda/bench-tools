/*
 * Cell counting: hemocytometer counts → density, and stock density + target → seeding volumes.
 * Ported from Sources/Core/CellCountingEngine.swift (the math) and the CellCountingModel /
 * CellCountingView text in Sources/Features/CellCounting/CellCountingView.swift.
 * Pure functions only; index.html draws the page. Needs assets/bench.js loaded first.
 * Densities are cells/mL and volumes are mL here, as in the app.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var F = BM.format;
  var MICROLITER_IN_ML = 1e-3;
  // The 1 µL guardrail compares with a hair of slack so a round-number recipe that lands a
  // hair under 1 µL doesn't warn, and an exact zero never warns (deep review 2026-10-28, P2;
  // the app still compares against 1e-3 mL exactly).
  var BELOW_PIPETTABLE_ML = MICROLITER_IN_ML * (1 - 1e-9);

  /** Growth areas in cm², for cells/cm² targets. */
  var VESSELS = [
    { id: "well6", label: "6-well", areaCm2: 9.6, noun: "well" },
    { id: "well12", label: "12-well", areaCm2: 3.8, noun: "well" },
    { id: "well24", label: "24-well", areaCm2: 1.9, noun: "well" },
    { id: "well48", label: "48-well", areaCm2: 0.95, noun: "well" },
    { id: "well96", label: "96-well", areaCm2: 0.32, noun: "well" },
    { id: "t25", label: "T25", areaCm2: 25, noun: "flask" },
    { id: "t75", label: "T75", areaCm2: 75, noun: "flask" },
    { id: "t175", label: "T175", areaCm2: 175, noun: "flask" },
    { id: "t225", label: "T225", areaCm2: 225, noun: "flask" }
  ];
  function vessel(id) {
    for (var i = 0; i < VESSELS.length; i++) if (VESSELS[i].id === id) return VESSELS[i];
    return VESSELS[0];
  }

  var STAINS = {
    trypanBlue: { id: "trypanBlue", label: "Trypan blue", liveWord: "live", deadWord: "dead (blue)", inlineName: "trypan blue", mixFactor: 2 },
    aoPI: { id: "aoPI", label: "AO/PI", liveWord: "live (green)", deadWord: "dead (red)", inlineName: "AO/PI", mixFactor: 2 },
    unstained: { id: "unstained", label: "No stain", liveWord: "cells", deadWord: "dead (optional)", inlineName: "no stain", mixFactor: 1 }
  };

  /** Cells per large square a count is read reliably across. */
  var RELIABLE_MIN = 10, RELIABLE_MAX = 300;
  var CHAMBER_NOTE = "Standard hemocytometer: 1 large square = 0.1 µL, so ×10⁴ per mL";

  /** cells/mL = avgCount × dilutionFactor × 1e4 (large square = 1×1×0.1 mm = 1e-4 mL). */
  function density(averageCount, dilutionFactor) { return averageCount * dilutionFactor * 1e4; }

  function isCounted(sq) { return sq.live != null || sq.dead != null; }

  /**
   * Summary from per-square counts [{live, dead}] (null/undefined = blank). A square with
   * neither number was skipped and doesn't dilute the average. Null with no counted square,
   * a non-positive dilution factor, or (web guard) a negative count.
   */
  function summarizeSquares(squares, dilutionFactor) {
    var counted = squares.filter(isCounted);
    if (!counted.length || !(dilutionFactor > 0)) return null;
    if (counted.some(function (s) { return (s.live || 0) < 0 || (s.dead || 0) < 0; })) return null;
    var n = counted.length;
    var avgLive = counted.reduce(function (a, s) { return a + (s.live || 0); }, 0) / n;
    var avgDead = counted.reduce(function (a, s) { return a + (s.dead || 0); }, 0) / n;
    var avgTotal = avgLive + avgDead;
    return {
      squaresCounted: n, averageLive: avgLive, averageDead: avgDead, averageTotal: avgTotal,
      viability: avgTotal > 0 ? avgLive / avgTotal : null,
      totalDensity: density(avgTotal, dilutionFactor),
      viableDensity: density(avgLive, dilutionFactor)
    };
  }

  /**
   * Summary from an already-averaged count (live + dead per square), with viability (0…1)
   * applied when known. Null when viability is outside 0…1: over 100% is a typo.
   */
  function summarizeAverage(averageCount, viability, dilutionFactor) {
    if (!(averageCount >= 0) || !(dilutionFactor > 0)) return null;
    if (viability != null && !(viability >= 0 && viability <= 1)) return null;
    var avgLive = averageCount * (viability == null ? 1 : viability);
    return {
      squaresCounted: 0, averageLive: avgLive, averageDead: averageCount - avgLive, averageTotal: averageCount,
      viability: viability == null ? null : viability,
      totalDensity: density(averageCount, dilutionFactor),
      viableDensity: density(avgLive, dilutionFactor)
    };
  }

  /** Count plausibility for a hemocytometer average (all cells per large square). */
  function countWarnings(averagePerSquare) {
    if (averagePerSquare < RELIABLE_MIN) return [{ kind: "tooFewCells", averagePerSquare: averagePerSquare }];
    if (averagePerSquare > RELIABLE_MAX) return [{ kind: "tooManyCells", averagePerSquare: averagePerSquare }];
    return [];
  }

  function cellsNeededByVolume(targetDensity, targetVolumeML) { return targetDensity * targetVolumeML; }
  function cellsNeededByArea(targetDensityPerCm2, areaCm2) { return targetDensityPerCm2 * areaCm2; }
  function stockVolume(cellsNeeded, stockDensity) { return cellsNeeded / stockDensity; }

  /**
   * { ok: true, plan: {cellsNeeded, stockVolume, mediaVolume, warnings} } (mL), or
   * { ok: false, failure: { kind: "stockTooDilute", neededML } } when the stock needed is more
   * than the plating volume (a recipe would need negative media).
   */
  function seedingPlan(stockDensity, cellsNeeded, targetVolumeML) {
    var stockVol = stockVolume(cellsNeeded, stockDensity);
    // Exactly the plating volume is undiluted stock, which is still a recipe (no media).
    if (!(stockVol <= targetVolumeML * (1 + 1e-12))) return { ok: false, failure: { kind: "stockTooDilute", neededML: stockVol } };
    var warnings = [];
    if (stockVol > 0 && stockVol < BELOW_PIPETTABLE_ML) warnings.push({ kind: "subMicroliterStockVolume", mL: stockVol });
    return { ok: true, plan: { cellsNeeded: cellsNeeded, stockVolume: stockVol, mediaVolume: Math.max(targetVolumeML - stockVol, 0), warnings: warnings } };
  }

  // ------------------------------------------------------------------ model (CellCountingModel)

  /** The dilution factor text after the stain changes: follows the stain's mix unless a factor of the user's own is typed. */
  function factorTextAfterStainChange(oldStainId, newStainId, factorText, sep) {
    if (oldStainId === newStainId) return factorText;
    var typed = F.parse(factorText, sep);
    if (typed == null || typed === STAINS[oldStainId].mixFactor) return F.plain(STAINS[newStainId].mixFactor);
    return factorText;
  }

  function blank(text) { return text == null || String(text).trim() === ""; }

  /** Viability typed (average and counter entry) but not a percentage from 0 to 100. */
  function viabilityIsInvalid(mode, viabilityText, sep) {
    if (mode === "squares" || blank(viabilityText)) return false;
    var p = F.parse(viabilityText, sep);
    return p == null || !(p >= 0 && p <= 100);
  }

  function dilutionFactor(text, sep) {
    var f = F.parse(text, sep);
    return f != null && f > 0 ? f : null;
  }

  /**
   * state = { mode: "squares"|"average"|"counter", stain, squares: [{live, dead} texts],
   *   average, viability, counter, dilution }
   * → { summary | null, viabilityInvalid, warnings: [count warning objects] }
   */
  function count(state, sep) {
    var invalid = viabilityIsInvalid(state.mode, state.viability, sep);
    var summary = null;
    if (!invalid) {
      var vp = F.parse(state.viability, sep);
      var viability = vp == null ? null : vp / 100;
      var dilF = dilutionFactor(state.dilution, sep);
      if (state.mode === "squares") {
        if (dilF != null) {
          summary = summarizeSquares((state.squares || []).map(function (s) {
            return { live: F.parse(s.live, sep), dead: F.parse(s.dead, sep) };
          }), dilF);
        }
      } else if (state.mode === "average") {
        var avg = F.parse(state.average, sep);
        if (dilF != null && avg != null) summary = summarizeAverage(avg, viability, dilF);
      } else {
        // The instrument reports density directly: one square-equivalent at ×1e-4.
        var live = F.parse(state.counter, sep);
        if (live != null && live >= 0 && viability !== 0) {
          summary = summarizeAverage(live / (viability == null ? 1 : viability) / 1e4, viability, 1);
        }
      }
    }
    // A counter reports density itself, so it has no squares to check.
    var warnings = summary && state.mode !== "counter" ? countWarnings(summary.averageTotal) : [];
    return { summary: summary, viabilityInvalid: invalid, warnings: warnings };
  }

  /** Wells or flasks seeded: 1 for Density × Volume; a whole number 1…10 000 for Density × Area, else null. */
  function vesselsSeeded(state, sep) {
    if (state.targetMode !== "densityArea") return 1;
    var c = F.parse(state.vesselCount, sep);
    if (c == null || !(c >= 1) || c > 10000 || c !== Math.round(c)) return null;
    return c;
  }

  function platingVolume(state, sep) {
    var v = F.parse(state.volume, sep);
    return v != null && v > 0 ? v : null;
  }

  /**
   * The seeding half. state adds { source: "measured"|"manual", manualStock, targetMode:
   * "densityVolume"|"densityArea", targetDensity, targetPerCm2, vessel, volume, vesselCount }.
   * measuredDensity is the count's live density (or null).
   * → { stockDensity, vesselsSeeded, totalPlatingVolume, result: null | seedingPlan() result }
   */
  function seeding(state, measuredDensity, sep) {
    var stock = state.source === "manual" ? F.parse(state.manualStock, sep) : measuredDensity;
    var seeded = vesselsSeeded(state, sep);
    var pv = platingVolume(state, sep);
    var total = pv != null && seeded != null ? pv * seeded : null;
    var cells = null;
    if (state.targetMode === "densityVolume") {
      var d = F.parse(state.targetDensity, sep);
      if (d != null && d > 0 && pv != null) cells = cellsNeededByVolume(d, pv);
    } else {
      var a = F.parse(state.targetPerCm2, sep);
      if (a != null && a > 0 && seeded != null) cells = cellsNeededByArea(a, vessel(state.vessel).areaCm2) * seeded;
    }
    var result = null;
    if (stock != null && stock > 0 && cells != null && total != null) {
      result = seedingPlan(stock, cells, total);
    }
    return { stockDensity: stock == null ? null : stock, vesselsSeeded: seeded, totalPlatingVolume: total, result: result };
  }

  // ------------------------------------------------------------------ text

  function volumeMLParts(mL) {
    if (!isFinite(mL)) return { value: "—", unit: "mL" };
    return F.volumeParts(BM.units.volume.toBase("mL", mL));
  }
  function volumeML(mL) { var p = volumeMLParts(mL); return p.value + " " + p.unit; }

  /** "9.6", "0.95", "25": two decimals, trailing zeros dropped. */
  function formatArea(cm2) {
    var t = cm2.toFixed(2);
    if (t.indexOf(".") >= 0) t = t.replace(/0+$/, "").replace(/\.$/, "");
    return t;
  }

  function countWarningText(w) {
    if (w.kind === "tooFewCells") {
      return "Only " + F.number(w.averagePerSquare) + " cells per square: too few for a reliable count. Count more squares, or spin down and resuspend in less volume, then recount.";
    }
    return F.number(w.averagePerSquare) + " cells per square: too crowded to count accurately. Dilute and recount, and set the dilution factor to match.";
  }

  function seedingWarningText(w) {
    return "Only " + volumeML(w.mL) + " of stock needed — below reliably pipettable volumes. Consider a more dilute intermediate.";
  }

  function tooDiluteText(neededML, totalPlatingVolume) {
    var total = totalPlatingVolume != null ? "the " + volumeML(totalPlatingVolume) + " total" : "the plating volume";
    return "Stock too dilute: this needs " + volumeML(neededML) + " of stock, more than " + total + ". Lower the target, or spin the cells down and resuspend in less medium, then recount.";
  }

  var VIABILITY_ERROR = "Viability is a percentage, 0 to 100. Check the number typed.";

  /** "Dilution factor ×2 (trypan blue mixed 1:1)"; the stain's mix is named only when the factor is that mix. */
  function dilutionText(factor, stainId) {
    var t = "Dilution factor ×" + F.plain(factor);
    var stain = STAINS[stainId];
    if (stainId !== "unstained" && factor === stain.mixFactor) t += " (" + stain.inlineName + " mixed 1:1)";
    return t;
  }

  /** "Per well of a 6-well plate: 2.000 mL, 9.6 × 10⁴ cells (mixed for 6 wells)". */
  function vesselSplitText(state, plan, seeded) {
    if (state.targetMode !== "densityArea" || seeded == null) return null;
    var v = vessel(state.vessel);
    var perVolume = (plan.stockVolume + plan.mediaVolume) / seeded;
    var perCells = plan.cellsNeeded / seeded;
    var label = v.noun === "well" ? "well of a " + v.label + " plate" : v.label + " flask";
    var mixed = seeded === 1 ? "" : " (mixed for " + seeded + " " + v.noun + "s)";
    return "Per " + label + ": " + volumeML(perVolume) + ", " + F.scientific(perCells) + " cells" + mixed;
  }

  /** Detail lines under the density: viability, squares, dilution, chamber. */
  function densityLines(state, c, sep) {
    var s = c.summary, lines = [];
    if (!s) return lines;
    if (s.viability != null) {
      lines.push("Viability " + F.number(s.viability * 100) + "% · total " + F.scientific(s.totalDensity) + " cells/mL");
    }
    if (s.squaresCounted > 0) {
      lines.push("Average of " + s.squaresCounted + " square" + (s.squaresCounted === 1 ? "" : "s") + ": " +
        F.number(s.averageLive) + " " + (state.stain === "unstained" ? "cells" : "live") + " + " + F.number(s.averageDead) + " dead per square");
    }
    if (state.mode !== "counter") {
      var f = dilutionFactor(state.dilution, sep);
      if (f != null) lines.push(dilutionText(f, state.stain));
      lines.push(CHAMBER_NOTE);
    }
    return lines;
  }

  /**
   * The whole page as data in, results out. See count() and seeding() for the state.
   * Returns { count, seeding, densityWarnings, seedingWarnings, copyText }; warnings are
   * { level, text } for BM.ui.warnings.
   */
  function compute(state, sep) {
    var c = count(state, sep);
    var measured = c.summary ? c.summary.viableDensity : null;
    var sd = seeding(state, measured, sep);
    var densityWarnings = [];
    if (c.viabilityInvalid) densityWarnings.push({ level: "error", text: VIABILITY_ERROR });
    c.warnings.forEach(function (w) { densityWarnings.push({ level: "warn", text: countWarningText(w) }); });
    var seedingWarnings = [];
    if (sd.result && sd.result.ok) {
      sd.result.plan.warnings.forEach(function (w) { seedingWarnings.push({ level: "warn", text: seedingWarningText(w) }); });
    } else if (sd.result) {
      seedingWarnings.push({ level: "error", text: tooDiluteText(sd.result.failure.neededML, sd.totalPlatingVolume) });
    }
    var out = { count: c, seeding: sd, densityWarnings: densityWarnings, seedingWarnings: seedingWarnings };
    out.copyText = copyText(state, out, sep);
    return out;
  }

  /** The Copy text: the app's lines, plus every warning (the app's copy drops the sub-µL one). */
  function copyText(state, r, sep) {
    var lines = [];
    var s = r.count.summary;
    if (s) {
      var line = "Cell density: " + F.scientific(s.viableDensity) + " cells/mL";
      if (s.viability != null) {
        line += " viable (" + F.number(s.viability * 100) + "% viability, " + F.scientific(s.totalDensity) + " cells/mL total)";
      }
      if (state.mode !== "counter") {
        var f = dilutionFactor(state.dilution, sep);
        line += " — avg " + F.number(s.averageTotal) + " cells/square, dilution ×" + (f != null ? F.plain(f) : state.dilution) + ", 1 large square = 0.1 µL";
      }
      line += ", " + STAINS[state.stain].label;
      if (s.squaresCounted > 0) {
        var parts = [];
        (state.squares || []).forEach(function (q, i) {
          var live = F.parse(q.live, sep), dead = F.parse(q.dead, sep);
          if (live != null || dead != null) parts.push("Q" + (i + 1) + " " + F.number(live || 0) + "/" + F.number(dead || 0));
        });
        line += " (live/dead: " + parts.join(", ") + ")";
      }
      lines.push(line);
    }
    r.densityWarnings.forEach(function (w) { lines.push((w.level === "error" ? "✕ " : "⚠ ") + w.text); });
    var res = r.seeding.result;
    if (res && res.ok) {
      var p = res.plan;
      var l = "Seeding: take " + volumeML(p.stockVolume) + " stock + " + volumeML(p.mediaVolume) + " media → " +
        volumeML(p.stockVolume + p.mediaVolume) + " total (" + F.scientific(p.cellsNeeded) + " cells)";
      var split = vesselSplitText(state, p, r.seeding.vesselsSeeded);
      if (split) l += ". " + split;
      lines.push(l);
    } else if (res) {
      lines.push("Seeding: stock too dilute (needs " + volumeML(res.failure.neededML) + " of stock, more than the plating volume)");
    }
    r.seedingWarnings.forEach(function (w) { lines.push((w.level === "error" ? "✕ " : "⚠ ") + w.text); });
    return lines.join("\n");
  }

  var api = {
    VESSELS: VESSELS, STAINS: STAINS, vessel: vessel, CHAMBER_NOTE: CHAMBER_NOTE,
    RELIABLE_MIN: RELIABLE_MIN, RELIABLE_MAX: RELIABLE_MAX,
    density: density, summarizeSquares: summarizeSquares, summarizeAverage: summarizeAverage,
    countWarnings: countWarnings, cellsNeededByVolume: cellsNeededByVolume, cellsNeededByArea: cellsNeededByArea,
    stockVolume: stockVolume, seedingPlan: seedingPlan,
    factorTextAfterStainChange: factorTextAfterStainChange, viabilityIsInvalid: viabilityIsInvalid,
    count: count, seeding: seeding, vesselsSeeded: vesselsSeeded, compute: compute,
    volumeML: volumeML, volumeMLParts: volumeMLParts, formatArea: formatArea,
    countWarningText: countWarningText, seedingWarningText: seedingWarningText, tooDiluteText: tooDiluteText,
    dilutionText: dilutionText, vesselSplitText: vesselSplitText, densityLines: densityLines, copyText: copyText
  };
  BM.cellCounting = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
