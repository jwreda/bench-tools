/*
 * BenchMate web — shared helpers for every tool page.
 *
 * Plain script (no build step, no modules) so the pages also open from a file:// URL.
 * Everything hangs off one global, `BM`. Node tests load this file with require().
 *
 * Ported from the iOS app: Sources/Support/Format.swift and Sources/Core/Units.swift.
 * Keep the two in step: a number must print the same on the phone and on the web.
 */
(function (root) {
  "use strict";
  var BM = root.BM || (root.BM = {});

  /**
   * The release this copy is. Bump it (and add a CHANGELOG.md entry) in the commit you tag
   * vX.Y.Z; the deploy keeps every tagged release live at /vX.Y.Z/ and flips FROZEN to true
   * in those copies so their pages say they're an archived version.
   */
  BM.VERSION = "1.3.4";
  BM.FROZEN = false;

  // ---------------------------------------------------------------- units
  // Each unit converts to a canonical base by one multiplier (value * mult = base).
  // Concentration (molar) base: mol/L. Mass concentration base: g/L (= mg/mL).
  // Volume base: L. Mass base: g.
  function unitSet(list, ladder) {
    var byId = {};
    list.forEach(function (u) { byId[u.id] = u; });
    return {
      list: list,
      get: function (id) { return byId[id]; },
      toBase: function (id, v) { return v * byId[id].mult; },
      fromBase: function (id, v) { return v / byId[id].mult; },
      /** The largest unit in which `base` reads >= 1; the smallest unit otherwise. */
      best: function (base) {
        for (var i = 0; i < ladder.length; i++) {
          if (Math.abs(base / byId[ladder[i]].mult) >= 1) return byId[ladder[i]];
        }
        return byId[ladder[ladder.length - 1]];
      }
    };
  }

  BM.units = {
    molar: unitSet([
      { id: "nM", label: "nM", mult: 1e-9 },
      { id: "uM", label: "µM", mult: 1e-6 },
      { id: "mM", label: "mM", mult: 1e-3 },
      { id: "M", label: "M", mult: 1 }
    ], ["M", "mM", "uM", "nM"]),
    massConc: unitSet([
      { id: "mgPerML", label: "mg/mL", mult: 1 },
      { id: "ugPerUL", label: "µg/µL", mult: 1 },
      { id: "ugPerML", label: "µg/mL", mult: 1e-3 },
      { id: "ngPerUL", label: "ng/µL", mult: 1e-3 },
      { id: "ngPerML", label: "ng/mL", mult: 1e-6 }
    ], ["mgPerML", "ugPerML", "ngPerML"]),
    volume: unitSet([
      { id: "uL", label: "µL", mult: 1e-6 },
      { id: "mL", label: "mL", mult: 1e-3 },
      { id: "L", label: "L", mult: 1 }
    ], ["L", "mL", "uL"]),
    mass: unitSet([
      { id: "ng", label: "ng", mult: 1e-9 },
      { id: "ug", label: "µg", mult: 1e-6 },
      { id: "mg", label: "mg", mult: 1e-3 },
      { id: "g", label: "g", mult: 1 }
    ], ["g", "mg", "ug", "ng"])
  };

  // ---------------------------------------------------------------- format
  var F = BM.format = {};

  /** The browser's decimal mark ("." or ","). */
  F.localeDecimal = function () {
    try {
      var part = new Intl.NumberFormat().formatToParts(1.5).find(function (p) { return p.type === "decimal"; });
      return part ? part.value : ".";
    } catch (e) { return "."; }
  };

  /**
   * A typed number as every calculator reads it (Format.parse). Spaces and apostrophes
   * dropped; where "," is the decimal mark "0,5" reads 0.5; elsewhere only well-formed
   * grouping ("1,000,000") is accepted and "0,5" is refused rather than misread.
   * Returns null when blank, not a number, or not finite.
   */
  F.parse = function (text, decimalSeparator) {
    if (text == null) return null;
    var sep = decimalSeparator === undefined ? F.localeDecimal() : decimalSeparator;
    var t = String(text).trim().replace(/[   ']/g, "");
    if (t.indexOf(",") >= 0) {
      if (sep === ",") {
        if (t.indexOf(".") >= 0) return null;
        t = t.replace(/,/g, ".");
      } else {
        if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) return null;
        t = t.replace(/,/g, "");
      }
    }
    // Swift's Double(String) grammar: decimal or exponent forms only (no "inf", "0x", "").
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
    var v = Number(t);
    return isFinite(v) ? v : null;
  };

  var SUP = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  F.superscript = function (n) {
    return String(n).split("").map(function (c) { return SUP[c] || ""; }).join("");
  };

  function fixed(value, places) {
    var s = value.toFixed(places);
    // toFixed(-0.0001, 2) gives "-0.00"; printf does too, keep it.
    return s;
  }

  /** Mantissa × 10ⁿ, up to four significant digits, at least one decimal. */
  F.scientific = function (value, maxSig) {
    maxSig = maxSig || 4;
    if (!isFinite(value) || value === 0) return "0";
    var exponent = Math.floor(Math.log10(Math.abs(value)));
    var mantissa = value / Math.pow(10, exponent);
    var decimals = Math.max(maxSig - 1, 1);
    var p = Math.pow(10, decimals);
    if (Math.abs(Math.round(mantissa * p) / p) >= 10) {
      exponent += 1;
      mantissa = value / Math.pow(10, exponent);
    }
    var text = fixed(mantissa, decimals);
    while (/0$/.test(text) && !/\.0$/.test(text)) text = text.slice(0, -1);
    return exponent === 0 ? text : text + " × 10" + F.superscript(exponent);
  };

  /** At least four significant figures at every size; scientific below 0.001 or from 1e6. */
  F.number = function (value) {
    if (!isFinite(value)) return "—";
    var m = Math.abs(value);
    if (m !== 0 && (m < 0.001 || m >= 1e6)) return F.scientific(value);
    function digits(mag) {
      if (mag === 0) return 4;
      if (mag < 1) return Math.max(4, 3 - Math.floor(Math.log10(mag) + 1e-12));
      if (mag < 10) return 3;
      if (mag < 100) return 2;
      if (mag < 1000) return 1;
      return 0;
    }
    var places = digits(m);
    var shown = Math.round(m * Math.pow(10, places)) / Math.pow(10, places);
    places = Math.min(places, digits(shown));
    return fixed(value, places);
  };

  /** Plain digits for writing a computed value back into a field (no "× 10ⁿ"). */
  F.editable = function (value, sigDigits, decimalSeparator) {
    sigDigits = sigDigits || 6;
    if (!isFinite(value)) return "";
    if (value === 0) return "0";
    var leading = Math.floor(Math.log10(Math.abs(value)));
    var places = Math.min(Math.max(sigDigits - 1 - leading, 0), 30);
    var text = value.toFixed(Math.min(places, 100));
    if (text.indexOf(".") >= 0) text = text.replace(/0+$/, "").replace(/\.$/, "");
    var sep = decimalSeparator === undefined ? F.localeDecimal() : decimalSeparator;
    if (sep !== ".") text = text.replace(".", sep);
    return text;
  };

  /** Whole numbers without a decimal point; anything else as-is. */
  F.plain = function (value) {
    return value === Math.round(value) ? value.toFixed(0) : String(value);
  };

  /** Digits grouped in threes ("2,460,000"), up to two decimals. */
  F.grouped = function (value) {
    if (!isFinite(value)) return "—";
    return value.toLocaleString("en-US", { maximumFractionDigits: value === Math.round(value) ? 0 : 2 });
  };

  F.volumeParts = function (liters) {
    if (!isFinite(liters)) return { value: "—", unit: "µL" };
    var u = BM.units.volume.best(liters);
    return { value: F.number(liters / u.mult), unit: u.label };
  };
  /** A volume in liters in its most readable unit: "1.455 mL", "20.00 µL". */
  F.volume = function (liters) {
    var p = F.volumeParts(liters);
    return p.value + " " + p.unit;
  };
  /** A mass in grams in its most readable unit: "80.00 µg". */
  F.mass = function (grams) {
    if (!isFinite(grams)) return "—";
    var u = BM.units.mass.best(grams);
    return F.number(grams / u.mult) + " " + u.label;
  };

  // ---------------------------------------------------------------- page helpers
  // Only used in the browser. Tools build their own markup in HTML and use these to
  // read fields and write results, so each page stays readable on its own.
  var ui = BM.ui = {};

  ui.$ = function (sel, rootEl) { return (rootEl || document).querySelector(sel); };
  ui.$$ = function (sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); };

  /** The parsed number in an input (by id or element), or null. */
  ui.num = function (idOrEl) {
    var el = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
    return el ? F.parse(el.value) : null;
  };

  /** Escape text for innerHTML. */
  ui.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /** Fill a <select> with a unit set's options. */
  ui.unitOptions = function (select, set, selectedId, only) {
    select.innerHTML = set.list
      .filter(function (u) { return !only || only.indexOf(u.id) >= 0; })
      .map(function (u) {
        return '<option value="' + u.id + '"' + (u.id === selectedId ? " selected" : "") + ">" + u.label + "</option>";
      }).join("");
  };

  /**
   * Warnings list: items are { level: "warn" | "error", text }.
   * Errors mean the result can't be used as-is; warnings mean check it.
   */
  ui.warnings = function (el, items) {
    el.innerHTML = (items || []).map(function (w) {
      return '<p class="note ' + (w.level === "error" ? "error" : "warn") + '">' +
        (w.level === "error" ? "✕ " : "⚠︎ ") + ui.esc(w.text) + "</p>";
    }).join("");
    // An error means the answer above it can't be used as is: the card says so too.
    var card = el.closest && el.closest(".result");
    if (card) card.classList.toggle("has-error", ui.$$(".note.error", card).length > 0);
  };

  /**
   * The body of a result card whose plan can't be followed: why, the amount it would still
   * take (kept, so the user sees the scale of the problem), and one button that fixes it.
   * `b` is { title, wouldNeed: { label, value, note }, fix: { label, preview } };
   * `attrs` are extra attributes for the fix button (the page handles its click).
   */
  ui.blockedHTML = function (b, attrs) {
    return '<p class="blocked-title">✕ ' + ui.esc(b.title) + "</p>" +
      (b.wouldNeed ? '<div class="would"><span class="would-label">' + ui.esc(b.wouldNeed.label) + '</span>' +
        '<span class="would-value">' + ui.esc(b.wouldNeed.value) + "</span>" +
        '<span class="would-note">' + ui.esc(b.wouldNeed.note) + "</span></div>" : "") +
      (b.fix ? '<div class="fix"><button type="button"' + (attrs || "") + ">" + ui.esc(b.fix.label) + "</button>" +
        '<span class="hint">' + ui.esc(b.fix.preview) + "</span></div>" : "");
  };

  /** Re-run `fn` whenever any input/select inside `form` changes. Runs once now. */
  ui.live = function (form, fn) {
    form.addEventListener("input", fn);
    form.addEventListener("change", fn);
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    fn();
  };

  /** Copy text to the clipboard; the button says "Copied" for a moment. */
  ui.copyButton = function (button, getText) {
    button.addEventListener("click", function () {
      var text = getText();
      if (!text) return;
      var done = function () {
        var old = button.textContent;
        button.textContent = "Copied";
        setTimeout(function () { button.textContent = old; }, 1200);
      };
      // Older Safari and some in-app browsers refuse the clipboard API: fall back to a selection.
      var fallback = function () {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { if (document.execCommand("copy")) done(); } catch (e) { /* ignore */ }
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    });
  };

  // ---------------------------------------------------------------- handing values to another tool
  // One tool links to the next with its results in the query string ("?density=4000000&wells=24"),
  // and the next page fills its fields from it once. Numbers travel with "." decimals and are
  // written into fields in the reader's own decimal mark.
  BM.handoff = {
    /** "density=4000000&volume=2.5": finite numbers and plain strings; null and undefined are left out. */
    query: function (values) {
      return Object.keys(values).filter(function (k) {
        var v = values[k];
        return v != null && (typeof v !== "number" || isFinite(v));
      }).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(String(values[k])); }).join("&");
    },
    /** { key: number | string } for the allowed keys in `search` ("?a=1&b=x"); numbers are those that read as one. */
    parse: function (search, allowed) {
      var out = {};
      String(search || "").replace(/^\?/, "").split("&").forEach(function (pair) {
        if (!pair) return;
        var i = pair.indexOf("="), k, v;
        try {
          k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
          v = i < 0 ? "" : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, " "));
        } catch (e) { return; }
        if (allowed.indexOf(k) < 0) return;
        var n = F.parse(v, ".");
        out[k] = n !== null ? n : v;
      });
      return out;
    }
  };

  /**
   * Fill fields from the page's query string, once: `fields` maps a query key to an input id.
   * Numbers are written in the reader's decimal mark. The query is then dropped from the address
   * so a reload keeps what was typed since. Returns the parsed values ({} when none).
   */
  ui.prefill = function (form, fields, extraKeys) {
    if (typeof location === "undefined" || !location.search) return {};
    var got = BM.handoff.parse(location.search, Object.keys(fields).concat(extraKeys || []));
    Object.keys(fields).forEach(function (k) {
      if (typeof got[k] !== "number") return;
      ui.$$(fields[k].split(" ").map(function (id) { return "#" + id; }).join(","), form).forEach(function (el) {
        el.value = F.editable(got[k]);
      });
    });
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) { /* ignore */ }
    return got;
  };

  // ---------------------------------------------------------------- Markdown copy
  /**
   * The page as the user filled it in, as Markdown: title, every visible field with its value
   * and unit, chosen options, results, tables, notes and warnings, in page order. Generic over
   * the page's markup, so every tool gets it without code of its own. Hidden parts (closed
   * <details>, unused modes) are left out; buttons, read-backs and the app promo too.
   */
  ui.markdown = function (main) {
    var out = [];
    var clean = function (t) { return String(t || "").replace(/\s+/g, " ").trim(); };
    var shown = function (el) { return !el.hidden && el.getClientRects().length > 0; };
    var cellText = function (el) {
      var t = "";
      el.childNodes.forEach(function (n) {
        if (n.nodeType === 3) t += n.textContent;
        else if (n.nodeName === "BR") t += " · ";
        else if (n.nodeName === "INPUT" && n.type === "checkbox") t += n.checked ? "[x] " : "[ ] ";
        else if (n.nodeType === 1 && shown(n) && !n.matches("button, .sci-preview")) {
          // A nested line (a note under a step, a sub-amount) reads as its own clause.
          t += (n.matches("div, p, small, .hint, .small") ? " · " : " ") + cellText(n) + " ";
        }
      });
      return clean(t).replace(/^(\[[ x]\] )?· /, "$1").replace(/( · )+/g, " · ").replace(/ ·$/, "");
    };
    var para = function (t) { if (t) out.push("", t); };
    var item = function (t) {
      if (!t) return;
      if (out.length && out[out.length - 1] !== "" && out[out.length - 1].indexOf("- ") !== 0) out.push("");
      out.push("- " + t);
    };
    var ownText = function (label) {
      return clean(Array.prototype.filter.call(label.childNodes, function (n) { return n.nodeType === 3; })
        .map(function (n) { return n.textContent; }).join(""));
    };
    var value = function (c) {
      if (c.tagName === "SELECT") return c.selectedOptions[0] ? clean(c.selectedOptions[0].textContent) : "";
      if (c.tagName === "INPUT") return clean(c.value);
      return clean(c.textContent);
    };
    var CONTROLS = "input:not([type=radio]):not([type=checkbox]), select, textarea, .row > .hint, .row > .unit, .inline > .unit";

    function field(el) {
      var lab = el.querySelector(":scope > label, :scope > .label");
      var parts = [];
      el.querySelectorAll(CONTROLS).forEach(function (c) {
        if (shown(c) && !c.closest("label.check")) parts.push(value(c));
      });
      var first = el.querySelector("input:not([type=radio]):not([type=checkbox]), select, textarea");
      if (parts.length && first && value(first)) {
        item("**" + (lab ? ownText(lab) || clean(lab.textContent) : "Value") + ":** " + parts.filter(Boolean).join(" ") +
          (el.querySelector("input.solved") ? " (solved)" : ""));
      }
      el.querySelectorAll(".segments, label.check").forEach(function (x) { if (shown(x)) walk(x); });
    }

    function table(el) {
      var rows = Array.prototype.filter.call(el.rows, shown).map(function (tr) {
        return Array.prototype.filter.call(tr.cells, shown).map(cellText);
      }).filter(function (r) { return r.join("").trim(); });
      if (!rows.length) return;
      out.push("");
      if (el.querySelector("th")) {
        var esc = function (r) { return "| " + r.map(function (c) { return c.replace(/\|/g, "\\|"); }).join(" | ") + " |"; };
        out.push(esc(rows[0]), "|" + rows[0].map(function () { return " --- "; }).join("|") + "|");
        rows.slice(1).forEach(function (r) { out.push(esc(r)); });
      } else {
        rows.forEach(function (r) {
          var cells = r.filter(Boolean);
          item(cells.length === 2 ? cells[0] + ": **" + cells[1] + "**" : cells.join(" · "));
        });
      }
    }

    function walk(el) {
      if (el.nodeType !== 1 || !shown(el)) return;
      if (el.matches(".promo, footer, .page-head, button, script, style, .sci-preview, .md-copy, summary")) return;
      var tag = el.tagName;
      if (/^H[1-4]$/.test(tag)) { para("#".repeat(Math.max(2, Number(tag[1]))) + " " + clean(el.textContent)); return; }
      if (el.matches(".field")) { field(el); return; }
      if (el.matches("ol.steps > li")) {
        // A protocol step: ticked or not, what to do, and how much.
        var q = function (sel) { var x = el.querySelector(sel); return x ? clean(x.textContent) : ""; };
        var box2 = el.querySelector("input[type=checkbox]");
        var amount = el.querySelector(".step-amount");
        item((box2 && box2.checked ? "[x] " : "[ ] ") + "**" + q(".step-title") + "**" +
          (q(".step-note") ? " — " + q(".step-note") : "") + (amount ? " · " + cellText(amount) : ""));
        return;
      }
      if (el.matches(".segments")) {
        var on = el.querySelector("input:checked");
        if (on) item("**" + (el.getAttribute("aria-label") || "Option") + ":** " + clean(on.closest("label").textContent));
        return;
      }
      if (tag === "LABEL") {
        var box = el.querySelector("input[type=checkbox]");
        var txt = el.querySelector("input:not([type=radio]):not([type=checkbox]), select");
        if (box) item(cellText(el));
        else if (txt && value(txt)) item("**" + ownText(el) + ":** " + value(txt));
        return;
      }
      if (el.matches(".result")) {
        var cap = el.querySelector(":scope > .caption"), hero = el.querySelector(":scope > .hero");
        var h = hero ? clean(hero.textContent) : "";
        var c = cap ? clean(cap.textContent) : "";
        if (c || (h && h !== "—")) para("**" + (c || "Result") + (h && h !== "—" ? ": " + h : "") + "**");
        Array.prototype.forEach.call(el.children, function (k) { if (k !== cap && k !== hero) walk(k); });
        return;
      }
      if (tag === "TABLE") { table(el); return; }
      if ((tag === "INPUT" && !/^(radio|checkbox|hidden)$/.test(el.type)) || tag === "SELECT") {
        // A loose control (a hemocytometer square, a value in a grid): named by its <label for>.
        var named = el.id && document.querySelector('label[for="' + el.id + '"]');
        var nm = named ? clean(named.textContent) : el.getAttribute("aria-label");
        if (value(el)) item((nm ? "**" + nm + ":** " : "") + value(el));
        return;
      }
      if (tag === "LABEL" && el.htmlFor && !el.contains(document.getElementById(el.htmlFor))) return;
      if (tag === "DL") {
        out.push("");
        Array.prototype.forEach.call(el.querySelectorAll("dt"), function (dt) {
          var dd = dt.nextElementSibling;
          item(clean(dt.textContent) + ": " + (dd ? cellText(dd) : ""));
        });
        return;
      }
      if (el.matches(".note")) { para("> " + clean(el.textContent)); return; }
      if (el.matches(".would")) { para("> " + cellText(el)); return; }
      var kids = Array.prototype.filter.call(el.children, function (k) { return !k.matches("br, small, strong, em, b, i, code, span, a, sub, sup"); });
      if (tag === "P" || !kids.length) { para(cellText(el)); return; }
      Array.prototype.forEach.call(el.children, walk);
    }

    var h1 = ui.$("h1"), lede = ui.$(".page-head .lede");
    out.push("# " + clean(h1 ? h1.textContent : document.title));
    if (lede) para(clean(lede.textContent));
    para("_BenchMate tools v" + BM.VERSION + " · " + new Date().toLocaleString() + " · " + location.href.split("#")[0] + "_");
    Array.prototype.forEach.call(main.children, walk);
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  };

  /** A "Copy as Markdown" button at the end of every tool page (any page with a form). */
  ui.markdownButton = function () {
    var main = ui.$("main"), promo = main && ui.$(".promo", main);
    if (!main || !ui.$("form", main) || ui.$(".md-copy", main)) return;
    var bar = document.createElement("div");
    bar.className = "md-copy";
    bar.innerHTML = '<button type="button" class="secondary">Copy as Markdown</button>' +
      '<span class="hint">Everything on this page as you filled it in, for a notebook or ELN.</span>';
    main.insertBefore(bar, promo || null);
    ui.copyButton(ui.$("button", bar), function () { return ui.markdown(main); });
  };

  /**
   * Remember a form's field values in this browser (localStorage), so a reload keeps them.
   * Every input/select with an id is saved. Storage failing (private mode) is ignored.
   */
  ui.persist = function (form, key) {
    var storeKey = "benchmate.web." + key;
    try {
      var saved = JSON.parse(localStorage.getItem(storeKey) || "null");
      if (saved) {
        ui.$$("input[id], select[id], textarea[id]", form).forEach(function (el) {
          if (!(el.id in saved)) return;
          if (el.type === "checkbox" || el.type === "radio") el.checked = !!saved[el.id];
          else el.value = saved[el.id];
        });
      }
    } catch (e) { /* ignore */ }
    var save = function () {
      var out = {};
      ui.$$("input[id], select[id], textarea[id]", form).forEach(function (el) {
        out[el.id] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
      });
      try { localStorage.setItem(storeKey, JSON.stringify(out)); } catch (e) { /* ignore */ }
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return {
      clear: function () { try { localStorage.removeItem(storeKey); } catch (e) { /* ignore */ } }
    };
  };

  // ---------------------------------------------------------------- number check
  /**
   * A live read-back under a number field that can span orders of magnitude, so a typed
   * "2500000" can be checked at a glance: "= 2.5 × 10⁶ = 2,500,000 cells/mL".
   * Opt in with data-sci on the <input>; data-sci-scale="1e6" when the field is typed in
   * millions (the read-back shows the real number); data-sci-unit="cells/mL" for the unit.
   * Shown from 1,000 up (and for any scaled field); text that isn't a number says so.
   * Works for inputs added later too (it listens on the document and watches the page).
   */
  ui.sciPreview = function (input) {
    var host = input.closest(".row") || input;
    var out = host.nextElementSibling;
    if (!out || !out.classList.contains("sci-preview")) {
      out = document.createElement("p");
      out.className = "sci-preview";
      out.setAttribute("aria-live", "polite");
      host.parentNode.insertBefore(out, host.nextSibling);
    }
    var text = input.value.trim();
    var v = F.parse(text);
    var scale = Number(input.getAttribute("data-sci-scale")) || 1;
    var unit = input.getAttribute("data-sci-unit");
    if (!text) { out.hidden = true; return; }
    if (v == null) {
      out.hidden = false;
      out.classList.add("bad");
      if (out.textContent !== "Not a number") out.textContent = "Not a number";
      return;
    }
    out.classList.remove("bad");
    var real = v * scale;
    if (Math.abs(real) < 1000 && scale === 1) { out.hidden = true; return; }
    out.hidden = false;
    var line = "= " + F.scientific(real) + " = " + F.grouped(real) + (unit ? " " + unit : "");
    // Only touch the text when it changes, so the page watcher doesn't wake itself.
    if (out.textContent !== line) out.textContent = line;
  };

  ui.sciPreviewAll = function () {
    ui.$$("input[data-sci]").forEach(ui.sciPreview);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("input", function (e) {
      if (e.target.matches && e.target.matches("input[data-sci]")) ui.sciPreview(e.target);
    });
    document.addEventListener("DOMContentLoaded", function () {
      ui.sciPreviewAll();
      // Pages that redraw their fields (repeatable samples, flasks) get read-backs too.
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; ui.sciPreviewAll(); }, 0);
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  // ---------------------------------------------------------------- app portal
  /**
   * The App Store link. Placeholder until BenchMate ships: set APP_STORE_URL to the real
   * listing (https://apps.apple.com/app/id…) and every page's banner starts linking there.
   */
  BM.APP_STORE_URL = "";

  /** Fill every [data-app-promo] element with the "Get the app" note. */
  ui.appPromo = function () {
    ui.$$("[data-app-promo]").forEach(function (el) {
      var live = !!BM.APP_STORE_URL;
      el.innerHTML =
        '<p><strong>BenchMate for iPhone and iPad</strong> has these calculators plus a lab scanner, ' +
        "a reagent library, saved defaults and bench timers.</p>" +
        (live
          ? '<a class="button" href="' + ui.esc(BM.APP_STORE_URL) + '">Get BenchMate on the App Store</a>'
          : '<span class="button disabled" aria-disabled="true">Coming soon to the App Store</span>');
    });
  };

  // ---------------------------------------------------------------- version footer
  // This copy's root (where index.html is), worked out from this script's own URL, so the
  // same files work at the site root, in an archived /vX.Y.Z/ copy, or opened from disk.
  var scriptSrc = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : "";
  BM.copyRoot = function () { return scriptSrc ? new URL("..", scriptSrc).href : "./"; };
  /** The latest site's root: one level up from an archived copy. */
  BM.siteRoot = function () { return BM.FROZEN ? new URL("..", BM.copyRoot()).href : BM.copyRoot(); };

  ui.versionFooter = function () {
    var main = ui.$("main");
    if (!main || ui.$(".version", main)) return;
    var site = BM.siteRoot();
    var foot = document.createElement("footer");
    foot.className = "version";
    foot.innerHTML =
      (BM.FROZEN
        ? '<p class="note warn">You are viewing version ' + ui.esc(BM.VERSION) +
          ', kept as it was released. <a href="' + site + 'index.html">Open the latest version</a>.</p>'
        : "") +
      "BenchMate tools v" + ui.esc(BM.VERSION) +
      ' · <a href="' + site + 'versions.html">Past versions and changes</a>';
    main.appendChild(foot);
  };

  // ---------------------------------------------------------------- theme and reveals
  /**
   * Light/dark toggle. With no choice saved the page follows the system setting; the
   * inline script in each page's <head> applies a saved choice before first paint.
   */
  ui.toggleTheme = function () {
    var root = document.documentElement;
    var dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* ignore */ }
    ui.syncThemeToggle();
  };
  ui.syncThemeToggle = function () {
    var root = document.documentElement;
    var dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    ui.$$("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    });
  };

  /** Blur-in once as each .reveal element scrolls into view (home lists only). */
  ui.reveals = function () {
    var els = ui.$$(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("visible");
        io.unobserve(e.target);
      });
    }, { threshold: 0.2, rootMargin: "0px 0px -50px 0px" });
    els.forEach(function (el) { io.observe(el); });
  };

  if (typeof document !== "undefined") {
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("[data-theme-toggle]")) ui.toggleTheme();
    });
    document.addEventListener("DOMContentLoaded", ui.syncThemeToggle);
    document.addEventListener("DOMContentLoaded", ui.reveals);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", ui.markdownButton);
    document.addEventListener("DOMContentLoaded", ui.appPromo);
    document.addEventListener("DOMContentLoaded", ui.versionFooter);
  }

  if (typeof module !== "undefined" && module.exports) module.exports = BM;
})(typeof globalThis !== "undefined" ? globalThis : this);
