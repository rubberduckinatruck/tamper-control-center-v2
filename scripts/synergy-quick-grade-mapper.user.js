// ==UserScript==
// @name         2.5 UPDATED Synergy Quick Grade Mapper (Score + Missing/Late + Note)
// @namespace    https://afsd.edupoint.com/
// @version      2.5
// @description  Paste Name | Score/Letter | Comment | Note from Google Sheets and fill the Quick Grade page (letters, Missing/Late, public notes). Includes grade-scale presets, blank-score behavior toggle, diff-based writes, progress, preview, persistence, and colored logs.
// @author       you
//
// @cc-id            synergy-quick-grade-mapper
// @cc-display-name  Synergy Quick Grade Mapper
// @cc-category      synergy
// @cc-role          teaching
// @cc-status        live
// @cc-tags          gradebook, grading, scores, missing, late, notes
//
// @match        https://*.edupoint.com/*
// @match        https://afsd.edupoint.com/*
// @run-at       document-idle
// @grant        none
//
// @updateURL    https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/synergy-quick-grade-mapper.user.js
// @downloadURL  https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/synergy-quick-grade-mapper.user.js
//
// ==/UserScript==

(function () {
  "use strict";

  /********************************************************************
   * CONFIG & STORAGE KEYS
   ********************************************************************/
  const LS_KEYS = {
    MODE: "qgm_mode",
    RANGES: "qgm_ranges",
    RANGE_PRESET: "qgm_rangePreset",
    NORMALIZE: "qgm_normalize",
    BLANK_SCORE_BEHAVIOR: "qgm_blankScoreBehavior",
    WRITE_DELAY: "qgm_writeDelayMs",
    SETTLE_DELAY: "qgm_settleDelayMs",
    SELECTORS: "qgm_selectors",
    PANEL_POS: "qgm_panelPosition",
    COLLAPSED: "qgm_settingsCollapsed",
    BATCH_SIZE: "qgm_batchSize",
    PRESETS: "qgm_presets"
  };

  /********************************************************************
   * PRESETS
   ********************************************************************/
  const PRESETS = {
    default: {
      label: "Default",
      ranges: {
        "A+": { min: 97, max: 100 },
        "A": { min: 90, max: 96 },
        "B": { min: 80, max: 89 },
        "C": { min: 70, max: 79 },
        "D": { min: 60, max: 69 },
        "F": { min: 0, max: 59 }
      },
      readOnly: true
    }
  };

  const MAX_CUSTOM_PRESETS = 9;

  /********************************************************************
   * DEFAULTS
   ********************************************************************/
  const DEFAULTS = {
    mode: "convert",
    rangePreset: "default",
    ranges: PRESETS.default.ranges,
    blankScoreBehavior: "missing",
    normalize: {
      ignoreMiddle: true,
      ignoreSuffix: true,
      stripStudentTag: true
    },
    writeDelayMs: 300,
    settleDelayMs: 2000,
    selectors: {
      studentCell: "td:nth-child(2)",
      letterSelect: "select.v-currentscore-select",
      commentSelect: "select.v-comments",
      publicNote: "textarea.v-publicnote",
      rowQuery: "tr[data-studentid]",
      saveButton: 'button[title="Save"], .btn-save, input[type="button"][value="Save"], input[type="submit"][value="Save"]',
      recalcIcon: "#spnRecalcGrades"
    },
    batchSize: 0
  };

  const LETTERS_ALLOWED = ["A+","A","B","C","D","F"];
  const MISSING_TEXT = "Missing";
  const ABSENT_TEXT = "Absent";
  const INCOMPLETE_TEXT = "Incomplete";
  const LATE_TEXT = "Late";
  const ORIGINALITY_TEXT = "Originality concern";
  const NOTE_MAX = 255;

  /********************************************************************
   * FRAME HANDLING
   ********************************************************************/
  function inFrameContent(win) {
    try {
      return win.name === "FRAME_CONTENT";
    } catch {
      return false;
    }
  }

  function getFrameContentWindow() {
    try {
      const frames = Array.from(window.frames || []);
      for (const f of frames) {
        try {
          if (f.name === "FRAME_CONTENT") return f;
        } catch {}
      }
      const iframe = document.querySelector('frame[name="FRAME_CONTENT"], iframe[name="FRAME_CONTENT"]');
      if (iframe && iframe.contentWindow) return iframe.contentWindow;
    } catch {}
    return null;
  }

  function ensureInContentContext(callback) {
    try {
      if (inFrameContent(window)) {
        callback();
        return;
      }
      const fc = getFrameContentWindow();
      if (fc && fc !== window) {
        try {
          fc.eval("(" + callback.toString() + ")();");
          return;
        } catch {}
      }
      callback();
    } catch {
      try { callback(); } catch {}
    }
  }

  ensureInContentContext(() => {
    contentMain();
  });


 /********************************************************************
   * MAIN (runs inside FRAME_CONTENT)
   ********************************************************************/
  function contentMain() {
    "use strict";

    /*******************************
     * UTILITIES
     *******************************/
    const $d = document;

    const loadLS = (k, fb) => { try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : fb; } catch { return fb; } };
    const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

    let state = {
      mode: loadLS(LS_KEYS.MODE, DEFAULTS.mode),
      rangePreset: loadLS(LS_KEYS.RANGE_PRESET, DEFAULTS.rangePreset),
      ranges: loadLS(LS_KEYS.RANGES, DEFAULTS.ranges),
      blankScoreBehavior: loadLS(LS_KEYS.BLANK_SCORE_BEHAVIOR, DEFAULTS.blankScoreBehavior),
      normalize: loadLS(LS_KEYS.NORMALIZE, DEFAULTS.normalize),
      writeDelayMs: loadLS(LS_KEYS.WRITE_DELAY, DEFAULTS.writeDelayMs),
      settleDelayMs: loadLS(LS_KEYS.SETTLE_DELAY, DEFAULTS.settleDelayMs),
      selectors: loadLS(LS_KEYS.SELECTORS, DEFAULTS.selectors),
      panelPos: loadLS(LS_KEYS.PANEL_POS, { top: "80px", left: "24px" }),
      collapsed: loadLS(LS_KEYS.COLLAPSED, false),
      batchSize: loadLS(LS_KEYS.BATCH_SIZE, DEFAULTS.batchSize),
      presets: loadLS(LS_KEYS.PRESETS, null),
      parsedRows: [],
      joinedPreview: [],
      previewStats: null
    };

    const GRADE_LABELS = ["A+","A","B","C","D","F"];

    function cloneRanges(ranges) {
      const out = {};
      if (!ranges) return out;
      for (const k of Object.keys(ranges)) {
        const r = ranges[k] || {};
        out[k] = { min: Number(r.min), max: Number(r.max) };
      }
      return out;
    }

    function initPresetState() {
      const loadedPresets = state.presets;
      if (!loadedPresets || typeof loadedPresets !== "object") {
        state.presets = {
          default: {
            label: PRESETS.default.label,
            ranges: cloneRanges(PRESETS.default.ranges),
            readOnly: true
          }
        };
      } else {
        if (!loadedPresets.default) {
          loadedPresets.default = {
            label: PRESETS.default.label,
            ranges: cloneRanges(PRESETS.default.ranges),
            readOnly: true
          };
        } else {
          loadedPresets.default.label = PRESETS.default.label;
          loadedPresets.default.readOnly = true;
          if (!loadedPresets.default.ranges) {
            loadedPresets.default.ranges = cloneRanges(PRESETS.default.ranges);
          }
        }
        state.presets = loadedPresets;
      }

      if (!state.rangePreset || !state.presets[state.rangePreset]) {
        state.rangePreset = "default";
      }

      const activePreset = state.presets[state.rangePreset];
      if (activePreset && activePreset.ranges) {
        state.ranges = cloneRanges(activePreset.ranges);
      } else {
        state.ranges = cloneRanges(PRESETS.default.ranges);
      }

      saveLS(LS_KEYS.PRESETS, state.presets);
      saveLS(LS_KEYS.RANGE_PRESET, state.rangePreset);
      saveLS(LS_KEYS.RANGES, state.ranges);
    }

    initPresetState();

    function stripDiacritics(s) {
      try {
        return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      } catch {
        return s;
      }
    }

    function normalizeWhitespace(s) {
      return s.replace(/\s+/g, " ").trim();
    }

    function removeStudentTag(s) {
      return s.replace(/\(student\)/gi, "").trim();
    }

    function removeSuffixes(firstPart) {
      return firstPart.replace(/\b(jr|sr|ii|iii|iv)\.?\b/gi, "").replace(/\s{2,}/g, " ").trim();
    }

    function removeMiddleInitials(firstPart) {
      return firstPart
        .replace(/\b([A-Za-z])\s*\.(?=[\s,]|$)/g, "")
        .replace(/\b([A-Za-z])(?=[\s,]|$)/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    function parseNameParts(raw) {
      if (!raw) return { last: "", first: "", middleTokens: [], suffix: "" };

      let s = normalizeWhitespace(String(raw));
      if (state.normalize.stripStudentTag) s = removeStudentTag(s);
      s = stripDiacritics(s).replace(/\u00A0/g, " ");
      s = normalizeWhitespace(s);

      let last = "";
      let first = "";
      let middleTokens = [];
      let suffix = "";

      if (s.includes(",")) {
        const parts = s.split(",");
        last = parts[0] || "";
        const firstPartRaw = normalizeWhitespace(parts.slice(1).join(",") || "");
        const tokens = firstPartRaw.split(/\s+/).filter(Boolean);

        if (tokens.length) first = tokens.shift();
        if (tokens.length) middleTokens = tokens.slice();

        const lastTok = (middleTokens[middleTokens.length - 1] || "");
        if (/^(iii|iv|ii|jr\.?|sr\.?)$/i.test(lastTok)) {
          suffix = middleTokens.pop();
        }
      } else {
        const parts = s.split(/\s+/).filter(Boolean);

        const lastToken = parts[parts.length - 1] || "";
        if (/^(iii|iv|ii|jr\.?|sr\.?)$/i.test(lastToken)) {
          suffix = parts.pop();
        }

        first = parts.length ? parts.shift() : "";

        if (parts.length > 1) {
          const maybeMiddle = parts[0];
          if (/^[A-Za-z]\s*\.?$/.test(maybeMiddle)) {
            middleTokens = [parts.shift()];
          }
        }

        last = parts.join(" ");
      }

      last = normalizeWhitespace(last);
      first = normalizeWhitespace(first);

      return { last, first, middleTokens, suffix };
    }

    function canonicalNameKey(raw) {
      if (!raw) return "";
      const p = parseNameParts(raw);

      let last = p.last;
      let first = p.first;
      let middle = (p.middleTokens || []).join(" ");
      let suffix = p.suffix || "";

      const nicknameMap = {
        "brionesalcala|ty": "miguel",
        "willis|sterling": "cj",
        "hill|randy": "rj",
        "aphaisuwan|napadsawan": "minnie",
        "zarling|maxxmillian": "maxx",
        "good|jonathan": "jj",
        "le|anh": "alex",
        "nevarez|daniel": "danielle",
        "gomez|nathaniel": "nate",
        "lopezhernandez|alexander": "alex",
        "stortz|michael": "mikey",
        "covarrubioiii|paul": "paul",
        "roman|zohemy": "zoe",
        "mcdowell|ashlyn": "ash",
        "McKinney|terry": "trey",
        "lopez|abigail": "abby"
      };
      const nkLast = last.toLowerCase().replace(/[^a-z]/g, "");
      const nkFirst = first.toLowerCase().replace(/[^a-z]/g, "");
      const nk = `${nkLast}|${nkFirst}`;
      if (nicknameMap[nk]) first = nicknameMap[nk];

      if (state.normalize.ignoreSuffix) {
        first = removeSuffixes(first);
        last = removeSuffixes(last);
        suffix = removeSuffixes(suffix);
      }

      if (suffix) first = normalizeWhitespace(`${first} ${suffix}`);

      if (middle) first = normalizeWhitespace(`${first} ${middle}`);
      first = removeMiddleInitials(first);

      first = first.replace(/^,/, "").trim();
      last = last.replace(/,$/, "").trim();
      return `${last},${first}`.toLowerCase().replace(/\s+/g, "");
    }

    function textOf(el) {
      return (el && (el.textContent || el.innerText) || "").trim();
    }

    function sleep(ms) {
      return new Promise(res => setTimeout(res, ms));
    }

    function fireChangeAndBlur(el) {
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      } catch {}
    }

    function withinRange(n, range) {
      return typeof n === "number" && typeof range?.min === "number" && typeof range?.max === "number" && n >= range.min && n <= range.max;
    }

    function validateRanges(rangesObj) {
      const labels = Object.keys(rangesObj);
      const arr = labels.map(lbl => ({ lbl, min: Number(rangesObj[lbl].min), max: Number(rangesObj[lbl].max) }));
      for (const r of arr) {
        if (Number.isNaN(r.min) || Number.isNaN(r.max)) return { ok: false, msg: `Range for ${r.lbl} must be numeric.` };
        if (r.min > r.max) return { ok: false, msg: `Range for ${r.lbl} has min > max.` };
      }
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const A = arr[i];
          const B = arr[j];
          const overlap = Math.max(A.min, B.min) <= Math.min(A.max, B.max);
          if (overlap) return { ok: false, msg: `Ranges ${A.lbl} and ${B.lbl} overlap.` };
        }
      }
      return { ok: true, msg: "Ranges valid." };
    }

    function queryGridRows() {
      return Array.from($d.querySelectorAll(state.selectors.rowQuery));
    }

    function buildRosterMap() {
      const rows = queryGridRows();
      const roster = new Map();
      for (const row of rows) {
        const nameCell = row.querySelector(state.selectors.studentCell);
        const letterSel = row.querySelector(state.selectors.letterSelect);
        const commentSel = row.querySelector(state.selectors.commentSelect);
        const publicNote = row.querySelector(state.selectors.publicNote);
        if (!nameCell || !letterSel || !commentSel || !publicNote) continue;
        const key = canonicalNameKey(textOf(nameCell));
        if (!roster.has(key)) roster.set(key, []);
        roster.get(key).push({ row, nameCell, letterSel, commentSel, publicNote });
      }
      return roster;
    }

    function getEffectiveBatchSize() {
      if (state.batchSize && state.batchSize > 0) return state.batchSize;
      if (!state.joinedPreview || !state.joinedPreview.length) return 0;
      const totalOk = state.joinedPreview.filter(j => j.type === "ok").length;
      if (totalOk >= 90) return 25;
      if (totalOk >= 60) return 20;
      if (totalOk >= 40) return 10;
      return 0;
    }

    function labelToIdKey(label) {
      return label.replace(/\+/g, "plus");
    }

    /*******************************
     * UI OVERLAY
     *******************************/
    const styles = `
#qgm-panel{position:fixed;z-index:999999;background:#f5f5f5;color:#212121;border:1px solid #9e9e9e;border-radius:10px;width:520px;font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial;}
#qgm-header{cursor:move;padding:10px 12px;background:#e0e0e0;border-bottom:1px solid #bdbdbd;border-top-left-radius:10px;border-top-right-radius:10px;display:flex;align-items:center;justify-content:space-between}
#qgm-title{font-weight:600;font-size:14px}
#qgm-body{padding:10px 12px;max-height:70vh;overflow:auto}
#qgm-footer{padding:8px 12px;border-top:1px solid #bdbdbd;display:flex;gap:8px;flex-wrap:wrap;background:#eeeeee;border-bottom-left-radius:10px;border-bottom-right-radius:10px}
#qgm-close{background:transparent;border:none;color:#424242;font-size:16px;cursor:pointer}
#qgm-close:hover{color:#000000}
.qgm-field{margin-bottom:10px}
.qgm-label{font-size:12px;color:#424242;margin-bottom:4px}
.qgm-row{display:flex;gap:8px;align-items:center}
.qgm-col{flex:1}
.qgm-textarea{width:100%;min-height:110px;padding:8px;border-radius:8px;border:1px solid #bdbdbd;background:#ffffff;color:#212121}
.qgm-input{width:100%;padding:6px 8px;border-radius:8px;border:1px solid #bdbdbd;background:#ffffff;color:#212121}
.qgm-select{width:100%;padding:6px 8px;border-radius:8px;border:1px solid #bdbdbd;background:#ffffff;color:#212121}
.qgm-radio{display:flex;gap:10px;align-items:center}
.qgm-btn{padding:6px 10px;border-radius:8px;border:1px solid #9e9e9e;background:#e0e0e0;color:#212121;cursor:pointer}
.qgm-btn:hover{background:#d5d5d5}
.qgm-note{font-size:12px;color:#616161}
.qgm-mini{font-size:12px;color:#757575}
.qgm-status{max-height:160px;overflow:auto;background:#ffffff;border:1px solid #bdbdbd;border-radius:8px;padding:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Courier New",monospace;font-size:12px;white-space:pre-wrap}
.qgm-hidden{display:none!important}
#qgm-settings-bar{display:flex;justify-content:space-between;align-items:center;margin:6px 0 4px}
#qgm-settings-toggle.qgm-closed::after{content:" ▼";font-size:11px;color:#757575}
#qgm-settings-toggle.qgm-open::after{content:" ▲";font-size:11px;color:#757575}
.qgm-log-ok{color:#1b5e20;}
.qgm-log-warn{color:#f57f17;}
.qgm-log-err{color:#b71c1c;}
.qgm-log-skip{color:#616161;}
.qgm-hr{height:1px;background:#bdbdbd;margin:10px 0}
#qgm-advanced{display:none}
`;

    const panel = $d.createElement("div");
    panel.id = "qgm-panel";
    panel.style.top = state.panelPos.top || "80px";
    panel.style.left = state.panelPos.left || "24px";

    panel.innerHTML = `
<div id="qgm-header">
  <div id="qgm-title">Quick Grade Mapper</div>
  <button id="qgm-close" title="Close">✕</button>
</div>
<div id="qgm-body">

  <div class="qgm-field">
    <div class="qgm-label">Mode</div>
    <div class="qgm-radio">
      <label><input type="radio" name="qgm-mode" value="convert"> Convert (scores → letters)</label>
      <label><input type="radio" name="qgm-mode" value="direct"> Direct Letters (paste letters)</label>
    </div>
  </div>

  <div class="qgm-field">
    <div class="qgm-label">Paste from Google Sheets</div>
    <textarea id="qgm-paste" class="qgm-textarea" placeholder="Col A = Last, First | Col B = Score OR Letter | Col C = Missing/Absent/Incomplete/Late | Col D = Note"></textarea>
    <div class="qgm-note">Names normalized (ignore middle/suffixes, strip '(student)').</div>
  </div>

  <div id="qgm-settings-bar">
    <div class="qgm-label" style="margin:0">Settings</div>
    <button id="qgm-settings-toggle" class="qgm-btn qgm-open" type="button">Hide</button>
  </div>

  <div id="qgm-settings">

    <div class="qgm-field">
      <div class="qgm-label">Blank score behavior</div>
      <select id="qgm-blank-score-behavior" class="qgm-select">
        <option value="missing">Mark Missing</option>
        <option value="absent">Mark Absent</option>
        <option value="blank">Leave Blank</option>
      </select>
      <div class="qgm-note">Controls what happens when Column B is empty.</div>
    </div>

    <div id="qgm-convert-ui" class="qgm-field">
      <div class="qgm-label">Grade Scale</div>

      <div class="qgm-row" style="margin-bottom:6px;">
        <div class="qgm-col">
          <label class="qgm-label">Preset</label>
          <select id="qgm-range-preset" class="qgm-select"></select>
        </div>
        <div class="qgm-col">
          <label class="qgm-label">Preset name (required to save)</label>
          <input id="qgm-preset-name" class="qgm-input" type="text" placeholder="Type a name">
        </div>
      </div>

      <div class="qgm-row" style="margin-bottom:6px;">
              <div class="qgm-col">
          <label class="qgm-label"><input type="checkbox" id="qgm-preset-overwrite"> Overwrite existing preset</label>
        </div>
        <div class="qgm-col" style="text-align:right;">
          <button id="qgm-preset-add" class="qgm-btn" type="button">Add Preset</button>
          <button id="qgm-preset-save" class="qgm-btn" type="button">Save Preset</button>
          <button id="qgm-preset-delete" class="qgm-btn" type="button">Delete Preset</button>
        </div>
      </div>

      <div class="qgm-field">
        <div class="qgm-label">Letter ranges (min – max)</div>
        <div class="qgm-row" style="margin-bottom:4px;">
          <span class="qgm-mini" style="width:40px;">A+</span>
          <input id="qgm-range-Aplus-min" class="qgm-input" type="number" style="max-width:80px;">
          <span class="qgm-mini">-</span>
          <input id="qgm-range-Aplus-max" class="qgm-input" type="number" style="max-width:80px;">
        </div>
        <div class="qgm-row" style="margin-bottom:4px;">
          <span class="qgm-mini" style="width:40px;">A</span>
          <input id="qgm-range-A-min" class="qgm-input" type="number" style="max-width:80px;">
          <span class="qgm-mini">-</span>
          <input id="qgm-range-A-max" class="qgm-input" type="number" style="max-width:80px;">
        </div>
        <div class="qgm-row" style="margin-bottom:4px;">
          <span class="qgm-mini" style="width:40px;">B</span>
          <input id="qgm-range-B-min" class="qgm-input" type="number" style="max-width:80px;">
          <span class="qgm-mini">-</span>
          <input id="qgm-range-B-max" class="qgm-input" type="number" style="max-width:80px;">
        </div>
        <div class="qgm-row" style="margin-bottom:4px;">
          <span class="qgm-mini" style="width:40px;">C</span>
          <input id="qgm-range-C-min" class="qgm-input" type="number" style="max-width:80px;">
          <span class="qgm-mini">-</span>
          <input id="qgm-range-C-max" class="qgm-input" type="number" style="max-width:80px;">
        </div>
        <div class="qgm-row" style="margin-bottom:4px;">
          <span class="qgm-mini" style="width:40px;">D</span>
          <input id="qgm-range-D-min" class="qgm-input" type="number" style="max-width:80px;">
          <span class="qgm-mini">-</span>
          <input id="qgm-range-D-max" class="qgm-input" type="number" style="max-width:80px;">
        </div>
        <div class="qgm-row">
          <span class="qgm-mini" style="width:40px;">F</span>
          <input id="qgm-range-F-min" class="qgm-input" type="number" style="max-width:80px;">
          <span class="qgm-mini">-</span>
          <input id="qgm-range-F-max" class="qgm-input" type="number" style="max-width:80px;">
        </div>
      </div>

      <div class="qgm-row" style="gap:12px;">
        <div class="qgm-col">
          <label class="qgm-label">Pause per Student (ms)</label>
          <input id="qgm-delay" class="qgm-input" type="number" min="50" step="50">
        </div>
        <div class="qgm-col">
          <label class="qgm-label">Pause After Batch (ms)</label>
          <input id="qgm-settle" class="qgm-input" type="number" min="0" step="100">
        </div>
        <div class="qgm-col">
          <label class="qgm-label">Batch Size (0 = Auto)</label>
          <input id="qgm-batch" class="qgm-input" type="number" min="0" step="1">
        </div>
      </div>

      <div class="qgm-hr"></div>

      <div id="qgm-advanced" class="qgm-row">
        <div class="qgm-col">
          <label class="qgm-label">Advanced selectors</label>
          <div class="qgm-row"><span class="qgm-mini" style="width:120px">Student cell:</span><input id="qgm-sel-student" class="qgm-input" type="text"></div>
          <div class="qgm-row"><span class="qgm-mini" style="width:120px">Letter select:</span><input id="qgm-sel-letter" class="qgm-input" type="text"></div>
          <div class="qgm-row"><span class="qgm-mini" style="width:120px">Comment select:</span><input id="qgm-sel-comment" class="qgm-input" type="text"></div>
          <div class="qgm-row"><span class="qgm-mini" style="width:120px">Public note:</span><input id="qgm-sel-pubnote" class="qgm-input" type="text"></div>
          <div class="qgm-row"><span class="qgm-mini" style="width:120px">Save button:</span><input id="qgm-sel-save" class="qgm-input" type="text"></div>
          <div class="qgm-row"><span class="qgm-mini" style="width:120px">Recalculate icon:</span><input id="qgm-sel-recalc" class="qgm-input" type="text"></div>
        </div>
      </div>

    </div>
  </div>

  <div class="qgm-field">
    <div class="qgm-label">Preview / Log</div>
    <div id="qgm-stats" class="qgm-mini"></div>
    <div id="qgm-status" class="qgm-status"></div>
  </div>

</div>

<div id="qgm-footer">
  <button id="qgm-preview" class="qgm-btn">Preview (Dry Run)</button>
  <button id="qgm-apply" class="qgm-btn">Apply</button>
  <button id="qgm-clear" class="qgm-btn">Clear Data</button>
  <button id="qgm-copy" class="qgm-btn">Copy Log</button>
</div>
`;

    const styleTag = $d.createElement("style");
    styleTag.textContent = styles;

    function mountPanel() {
      if ($d.getElementById("qgm-panel")) return;
      $d.documentElement.appendChild(styleTag);
      $d.body.appendChild(panel);
      initPanel();
    }

    function mountLauncher() {
      if ($d.getElementById("qgm-launcher")) return;
      const btn = $d.createElement("button");
      btn.id = "qgm-launcher";
      btn.textContent = "QGM";
      btn.title = "Quick Grade Mapper";
      Object.assign(btn.style, {
        position: "fixed",
        zIndex: 999999,
        top: "16px",
        left: "16px",
        padding: "6px 10px",
        borderRadius: "8px",
        border: "1px solid #9e9e9e",
        background: "#f5f5f5",
        color: "#212121",
        cursor: "pointer"
      });
      btn.addEventListener("click", mountPanel);
      $d.body.appendChild(btn);
    }


    function initPanel() {
      panel.style.top = state.panelPos.top;
      panel.style.left = state.panelPos.left;

      const header = panel.querySelector("#qgm-header");
      let dragging = false;
      let dx = 0;
      let dy = 0;
      header.addEventListener("mousedown", e => { dragging = true; dx = e.clientX - panel.offsetLeft; dy = e.clientY - panel.offsetTop; e.preventDefault(); });
      $d.addEventListener("mousemove", e => { if (!dragging) return; panel.style.left = Math.max(0, e.clientX - dx) + "px"; panel.style.top = Math.max(0, e.clientY - dy) + "px"; });
      $d.addEventListener("mouseup", () => { if (dragging) { dragging = false; saveLS(LS_KEYS.PANEL_POS, { top: panel.style.top, left: panel.style.left }); } });

      const closeBtn = panel.querySelector("#qgm-close");
      const modeRadios = Array.from(panel.querySelectorAll('input[name="qgm-mode"]'));
      const pasteTA = panel.querySelector("#qgm-paste");
      const blankScoreBehaviorSel = panel.querySelector("#qgm-blank-score-behavior");

      const delayInput = panel.querySelector("#qgm-delay");
      const settleInput = panel.querySelector("#qgm-settle");
      const batchInput = panel.querySelector("#qgm-batch");

      const selStudent = panel.querySelector("#qgm-sel-student");
      const selLetter = panel.querySelector("#qgm-sel-letter");
      const selComment = panel.querySelector("#qgm-sel-comment");
      const selPubNote = panel.querySelector("#qgm-sel-pubnote");
      const selSave = panel.querySelector("#qgm-sel-save");
      const selRecalc = panel.querySelector("#qgm-sel-recalc");

      const convertUI = panel.querySelector("#qgm-convert-ui");
      const presetSel = panel.querySelector("#qgm-range-preset");
      const presetNameInput = panel.querySelector("#qgm-preset-name");
      const presetOverwriteCheckbox = panel.querySelector("#qgm-preset-overwrite");
      const presetAddBtn = panel.querySelector("#qgm-preset-add");
      const presetSaveBtn = panel.querySelector("#qgm-preset-save");
      const presetDeleteBtn = panel.querySelector("#qgm-preset-delete");
      let addingPreset = false;

      const statsEl = panel.querySelector("#qgm-stats");
      const statusEl = panel.querySelector("#qgm-status");
      const settingsWrap = panel.querySelector("#qgm-settings");
      const settingsBtn = panel.querySelector("#qgm-settings-toggle");

      const gradeRangeInputs = {};
      for (const lbl of GRADE_LABELS) {
        const key = labelToIdKey(lbl);
        const minEl = panel.querySelector(`#qgm-range-${key}-min`);
        const maxEl = panel.querySelector(`#qgm-range-${key}-max`);
        gradeRangeInputs[lbl] = { minEl, maxEl };
      }

      function applyCollapsedUI() {
        if (state.collapsed) {
          panel.classList.add("qgm-collapsed");
          settingsWrap.classList.add("qgm-hidden");
          settingsBtn.textContent = "Show";
          settingsBtn.classList.remove("qgm-open");
          settingsBtn.classList.add("qgm-closed");
        } else {
          panel.classList.remove("qgm-collapsed");
          settingsWrap.classList.remove("qgm-hidden");
          settingsBtn.textContent = "Hide";
          settingsBtn.classList.remove("qgm-closed");
          settingsBtn.classList.add("qgm-open");
        }
      }

      function refreshPresetSelect() {
        while (presetSel.firstChild) presetSel.removeChild(presetSel.firstChild);
        const keys = Object.keys(state.presets || {});
        keys.sort((a, b) => {
          if (a === "default") return -1;
          if (b === "default") return 1;
          const la = (state.presets[a].label || a).toLowerCase();
          const lb = (state.presets[b].label || b).toLowerCase();
          if (la < lb) return -1;
          if (la > lb) return 1;
          return 0;
        });
        for (const key of keys) {
          const opt = $d.createElement("option");
          opt.value = key;
          opt.textContent = state.presets[key].label || key;
          presetSel.appendChild(opt);
        }
        if (!state.rangePreset || !state.presets[state.rangePreset]) {
          state.rangePreset = "default";
        }
        presetSel.value = state.rangePreset;
        const active = state.presets[state.rangePreset];
        presetNameInput.value = active ? (active.label || state.rangePreset) : "";
      }

      function applyRangesToInputs() {
        for (const lbl of GRADE_LABELS) {
          const r = state.ranges[lbl] || {};
          const pair = gradeRangeInputs[lbl];
          if (!pair) continue;
          pair.minEl.value = r.min != null && !Number.isNaN(r.min) ? String(r.min) : "";
          pair.maxEl.value = r.max != null && !Number.isNaN(r.max) ? String(r.max) : "";
        }
      }

      function pullInputsToRanges() {
        const newRanges = {};
        for (const lbl of GRADE_LABELS) {
          const pair = gradeRangeInputs[lbl];
          if (!pair) continue;
          const minVal = Number(pair.minEl.value);
          const maxVal = Number(pair.maxEl.value);
          newRanges[lbl] = {
            min: Number.isNaN(minVal) ? state.ranges[lbl]?.min ?? 0 : minVal,
            max: Number.isNaN(maxVal) ? state.ranges[lbl]?.max ?? 0 : maxVal
          };
        }
        state.ranges = newRanges;
        saveLS(LS_KEYS.RANGES, state.ranges);
      }

        function setAddingPreset(active) {
        addingPreset = active;
        presetAddBtn.textContent = active ? "Cancel Add" : "Add Preset";
      }

      modeRadios.forEach(r => r.checked = (r.value === state.mode));
      blankScoreBehaviorSel.value = state.blankScoreBehavior;
      delayInput.value = String(state.writeDelayMs);
      settleInput.value = String(state.settleDelayMs);
      batchInput.value = String(state.batchSize);

      selStudent.value = state.selectors.studentCell;
      selLetter.value = state.selectors.letterSelect;
      selComment.value = state.selectors.commentSelect;
      selPubNote.value = state.selectors.publicNote;
      selSave.value = state.selectors.saveButton;
      selRecalc.value = state.selectors.recalcIcon;

      convertUI.style.display = (state.mode === "convert") ? "" : "none";
      applyCollapsedUI();
      refreshPresetSelect();
      applyRangesToInputs();

      closeBtn.addEventListener("click", () => panel.remove());

      settingsBtn.addEventListener("click", () => {
        state.collapsed = !state.collapsed;
        saveLS(LS_KEYS.COLLAPSED, state.collapsed);
        applyCollapsedUI();
      });

      modeRadios.forEach(r => r.addEventListener("change", () => {
        if (r.checked) {
          state.mode = r.value;
          saveLS(LS_KEYS.MODE, state.mode);
          convertUI.style.display = (state.mode === "convert") ? "" : "none";
        }
      }));

      blankScoreBehaviorSel.addEventListener("change", () => {
        state.blankScoreBehavior = blankScoreBehaviorSel.value || DEFAULTS.blankScoreBehavior;
        saveLS(LS_KEYS.BLANK_SCORE_BEHAVIOR, state.blankScoreBehavior);
      });

      delayInput.addEventListener("change", () => {
        const v = Math.max(50, Number(delayInput.value) || DEFAULTS.writeDelayMs);
        state.writeDelayMs = v;
        saveLS(LS_KEYS.WRITE_DELAY, v);
      });

      settleInput.addEventListener("change", () => {
        const v = Math.max(0, Number(settleInput.value) || DEFAULTS.settleDelayMs);
        state.settleDelayMs = v;
        saveLS(LS_KEYS.SETTLE_DELAY, v);
      });

      batchInput.addEventListener("change", () => {
        const v = Math.max(0, Number(batchInput.value) || 0);
        state.batchSize = v;
        saveLS(LS_KEYS.BATCH_SIZE, v);
      });

      selStudent.addEventListener("change", () => {
        state.selectors.studentCell = selStudent.value || DEFAULTS.selectors.studentCell;
        saveLS(LS_KEYS.SELECTORS, state.selectors);
      });

      selLetter.addEventListener("change", () => {
        state.selectors.letterSelect = selLetter.value || DEFAULTS.selectors.letterSelect;
        saveLS(LS_KEYS.SELECTORS, state.selectors);
      });

      selComment.addEventListener("change", () => {
        state.selectors.commentSelect = selComment.value || DEFAULTS.selectors.commentSelect;
        saveLS(LS_KEYS.SELECTORS, state.selectors);
      });

      selPubNote.addEventListener("change", () => {
        state.selectors.publicNote = selPubNote.value || DEFAULTS.selectors.publicNote;
        saveLS(LS_KEYS.SELECTORS, state.selectors);
      });

      selSave.addEventListener("change", () => {
        state.selectors.saveButton = selSave.value || DEFAULTS.selectors.saveButton;
        saveLS(LS_KEYS.SELECTORS, state.selectors);
      });

      selRecalc.addEventListener("change", () => {
        state.selectors.recalcIcon = selRecalc.value || DEFAULTS.selectors.recalcIcon;
        saveLS(LS_KEYS.SELECTORS, state.selectors);
      });


      presetAddBtn.addEventListener("click", () => {
        if (addingPreset) {
          const active = state.presets[state.rangePreset];
          setAddingPreset(false);

          if (active && active.ranges) {
            state.ranges = cloneRanges(active.ranges);
            saveLS(LS_KEYS.RANGES, state.ranges);
            applyRangesToInputs();
          }

          presetNameInput.value = active
            ? (active.label || state.rangePreset)
            : "";

          presetOverwriteCheckbox.checked = false;
          return;
        }

        pullInputsToRanges();
        presetNameInput.value = "";
        presetOverwriteCheckbox.checked = false;
        setAddingPreset(true);
        presetNameInput.focus();
      });


      presetSel.addEventListener("change", () => {
        const key = presetSel.value;
        if (!state.presets[key]) return;
        setAddingPreset(false);
        state.rangePreset = key;
        const active = state.presets[key];
        state.ranges = cloneRanges(active.ranges);
        saveLS(LS_KEYS.RANGE_PRESET, state.rangePreset);
        saveLS(LS_KEYS.RANGES, state.ranges);
        applyRangesToInputs();
        presetNameInput.value = active.label || key;
        presetOverwriteCheckbox.checked = false;
      });

      for (const lbl of GRADE_LABELS) {
        const pair = gradeRangeInputs[lbl];
        if (!pair) continue;
        const handler = () => {
          pullInputsToRanges();
        };
        pair.minEl.addEventListener("change", handler);
        pair.maxEl.addEventListener("change", handler);
      }

      presetSaveBtn.addEventListener("click", () => {
        pullInputsToRanges();

        const check = validateRanges(state.ranges);
        if (!check.ok) {
          alert(check.msg);
          return;
        }

        const nameRaw = presetNameInput.value || "";
        const name = nameRaw.trim();

        if (!name) {
          alert("Enter a preset name before saving.");
          return;
        }

        if (name.toLowerCase() === "default") {
          alert("Default preset is read-only and cannot be overwritten.");
          return;
        }

        const existingKey = Object.keys(state.presets).find(
          k => (state.presets[k].label || k) === name
        );

        const hasExisting = !!existingKey;
        const customCount = Object.keys(state.presets).filter(
          k => k !== "default"
        ).length;

        if (addingPreset && hasExisting) {
          alert(
            "A preset with this name already exists. Enter a different name for the new preset."
          );
          return;
        }

        if (!hasExisting && customCount >= MAX_CUSTOM_PRESETS) {
          alert(`Maximum of ${MAX_CUSTOM_PRESETS} custom presets reached.`);
          return;
        }

        if (hasExisting && !presetOverwriteCheckbox.checked) {
          alert(
            "Preset with this name already exists. Check 'Overwrite existing preset' to replace it."
          );
          return;
        }

        const keyToUse = hasExisting ? existingKey : name;

        state.presets[keyToUse] = {
          label: name,
          ranges: cloneRanges(state.ranges),
          readOnly: false
        };

        state.rangePreset = keyToUse;

        saveLS(LS_KEYS.PRESETS, state.presets);
        saveLS(LS_KEYS.RANGE_PRESET, state.rangePreset);
        saveLS(LS_KEYS.RANGES, state.ranges);

        refreshPresetSelect();
        applyRangesToInputs();

        presetOverwriteCheckbox.checked = false;
        setAddingPreset(false);
      });

      presetDeleteBtn.addEventListener("click", () => {
        setAddingPreset(false);
        const key = presetSel.value;
        if (!key || key === "default") {
          alert("Default preset cannot be deleted.");
          return;
        }
        if (!state.presets[key]) return;
        delete state.presets[key];
        saveLS(LS_KEYS.PRESETS, state.presets);
        state.rangePreset = "default";
        const active = state.presets.default;
        state.ranges = cloneRanges(active.ranges);
        saveLS(LS_KEYS.RANGE_PRESET, state.rangePreset);
        saveLS(LS_KEYS.RANGES, state.ranges);
        refreshPresetSelect();
        applyRangesToInputs();
        presetNameInput.value = active.label || "Default";
        presetOverwriteCheckbox.checked = false;
      });

      panel.querySelector("#qgm-preview").addEventListener("click", () => {
        state.parsedRows = parsePastedData(pasteTA.value);
        renderPreview(statusEl, statsEl);
      });

      panel.querySelector("#qgm-apply").addEventListener("click", async () => {
        state.parsedRows = parsePastedData(pasteTA.value);
        const preview = buildPreviewJoin();
        state.joinedPreview = preview.joined;
        state.previewStats = preview.stats;
        renderPreview(statusEl, statsEl);
        await applyActionsOnePass(statusEl, statsEl);
      });

      panel.querySelector("#qgm-clear").addEventListener("click", () => {
        pasteTA.value = "";
        statusEl.innerHTML = "";
        statsEl.textContent = "";
        state.parsedRows = [];
        state.joinedPreview = [];
        state.previewStats = null;
      });

      panel.querySelector("#qgm-copy").addEventListener("click", async () => {
        const temp = $d.createElement("div");
        temp.innerHTML = statusEl.innerHTML;
        const text = temp.textContent || "";
        try { await navigator.clipboard.writeText(text); } catch {}
      });
    }


    /*******************************
     * PARSING (4 columns) & PREVIEW JOIN
     *******************************/
    function parsePastedData(raw) {
      const out = [];
      if (!raw || !raw.trim()) return out;
      const lines = raw.replace(/\r\n/g, "\n").split("\n").filter(l => l.trim().length > 0);

      function looksLikeHeader(c1, c2) {
        const h = `${c1} ${c2}`.toLowerCase();
        return /student|name|score|letter/.test(h);
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let cols = line.split("\t");
        if (cols.length < 2) cols = line.split(",");
        const colA = (cols[0] || "").trim();
        const colBraw = (cols[1] || "").trim();
        const colCraw = (cols[2] || "").trim();
        const colDraw = (cols[3] || "").trim();

        const colB = (colBraw === "-") ? "" : colBraw;
        const colC = (colCraw === "-") ? "" : colCraw;
        const colD = (colDraw === "-") ? "" : colDraw;

        if (i === 0 && looksLikeHeader(colA, colBraw)) continue;

        const nameRaw = colA;
        const key = canonicalNameKey(nameRaw);
        if (!key) continue;

        const bLower = colB.toLowerCase();
        const cLower = colC.toLowerCase();

        const bUpper = colB.toUpperCase();
        const cUpper = colC.toUpperCase();

        const bIsBlank = (colB === "");
        const bIsMissing = (bUpper === "M" || bLower === "missing");
        const bIsAbsent = (bUpper === "AB" || bLower === "absent");
        const bIsIncomplete = (bUpper === "I" || bLower === "incomplete");

        const cIsMissing = (cUpper === "M" || cLower === "missing");
        const cIsAbsent = (cUpper === "AB" || cLower === "absent");
        const cIsIncomplete = (cUpper === "I" || cLower === "incomplete");
        const cIsLate = (
          cUpper === "L" ||
          cLower === "late" ||
          cLower.startsWith("late")
        );
        const cIsOriginality = (
          cLower === "oc" ||
          cLower === "originality" ||
          cLower === "originality concern"
        );

        const columnCStatus =
          cIsIncomplete ? "incomplete" :
          cIsMissing ? "missing" :
          cIsAbsent ? "absent" :
          cIsOriginality ? "originality" : "";

        const columnBStatus =
          bIsIncomplete ? "incomplete" :
          bIsMissing ? "missing" :
          bIsAbsent ? "absent" : "";

        const blankScoreStatus =
          bIsBlank && state.blankScoreBehavior !== "blank"
            ? state.blankScoreBehavior
            : "";

        const status =
          columnCStatus ||
          columnBStatus ||
          blankScoreStatus;

        const isLate = !!cIsLate;

        let score = null;
        let letter = null;
        let bad = null;

        if (!status) {
          if (state.mode === "convert") {
            if (colB !== "") {
              const n = Number(colB);
              if (Number.isNaN(n)) bad = `Invalid score: "${colB}"`;
              else {
                score = n;
                const chk = validateRanges(state.ranges);
                if (!chk.ok) bad = chk.msg;
                else {
                  const L = scoreToLetter(n);
                  if (!L) bad = `Out of range: ${n}`;
                  else letter = L;
                }
              }
            }
          } else {
            if (colB !== "") {
              const L = colB.toUpperCase();
              if (!LETTERS_ALLOWED.includes(L)) bad = `Invalid letter: "${colB}"`;
              else letter = L;
            }
          }
        }

        const noteText = (colD || "");

        out.push({
          row: i + 1,
          nameRaw,
          key,
          status,
          isLate,
          score,
          letter,
          noteText,
          bad
        });
      }
      return out;
    }

    function scoreToLetter(n) {
      for (const lbl of Object.keys(state.ranges)) {
        if (withinRange(n, state.ranges[lbl])) return lbl;
      }
      return null;
    }

    function buildPreviewJoin() {
      const roster = buildRosterMap();

      const dupKeysOnPage = new Set(
        [...roster.entries()]
          .filter(([, arr]) => arr.length > 1)
          .map(([k]) => k)
      );

      const countPasted = {};
      for (const r of state.parsedRows) countPasted[r.key] = (countPasted[r.key] || 0) + 1;
      const dupKeysInPaste = new Set(Object.keys(countPasted).filter(k => countPasted[k] > 1));

      const joined = [];
      let stats = {
        total: 0,
        matched: 0,
        notFound: 0,
        duplicateSkipped: 0,
        invalid: 0,
        setLetter: 0,
        missingSet: 0,
        absentSet: 0,
        incompleteSet: 0,
        lateSet: 0,
        noteSet: 0,
        letterChangesNeeded: 0,
        letterAlreadyOk: 0,
        missingChangesNeeded: 0,
        missingAlreadyOk: 0,
        absentAlreadyOk: 0,
        absentChangesNeeded: 0,
        incompleteChangesNeeded: 0,
        incompleteAlreadyOk: 0,
        lateChangesNeeded: 0,
        lateAlreadyOk: 0,
        noteChangesNeeded: 0,
        noteAlreadyOk: 0
      };

      for (const p of state.parsedRows) {
        stats.total++;
        if (p.bad) {
          joined.push({ type: "invalid", msg: `Row ${p.row}: ${p.nameRaw} — ${p.bad}` });
          stats.invalid++;
          continue;
        }
        if (!roster.has(p.key)) {
          joined.push({ type: "notfound", msg: `Row ${p.row}: ${p.nameRaw} — Not found on page` });
          stats.notFound++;
          continue;
        }
        if (dupKeysOnPage.has(p.key) || dupKeysInPaste.has(p.key)) {
          joined.push({ type: "dup", msg: `Row ${p.row}: ${p.nameRaw} — Duplicate name; skipped` });
          stats.duplicateSkipped++;
          continue;
        }

        const rowRef = roster.get(p.key)[0];
        const currentLetter = (rowRef.letterSel.value || "").trim();

        let currentCommentText = "";
        if (rowRef.commentSel.selectedOptions && rowRef.commentSel.selectedOptions[0]) {
          currentCommentText = textOf(rowRef.commentSel.selectedOptions[0]);
        }

        const currentNote = rowRef.publicNote.value || "";

        let action;
        if (p.status) {
          if (p.status === "missing") stats.missingSet++;
          if (p.status === "absent") stats.absentSet++;
          if (p.status === "incomplete") stats.incompleteSet++;
          if (p.status === "originality") stats.lateSet++;
          if (p.noteText) stats.noteSet++;

          const targetStatusText =
            (p.status === "incomplete") ? INCOMPLETE_TEXT :
            (p.status === "absent") ? ABSENT_TEXT :
            (p.status === "originality") ? ORIGINALITY_TEXT :
            MISSING_TEXT;

          const needsStatus = currentCommentText !== targetStatusText;
          const needsNote = p.noteText
            ? (currentNote !== p.noteText)
            : false;

          if (p.status === "missing") {
            if (needsStatus) stats.missingChangesNeeded++;
            else stats.missingAlreadyOk++;
          } else if (p.status === "absent") {
            if (needsStatus) stats.absentChangesNeeded++;
            else stats.absentAlreadyOk++;
          } else {
            if (needsStatus) stats.incompleteChangesNeeded++;
            else stats.incompleteAlreadyOk++;
          }

          if (p.noteText) {
            if (needsNote) stats.noteChangesNeeded++;
            else stats.noteAlreadyOk++;
          }

          action = {
            kind: "status",
            rowRef,
            name: p.nameRaw,
            statusText: targetStatusText,
            noteText: p.noteText,
            currentLetter,
            currentCommentText,
            currentNote,
            needsStatus,
            needsNote
          };
        } else {
          let needsLetter = false;
          if (p.letter) {
            needsLetter = currentLetter !== p.letter;
          }

          let needsLate = false;
          if (p.isLate) {
            const lowerCurrent = currentCommentText.toLowerCase();
            const isAlreadyLate = (lowerCurrent === LATE_TEXT.toLowerCase()) || lowerCurrent.startsWith("late");
            needsLate = !isAlreadyLate;
          }

          const needsNote = p.noteText ? (currentNote !== p.noteText) : false;

          if (p.letter) {
            stats.setLetter++;
            if (needsLetter) stats.letterChangesNeeded++;
            else stats.letterAlreadyOk++;
          }

          if (p.isLate) {
            stats.lateSet++;
            if (needsLate) stats.lateChangesNeeded++;
            else stats.lateAlreadyOk++;
          }

          if (p.noteText) {
            stats.noteSet++;
            if (needsNote) stats.noteChangesNeeded++;
            else stats.noteAlreadyOk++;
          }

          action = {
            kind: "letter",
            rowRef,
            name: p.nameRaw,
            letter: p.letter || "",
            isLate: p.isLate,
            noteText: p.noteText,
            currentLetter,
            currentCommentText,
            currentNote,
            needsLetter,
            needsLate,
            needsNote
          };
        }

        joined.push({ type: "ok", action });
        stats.matched++;
      }

      return { joined, stats };
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#039;");
    }

    function renderPreview(statusEl, statsEl) {
      const preview = buildPreviewJoin();
      state.joinedPreview = preview.joined;
      state.previewStats = preview.stats;

      const lines = [];
      for (const item of preview.joined) {
        if (item.type === "ok") {
          const a = item.action;
          if (a.kind === "letter") {
            const bits = [];
            if (a.letter) {
              if (a.needsLetter) {
                const from = a.currentLetter || "(blank)";
                bits.push(`Letter = ${escapeHtml(a.letter)} (from ${escapeHtml(from)})`);
              } else {
                bits.push(`Letter = ${escapeHtml(a.letter)} (no change)`);
              }
            }
            if (a.isLate) {
              if (a.needsLate) {
                bits.push(`Comment "Late" (will set)`);
              } else {
                bits.push(`Comment "Late" (no change)`);
              }
            }
            if (a.noteText) {
              if (a.needsNote) {
                bits.push(`Note → "${escapeHtml(a.noteText)}" (will update)`);
              } else {
                bits.push(`Note already "${escapeHtml(a.noteText)}" (no change)`);
              }
            }
            if (!bits.length) bits.push("No changes needed");
            lines.push(`<div class="qgm-log-ok">✓ ${bits.join(" + ")} — ${escapeHtml(a.name)}</div>`);
          } else {
            const bits = [];
            if (a.needsStatus) {
              bits.push(`Comment "${escapeHtml(a.statusText)}" (will set)`);
            } else {
              bits.push(`Comment "${escapeHtml(a.statusText)}" (no change)`);
            }
            if (a.noteText) {
              if (a.needsNote) {
                bits.push(`Note → "${escapeHtml(a.noteText)}" (will update)`);
              } else {
                bits.push(`Note already "${escapeHtml(a.noteText)}" (no change)`);
              }
            }
            lines.push(`<div class="qgm-log-ok">✓ ${bits.join(" + ")} — ${escapeHtml(a.name)}</div>`);
          }
        } else if (item.type === "notfound") {
          lines.push(`<div class="qgm-log-err">• NOT FOUND — ${escapeHtml(item.msg)}</div>`);
        } else if (item.type === "dup") {
          lines.push(`<div class="qgm-log-skip">• DUPLICATE SKIPPED — ${escapeHtml(item.msg)}</div>`);
        } else if (item.type === "invalid") {
          lines.push(`<div class="qgm-log-err">• INVALID — ${escapeHtml(item.msg)}</div>`);
        }
      }

      const s = preview.stats;
      statsEl.textContent =
        `Total: ${s.total}   Matched: ${s.matched}   Letters: ${s.setLetter} (changes: ${s.letterChangesNeeded}, ok: ${s.letterAlreadyOk})   ` +
        `Missing: ${s.missingSet} (changes: ${s.missingChangesNeeded}, ok: ${s.missingAlreadyOk})   ` +
        `Absent: ${s.absentSet} (changes: ${s.absentChangesNeeded}, ok: ${s.absentAlreadyOk})   ` +
        `Incomplete: ${s.incompleteSet} (changes: ${s.incompleteChangesNeeded}, ok: ${s.incompleteAlreadyOk})   ` +
        `Late: ${s.lateSet} (changes: ${s.lateChangesNeeded}, ok: ${s.lateAlreadyOk})   ` +
        `Notes: ${s.noteSet} (changes: ${s.noteChangesNeeded}, ok: ${s.noteAlreadyOk})   ` +
        `Not Found: ${s.notFound}   Duplicates: ${s.duplicateSkipped}   Invalid: ${s.invalid}`;

      const statusBox = panel.querySelector("#qgm-status");
      if (statusBox) statusBox.innerHTML = lines.join("");
    }



    /*******************************
     * WRITE HELPERS
     *******************************/
    async function setLetter(selectEl, letter, delay) {
      const before = (selectEl.value || "").trim();
      if (before === letter) {
        return { ok: true, before, after: before };
      }

      selectEl.value = letter;
      fireChangeAndBlur(selectEl);
      await sleep(delay);

      let ok = (selectEl.value || "").trim() === letter;
      if (!ok) {
        selectEl.value = letter;
        fireChangeAndBlur(selectEl);
        await sleep(delay + 200);
        ok = (selectEl.value || "").trim() === letter;
      }
      const after = (selectEl.value || "").trim();
      return { ok, before, after };
    }

    async function clearLetter(selectEl, delay) {
      const current = (selectEl.value || "").trim();
      if (current === "") {
        return { ok: true, after: current };
      }

      selectEl.value = "";
      fireChangeAndBlur(selectEl);
      await sleep(delay);

      let ok = (selectEl.value || "").trim() === "";
      if (!ok) {
        selectEl.value = "";
        fireChangeAndBlur(selectEl);
        await sleep(delay + 200);
        ok = (selectEl.value || "").trim() === "";
      }
      const after = (selectEl.value || "").trim();
      return { ok, after };
    }

    function findMissingOption(commentSelect) {
      const opts = Array.from(commentSelect.options || []);
      for (const o of opts) { if (textOf(o) === MISSING_TEXT) return o; }
      for (const o of opts) { if (o.getAttribute("data-ismissingmark") === "true") return o; }
      return opts.find(o => (o.value || "") !== "0") || null;
    }

    function findAbsentOption(commentSelect) {
      const opts = Array.from(commentSelect.options || []);

      for (const o of opts) {
        if (textOf(o) === ABSENT_TEXT) return o;
      }

      return opts.find(
        o => textOf(o).toLowerCase() === ABSENT_TEXT.toLowerCase()
      ) || null;
    }

    function findIncompleteOption(commentSelect) {
      const opts = Array.from(commentSelect.options || []);
      for (const o of opts) { if (textOf(o) === INCOMPLETE_TEXT) return o; }
      return opts.find(o => textOf(o).toLowerCase() === "incomplete") || null;
    }

    function findLateOption(commentSelect) {
      const opts = Array.from(commentSelect.options || []);
      let exact = opts.find(o => textOf(o) === LATE_TEXT);
      if (exact) return exact;
      return opts.find(o => textOf(o).toLowerCase().startsWith("late")) || null;
    }

    function findOriginalityOption(commentSelect) {
      const opts = Array.from(commentSelect.options || []);
      let exact = opts.find(o => textOf(o) === ORIGINALITY_TEXT);
      if (exact) return exact;
      return opts.find(o => textOf(o).toLowerCase() === ORIGINALITY_TEXT.toLowerCase()) || null;
    }

    async function setCommentMissing(commentSelect, delay) {
      const beforeText = commentSelect.selectedOptions && commentSelect.selectedOptions[0]
        ? textOf(commentSelect.selectedOptions[0])
        : "";

      if (beforeText === MISSING_TEXT) {
        return { ok: true, beforeText, afterText: beforeText };
      }

      const missingOpt = findMissingOption(commentSelect);
      if (!missingOpt) return { ok: false, beforeText, afterText: beforeText };

      commentSelect.value = missingOpt.value;
      fireChangeAndBlur(commentSelect);
      await sleep(delay);

      let sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
      let ok = !!(sel && (sel.value === missingOpt.value || textOf(sel) === MISSING_TEXT));
      if (!ok) {
        commentSelect.value = missingOpt.value;
        fireChangeAndBlur(commentSelect);
        await sleep(delay + 200);
        sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
        ok = !!(sel && (sel.value === missingOpt.value || textOf(sel) === MISSING_TEXT));
      }
      const afterText = sel ? textOf(sel) : "";
      return { ok, beforeText, afterText };
    }

    async function setCommentAbsent(commentSelect, delay) {
      const beforeText =
        commentSelect.selectedOptions &&
        commentSelect.selectedOptions[0]
          ? textOf(commentSelect.selectedOptions[0])
          : "";

      if (beforeText.toLowerCase() === ABSENT_TEXT.toLowerCase()) {
        return {
          ok: true,
          beforeText,
          afterText: beforeText
        };
      }

      const absentOpt = findAbsentOption(commentSelect);

      if (!absentOpt) {
        return {
          ok: false,
          beforeText,
          afterText: beforeText
        };
      }

      commentSelect.value = absentOpt.value;
      fireChangeAndBlur(commentSelect);
      await sleep(delay);

      let sel =
        commentSelect.selectedOptions &&
        commentSelect.selectedOptions[0];

      let ok = !!(
        sel &&
        (
          sel.value === absentOpt.value ||
          textOf(sel).toLowerCase() === ABSENT_TEXT.toLowerCase()
        )
      );

      if (!ok) {
        commentSelect.value = absentOpt.value;
        fireChangeAndBlur(commentSelect);
        await sleep(delay + 200);

        sel =
          commentSelect.selectedOptions &&
          commentSelect.selectedOptions[0];

        ok = !!(
          sel &&
          (
            sel.value === absentOpt.value ||
            textOf(sel).toLowerCase() === ABSENT_TEXT.toLowerCase()
          )
        );
      }

      const afterText = sel ? textOf(sel) : "";

      return {
        ok,
        beforeText,
        afterText
      };
    }


    async function setCommentIncomplete(commentSelect, delay) {
      const beforeText = commentSelect.selectedOptions && commentSelect.selectedOptions[0]
        ? textOf(commentSelect.selectedOptions[0])
        : "";

      if (beforeText === INCOMPLETE_TEXT) {
        return { ok: true, beforeText, afterText: beforeText };
      }

      const incOpt = findIncompleteOption(commentSelect);
      if (!incOpt) return { ok: false, beforeText, afterText: beforeText };

      commentSelect.value = incOpt.value;
      fireChangeAndBlur(commentSelect);
      await sleep(delay);

      let sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
      let ok = !!(sel && (sel.value === incOpt.value || textOf(sel) === INCOMPLETE_TEXT));
      if (!ok) {
        commentSelect.value = incOpt.value;
        fireChangeAndBlur(commentSelect);
        await sleep(delay + 200);
        sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
        ok = !!(sel && (sel.value === incOpt.value || textOf(sel) === INCOMPLETE_TEXT));
      }
      const afterText = sel ? textOf(sel) : "";
      return { ok, beforeText, afterText };
    }

    async function setCommentLate(commentSelect, delay) {
      const beforeText = commentSelect.selectedOptions && commentSelect.selectedOptions[0]
        ? textOf(commentSelect.selectedOptions[0])
        : "";

      const lateOpt = findLateOption(commentSelect);
      if (!lateOpt) return { ok: false, beforeText, afterText: beforeText };

      commentSelect.value = lateOpt.value;
      fireChangeAndBlur(commentSelect);
      await sleep(delay);

      let sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
      let ok = !!(sel && (sel.value === lateOpt.value || textOf(sel).toLowerCase().startsWith("late")));
      if (!ok) {
        commentSelect.value = lateOpt.value;
        fireChangeAndBlur(commentSelect);
        await sleep(delay + 200);
        sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
        ok = !!(sel && (sel.value === lateOpt.value || textOf(sel).toLowerCase().startsWith("late")));
      }
      const afterText = sel ? textOf(sel) : "";
      return { ok, beforeText, afterText };
    }

    async function setCommentOriginality(commentSelect, delay) {
      const beforeText = commentSelect.selectedOptions && commentSelect.selectedOptions[0]
        ? textOf(commentSelect.selectedOptions[0])
        : "";

      if (beforeText === ORIGINALITY_TEXT) {
        return { ok: true, beforeText, afterText: beforeText };
      }

      const originalityOpt = findOriginalityOption(commentSelect);
      if (!originalityOpt) return { ok: false, beforeText, afterText: beforeText };

      commentSelect.value = originalityOpt.value;
      fireChangeAndBlur(commentSelect);
      await sleep(delay);

      let sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
      let ok = !!(sel && textOf(sel) === ORIGINALITY_TEXT);

      if (!ok) {
        commentSelect.value = originalityOpt.value;
        fireChangeAndBlur(commentSelect);
        await sleep(delay + 200);
        sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
        ok = !!(sel && textOf(sel) === ORIGINALITY_TEXT);
      }

      const afterText = sel ? textOf(sel) : "";
      return { ok, beforeText, afterText };
    }

    async function clearCommentIfMissing(commentSelect, delay) {
      const beforeText = commentSelect.selectedOptions && commentSelect.selectedOptions[0]
        ? textOf(commentSelect.selectedOptions[0])
        : "";

      if (beforeText !== MISSING_TEXT) {
        return { ok: true, cleared: false, beforeText, afterText: beforeText };
      }

      const opts = Array.from(commentSelect.options || []);
      const blank = opts.find(o => (o.value || "") === "0") || opts[0] || null;
      if (!blank) return { ok: false, cleared: false, beforeText, afterText: beforeText };

      commentSelect.value = blank.value;
      fireChangeAndBlur(commentSelect);
      await sleep(delay);

      let sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
      let ok = !!(sel && textOf(sel) !== MISSING_TEXT);
      if (!ok) {
        commentSelect.value = blank.value;
        fireChangeAndBlur(commentSelect);
        await sleep(delay + 200);
        sel = commentSelect.selectedOptions && commentSelect.selectedOptions[0];
        ok = !!(sel && textOf(sel) !== MISSING_TEXT);
      }
      const afterText = sel ? textOf(sel) : "";
      return { ok, cleared: ok, beforeText, afterText };
    }

    async function setPublicNote(textareaEl, note, delay) {
      const trimmed = (note || "").slice(0, NOTE_MAX);
      const before = (textareaEl.value || "");

      if (before === trimmed) {
        return { ok: true, before, after: before };
      }

      textareaEl.value = trimmed;
      fireChangeAndBlur(textareaEl);
      await sleep(delay);

      let ok = (textareaEl.value || "") === trimmed;
      if (!ok) {
        textareaEl.value = trimmed;
        fireChangeAndBlur(textareaEl);
        await sleep(delay + 200);
        ok = (textareaEl.value || "") === trimmed;
      }
      const after = (textareaEl.value || "");
      return { ok, before, after };
    }

    /*******************************
     * APPLY (ONE-PASS) — manual save
     *******************************/
    function formatLogItemHtml(item) {
      if (item.type === "notfound") return `<div class="qgm-log-err">• NOT FOUND — ${escapeHtml(item.msg)}</div>`;
      if (item.type === "dup") return `<div class="qgm-log-skip">• DUPLICATE SKIPPED — ${escapeHtml(item.msg)}</div>`;
      if (item.type === "invalid") return `<div class="qgm-log-err">• INVALID — ${escapeHtml(item.msg)}</div>`;
      return `<div class="qgm-log-skip">• ${escapeHtml(item.msg || "Skipped")}</div>`;
    }

    async function applyActionsOnePass(statusEl, statsEl) {
      const log = [];
      const statusBox = panel.querySelector("#qgm-status");
      const batchSize = getEffectiveBatchSize();

      if (!state.joinedPreview || !state.joinedPreview.length) {
        const preview = buildPreviewJoin();
        state.joinedPreview = preview.joined;
        state.previewStats = preview.stats;
      }

      let processed = 0;
      for (const item of state.joinedPreview) {
        if (item.type !== "ok") {
          log.push(formatLogItemHtml(item));
          if (statusBox) statusBox.innerHTML = log.join("");
          continue;
        }

        const a = item.action;
        try {
          if (a.kind === "letter") {
            let bits = [];
            if (a.letter) {
              if (a.needsLetter) {
                const r = await setLetter(a.rowRef.letterSel, a.letter, state.writeDelayMs);
                const from = a.currentLetter || "(blank)";
                const changed = (r.ok && r.after && r.after === a.letter && from !== a.letter)
                  ? ` <span class="qgm-mini">(changed from ${escapeHtml(from)})</span>`
                  : "";
                bits.push(r.ok ? `Letter = ${escapeHtml(a.letter)}${changed}` : `WARN: Letter might not have stuck`);
              } else {
                bits.push(`Letter = ${escapeHtml(a.letter)} (already correct)`);
              }
            }
            if (a.isLate) {
              if (a.needsLate) {
                const r = await setCommentLate(a.rowRef.commentSel, state.writeDelayMs);
                bits.push(r.ok ? `Comment "Late"` : `WARN: Late not set`);
              } else {
                bits.push(`Comment "Late" (already correct)`);
              }
            }
            if (a.noteText) {
              if (a.needsNote) {
                const r = await setPublicNote(a.rowRef.publicNote, a.noteText, state.writeDelayMs);
                bits.push(r.ok ? `Note → "${escapeHtml(a.noteText)}"` : `WARN: Note may not have stuck`);
              } else {
                bits.push(`Note already "${escapeHtml(a.noteText)}" (no change)`);
              }
            }
            if (!bits.length) bits.push("No changes needed");
            log.push(`<div class="qgm-log-ok">✓ ${bits.join(" + ")} — ${escapeHtml(a.name)}</div>`);
          } else if (a.kind === "status") {
            let bits = [];
            let okStatus = true;

            if (a.needsStatus) {
              if (a.statusText === INCOMPLETE_TEXT) {
                const cm = await setCommentIncomplete(
                  a.rowRef.commentSel,
                  state.writeDelayMs
                );
                if (!cm.ok) okStatus = false;
              } else if (a.statusText === ABSENT_TEXT) {
                const cm = await setCommentAbsent(
                  a.rowRef.commentSel,
                  state.writeDelayMs
                );
                if (!cm.ok) okStatus = false;
              } else if (a.statusText === ORIGINALITY_TEXT) {
                const cm = await setCommentOriginality(
                  a.rowRef.commentSel,
                  state.writeDelayMs
                );
                if (!cm.ok) okStatus = false;
              } else {
                const cm = await setCommentMissing(
                  a.rowRef.commentSel,
                  state.writeDelayMs
                );
                if (!cm.ok) okStatus = false;
              }
            }

            if (a.needsStatus) {
              if (!okStatus) bits.push(`WARN: ${escapeHtml(a.statusText)} may not have stuck`);
              else bits.push(`Comment "${escapeHtml(a.statusText)}"`);
            } else {
              bits.push(`Comment "${escapeHtml(a.statusText)}" (already correct)`);
            }

            if (a.noteText) {
              if (a.needsNote) {
                const r = await setPublicNote(a.rowRef.publicNote, a.noteText, state.writeDelayMs);
                bits.push(r.ok ? `Note → "${escapeHtml(a.noteText)}"` : `WARN: Note may not have stuck`);
              } else {
                bits.push(`Note already "${escapeHtml(a.noteText)}" (no change)`);
              }
            }

            log.push(`<div class="qgm-log-ok">✓ ${bits.join(" + ")} — ${escapeHtml(a.name)}</div>`);
          }
        } catch (e) {
          log.push(`<div class="qgm-log-err">! ERROR on ${escapeHtml(a.name)}: ${escapeHtml(e && e.message ? e.message : String(e))}</div>`);
        }

        if (statusBox) statusBox.innerHTML = log.join("");

        processed++;
        if (batchSize > 0 && (processed % batchSize === 0)) {
          await sleep(state.settleDelayMs);
        }
      }

      await sleep(1500);
      renderPreview(statusEl, statsEl);

      log.push(`<div class="qgm-log-skip" style="margin-top:6px;">Review your changes, then click the Synergy Save button.</div>`);
      if (statusBox) statusBox.innerHTML = log.join("");
    }

    /*******************************
     * BOOTSTRAP
     *******************************/
    function ready() {
      const haveGrid = queryGridRows().length > 0;
      if (haveGrid) {
        mountLauncher();
      } else {
        const mo = new MutationObserver(() => {
          if (queryGridRows().length > 0) {
            mo.disconnect();
            mountLauncher();
          }
        });
        mo.observe($d.documentElement, { childList: true, subtree: true });
      }
    }

    ready();
  }
})();
