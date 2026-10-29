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
  BM.VERSION = "1.1.0";
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
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
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
    document.addEventListener("DOMContentLoaded", ui.appPromo);
    document.addEventListener("DOMContentLoaded", ui.versionFooter);
  }

  if (typeof module !== "undefined" && module.exports) module.exports = BM;
})(typeof globalThis !== "undefined" ? globalThis : this);
