// ==UserScript==
// @name             GAS Hidden Character Checker
// @namespace        https://github.com/g-tools
// @version          1.1.0
// @description      Detects smart quotes, non-breaking spaces, zero-width characters, and other lookalike symbols that break Apps Script code but look normal to the eye. Rebuilt with pure DOM APIs to survive Trusted Types / CSP enforcement on script.google.com.
// @author           Big Poppa

//
// @cc-id            apps-script-hidden-character-checker
// @cc-display-name  Apps Script Hidden Character Checker
// @cc-category      google-apps-script
// @cc-role          development
// @cc-status        live
// @cc-tags          google, apps script, hidden characters, code checking, debugging
//
// @match            https://script.google.com/*
// @grant            GM_addStyle
// @grant            GM_setClipboard
// @run-at           document-idle
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gas/apps-script-hidden-character-checker.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gas/apps-script-hidden-character-checker.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 0. Tiny DOM builder helper (avoids innerHTML entirely -> no Trusted
  //    Types violations on pages that enforce requireTrustedTypesFor).
  // ---------------------------------------------------------------------
  function h(tag, attrs, children) {
    const e = document.createElement(tag);
    attrs = attrs || {};
    for (const k in attrs) {
      const v = attrs[k];
      if (k === 'style' && typeof v === 'object') {
        Object.assign(e.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        e.addEventListener(k.slice(2), v);
      } else if (k === 'class') {
        e.className = v;
      } else if (v !== undefined && v !== null) {
        e.setAttribute(k, v);
      }
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ---------------------------------------------------------------------
  // 1. Character definitions
  // ---------------------------------------------------------------------
  const SUSPICIOUS = [
    { char: '\u2018', name: 'Left single smart quote', replacement: "'", category: 'quote' },
    { char: '\u2019', name: 'Right single smart quote (curly apostrophe)', replacement: "'", category: 'quote' },
    { char: '\u201C', name: 'Left double smart quote', replacement: '"', category: 'quote' },
    { char: '\u201D', name: 'Right double smart quote', replacement: '"', category: 'quote' },
    { char: '\u2032', name: 'Prime mark', replacement: "'", category: 'quote' },
    { char: '\u2033', name: 'Double prime mark', replacement: '"', category: 'quote' },

    { char: '\u2013', name: 'En dash', replacement: '-', category: 'dash' },
    { char: '\u2014', name: 'Em dash', replacement: '-', category: 'dash' },
    { char: '\u2212', name: 'Minus sign (not hyphen)', replacement: '-', category: 'dash' },

    { char: '\u2026', name: 'Ellipsis character (single glyph, not 3 dots)', replacement: '...', category: 'other' },
    { char: '\u2022', name: 'Bullet character', replacement: '*', category: 'other' },
    { char: '\u00B7', name: 'Middle dot', replacement: '.', category: 'other' },

    { char: '\u00A0', name: 'Non-breaking space', replacement: ' ', category: 'space' },
    { char: '\u202F', name: 'Narrow no-break space', replacement: ' ', category: 'space' },
    { char: '\u2000', name: 'En quad space', replacement: ' ', category: 'space' },
    { char: '\u2001', name: 'Em quad space', replacement: ' ', category: 'space' },
    { char: '\u2002', name: 'En space', replacement: ' ', category: 'space' },
    { char: '\u2003', name: 'Em space', replacement: ' ', category: 'space' },
    { char: '\u2004', name: 'Three-per-em space', replacement: ' ', category: 'space' },
    { char: '\u2005', name: 'Four-per-em space', replacement: ' ', category: 'space' },
    { char: '\u2006', name: 'Six-per-em space', replacement: ' ', category: 'space' },
    { char: '\u2007', name: 'Figure space', replacement: ' ', category: 'space' },
    { char: '\u2008', name: 'Punctuation space', replacement: ' ', category: 'space' },
    { char: '\u2009', name: 'Thin space', replacement: ' ', category: 'space' },
    { char: '\u200A', name: 'Hair space', replacement: ' ', category: 'space' },
    { char: '\u3000', name: 'Ideographic (full-width) space', replacement: ' ', category: 'space' },

    { char: '\u200B', name: 'Zero-width space', replacement: '', category: 'invisible' },
    { char: '\u200C', name: 'Zero-width non-joiner', replacement: '', category: 'invisible' },
    { char: '\u200D', name: 'Zero-width joiner', replacement: '', category: 'invisible' },
    { char: '\u2060', name: 'Word joiner', replacement: '', category: 'invisible' },
    { char: '\uFEFF', name: 'Byte order mark / zero-width no-break space', replacement: '', category: 'invisible' },
    { char: '\u00AD', name: 'Soft hyphen (invisible unless line wraps)', replacement: '', category: 'invisible' },
  ];

  const LOOKUP = new Map(SUSPICIOUS.map((s) => [s.char, s]));
  const CATEGORY_COLOR = {
    quote: '#ffd54a',
    dash: '#ff9e6d',
    space: '#7ec8ff',
    invisible: '#ff6d6d',
    other: '#c99bff',
    ascii_lookalike: '#8bd17c',
  };

  // ---------------------------------------------------------------------
  // 2. Styles
  // ---------------------------------------------------------------------
  GM_addStyle(`
    #asc-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      background: #1a73e8; color: #fff; border: none; border-radius: 24px;
      padding: 12px 18px; font: 600 13px/1 Arial, sans-serif; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.3);
    }
    #asc-fab:hover { background: #1558b3; }
    #asc-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1000000;
      display: flex; align-items: center; justify-content: center;
    }
    #asc-modal {
      background: #fff; width: 90%; max-width: 900px; max-height: 88vh;
      border-radius: 10px; padding: 20px; overflow-y: auto;
      font: 13px/1.4 Arial, sans-serif; color: #202124;
      display: flex; flex-direction: column; gap: 12px; position: relative;
    }
    #asc-modal h2 { margin: 0 0 4px; font-size: 17px; }
    #asc-modal .asc-sub { color: #5f6368; margin: 0 0 8px; }
    #asc-input {
      width: 100%; height: 160px; font-family: 'Courier New', monospace;
      font-size: 12px; box-sizing: border-box; padding: 8px;
      border: 1px solid #dadce0; border-radius: 6px; resize: vertical;
    }
    .asc-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .asc-btn {
      background: #1a73e8; color: #fff; border: none; border-radius: 6px;
      padding: 8px 14px; cursor: pointer; font: 600 12px/1 Arial, sans-serif;
    }
    .asc-btn.secondary { background: #f1f3f4; color: #202124; }
    .asc-btn:hover { opacity: .9; }
    #asc-highlight {
      border: 1px solid #dadce0; border-radius: 6px; padding: 10px;
      font-family: 'Courier New', monospace; font-size: 12px;
      white-space: pre-wrap; word-break: break-word; max-height: 220px;
      overflow-y: auto; background: #fafafa;
    }
    #asc-summary table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #asc-summary th, #asc-summary td {
      text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee;
    }
    #asc-summary th { background: #f8f9fa; }
    .asc-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
    #asc-close {
      position: absolute; top: 14px; right: 18px; cursor: pointer;
      font-size: 20px; color: #5f6368; background: none; border: none;
    }
    #asc-toast {
      position: fixed; bottom: 70px; right: 24px; background: #323232; color: #fff;
      padding: 8px 14px; border-radius: 6px; font: 12px Arial, sans-serif;
      z-index: 1000001; opacity: 0; transition: opacity .2s;
    }
  `);

  // ---------------------------------------------------------------------
  // 3. Scanning logic -> builds a DocumentFragment of real DOM nodes
  //    (no innerHTML anywhere, so Trusted Types can't block it)
  // ---------------------------------------------------------------------
  function scanText(text) {
    const summary = new Map();
    let line = 1;
    let col = 1;
    const frag = document.createDocumentFragment();

    for (const ch of text) {
      const code = ch.codePointAt(0);
      let entry = LOOKUP.get(ch);

      const isKnown = !!entry;
      const isPlainAscii = code < 128;
      const isEmojiRange = code >= 0x1F000;

      if (!isKnown && !isPlainAscii && !isEmojiRange && ch !== '\n' && ch !== '\t') {
        entry = {
          name: `Non-ASCII character (possible homoglyph): U+${code.toString(16).toUpperCase().padStart(4, '0')}`,
          replacement: null,
          category: 'ascii_lookalike',
        };
      }

      if (entry) {
        const key = entry.name;
        if (!summary.has(key)) {
          summary.set(key, {
            char: ch,
            codepoint: code,
            count: 0,
            locations: [],
            category: entry.category,
            replacement: entry.replacement,
          });
        }
        const rec = summary.get(key);
        rec.count++;
        if (rec.locations.length < 25) rec.locations.push(`${line}:${col}`);

        const color = CATEGORY_COLOR[entry.category] || '#ccc';
        const isInvisible = /[\u2000-\u200F\uFEFF\u00AD]/.test(ch);
        const visibleGlyph = isInvisible ? '\u00B7' : ch;
        const cpLabel = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
        frag.appendChild(
          h('mark', {
            title: `${entry.name} (${cpLabel})`,
            style: { background: color, borderRadius: '2px', padding: '0 1px' },
          }, [visibleGlyph])
        );
      } else {
        frag.appendChild(document.createTextNode(ch));
      }

      if (ch === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }

    return { frag, summary };
  }

  function buildSummaryTable(summary) {
    if (summary.size === 0) {
      return h('p', { style: { color: '#188038', fontWeight: '600' } }, [
        '\u2713 No smart quotes, hidden characters, or lookalikes found.',
      ]);
    }
    const rows = [...summary.entries()].sort((a, b) => b[1].count - a[1].count);
    const tbody = h('tbody', {}, rows.map(([name, rec]) => {
      const color = CATEGORY_COLOR[rec.category] || '#ccc';
      const cp = `U+${rec.codepoint.toString(16).toUpperCase().padStart(4, '0')}`;
      const locs = rec.locations.join(', ') + (rec.count > rec.locations.length ? ', \u2026' : '');
      return h('tr', {}, [
        h('td', {}, [
          h('span', { class: 'asc-swatch', style: { background: color } }, []),
          name,
        ]),
        h('td', {}, [cp]),
        h('td', {}, [String(rec.count)]),
        h('td', { style: { fontFamily: 'monospace' } }, [locs]),
      ]);
    }));
    const thead = h('thead', {}, [
      h('tr', {}, [
        h('th', {}, ['Issue']),
        h('th', {}, ['Codepoint']),
        h('th', {}, ['Count']),
        h('th', {}, ['Locations (line:col)']),
      ]),
    ]);
    return h('table', {}, [thead, tbody]);
  }

  function cleanText(text) {
    let out = '';
    for (const ch of text) {
      const entry = LOOKUP.get(ch);
      if (entry && entry.replacement !== null && entry.replacement !== undefined) {
        out += entry.replacement;
      } else {
        out += ch;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // 4. UI
  // ---------------------------------------------------------------------
  function showToast(msg) {
    let toast = document.getElementById('asc-toast');
    if (!toast) {
      toast = h('div', { id: 'asc-toast' }, []);
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => (toast.style.opacity = '0'), 1800);
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function openModal() {
    const input = h('textarea', { id: 'asc-input', placeholder: 'Paste your code here (Ctrl+V)\u2026' }, []);
    const highlightBox = h('div', { id: 'asc-highlight' }, [
      h('em', { style: { color: '#999' } }, ['Highlighted view will appear here after scanning.']),
    ]);
    const summaryBox = h('div', { id: 'asc-summary' }, []);

    const closeBtn = h('button', { id: 'asc-close', title: 'Close', onclick: () => overlay.remove() }, ['\u2715']);
    const scanBtn = h('button', { class: 'asc-btn' }, ['Scan']);
    const cleanBtn = h('button', { class: 'asc-btn secondary' }, ['Copy Cleaned Code']);

    function runScan() {
      const text = input.value;
      clearNode(highlightBox);
      clearNode(summaryBox);
      if (!text) {
        highlightBox.appendChild(h('em', { style: { color: '#999' } }, ['Paste some code first.']));
        return;
      }
      const { frag, summary } = scanText(text);
      highlightBox.appendChild(frag);
      summaryBox.appendChild(buildSummaryTable(summary));
    }

    scanBtn.addEventListener('click', runScan);
    input.addEventListener('paste', () => setTimeout(runScan, 30));
    cleanBtn.addEventListener('click', () => {
      if (!input.value) {
        showToast('Nothing to clean \u2014 paste code first.');
        return;
      }
      GM_setClipboard(cleanText(input.value), 'text');
      showToast('Cleaned code copied to clipboard!');
    });

    const modal = h('div', { id: 'asc-modal' }, [
      closeBtn,
      h('h2', {}, ['Hidden Character Checker']),
      h('p', { class: 'asc-sub' }, [
        'Paste your Apps Script code below, then click Scan. Suspicious characters get highlighted and listed with exact line:column locations.',
      ]),
      input,
      h('div', { class: 'asc-row' }, [scanBtn, cleanBtn]),
      highlightBox,
      summaryBox,
    ]);

    var overlay = h('div', { id: 'asc-overlay' }, [modal]);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  // ---------------------------------------------------------------------
  // 5. Floating launcher button
  // ---------------------------------------------------------------------
  function addFab() {
    if (document.getElementById('asc-fab')) return;
    const btn = h('button', { id: 'asc-fab', onclick: openModal }, ['\uD83D\uDD0D Check Hidden Chars']);
    document.body.appendChild(btn);
  }

  addFab();
  new MutationObserver(addFab).observe(document.body, { childList: true, subtree: false });
})();