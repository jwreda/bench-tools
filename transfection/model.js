/*
 * Transfection screen model: what the page's fields mean. Ported from the derived values and messages in
 * Sources/Features/Transfection/TransfectionModel.swift (typed text -> plan inputs, what blocks the plan
 * and what it says, plasmid names, tick bookkeeping). Pure functions; the page only reads fields, calls
 * compute() and draws.
 *
 * Differences from the app (edge-notes.md, P1): every typed number goes through BM.format.parse (the app's
 * "," -> "." replacement read "7,000" bp as 7); flask counts and plasmid sizes that aren't sane integers are
 * refused rather than trapping Int(Double). The messages that sent you "to the Culture step" now just name
 * the field, because the web page is one scroll.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var E = BM.transfection || require("./engine.js");
  if (!E.batchPlan) require("./batch.js");
  var T = E.Text, D = E.Defaults, F = BM.format, U = BM.units;

  var PLASMID_RANGE = { min: 1, max: 6 };
  var RUN_RANGE = { min: 1, max: 12 };
  var FLASK_RANGE = { min: 1, max: 24 };
  var MAX_BP = 1e7;   // no plasmid is 10 Mbp; refuse nonsense before it becomes a mass

  function trim(s) { return String(s == null ? "" : s).trim(); }
  function num(text, sep) { return F.parse(text, sep); }

  // ---------------------------------------------------------------- settings
  /**
   * The standing protocol from what's typed. raw = { ratio, dose, peiStock, diluent, mixingMode, mixRef,
   * cultureRef, incubationMin, incubationSec, cultureUnit, seedingMillions, excessPct }. An unreadable
   * number reads as 0 (so isUsable is false); an unreadable incubation falls back to the lab value.
   */
  function settingsFrom(raw, sep) {
    var lab = D.lab();
    function n(t) { var v = num(t, sep); return v == null ? 0 : v; }
    var min = num(raw.incubationMin, sep), sec = num(raw.incubationSec, sep);
    var incubation = lab.incubationSeconds;
    if (min != null || sec != null) {
      var total = Math.round((min || 0) * 60 + (sec || 0));
      if (total >= 0 && total <= 99 * 60 + 59) incubation = total;
    }
    var seed = num(raw.seedingMillions, sep);
    return {
      peiToDNARatio: n(raw.ratio), doseUgPerML: n(raw.dose), peiStockMgPerML: n(raw.peiStock),
      diluentName: raw.diluent == null ? "" : String(raw.diluent),
      mixingMode: raw.mixingMode === "oneTube" ? "oneTube" : "twoTubes",
      mixReferenceML: n(raw.mixRef), cultureReferenceML: n(raw.cultureRef),
      seedingDensityPerML: seed != null && seed > 0 ? seed * 1e6 : 0,
      excess: E.EXCESS_PERCENTS.indexOf(raw.excessPct) >= 0 ? raw.excessPct : 0,
      incubationSeconds: incubation,
      cultureUnit: raw.cultureUnit === "L" ? "L" : "mL"
    };
  }

  // ---------------------------------------------------------------- culture volume and flask
  function volumeUnit(id) { return U.volume.get(id === "L" ? "L" : "mL"); }
  /** A volume for the culture field: up to 6 decimals, trailing zeros dropped ("240", "0.24"). */
  function volumeText(liters, unitId) { return T.number(U.volume.fromBase(unitId, liters), 6); }
  /** Liters, or null when blank / not above zero. */
  function cultureLiters(text, unitId, sep) {
    var v = num(text, sep);
    return v != null && v > 0 ? U.volume.toBase(unitId, v) : null;
  }
  /** A unit switch re-expresses the typed volume (240 mL <-> 0.24 L), never multiplies it. */
  function switchUnit(text, oldUnit, newUnit, sep) {
    if (oldUnit === newUnit) return text;
    var v = num(text, sep);
    if (v == null || !(v > 0)) return text;
    return volumeText(U.volume.toBase(oldUnit, v), newUnit);
  }
  function flaskFor(text, unitId, sep) {
    var c = cultureLiters(text, unitId, sep);
    return c == null ? E.flaskById("custom") : E.flaskMatching(c);
  }

  // ---------------------------------------------------------------- runs and plasmids
  var nextRowID = 1;
  function newPlasmidRow() { return { id: "p" + (nextRowID++), nameText: "", stockText: "", partText: "1", sizeText: "" }; }
  var nextRunID = 1;
  /** A blank transfection: one flask of the default culture. */
  function newRun(unitId) {
    unitId = unitId === "L" ? "L" : "mL";
    return {
      id: "r" + (nextRunID++), nameText: "", cultureText: volumeText(0.24, unitId), cultureUnit: unitId,
      flaskText: "1", plasmids: [newPlasmidRow()], ratioBasis: "mass"
    };
  }
  /** Keep generated ids ahead of ones restored from storage. */
  function reserveIDs(runs) {
    runs.forEach(function (r) {
      var m = /^r(\d+)$/.exec(r.id); if (m) nextRunID = Math.max(nextRunID, +m[1] + 1);
      r.plasmids.forEach(function (p) { var q = /^p(\d+)$/.exec(p.id); if (q) nextRowID = Math.max(nextRowID, +q[1] + 1); });
    });
  }

  /** "Transfection 2" when the name is blank. */
  function runDisplayName(run, runs) {
    var name = trim(run.nameText);
    if (name) return name;
    var i = runs.indexOf(run);
    return "Transfection " + ((i < 0 ? 0 : i) + 1);
  }
  /**
   * A plasmid's name within its transfection: as typed, else "Plasmid" / "Plasmid 2". With two or more
   * transfections a blank name also carries the transfection's ("Plasmid 2 · Reporter"), so the reagent
   * totals never add two unnamed plasmids together as one.
   */
  function plasmidDisplayName(row, run, runs) {
    var name = trim(row.nameText);
    if (name) return name;
    var i = run.plasmids.indexOf(row) + 1;
    var base = run.plasmids.length === 1 ? "Plasmid" : "Plasmid " + (i || 1);
    return runs.length > 1 ? base + " · " + runDisplayName(run, runs) : base;
  }
  function blankName(row, run) {
    var name = trim(row.nameText);
    if (name) return name;
    return run.plasmids.length === 1 ? "Plasmid" : "Plasmid " + (run.plasmids.indexOf(row) + 1);
  }

  /** Flask count: a whole number from 1 to 24, else null. */
  function flaskCount(text, sep) {
    var v = num(text, sep);
    if (v == null || v !== Math.round(v) || v < FLASK_RANGE.min || v > FLASK_RANGE.max) return null;
    return v;
  }
  /** Plasmid size in bp: rounded; null when blank, not above zero, or beyond any plasmid. */
  function sizeBP(text, sep) {
    var v = num(text, sep);
    if (v == null) return null;
    var r = Math.round(v);
    return r > 0 && r <= MAX_BP ? r : null;
  }

  /** A transfection's plasmids parsed against its own row count; null while any stock (or a part, with 2+) is missing. */
  function parsedPlasmids(run, runs, sep) {
    var many = run.plasmids.length > 1, out = [];
    for (var i = 0; i < run.plasmids.length; i++) {
      var row = run.plasmids[i];
      var stock = num(row.stockText, sep);
      if (stock == null || !(stock > 0)) return null;
      var part = many ? (num(row.partText, sep) == null ? -1 : num(row.partText, sep)) : 1;
      if (part < 0) return null;
      out.push({
        name: plasmidDisplayName(row, run, runs), stockConcentration: U.massConc.toBase("ngPerUL", stock),
        ratioPart: part, sizeBasePairs: many ? sizeBP(row.sizeText, sep) : null, rowID: row.id
      });
    }
    return out;
  }

  /** One transfection parsed for the batch engine; null while its culture, flasks or plasmids are incomplete. */
  function runInput(run, runs, sep) {
    var culture = cultureLiters(run.cultureText, run.cultureUnit, sep);
    var flasks = flaskCount(run.flaskText, sep);
    if (culture == null || flasks == null) return null;
    var plasmids = parsedPlasmids(run, runs, sep);
    if (!plasmids) return null;
    return {
      id: run.id, name: runDisplayName(run, runs), cultureVolumePerFlask: culture, flaskCount: flasks,
      plasmids: plasmids, ratioBasis: run.plasmids.length > 1 ? run.ratioBasis : "mass"
    };
  }

  // ---------------------------------------------------------------- why there's no plan
  /** [{ message, runID }] in order; the first is what the empty card says. */
  function runBlockers(runs, sep) {
    var many = runs.length > 1, out = [];
    runs.forEach(function (run) {
      var of = many ? " of " + runDisplayName(run, runs) : "";
      var forRun = many ? " for " + runDisplayName(run, runs) : "";
      var c = num(run.cultureText, sep);
      if (c == null || c <= 0) { out.push({ message: "Enter the culture volume" + forRun + ".", runID: run.id }); return; }
      if (flaskCount(run.flaskText, sep) == null) {
        out.push({ message: "Flasks" + of + " must be a whole number from " + FLASK_RANGE.min + " to " + FLASK_RANGE.max + ".", runID: run.id }); return;
      }
      var noStock = run.plasmids.filter(function (r) { var s = num(r.stockText, sep); return s == null || s <= 0; })[0];
      if (noStock) { out.push({ message: "Enter the stock for " + blankName(noStock, run) + of + ".", runID: run.id }); return; }
      if (run.plasmids.length > 1) {
        var noPart = run.plasmids.filter(function (r) { var p = num(r.partText, sep); return p == null || p < 0; })[0];
        if (noPart) { out.push({ message: "Enter a ratio part for " + blankName(noPart, run) + of + ".", runID: run.id }); return; }
        if (run.ratioBasis === "molar") {
          var noSize = run.plasmids.filter(function (r) { return sizeBP(r.sizeText, sep) == null; })[0];
          if (noSize) { out.push({ message: "Molar ratios need a size (bp) for " + blankName(noSize, run) + of + ".", runID: run.id }); return; }
        }
      }
    });
    return out;
  }

  /**
   * Everything the page shows, from the fields. raw = {
   *   defaults: settingsFrom's raw, sourceMillions, runs: [run drafts] }.
   * Returns { settings, usable, seedingDensity, sourceDensity, sourceDensityInvalid, runInputs, batch, recipe,
   *   message (why there's no plan, or null), warnings, isBatch }.
   */
  function compute(raw, sep) {
    var settings = settingsFrom(raw.defaults, sep);
    var runs = raw.runs;
    var usable = D.isUsable(settings);
    var seeding = settings.seedingDensityPerML > 0 ? settings.seedingDensityPerML * 1e3 : null; // cells/L
    var srcMillions = num(raw.sourceMillions, sep);
    var sourceDensity = srcMillions != null && srcMillions > 0 ? srcMillions * 1e6 * 1e3 : null;
    var sourceInvalid = trim(raw.sourceMillions) !== "" && sourceDensity == null;
    var out = {
      settings: settings, usable: usable, seedingDensity: seeding, sourceDensity: sourceDensity,
      sourceDensityInvalid: sourceInvalid, runInputs: [], batch: null, recipe: null, message: null, warnings: [],
      isBatch: runs.length > 1 || runs.some(function (r) { return flaskCount(r.flaskText, sep) !== 1; })
    };
    if (sourceInvalid) {
      out.warnings.push({ level: "warn", text: "The source density isn't a usable number, so source and medium volumes are left out." });
    }
    var inputs = runs.map(function (r) { return runInput(r, runs, sep); });
    if (usable && seeding != null && inputs.every(function (i) { return i; })) {
      out.runInputs = inputs;
      out.batch = E.batchPlan(settings, inputs, E.excessFraction(settings.excess), seeding, sourceDensity);
    }
    if (out.batch) {
      out.recipe = E.batchRecipe(settings, out.batch);
      var many = out.batch.runs.length > 1;
      out.batch.runs.forEach(function (run) {
        var who = many ? run.name + ": " : "";
        if (run.cells.sourceProblem) out.warnings.push({ level: "warn", text: who + run.cells.sourceProblem });
        E.warningItems(run.plan).forEach(function (w) { out.warnings.push({ level: w.level, text: who + w.text }); });
      });
    } else if (!usable) {
      out.message = "Check the defaults: DNA dose, PEI : DNA, PEI stock and mix volume must be above zero.";
    } else if (seeding == null) {
      out.message = "Enter the seeding density.";
    } else {
      var first = runBlockers(runs, sep)[0];
      out.message = first ? first.message : "Check the defaults and plasmids.";
    }
    return out;
  }

  // ---------------------------------------------------------------- ticks
  /** Item id -> the amount text it was ticked at. A tick whose amount changed no longer counts. */
  function isChecked(checks, item) { return checks[item.id] === (item.amount ? item.amount.text : ""); }
  function toggle(checks, item) {
    if (isChecked(checks, item)) delete checks[item.id]; else checks[item.id] = item.amount ? item.amount.text : "";
  }
  /** Drops a removed transfection's ticks (ids "<run id>.…"). */
  function dropRunChecks(checks, runID) {
    var prefix = runID + ".";
    Object.keys(checks).forEach(function (k) { if (k.indexOf(prefix) === 0) delete checks[k]; });
  }
  /**
   * Keeps ticks across the 1 <-> 2 transfection change. One run's ids are bare ("a.diluent"); with two or
   * more each run's are "<run id>.a.diluent". "incubate" is shared and never moves; the master mix's go
   * when there is no master mix any more. Returns a new map.
   */
  function rekeyChecks(checks, oldIDs, newIDs) {
    var out = {};
    if (oldIDs.length === 1 && newIDs.length > 1 && newIDs.indexOf(oldIDs[0]) >= 0) {
      Object.keys(checks).forEach(function (k) {
        out[k === "incubate" || k.indexOf("master.") === 0 ? k : oldIDs[0] + "." + k] = checks[k];
      });
      return out;
    }
    if (oldIDs.length > 1 && newIDs.length === 1) {
      var prefix = newIDs[0] + ".";
      Object.keys(checks).forEach(function (k) {
        if (k === "incubate") out[k] = checks[k];
        else if (k.indexOf(prefix) === 0) out[k.slice(prefix.length)] = checks[k];
      });
      return out;
    }
    return Object.assign(out, checks);
  }

  var api = {
    PLASMID_RANGE: PLASMID_RANGE, RUN_RANGE: RUN_RANGE, FLASK_RANGE: FLASK_RANGE, MAX_BP: MAX_BP,
    settingsFrom: settingsFrom, volumeText: volumeText, cultureLiters: cultureLiters, switchUnit: switchUnit, flaskFor: flaskFor,
    newRun: newRun, newPlasmidRow: newPlasmidRow, reserveIDs: reserveIDs,
    runDisplayName: runDisplayName, plasmidDisplayName: plasmidDisplayName,
    flaskCount: flaskCount, sizeBP: sizeBP, parsedPlasmids: parsedPlasmids, runInput: runInput, runBlockers: runBlockers,
    compute: compute, isChecked: isChecked, toggle: toggle, dropRunChecks: dropRunChecks, rekeyChecks: rekeyChecks
  };
  BM.transfectionModel = api;
  // One handle for the page and the tests.
  BM.transfection.model = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
