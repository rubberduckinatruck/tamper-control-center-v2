// ==UserScript==
// @name             GAS File Script Importer
// @namespace        https://tampermonkey.net/
// @version          1.7.2
// @description      Import local .gs, .js, .html, .htm, and .txt files into Google Apps Script using a verified sequential state machine.
// @author           Big Poppa
//
// @cc-id            gas-file-script-importer
// @cc-display-name  Google Apps Script File Importer
// @cc-category      google-apps-script
// @cc-role          development
// @cc-status        live
// @cc-tags          google, apps script, importer, files, development
//
// @match            https://script.google.com/*/home/projects/*/edit
// @match            https://script.google.com/home/projects/*/edit
// @match            https://script.google.com/u/*/home/projects/*/edit
// @grant            unsafeWindow
// @run-at           document-idle
// @noframes
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gas/gas-file-script-importer.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gas/gas-file-script-importer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================================================
  // SECTION 01 — TOP-LEVEL WINDOW GUARD
  // ==========================================================================

  if (window.top !== window.self) {
    return;
  }

  // ==========================================================================
  // SECTION 02 — CONFIGURATION
  // ==========================================================================

  const CONFIG = Object.freeze({
    VERSION: '1.7.2',

    IDS: Object.freeze({
      PANEL: 'tm-gas-importer-panel',
      FILE_INPUT: 'tm-gas-importer-file-input',
      DROP_ZONE: 'tm-gas-importer-drop-zone',
      LOG: 'tm-gas-importer-log',
      STATUS: 'tm-gas-importer-status',
      PROGRESS: 'tm-gas-importer-progress',
      COUNTS: 'tm-gas-importer-counts',
      OVERWRITE: 'tm-gas-importer-overwrite',
      CONTINUE_ON_ERROR: 'tm-gas-importer-continue-on-error',
      RETRY_ONCE: 'tm-gas-importer-retry-once'
    }),

    STORAGE: Object.freeze({
      OVERWRITE: 'tm_gas_importer_overwrite',
      CONTINUE_ON_ERROR: 'tm_gas_importer_continue_on_error',
      RETRY_ONCE: 'tm_gas_importer_retry_once'
    }),

    SELECTORS: Object.freeze({
      PROJECT_LIST:
        'ul[role="listbox"][aria-label="Project files"]',

      PROJECT_ROW:
        'ul[role="listbox"][aria-label="Project files"] > ' +
        'li[jsname="CmABtb"][role="option"]',

      PROJECT_FILENAME:
        '.dxw0vf',

      ADD_FILE_BUTTON:
        '[role="button"][aria-label="Add a file"][aria-haspopup="true"]',

      ADD_MENU:
        'div[role="menu"][jsowner]',

      SCRIPT_MENU_ITEM:
        'span[jsname="j7LFlb"][role="menuitem"][aria-label="Script"]',

      HTML_MENU_ITEM:
        'span[jsname="j7LFlb"][role="menuitem"][aria-label="HTML"]',

      RENAME_INPUT:
        'input.VfPpkd-fmcmS-wGMbrd',

      EDITOR_ROOT:
        '.monaco-editor',

      EDITOR_VIEW:
        '.monaco-editor .view-lines',

      EDITOR_BACKGROUND:
        '.monaco-editor-background',

      EDITOR_INPUT:
        '.monaco-editor textarea, ' +
        '.monaco-editor .inputarea, ' +
        'textarea.inputarea'
    }),

    SUPPORTED_EXTENSIONS: Object.freeze([
      'gs',
      'js',
      'html',
      'htm',
      'txt'
    ]),

    TIMEOUTS: Object.freeze({
      ELEMENT_MS: 10000,
      MENU_MS: 6000,
      NEW_ROW_MS: 10000,
      RENAME_TARGET_MS: 5000,
      RENAME_FINAL_VERIFY_MS: 3500,
      ROW_SELECTION_MS: 7000,
      MONACO_MS: 10000,
      MODEL_SWITCH_MS: 10000
    }),

    DELAYS: Object.freeze({
      STARTUP_MS: 350,
      POLL_MS: 80,

      AFTER_ADD_CLICK_MS: 200,
      AFTER_MENU_FOCUS_MS: 100,
      AFTER_MENU_ACTIVATION_MS: 150,
      AFTER_NEW_ROW_MS: 100,

      AFTER_SELECT_ALL_MS: 75,
      AFTER_NAME_INSERT_MS: 250,

      // Primary commit: press Enter, then give Google time to save the name.
      AFTER_RENAME_ENTER_MS: 4500,

      // Fallback commit: click outside, then wait again.
      AFTER_RENAME_FALLBACK_MS: 4500,

      // Final recovery wait before declaring rename failure.
      RENAME_FINAL_RECOVERY_MS: 2000,

      AFTER_ROW_SELECT_MS: 400,
      AFTER_EDITOR_CLICK_MS: 200,
      AFTER_SOURCE_WRITE_MS: 350,
      AFTER_SAVE_MS: 1200,
      BETWEEN_FILES_MS: 600
    }),

    MAX_MENU_RETRIES: 1
  });

  // ==========================================================================
  // SECTION 03 — STATE MACHINE PHASES
  // ==========================================================================

  const PHASES = Object.freeze({
    IDLE: 'IDLE',
    READ_LOCAL_FILES: 'READ_LOCAL_FILES',
    PREPARE_QUEUE: 'PREPARE_QUEUE',
    CHECK_EXISTING_FILE: 'CHECK_EXISTING_FILE',

    OPEN_ADD_MENU: 'OPEN_ADD_MENU',
    FIND_FILE_TYPE_ITEM: 'FIND_FILE_TYPE_ITEM',
    ACTIVATE_FILE_TYPE: 'ACTIVATE_FILE_TYPE',
    WAIT_FOR_NEW_ROW: 'WAIT_FOR_NEW_ROW',

    CAPTURE_RENAME_TARGET: 'CAPTURE_RENAME_TARGET',
    TYPE_FILENAME: 'TYPE_FILENAME',
    VERIFY_FILENAME_INPUT: 'VERIFY_FILENAME_INPUT',
    COMMIT_RENAME_ENTER: 'COMMIT_RENAME_ENTER',
    VERIFY_RENAME_ENTER: 'VERIFY_RENAME_ENTER',
    COMMIT_RENAME_FALLBACK: 'COMMIT_RENAME_FALLBACK',
    VERIFY_RENAME_FALLBACK: 'VERIFY_RENAME_FALLBACK',
    RECOVER_RENAME: 'RECOVER_RENAME',

    SELECT_PROJECT_FILE: 'SELECT_PROJECT_FILE',
    WAIT_FOR_EDITOR_MODEL: 'WAIT_FOR_EDITOR_MODEL',
    WRITE_SOURCE: 'WRITE_SOURCE',
    VERIFY_SOURCE: 'VERIFY_SOURCE',
    SAVE_PROJECT: 'SAVE_PROJECT',

    COMPLETE: 'COMPLETE',
    FAILED: 'FAILED',
    STOPPED: 'STOPPED'
  });

  // ==========================================================================
  // SECTION 04 — MUTABLE RUNTIME STATE
  // ==========================================================================

  const state = {
    initialized: false,
    running: false,
    stopRequested: false,

    currentPhase: PHASES.IDLE,
    currentIndex: 0,
    currentFilename: '',
    currentRecord: null,

    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0,

    lastError: null
  };

  unsafeWindow.__GAS_FILE_IMPORTER_STATE__ = state;

  // ==========================================================================
  // SECTION 05 — ERROR TYPE AND ERROR FORMATTING
  // ==========================================================================

  class ImporterError extends Error {
    constructor(phase, message, details = {}) {
      super(`[${phase}] ${message}`);

      this.name = 'ImporterError';
      this.phase = phase;
      this.details = details;
    }
  }

  function getErrorMessage(error) {
    if (error instanceof Error) {
      return error.message;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  // ==========================================================================
  // SECTION 06 — GENERAL UTILITIES
  // ==========================================================================

  const sleep = (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getExtension(filename) {
    const match = /\.([^.]+)$/.exec(
      String(filename ?? '').trim()
    );

    return match
      ? match[1].toLowerCase()
      : '';
  }

  function stripFinalExtension(filename) {
    return String(filename ?? '')
      .replace(/\.[^.]+$/, '');
  }

  function getBaseFilename(path) {
    return String(path ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .pop() || '';
  }

  function sanitizeAppsScriptName(filename) {
    let name = stripFinalExtension(
      getBaseFilename(filename)
    );

    name = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/_+/g, '_')
      .replace(/^[.\s_-]+|[.\s_-]+$/g, '')
      .trim();

    if (!name) {
      name = 'ImportedFile';
    }

    return name.slice(0, 100);
  }

  function inferFileType(filename, source) {
    const extension = getExtension(filename);

    if (
      extension === 'html' ||
      extension === 'htm'
    ) {
      return {
        type: 'HTML',
        outputExtension: 'html'
      };
    }

    if (
      extension === 'gs' ||
      extension === 'js'
    ) {
      return {
        type: 'SERVER_JS',
        outputExtension: 'gs'
      };
    }

    if (extension === 'txt') {
      const beginning = String(source ?? '')
        .trimStart()
        .slice(0, 1200);

      const appearsToBeHtml =
        /^<!doctype\s+html/i.test(beginning) ||
        /^<html[\s>]/i.test(beginning) ||
        /^<head[\s>]/i.test(beginning) ||
        /^<body[\s>]/i.test(beginning) ||
        /^<script[\s>]/i.test(beginning) ||
        /^<style[\s>]/i.test(beginning);

      return appearsToBeHtml
        ? {
            type: 'HTML',
            outputExtension: 'html'
          }
        : {
            type: 'SERVER_JS',
            outputExtension: 'gs'
          };
    }

    return null;
  }

  function getDisplayFilename(record) {
    return `${record.name}.${record.outputExtension}`;
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rectangle =
      element.getBoundingClientRect();

    const style =
      window.getComputedStyle(element);

    return (
      rectangle.width > 0 &&
      rectangle.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function describeElement(element) {
    if (!element) {
      return 'none';
    }

    const tagName =
      element.tagName?.toLowerCase() ||
      'unknown';

    const id =
      element.id
        ? `#${element.id}`
        : '';

    let classes = '';

    if (typeof element.className === 'string') {
      classes = element.className
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 5)
        .map((className) => `.${className}`)
        .join('');
    }

    const role =
      element.getAttribute?.('role');

    const ariaLabel =
      element.getAttribute?.('aria-label');

    return [
      `${tagName}${id}${classes}`,
      role ? `role="${role}"` : '',
      ariaLabel
        ? `aria-label="${ariaLabel}"`
        : ''
    ]
      .filter(Boolean)
      .join(' ');
  }

  // ==========================================================================
  // SECTION 07 — VERIFIED ASYNCHRONOUS WAITING
  // ==========================================================================

  async function waitFor(
    finder,
    timeoutMilliseconds,
    description,
    pollMilliseconds = CONFIG.DELAYS.POLL_MS
  ) {
    const startedAt = performance.now();
    let lastFinderError = null;

    while (
      performance.now() - startedAt <
      timeoutMilliseconds
    ) {
      if (state.stopRequested) {
        throw new ImporterError(
          PHASES.STOPPED,
          `Stopped while waiting for ${description}.`
        );
      }

      try {
        const result = finder();

        if (result) {
          return result;
        }
      } catch (error) {
        lastFinderError = error;
      }

      await sleep(pollMilliseconds);
    }

    throw new ImporterError(
      state.currentPhase,
      `Timed out waiting for ${description}.`,
      {
        lastFinderError:
          lastFinderError
            ? getErrorMessage(lastFinderError)
            : null
      }
    );
  }

  // ==========================================================================
  // SECTION 08 — LOGGING, STATUS, AND PROGRESS
  // ==========================================================================

  function logLine(message) {
    const log =
      document.getElementById(
        CONFIG.IDS.LOG
      );

    if (log) {
      const line =
        document.createElement('div');

      line.textContent = String(message);

      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    console.log(
      `[GAS Importer] ${message}`
    );
  }

  function clearLog() {
    const log =
      document.getElementById(
        CONFIG.IDS.LOG
      );

    if (log) {
      log.textContent = '';
    }
  }

  function setPhase(phase, detail = '') {
    state.currentPhase = phase;

    const prefix =
      state.currentFilename
        ? `[${state.currentIndex}/${state.total}]`
        : '[SYSTEM]';

    logLine(
      `${prefix} [${phase}]` +
      (detail ? ` ${detail}` : '')
    );
  }

  function setStatus(message, type = 'info') {
    const status =
      document.getElementById(
        CONFIG.IDS.STATUS
      );

    if (!status) {
      return;
    }

    status.textContent = String(message);

    const colors = {
      info: '#8ab4f8',
      success: '#81c995',
      warning: '#fdd663',
      error: '#f28b82'
    };

    status.style.color =
      colors[type] ||
      colors.info;
  }

  function updateProgress() {
    const processed =
      state.completed +
      state.skipped +
      state.failed;

    const progress =
      document.getElementById(
        CONFIG.IDS.PROGRESS
      );

    const counts =
      document.getElementById(
        CONFIG.IDS.COUNTS
      );

    if (progress) {
      progress.value =
        state.total > 0
          ? Math.round(
              processed /
              state.total *
              100
            )
          : 0;
    }

    if (counts) {
      counts.textContent =
        `${Math.min(processed, state.total)} of ${state.total} | ` +
        `Imported: ${state.completed} | ` +
        `Skipped: ${state.skipped} | ` +
        `Failed: ${state.failed}`;
    }
  }

  // ==========================================================================
  // SECTION 09 — SAFE DOM EVENT HELPERS
  // ==========================================================================

  function safeFocus(element) {
    if (!element?.focus) {
      return false;
    }

    try {
      element.focus({
        preventScroll: true
      });

      return true;
    } catch (error) {
      console.debug(
        '[GAS Importer] Focus with preventScroll failed:',
        error
      );
    }

    try {
      element.focus();
      return true;
    } catch (error) {
      console.debug(
        '[GAS Importer] Standard focus failed:',
        error
      );

      return false;
    }
  }

  function realClick(element) {
    if (!(element instanceof HTMLElement)) {
      throw new ImporterError(
        state.currentPhase,
        'Cannot click a missing or invalid page element.'
      );
    }

    const win =
      unsafeWindow || window;

    const rectangle =
      element.getBoundingClientRect();

    const clientX = Math.floor(
      rectangle.left +
      Math.max(1, rectangle.width / 2)
    );

    const clientY = Math.floor(
      rectangle.top +
      Math.max(1, rectangle.height / 2)
    );

    const commonOptions = {
      view: win,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
      buttons: 1
    };

    try {
      element.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
      });
    } catch (error) {
      console.debug(
        '[GAS Importer] scrollIntoView failed:',
        error
      );
    }

    safeFocus(element);

    try {
      if (typeof win.PointerEvent === 'function') {
        element.dispatchEvent(
          new win.PointerEvent(
            'pointerover',
            {
              ...commonOptions,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true
            }
          )
        );

        element.dispatchEvent(
          new win.PointerEvent(
            'pointerdown',
            {
              ...commonOptions,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true
            }
          )
        );
      }
    } catch (error) {
      console.debug(
        '[GAS Importer] Pointer down events failed:',
        error
      );
    }

    element.dispatchEvent(
      new win.MouseEvent(
        'mouseover',
        commonOptions
      )
    );

    element.dispatchEvent(
      new win.MouseEvent(
        'mousedown',
        commonOptions
      )
    );

    try {
      if (typeof win.PointerEvent === 'function') {
        element.dispatchEvent(
          new win.PointerEvent(
            'pointerup',
            {
              ...commonOptions,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              buttons: 0
            }
          )
        );
      }
    } catch (error) {
      console.debug(
        '[GAS Importer] Pointer up event failed:',
        error
      );
    }

    element.dispatchEvent(
      new win.MouseEvent(
        'mouseup',
        {
          ...commonOptions,
          buttons: 0
        }
      )
    );

    element.dispatchEvent(
      new win.MouseEvent(
        'click',
        {
          ...commonOptions,
          buttons: 0
        }
      )
    );

    return true;
  }

  function dispatchKey(
    target,
    key,
    code,
    keyCode,
    modifiers = {}
  ) {
    if (!target?.dispatchEvent) {
      throw new ImporterError(
        state.currentPhase,
        `Cannot dispatch ${key} to a missing target.`
      );
    }

    const options = {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: Boolean(modifiers.ctrlKey),
      metaKey: Boolean(modifiers.metaKey),
      shiftKey: Boolean(modifiers.shiftKey),
      altKey: Boolean(modifiers.altKey)
    };

    target.dispatchEvent(
      new KeyboardEvent(
        'keydown',
        options
      )
    );

    target.dispatchEvent(
      new KeyboardEvent(
        'keypress',
        options
      )
    );

    target.dispatchEvent(
      new KeyboardEvent(
        'keyup',
        options
      )
    );
  }

  function dispatchEnter(target) {
    dispatchKey(
      target,
      'Enter',
      'Enter',
      13
    );
  }

  function dispatchArrowDown(target) {
    dispatchKey(
      target,
      'ArrowDown',
      'ArrowDown',
      40
    );
  }

  function dispatchSelectAll(target) {
    const isMac =
      /Mac|iPhone|iPad|iPod/i.test(
        navigator.platform
      );

    dispatchKey(
      target,
      'a',
      'KeyA',
      65,
      {
        ctrlKey: !isMac,
        metaKey: isMac
      }
    );
  }

  function dispatchSaveShortcut(target) {
    const isMac =
      /Mac|iPhone|iPad|iPod/i.test(
        navigator.platform
      );

    dispatchKey(
      target,
      's',
      'KeyS',
      83,
      {
        ctrlKey: !isMac,
        metaKey: isMac
      }
    );
  }

  function isEditableElement(element) {
    return Boolean(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      (
        element instanceof HTMLElement &&
        element.isContentEditable
      )
    );
  }

  function readEditableValue(element) {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      return String(element.value ?? '');
    }

    if (element instanceof HTMLElement) {
      return String(element.textContent ?? '');
    }

    return '';
  }

  function setNativeEditableValue(
    element,
    value
  ) {
    if (element instanceof HTMLInputElement) {
      const setter =
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;

      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }
    } else if (
      element instanceof HTMLTextAreaElement
    ) {
      const setter =
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        )?.set;

      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }
    } else if (
      element instanceof HTMLElement &&
      element.isContentEditable
    ) {
      element.textContent = value;
    } else {
      return false;
    }

    try {
      element.dispatchEvent(
        new InputEvent(
          'beforeinput',
          {
            inputType:
              'insertReplacementText',
            data: value,
            bubbles: true,
            cancelable: true,
            composed: true
          }
        )
      );
    } catch (error) {
      console.debug(
        '[GAS Importer] beforeinput dispatch failed:',
        error
      );
    }

    element.dispatchEvent(
      new Event(
        'input',
        {
          bubbles: true,
          composed: true
        }
      )
    );

    element.dispatchEvent(
      new Event(
        'change',
        {
          bubbles: true,
          composed: true
        }
      )
    );

    return true;
  }

  function insertTextThroughFocusedControl(
    target,
    value
  ) {
    safeFocus(target);
    dispatchSelectAll(target);

    let inserted = false;

    try {
      inserted =
        document.execCommand(
          'insertText',
          false,
          value
        );
    } catch (error) {
      console.debug(
        '[GAS Importer] execCommand insertText failed:',
        error
      );
    }

    const currentValue =
      normalizeText(
        readEditableValue(target)
      );

    if (
      !inserted ||
      currentValue.toLowerCase() !==
        normalizeText(value).toLowerCase()
    ) {
      inserted =
        setNativeEditableValue(
          target,
          value
        );
    }

    return inserted;
  }

  // ==========================================================================
  // SECTION 10 — PERSISTENT SETTINGS
  // ==========================================================================

  function getStoredBoolean(
    key,
    defaultValue
  ) {
    try {
      const stored =
        localStorage.getItem(key);

      if (stored === null) {
        return defaultValue;
      }

      return stored === '1';
    } catch (error) {
      console.debug(
        '[GAS Importer] localStorage read failed:',
        error
      );

      return defaultValue;
    }
  }

  function setStoredBoolean(
    key,
    value
  ) {
    try {
      localStorage.setItem(
        key,
        value ? '1' : '0'
      );
    } catch (error) {
      console.debug(
        '[GAS Importer] localStorage write failed:',
        error
      );
    }
  }

  // ==========================================================================
  // SECTION 11 — IMPORTER PANEL
  // ==========================================================================

  function createButton(
    label,
    clickHandler,
    primary = false
  ) {
    const button =
      document.createElement('button');

    button.type = 'button';
    button.textContent = label;

    Object.assign(
      button.style,
      {
        border:
          primary
            ? '1px solid #1a73e8'
            : '1px solid #444',

        borderRadius: '7px',

        background:
          primary
            ? '#1a73e8'
            : '#202124',

        color: '#ffffff',
        padding: '7px 10px',
        fontFamily: 'inherit',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer'
      }
    );

    button.addEventListener(
      'click',
      clickHandler
    );

    return button;
  }

  function createCheckboxSetting(
    id,
    labelText,
    initialValue
  ) {
    const label =
      document.createElement('label');

    Object.assign(
      label.style,
      {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        fontSize: '12px'
      }
    );

    const checkbox =
      document.createElement('input');

    checkbox.id = id;
    checkbox.type = 'checkbox';
    checkbox.checked = initialValue;

    const text =
      document.createElement('span');

    text.textContent = labelText;

    label.append(
      checkbox,
      text
    );

    return {
      label,
      checkbox
    };
  }

  function createPanel() {
    const existing =
      document.getElementById(
        CONFIG.IDS.PANEL
      );

    if (existing) {
      return existing;
    }

    const panel =
      document.createElement('section');

    panel.id = CONFIG.IDS.PANEL;

    Object.assign(
      panel.style,
      {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: '2147483647',
        width: '440px',
        maxHeight: '82vh',
        overflow: 'hidden',
        border:
          '1px solid #3c4043',
        borderRadius: '12px',
        background: '#121212',
        color: '#e8eaed',
        boxShadow:
          '0 8px 28px rgba(0,0,0,.42)',
        fontFamily:
          'ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial',
        fontSize: '13px'
      }
    );

    const header =
      document.createElement('header');

    Object.assign(
      header.style,
      {
        display: 'flex',
        alignItems: 'center',
        justifyContent:
          'space-between',
        gap: '10px',
        padding: '10px 12px',
        borderBottom:
          '1px solid #303134'
      }
    );

    const titleGroup =
      document.createElement('div');

    const title =
      document.createElement('div');

    title.textContent =
      'Apps Script Importer';

    title.style.fontWeight = '700';

    const version =
      document.createElement('div');

    version.textContent =
      `State Machine v${CONFIG.VERSION}`;

    Object.assign(
      version.style,
      {
        marginTop: '2px',
        color: '#9aa0a6',
        fontSize: '10px'
      }
    );

    titleGroup.append(
      title,
      version
    );

    const headerButtons =
      document.createElement('div');

    Object.assign(
      headerButtons.style,
      {
        display: 'flex',
        gap: '7px'
      }
    );

    const chooseButton =
      createButton(
        'Choose files',
        () => {
          if (!state.running) {
            document
              .getElementById(
                CONFIG.IDS.FILE_INPUT
              )
              ?.click();
          }
        },
        true
      );

    const hideButton =
      createButton(
        'Hide',
        () => {
          panel.style.display =
            'none';
        }
      );

    headerButtons.append(
      chooseButton,
      hideButton
    );

    header.append(
      titleGroup,
      headerButtons
    );

    const body =
      document.createElement('div');

    Object.assign(
      body.style,
      {
        padding: '12px',
        maxHeight:
          'calc(82vh - 52px)',
        overflowY: 'auto'
      }
    );

    const dropZone =
      document.createElement('div');

    dropZone.id =
      CONFIG.IDS.DROP_ZONE;

    dropZone.tabIndex = 0;

    Object.assign(
      dropZone.style,
      {
        padding: '20px 12px',
        marginBottom: '10px',
        border:
          '2px dashed #5f6368',
        borderRadius: '9px',
        background: '#181818',
        textAlign: 'center',
        cursor: 'pointer',
        userSelect: 'none'
      }
    );

    const dropTitle =
      document.createElement('div');

    dropTitle.textContent =
      'Drop Apps Script files here';

    dropTitle.style.fontWeight =
      '700';

    const dropHelp =
      document.createElement('div');

    dropHelp.textContent =
      '.gs, .js, .html, .htm, or .txt';

    Object.assign(
      dropHelp.style,
      {
        marginTop: '5px',
        color: '#9aa0a6',
        fontSize: '11px'
      }
    );

    dropZone.append(
      dropTitle,
      dropHelp
    );

    const fileInput =
      document.createElement('input');

    fileInput.id =
      CONFIG.IDS.FILE_INPUT;

    fileInput.type = 'file';
    fileInput.multiple = true;

    fileInput.accept =
      '.gs,.js,.html,.htm,.txt';

    fileInput.style.display =
      'none';

    const options =
      document.createElement('div');

    Object.assign(
      options.style,
      {
        display: 'grid',
        gap: '7px',
        marginBottom: '10px'
      }
    );

    const overwriteSetting =
      createCheckboxSetting(
        CONFIG.IDS.OVERWRITE,
        'Replace matching existing files',
        getStoredBoolean(
          CONFIG.STORAGE.OVERWRITE,
          true
        )
      );

    const continueSetting =
      createCheckboxSetting(
        CONFIG.IDS.CONTINUE_ON_ERROR,
        'Continue after a file fails',
        getStoredBoolean(
          CONFIG.STORAGE.CONTINUE_ON_ERROR,
          true
        )
      );

    const retrySetting =
      createCheckboxSetting(
        CONFIG.IDS.RETRY_ONCE,
        'Retry failed files once',
        getStoredBoolean(
          CONFIG.STORAGE.RETRY_ONCE,
          true
        )
      );

    options.append(
      overwriteSetting.label,
      continueSetting.label,
      retrySetting.label
    );

    const status =
      document.createElement('div');

    status.id =
      CONFIG.IDS.STATUS;

    status.textContent = 'Ready.';

    Object.assign(
      status.style,
      {
        marginBottom: '7px',
        color: '#8ab4f8',
        fontSize: '12px',
        overflowWrap: 'anywhere'
      }
    );

    const progress =
      document.createElement('progress');

    progress.id =
      CONFIG.IDS.PROGRESS;

    progress.max = 100;
    progress.value = 0;

    Object.assign(
      progress.style,
      {
        width: '100%',
        height: '10px',
        marginBottom: '7px'
      }
    );

    const counts =
      document.createElement('div');

    counts.id =
      CONFIG.IDS.COUNTS;

    counts.textContent =
      '0 of 0 | Imported: 0 | Skipped: 0 | Failed: 0';

    Object.assign(
      counts.style,
      {
        marginBottom: '9px',
        color: '#bdc1c6',
        fontSize: '11px'
      }
    );

    const controls =
      document.createElement('div');

    Object.assign(
      controls.style,
      {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '7px',
        marginBottom: '9px'
      }
    );

    const stopButton =
      createButton(
        'Stop',
        () => {
          state.stopRequested = true;

          setStatus(
            'Stopping after the current safe step…',
            'warning'
          );

          logLine(
            '[SYSTEM] Stop requested.'
          );
        }
      );

    const diagnosticsButton =
      createButton(
        'Diagnostics',
        runDiagnostics
      );

    const clearButton =
      createButton(
        'Clear log',
        clearLog
      );

    controls.append(
      stopButton,
      diagnosticsButton,
      clearButton
    );

    const log =
      document.createElement('div');

    log.id =
      CONFIG.IDS.LOG;

    Object.assign(
      log.style,
      {
        minHeight: '130px',
        maxHeight: '300px',
        overflowY: 'auto',
        padding: '9px',
        border:
          '1px solid #303134',
        borderRadius: '7px',
        background: '#0d0d0d',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontFamily:
          'ui-monospace,Menlo,Consolas,monospace',
        fontSize: '11px',
        lineHeight: '1.45'
      }
    );

    body.append(
      dropZone,
      fileInput,
      options,
      status,
      progress,
      counts,
      controls,
      log
    );

    panel.append(
      header,
      body
    );

    document.body.appendChild(panel);

    bindPanelEvents({
      dropZone,
      fileInput,
      overwriteCheckbox:
        overwriteSetting.checkbox,
      continueCheckbox:
        continueSetting.checkbox,
      retryCheckbox:
        retrySetting.checkbox
    });

    logLine(
      `[SYSTEM] Importer v${CONFIG.VERSION} initialized.`
    );

    return panel;
  }

  function bindPanelEvents({
    dropZone,
    fileInput,
    overwriteCheckbox,
    continueCheckbox,
    retryCheckbox
  }) {
    dropZone.addEventListener(
      'click',
      () => {
        if (!state.running) {
          fileInput.click();
        }
      }
    );

    dropZone.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key === 'Enter' ||
          event.key === ' '
        ) {
          event.preventDefault();

          if (!state.running) {
            fileInput.click();
          }
        }
      }
    );

    fileInput.addEventListener(
      'change',
      async () => {
        const files =
          Array.from(
            fileInput.files || []
          );

        fileInput.value = '';

        if (files.length) {
          await handleSelectedFiles(
            files
          );
        }
      }
    );

    overwriteCheckbox.addEventListener(
      'change',
      () => {
        setStoredBoolean(
          CONFIG.STORAGE.OVERWRITE,
          overwriteCheckbox.checked
        );
      }
    );

    continueCheckbox.addEventListener(
      'change',
      () => {
        setStoredBoolean(
          CONFIG.STORAGE
            .CONTINUE_ON_ERROR,
          continueCheckbox.checked
        );
      }
    );

    retryCheckbox.addEventListener(
      'change',
      () => {
        setStoredBoolean(
          CONFIG.STORAGE.RETRY_ONCE,
          retryCheckbox.checked
        );
      }
    );

    for (const eventName of [
      'dragenter',
      'dragover'
    ]) {
      dropZone.addEventListener(
        eventName,
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          dropZone.style.borderColor =
            '#8ab4f8';

          dropZone.style.background =
            '#1b2638';

          if (event.dataTransfer) {
            event.dataTransfer.dropEffect =
              state.running
                ? 'none'
                : 'copy';
          }
        }
      );
    }

    for (const eventName of [
      'dragleave',
      'drop'
    ]) {
      dropZone.addEventListener(
        eventName,
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          dropZone.style.borderColor =
            '#5f6368';

          dropZone.style.background =
            '#181818';
        }
      );
    }

    dropZone.addEventListener(
      'drop',
      async (event) => {
        if (state.running) {
          logLine(
            '[SYSTEM] An import is already running.'
          );

          return;
        }

        const files =
          Array.from(
            event.dataTransfer?.files ||
            []
          );

        if (files.length) {
          await handleSelectedFiles(
            files
          );
        }
      }
    );
  }

  function showPanel() {
    const panel = createPanel();

    panel.style.display = 'block';
  }

  // ==========================================================================
  // SECTION 12 — LOCAL FILE PROCESSING
  // ==========================================================================

  async function parseLocalFile(file) {
    const extension =
      getExtension(file.name);

    if (
      !CONFIG.SUPPORTED_EXTENSIONS
        .includes(extension)
    ) {
      return null;
    }

    const source = await file.text();

    const typeDetails =
      inferFileType(
        file.name,
        source
      );

    if (!typeDetails) {
      return null;
    }

    return {
      originalName: file.name,

      name:
        sanitizeAppsScriptName(
          file.name
        ),

      type:
        typeDetails.type,

      outputExtension:
        typeDetails.outputExtension,

      source:
        String(source ?? '')
    };
  }

  function deduplicateRecords(records) {
    const counts = new Map();
    const output = [];

    for (const record of records) {
      const key =
        `${record.type}:` +
        record.name.toLowerCase();

      const count =
        (counts.get(key) || 0) + 1;

      counts.set(key, count);

      if (count === 1) {
        output.push(record);
        continue;
      }

      const renamedRecord = {
        ...record,
        name:
          `${record.name}_v${count}`
      };

      logLine(
        '[SYSTEM] Duplicate input renamed to ' +
        getDisplayFilename(
          renamedRecord
        )
      );

      output.push(renamedRecord);
    }

    return output;
  }

  async function handleSelectedFiles(files) {
    if (state.running) {
      return;
    }

    clearLog();

    setPhase(
      PHASES.READ_LOCAL_FILES,
      `Reading ${files.length} selected file(s).`
    );

    const records = [];

    for (const file of files) {
      try {
        const record =
          await parseLocalFile(file);

        if (!record) {
          logLine(
            `[LOCAL] Unsupported file skipped: ${file.name}`
          );

          continue;
        }

        records.push(record);

        logLine(
          `[LOCAL] Loaded ${file.name} as ` +
          `${getDisplayFilename(record)} ` +
          `(${record.type}, ${record.source.length} characters).`
        );
      } catch (error) {
        logLine(
          `[LOCAL] Failed to read ${file.name}: ` +
          getErrorMessage(error)
        );
      }
    }

    const queue =
      deduplicateRecords(records);

    if (!queue.length) {
      setStatus(
        'No supported files were selected.',
        'warning'
      );

      state.currentPhase =
        PHASES.IDLE;

      return;
    }

    await runImportQueue(queue);
  }

  // ==========================================================================
  // SECTION 13 — PROJECT FILE TREE HELPERS
  // ==========================================================================

  function getProjectRows() {
    return Array.from(
      document.querySelectorAll(
        CONFIG.SELECTORS.PROJECT_ROW
      )
    );
  }

  function getProjectRowName(row) {
    if (!(row instanceof HTMLElement)) {
      return '';
    }

    const filenameElement =
      row.querySelector(
        CONFIG.SELECTORS
          .PROJECT_FILENAME
      );

    return normalizeText(
      filenameElement?.getAttribute(
        'title'
      ) ||
      filenameElement?.textContent ||
      row.getAttribute(
        'aria-label'
      )
    )
      .replace(/\s+unsaved$/i, '')
      .trim();
  }

  function getProjectRowIdentity(row) {
    return (
      row.getAttribute(
        'data-res-id'
      ) ||
      row.getAttribute(
        'data-index'
      ) ||
      getProjectRowName(row)
    );
  }

  function snapshotProjectRows() {
    return new Set(
      getProjectRows().map(
        getProjectRowIdentity
      )
    );
  }

  function findNewProjectRow(
    previousRows,
    expectedExtension
  ) {
    const candidates =
      getProjectRows().filter(
        (row) =>
          !previousRows.has(
            getProjectRowIdentity(row)
          )
      );

    return (
      candidates.find((row) => {
        const rowName =
          getProjectRowName(row);

        const extension =
          getExtension(rowName);

        return (
          !extension ||
          extension ===
            expectedExtension
        );
      }) ||
      null
    );
  }

  function findExistingProjectRow(record) {
    const expectedStem =
      record.name.toLowerCase();

    const expectedExtension =
      record.outputExtension;

    return (
      getProjectRows().find((row) => {
        const rowName =
          getProjectRowName(row);

        return (
          stripFinalExtension(
            rowName
          ).toLowerCase() ===
            expectedStem &&
          getExtension(rowName) ===
            expectedExtension
        );
      }) ||
      null
    );
  }

  function findTemporaryProjectRow(record) {
    return (
      getProjectRows().find((row) => {
        const rowName =
          getProjectRowName(row);

        return (
          /^untitled(?:\s*\(\d+\))?\./i
            .test(rowName) &&
          getExtension(rowName) ===
            record.outputExtension
        );
      }) ||
      null
    );
  }

  function isProjectRowSelected(row) {
    if (!(row instanceof HTMLElement)) {
      return false;
    }

    return (
      row.getAttribute(
        'aria-selected'
      ) === 'true' ||
      row.classList.contains(
        'UeVsd'
      ) ||
      document.querySelector(
        `${CONFIG.SELECTORS.PROJECT_ROW}[aria-selected="true"]`
      ) === row
    );
  }

  async function selectProjectRow(row) {
    if (!(row instanceof HTMLElement)) {
      throw new ImporterError(
        PHASES.SELECT_PROJECT_FILE,
        'The requested project row does not exist.'
      );
    }

    setPhase(
      PHASES.SELECT_PROJECT_FILE,
      `Selecting ${getProjectRowName(row)}.`
    );

    const target =
      row.querySelector(
        CONFIG.SELECTORS
          .PROJECT_FILENAME
      ) || row;

    realClick(target);

    await waitFor(
      () =>
        isProjectRowSelected(row)
          ? row
          : null,
      CONFIG.TIMEOUTS.ROW_SELECTION_MS,
      `selection of ${getProjectRowName(row)}`
    );

    await sleep(
      CONFIG.DELAYS.AFTER_ROW_SELECT_MS
    );

    return row;
  }

  // ==========================================================================
  // SECTION 14 — ADD-FILE MENU
  // ==========================================================================

  function findAddFileButton() {
    const button =
      document.querySelector(
        CONFIG.SELECTORS.ADD_FILE_BUTTON
      );

    if (
      button instanceof HTMLElement &&
      isVisible(button) &&
      button.getAttribute(
        'aria-disabled'
      ) !== 'true'
    ) {
      return button;
    }

    return null;
  }

  function findVisibleAddMenu() {
    return (
      Array.from(
        document.querySelectorAll(
          CONFIG.SELECTORS.ADD_MENU
        )
      ).find(isVisible) ||
      null
    );
  }

  function findVisibleFileTypeMenuItem(record) {
    const selector =
      record.type === 'HTML'
        ? CONFIG.SELECTORS
            .HTML_MENU_ITEM
        : CONFIG.SELECTORS
            .SCRIPT_MENU_ITEM;

    return (
      Array.from(
        document.querySelectorAll(
          selector
        )
      ).find((item) => {
        if (!isVisible(item)) {
          return false;
        }

        const menu =
          item.closest(
            CONFIG.SELECTORS.ADD_MENU
          );

        return Boolean(
          menu &&
          isVisible(menu)
        );
      }) ||
      null
    );
  }

  async function openAddFileMenu() {
    setPhase(
      PHASES.OPEN_ADD_MENU,
      'Opening Add a file menu.'
    );

    let lastError = null;

    for (
      let attempt = 0;
      attempt <=
        CONFIG.MAX_MENU_RETRIES;
      attempt++
    ) {
      try {
        const button =
          await waitFor(
            findAddFileButton,
            CONFIG.TIMEOUTS.ELEMENT_MS,
            'Add a file button'
          );

        const existingMenu =
          findVisibleAddMenu();

        if (existingMenu) {
          return {
            button,
            menu: existingMenu
          };
        }

        realClick(button);

        await sleep(
          CONFIG.DELAYS
            .AFTER_ADD_CLICK_MS
        );

        const menu =
          await waitFor(
            findVisibleAddMenu,
            CONFIG.TIMEOUTS.MENU_MS,
            'visible Add a file menu'
          );

        return {
          button,
          menu
        };
      } catch (error) {
        lastError = error;

        if (
          attempt <
          CONFIG.MAX_MENU_RETRIES
        ) {
          logLine(
            `[RETRY] Add menu attempt ${attempt + 1} failed: ` +
            getErrorMessage(error)
          );

          await sleep(300);
        }
      }
    }

    throw lastError;
  }

  // ==========================================================================
  // SECTION 15 — SCRIPT / HTML MENU ACTIVATION
  // ==========================================================================

  async function activateFileTypeMenuItem(
    record,
    menuContext
  ) {
    const label =
      record.type === 'HTML'
        ? 'HTML'
        : 'Script';

    setPhase(
      PHASES.FIND_FILE_TYPE_ITEM,
      `Finding ${label} menu item.`
    );

    const menuItem =
      await waitFor(
        () =>
          findVisibleFileTypeMenuItem(
            record
          ),
        CONFIG.TIMEOUTS.MENU_MS,
        `${label} menu item`
      );

    setPhase(
      PHASES.ACTIVATE_FILE_TYPE,
      `Activating ${label} through keyboard focus.`
    );

    const originalTabIndex =
      menuItem.getAttribute(
        'tabindex'
      );

    let exactActivationSucceeded =
      false;

    try {
      menuItem.setAttribute(
        'tabindex',
        '0'
      );

      safeFocus(menuItem);

      await sleep(
        CONFIG.DELAYS
          .AFTER_MENU_FOCUS_MS
      );

      if (
        document.activeElement ===
        menuItem
      ) {
        dispatchEnter(menuItem);

        exactActivationSucceeded =
          true;

        await sleep(
          CONFIG.DELAYS
            .AFTER_MENU_ACTIVATION_MS
        );
      }
    } finally {
      if (originalTabIndex === null) {
        menuItem.removeAttribute(
          'tabindex'
        );
      } else {
        menuItem.setAttribute(
          'tabindex',
          originalTabIndex
        );
      }
    }

    if (exactActivationSucceeded) {
      return;
    }

    logLine(
      `[FALLBACK] Exact ${label} item did not receive focus. ` +
      'Using the known keyboard menu sequence.'
    );

    const menu =
      menuContext.menu;

    safeFocus(menu);

    const arrowCount =
      record.type === 'HTML'
        ? 2
        : 1;

    for (
      let index = 0;
      index < arrowCount;
      index++
    ) {
      dispatchArrowDown(menu);
      await sleep(100);
    }

    dispatchEnter(menu);

    await sleep(
      CONFIG.DELAYS
        .AFTER_MENU_ACTIVATION_MS
    );
  }

  // ==========================================================================
  // SECTION 16 — NEW ROW CREATION
  // ==========================================================================

  async function createNewProjectRow(record) {
    const priorRows =
      snapshotProjectRows();

    const menuContext =
      await openAddFileMenu();

    await activateFileTypeMenuItem(
      record,
      menuContext
    );

    setPhase(
      PHASES.WAIT_FOR_NEW_ROW,
      `Waiting for a new .${record.outputExtension} row.`
    );

    const row =
      await waitFor(
        () =>
          findNewProjectRow(
            priorRows,
            record.outputExtension
          ),
        CONFIG.TIMEOUTS.NEW_ROW_MS,
        `new ${record.outputExtension} project row`
      );

    const activeElementAtCreation =
      document.activeElement;

    await sleep(
      CONFIG.DELAYS.AFTER_NEW_ROW_MS
    );

    logLine(
      `[CREATE] New row detected: ${getProjectRowName(row)}`
    );

    logLine(
      `[CREATE] Active element at creation: ` +
      describeElement(
        activeElementAtCreation
      )
    );

    return {
      row,
      activeElementAtCreation
    };
  }

  // ==========================================================================
  // SECTION 17 — RENAME TARGET DISCOVERY
  // ==========================================================================

  function findRenameTarget(
    context,
    record
  ) {
    const {
      row,
      activeElementAtCreation
    } = context;

    if (
      isEditableElement(
        activeElementAtCreation
      ) &&
      normalizeText(
        readEditableValue(
          activeElementAtCreation
        )
      ).toLowerCase().includes(
        'untitled'
      )
    ) {
      return activeElementAtCreation;
    }

    const rowTarget =
      row.querySelector(
        'input, textarea, [contenteditable="true"]'
      );

    if (
      isEditableElement(rowTarget)
    ) {
      return rowTarget;
    }

    const knownRenameInputs =
      Array.from(
        document.querySelectorAll(
          CONFIG.SELECTORS.RENAME_INPUT
        )
      );

    const matchingKnownInput =
      knownRenameInputs.find(
        (input) =>
          normalizeText(
            readEditableValue(input)
          ).toLowerCase().includes(
            'untitled'
          )
      );

    if (matchingKnownInput) {
      return matchingKnownInput;
    }

    const allEditable =
      Array.from(
        document.querySelectorAll(
          'input, textarea, [contenteditable="true"]'
        )
      );

    return (
      allEditable.find((element) => {
        if (
          !isEditableElement(element)
        ) {
          return false;
        }

        const value =
          normalizeText(
            readEditableValue(element)
          ).toLowerCase();

        return (
          value.includes('untitled') ||
          value.endsWith(
            `.${record.outputExtension}`
          )
        );
      }) ||
      null
    );
  }

  async function captureRenameTarget(
    context,
    record
  ) {
    setPhase(
      PHASES.CAPTURE_RENAME_TARGET,
      'Capturing Google’s inline filename input.'
    );

    const target =
      await waitFor(
        () =>
          findRenameTarget(
            context,
            record
          ),
        CONFIG.TIMEOUTS.RENAME_TARGET_MS,
        'inline filename input'
      );

    logLine(
      `[RENAME] Target: ${describeElement(target)}`
    );

    logLine(
      `[RENAME] Value before typing: "${readEditableValue(target)}"`
    );

    return target;
  }

  // ==========================================================================
  // SECTION 18 — RENAME COMMIT TARGET
  // ==========================================================================

  function findSafeRenameCommitTarget() {
    const editorBackground =
      Array.from(
        document.querySelectorAll(
          CONFIG.SELECTORS
            .EDITOR_BACKGROUND
        )
      ).find(isVisible);

    if (editorBackground) {
      return editorBackground;
    }

    const editorView =
      Array.from(
        document.querySelectorAll(
          CONFIG.SELECTORS.EDITOR_VIEW
        )
      ).find(isVisible);

    if (editorView) {
      return editorView;
    }

    const editorRoot =
      Array.from(
        document.querySelectorAll(
          CONFIG.SELECTORS.EDITOR_ROOT
        )
      ).find(isVisible);

    if (editorRoot) {
      return editorRoot;
    }

    return (
      document.querySelector('main') ||
      document.body
    );
  }

  // ==========================================================================
  // SECTION 19 — RENAME VERIFICATION HELPERS
  // ==========================================================================

  function resolveCommittedProjectRow(
    originalRow,
    record
  ) {
    const expectedName =
      getDisplayFilename(record)
        .toLowerCase();

    const originalRowName =
      getProjectRowName(
        originalRow
      ).toLowerCase();

    if (
      originalRowName ===
      expectedName
    ) {
      return originalRow;
    }

    return (
      findExistingProjectRow(
        record
      ) ||
      null
    );
  }

  async function verifyCommittedRename(
    originalRow,
    record,
    timeoutMilliseconds,
    description
  ) {
    return await waitFor(
      () =>
        resolveCommittedProjectRow(
          originalRow,
          record
        ),
      timeoutMilliseconds,
      description
    );
  }

  // ==========================================================================
  // SECTION 20 — TYPE AND COMMIT FILENAME
  // ==========================================================================
  //
  // Primary method:
  // 1. Type the filename.
  // 2. Press Enter.
  // 3. Wait 4.5 seconds.
  // 4. Verify the committed project row.
  //
  // Fallback method:
  // 1. Click outside the filename input.
  // 2. Wait another 4.5 seconds.
  // 3. Verify again.
  //
  // ==========================================================================

  async function typeAndCommitFilename(
    row,
    renameTarget,
    record
  ) {
    const expectedFullName =
      getDisplayFilename(record);

    setPhase(
      PHASES.TYPE_FILENAME,
      `Typing filename stem "${record.name}".`
    );

    safeFocus(renameTarget);
    dispatchSelectAll(renameTarget);

    await sleep(
      CONFIG.DELAYS.AFTER_SELECT_ALL_MS
    );

    const inserted =
      insertTextThroughFocusedControl(
        renameTarget,
        record.name
      );

    if (!inserted) {
      throw new ImporterError(
        PHASES.TYPE_FILENAME,
        'The filename input rejected the new filename.'
      );
    }

    await sleep(
      CONFIG.DELAYS
        .AFTER_NAME_INSERT_MS
    );

    setPhase(
      PHASES.VERIFY_FILENAME_INPUT,
      'Verifying the filename input contains the requested name.'
    );

    const typedValue =
      normalizeText(
        readEditableValue(
          renameTarget
        )
      );

    const acceptedValues =
      new Set([
        record.name.toLowerCase(),
        expectedFullName.toLowerCase()
      ]);

    if (
      typedValue &&
      !acceptedValues.has(
        typedValue.toLowerCase()
      )
    ) {
      throw new ImporterError(
        PHASES.VERIFY_FILENAME_INPUT,
        `The filename input contains "${typedValue}" instead of "${record.name}".`
      );
    }

    // ------------------------------------------------------------------------
    // PRIMARY RENAME COMMIT — PRESS ENTER
    // ------------------------------------------------------------------------

    setPhase(
      PHASES.COMMIT_RENAME_ENTER,
      'Pressing Enter to commit the filename.'
    );

    safeFocus(renameTarget);
    dispatchEnter(renameTarget);

    logLine(
      `[RENAME] Enter dispatched. Waiting ` +
      `${CONFIG.DELAYS.AFTER_RENAME_ENTER_MS / 1000} seconds for Google.`
    );

    await sleep(
      CONFIG.DELAYS
        .AFTER_RENAME_ENTER_MS
    );

    let committedRow =
      resolveCommittedProjectRow(
        row,
        record
      );

    if (committedRow) {
      logLine(
        `[RENAME] Enter committed: ${expectedFullName}`
      );

      return committedRow;
    }

    setPhase(
      PHASES.VERIFY_RENAME_ENTER,
      `Enter did not yet show "${expectedFullName}".`
    );

    try {
      committedRow =
        await verifyCommittedRename(
          row,
          record,
          CONFIG.TIMEOUTS
            .RENAME_FINAL_VERIFY_MS,
          `filename ${expectedFullName} after Enter`
        );

      logLine(
        `[RENAME] Enter commit confirmed: ${expectedFullName}`
      );

      return committedRow;
    } catch (enterVerificationError) {
      logLine(
        '[RENAME] Enter did not visibly commit the filename. ' +
        'Using outside-click fallback.'
      );
    }

    // ------------------------------------------------------------------------
    // FALLBACK RENAME COMMIT — CLICK OUTSIDE
    // ------------------------------------------------------------------------

    setPhase(
      PHASES.COMMIT_RENAME_FALLBACK,
      'Clicking outside the filename input.'
    );

    const outsideTarget =
      await waitFor(
        findSafeRenameCommitTarget,
        CONFIG.TIMEOUTS.ELEMENT_MS,
        'safe area outside the filename input'
      );

    realClick(outsideTarget);

    logLine(
      `[RENAME] Outside click dispatched. Waiting ` +
      `${CONFIG.DELAYS.AFTER_RENAME_FALLBACK_MS / 1000} seconds for Google.`
    );

    await sleep(
      CONFIG.DELAYS
        .AFTER_RENAME_FALLBACK_MS
    );

    committedRow =
      resolveCommittedProjectRow(
        row,
        record
      );

    if (committedRow) {
      logLine(
        `[RENAME] Outside-click commit confirmed: ${expectedFullName}`
      );

      return committedRow;
    }

    setPhase(
      PHASES.VERIFY_RENAME_FALLBACK,
      `Waiting for "${expectedFullName}" after outside click.`
    );

    try {
      committedRow =
        await verifyCommittedRename(
          row,
          record,
          CONFIG.TIMEOUTS
            .RENAME_FINAL_VERIFY_MS,
          `filename ${expectedFullName} after outside click`
        );

      logLine(
        `[RENAME] Outside-click commit confirmed: ${expectedFullName}`
      );

      return committedRow;
    } catch (fallbackVerificationError) {
      // Continue into one final delayed recovery check.
    }

    // ------------------------------------------------------------------------
    // FINAL DELAYED RECOVERY
    // ------------------------------------------------------------------------

    setPhase(
      PHASES.RECOVER_RENAME,
      'Performing final delayed rename recovery check.'
    );

    logLine(
      '[RENAME] Filename is still not visible. ' +
      'No additional file will be created during this recovery wait.'
    );

    await sleep(
      CONFIG.DELAYS
        .RENAME_FINAL_RECOVERY_MS
    );

    committedRow =
      resolveCommittedProjectRow(
        row,
        record
      );

    if (committedRow) {
      logLine(
        `[RENAME] Delayed commit recovered: ${expectedFullName}`
      );

      return committedRow;
    }

    throw new ImporterError(
      PHASES.RECOVER_RENAME,
      `The filename did not commit as "${expectedFullName}".`,
      {
        currentOriginalRowName:
          getProjectRowName(row),

        renameInputValue:
          readEditableValue(
            renameTarget
          )
      }
    );
  }

  // ==========================================================================
  // SECTION 21 — MONACO EDITOR DISCOVERY
  // ==========================================================================

  function findEditorSurface() {
    return (
      Array.from(
        document.querySelectorAll(
          CONFIG.SELECTORS.EDITOR_ROOT
        )
      ).find(isVisible) ||
      Array.from(
        document.querySelectorAll(
          CONFIG.SELECTORS.EDITOR_VIEW
        )
      ).find(isVisible) ||
      null
    );
  }

  async function getMonaco() {
    if (
      unsafeWindow.monaco?.editor
    ) {
      return unsafeWindow.monaco;
    }

    if (
      window.monaco?.editor
    ) {
      return window.monaco;
    }

    if (
      typeof unsafeWindow.require ===
      'function'
    ) {
      try {
        const loaded =
          await new Promise(
            (resolve, reject) => {
              unsafeWindow.require(
                [
                  'vs/editor/editor.main'
                ],
                () => {
                  resolve(
                    unsafeWindow.monaco ||
                    window.monaco
                  );
                },
                reject
              );
            }
          );

        if (loaded?.editor) {
          return loaded;
        }
      } catch (error) {
        console.debug(
          '[GAS Importer] Monaco require fallback failed:',
          error
        );
      }
    }

    return await waitFor(
      () =>
        unsafeWindow.monaco?.editor
          ? unsafeWindow.monaco
          : window.monaco?.editor
            ? window.monaco
            : null,
      CONFIG.TIMEOUTS.MONACO_MS,
      'Monaco editor API'
    );
  }

  function getMonacoEditors(monaco) {
    try {
      return (
        monaco.editor.getEditors?.() ||
        []
      );
    } catch (error) {
      console.debug(
        '[GAS Importer] Monaco editor enumeration failed:',
        error
      );

      return [];
    }
  }

  function getVisibleMonacoEditor(monaco) {
    const editors =
      getMonacoEditors(monaco);

    return (
      editors.find((editor) => {
        try {
          const node =
            editor.getDomNode?.();

          return Boolean(
            node &&
            isVisible(node) &&
            editor.getModel?.()
          );
        } catch {
          return false;
        }
      }) ||
      editors.find(
        (editor) =>
          editor.hasTextFocus?.() &&
          editor.getModel?.()
      ) ||
      editors.find(
        (editor) =>
          editor.getModel?.()
      ) ||
      null
    );
  }

  function getCurrentEditorSnapshot(monaco) {
    const editor =
      getVisibleMonacoEditor(monaco);

    const model =
      editor?.getModel?.() ||
      null;

    return {
      editor,
      model,
      uri:
        String(model?.uri ?? ''),
      version:
        model?.getVersionId?.() ??
        null
    };
  }

  async function waitForSelectedEditorModel(
    row,
    previousSnapshot = null
  ) {
    setPhase(
      PHASES.WAIT_FOR_EDITOR_MODEL,
      `Waiting for editor model for ${getProjectRowName(row)}.`
    );

    const monaco =
      await getMonaco();

    return await waitFor(
      () => {
        if (!isProjectRowSelected(row)) {
          return null;
        }

        const editor =
          getVisibleMonacoEditor(
            monaco
          );

        const model =
          editor?.getModel?.();

        if (!editor || !model) {
          return null;
        }

        return {
          monaco,
          editor,
          model,
          previousSnapshot
        };
      },
      CONFIG.TIMEOUTS.MODEL_SWITCH_MS,
      `Monaco model for ${getProjectRowName(row)}`
    );
  }

  // ==========================================================================
  // SECTION 22 — SOURCE INSERTION AND VERIFICATION
  // ==========================================================================

  async function writeSourceToModel(
    editorContext,
    source
  ) {
    const expected =
      String(source ?? '');

    const {
      editor,
      model
    } = editorContext;

    if (!model?.setValue) {
      throw new ImporterError(
        PHASES.WRITE_SOURCE,
        'The active Monaco model cannot accept source text.'
      );
    }

    setPhase(
      PHASES.WRITE_SOURCE,
      `Writing ${expected.length} characters.`
    );

    model.setValue(expected);

    try {
      editor.setPosition?.({
        lineNumber: 1,
        column: 1
      });

      editor.revealPosition?.({
        lineNumber: 1,
        column: 1
      });

      editor.focus?.();
    } catch (error) {
      console.debug(
        '[GAS Importer] Monaco positioning failed:',
        error
      );
    }

    await sleep(
      CONFIG.DELAYS
        .AFTER_SOURCE_WRITE_MS
    );

    setPhase(
      PHASES.VERIFY_SOURCE,
      'Verifying complete editor contents.'
    );

    const actual =
      String(
        model.getValue?.() ?? ''
      );

    if (actual !== expected) {
      throw new ImporterError(
        PHASES.VERIFY_SOURCE,
        'The editor content does not match the imported file.',
        {
          expectedCharacters:
            expected.length,
          actualCharacters:
            actual.length,
          modelUri:
            String(model.uri ?? '')
        }
      );
    }

    logLine(
      `[SOURCE] Verified ${actual.length} characters.`
    );
  }

  // ==========================================================================
  // SECTION 23 — CODE SAVE
  // ==========================================================================

  async function saveCurrentProject() {
    setPhase(
      PHASES.SAVE_PROJECT,
      'Dispatching project save.'
    );

    const target =
      document.activeElement ||
      document.body;

    dispatchSaveShortcut(target);

    await sleep(
      CONFIG.DELAYS.AFTER_SAVE_MS
    );

    logLine(
      '[SAVE] Save shortcut dispatched.'
    );
  }

  // ==========================================================================
  // SECTION 24 — EXISTING-FILE REPLACEMENT
  // ==========================================================================

  async function replaceExistingRecord(
    row,
    record
  ) {
    const monaco =
      await getMonaco();

    const previousSnapshot =
      getCurrentEditorSnapshot(
        monaco
      );

    await selectProjectRow(row);

    const editorSurface =
      await waitFor(
        findEditorSurface,
        CONFIG.TIMEOUTS.MONACO_MS,
        'code editor surface'
      );

    realClick(editorSurface);

    await sleep(
      CONFIG.DELAYS
        .AFTER_EDITOR_CLICK_MS
    );

    const editorContext =
      await waitForSelectedEditorModel(
        row,
        previousSnapshot
      );

    await writeSourceToModel(
      editorContext,
      record.source
    );

    await saveCurrentProject();
  }

  // ==========================================================================
  // SECTION 25 — NEW-FILE CREATION
  // ==========================================================================

  async function createNewRecord(record) {
    const alreadyCommittedRow =
      findExistingProjectRow(record);

    if (alreadyCommittedRow) {
      logLine(
        `[RECOVERY] ${getDisplayFilename(record)} already exists. ` +
        'Continuing with source insertion.'
      );

      await replaceExistingRecord(
        alreadyCommittedRow,
        record
      );

      return;
    }

    let context;

    const temporaryRow =
      findTemporaryProjectRow(record);

    if (temporaryRow) {
      logLine(
        `[RECOVERY] Reusing temporary row: ` +
        `${getProjectRowName(temporaryRow)}`
      );

      context = {
        row: temporaryRow,
        activeElementAtCreation:
          document.activeElement
      };
    } else {
      context =
        await createNewProjectRow(
          record
        );
    }

    const renameTarget =
      await captureRenameTarget(
        context,
        record
      );

    const committedRow =
      await typeAndCommitFilename(
        context.row,
        renameTarget,
        record
      );

    const monaco =
      await getMonaco();

    const previousSnapshot =
      getCurrentEditorSnapshot(
        monaco
      );

    await selectProjectRow(
      committedRow
    );

    const editorSurface =
      await waitFor(
        findEditorSurface,
        CONFIG.TIMEOUTS.MONACO_MS,
        'code editor surface'
      );

    realClick(editorSurface);

    await sleep(
      CONFIG.DELAYS
        .AFTER_EDITOR_CLICK_MS
    );

    const editorContext =
      await waitForSelectedEditorModel(
        committedRow,
        previousSnapshot
      );

    await writeSourceToModel(
      editorContext,
      record.source
    );

    await saveCurrentProject();
  }

  // ==========================================================================
  // SECTION 26 — SINGLE-FILE STATE MACHINE
  // ==========================================================================

  async function importSingleRecord(record) {
    state.currentRecord = record;
    state.currentFilename =
      getDisplayFilename(record);

    setPhase(
      PHASES.CHECK_EXISTING_FILE,
      `Checking for ${state.currentFilename}.`
    );

    const existingRow =
      findExistingProjectRow(record);

    const overwrite =
      document.getElementById(
        CONFIG.IDS.OVERWRITE
      )?.checked ?? true;

    if (existingRow) {
      if (!overwrite) {
        state.skipped++;

        logLine(
          `[SKIP] Existing file preserved: ${state.currentFilename}`
        );

        return;
      }

      logLine(
        `[EXISTING] Replacing ${state.currentFilename}.`
      );

      await replaceExistingRecord(
        existingRow,
        record
      );

      state.completed++;

      setPhase(
        PHASES.COMPLETE,
        `Replaced ${state.currentFilename}.`
      );

      return;
    }

    logLine(
      `[NEW] Creating ${state.currentFilename}.`
    );

    await createNewRecord(record);

    state.completed++;

    setPhase(
      PHASES.COMPLETE,
      `Created ${state.currentFilename}.`
    );
  }

  // ==========================================================================
  // SECTION 27 — IMPORT QUEUE
  // ==========================================================================

  async function runImportQueue(records) {
    state.running = true;
    state.stopRequested = false;

    state.currentPhase =
      PHASES.PREPARE_QUEUE;

    state.currentIndex = 0;
    state.currentFilename = '';
    state.currentRecord = null;
    state.lastError = null;

    state.total = records.length;
    state.completed = 0;
    state.skipped = 0;
    state.failed = 0;

    updateProgress();

    setStatus(
      `Importing ${records.length} file(s)…`,
      'info'
    );

    logLine(
      `[SYSTEM] Starting sequential import of ${records.length} file(s).`
    );

    const continueOnError =
      document.getElementById(
        CONFIG.IDS.CONTINUE_ON_ERROR
      )?.checked ?? true;

    const retryOnce =
      document.getElementById(
        CONFIG.IDS.RETRY_ONCE
      )?.checked ?? true;

    try {
      await waitFor(
        () =>
          document.querySelector(
            CONFIG.SELECTORS.PROJECT_LIST
          ),
        CONFIG.TIMEOUTS.ELEMENT_MS,
        'Apps Script project file list'
      );

      for (
        let index = 0;
        index < records.length;
        index++
      ) {
        if (state.stopRequested) {
          state.currentPhase =
            PHASES.STOPPED;

          logLine(
            `[SYSTEM] Import stopped before file ${index + 1}.`
          );

          break;
        }

        const record = records[index];

        state.currentIndex =
          index + 1;

        state.currentFilename =
          getDisplayFilename(record);

        setStatus(
          `Processing ${index + 1} of ${records.length}: ` +
          state.currentFilename,
          'info'
        );

        logLine('');
        logLine(
          `[FILE] ${index + 1}/${records.length}: ` +
          state.currentFilename
        );

        const maximumAttempts =
          retryOnce ? 2 : 1;

        let succeeded = false;
        let lastError = null;

        for (
          let attempt = 1;
          attempt <= maximumAttempts;
          attempt++
        ) {
          try {
            if (attempt > 1) {
              logLine(
                `[RETRY] Recovering and retrying ${state.currentFilename}.`
              );

              await sleep(
                CONFIG.DELAYS
                  .RENAME_FINAL_RECOVERY_MS
              );
            }

            await importSingleRecord(
              record
            );

            succeeded = true;
            break;
          } catch (error) {
            lastError = error;
            state.lastError = error;

            logLine(
              `[ERROR] Attempt ${attempt}/${maximumAttempts}: ` +
              getErrorMessage(error)
            );

            console.error(
              '[GAS Importer] File import failure:',
              {
                record,
                phase:
                  state.currentPhase,
                error
              }
            );

            if (
              attempt <
              maximumAttempts
            ) {
              await sleep(
                CONFIG.DELAYS
                  .RENAME_FINAL_RECOVERY_MS
              );
            }
          }
        }

        if (!succeeded) {
          state.failed++;
          state.currentPhase =
            PHASES.FAILED;

          logLine(
            `[FAILED] ${state.currentFilename}: ` +
            getErrorMessage(lastError)
          );

          runDiagnostics();

          if (!continueOnError) {
            logLine(
              '[SYSTEM] Stopping because Continue after a file fails is disabled.'
            );

            break;
          }
        }

        updateProgress();

        await sleep(
          CONFIG.DELAYS.BETWEEN_FILES_MS
        );
      }
    } catch (error) {
      state.lastError = error;
      state.currentPhase =
        PHASES.FAILED;

      logLine(
        '[SYSTEM ERROR] ' +
        getErrorMessage(error)
      );

      console.error(
        '[GAS Importer] Queue failure:',
        error
      );
    } finally {
      state.running = false;
      state.currentRecord = null;

      updateProgress();

      if (state.stopRequested) {
        setStatus(
          `Stopped. Imported ${state.completed}; ` +
          `skipped ${state.skipped}; failed ${state.failed}.`,
          'warning'
        );
      } else if (state.failed > 0) {
        setStatus(
          `Finished with ${state.failed} failure(s).`,
          'error'
        );
      } else {
        setStatus(
          `Import complete. Imported ${state.completed}; ` +
          `skipped ${state.skipped}.`,
          'success'
        );
      }

      logLine('');
      logLine(
        '[SYSTEM] Finished. ' +
        `Imported: ${state.completed}; ` +
        `Skipped: ${state.skipped}; ` +
        `Failed: ${state.failed}.`
      );

      state.currentPhase =
        PHASES.IDLE;
    }
  }

  // ==========================================================================
  // SECTION 28 — READ-ONLY DIAGNOSTICS
  // ==========================================================================

  function runDiagnostics() {
    try {
      logLine('');
      logLine(
        '================ DIAGNOSTICS ================'
      );

      logLine(
        `[DIAG] Phase: ${state.currentPhase}`
      );

      logLine(
        `[DIAG] Current file: ${state.currentFilename || 'none'}`
      );

      logLine(
        `[DIAG] Active element: ${describeElement(document.activeElement)}`
      );

      if (
        isEditableElement(
          document.activeElement
        )
      ) {
        logLine(
          `[DIAG] Active editable value: ` +
          `"${readEditableValue(document.activeElement)}"`
        );
      }

      const addButton =
        findAddFileButton();

      const addMenu =
        findVisibleAddMenu();

      logLine(
        `[DIAG] Add button: ${addButton ? 'found' : 'not found'}`
      );

      logLine(
        `[DIAG] Add menu: ${addMenu ? 'visible' : 'not visible'}`
      );

      const rows =
        getProjectRows();

      logLine(
        `[DIAG] Project rows: ${rows.length}`
      );

      for (const row of rows) {
        logLine(
          `[DIAG] Row: ${getProjectRowName(row)} | ` +
          `identity=${getProjectRowIdentity(row)} | ` +
          `selected=${isProjectRowSelected(row)}`
        );
      }

      const renameInputs =
        Array.from(
          document.querySelectorAll(
            CONFIG.SELECTORS.RENAME_INPUT
          )
        );

      logLine(
        `[DIAG] Rename inputs found: ${renameInputs.length}`
      );

      renameInputs.forEach(
        (input, index) => {
          logLine(
            `[DIAG] Rename input ${index + 1}: ` +
            `value="${readEditableValue(input)}" | ` +
            `visible=${isVisible(input)}`
          );
        }
      );

      const monaco =
        unsafeWindow.monaco ||
        window.monaco;

      if (monaco?.editor) {
        const editors =
          getMonacoEditors(monaco);

        logLine(
          `[DIAG] Monaco editors: ${editors.length}`
        );

        editors.forEach(
          (editor, index) => {
            const model =
              editor.getModel?.();

            logLine(
              `[DIAG] Editor ${index + 1}: ` +
              `visible=${Boolean(
                editor.getDomNode?.() &&
                isVisible(
                  editor.getDomNode()
                )
              )} | ` +
              `focused=${Boolean(
                editor.hasTextFocus?.()
              )} | ` +
              `uri=${String(
                model?.uri ?? ''
              )} | ` +
              `characters=${
                model?.getValue?.()
                  .length ?? 0
              }`
            );
          }
        );
      } else {
        logLine(
          '[DIAG] Monaco API is not currently exposed.'
        );
      }

      if (state.lastError) {
        logLine(
          `[DIAG] Last error: ${getErrorMessage(state.lastError)}`
        );
      }

      logLine(
        '============== END DIAGNOSTICS =============='
      );

      logLine('');
    } catch (error) {
      console.error(
        '[GAS Importer] Diagnostics failed:',
        error
      );

      logLine(
        '[DIAG ERROR] ' +
        getErrorMessage(error)
      );
    }
  }

  // ==========================================================================
  // SECTION 29 — EMERGENCY STARTUP ERROR PANEL
  // ==========================================================================

  function createEmergencyErrorPanel(error) {
    try {
      const existing =
        document.getElementById(
          'tm-gas-importer-emergency'
        );

      if (existing) {
        existing.remove();
      }

      const panel =
        document.createElement('div');

      panel.id =
        'tm-gas-importer-emergency';

      panel.textContent =
        'GAS File Script Importer startup error:\n\n' +
        String(
          error?.stack ||
          error?.message ||
          error
        );

      Object.assign(
        panel.style,
        {
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: '2147483647',
          width: '470px',
          maxHeight: '70vh',
          overflow: 'auto',
          padding: '15px',
          border:
            '2px solid #ff8a80',
          borderRadius: '10px',
          background: '#8b0000',
          color: '#ffffff',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          fontFamily:
            'ui-monospace,Menlo,Consolas,monospace',
          fontSize: '12px',
          lineHeight: '1.45',
          boxShadow:
            '0 8px 28px rgba(0,0,0,.45)'
        }
      );

      document.body.appendChild(panel);
    } catch (panelError) {
      console.error(
        '[GAS Importer] Emergency panel creation failed:',
        panelError
      );
    }
  }

  // ==========================================================================
  // SECTION 30 — INITIALIZATION AND PANEL REPAIR
  // ==========================================================================

  function initialize() {
    if (state.initialized) {
      return;
    }

    try {
      state.initialized = true;

      createPanel();
      showPanel();

      console.log(
        `[GAS Importer] v${CONFIG.VERSION} initialized.`
      );
    } catch (error) {
      state.initialized = false;

      console.error(
        '[GAS Importer] Initialization failed:',
        error
      );

      createEmergencyErrorPanel(error);
    }
  }

  setTimeout(
    initialize,
    CONFIG.DELAYS.STARTUP_MS
  );

  let panelRepairTimer = null;

  const panelObserver =
    new MutationObserver(() => {
      clearTimeout(panelRepairTimer);

      panelRepairTimer =
        setTimeout(
          () => {
            if (
              !document.getElementById(
                CONFIG.IDS.PANEL
              )
            ) {
              try {
                createPanel();
              } catch (error) {
                console.error(
                  '[GAS Importer] Panel repair failed:',
                  error
                );

                createEmergencyErrorPanel(
                  error
                );
              }
            }
          },
          250
        );
    });

  panelObserver.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );

  /*
    Ctrl + Alt + I reopens the importer panel.
  */

  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.ctrlKey &&
        event.altKey &&
        (
          event.key === 'i' ||
          event.key === 'I'
        )
      ) {
        event.preventDefault();

        try {
          showPanel();
        } catch (error) {
          createEmergencyErrorPanel(
            error
          );
        }
      }
    },
    {
      passive: false
    }
  );
})();