/*
 * Magnetic sort: STEMCELL EasySep negative selection for mouse T cells. Ported from
 * Sources/Core/EasySepEngine.swift (kits, resuspension, separation, two-sort schedule, live
 * run) and the derived values of EasySepModel / EasySepView (sample draft, result lines,
 * reagent table, step list). Pure functions; index.html draws the page.
 * Needs assets/bench.js loaded first.
 *
 * Volumes are mL, reagent doses µL per mL. Times are seconds; a "date" in the live run is
 * any number of seconds on one shared clock (the page passes Date.now() / 1000).
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var F = BM.format;

  var TARGET_DENSITY = 1e8; // cells/mL every kit asks for
  // A split of more than this many tubes means a typo (e.g. 1e9 mL), not a plan. The app
  // trapped on Int(huge); the web refuses (deep review 2026-10-28, P1).
  var MAX_TUBES = 1000;

  // ---------------------------------------------------------------- magnets
  var MAGNETS = {
    easySep: { id: "easySep", name: "EasySep", catalog: "18000", tube: "5 mL (12 × 75 mm) round-bottom tube", separationMinutes: 2.5 },
    bigEasy: { id: "bigEasy", name: "Big Easy", catalog: "18001", tube: "14 mL (17 × 95 mm) round-bottom tube", separationMinutes: 2.5 }
  };
  /** "Top up to 2.5 mL"; the Big Easy tops up to 5 mL below a 4 mL sample, else 10 mL. */
  function topUpVolume(magnet, sampleML) {
    return magnet === "easySep" ? 2.5 : (sampleML < 4 ? 5 : 10);
  }

  // ---------------------------------------------------------------- kits
  var LINES = { otI: "OT-I", otII: "OT-II", other: "Other" };
  var STANDARD_MEDIUM = "EasySep Buffer (#20144), RoboSep Buffer (#20104), or PBS + 2% FBS + 1 mM EDTA; no Ca²⁺, Mg²⁺ or biotin";

  function shortName(r) {
    if (r.kind === "fcrBlocker") return "FcR";
    if (r.kind === "rapidSpheres") return "RapidSpheres";
    return r.id === "depletion" ? "Depletion cocktail" : "Cocktail";
  }
  function reagent(id, name, kind, dose, minutes, note) {
    var r = { id: id, name: name, kind: kind, microlitersPerML: dose, incubationMinutes: minutes, note: note };
    r.shortName = shortName(r);
    return r;
  }
  function fcr(dose, catalog) { return reagent("fcr", "FcR Blocker", "fcrBlocker", dose, null, "Mouse FcR Blocker #" + catalog); }
  function cocktail(minutes, name, id) {
    return reagent(id || "cocktail", name || "Isolation Cocktail", "cocktail", 50, minutes, "Don't vortex the cocktail");
  }
  function spheres(dose, minutes) {
    return reagent("spheres", "RapidSpheres", "rapidSpheres", dose, minutes, "Vortex 30 s first, until evenly dispersed");
  }

  var KITS = [
    { id: "19853", name: "Mouse CD8⁺ T Cell Isolation", target: "CD8⁺ T cells", line: "otI",
      reagents: [fcr(20, "18730"), cocktail(10), spheres(125, 5)],
      rangeEasySep: [0.25, 2], rangeBigEasy: [0.5, 8], medium: STANDARD_MEDIUM,
      purity: "Up to 95% CD8⁺", document: "PIS #10000003748 v04" },
    { id: "19858", name: "Mouse Naïve CD8⁺ T Cell Isolation", target: "Naïve CD8⁺ T cells", line: "otI",
      reagents: [fcr(10, "18720"), cocktail(10), spheres(100, 5)],
      rangeEasySep: [0.25, 2], rangeBigEasy: [0.5, 8.5], medium: STANDARD_MEDIUM,
      purity: "Up to 98% CD44⁻CD62L⁺", document: "PIS #10000003738 v02" },
    { id: "19852", name: "Mouse CD4⁺ T Cell Isolation", target: "CD4⁺ T cells", line: "otII",
      reagents: [fcr(20, "18730"), cocktail(10), spheres(75, 2.5)],
      rangeEasySep: [0.25, 2], rangeBigEasy: [0.5, 8], medium: STANDARD_MEDIUM,
      purity: "Up to 96% CD4⁺", document: "PIS #10000003746 v04" },
    { id: "19765", name: "Mouse Naïve CD4⁺ T Cell Isolation", target: "Naïve CD4⁺ T cells", line: "otII",
      reagents: [fcr(10, "18720"), cocktail(7.5, "CD4⁺ Isolation Cocktail"), cocktail(2.5, "Memory Depletion Cocktail", "depletion"), spheres(75, 2.5)],
      rangeEasySep: [0.1, 2], rangeBigEasy: [0.25, 8],
      medium: "RoboSep Buffer (#20104) or PBS + 2% FBS (this kit's sheet lists no EDTA)",
      purity: "Up to 95% naïve CD4⁺", document: "PIS #10000003734 v03" },
    { id: "19851", name: "Mouse T Cell Isolation", target: "All T cells", line: "other",
      reagents: [fcr(20, "18730"), cocktail(10), spheres(75, 2.5)],
      rangeEasySep: [0.1, 2], rangeBigEasy: [0.25, 8], medium: STANDARD_MEDIUM,
      purity: "Up to 99% CD3⁺", document: "PIS #10000003744 v03" }
  ];
  function kit(id) { return KITS.filter(function (k) { return k.id === id; })[0] || null; }
  function sampleRange(k, magnet) { return magnet === "easySep" ? k.rangeEasySep : k.rangeBigEasy; }

  // ---------------------------------------------------------------- bringing the cells to 1 × 10⁸/mL
  var MODES = { concentrate: "Spin down", dilutePortion: "Dilute part", diluteAll: "Dilute all" };

  /**
   * `density` is all nucleated cells per mL (live and dead: EasySep counts both).
   * Returns null for non-positive input, or a plan { mode, cells, suspensionML, diluentML|null,
   * sampleML, issue: null | {kind: "tooDiluteToDilute" | "alreadyConcentrated" | "notEnoughCells", neededML?} }.
   */
  function resuspension(density, volumeML, mode, portionML, target) {
    if (target === undefined) target = TARGET_DENSITY;
    if (!(density > 0 && volumeML > 0 && target > 0)) return null;
    var cells = density * volumeML;
    if (mode === "concentrate") {
      return { mode: mode, cells: cells, suspensionML: volumeML, diluentML: null, sampleML: cells / target,
        issue: density >= target ? { kind: "alreadyConcentrated" } : null };
    }
    if (mode === "diluteAll") {
      var sample = cells / target;
      return { mode: mode, cells: cells, suspensionML: volumeML, diluentML: Math.max(sample - volumeML, 0), sampleML: sample,
        issue: density < target ? { kind: "tooDiluteToDilute" } : null };
    }
    if (mode === "dilutePortion") {
      if (!(portionML > 0)) return null;
      var take = portionML * target / density;
      var issue = density < target ? { kind: "tooDiluteToDilute" }
        : take > volumeML * (1 + 1e-9) ? { kind: "notEnoughCells", neededML: take } : null;
      return { mode: mode, cells: portionML * target, suspensionML: take, diluentML: Math.max(portionML - take, 0), sampleML: portionML, issue: issue };
    }
    return null;
  }

  // ---------------------------------------------------------------- reagents and separation
  /**
   * Scales every reagent by the sample, splitting a sample above the magnet's range across the
   * fewest equal tubes that fit. Null for a non-positive or absurd (> MAX_TUBES tubes) sample.
   */
  function separation(k, magnet, sampleML) {
    if (!(sampleML > 0) || !isFinite(sampleML)) return null;
    var range = sampleRange(k, magnet);
    var tubes = Math.max(Math.ceil(sampleML / range[1] - 1e-9), 1);
    if (tubes > MAX_TUBES) return null;
    var perTube = sampleML / tubes;
    var lines = k.reagents.map(function (r) {
      return { reagent: r, id: r.id, perTubeUL: r.microlitersPerML * perTube, totalUL: r.microlitersPerML * sampleML };
    });
    var reagentsML = lines.reduce(function (a, l) { return a + l.perTubeUL; }, 0) / 1000;
    var topUp = topUpVolume(magnet, perTube);
    var issue = perTube < range[0] - 1e-9 ? { kind: "belowRange", minML: range[0] }
      : tubes > 1 ? { kind: "split", tubes: tubes } : null;
    return { kit: k, magnet: magnet, sampleML: sampleML, tubes: tubes, perTubeML: perTube, lines: lines,
      topUpToML: topUp, topUpAddML: Math.max(topUp - perTube - reagentsML, 0), issue: issue };
  }

  // ---------------------------------------------------------------- two sorts at once
  /** A kit's separation as hands-on moments: FcR with the first cocktail, each further cocktail,
   *  the RapidSpheres, then top up and into the magnet, then pour off. `wait` is seconds. */
  function actions(k, magnet) {
    var out = [], pending = [];
    k.reagents.forEach(function (r) {
      pending.push(r);
      if (r.incubationMinutes == null) return;
      var title = pending.map(function (p) { return p.shortName; }).join(" + ");
      out.push({ id: r.id, kind: "reagent", title: r.kind === "rapidSpheres" ? "Vortex, add " + title : "Add " + title,
        reagents: pending, wait: r.incubationMinutes * 60 });
      pending = [];
    });
    out.push({ id: "magnet", kind: "topUpAndMagnet", title: "Top up, into the magnet", reagents: [], wait: MAGNETS[magnet].separationMinutes * 60 });
    out.push({ id: "pour", kind: "pourOff", title: "Pour off", reagents: [], wait: 0 });
    return out;
  }

  function times(acts, start, handling) {
    var t = start;
    return acts.map(function (a) { var at = t; t += handling + a.wait; return at; });
  }
  function overlaps(a, b) { return a[0] < a[1] && b[0] < b[1] && a[0] < b[1] && b[0] < a[1]; }
  function indexOfKind(acts, kind) {
    for (var i = 0; i < acts.length; i++) if (acts[i].kind === kind) return i;
    return -1;
  }
  function magnetSpan(acts, ts, handling) {
    var i = indexOfKind(acts, "topUpAndMagnet"), p = indexOfKind(acts, "pourOff");
    return i < 0 || p < 0 ? null : [ts[i], ts[p] + handling];
  }

  /**
   * Staggers two sorts so no two hands-on moments overlap and, with one magnet, the tubes never
   * need it at the same time. Tries every offset of either sort on a 15 s grid and keeps the one
   * that finishes soonest (ties: the smaller offset, then sort 1 first).
   * Returns { actions: [{id, sample, action, at}], starts: [s0, s1], end } or null.
   */
  function schedule(first, second, handling, magnets) {
    if (handling === undefined) handling = 60;
    if (magnets === undefined) magnets = 1;
    if (!first.length || !second.length || !(handling > 0)) return null;
    var a = times(first, 0, handling);
    var aMagnet = magnetSpan(first, a, handling);
    var step = 15;
    var limit = a[a.length - 1] + handling + 60 * 60;
    var best = null;
    for (var k = 0; k <= limit; k += step) {
      var offsets = k === 0 ? [0] : [k, -k];
      for (var oi = 0; oi < offsets.length; oi++) {
        var offset = offsets[oi];
        var b = times(second, offset, handling);
        var clash = a.some(function (ta) { return b.some(function (tb) { return Math.abs(ta - tb) < handling - 1e-9; }); });
        if (clash) continue;
        if (magnets < 2 && aMagnet) {
          var bm = magnetSpan(second, b, handling);
          if (bm && overlaps(aMagnet, bm)) continue;
        }
        var end = Math.max(a[a.length - 1], b[b.length - 1]) + handling;
        if (best === null || end < best.end - 1e-9) best = { offset: offset, end: end };
      }
      // Past the best end there is nothing shorter to find.
      if (best && k > best.end) break;
    }
    if (!best) return null;
    var b2 = times(second, best.offset, handling);
    var shift = Math.min(0, best.offset);
    var scheduled = first.map(function (x, i) { return { id: "0." + x.id, sample: 0, action: x, at: a[i] - shift }; })
      .concat(second.map(function (x, i) { return { id: "1." + x.id, sample: 1, action: x, at: b2[i] - shift }; }));
    scheduled.sort(function (x, y) { return x.at - y.at || x.sample - y.sample; });
    return { actions: scheduled, starts: [0 - shift, best.offset - shift], end: best.end - shift };
  }

  // ---------------------------------------------------------------- the run as it really goes
  /**
   * A parallel run timed from what was really done when, so running late never cuts an
   * incubation short. Each step is due its planned gap after the Done tap of its anchor: the
   * step before it in the same sort, or, for the second sort's first step, the other sort's step
   * planned just before it. Steps whose anchor isn't done yet are projected from `now`.
   * `doneAt` maps a scheduled action id ("0.cocktail") to the second it was marked done.
   */
  function liveRun(sched, start, handling, magnets, doneAt) {
    doneAt = doneAt || {};
    var run = {
      schedule: sched, start: start, handling: handling, magnets: magnets, doneAt: doneAt,
      isDone: function (a) { return doneAt[a.id] !== undefined; },
      anchor: function (a) {
        var mine = sched.actions.filter(function (x) { return x.sample === a.sample; });
        var i = mine.map(function (x) { return x.id; }).indexOf(a.id);
        if (i > 0) return mine[i - 1];
        var others = sched.actions.filter(function (x) { return x.sample !== a.sample && x.at <= a.at; });
        return others.length ? others[others.length - 1] : null;
      },
      /** The due time is fixed: its anchor is done (or it has none). Only these get a timer. */
      isTimed: function (a) { var an = run.anchor(a); return an ? run.isDone(an) : true; },
      due: function (a, now) { return start + a.at + shiftAfter(run.anchor(a), now); },
      /** Steps that can be done now or next (not done, anchor done), soonest due first. */
      ready: function (now) {
        return sched.actions.filter(function (a) { return !run.isDone(a) && run.isTimed(a); })
          .map(function (a) { return { a: a, d: run.due(a, now) }; })
          .sort(function (x, y) { return x.d - y.d; })
          .map(function (x) { return x.a; });
      },
      /** How far behind the plan the step is (negative when ahead). */
      behind: function (a, now) { return run.due(a, now) - (start + a.at); },
      /** With one magnet, a top-up-and-magnet step waits while the other tube stands in it:
       *  the time the other sort is expected to pour off, else null. */
      magnetFree: function (a, now) {
        if (magnets >= 2 || a.action.kind !== "topUpAndMagnet") return null;
        var other = sched.actions.filter(function (x) { return x.sample !== a.sample; });
        var stand = other.filter(function (x) { return x.action.kind === "topUpAndMagnet"; })[0];
        if (!stand || !run.isDone(stand)) return null;
        var pour = other.filter(function (x) { return x.action.kind === "pourOff"; })[0];
        if (!pour || run.isDone(pour)) return null;
        return Math.max(run.due(pour, now), now) + handling;
      },
      isFinished: function () { return sched.actions.every(run.isDone); }
    };
    function shiftAfter(anchor, now) {
      if (!anchor) return 0;
      var planned = start + anchor.at + handling;
      if (doneAt[anchor.id] !== undefined) return doneAt[anchor.id] - planned;
      // Not done yet: done no sooner than its own due time, nor than now, plus the handling.
      var begins = Math.max(run.due(anchor, now), now);
      return begins + handling - planned;
    }
    return run;
  }

  // ---------------------------------------------------------------- the model's derived values
  /** A typed positive number through BM.format.parse (EasySepSampleDraft.number); null otherwise. */
  function number(text) {
    var v = F.parse(text);
    return v !== null && v > 0 ? v : null;
  }
  var mL = function (v) { return F.volume(v / 1000); };
  var uL = function (v) { return F.volume(v / 1e6); };
  var minutes = function (m) { return F.plain(m) + " min"; };

  /**
   * One sort's derived values from its typed fields:
   * { kitID, densityText, volumeText, mode, portionText, sampleText (null follows the Cells
   *   result), isolatedDensityText, isolatedVolumeText }.
   */
  function sampleOf(d, magnet) {
    var k = kit(d.kitID) || KITS[0];
    var density = number(d.densityText), volume = number(d.volumeText);
    var plan = density !== null && volume !== null ? resuspension(density, volume, d.mode, number(d.portionText)) : null;
    var planned = null;
    if (plan && (!plan.issue || plan.issue.kind === "alreadyConcentrated")) planned = plan.sampleML;
    var sampleML = d.sampleText != null && String(d.sampleText).trim() !== "" ? number(d.sampleText) : planned;
    var sep = sampleML !== null ? separation(k, magnet, sampleML) : null;
    var id = number(d.isolatedDensityText), iv = number(d.isolatedVolumeText);
    var isolated = id !== null && iv !== null ? id * iv : null;
    var input = sampleML !== null ? sampleML * TARGET_DENSITY : null;
    return { kit: k, density: density, volume: volume, resuspension: plan, plannedSampleML: planned, sampleML: sampleML,
      separation: sep, inputCells: input, isolatedCells: isolated,
      recoveryPercent: isolated !== null && input ? isolated / input * 100 : null };
  }

  /** Diluting needs at least 1 × 10⁸/mL; spinning down is for anything thinner. */
  function suggestMode(mode, density) {
    if (density === null) return mode;
    if (density < TARGET_DENSITY && mode !== "concentrate") return "concentrate";
    if (density >= TARGET_DENSITY && mode === "concentrate") return "diluteAll";
    return mode;
  }

  /** The magnet's range, said where it matters: too little, or more than one tube. */
  function rangeLines(sampleML, k, magnet) {
    var sep = separation(k, magnet, sampleML);
    if (!sep || !sep.issue) return [];
    if (sep.issue.kind === "split") {
      return ["More than one " + MAGNETS[magnet].name + " tube holds: split into " + sep.issue.tubes + " tubes of " + mL(sep.perTubeML) + "."];
    }
    return ["Below the " + MAGNETS[magnet].name + " magnet's " + mL(sep.issue.minML) + " minimum for this kit."];
  }

  /** The Cells result card: { eyebrow, value, unit, lines, warnings }. */
  function describeResuspension(plan, k, magnet) {
    var volume = mL(plan.sampleML), cells = F.scientific(plan.cells);
    var range = rangeLines(plan.sampleML, k, magnet);
    var out;
    if (plan.mode === "concentrate") {
      var v = F.volumeParts(plan.sampleML / 1000);
      out = { eyebrow: "Resuspend to", value: v.value, unit: v.unit + " final",
        lines: ["Spin the " + mL(plan.suspensionML) + ", pour off, and bring the pellet up to " + volume + " in all; the pellet and leftover drops count toward it.",
          cells + " cells at 1 × 10⁸/mL."].concat(range) };
    } else if (plan.mode === "dilutePortion") {
      var t = F.volumeParts(plan.suspensionML / 1000);
      out = { eyebrow: "Take", value: t.value, unit: t.unit + " cells",
        lines: ["+ " + mL(plan.diluentML || 0) + " medium → " + volume + " at 1 × 10⁸/mL (" + cells + " cells)."].concat(range) };
    } else {
      var d = F.volumeParts((plan.diluentML || 0) / 1000);
      out = { eyebrow: "Add", value: d.value, unit: d.unit + " medium",
        lines: ["To all " + mL(plan.suspensionML) + " → " + volume + " at 1 × 10⁸/mL (" + cells + " cells)."].concat(range) };
    }
    out.warnings = resuspensionWarnings(plan, k, magnet);
    return out;
  }

  /** Every guardrail the app shows for a sample: the result card's status and the range notes. */
  function resuspensionWarnings(plan, k, magnet) {
    var w = [];
    var issue = plan.issue;
    if (issue) {
      if (issue.kind === "tooDiluteToDilute") w.push({ level: "warn", text: "Thinner than 1 × 10⁸/mL: spin down instead" });
      else if (issue.kind === "alreadyConcentrated") w.push({ level: "warn", text: "Already at 1 × 10⁸/mL or more: diluting is simpler" });
      else if (issue.kind === "notEnoughCells") w.push({ level: "warn", text: "Needs " + mL(issue.neededML) + " of suspension; you have less" });
    }
    // The range lines are shown as plain lines in the card (as in the app) and also warned here
    // so the copy/aria text never loses them.
    var sep = (!issue || issue.kind === "alreadyConcentrated") ? separation(k, magnet, plan.sampleML) : null;
    if (sep && sep.issue && sep.issue.kind === "belowRange") {
      w.push({ level: "warn", text: "Below the " + MAGNETS[magnet].name + " magnet's " + mL(sep.issue.minML) + " minimum for this kit." });
    }
    return w;
  }

  /** Warnings under the Reagents table. */
  function separationWarnings(sep) {
    var w = [];
    if (!sep || !sep.issue) return w;
    if (sep.issue.kind === "belowRange") {
      w.push({ level: "warn", text: "Below the " + mL(sep.issue.minML) + " minimum for this kit in the " + MAGNETS[sep.magnet].name + " magnet." });
    }
    return w;
  }

  /** "Split into 3 tubes of 1.667 mL; amounts are per tube." or null. */
  function splitNote(sep) {
    return sep && sep.tubes > 1 ? "Split into " + sep.tubes + " tubes of " + mL(sep.perTubeML) + "; amounts are per tube." : null;
  }

  /** The multiplication table: one row per reagent in the order they're added, then the top-up. */
  function reagentRows(sep) {
    var rows = sep.lines.map(function (l) {
      return {
        name: l.reagent.name,
        note: l.reagent.incubationMinutes != null ? "then " + minutes(l.reagent.incubationMinutes) + " at RT" : null,
        dose: F.plain(l.reagent.microlitersPerML) + " µL/mL × " + mL(sep.perTubeML),
        amount: uL(l.perTubeUL),
        total: sep.tubes > 1 ? uL(l.totalUL) + " in all" : null
      };
    });
    rows.push({ name: "Top up", note: "to " + F.plain(sep.topUpToML) + " mL with medium", dose: null,
      amount: "+ " + mL(sep.topUpAddML), total: null });
    return rows;
  }

  /** The one-sort checklist, as step specs for BM.steps.list. `sortName` is e.g. "CD8⁺ T cells". */
  function singleSteps(sep, sortName) {
    var tubes = sep.tubes > 1 ? "× " + sep.tubes + " tubes" : null;
    var out = [{ id: "sample", title: "Sample into the tube", note: MAGNETS[sep.magnet].tube, amount: mL(sep.perTubeML), amountNote: tubes }];
    sep.lines.forEach(function (line, index) {
      var r = line.reagent;
      out.push({ id: r.id, title: "Add " + r.name, note: r.note, amount: uL(line.perTubeUL), amountNote: tubes,
        timer: r.incubationMinutes != null ? { key: "easysep." + r.id, minutes: r.incubationMinutes, label: "Mix, then RT", message: r.name + " incubation done" } : null });
    });
    out.push({ id: "topup", title: "Top up to " + F.plain(sep.topUpToML) + " mL", note: "Medium; mix by gently pipetting 2–3 times",
      amount: "+ " + mL(sep.topUpAddML), amountNote: tubes });
    out.push({ id: "magnet", title: "Into the magnet, lid off", note: null,
      timer: { key: "easysep.magnet", minutes: MAGNETS[sep.magnet].separationMinutes, label: "RT", message: "Pour off now" } });
    out.push({ id: "pour", title: "Pour off into a new tube",
      note: "Invert magnet and tube in one motion, hold 2–3 s, turn upright. Don't shake or blot the hanging drops." });
    return out;
  }

  /** "28.8 µL + 72 µL, then 10 min" for a reagent step; the top-up volume; the pour-off note. */
  function amountsText(scheduled, sep) {
    if (!sep) return null;
    var tubes = sep.tubes > 1 ? " per tube (" + sep.tubes + ")" : "";
    var a = scheduled.action;
    var wait = a.wait > 0 ? ", then " + minutes(a.wait / 60) : "";
    if (a.kind === "reagent") {
      var parts = [];
      a.reagents.forEach(function (r) {
        var line = sep.lines.filter(function (l) { return l.id === r.id; })[0];
        if (line) parts.push(uL(line.perTubeUL));
      });
      return parts.join(" + ") + tubes + wait;
    }
    if (a.kind === "topUpAndMagnet") return "+ " + mL(sep.topUpAddML) + " medium to " + F.plain(sep.topUpToML) + " mL" + tubes + ", mix" + wait;
    return "Into a new tube in one motion; don't blot";
  }

  var api = {
    TARGET_DENSITY: TARGET_DENSITY, MAX_TUBES: MAX_TUBES, MAGNETS: MAGNETS, LINES: LINES, MODES: MODES, KITS: KITS,
    kit: kit, sampleRange: sampleRange, topUpVolume: topUpVolume,
    resuspension: resuspension, separation: separation, actions: actions, schedule: schedule, liveRun: liveRun,
    number: number, sampleOf: sampleOf, suggestMode: suggestMode,
    describeResuspension: describeResuspension, separationWarnings: separationWarnings, splitNote: splitNote,
    reagentRows: reagentRows, singleSteps: singleSteps, amountsText: amountsText
  };
  BM.easysep = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
