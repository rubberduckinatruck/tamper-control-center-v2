// ==UserScript==
// @name         GAS File Script Exporter
// @namespace    https://tampermonkey.net/
// @version      1.2.0
// @description  Export Apps Script project files from the editor UI: real clicks, Monaco/DOM/init-data fallbacks, TT/CSP-safe, duplicate-handling, progress UI, safe guards, and optional force-.txt download mode.
// @author       you
//
// @cc-id            gas-file-script-exporter
// @cc-display-name  Google Apps Script File Exporter
// @cc-category      google-apps-script
// @cc-role          development
// @cc-status        live
// @cc-tags          google, apps script, exporter, backup, development
//
// @match        https://script.google.com/*/home/projects/*/edit
// @match        https://script.google.com/home/projects/*/edit
// @match        https://script.google.com/u/0/home/projects/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
//
// @updateURL        RAW-GITHUB-URL/scripts/google-apps-script/file-script-exporter.user.js
// @downloadURL      RAW-GITHUB-URL/scripts/google-apps-script/file-script-exporter.user.js
//
// ==/UserScript==

(function () {
  'use strict';

  // Run only in top window
  if (window.top !== window.self) return;

  // ------------------------------ Selectors ------------------------------
  const FILE_LISTBOX_SEL = 'ul[role="listbox"][aria-label="Project files"]';
  const FILE_ITEM_SEL = `${FILE_LISTBOX_SEL} > li[jsname="CmABtb"][role="option"]`;
  const FILE_NAME_DIV_SEL = '.dxw0vf';
  const MONACO_VIEWLINES_SEL = '.monaco-editor .view-lines .view-line';

  // ------------------------------ Constants ------------------------------
  const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;
  const SPECIAL_SKIP = new Set(['appsscript.json']);
  const DUP_SEP = '_v';

  const BTN_ID = 'tm-export-gas-button';
  const PANEL_ID = 'tm-export-gas-panel';
  const PROGRESS_BAR_ID = 'tm-export-gas-progress';
  const LOG_ID = 'tm-export-gas-log';
  const CONTROLS_ROW_ID = 'tm-export-gas-controls';
  const OPTIONS_ROW_ID = 'tm-export-gas-options';
  const FORCE_TXT_CHECKBOX_ID = 'tm-export-gas-force-txt';
  const FORCE_TXT_STORAGE_KEY = 'tm_gas_export_force_txt';

  // Tunables
  const TUNABLES = {
    MODEL_SWAP_TIMEOUT_MS: 3800,
    ROW_SELECT_TIMEOUT_MS: 1500,
    PRE_CLICK_DELAY_MS: 50,
    POST_CLICK_DELAY_MS: 160,
    POST_SAVE_DELAY_MS: 80,
    EMPTY_CONTENT_BACKOFF_MS: 180,
    SWEEP_STEP_FRACTION: 0.85
  };

  // Guardrail tunables
  const CLICK_RETRY_MAX = 1;
  const CLICK_RETRY_DELAY_MS = 180;
  const FINAL_DOM_RECHECK_DELAY_MS = 160;
  const MIN_MEANINGFUL_BYTES = 2;

  // ------------------------------- State ---------------------------------
  unsafeWindow.__GAS_EXPORTER_STATE__ = { stopRequested: false };

  // ------------------------------ Utilities ------------------------------
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  function sanitize(name) {
    return String(name).replace(ILLEGAL_CHARS, '_').trim();
  }

  function stripExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
  }

  function getExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1) : 'txt';
  }

  function ensureExtension(name, ext) {
    return /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.${ext || 'txt'}`;
  }

  function inferExtByName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    if (m) return m[1].toLowerCase();
    const lower = (name || '').toLowerCase();
    if (lower.includes('html')) return 'html';
    if (lower.includes('gs') || lower.includes('code')) return 'gs';
    return 'txt';
  }

  function nextAvailableStem(baseStem, map) {
    const prev = map.get(baseStem) || 0;
    if (prev === 0) {
      map.set(baseStem, 1);
      return baseStem;
    }
    const next = prev + 1;
    map.set(baseStem, next);
    return `${baseStem}${DUP_SEP}${next}`;
  }

  function getProjectIdFromUrl(href = location.href) {
    try {
      const m = href.match(/\/home\/projects\/([^/]+)\/edit/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch {
      return '';
    }
  }

  function getForceTxtSetting() {
    try {
      return localStorage.getItem(FORCE_TXT_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setForceTxtSetting(value) {
    try {
      localStorage.setItem(FORCE_TXT_STORAGE_KEY, value ? '1' : '0');
    } catch {}
  }

  function isForceTxtEnabled() {
    const cb = document.getElementById(FORCE_TXT_CHECKBOX_ID);
    return cb ? !!cb.checked : getForceTxtSetting();
  }

  // ------------------------------- Panel ---------------------------------
  function createPanelIfMissing() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      width: '360px',
      maxHeight: '62vh',
      background: '#121212',
      color: '#eaeaea',
      border: '1px solid #2a2a2a',
      borderRadius: '12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      fontFamily: 'ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial',
      zIndex: '2147483647',
      overflow: 'hidden'
    });

    const hdr = document.createElement('div');
    hdr.className = 'hdr';
    Object.assign(hdr.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      padding: '10px 12px',
      fontWeight: 600,
      fontSize: '13px',
      borderBottom: '1px solid #2a2a2a'
    });

    const hdrLeft = document.createElement('div');
    hdrLeft.className = 'left';
    const title = document.createElement('span');
    title.textContent = 'Apps Script Export';
    const sub = document.createElement('span');
    sub.style.opacity = '0.8';
    sub.style.marginLeft = '6px';
    sub.textContent = '';
    hdrLeft.append(title, sub);

    const hdrRight = document.createElement('div');
    hdrRight.className = 'right';
    const exportBtn = document.createElement('button');
    exportBtn.id = BTN_ID;
    exportBtn.type = 'button';
    exportBtn.textContent = 'Export files';
    Object.assign(exportBtn.style, {
      all: 'unset',
      cursor: 'pointer',
      background: '#1f1f1f',
      color: '#ddd',
      padding: '6px 10px',
      borderRadius: '8px',
      fontSize: '12px',
      fontWeight: 600
    });
    exportBtn.addEventListener('mouseenter', () => {
      exportBtn.style.background = '#262626';
    }, { passive: true });
    exportBtn.addEventListener('mouseleave', () => {
      exportBtn.style.background = '#1f1f1f';
    }, { passive: true });
    hdrRight.appendChild(exportBtn);
    hdr.append(hdrLeft, hdrRight);

    const prog = Object.assign(document.createElement('progress'), {
      id: PROGRESS_BAR_ID,
      max: 100,
      value: 0
    });
    prog.style.cssText = 'width:calc(100% - 24px);margin:10px 12px 6px;';

    const counts = document.createElement('div');
    counts.className = 'counts';
    Object.assign(counts.style, {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '12px',
      opacity: '.85',
      padding: '0 12px 8px'
    });
    const left = document.createElement('span');
    left.setAttribute('data-role', 'left');
    left.textContent = '0 of 0';
    const right = document.createElement('span');
    right.setAttribute('data-role', 'right');
    right.textContent = '+0 • -0 • x0';
    counts.append(left, right);

    const optionsRow = document.createElement('div');
    optionsRow.id = OPTIONS_ROW_ID;
    Object.assign(optionsRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 12px 10px',
      borderTop: '1px solid transparent',
      borderBottom: '1px solid #222',
      fontSize: '12px',
      background: '#101010'
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = FORCE_TXT_CHECKBOX_ID;
    checkbox.checked = getForceTxtSetting();
    checkbox.style.cursor = 'pointer';

    const checkboxLabel = document.createElement('label');
    checkboxLabel.setAttribute('for', FORCE_TXT_CHECKBOX_ID);
    checkboxLabel.textContent = 'Force all downloads to .txt';
    Object.assign(checkboxLabel.style, {
      cursor: 'pointer',
      userSelect: 'none',
      color: '#ddd'
    });

    const optionNote = document.createElement('span');
    optionNote.textContent = '(unchecked = keep original extensions)';
    Object.assign(optionNote.style, {
      opacity: '0.7',
      fontSize: '11px'
    });

    checkbox.addEventListener('change', () => {
      setForceTxtSetting(checkbox.checked);
      logLine(`[•] Option updated: ${checkbox.checked ? 'Force .txt = ON' : 'Force .txt = OFF'}`);
    }, { passive: true });

    optionsRow.append(checkbox, checkboxLabel, optionNote);

    const log = document.createElement('div');
    log.id = LOG_ID;
    Object.assign(log.style, {
      padding: '8px 12px 12px',
      overflow: 'auto',
      maxHeight: '34vh',
      fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
      fontSize: '12px',
      lineHeight: '1.45',
      whiteSpace: 'pre-wrap'
    });

    panel.append(hdr, prog, counts, optionsRow, log);
    document.body.appendChild(panel);

    ensureControls();
    return panel;
  }

  function showPanel(v) {
    createPanelIfMissing().style.display = v ? 'block' : 'none';
  }

  function setHeaderProjectId(id) {
    const sub = document.querySelector(`#${PANEL_ID} .hdr .left span:nth-child(2)`);
    if (sub) sub.textContent = id ? `— Project: ${id}` : '';
  }

  function setCounts({ total, done, skipped, failed }) {
    const left = document.querySelector(`#${PANEL_ID} .counts [data-role="left"]`);
    const right = document.querySelector(`#${PANEL_ID} .counts [data-role="right"]`);
    if (left) left.textContent = `${Math.min(done + skipped + failed, total)} of ${total}`;
    if (right) right.textContent = `+${done} • -${skipped} • x${failed}`;
  }

  function setProgress(curr, total) {
    const bar = document.getElementById(PROGRESS_BAR_ID);
    if (!bar) return;
    const pct = total > 0 ? Math.round((curr / total) * 100) : 0;
    bar.max = 100;
    bar.value = pct;
  }

  function clearLog() {
    const el = document.getElementById(LOG_ID);
    if (el) el.textContent = '';
  }

  function logLine(text) {
    const el = document.getElementById(LOG_ID);
    if (!el) return;
    el.appendChild(document.createTextNode(`${text}\n`));
    el.scrollTop = el.scrollHeight;
  }

  function ensureControls() {
    const panel = createPanelIfMissing();
    if (!panel || document.getElementById(CONTROLS_ROW_ID)) return panel;

    const row = document.createElement('div');
    row.id = CONTROLS_ROW_ID;
    Object.assign(row.style, {
      display: 'flex',
      gap: '8px',
      padding: '8px 12px',
      borderTop: '1px solid #2a2a2a',
      background: '#0f0f0f'
    });

    const mkBtn = (label, handler) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, {
        all: 'unset',
        cursor: 'pointer',
        background: '#1f1f1f',
        color: '#ddd',
        padding: '6px 10px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: 600
      });
      b.addEventListener('mouseenter', () => {
        b.style.background = '#262626';
      }, { passive: true });
      b.addEventListener('mouseleave', () => {
        b.style.background = '#1f1f1f';
      }, { passive: true });
      b.addEventListener('click', handler, { passive: true });
      return b;
    };

    const stopBtn = mkBtn('Stop', () => {
      unsafeWindow.__GAS_EXPORTER_STATE__.stopRequested = true;
      logLine('[!] Stop requested by user.');
    });
    const clearBtn = mkBtn('Clear log', clearLog);
    const hideBtn = mkBtn('Hide', () => {
      panel.style.display = 'none';
    });

    row.append(stopBtn, clearBtn, hideBtn);
    panel.appendChild(row);
    return panel;
  }

  // ------------------------------ Real Click ------------------------------
  function realClick(el) {
    if (!el) return false;
    const win = unsafeWindow || window;
    const r = el.getBoundingClientRect();
    const x = Math.floor(r.left + Math.max(1, r.width * 0.5));
    const y = Math.floor(r.top + Math.max(1, r.height * 0.5));
    const opts = { view: win, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1 };

    try {
      if (typeof win.PointerEvent === 'function') {
        el.dispatchEvent(new win.PointerEvent('pointerdown', opts));
      }
    } catch {}

    el.dispatchEvent(new win.MouseEvent('mousedown', opts));
    el.dispatchEvent(new win.MouseEvent('mouseup', opts));
    el.dispatchEvent(new win.MouseEvent('click', opts));
    return true;
  }

  // ----------------------------- Monaco Helpers --------------------------
  async function getMonaco() {
    if (unsafeWindow.monaco?.editor) return unsafeWindow.monaco;
    if (window.monaco?.editor) return window.monaco;

    if (typeof unsafeWindow.require === 'function') {
      try {
        const monaco = await new Promise((resolve, reject) => {
          unsafeWindow.require(
            ['vs/editor/editor.main'],
            () => resolve(unsafeWindow.monaco || window.monaco),
            reject
          );
        });
        if (monaco?.editor) return monaco;
      } catch {}
    }

    const t0 = performance.now();
    while (performance.now() - t0 < 2000) {
      if (unsafeWindow.monaco?.editor) return unsafeWindow.monaco;
      if (window.monaco?.editor) return window.monaco;
      await sleep(100);
    }

    return { editor: {} };
  }

  function getActiveEditor(monaco) {
    try {
      const eds = monaco?.editor?.getEditors?.() || [];
      return eds.find((e) => e.hasTextFocus?.()) || eds[0] || null;
    } catch {
      return null;
    }
  }

  function getActiveModel(monaco) {
    try {
      return getActiveEditor(monaco)?.getModel?.() || null;
    } catch {
      return null;
    }
  }

  function getActiveModelSnapshot(monaco) {
    const m = getActiveModel(monaco);
    if (!m) return { uri: '', ver: -1, len: 0 };
    const uri = String(m.uri || '');
    const ver = typeof m.getVersionId === 'function' ? m.getVersionId() : -1;
    const len = typeof m.getValue === 'function' ? m.getValue().length || 0 : 0;
    return { uri, ver, len };
  }

  async function waitForModelChangeAndGetValue(monaco, prevSnapshot, timeoutMs = 3200) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const m = getActiveModel(monaco);
      if (m) {
        const uri = String(m.uri || '');
        const ver = typeof m.getVersionId === 'function' ? m.getVersionId() : -1;
        const val = typeof m.getValue === 'function' ? m.getValue() : '';
        const changed =
          (uri && uri !== prevSnapshot.uri) ||
          ver !== prevSnapshot.ver ||
          (val && val.length !== prevSnapshot.len);

        if (changed && val && val.length) return val;
      }
      await sleep(80);
    }

    const m = getActiveModel(monaco);
    return m?.getValue?.() || '';
  }

  // ------------------------------ DOM Fallback ----------------------------
  function readFromViewLines() {
    try {
      const nodes = document.querySelectorAll(MONACO_VIEWLINES_SEL);
      if (!nodes.length) return '';
      const out = [];
      nodes.forEach((n) => out.push(n.textContent || ''));
      return out.join('\n');
    } catch {
      return '';
    }
  }

  // -------------------------- Virtualization Sweep -----------------------
  async function revealAllListItems(listbox, initialItems) {
    const seen = new Set(initialItems ? Array.from(initialItems) : []);
    const collect = () => document.querySelectorAll(FILE_ITEM_SEL).forEach((li) => seen.add(li));

    collect();

    if (!listbox || listbox.scrollHeight <= listbox.clientHeight + 8) {
      return Array.from(seen);
    }

    listbox.scrollTop = 0;
    await sleep(80);
    collect();

    const stepDown = Math.max(140, Math.floor(listbox.clientHeight * TUNABLES.SWEEP_STEP_FRACTION));
    const maxDownSteps = Math.ceil(listbox.scrollHeight / stepDown + 4);

    for (let i = 0; i < maxDownSteps; i++) {
      listbox.scrollTop = Math.min(listbox.scrollTop + stepDown, listbox.scrollHeight);
      await sleep(110);
      collect();
      if (listbox.scrollTop + listbox.clientHeight >= listbox.scrollHeight - 2) break;
    }

    const maxUpSteps = maxDownSteps;
    for (let i = 0; i < maxUpSteps; i++) {
      listbox.scrollTop = Math.max(listbox.scrollTop - stepDown, 0);
      await sleep(110);
      collect();
      if (listbox.scrollTop <= 1) break;
    }

    listbox.scrollTop = Math.max(0, Math.floor((listbox.scrollHeight - listbox.clientHeight) / 2));
    await sleep(100);
    collect();

    return Array.from(seen);
  }

  // ------------------------ AF_initDataCallback Fallback ------------------
  function tryParseInitFiles() {
    const out = [];
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        if (!t || !t.includes('AF_initDataCallback') || !t.includes('"files"')) continue;

        const match = /"files"\s*:\s*(\[[\s\S]*?\])/.exec(t);
        if (!match) continue;

        let jsonish = match[1];
        jsonish = jsonish.replace(/,\s*([\]\}])/g, '$1');

        try {
          const arr = JSON.parse(jsonish);
          if (Array.isArray(arr)) {
            for (const f of arr) {
              if (!f || typeof f.name !== 'string') continue;
              const name = String(f.name);
              const type = typeof f.type === 'string' ? f.type : '';
              const source = typeof f.source === 'string' ? f.source : '';
              out.push({ name, type, source });
            }
            if (out.length) return out;
          }
        } catch {
          const rx = /"name"\s*:\s*"([^"]+)"[\s\S]*?"source"\s*:\s*"([\s\S]*?)"/g;
          let m;
          while ((m = rx.exec(match[1]))) {
            const name = m[1];
            const raw = m[2];
            out.push({ name, type: '', source: unescapeJSONString(raw) });
          }
          if (out.length) return out;
        }
      }
    } catch {}

    return out;
  }

  function unescapeJSONString(s) {
    try {
      const wrapped = `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      return JSON.parse(wrapped);
    } catch {
      return s
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }

  function getSourceFromInitData(targetName) {
    if (!targetName) return '';
    const files = tryParseInitFiles();
    if (!files.length) return '';
    const want = targetName.trim().toLowerCase();
    const hit = files.find((f) => (f.name || '').trim().toLowerCase() === want);
    return hit && typeof hit.source === 'string' ? hit.source : '';
  }

  async function getFileTextWithFallbacks({ monaco, prevSnapshot, filename, waitTimeoutMs = 3200 }) {
    let text = '';

    try {
      text = await waitForModelChangeAndGetValue(monaco, prevSnapshot, waitTimeoutMs);
    } catch {}

    if (!text || !text.trim()) {
      text = readFromViewLines();
    }

    if (!text || !text.trim()) {
      text = getSourceFromInitData(filename) || '';
    }

    return text || '';
  }

  // ------------------------ Content Meaningfulness -----------------------
  function normalizeWhitespace(s) {
    return (s || '').replace(/\r\n/g, '\n').replace(/\t/g, ' ');
  }

  function stripComments(ext, text) {
    const t = String(text ?? '');
    if (!t) return t;

    if (ext === 'js' || ext === 'gs') {
      return t
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1');
    }

    if (ext === 'html' || ext === 'htm') {
      return t.replace(/<!--[\s\S]*?-->/g, '');
    }

    return t
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1');
  }

  function isMeaningfulContent(text, extGuess) {
    if (!text) return false;
    if (text.length < MIN_MEANINGFUL_BYTES) return /\S/.test(text);

    const normalized = normalizeWhitespace(text);
    if (!/\S/.test(normalized)) return false;

    const stripped = stripComments(extGuess, normalized);
    if (!/\S/.test(stripped)) return false;

    if (extGuess === 'html' || extGuess === 'htm') {
      const noTags = stripped.replace(/<[^>]+>/g, '').trim();
      if (!noTags) return false;
    }

    return true;
  }

  // ------------------------------ Download -------------------------------
  function triggerDownload(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.rel = 'noopener';
    a.download = filename;
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ------------------------------ Selection ------------------------------
  async function waitForSelected(li, timeoutMs = TUNABLES.ROW_SELECT_TIMEOUT_MS) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      if (li.getAttribute('aria-selected') === 'true') return true;
      await sleep(40);
    }
    return false;
  }

  // ------------------------------- Export --------------------------------
  async function runExport() {
    try {
      createPanelIfMissing();
      showPanel(true);
      clearLog();

      const scriptId = getProjectIdFromUrl(location.href);
      const forceTxt = isForceTxtEnabled();

      setHeaderProjectId(scriptId);
      logLine('[•] Starting export…');

      const projectNamePrompt = prompt('Enter a Project Name for filenames (e.g., cellphone):', '');
      if (!projectNamePrompt) return;

      const safeProjectName = sanitize(projectNamePrompt.trim());
      if (!safeProjectName) {
        alert('Project Name cannot be empty.');
        return;
      }

      logLine(`[•] Project Name: ${safeProjectName}`);
      logLine(`[•] Download mode: ${forceTxt ? 'All files forced to .txt' : 'Original file extensions'}`);

      const listbox = document.querySelector(FILE_LISTBOX_SEL);
      if (!listbox) {
        logLine('[x] Could not find the Files list.');
        return;
      }

      let rows = Array.from(document.querySelectorAll(FILE_ITEM_SEL));
      rows = await revealAllListItems(listbox, rows);

      const files = rows
        .map((li, idx) => {
          const nameEl = li.querySelector(FILE_NAME_DIV_SEL);
          const visibleName = (nameEl?.getAttribute('title') || nameEl?.textContent || '').trim();
          const ariaName = (li.getAttribute('aria-label') || '').trim();
          const name = (visibleName || ariaName || `file_${idx + 1}`).trim();
          return { li, name, nameEl: nameEl || li };
        })
        .filter((f) => !SPECIAL_SKIP.has((f.name || '').trim().toLowerCase()));

      const total = files.length;
      if (!total) {
        logLine('[!] No exportable files found.');
        return;
      }

      let done = 0;
      let skipped = 0;
      let failed = 0;

      setCounts({ total, done, skipped, failed });
      setProgress(0, total);

      const monaco = await getMonaco();
      const dupMap = new Map();
      unsafeWindow.__GAS_EXPORTER_STATE__.stopRequested = false;

      for (let i = 0; i < total; i++) {
        if (unsafeWindow.__GAS_EXPORTER_STATE__.stopRequested) {
          logLine(`[!] Stopped after ${i} of ${total}.`);
          break;
        }

        const { li, name, nameEl } = files[i];

        try {
          await sleep(TUNABLES.PRE_CLICK_DELAY_MS);
          li.scrollIntoView({ block: 'center' });
          li.focus({ preventScroll: true });

          const prev = getActiveModelSnapshot(monaco);
          const clicked = realClick(nameEl);
          if (!clicked) throw new Error('realClick failed');

          await waitForSelected(li, TUNABLES.ROW_SELECT_TIMEOUT_MS);

          let content = await getFileTextWithFallbacks({
            monaco,
            prevSnapshot: prev,
            filename: name,
            waitTimeoutMs: TUNABLES.MODEL_SWAP_TIMEOUT_MS
          });

          const extGuess = inferExtByName(name);

          if (!isMeaningfulContent(content, extGuess)) {
            for (let r = 0; r < CLICK_RETRY_MAX; r++) {
              await sleep(CLICK_RETRY_DELAY_MS);
              li.scrollIntoView({ block: 'center' });
              li.focus({ preventScroll: true });
              realClick(nameEl);

              const snap2 = getActiveModelSnapshot(monaco);
              content = await getFileTextWithFallbacks({
                monaco,
                prevSnapshot: snap2,
                filename: name,
                waitTimeoutMs: Math.max(900, Math.floor(TUNABLES.MODEL_SWAP_TIMEOUT_MS * 0.4))
              });

              if (isMeaningfulContent(content, extGuess)) break;
            }

            if (!isMeaningfulContent(content, extGuess)) {
              await sleep(FINAL_DOM_RECHECK_DELAY_MS);
              const domLast = readFromViewLines();
              if (isMeaningfulContent(domLast, extGuess)) content = domLast;
            }
          }

          if (!isMeaningfulContent(content, extGuess)) {
            skipped++;
            logLine(`[–] Skipped (no content): ${name} (${i + 1} of ${total})`);
            setCounts({ total, done, skipped, failed });
            setProgress(done + skipped + failed, total);
            await sleep(TUNABLES.POST_CLICK_DELAY_MS);
            continue;
          }

          const safeOriginal = sanitize(name);
          const originalExt = inferExtByName(safeOriginal);
          const chosenExt = forceTxt ? 'txt' : originalExt;
          const withExt = ensureExtension(safeOriginal, chosenExt);
          const baseStem = `${safeProjectName}_${stripExtension(withExt)}`;
          const finalStem = nextAvailableStem(baseStem, dupMap);
          const finalName = `${finalStem}.${chosenExt}`;

          triggerDownload(content, finalName);
          done++;
          logLine(`[✔] Saved: ${finalName} (${i + 1} of ${total})`);
          setCounts({ total, done, skipped, failed });
          setProgress(done + skipped + failed, total);

          await sleep(TUNABLES.POST_SAVE_DELAY_MS);
        } catch (err) {
          failed++;
          logLine(`[x] Failed (${i + 1} of ${total}): ${name} — ${err && err.message ? err.message : err}`);
          setCounts({ total, done, skipped, failed });
          setProgress(done + skipped + failed, total);
        } finally {
          await sleep(TUNABLES.POST_CLICK_DELAY_MS);
        }
      }

      logLine(`\n[=] Finished. Exported: ${done}, Skipped: ${skipped}, Failed: ${failed}.`);
    } catch (err) {
      console.error(err);
      alert(`Export failed: ${err && err.message ? err.message : err}`);
    }
  }

  // ----------------------- Button Binding + Shortcut ----------------------
  function bindExportButton() {
    createPanelIfMissing();
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    const clone = btn.cloneNode(true);
    clone.addEventListener('click', runExport, { passive: true });
    btn.replaceWith(clone);
  }

  bindExportButton();

  // Debounced rebinder to avoid noisy rebind loops during Google’s startup
  let rebindTimer;
  const rebinder = new MutationObserver(() => {
    clearTimeout(rebindTimer);
    rebindTimer = setTimeout(bindExportButton, 200);
  });
  rebinder.observe(document.documentElement, { childList: true, subtree: true });

  // Keyboard shortcut: Ctrl+Alt+E
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey && e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        runExport();
      }
    },
    { passive: false }
  );
})();