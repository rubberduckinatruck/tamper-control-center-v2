// ==UserScript==
// @name         Wayground Gradebook Points Extractor
// @namespace    https://wayground.com/
// @version      1.0.0
// @description  Preview and copy canonical student names, best-attempt raw points, and Missing comments from Wayground reports.
// @author       Big Poppa
//
// @cc-id            wayground-gradebook-points-extractor
// @cc-display-name  Wayground Gradebook Points Extractor
// @cc-category      wayground
// @cc-role          teaching
// @cc-status        live
// @cc-tags          gradebook, reports, points, student names, missing
// @match        https://wayground.com/session/admin/reports
// @match        https://wayground.com/session/admin/reports/*
// @grant        GM_setClipboard
// @noframes
// @run-at       document-idle
//
// @updateURL    https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/wayground-gradebook-points-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/wayground-gradebook-points-extractor.user.js
//
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = Object.freeze({
    hostId: 'wg-gradebook-points-extractor-host',
    routePattern: /^\/session\/admin\/reports(?:\/|$)/,
    participantsTabSelector:
      '#report-tabs-tab-1, button[data-testid="report-tabs-tab-1"]',
    reportsContentSelector: '#reports-tabs-wrap',
    assignedCountSelector: '[data-testid="stats-total-players-value"]',
    attemptFilterSelector: '.attempt-filter',
    attemptDropdownSelector: '[data-testid="dropdown"]',
    attemptTitleSelector: '[data-testid="dropdown-title"]',
    participantNameClass: 'col-1',
    pointsClass: 'points',
    missingRowClass: 'not-started-player-chunk',
    pollIntervalMs: 150,
    routeCheckIntervalMs: 1000,
    tabTimeoutMs: 15000,
    tableTimeoutMs: 20000,
    filterTimeoutMs: 10000,
  });

  const state = {
    host: null,
    shadow: null,
    extractButton: null,
    panel: null,
    busy: false,
    lastResult: null,
  };

  function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isSupportedReportRoute() {
    return (
      window.location.hostname === 'wayground.com' &&
      CONFIG.routePattern.test(window.location.pathname)
    );
  }

  function sleep(milliseconds) {
    return new Promise((resolve) =>
      window.setTimeout(resolve, milliseconds),
    );
  }

  async function waitForCondition(check, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;
    const intervalMs = options.intervalMs ?? CONFIG.pollIntervalMs;
    const description =
      options.description ?? 'the page to become ready';
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const result = check();

        if (result) {
          return result;
        }
      } catch (error) {
        lastError = error;
      }

      await sleep(intervalMs);
    }

    const suffix =
      lastError instanceof Error ? ` (${lastError.message})` : '';

    throw new Error(
      `Timed out waiting for ${description}${suffix}.`,
    );
  }

  function createElement(tagName, options = {}) {
    const element = document.createElement(tagName);

    if (options.className) {
      element.className = options.className;
    }

    if (options.text !== undefined) {
      element.textContent = String(options.text);
    }

    if (options.type) {
      element.type = options.type;
    }

    return element;
  }

  function buildUi() {
    const host = document.createElement('div');
    host.id = CONFIG.hostId;

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');

    style.textContent = `
      :host {
        all: initial;
        font-family: Arial, Helvetica, sans-serif;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .wg-launcher {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        border: 0;
        border-radius: 10px;
        padding: 11px 18px;
        background: #6d28d9;
        color: #ffffff;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        cursor: pointer;
        font: 700 14px/1 Arial, Helvetica, sans-serif;
      }

      .wg-launcher:hover:not(:disabled) {
        background: #5b21b6;
      }

      .wg-launcher:focus-visible,
      .wg-button:focus-visible {
        outline: 3px solid #c4b5fd;
        outline-offset: 2px;
      }

      .wg-launcher:disabled {
        cursor: wait;
        opacity: 0.78;
      }

      .wg-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(17, 24, 39, 0.46);
      }

      .wg-panel {
        width: min(720px, 96vw);
        max-height: min(780px, 90vh);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #d1d5db;
        border-radius: 14px;
        background: #ffffff;
        color: #111827;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
        font: 14px/1.4 Arial, Helvetica, sans-serif;
      }

      .wg-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 20px 14px;
        border-bottom: 1px solid #e5e7eb;
      }

      .wg-title {
        margin: 0;
        font-size: 19px;
        line-height: 1.25;
      }

      .wg-subtitle {
        margin: 5px 0 0;
        color: #6b7280;
        font-size: 12px;
      }

      .wg-close {
        flex: 0 0 auto;
        border: 0;
        background: transparent;
        color: #4b5563;
        cursor: pointer;
        font: 700 22px/1 Arial, Helvetica, sans-serif;
      }

      .wg-content {
        min-height: 120px;
        overflow: auto;
        padding: 16px 20px;
      }

      .wg-status {
        margin: 0;
        color: #374151;
      }

      .wg-error {
        padding: 12px 14px;
        border: 1px solid #fecaca;
        border-radius: 8px;
        background: #fef2f2;
        color: #991b1b;
        white-space: pre-wrap;
      }

      .wg-summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 14px;
      }

      .wg-stat {
        padding: 9px 10px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #f9fafb;
      }

      .wg-stat-label {
        display: block;
        color: #6b7280;
        font-size: 11px;
      }

      .wg-stat-value {
        display: block;
        margin-top: 2px;
        font-size: 17px;
        font-weight: 700;
      }

      .wg-note {
        margin: 0 0 12px;
        color: #4b5563;
        font-size: 12px;
      }

      .wg-table-wrap {
        max-height: 440px;
        overflow: auto;
        border: 1px solid #d1d5db;
        border-radius: 8px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      th,
      td {
        padding: 8px 10px;
        border-bottom: 1px solid #e5e7eb;
        text-align: left;
        vertical-align: top;
        overflow-wrap: anywhere;
      }

      th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: #f3f4f6;
        font-size: 12px;
      }

      th:nth-child(1),
      td:nth-child(1) {
        width: 58%;
      }

      th:nth-child(2),
      td:nth-child(2) {
        width: 18%;
      }

      th:nth-child(3),
      td:nth-child(3) {
        width: 24%;
      }

      tr:last-child td {
        border-bottom: 0;
      }

      .wg-missing {
        color: #b91c1c;
        font-weight: 700;
      }

      .wg-footer {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        padding: 14px 20px 18px;
        border-top: 1px solid #e5e7eb;
        background: #f9fafb;
      }

      .wg-button {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 9px 14px;
        background: #ffffff;
        color: #111827;
        cursor: pointer;
        font: 700 13px/1 Arial, Helvetica, sans-serif;
      }

      .wg-button:hover:not(:disabled) {
        background: #f3f4f6;
      }

      .wg-button-primary {
        border-color: #6d28d9;
        background: #6d28d9;
        color: #ffffff;
      }

      .wg-button-primary:hover:not(:disabled) {
        background: #5b21b6;
      }

      .wg-button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      @media (max-width: 620px) {
        .wg-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .wg-panel {
          max-height: 94vh;
        }
      }
    `;

    const extractButton = createElement('button', {
      className: 'wg-launcher',
      text: 'Extract',
      type: 'button',
    });

    extractButton.addEventListener('click', handleExtract);

    shadow.append(style, extractButton);
    document.documentElement.appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.extractButton = extractButton;
  }

  function mountUi() {
    if (!isSupportedReportRoute()) {
      removeUi();
      return;
    }

    const existingHost = document.getElementById(CONFIG.hostId);

    if (existingHost && existingHost !== state.host) {
      existingHost.remove();
    }

    if (!state.host || !state.host.isConnected) {
      buildUi();
    }
  }

  function removeUi() {
    if (state.host?.isConnected) {
      state.host.remove();
    }

    state.host = null;
    state.shadow = null;
    state.extractButton = null;
    state.panel = null;
    state.lastResult = null;
    state.busy = false;
  }

  function setLauncherState(label, disabled) {
    if (!state.extractButton) {
      return;
    }

    state.extractButton.textContent = label;
    state.extractButton.disabled = Boolean(disabled);
  }

  function closePanel() {
    if (state.panel?.isConnected) {
      state.panel.remove();
    }

    state.panel = null;
  }

  function createPanel(title, subtitle) {
    closePanel();

    const backdrop = createElement('div', {
      className: 'wg-backdrop',
    });

    const panel = createElement('section', {
      className: 'wg-panel',
    });

    const header = createElement('header', {
      className: 'wg-header',
    });

    const headingWrap = createElement('div');

    const heading = createElement('h2', {
      className: 'wg-title',
      text: title,
    });

    const subheading = createElement('p', {
      className: 'wg-subtitle',
      text: subtitle,
    });

    const closeButton = createElement('button', {
      className: 'wg-close',
      text: '×',
      type: 'button',
    });

    closeButton.setAttribute(
      'aria-label',
      'Close extractor panel',
    );

    closeButton.addEventListener('click', closePanel);

    const content = createElement('div', {
      className: 'wg-content',
    });

    const footer = createElement('footer', {
      className: 'wg-footer',
    });

    headingWrap.append(heading, subheading);
    header.append(headingWrap, closeButton);
    panel.append(header, content, footer);
    backdrop.appendChild(panel);
    state.shadow.appendChild(backdrop);
    state.panel = backdrop;

    return {
      backdrop,
      panel,
      content,
      footer,
      heading,
      subheading,
    };
  }

  function showProgress(message) {
    const panel = createPanel(
      'Wayground Gradebook Extractor',
      'Preparing best-attempt points',
    );

    panel.content.appendChild(
      createElement('p', {
        className: 'wg-status',
        text: message,
      }),
    );

    return panel;
  }

  function updateProgress(panel, message) {
    const status = panel.content.querySelector('.wg-status');

    if (status) {
      status.textContent = message;
    }
  }

  function showError(error) {
    const message =
      error instanceof Error ? error.message : String(error);

    const panel = createPanel(
      'Extraction stopped',
      'Nothing was copied',
    );

    panel.content.appendChild(
      createElement('div', {
        className: 'wg-error',
        text: message,
      }),
    );

    const retryButton = createElement('button', {
      className: 'wg-button wg-button-primary',
      text: 'Extract Again',
      type: 'button',
    });

    retryButton.addEventListener('click', handleExtract);

    const closeButton = createElement('button', {
      className: 'wg-button',
      text: 'Close',
      type: 'button',
    });

    closeButton.addEventListener('click', closePanel);

    panel.footer.append(closeButton, retryButton);
  }

  function findParticipantsTab() {
    const directMatch = document.querySelector(
      CONFIG.participantsTabSelector,
    );

    if (directMatch) {
      return (
        directMatch.closest('button[role="tab"]') || directMatch
      );
    }

    return (
      Array.from(
        document.querySelectorAll('button[role="tab"]'),
      ).find(
        (button) =>
          normalizeWhitespace(button.textContent) ===
          'Participants',
      ) || null
    );
  }

  function isParticipantsTabActive() {
    const tab = findParticipantsTab();

    return Boolean(
      tab && tab.getAttribute('aria-selected') === 'true',
    );
  }

  async function activateParticipantsTab() {
    const tab = await waitForCondition(findParticipantsTab, {
      timeoutMs: CONFIG.tabTimeoutMs,
      description: 'the Participants tab',
    });

    if (tab.getAttribute('aria-selected') !== 'true') {
      tab.click();
    }

    await waitForCondition(isParticipantsTabActive, {
      timeoutMs: CONFIG.tabTimeoutMs,
      description: 'the Participants tab to open',
    });
  }

  function getAttemptFilter() {
    return document.querySelector(
      CONFIG.attemptFilterSelector,
    );
  }

  function getAttemptMode() {
    const filter = getAttemptFilter();
    const title = filter?.querySelector(
      CONFIG.attemptTitleSelector,
    );

    return normalizeWhitespace(title?.textContent);
  }

  function findBestOption() {
    const selectors = [
      '[role="option"]',
      '[role="listbox"] button',
      '[role="listbox"] li',
      '[data-testid*="option"]',
    ];

    const candidates = Array.from(
      document.querySelectorAll(selectors.join(',')),
    );

    return (
      candidates.find(
        (element) =>
          normalizeWhitespace(element.textContent) === 'Best',
      ) || null
    );
  }

  async function ensureBestAttempt() {
    await waitForCondition(
      () => getAttemptFilter() && getAttemptMode(),
      {
        timeoutMs: CONFIG.filterTimeoutMs,
        description: 'the attempt filter',
      },
    );

    if (getAttemptMode() === 'Best') {
      return;
    }

    const dropdown = getAttemptFilter()?.querySelector(
      CONFIG.attemptDropdownSelector,
    );

    if (!dropdown) {
      throw new Error(
        'The attempt filter is not set to Best, and its dropdown could not be found.',
      );
    }

    dropdown.click();

    const bestOption = await waitForCondition(findBestOption, {
      timeoutMs: CONFIG.filterTimeoutMs,
      description: 'the Best-attempt option',
    });

    bestOption.click();

    await waitForCondition(() => getAttemptMode() === 'Best', {
      timeoutMs: CONFIG.filterTimeoutMs,
      description: 'Best attempt to be selected',
    });
  }

  function readAssignedCount() {
    const valueElement = document.querySelector(
      CONFIG.assignedCountSelector,
    );

    const match = normalizeWhitespace(
      valueElement?.textContent,
    ).match(/\d+/);

    if (!match) {
      throw new Error(
        'Could not read the Students Assigned count from this report.',
      );
    }

    return Number.parseInt(match[0], 10);
  }

  function isParticipantsGrid(grid) {
    const directChildren = Array.from(grid.children);

    const headerTexts = directChildren
      .slice(0, 8)
      .map((element) =>
        normalizeWhitespace(element.textContent),
      );

    const hasNameHeader = headerTexts.includes('Name');
    const hasPointsHeader = headerTexts.includes('Points');

    const hasNameCells = directChildren.some((element) =>
      element.classList.contains(
        CONFIG.participantNameClass,
      ),
    );

    return (
      hasNameHeader && hasPointsHeader && hasNameCells
    );
  }

  function findParticipantsGrid() {
    const reportsContent = document.querySelector(
      CONFIG.reportsContentSelector,
    );

    if (!reportsContent) {
      return null;
    }

    const candidates = Array.from(
      reportsContent.querySelectorAll('.main-content.grid'),
    );

    return candidates.find(isParticipantsGrid) || null;
  }

  function getNameCells(grid) {
    return Array.from(grid.children).filter((element) =>
      element.classList.contains(
        CONFIG.participantNameClass,
      ),
    );
  }

  async function waitForCompleteParticipantsGrid(
    expectedCount,
  ) {
    return waitForCondition(
      () => {
        if (!isParticipantsTabActive()) {
          return null;
        }

        const grid = findParticipantsGrid();

        if (!grid) {
          return null;
        }

        return getNameCells(grid).length === expectedCount
          ? grid
          : null;
      },
      {
        timeoutMs: CONFIG.tableTimeoutMs,
        description: `all ${expectedCount} participant rows`,
      },
    );
  }

  function directText(element) {
    return normalizeWhitespace(
      Array.from(element.childNodes)
        .filter(
          (node) => node.nodeType === Node.TEXT_NODE,
        )
        .map((node) => node.nodeValue)
        .join(' '),
    );
  }

  function extractCanonicalName(nameCell) {
    const preferred = nameCell.querySelector(
      'span.v-popper--has-tooltip',
    );

    let rawName = preferred ? directText(preferred) : '';

    if (!/^\(Student\)\s+/i.test(rawName)) {
      const descendants = Array.from(
        nameCell.querySelectorAll('*'),
      );

      for (const element of descendants) {
        const candidate = directText(element);

        if (/^\(Student\)\s+/i.test(candidate)) {
          rawName = candidate;
          break;
        }
      }
    }

    const canonicalName = normalizeWhitespace(
      rawName.replace(/^\(Student\)\s*/i, ''),
    );

    if (!canonicalName) {
      throw new Error(
        'A participant row did not contain a readable canonical roster name.',
      );
    }

    return canonicalName;
  }

  function formatLastFirst(canonicalName) {
    const parts = normalizeWhitespace(canonicalName)
      .split(' ')
      .filter(Boolean);

    if (parts.length < 2) {
      throw new Error(
        `Cannot convert the canonical roster name "${canonicalName}" to Last, First.`,
      );
    }

    const first = parts.shift();
    const last = parts.join(' ');

    return {
      first,
      last,
      formattedName: `${last}, ${first}`,
    };
  }

  function collectRowSegments(grid) {
    const children = Array.from(grid.children);
    const nameIndexes = [];

    children.forEach((element, index) => {
      if (
        element.classList.contains(
          CONFIG.participantNameClass,
        )
      ) {
        nameIndexes.push(index);
      }
    });

    return nameIndexes.map(
      (startIndex, recordIndex) => {
        const endIndex =
          nameIndexes[recordIndex + 1] ?? children.length;

        return {
          nameCell: children[startIndex],
          cells: children.slice(startIndex, endIndex),
        };
      },
    );
  }

  function isMissingSegment(segment) {
    if (
      segment.nameCell.classList.contains(
        CONFIG.missingRowClass,
      )
    ) {
      return true;
    }

    return segment.cells.some(
      (cell) =>
        normalizeWhitespace(cell.textContent) ===
        'Not started',
    );
  }

  function extractPoints(segment) {
    const pointsCell = segment.cells.find((cell) =>
      cell.classList.contains(CONFIG.pointsClass),
    );

    if (!pointsCell) {
      throw new Error(
        'An attempted participant row did not contain a Points cell.',
      );
    }

    const pointsText = normalizeWhitespace(
      pointsCell.textContent,
    ).replace(/,/g, '');

    const match = pointsText.match(
      /(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/,
    );

    if (!match) {
      throw new Error(
        `Could not read earned and possible points from "${pointsText}".`,
      );
    }

    const rawPoints = match[1];
    const possiblePoints = match[2];
    const rawNumber = Number(rawPoints);
    const possibleNumber = Number(possiblePoints);

    if (
      !Number.isFinite(rawNumber) ||
      !Number.isFinite(possibleNumber) ||
      possibleNumber <= 0
    ) {
      throw new Error(
        `Invalid Points value found: "${pointsText}".`,
      );
    }

    return {
      rawPoints,
      possiblePoints,
    };
  }

  function buildStudentRecord(segment) {
    const canonicalName = extractCanonicalName(
      segment.nameCell,
    );

    const nameParts = formatLastFirst(canonicalName);
    const missing = isMissingSegment(segment);

    if (missing) {
      return {
        canonicalName,
        ...nameParts,
        missing: true,
        rawPoints: '',
        possiblePoints: '',
        comment: 'Missing',
      };
    }

    const points = extractPoints(segment);

    return {
      canonicalName,
      ...nameParts,
      missing: false,
      rawPoints: points.rawPoints,
      possiblePoints: points.possiblePoints,
      comment: '',
    };
  }

  function validateRecords(records, expectedCount) {
    const errors = [];

    if (getAttemptMode() !== 'Best') {
      errors.push(
        'The attempt filter is not set to Best.',
      );
    }

    if (records.length !== expectedCount) {
      errors.push(
        `Wayground reports ${expectedCount} assigned students, but ${records.length} participant records were extracted.`,
      );
    }

    const canonicalCounts = new Map();

    for (const record of records) {
      canonicalCounts.set(
        record.canonicalName,
        (canonicalCounts.get(record.canonicalName) || 0) +
          1,
      );

      if (
        !record.first ||
        !record.last ||
        !record.formattedName.includes(', ')
      ) {
        errors.push(
          `The canonical name "${record.canonicalName}" could not be formatted as Last, First.`,
        );
      }

      if (record.missing) {
        if (
          record.rawPoints !== '' ||
          record.comment !== 'Missing'
        ) {
          errors.push(
            `Missing student "${record.canonicalName}" was not assigned a blank score and Missing comment.`,
          );
        }
      } else {
        if (
          record.rawPoints === '' ||
          !Number.isFinite(Number(record.rawPoints))
        ) {
          errors.push(
            `Attempted student "${record.canonicalName}" does not have numeric raw points.`,
          );
        }

        if (record.comment !== '') {
          errors.push(
            `Attempted student "${record.canonicalName}" has an unexpected comment.`,
          );
        }
      }
    }

    const duplicateNames = Array.from(
      canonicalCounts.entries(),
    )
      .filter(([, count]) => count > 1)
      .map(([name]) => name);

    if (duplicateNames.length > 0) {
      errors.push(
        `Duplicate canonical roster name${
          duplicateNames.length === 1 ? '' : 's'
        } found: ${duplicateNames.join('; ')}.`,
      );
    }

    const denominators = new Set(
      records
        .filter((record) => !record.missing)
        .map((record) => record.possiblePoints),
    );

    if (denominators.size > 1) {
      errors.push(
        `Participants have inconsistent possible-point totals: ${Array.from(
          denominators,
        ).join(', ')}.`,
      );
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    return {
      expectedCount,
      extractedCount: records.length,
      attemptedCount: records.filter(
        (record) => !record.missing,
      ).length,
      missingCount: records.filter(
        (record) => record.missing,
      ).length,
      zeroCount: records.filter(
        (record) =>
          !record.missing &&
          Number(record.rawPoints) === 0,
      ).length,
      possiblePoints:
        denominators.size === 1
          ? Array.from(denominators)[0]
          : '',
    };
  }

  function readAssignmentName() {
    const value = document.querySelector(
      '[data-testid="game-name-display"]',
    );

    return (
      normalizeWhitespace(value?.textContent) ||
      'Wayground report'
    );
  }

  function sanitizeClipboardField(value) {
    return normalizeWhitespace(value).replace(
      /[\t\r\n]+/g,
      ' ',
    );
  }

  function buildClipboardText(records) {
    return records
      .map((record) =>
        [
          sanitizeClipboardField(record.formattedName),
          sanitizeClipboardField(record.rawPoints),
          sanitizeClipboardField(record.comment),
        ].join('\t'),
      )
      .join('\r\n');
  }

  async function copyText(text) {
    if (!text) {
      throw new Error(
        'There are no validated student results to copy.',
      );
    }

    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    throw new Error(
      'Clipboard access is unavailable in this browser.',
    );
  }

  function addSummaryStat(container, label, value) {
    const stat = createElement('div', {
      className: 'wg-stat',
    });

    stat.append(
      createElement('span', {
        className: 'wg-stat-label',
        text: label,
      }),
      createElement('span', {
        className: 'wg-stat-value',
        text: value,
      }),
    );

    container.appendChild(stat);
  }

  function renderPreview(
    records,
    summary,
    assignmentName,
  ) {
    const panel = createPanel(
      'Ready to copy',
      `${assignmentName} · Best attempt`,
    );

    const summaryGrid = createElement('div', {
      className: 'wg-summary',
    });

    addSummaryStat(
      summaryGrid,
      'Assigned',
      summary.expectedCount,
    );

    addSummaryStat(
      summaryGrid,
      'Extracted',
      summary.extractedCount,
    );

    addSummaryStat(
      summaryGrid,
      'Attempted',
      summary.attemptedCount,
    );

    addSummaryStat(
      summaryGrid,
      'Missing',
      summary.missingCount,
    );

    const note = createElement('p', {
      className: 'wg-note',
      text: 'Copy includes student rows only: Last, First → Raw Points → Comment. No headers are copied.',
    });

    const tableWrap = createElement('div', {
      className: 'wg-table-wrap',
    });

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    ['Last, First', 'Raw Points', 'Comment'].forEach(
      (label) => {
        headerRow.appendChild(
          createElement('th', {
            text: label,
          }),
        );
      },
    );

    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    for (const record of records) {
      const row = document.createElement('tr');

      row.appendChild(
        createElement('td', {
          text: record.formattedName,
        }),
      );

      row.appendChild(
        createElement('td', {
          text: record.rawPoints,
        }),
      );

      const commentCell = createElement('td', {
        className: record.missing ? 'wg-missing' : '',
        text: record.comment,
      });

      row.appendChild(commentCell);
      tbody.appendChild(row);
    }

    table.append(thead, tbody);
    tableWrap.appendChild(table);

    panel.content.append(summaryGrid, note, tableWrap);

    const closeButton = createElement('button', {
      className: 'wg-button',
      text: 'Close',
      type: 'button',
    });

    closeButton.addEventListener('click', closePanel);

    const extractAgainButton = createElement('button', {
      className: 'wg-button',
      text: 'Extract Again',
      type: 'button',
    });

    extractAgainButton.addEventListener(
      'click',
      handleExtract,
    );

    const copyButton = createElement('button', {
      className: 'wg-button wg-button-primary',
      text: 'Copy',
      type: 'button',
    });

    copyButton.addEventListener('click', async () => {
      copyButton.disabled = true;

      try {
        await copyText(buildClipboardText(records));

        copyButton.textContent = 'Copied ✓';

        window.setTimeout(() => {
          if (copyButton.isConnected) {
            copyButton.textContent = 'Copy';
            copyButton.disabled = false;
          }
        }, 1800);
      } catch (error) {
        copyButton.textContent = 'Copy failed';
        copyButton.disabled = false;
        showError(error);
      }
    });

    panel.footer.append(
      closeButton,
      extractAgainButton,
      copyButton,
    );
  }

  async function extractRecords(progressPanel) {
    updateProgress(
      progressPanel,
      'Opening Participants…',
    );

    await activateParticipantsTab();

    updateProgress(
      progressPanel,
      'Selecting Best attempt…',
    );

    await ensureBestAttempt();

    const expectedCount = readAssignedCount();

    updateProgress(
      progressPanel,
      `Waiting for all ${expectedCount} students…`,
    );

    const grid =
      await waitForCompleteParticipantsGrid(expectedCount);

    updateProgress(
      progressPanel,
      `Extracting ${expectedCount} students…`,
    );

    const segments = collectRowSegments(grid);
    const records = segments.map(buildStudentRecord);

    updateProgress(
      progressPanel,
      'Validating results…',
    );

    const summary = validateRecords(
      records,
      expectedCount,
    );

    return {
      assignmentName: readAssignmentName(),
      records,
      summary,
    };
  }

  async function handleExtract() {
    if (state.busy) {
      return;
    }

    if (!isSupportedReportRoute()) {
      showError(
        new Error(
          'Open a Wayground session report before extracting grades.',
        ),
      );

      return;
    }

    state.busy = true;
    state.lastResult = null;

    setLauncherState('Extracting…', true);

    const progressPanel = showProgress(
      'Preparing the report…',
    );

    try {
      const result = await extractRecords(progressPanel);

      state.lastResult = result;

      renderPreview(
        result.records,
        result.summary,
        result.assignmentName,
      );

      setLauncherState('Extract', false);
    } catch (error) {
      showError(error);
      setLauncherState('Extract', false);
    } finally {
      state.busy = false;
    }
  }

  function syncUiForRoute() {
    if (isSupportedReportRoute()) {
      mountUi();
    } else {
      removeUi();
    }
  }

  function init() {
    syncUiForRoute();

    window.setInterval(
      syncUiForRoute,
      CONFIG.routeCheckIntervalMs,
    );
  }

  init();
})();
