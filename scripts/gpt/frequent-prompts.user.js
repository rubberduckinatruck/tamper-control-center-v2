// ==UserScript==
// @name             Frequent Prompts (ChatGPT / Claude / Gemini)
// @namespace        https://tampermonkey.net/
// @version          1.0.2
// @description      Floating button + panel to save and instantly reuse your frequent prompts on ChatGPT, Claude, and Gemini.
// @author           Big Poppa
//
// @cc-id            frequent-prompts
// @cc-display-name  Frequent AI Prompts
// @cc-category      gpt
// @cc-role          personal
// @cc-status        live
// @cc-tags          chatgpt, claude, gemini, prompts, productivity
//
// @match            https://chatgpt.com/*
// @match            https://chat.openai.com/*
// @match            https://claude.ai/*
// @match            https://gemini.google.com/*
// @grant            GM_getValue
// @grant            GM_setValue
// @grant            GM_registerMenuCommand
// @run-at           document-idle
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gpt/frequent-prompts.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gpt/frequent-prompts.user.js
// ==/UserScript==


(function () {
  'use strict';

  const STORAGE_KEY = 'frequentPrompts_v1';
  const HOTKEY = { alt: true, key: 'p' }; // Alt+P to toggle panel

  // ---------- Storage helpers ----------

  function loadPrompts() {
    try {
      const raw = GM_getValue(STORAGE_KEY, '[]');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function savePrompts(prompts) {
    GM_setValue(STORAGE_KEY, JSON.stringify(prompts));
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Site-specific input detection ----------

  function getInputElement() {
    const host = location.hostname;
    let el = null;

    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      el = document.querySelector('#prompt-textarea') ||
           document.querySelector('div[contenteditable="true"]#prompt-textarea') ||
           document.querySelector('form div[contenteditable="true"]') ||
           document.querySelector('textarea');
    } else if (host.includes('claude.ai')) {
      el = document.querySelector('div[contenteditable="true"].ProseMirror') ||
           document.querySelector('div[contenteditable="true"]');
    } else if (host.includes('gemini.google.com')) {
      el = document.querySelector('rich-textarea div[contenteditable="true"]') ||
           document.querySelector('div.ql-editor[contenteditable="true"]') ||
           document.querySelector('div[contenteditable="true"]');
    }

    // Generic fallback if the site changed its markup
    if (!el) {
      el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
    }
    return el;
  }

  function getSendButton() {
    const host = location.hostname;
    let btn = null;

    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      btn = document.querySelector('button[data-testid="send-button"]');
    } else if (host.includes('claude.ai')) {
      btn = document.querySelector('button[aria-label="Send Message"]') ||
            document.querySelector('button[aria-label="Send message"]');
    } else if (host.includes('gemini.google.com')) {
      btn = document.querySelector('button[aria-label="Send message"]');
    }
    return btn;
  }

  function setTextareaValue(el, text) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setContentEditableValue(el, text) {
    el.focus();
    // select all existing content, then replace it — works well with React/ProseMirror/Quill controlled editors
    document.execCommand('selectAll', false, null);
    const inserted = document.execCommand('insertText', false, text);

    if (!inserted || el.innerText.trim() === '') {
      // Fallback for browsers/situations where execCommand is unavailable
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }

    // Move cursor to the end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function insertPrompt(text, autoSend) {
    const el = getInputElement();
    if (!el) {
      alert('Frequent Prompts: could not find the message box on this page. Try clicking into the chat input first.');
      return;
    }

    el.focus();
    if (el.tagName === 'TEXTAREA') {
      setTextareaValue(el, text);
    } else {
      setContentEditableValue(el, text);
    }

    if (autoSend) {
      setTimeout(() => {
        const btn = getSendButton();
        if (btn && !btn.disabled) {
          btn.click();
        } else {
          // Best-effort fallback: simulate Enter keypress
          const target = getInputElement();
          if (target) {
            const evt = new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
            });
            target.dispatchEvent(evt);
          }
        }
      }, 120);
    }
  }

  // ---------- UI ----------

  const hostDiv = document.createElement('div');
  hostDiv.id = 'fp-host-root';
  document.documentElement.appendChild(hostDiv);
  const shadow = hostDiv.attachShadow({ mode: 'open' });

  // Many chat sites (ChatGPT in particular) listen globally for keystrokes and
  // auto-focus their own message box whenever document.activeElement doesn't
  // look like a form field. Because our fields live inside a Shadow DOM,
  // document.activeElement (as seen from the page) reports the shadow host,
  // not our actual <input>/<textarea> - so the page thinks nothing is focused
  // and steals every keystroke. Stopping these events from bubbling past our
  // host element keeps them from ever reaching the page's global listeners.
  const FP_GUARDED_EVENTS = [
    'keydown', 'keyup', 'keypress',
    'input', 'beforeinput',
    'compositionstart', 'compositionupdate', 'compositionend',
    'paste', 'cut', 'copy',
    'drop', 'dragstart', 'dragover'
  ];
  FP_GUARDED_EVENTS.forEach(evtName => {
    hostDiv.addEventListener(evtName, (e) => {
      e.stopPropagation();
    });
    // Also guard the capture phase, in case a site attaches its global
    // paste/keyboard interceptor directly on <html> rather than document/window.
    hostDiv.addEventListener(evtName, (e) => {
      e.stopPropagation();
    }, true);
  });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

    .fp-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #2f6f4f;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      z-index: 2147483000;
      user-select: none;
      transition: transform 0.15s ease, background 0.15s ease;
      border: none;
    }
    .fp-fab:hover { transform: scale(1.06); background: #275e42; }

    .fp-panel {
      position: fixed;
      bottom: 88px;
      right: 24px;
      width: 380px;
      max-height: 70vh;
      background: #1e1f22;
      color: #f2f2f2;
      border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.45);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483000;
      border: 1px solid #333;
    }
    .fp-panel.open { display: flex; }

    .fp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: #26272b;
      border-bottom: 1px solid #333;
    }
    .fp-header h2 { font-size: 14px; margin: 0; font-weight: 600; letter-spacing: 0.2px; }
    .fp-close {
      cursor: pointer; background: none; border: none; color: #aaa; font-size: 18px; line-height: 1;
      padding: 2px 6px; border-radius: 6px;
    }
    .fp-close:hover { background: #34353a; color: #fff; }

    .fp-toolbar {
      display: flex; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2c2d31;
    }
    .fp-search {
      flex: 1; background: #2a2b2f; border: 1px solid #3a3b40; border-radius: 8px;
      color: #eee; padding: 7px 10px; font-size: 13px; outline: none;
    }
    .fp-search:focus { border-color: #2f6f4f; }
    .fp-add-btn {
      background: #2f6f4f; color: white; border: none; border-radius: 8px;
      padding: 7px 12px; font-size: 13px; cursor: pointer; white-space: nowrap;
    }
    .fp-add-btn:hover { background: #275e42; }

    .fp-list { overflow-y: auto; padding: 8px 10px; flex: 1; }
    .fp-empty { color: #888; font-size: 13px; text-align: center; padding: 30px 10px; }

    .fp-card {
      background: #26272b; border: 1px solid #313236; border-radius: 10px;
      padding: 10px 12px; margin-bottom: 8px;
    }
    .fp-card-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #fff; }
    .fp-card-preview {
      font-size: 12px; color: #a9abb0; margin-bottom: 8px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .fp-card-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .fp-btn {
      border: none; border-radius: 6px; font-size: 11.5px; padding: 5px 8px; cursor: pointer;
      background: #34353a; color: #eee;
    }
    .fp-btn:hover { background: #3f4046; }
    .fp-btn.primary { background: #2f6f4f; color: white; }
    .fp-btn.primary:hover { background: #275e42; }
    .fp-btn.danger { background: #5a2b2b; color: #ffd7d7; }
    .fp-btn.danger:hover { background: #6e3535; }

    .fp-footer {
      display: flex; justify-content: space-between; padding: 8px 12px; border-top: 1px solid #2c2d31;
      font-size: 11px;
    }
    .fp-link { color: #8fb; background: none; border: none; cursor: pointer; font-size: 11px; padding: 4px; }
    .fp-link:hover { text-decoration: underline; }

    /* Modal form for add/edit */
    .fp-modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: none; align-items: center; justify-content: center; z-index: 2147483001;
    }
    .fp-modal-overlay.open { display: flex; }
    .fp-modal {
      width: 360px; background: #1e1f22; border-radius: 12px; border: 1px solid #333;
      padding: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .fp-modal h3 { margin: 0 0 10px; font-size: 14px; color: #fff; }
    .fp-field { margin-bottom: 10px; }
    .fp-field label { display: block; font-size: 11.5px; color: #aaa; margin-bottom: 4px; }
    .fp-field input, .fp-field textarea {
      width: 100%; background: #2a2b2f; border: 1px solid #3a3b40; border-radius: 8px;
      color: #eee; padding: 8px 10px; font-size: 13px; outline: none; resize: vertical;
    }
    .fp-field textarea { min-height: 100px; }
    .fp-field input:focus, .fp-field textarea:focus { border-color: #2f6f4f; }
    .fp-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

    .fp-hidden-file { display: none; }
  `;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <button class="fp-fab" title="Frequent Prompts (Alt+P)">⚡</button>

    <div class="fp-panel">
      <div class="fp-header">
        <h2>Frequent Prompts</h2>
        <button class="fp-close" title="Close">✕</button>
      </div>
      <div class="fp-toolbar">
        <input class="fp-search" type="text" placeholder="Search prompts..." />
        <button class="fp-add-btn">+ Add</button>
      </div>
      <div class="fp-list"></div>
      <div class="fp-footer">
        <button class="fp-link fp-export">Export</button>
        <button class="fp-link fp-import">Import</button>
        <input type="file" class="fp-hidden-file" accept="application/json" />
      </div>
    </div>

    <div class="fp-modal-overlay">
      <div class="fp-modal">
        <h3 class="fp-modal-title">Add Prompt</h3>
        <div class="fp-field">
          <label>Title</label>
          <input type="text" class="fp-input-title" placeholder="e.g. Summarize article" />
        </div>
        <div class="fp-field">
          <label>Prompt text</label>
          <textarea class="fp-input-text" placeholder="Your full prompt goes here..."></textarea>
        </div>
        <div class="fp-modal-actions">
          <button class="fp-btn fp-cancel">Cancel</button>
          <button class="fp-btn primary fp-save">Save</button>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(wrapper);

  const fab = shadow.querySelector('.fp-fab');
  const panel = shadow.querySelector('.fp-panel');
  const closeBtn = shadow.querySelector('.fp-close');
  const searchInput = shadow.querySelector('.fp-search');
  const addBtn = shadow.querySelector('.fp-add-btn');
  const listEl = shadow.querySelector('.fp-list');
  const exportBtn = shadow.querySelector('.fp-export');
  const importBtn = shadow.querySelector('.fp-import');
  const fileInput = shadow.querySelector('.fp-hidden-file');

  const modalOverlay = shadow.querySelector('.fp-modal-overlay');
  const modalTitle = shadow.querySelector('.fp-modal-title');
  const inputTitle = shadow.querySelector('.fp-input-title');
  const inputText = shadow.querySelector('.fp-input-text');
  const saveBtn = shadow.querySelector('.fp-save');
  const cancelBtn = shadow.querySelector('.fp-cancel');

  let editingId = null; // null = adding new

  function togglePanel(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : !panel.classList.contains('open');
    panel.classList.toggle('open', shouldOpen);
    if (shouldOpen) {
      render();
      searchInput.focus();
    }
  }

  fab.addEventListener('click', () => togglePanel());
  closeBtn.addEventListener('click', () => togglePanel(false));

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === HOTKEY.key) {
      e.preventDefault();
      togglePanel();
    }
    if (e.key === 'Escape') {
      if (modalOverlay.classList.contains('open')) closeModal();
      else togglePanel(false);
    }
  });

  searchInput.addEventListener('input', render);

  function openModal(prompt) {
    if (prompt) {
      editingId = prompt.id;
      modalTitle.textContent = 'Edit Prompt';
      inputTitle.value = prompt.title;
      inputText.value = prompt.text;
    } else {
      editingId = null;
      modalTitle.textContent = 'Add Prompt';
      inputTitle.value = '';
      inputText.value = '';
    }
    modalOverlay.classList.add('open');
    inputTitle.focus();
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
  }

  addBtn.addEventListener('click', () => openModal(null));
  cancelBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  saveBtn.addEventListener('click', () => {
    const title = inputTitle.value.trim();
    const text = inputText.value.trim();
    if (!text) {
      inputText.focus();
      return;
    }
    const prompts = loadPrompts();

    if (editingId) {
      const idx = prompts.findIndex(p => p.id === editingId);
      if (idx !== -1) {
        prompts[idx].title = title || text.slice(0, 40);
        prompts[idx].text = text;
      }
    } else {
      prompts.unshift({
        id: uid(),
        title: title || text.slice(0, 40),
        text
      });
    }

    savePrompts(prompts);
    closeModal();
    render();
  });

  function deletePrompt(id) {
    const prompts = loadPrompts().filter(p => p.id !== id);
    savePrompts(prompts);
    render();
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const prompts = loadPrompts().filter(p => {
      if (!query) return true;
      return p.title.toLowerCase().includes(query) || p.text.toLowerCase().includes(query);
    });

    listEl.innerHTML = '';

    if (prompts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fp-empty';
      empty.textContent = loadPrompts().length === 0
        ? 'No prompts yet. Click "+ Add" to save your first one.'
        : 'No prompts match your search.';
      listEl.appendChild(empty);
      return;
    }

    prompts.forEach(p => {
      const card = document.createElement('div');
      card.className = 'fp-card';
      card.innerHTML = `
        <div class="fp-card-title"></div>
        <div class="fp-card-preview"></div>
        <div class="fp-card-actions">
          <button class="fp-btn primary fp-act-insert">Insert</button>
          <button class="fp-btn fp-act-send">Insert &amp; Send</button>
          <button class="fp-btn fp-act-edit">Edit</button>
          <button class="fp-btn danger fp-act-delete">Delete</button>
        </div>
      `;
      card.querySelector('.fp-card-title').textContent = p.title;
      card.querySelector('.fp-card-preview').textContent = p.text;

      card.querySelector('.fp-act-insert').addEventListener('click', () => {
        insertPrompt(p.text, false);
        togglePanel(false);
      });
      card.querySelector('.fp-act-send').addEventListener('click', () => {
        insertPrompt(p.text, true);
        togglePanel(false);
      });
      card.querySelector('.fp-act-edit').addEventListener('click', () => openModal(p));
      card.querySelector('.fp-act-delete').addEventListener('click', () => {
        if (confirm(`Delete "${p.title}"?`)) deletePrompt(p.id);
      });

      listEl.appendChild(card);
    });
  }

  // ---------- Import / Export ----------

  exportBtn.addEventListener('click', () => {
    const prompts = loadPrompts();
    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frequent-prompts-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        const existing = loadPrompts();
        const merged = existing.concat(
          imported
            .filter(p => p && typeof p.text === 'string')
            .map(p => ({ id: uid(), title: p.title || p.text.slice(0, 40), text: p.text }))
        );
        savePrompts(merged);
        render();
        alert(`Imported ${imported.length} prompt(s).`);
      } catch (e) {
        alert('Import failed: file is not valid JSON in the expected format.');
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  // ---------- Tampermonkey menu commands ----------

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open Frequent Prompts', () => togglePanel(true));
    GM_registerMenuCommand('Add New Prompt', () => { togglePanel(true); openModal(null); });
  }

})();