/*
 * Transfection batch: several transfections side by side, with a PEI master mix and shelf totals.
 * Ported from Sources/Core/TransfectionBatch.swift (batch plan, batch recipe, reagent lines, plain
 * text) and the single-run report readings in Sources/Core/TransfectionRun.swift (TransfectionReport:
 * settingsRows, resultRows, plainText). Pure functions; needs engine.js (and assets/bench.js) first.
 *
 * Run ids are plain strings here (the app uses UUIDs): item ids are "<run id>.<section>.<line>" when
 * there are two or more transfections, and bare ("a.diluent") for one.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var E = BM.transfection || require("./engine.js");
  var T = E.Text, AL = E.Aligned, D = E.Defaults, R = E.Recipe, U = BM.units;

  function sum(list, f) { return list.reduce(function (a, x) { return a + f(x); }, 0); }
  function massConc(id, v) { return U.massConc.toBase(id, v); }

  // ---------------------------------------------------------------- batch plan
  /**
   * run = { id, name, cultureVolumePerFlask, flaskCount, plasmids, ratioBasis }.
   * Returns null when any run can't be solved (missing plasmid size in molar mode) or there are no runs.
   * Densities in cells per liter; volumes in liters.
   */
  function batchPlan(defaults, runs, excessFraction, seedingDensity, sourceDensity) {
    if (!runs.length) return null;
    var mixFraction = D.mixFraction(defaults);
    var solved = [];
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      var count = Math.max(r.flaskCount, 1);
      var mixPerFlask = r.cultureVolumePerFlask * mixFraction;
      var totalCulture = r.cultureVolumePerFlask * count;
      var p = E.plan({
        cultureVolume: totalCulture, mixVolume: mixPerFlask * count,
        dnaDosePerLiter: massConc("ugPerML", defaults.doseUgPerML),
        peiToDNAMassRatio: defaults.peiToDNARatio,
        peiStockConcentration: massConc("mgPerML", defaults.peiStockMgPerML),
        plasmids: r.plasmids, ratioBasis: r.ratioBasis, mixingMode: defaults.mixingMode,
        excessFraction: excessFraction, cellDensity: seedingDensity
      });
      if (!p) return null;
      var cells = E.cellPlan(r.cultureVolumePerFlask, seedingDensity, sourceDensity, mixPerFlask);
      solved.push({
        id: r.id, name: r.name, flaskCount: count, cultureVolumePerFlask: r.cultureVolumePerFlask,
        mixVolumePerFlask: mixPerFlask, plan: p, cells: cells, totalCulture: r.cultureVolumePerFlask * count, input: r
      });
    }

    // No master mix while any run's tubes overflow: its clamped Tube B would put the wrong PEI
    // concentration in the shared mix.
    var master = null;
    if (defaults.mixingMode === "twoTubes" && solved.length > 1 && solved.every(function (r) { return E.isFeasible(r.plan); })) {
      var tubes = solved.filter(function (r) { return r.plan.peiTube; });
      var m = {
        diluentVolume: sum(tubes, function (r) { return r.plan.peiTube.diluentVolume; }),
        peiVolume: sum(tubes, function (r) { return r.plan.peiTube.peiVolume || 0; }),
        portions: tubes.map(function (r) { return { id: r.id, name: r.name, volume: r.plan.peiTube.totalVolume }; })
      };
      m.totalVolume = m.diluentVolume + m.peiVolume;
      m.tubeHint = T.tubeHint(m.totalVolume);
      /** g/L of PEI in the mix (and so in every portion). */
      m.peiConcentration = function (gramsPerLiter) { return m.totalVolume > 0 ? m.peiVolume * gramsPerLiter / m.totalVolume : 0; };
      m.portion = function (runId) { return m.portions.filter(function (q) { return q.id === runId; })[0] || null; };
      master = m;
    }

    // Grouped by name + stock across runs (a plasmid listed twice in one run still counts that run once).
    var plasmidTotals = [], runsUsing = {};
    solved.forEach(function (run) {
      run.plan.plasmids.forEach(function (line, idx) {
        var input = run.input.plasmids[idx];
        if (!input) return;
        var key = line.name + "|" + input.stockConcentration;
        (runsUsing[key] = runsUsing[key] || {})[run.id] = true;
        var existing = plasmidTotals.filter(function (t) { return t.id === key; })[0];
        if (existing) {
          existing.mass += line.mass;
          existing.volume += line.stockVolume;
          existing.runCount = Object.keys(runsUsing[key]).length;
        } else {
          plasmidTotals.push({ id: key, name: line.name, stockConcentration: input.stockConcentration, mass: line.mass, volume: line.stockVolume, runCount: 1 });
        }
      });
    });

    var sourceOK = solved.every(function (r) { return r.cells.sourceVolume != null && !r.cells.sourceBelowSeeding; });
    var totals = {
      runCount: solved.length,
      flaskCount: sum(solved, function (r) { return r.flaskCount; }),
      culture: sum(solved, function (r) { return r.totalCulture; }),
      mix: sum(solved, function (r) { return r.mixVolumePerFlask * r.flaskCount; }),
      dnaMass: sum(solved, function (r) { return r.plan.totalDNAMass; }),
      peiMass: sum(solved, function (r) { return r.plan.peiMass; }),
      peiStockVolume: sum(solved, function (r) { return r.plan.peiStockVolume; }),
      diluentVolume: sum(solved, function (r) { return r.plan.dnaTube.diluentVolume + (r.plan.peiTube ? r.plan.peiTube.diluentVolume : 0); }),
      plasmids: plasmidTotals,
      cellsNeeded: sum(solved, function (r) { return r.cells.cellsNeeded * r.flaskCount; }),
      sourceVolume: sourceOK ? sum(solved, function (r) { return (r.cells.sourceVolume || 0) * r.flaskCount; }) : null,
      mediaVolume: sourceOK ? sum(solved, function (r) { return (r.cells.mediaVolume || 0) * r.flaskCount; }) : null
    };
    var feasible = solved.every(function (r) { return E.isFeasible(r.plan); });
    return {
      runs: solved, masterMix: master, totals: totals,
      isFeasible: feasible,
      /** The shelf-check policy: totals are shown only when every run's tubes fit. */
      showsTotals: feasible,
      /** [{ name, reason }] for the runs whose tubes overflow. */
      infeasibleRuns: solved.filter(function (r) { return !E.isFeasible(r.plan); })
        .map(function (r) { return { name: r.name, reason: E.infeasibleReason(r.plan) }; }),
      run: function (id) { return solved.filter(function (r) { return r.id === id; })[0] || null; },
      /** A master mix is made and the excess is 0 %: suggest +5 % (never applied automatically). */
      suggestsMasterMixExcess: function (excessPercent) { return master != null && excessPercent === 0; }
    };
  }

  // ---------------------------------------------------------------- reagents needed
  /** The shelf check, in order: PEI stock, diluent, each plasmid stock, then cells. Volumes include the excess. */
  function reagentLines(batch, defaults) {
    var out = [], t = batch.totals;
    function volume(id, name, liters, scale, mass, note) {
      var a = AL.volume(liters, scale);
      out.push({ id: id, name: name, amount: a, text: a.text, mass: mass == null ? null : mass, note: note == null ? null : note });
    }
    volume("pei", "PEI stock", t.peiStockVolume, "mix", t.peiMass, D.peiStockText(defaults) + " stock");
    var tubes = defaults.mixingMode === "twoTubes" ? (batch.masterMix ? "every Tube A + the master mix" : "every Tube A and B") : "every tube";
    volume("diluent", D.diluentDisplayName(defaults), t.diluentVolume, "mix", null, tubes);
    t.plasmids.forEach(function (p) {
      var used = batch.runs.length > 1 ? " · " + (p.runCount === 1 ? "1 transfection" : p.runCount + " transfections") : "";
      volume("plasmid." + p.id, p.name, p.volume, "mix", p.mass, T.number(p.stockConcentration * 1000, 1) + " ng/µL" + used);
    });
    var flasks = T.flaskCount(t.flaskCount);
    out.push({
      id: "cells", name: "Live cells", amount: null, text: T.scientific(t.cellsNeeded) + " live", mass: null,
      note: t.sourceVolume == null ? flasks + " · count the source flask for volumes" : flasks
    });
    if (t.sourceVolume != null && t.mediaVolume != null) {
      var sd = batch.runs[0].cells.sourceDensity;
      volume("source", "Source culture", t.sourceVolume, "culture", null, sd != null ? "at " + T.millions(sd / 1000) + "/mL" : null);
      volume("medium", "Fresh medium", t.mediaVolume, "culture", null, "makes " + AL.volume(t.culture, "culture").text + " of culture");
    }
    return out;
  }

  // ---------------------------------------------------------------- batch recipe
  /**
   * The batch as checkable lines: an optional PEI master-mix section, then one group per run. With two
   * or more runs every id in a run group is "<run id>." + the single-run id, "Incubate" leaves the run
   * groups (one shared "incubate" item), and with a master mix each Tube B is one line ("<run>.b.master").
   */
  function batchRecipe(defaults, batch) {
    var multi = batch.runs.length > 1;
    var master = null;
    if (batch.masterMix) {
      var m = batch.masterMix;
      var perML = T.number(m.peiConcentration(massConc("mgPerML", defaults.peiStockMgPerML)) * 1000, 1);
      var total = AL.volume(m.totalVolume, "mix").text;
      master = { id: "master", title: "PEI master mix", items: [
        { id: "master.diluent", name: D.diluentDisplayName(defaults), amount: AL.volume(m.diluentVolume, "mix"), mass: null,
          note: "for every Tube B · " + total + " in a " + m.tubeHint },
        { id: "master.pei", name: "PEI", amount: AL.volume(m.peiVolume, "mix"), mass: batch.totals.peiMass,
          note: D.peiStockText(defaults) + " stock · " + perML + " µg/mL in the mix" }
      ] };
    }
    var groups = batch.runs.map(function (run) {
      var r = R.build(defaults, run.plan, run.cells, run.cultureVolumePerFlask, run.flaskCount);
      var prefix = multi ? run.id + "." : "";
      var portion = batch.masterMix ? batch.masterMix.portion(run.id) : null;
      var sections = r.sections.map(function (s) {
        var items = s.items;
        if (s.id === "b" && portion) {
          items = [{ id: "b.master", name: "PEI master mix", amount: AL.volume(portion.volume, "mix"), mass: run.plan.peiMass, note: "portion of the master mix" }];
        }
        if (multi) items = items.filter(function (i) { return i.id !== "incubate"; });
        return {
          id: prefix + s.id, title: s.title,
          items: items.map(function (i) { return { id: prefix + i.id, name: i.name, amount: i.amount, mass: i.mass, note: i.note }; })
        };
      });
      var recipe = { sections: sections };
      var g = {
        id: run.id, name: run.name, flaskCount: run.flaskCount, recipe: recipe,
        cultureVolumePerFlask: run.cultureVolumePerFlask,
        flasksText: T.flasks(run.flaskCount, run.cultureVolumePerFlask),
        portionItem: R.allItems(recipe).filter(function (i) { return R.baseID(i.id) === "master"; })[0] || null
      };
      return g;
    });
    var incubate = multi ? { id: "incubate", name: "Incubate", amount: null, mass: null, note: D.incubationText(defaults) } : null;
    var rec = {
      masterMix: master, runs: groups, incubate: incubate,
      allItems: (master ? master.items : []).concat(
        groups.reduce(function (a, g) { return a.concat(R.allItems(g.recipe)); }, []),
        incubate ? [incubate] : []),
      /** The master mix's "Portion out" lines, in run order. */
      portionItems: groups.filter(function (g) { return g.portionItem; }).map(function (g) { return { id: g.id, name: g.name, item: g.portionItem }; }),
      item: function (id) { return rec.allItems.filter(function (i) { return i.id === id; })[0] || null; },
      group: function (id) { return groups.filter(function (g) { return g.id === id; })[0] || null; }
    };
    return rec;
  }

  // ---------------------------------------------------------------- readings
  /** The protocol every transfection shares, as [name, value] rows. */
  function protocolRows(d, excessPct, seedingPerML, sourcePerML) {
    return [
      ["DNA : PEI", D.ratioText(d) + " (w/w)"],
      ["DNA dose", D.doseText(d)],
      ["PEI stock", D.peiStockText(d)],
      ["Diluent", D.diluentDisplayName(d)],
      ["Mixing", D.mixingText(d)],
      ["Mix volume", D.mixReferenceText(d) + " of culture"],
      ["Culture : mix", D.cultureToMixText(d)],
      ["Excess", E.excessText(excessPct)],
      ["Seeding density", T.millions(seedingPerML) + " live cells/mL"],
      ["Source density", sourcePerML != null ? T.millions(sourcePerML) + " live cells/mL" : "not counted"],
      ["Incubation", D.incubationText(d)]
    ];
  }

  /** "2 transfections · 4 flasks · 780.0 mL of culture". */
  function headline(batch) {
    var t = batch.totals;
    return (t.runCount === 1 ? "1 transfection" : t.runCount + " transfections") + " · " + T.flaskCount(t.flaskCount) + " · " +
      AL.volume(t.culture, "culture").text + " of culture";
  }

  /**
   * The single-run report's readings (TransfectionReport) for one transfection of one flask:
   * rep = { defaults, run (batch run), excessPct, sourceDensityPerML, seedingDensityPerML, flaskTitle, plasmidCount, ratioBasis }
   */
  function reportReadings(rep) {
    var run = rep.run, d = rep.defaults, cells = run.cells, plan = run.plan;
    var flasks = Math.max(run.flaskCount, 1);
    var cultureVolume = run.cultureVolumePerFlask, mixVolume = run.mixVolumePerFlask;
    var timesFlasks = flasks > 1 ? " × " + flasks + " flasks" : "";
    var totalCultureText = AL.volume(cultureVolume * flasks, "culture").text;
    var cultureText = AL.volume(cultureVolume, "culture").text;
    var mixText = AL.volume(mixVolume, "mix").text;
    var finalDensityPerML = cells.finalDensity / 1000;
    var flaskText = rep.flaskTitle === "Custom" ? "Custom volume" : rep.flaskTitle + " flask";

    var settings = [
      ["DNA : PEI", D.ratioText(d) + " (w/w)"],
      ["DNA dose", D.doseText(d)],
      ["PEI stock", D.peiStockText(d)],
      ["Diluent", D.diluentDisplayName(d)],
      ["Mixing", D.mixingText(d)],
      ["Flask", rep.flaskTitle + timesFlasks],
      ["Culture", flasks > 1 ? cultureText + timesFlasks + " (" + totalCultureText + ")" : cultureText],
      ["Mix volume", flasks > 1 ? mixText + " per flask (" + D.mixReferenceText(d) + ")" : mixText + " (" + D.mixReferenceText(d) + ")"],
      ["Culture : mix", D.cultureToMixText(d)],
      ["Excess", E.excessText(rep.excessPct)],
      ["Seeding → final density", T.millions(rep.seedingDensityPerML) + " → ≈ " + T.millions(finalDensityPerML) + " live cells/mL"],
      ["Source density", rep.sourceDensityPerML != null ? T.millions(rep.sourceDensityPerML) + " live cells/mL" : "not counted"],
      ["Incubation", D.incubationText(d)]
    ];
    if (rep.plasmidCount > 1) settings.splice(5, 0, ["Ratio basis", rep.ratioBasis === "molar" ? "Molar ratio" : "Mass ratio"]);

    var perFlask = flasks > 1 ? " per flask" : "";
    var results = [
      ["Total DNA", T.mass(plan.totalDNAMass)],
      ["PEI", T.mass(plan.peiMass) + " = " + AL.volume(plan.peiStockVolume, "mix").text + " of stock"],
      ["Cells needed", flasks > 1
        ? T.scientific(cells.cellsNeeded * flasks) + " live cells (" + T.scientific(cells.cellsNeeded) + " per flask)"
        : T.scientific(cells.cellsNeeded) + " live cells"]
    ];
    if (!cells.sourceBelowSeeding && cells.sourceVolume != null && cells.mediaVolume != null) {
      results.push(["Source + medium", AL.volume(cells.sourceVolume, "culture").text + " + " + AL.volume(cells.mediaVolume, "culture").text +
        perFlask + (flasks > 1 ? ", × " + flasks : "")]);
    }
    results.push(["Final volume", AL.volume(cells.finalVolume > 0 ? cells.finalVolume : cultureVolume + mixVolume, "culture").text + perFlask]);
    return {
      flasks: flasks, cultureText: cultureText, mixText: mixText, totalCultureText: totalCultureText, flaskText: flaskText,
      finalDensityPerML: finalDensityPerML, settingsRows: settings, resultRows: results
    };
  }

  // ---------------------------------------------------------------- plain text (the Copy button)
  function rtrim(s) { return s.replace(/\s+$/, ""); }
  function pad(s, width) { return s + new Array(Math.max(width - s.length, 0) + 1).join(" "); }

  /** A section as lines, names padded and amounts lined up for a monospaced paste. */
  function block(section, title) {
    var width = 0;
    section.items.forEach(function (i) { if (i.amount) width = Math.max(width, i.name.length); });
    var out = title != null ? [title] : [];
    var padded = R.alignedAmounts(section);
    section.items.forEach(function (it, k) {
      if (padded[k] != null) out.push(pad(it.name, width) + "  " + padded[k]);
      else out.push(it.name + (it.note ? " · " + it.note : ""));
    });
    return out;
  }

  /**
   * The Copy text for a batch (the toolbar Copy of a batch): protocol, the shelf check, the master
   * mix and its portions, then each transfection's blocks. rep = { date, defaults, excessPct,
   * seedingDensityPerML, batch, recipe }. Advisory and blocking warnings both travel with the text.
   */
  function batchPlainText(rep) {
    var d = rep.defaults, batch = rep.batch, recipe = rep.recipe;
    var lines = [
      "PEI transfections · " + T.day(rep.date),
      headline(batch),
      "DNA : PEI " + D.ratioText(d) + " (w/w) · " + D.doseText(d) + " · PEI " + D.peiStockText(d) + " · " + D.mixingText(d).toLowerCase(),
      "Seed " + T.millions(rep.seedingDensityPerML) + "/mL · excess " + E.excessText(rep.excessPct)
    ];
    if (batch.isFeasible) {
      var shelf = reagentLines(batch, d);
      var width = Math.max.apply(null, shelf.map(function (r) { return r.name.length; }));
      var column = AL.column(shelf.filter(function (r) { return r.amount; }).map(function (r) { return r.amount; }));
      var i = 0;
      lines.push("", "Reagents needed");
      shelf.forEach(function (r) {
        var text = r.text;
        if (r.amount) { text = column[i]; i += 1; }
        lines.push(pad(r.name, width) + "  " + text + (r.note ? "  (" + r.note + ")" : ""));
      });
    } else {
      lines.push("", "Totals not worked out until every transfection's tubes fit:");
      batch.infeasibleRuns.forEach(function (x) { lines.push(x.name + ": " + x.reason); });
    }
    if (batch.isFeasible && batch.masterMix && recipe.masterMix) {
      var m = batch.masterMix;
      var portions = recipe.portionItems.map(function (p) {
        return { id: p.item.id, name: "→ " + p.name, amount: p.item.amount, mass: null, note: null };
      });
      var section = { id: "master", title: recipe.masterMix.title, items: recipe.masterMix.items.concat(portions) };
      lines.push("");
      lines = lines.concat(block(section, "PEI master mix · " + AL.volume(m.totalVolume, "mix").text + " in a " + m.tubeHint));
      if (batch.suggestsMasterMixExcess(rep.excessPct)) lines.push("! " + T.masterMixExcessHint);
    }
    recipe.runs.forEach(function (group) {
      var run = batch.run(group.id);
      if (!run) return;
      lines.push("", "== " + group.name + " · " + group.flasksText + " ==");
      if (!E.isFeasible(run.plan)) {
        lines.push("Tubes not made: " + E.infeasibleReason(run.plan));
        return;
      }
      if (run.cells.sourceProblem) lines.push(run.cells.sourceProblem);
      group.recipe.sections.forEach(function (s) {
        var title = R.baseID(s.id) === "cells" && group.flaskCount > 1 ? s.title + " (per flask, × " + group.flaskCount + ")" : s.title;
        lines = lines.concat(block(s, title));
      });
      run.plan.warnings.filter(function (w) { return !E.isBlocking(w); }).forEach(function (w) { lines.push("! " + E.warningText(w)); });
    });
    if (recipe.incubate) {
      lines.push("", "Incubate all together · " + (recipe.incubate.note || "") + ", then add each to its flasks");
    }
    return lines.map(rtrim).join("\n");
  }

  /**
   * The Copy text for one transfection of one flask (the single-run TransfectionReport.plainText).
   * rep = { date, defaults, run, recipe (bare ids), excessPct, seedingDensityPerML, sourceDensityPerML, flaskTitle, plasmidCount, ratioBasis }
   */
  function singlePlainText(rep) {
    var d = rep.defaults, run = rep.run, cells = run.cells, plan = run.plan, recipe = rep.recipe;
    var r = reportReadings(rep);
    var lines = [
      "PEI transfection · " + T.day(rep.date),
      r.flasks > 1
        ? r.flaskText + " × " + r.flasks + " · " + r.cultureText + " cells + " + r.mixText + " mix in each (" + r.totalCultureText + " cells in all)"
        : r.flaskText + " · " + r.cultureText + " cells + " + r.mixText + " mix",
      "DNA : PEI " + D.ratioText(d) + " (w/w) · " + D.doseText(d) + " · PEI " + D.peiStockText(d) + " · " + D.mixingText(d).toLowerCase(),
      "Seed " + T.millions(rep.seedingDensityPerML) + "/mL → ≈ " + T.millions(r.finalDensityPerML) + "/mL after the mix"
    ];
    lines.push("", r.flasks > 1 ? "Cells: " + T.scientific(cells.cellsNeeded) + " live per flask, × " + r.flasks
      : "Cells: " + T.scientific(cells.cellsNeeded) + " live");
    var cellsSection = R.section(recipe, "cells");
    if (cellsSection) lines = lines.concat(block(cellsSection, null));
    else if (cells.sourceProblem) lines.push(cells.sourceProblem);
    else lines.push("(count the source flask for source and medium volumes)");
    var reason = E.infeasibleReason(plan);
    if (reason) {
      lines.push("", "Tubes not made: " + reason);
    } else {
      R.tubeSections(recipe).forEach(function (s) { lines.push(""); lines = lines.concat(block(s, s.title)); });
      var finish = R.section(recipe, "finish");
      if (finish) { lines.push(""); lines = lines.concat(block(finish, finish.title)); }
    }
    var advisory = plan.warnings.filter(function (w) { return !E.isBlocking(w); });
    if (advisory.length) {
      lines.push("");
      advisory.forEach(function (w) { lines.push("! " + E.warningText(w)); });
    }
    return lines.map(rtrim).join("\n");
  }

  var api = {
    batchPlan: batchPlan, reagentLines: reagentLines, batchRecipe: batchRecipe, protocolRows: protocolRows,
    headline: headline, reportReadings: reportReadings, block: block, batchPlainText: batchPlainText, singlePlainText: singlePlainText
  };
  BM.transfection = Object.assign(BM.transfection || E, api);
  if (typeof module !== "undefined" && module.exports) module.exports = BM.transfection;
})(typeof globalThis !== "undefined" ? globalThis : this);
