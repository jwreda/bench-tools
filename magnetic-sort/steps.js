/*
 * Shared by Magnetic sort and CellTrace: a tick-off step list where a step can carry a simple
 * in-page countdown (the app's ProtocolStepRow + ProtocolTimerSpec, without notifications or
 * background timers: the countdown runs while the page is open, and a timer counts to an
 * absolute end time so a throttled background tab still shows the right time).
 * Needs assets/bench.js loaded first. Also loaded by celltrace/index.html as ../magnetic-sort/steps.js.
 */
(function (root) {
  "use strict";
  var BM = root.BM || require("../assets/bench.js");
  var S = BM.steps = {};

  /** "12:30" (minutes:seconds) from seconds, rounded up (IncubationTimer.clock). */
  S.clock = function (seconds) {
    var s = isFinite(seconds) ? Math.max(Math.ceil(seconds), 0) : 0;
    var r = s % 60;
    return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
  };

  // key -> { endsAt (ms), minutes, finished }
  var timers = {};
  var ticking = null;

  S.timerState = function (key, nowMs) {
    var t = timers[key];
    if (!t) return { state: "idle" };
    var left = (t.endsAt - (nowMs === undefined ? Date.now() : nowMs)) / 1000;
    return left > 0 ? { state: "running", left: left } : { state: "done" };
  };
  S.startTimer = function (key, minutes, nowMs) {
    timers[key] = { endsAt: (nowMs === undefined ? Date.now() : nowMs) + minutes * 60000, minutes: minutes };
  };
  S.resetTimer = function (key) { delete timers[key]; };
  S.resetAll = function (prefix) {
    Object.keys(timers).forEach(function (k) { if (k.indexOf(prefix) === 0) delete timers[k]; });
  };
  S.hasActive = function (prefix) {
    return Object.keys(timers).some(function (k) { return k.indexOf(prefix) === 0 && S.timerState(k).state === "running"; });
  };

  if (typeof document === "undefined") { if (typeof module !== "undefined" && module.exports) module.exports = S; return; }

  var esc = BM.ui.esc;
  var css = document.createElement("style");
  css.textContent =
    "ol.steps{list-style:none;margin:0;padding:0}" +
    "ol.steps li{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-strong)}" +
    "ol.steps li:last-child{border-bottom:0}" +
    "ol.steps label.check{flex:1 1 auto;align-items:flex-start;padding:6px 0}" +
    "ol.steps label.check input{flex:0 0 auto;margin-top:2px}" +
    "ol.steps .step-title{display:block;font-weight:600}" +
    "ol.steps li.done .step-title{text-decoration:line-through;color:var(--text-3)}" +
    "ol.steps .step-note{display:block;color:var(--text-3);font-size:14px}" +
    "ol.steps .step-amount{flex:0 0 auto;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;padding-top:8px}" +
    "ol.steps .step-amount small{display:block;font-weight:400;color:var(--text-3);font-size:13px}" +
    "ol.steps .step-timer{margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
    "ol.steps .step-timer button{min-height:36px;padding:6px 12px;font-size:15px}" +
    "ol.steps .step-clock{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}" +
    "ol.steps .step-clock.over{color:var(--error-ink)}";
  document.head.appendChild(css);

  function paintTimer(el) {
    var key = el.getAttribute("data-timer"), minutes = Number(el.getAttribute("data-minutes"));
    var label = el.getAttribute("data-label"), message = el.getAttribute("data-message");
    var st = S.timerState(key);
    var html;
    if (st.state === "idle") {
      html = '<button type="button" class="secondary" data-timer-start="' + esc(key) + '" data-minutes="' + minutes + '">Start ' +
        esc(BM.format.plain(minutes)) + " min timer</button>" + (label ? '<span class="hint">' + esc(label) + "</span>" : "");
    } else if (st.state === "running") {
      html = '<span class="step-clock" role="timer">' + S.clock(st.left) + "</span>" +
        '<button type="button" class="secondary" data-timer-reset="' + esc(key) + '">Reset</button>' +
        (label ? '<span class="hint">' + esc(label) + "</span>" : "");
    } else {
      html = '<span class="step-clock over">' + esc(message || "Time's up") + "</span>" +
        '<button type="button" class="secondary" data-timer-reset="' + esc(key) + '">Reset</button>';
    }
    if (el.getAttribute("data-painted") !== html) { el.innerHTML = html; el.setAttribute("data-painted", html); }
    // A running clock changes every second; the markup above holds the digits, so repaint cheaply.
  }
  S.paintTimers = function () {
    Array.prototype.forEach.call(document.querySelectorAll(".step-timer[data-timer]"), paintTimer);
  };
  function ensureTicking() {
    if (ticking) return;
    ticking = setInterval(function () {
      S.paintTimers();
      if (!Object.keys(timers).length) { clearInterval(ticking); ticking = null; }
    }, 500);
  }

  var bound = typeof WeakSet !== "undefined" ? new WeakSet() : null;

  /**
   * Draw a step list into `el` (an <ol class="steps"> is created inside).
   * steps: [{ id, title, note?, amount?, amountNote?, timer?: { key, minutes, label?, message? } }]
   * checked: an object { id: true } the page keeps between draws; onChange() runs after a tick.
   */
  S.list = function (el, steps, checked, onChange) {
    el.innerHTML = '<ol class="steps">' + steps.map(function (s) {
      var on = !!checked[s.id];
      return '<li class="' + (on ? "done" : "") + '"><div style="flex:1 1 auto">' +
        '<label class="check"><input type="checkbox" data-step="' + esc(s.id) + '"' + (on ? " checked" : "") + ">" +
        '<span><span class="step-title">' + esc(s.title) + "</span>" +
        (s.note ? '<span class="step-note">' + esc(s.note) + "</span>" : "") + "</span></label>" +
        (s.timer ? '<div class="step-timer" data-timer="' + esc(s.timer.key) + '" data-minutes="' + s.timer.minutes + '" data-label="' +
          esc(s.timer.label || "") + '" data-message="' + esc(s.timer.message || "") + '"></div>' : "") +
        "</div>" +
        (s.amount ? '<div class="step-amount">' + esc(s.amount) + (s.amountNote ? "<small>" + esc(s.amountNote) + "</small>" : "") + "</div>" : "") +
        "</li>";
    }).join("") + "</ol>";
    S.paintTimers();
    if (bound && bound.has(el)) return;
    if (bound) bound.add(el);
    el.addEventListener("change", function (e) {
      var id = e.target.getAttribute && e.target.getAttribute("data-step");
      if (!id) return;
      checked[id] = e.target.checked;
      var li = e.target.closest("li");
      if (li) li.classList.toggle("done", e.target.checked);
      if (onChange) onChange();
    });
    el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-timer-start")) {
        S.startTimer(b.getAttribute("data-timer-start"), Number(b.getAttribute("data-minutes")));
        ensureTicking();
        S.paintTimers();
      } else if (b.hasAttribute("data-timer-reset")) {
        S.resetTimer(b.getAttribute("data-timer-reset"));
        S.paintTimers();
      }
    });
  };

  if (typeof module !== "undefined" && module.exports) module.exports = S;
})(typeof globalThis !== "undefined" ? globalThis : this);
