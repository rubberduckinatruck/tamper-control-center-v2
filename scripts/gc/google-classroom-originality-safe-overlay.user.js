// ==UserScript==
// @name             → Google Classroom Originality Safe Overlay
// @namespace        classroom-originality-safe-overlay
// @version          1.2
// @description      Safe createElement-only originality summary capture tool for Google Classroom.
// @author           Big Poppa
//
// @cc-id            google-classroom-originality-safe-overlay
// @cc-display-name  Google Classroom Originality Safe Overlay
// @cc-category      google-classroom
// @cc-role          teaching
// @cc-status        live
// @cc-tags          google classroom, originality, student work, grading, overlay
//
// @match            https://classroom.google.com/g/*
// @grant            none
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gc/google-classroom-originality-safe-overlay.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gc/google-classroom-originality-safe-overlay.user.js
// ==/UserScript==


(function () {
  'use strict';

  // ------------------------ SECTION 1 CONFIGURATION ----------------------

  const SCRIPT_VERSION = '1.1';
  const OVERLAY_ID = 'gc-originality-safe-overlay';
  const DEBUG_CONSOLE_ID = 'gc-originality-debug-console';
  const MAX_DEBUG_LINES = 140;
  const CSV_FILENAME_PREFIX = 'classroom_originality_captures';
  const NAVIGATION_WAIT_MS = 3000;
  const AUTO_LOOP_WAIT_MS = 4000;
  const START_MINIMIZED = true;
  const MISSING_ORIGINALITY_TEXT = 'No originality report found';

  // ------------------------ SECTION 2 STATE MANAGEMENT ----------------------

  const state = {
    debugLines: [],
    testRunCount: 0,
    captureCount: 0,
    duplicateSkipCount: 0,
    missingOriginalityCount: 0,
    autoRunCount: 0,
    lastAction: 'Script loaded',
    lastError: 'None',
    minimized: START_MINIMIZED,
    captures: [],
    capturedStudentIds: new Set(),
    isAutoRunning: false,
    isPaused: false,
    isStopping: false,
    previousAutoStudentId: '',
    autoDownloadEnabled: true,
    runStartedAt: '',
    runFinishedAt: '',
    stopReason: '',
    runId: createRunId()
  };

  // ------------------------ SECTION 3 UTILITY HELPERS ----------------------

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function makeEl(tag, text, id) {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateStatus() {
    setText('gc-last-action', state.lastAction);
    setText('gc-test-count', String(state.testRunCount));
    setText('gc-capture-count', String(state.captureCount));
    setText('gc-duplicate-count', String(state.duplicateSkipCount));
    setText('gc-missing-originality-count', String(state.missingOriginalityCount));
    setText('gc-auto-status', getAutoStatusText());
    setText('gc-auto-download-status', state.autoDownloadEnabled ? 'On' : 'Off');
    setText('gc-stop-reason', state.stopReason || 'None');
    setText('gc-last-error', state.lastError);
  }

  function getAutoStatusText() {
    if (state.isStopping) return 'Stopping';
    if (state.isPaused) return 'Paused';
    if (state.isAutoRunning) return 'Running';
    return 'Stopped';
  }

  function createRunId() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  function getDateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function getTimeStampForFilename() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}-${mm}-${ss}`;
  }

  function sanitizeFilenamePart(text) {
    return cleanText(text)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }

  function isVisible(el) {
    if (!el) return false;
    if (isInsideOverlay(el)) return false;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function isInsideOverlay(el) {
    return Boolean(el && el.closest && el.closest(`#${OVERLAY_ID}`));
  }

  function getElementText(el) {
    if (!el) return '';
    return cleanText(el.innerText || el.textContent || '');
  }

  function getElementTitle(el) {
    if (!el) return '';
    return cleanText(el.getAttribute('title') || el.getAttribute('aria-label') || '');
  }

  function getAssignmentMetadata() {
    const titleText = cleanText(document.title || '');
    const h1Text = cleanText(document.querySelector('h1')?.innerText || '');
    const source = h1Text || titleText;

    const parts = source.split(' - ').map(cleanText).filter(Boolean);

    return {
      rawTitle: source || 'unknown_assignment',
      stepTitle: parts[0] || '',
      assignmentPart: parts[1] || parts[0] || 'assignment',
      classPeriod: parts[2] || 'class_period_unknown'
    };
  }

  function buildCsvFilename() {
    const meta = getAssignmentMetadata();

    return [
      CSV_FILENAME_PREFIX,
      sanitizeFilenamePart(meta.classPeriod),
      sanitizeFilenamePart(meta.assignmentPart),
      getDateStamp(),
      getTimeStampForFilename()
    ].filter(Boolean).join('_') + '.xls';
  }

  function isDisabledLike(el) {
    if (!el) return true;

    return (
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('disabled') !== null
    );
  }

  function safeClick(el) {
    if (!el) return false;

    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });

      const opts = {
        bubbles: true,
        cancelable: true,
        view: window
      };

      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));

      return true;
    } catch (err) {
      fail('Navigation', 'Safe click failed', { message: err.message });
      return false;
    }
  }

  // ------------------------ SECTION 4 DEBUG CONSOLE ----------------------

  function makeLogSafeData(data) {
    if (!data) return null;

    try {
      JSON.stringify(data);
      return data;
    } catch (err) {
      return { note: 'Data contained non-serializable values and was simplified.' };
    }
  }

  function log(level, category, message, data) {
    const safeData = makeLogSafeData(data);

    const entry = {
      time: new Date().toLocaleTimeString(),
      level,
      category,
      message,
      data: safeData
    };

    state.debugLines.push(entry);

    if (state.debugLines.length > MAX_DEBUG_LINES) {
      state.debugLines.shift();
    }

    const prefix = `[GC Originality Overlay][${category}]`;

    if (level === 'ERROR') console.error(prefix, message, safeData || '');
    else if (level === 'WARN') console.warn(prefix, message, safeData || '');
    else console.log(prefix, message, safeData || '');

    renderDebugConsole();
  }

  function info(category, message, data) {
    log('INFO', category, message, data);
  }

  function warn(category, message, data) {
    log('WARN', category, message, data);
  }

  function fail(category, message, data) {
    state.lastError = message;
    log('ERROR', category, message, data);
    updateStatus();
  }

  function renderDebugConsole() {
    const box = document.getElementById(DEBUG_CONSOLE_ID);
    if (!box) return;

    box.textContent = '';

    state.debugLines.forEach(line => {
      const row = makeEl('div');
      row.style.marginBottom = '4px';
      row.style.whiteSpace = 'pre-wrap';
      row.style.wordBreak = 'break-word';

      if (line.level === 'ERROR') row.style.color = '#ff7777';
      else if (line.level === 'WARN') row.style.color = '#ffd166';
      else row.style.color = '#9be7ff';

      row.textContent = `[${line.time}] ${line.level} ${line.category}: ${line.message}`;

      if (line.data) {
        const details = makeEl('div');
        details.style.color = '#aaa';
        details.style.paddingLeft = '10px';
        details.textContent = JSON.stringify(line.data);
        row.appendChild(details);
      }

      box.appendChild(row);
    });

    box.scrollTop = box.scrollHeight;
  }

  // ------------------------ SECTION 5 OVERLAY CREATION ----------------------

  function styleButton(button) {
    button.style.background = '#2b2b2b';
    button.style.color = '#fff';
    button.style.border = '1px solid #555';
    button.style.borderRadius = '6px';
    button.style.padding = '5px 8px';
    button.style.margin = '3px';
    button.style.fontSize = '12px';
    button.style.cursor = 'pointer';
  }

  function styleBox(box) {
    box.style.background = '#181818';
    box.style.border = '1px solid #333';
    box.style.borderRadius = '8px';
    box.style.padding = '8px';
    box.style.marginBottom = '8px';
    box.style.lineHeight = '1.5';
  }

  function addLine(parent, label, valueId, defaultValue) {
    const line = makeEl('div');
    const strong = makeEl('strong', label + ': ');
    const span = makeEl('span', defaultValue, valueId);
    line.appendChild(strong);
    line.appendChild(span);
    parent.appendChild(line);
  }

  function addButton(parent, id, text, handler) {
    const button = makeEl('button', text, id);
    styleButton(button);
    button.addEventListener('click', handler);
    parent.appendChild(button);
    return button;
  }

  function createOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const panel = makeEl('div', null, OVERLAY_ID);
    panel.style.position = 'fixed';
    panel.style.bottom = '20px';
    panel.style.left = '20px';
    panel.style.zIndex = '2147483647';
    panel.style.width = state.minimized ? '280px' : '510px';
    panel.style.maxHeight = '80vh';
    panel.style.background = '#111';
    panel.style.color = '#fff';
    panel.style.borderRadius = '12px';
    panel.style.fontFamily = 'Arial, sans-serif';
    panel.style.fontSize = '13px';
    panel.style.boxShadow = '0 6px 24px rgba(0,0,0,0.45)';
    panel.style.overflow = 'hidden';
    panel.style.pointerEvents = 'auto';

    const header = makeEl('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.background = '#1f1f1f';
    header.style.padding = '10px';
    header.style.borderBottom = '1px solid #333';

    const title = makeEl('div');
    const titleStrong = makeEl('strong', 'Originality Overlay Diagnostic ');
    const version = makeEl('span', `v${SCRIPT_VERSION}`);
    version.style.opacity = '.7';
    title.appendChild(titleStrong);
    title.appendChild(version);

    const headerButtons = makeEl('div');
    addButton(headerButtons, 'gc-btn-minimize', state.minimized ? 'Expand' : 'Minimize', toggleMinimize);
    addButton(headerButtons, 'gc-btn-clear', 'Clear Log', clearLog);

    header.appendChild(title);
    header.appendChild(headerButtons);

    const body = makeEl('div', null, 'gc-overlay-body');
    body.style.padding = '10px';
    body.style.maxHeight = '72vh';
    body.style.overflowY = 'auto';
    body.style.display = state.minimized ? 'none' : 'block';

    const statusBox = makeEl('div');
    styleBox(statusBox);
    addLine(statusBox, 'Status', 'gc-status', 'Loaded');
    addLine(statusBox, 'Auto Run', 'gc-auto-status', getAutoStatusText());
    addLine(statusBox, 'Auto Download', 'gc-auto-download-status', state.autoDownloadEnabled ? 'On' : 'Off');
    addLine(statusBox, 'Last Action', 'gc-last-action', state.lastAction);
    addLine(statusBox, 'Test Runs', 'gc-test-count', '0');
    addLine(statusBox, 'Captured', 'gc-capture-count', '0');
    addLine(statusBox, 'Duplicates Skipped', 'gc-duplicate-count', '0');
    addLine(statusBox, 'Missing Originality', 'gc-missing-originality-count', '0');
    addLine(statusBox, 'Stop Reason', 'gc-stop-reason', 'None');
    addLine(statusBox, 'Last Error', 'gc-last-error', 'None');

    const buttonBox = makeEl('div');
    styleBox(buttonBox);
    addButton(buttonBox, 'gc-btn-preview', 'Preview Run Info', previewRunInfo);
    addButton(buttonBox, 'gc-btn-test-page', 'Test Page Detection', testPageDetection);
    addButton(buttonBox, 'gc-btn-test-student', 'Test Student Detection', testStudentDetection);
    addButton(buttonBox, 'gc-btn-test-originality', 'Test Originality Detection', testOriginalityDetection);
    addButton(buttonBox, 'gc-btn-test-next', 'Detect Next Target', testNextTargetDetection);
    addButton(buttonBox, 'gc-btn-capture-current', 'Capture Current Student', captureCurrentStudent);
    addButton(buttonBox, 'gc-btn-capture-next', 'Capture + Go Next', captureAndGoNext);
    addButton(buttonBox, 'gc-btn-auto-start', 'Start Auto Capture', startAutoCapture);
    addButton(buttonBox, 'gc-btn-auto-pause', 'Pause Auto', pauseAutoCapture);
    addButton(buttonBox, 'gc-btn-auto-resume', 'Resume Auto', resumeAutoCapture);
    addButton(buttonBox, 'gc-btn-auto-stop', 'Stop Auto', stopAutoCapture);
    addButton(buttonBox, 'gc-btn-toggle-auto-download', 'Toggle Auto Download', toggleAutoDownload);
    addButton(buttonBox, 'gc-btn-reset', 'Start Fresh / Reset', resetRun);
    addButton(buttonBox, 'gc-btn-download-csv', 'Download CSV', downloadCsv);

    const resultBox = makeEl('div');
    styleBox(resultBox);
    addLine(resultBox, 'Page', 'gc-result-page', 'Not tested');
    addLine(resultBox, 'Student', 'gc-result-student', 'Not tested');
    addLine(resultBox, 'Originality', 'gc-result-originality', 'Not tested');
    addLine(resultBox, 'Originality Source', 'gc-result-originality-source', 'Not tested');
    addLine(resultBox, 'Next Target', 'gc-result-next', 'Not tested');
    addLine(resultBox, 'Last Captured', 'gc-result-last-captured', 'None');
    addLine(resultBox, 'After Navigation', 'gc-result-after-navigation', 'Not tested');
    addLine(resultBox, 'Run Preview', 'gc-result-run-preview', 'Not tested');

    const debugWrap = makeEl('div');
    const debugTitle = makeEl('div', 'Debug Console');
    debugTitle.style.fontWeight = 'bold';
    debugTitle.style.marginBottom = '4px';

    const debugBox = makeEl('div', null, DEBUG_CONSOLE_ID);
    debugBox.style.background = '#050505';
    debugBox.style.border = '1px solid #333';
    debugBox.style.borderRadius = '8px';
    debugBox.style.padding = '8px';
    debugBox.style.height = '180px';
    debugBox.style.overflowY = 'auto';
    debugBox.style.fontFamily = 'Consolas, Monaco, monospace';
    debugBox.style.fontSize = '11px';

    debugWrap.appendChild(debugTitle);
    debugWrap.appendChild(debugBox);

    body.appendChild(statusBox);
    body.appendChild(buttonBox);
    body.appendChild(resultBox);
    body.appendChild(debugWrap);

    panel.appendChild(header);
    panel.appendChild(body);

    document.body.appendChild(panel);

    info('Overlay', 'Overlay injected successfully');
    updateStatus();
  }

  // ------------------------ SECTION 6 OVERLAY BUTTON ACTIONS ----------------------

  function toggleMinimize() {
    const body = document.getElementById('gc-overlay-body');
    const btn = document.getElementById('gc-btn-minimize');
    const panel = document.getElementById(OVERLAY_ID);

    if (!body || !btn || !panel) return;

    state.minimized = !state.minimized;

    body.style.display = state.minimized ? 'none' : 'block';
    panel.style.width = state.minimized ? '280px' : '510px';
    btn.textContent = state.minimized ? 'Expand' : 'Minimize';

    state.lastAction = state.minimized ? 'Overlay minimized' : 'Overlay expanded';
    info('Overlay', state.lastAction);
    updateStatus();
  }

  function clearLog() {
    state.debugLines = [];
    renderDebugConsole();
    info('Overlay', 'Debug log cleared');
  }

  function toggleAutoDownload() {
    state.autoDownloadEnabled = !state.autoDownloadEnabled;
    state.lastAction = state.autoDownloadEnabled ? 'Auto download enabled' : 'Auto download disabled';
    info('Overlay', state.lastAction);
    updateStatus();
  }

  function resetRun() {
    if (state.isAutoRunning) {
      warn('Reset', 'Reset blocked because auto capture is running');
      state.lastAction = 'Reset blocked - auto capture running';
      updateStatus();
      return;
    }

    state.testRunCount = 0;
    state.captureCount = 0;
    state.duplicateSkipCount = 0;
    state.missingOriginalityCount = 0;
    state.autoRunCount = 0;
    state.captures = [];
    state.capturedStudentIds = new Set();
    state.previousAutoStudentId = '';
    state.runStartedAt = '';
    state.runFinishedAt = '';
    state.stopReason = '';
    state.lastError = 'None';
    state.runId = createRunId();

    setText('gc-result-page', 'Not tested');
    setText('gc-result-student', 'Not tested');
    setText('gc-result-originality', 'Not tested');
    setText('gc-result-originality-source', 'Not tested');
    setText('gc-result-next', 'Not tested');
    setText('gc-result-last-captured', 'None');
    setText('gc-result-after-navigation', 'Not tested');
    setText('gc-result-run-preview', 'Not tested');

    state.lastAction = 'Run reset / started fresh';
    info('Reset', 'Run state cleared');
    updateStatus();
  }

  // ------------------------ SECTION 7 PAGE DETECTION TEST ----------------------

  function testPageDetection() {
    try {
      state.testRunCount += 1;
      state.lastAction = 'Testing page detection';

      const result = getPageDetection();

      setText('gc-result-page', result.detected ? 'Likely student work page' : 'Not confidently detected');
      info('Page', 'Page detection complete', result);
      updateStatus();

      return result;
    } catch (err) {
      fail('Page', 'Page detection failed', { message: err.message });
      return null;
    }
  }

  function getPageDetection() {
    const result = {
      host: location.hostname,
      path: location.pathname,
      classroomHost: location.hostname === 'classroom.google.com',
      gradingPath: location.pathname.startsWith('/g/'),
      hasFilesText: /Files/i.test(document.body.innerText || ''),
      iframeCount: document.querySelectorAll('iframe').length,
      hasDocsIframe: Array.from(document.querySelectorAll('iframe')).some(frame =>
        String(frame.src || '').includes('docs.google.com')
      )
    };

    result.detected = result.classroomHost && result.gradingPath;

    return result;
  }

  // ------------------------ SECTION 8 STUDENT DETECTION TEST ----------------------

  function testStudentDetection() {
    try {
      state.testRunCount += 1;
      state.lastAction = 'Testing student detection';

      const result = getCurrentStudent();

      setText(
        'gc-result-student',
        result.selectedFound ? `${result.studentName || 'Name unclear'} / ${result.studentId || 'No ID found'}` : 'Not found'
      );

      info('Student', 'Student detection complete', result);
      updateStatus();

      return result;
    } catch (err) {
      fail('Student', 'Student detection failed', { message: err.message });
      return null;
    }
  }

  function getCurrentStudent() {
    const selected = document.querySelector('[aria-checked="true"]');

    const studentId = selected
      ? selected.getAttribute('data-student-id') ||
        selected.getAttribute('data-value') ||
        selected.closest('[data-student-id]')?.getAttribute('data-student-id') ||
        selected.closest('[data-value]')?.getAttribute('data-value') ||
        ''
      : '';

    const selectedText = selected ? cleanText(selected.innerText || selected.textContent || '') : '';

    return {
      selectedFound: Boolean(selected),
      studentId,
      selectedText,
      studentName: cleanStudentName(selectedText),
      submissionStatus: extractSubmissionStatus(selectedText),
      scoreText: extractScoreText(selectedText),
      rawSelectedText: selectedText
    };
  }

  function cleanStudentName(text) {
    return cleanText(text)
      .replace(/\(Student\)/gi, '')
      .replace(/\bTurned in\b/gi, '')
      .replace(/\bMissing\b/gi, '')
      .replace(/\bAssigned\b/gi, '')
      .replace(/\bReturned\b/gi, '')
      .replace(/\bLate\b/gi, '')
      .replace(/\bDone\b/gi, '')
      .replace(/\bDraft\b/gi, '')
      .replace(/\blate\b/gi, '')
      .replace(/\b\d+\s*\/\s*\d+\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractSubmissionStatus(text) {
    const cleaned = cleanText(text);
    const statuses = [];

    if (/\bTurned in\b/i.test(cleaned)) statuses.push('Turned in');
    if (/\bDraft\b/i.test(cleaned)) statuses.push('Draft');
    if (/\bMissing\b/i.test(cleaned)) statuses.push('Missing');
    if (/\bReturned\b/i.test(cleaned)) statuses.push('Returned');
    if (/\bLate\b/i.test(cleaned)) statuses.push('Late');
    if (/\bAssigned\b/i.test(cleaned)) statuses.push('Assigned');
    if (/\bDone\b/i.test(cleaned)) statuses.push('Done');

    return statuses.join('; ');
  }

  function extractScoreText(text) {
    const match = cleanText(text).match(/\b\d+\s*\/\s*\d+\b/);
    return match ? cleanText(match[0]) : '';
  }

  // ------------------------ SECTION 9 ORIGINALITY DETECTION TEST ----------------------

  function testOriginalityDetection() {
    try {
      state.testRunCount += 1;
      state.lastAction = 'Testing originality detection';

      const result = getOriginalitySummary();

      const display = [
        result.summaryText || MISSING_ORIGINALITY_TEXT,
        result.citedText ? `cited/title text: ${result.citedText}` : ''
      ].filter(Boolean).join(' | ');

      setText('gc-result-originality', display);
      setText('gc-result-originality-source', `${result.sourceMethod || 'unknown'} | ${result.sourcePreview || 'no preview'}`);

      if (result.foundFlaggedSummary || result.foundCitedSummary) {
        info('Originality', 'Targeted originality summary detected', result);
      } else {
        warn('Originality', 'No targeted originality summary detected', result);
      }

      updateStatus();

      return result;
    } catch (err) {
      fail('Originality', 'Originality detection failed', { message: err.message });
      return null;
    }
  }

  function getOriginalitySummary() {
    const candidates = findOriginalityCandidates();
    const best = candidates[0] || null;

    if (!best) {
      return {
        summaryText: '',
        normalizedSummaryText: MISSING_ORIGINALITY_TEXT,
        citedText: '',
        foundFlaggedSummary: false,
        foundCitedSummary: false,
        sourceMethod: 'none',
        sourcePreview: '',
        sourceTitle: '',
        candidateCount: 0,
        originalityMissing: true
      };
    }

    const combined = cleanText(`${best.text} ${best.title}`);

    const summaryMatch =
      combined.match(/\bNo flagged passages\b/i) ||
      combined.match(/\b\d+\s+flagged passages?\b/i);

    const citedMatch =
      combined.match(/\bNo cited or quoted passages\b/i) ||
      combined.match(/\b\d+\s+cited or quoted passages?\b/i);

    return {
      summaryText: summaryMatch ? cleanText(summaryMatch[0]) : '',
      normalizedSummaryText: summaryMatch ? cleanText(summaryMatch[0]) : MISSING_ORIGINALITY_TEXT,
      citedText: citedMatch ? cleanText(citedMatch[0]) : '',
      foundFlaggedSummary: Boolean(summaryMatch),
      foundCitedSummary: Boolean(citedMatch),
      sourceMethod: best.method,
      sourcePreview: best.preview,
      sourceTitle: best.title,
      candidateCount: candidates.length,
      originalityMissing: !summaryMatch,
      candidateDebug: candidates.slice(0, 5).map(c => ({
        score: c.score,
        method: c.method,
        text: c.text,
        title: c.title,
        preview: c.preview
      }))
    };
  }

  function findOriginalityCandidates() {
    const regex = /\b(No flagged passages|\d+\s+flagged passages?|No cited or quoted passages|\d+\s+cited or quoted passages?)\b/i;

    const elements = Array.from(document.querySelectorAll('[title], [aria-label], div, span, button, a'))
      .filter(isVisible);

    const candidates = [];

    elements.forEach(el => {
      const text = getElementText(el);
      const title = getElementTitle(el);
      const combined = cleanText(`${text} ${title}`);

      if (!regex.test(combined)) return;
      if (combined.includes('Originality Overlay Diagnostic')) return;
      if (combined.includes('Debug Console')) return;
      if (combined.includes('Test Originality Detection')) return;

      const panel = findLikelyFilesPanel(el);
      const panelText = panel ? getElementText(panel) : '';
      const rect = el.getBoundingClientRect();

      let score = 0;
      let method = 'generic originality candidate';

      if (el.getAttribute('jsname') === 'FNFY6c') {
        score += 100;
        method = 'jsname FNFY6c originality element';
      }

      if (title.match(/cited or quoted passages?/i)) score += 35;
      if (text.match(/\bNo flagged passages\b|\b\d+\s+flagged passages?\b/i)) score += 50;
      if (panelText.includes('Files')) score += 30;
      if (panelText.includes('Turned in')) score += 20;
      if (panelText.includes('See history')) score += 15;
      if (rect.left > window.innerWidth * 0.45) score += 10;
      if (text.length <= 80) score += 15;
      if (text.length > 250) score -= 50;
      if (panelText.length > 2000) score -= 15;

      candidates.push({
        el,
        score,
        method,
        text,
        title,
        preview: cleanText(panelText || combined).slice(0, 350)
      });
    });

    candidates.sort((a, b) => b.score - a.score);

    info('Originality', 'Originality candidates scanned', {
      candidateCount: candidates.length,
      topCandidates: candidates.slice(0, 5).map(c => ({
        score: c.score,
        method: c.method,
        text: c.text,
        title: c.title,
        preview: c.preview
      }))
    });

    return candidates;
  }

  function findLikelyFilesPanel(startEl) {
    let el = startEl;

    for (let depth = 0; el && depth < 8; depth += 1) {
      const text = getElementText(el);

      if (
        text.includes('Files') &&
        (
          text.includes('Turned in') ||
          text.includes('See history') ||
          /flagged passages?/i.test(text)
        )
      ) {
        return el;
      }

      el = el.parentElement;
    }

    return null;
  }

  // ------------------------ SECTION 10 NEXT TARGET DETECTION TEST ----------------------

  function testNextTargetDetection() {
    try {
      state.testRunCount += 1;
      state.lastAction = 'Testing next target detection';

      const result = getNextTargetDetection();

      setText(
        'gc-result-next',
        result.nextCandidatesFound
          ? `Possible next target found: ${result.firstCandidateLabel || 'label unclear'}`
          : 'No obvious next target found'
      );

      info('Navigation', 'Next target detection complete', {
        totalCandidatesChecked: result.totalCandidatesChecked,
        nextCandidatesFound: result.nextCandidatesFound,
        firstCandidateLabel: result.firstCandidateLabel
      });

      updateStatus();

      return result;
    } catch (err) {
      fail('Navigation', 'Next target detection failed', { message: err.message });
      return null;
    }
  }

  function getNextTargetDetection() {
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label], [title]'));

    const nextCandidates = candidates.filter(el => {
      if (isInsideOverlay(el)) return false;

      const label = [
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.innerText || '',
        el.textContent || ''
      ].join(' ').toLowerCase();

      return label.includes('select the next student') || label.includes('next student');
    }).filter(el => !isDisabledLike(el));

    return {
      totalCandidatesChecked: candidates.length,
      nextCandidatesFound: nextCandidates.length,
      firstCandidateLabel: nextCandidates[0]
        ? cleanText([
            nextCandidates[0].getAttribute('aria-label') || '',
            nextCandidates[0].getAttribute('title') || '',
            nextCandidates[0].innerText || ''
          ].join(' '))
        : '',
      firstCandidate: nextCandidates[0] || null
    };
  }

  // ------------------------ SECTION 11 RUN PREVIEW ----------------------

  function previewRunInfo() {
    try {
      const meta = getAssignmentMetadata();
      const page = getPageDetection();
      const student = getCurrentStudent();
      const originality = getOriginalitySummary();
      const next = getNextTargetDetection();

      const summary = [
        `Class: ${meta.classPeriod}`,
        `Assignment: ${meta.assignmentPart}`,
        `Student: ${student.studentName || 'Not found'}`,
        `Originality: ${originality.normalizedSummaryText || MISSING_ORIGINALITY_TEXT}`,
        `Source: ${originality.sourceMethod || 'none'}`,
        `Next: ${next.firstCandidateLabel || 'Not found'}`
      ].join(' | ');

      setText('gc-result-run-preview', summary);

      state.lastAction = 'Run preview generated';
      info('Preview', 'Run preview generated', {
        meta,
        page,
        student,
        originality,
        next: {
          totalCandidatesChecked: next.totalCandidatesChecked,
          nextCandidatesFound: next.nextCandidatesFound,
          firstCandidateLabel: next.firstCandidateLabel
        }
      });
      updateStatus();
    } catch (err) {
      fail('Preview', 'Run preview failed', { message: err.message });
    }
  }

  // ------------------------ SECTION 12 CAPTURE CURRENT STUDENT ----------------------

  function captureCurrentStudent() {
    try {
      state.lastAction = 'Capturing current student';

      const capture = buildCurrentCapture();

      if (!capture.studentId && !capture.studentName) {
        warn('Capture', 'Capture skipped because no student was detected', capture);
        state.lastAction = 'Capture skipped - no student detected';
        updateStatus();
        return null;
      }

      if (capture.studentId && state.capturedStudentIds.has(capture.studentId)) {
        state.duplicateSkipCount += 1;
        state.lastAction = `Duplicate skipped: ${capture.studentName || capture.studentId}`;

        setText(
          'gc-result-last-captured',
          `Duplicate skipped: ${capture.studentName || capture.studentId}`
        );

        warn('Capture', 'Duplicate student skipped', {
          studentId: capture.studentId,
          studentName: capture.studentName,
          duplicateSkipCount: state.duplicateSkipCount
        });

        updateStatus();
        return {
          skippedDuplicate: true,
          studentId: capture.studentId,
          studentName: capture.studentName
        };
      }

      if (capture.originalityMissing) {
        state.missingOriginalityCount += 1;
      }

      state.captures.push(capture);

      if (capture.studentId) {
        state.capturedStudentIds.add(capture.studentId);
      }

      state.captureCount = state.captures.length;

      setText(
        'gc-result-last-captured',
        `${capture.studentName || 'Unknown student'} — ${capture.originalitySummary || MISSING_ORIGINALITY_TEXT}`
      );

      setText(
        'gc-result-originality-source',
        `${capture.originalitySourceMethod || 'unknown'} | ${capture.originalitySourcePreview || 'no preview'}`
      );

      if (capture.originalityMissing) {
        warn('Capture', 'Student captured with missing originality report', capture);
      } else {
        info('Capture', 'Current student captured', capture);
      }

      updateStatus();

      return capture;
    } catch (err) {
      fail('Capture', 'Capture current student failed', { message: err.message });
      return null;
    }
  }

  function buildCurrentCapture() {
    const page = getPageDetection();
    const student = getCurrentStudent();
    const originality = getOriginalitySummary();
    const meta = getAssignmentMetadata();

    return {
      runId: state.runId,
      scriptVersion: SCRIPT_VERSION,
      runStartedAt: state.runStartedAt,
      classPeriod: meta.classPeriod,
      assignmentPart: meta.assignmentPart,
      fullAssignmentTitle: meta.rawTitle,
      studentId: student.studentId,
      studentName: student.studentName,
      submissionStatus: student.submissionStatus,
      scoreText: student.scoreText,
      originalitySummary: originality.summaryText || MISSING_ORIGINALITY_TEXT,
      citedOrQuotedText: originality.citedText,
      originalityMissing: Boolean(originality.originalityMissing),
      originalitySourceMethod: originality.sourceMethod,
      originalitySourceTitle: originality.sourceTitle,
      originalitySourcePreview: originality.sourcePreview,
      originalityCandidateCount: originality.candidateCount,
      pageDetected: page.detected,
      selectedText: student.selectedText,
      capturedAt: new Date().toISOString()
    };
  }

  // ------------------------ SECTION 13 NAVIGATION ACTIONS ----------------------

  async function captureAndGoNext() {
    try {
      state.lastAction = 'Capture + Go Next started';
      updateStatus();

      const beforeStudent = getCurrentStudent();
      const capture = captureCurrentStudent();

      if (!capture) {
        warn('Navigation', 'Capture failed, navigation cancelled');
        return;
      }

      const moved = await goToNextStudent(beforeStudent, NAVIGATION_WAIT_MS);

      if (!moved) {
        warn('Navigation', 'Capture + Go Next did not move to a new student');
      }

      state.lastAction = 'Capture + Go Next complete';
      updateStatus();
    } catch (err) {
      fail('Navigation', 'Capture + Go Next failed', { message: err.message });
    }
  }

  async function goToNextStudent(beforeStudent, waitMs) {
    const next = getNextTargetDetection();

    if (!next.nextCandidatesFound || !next.firstCandidate) {
      warn('Navigation', 'No next target available', {
        nextCandidatesFound: next.nextCandidatesFound,
        firstCandidateLabel: next.firstCandidateLabel
      });
      setText('gc-result-after-navigation', 'No next target found');
      return false;
    }

    setText('gc-result-next', `Clicking: ${next.firstCandidateLabel || 'next target'}`);
    info('Navigation', 'Clicking next target', {
      beforeStudent,
      nextLabel: next.firstCandidateLabel
    });

    const clicked = safeClick(next.firstCandidate);

    if (!clicked) {
      warn('Navigation', 'Next target click failed');
      setText('gc-result-after-navigation', 'Click failed');
      return false;
    }

    state.lastAction = 'Waiting after next navigation';
    updateStatus();

    await sleep(waitMs);

    const afterStudent = getCurrentStudent();
    const afterOriginality = getOriginalitySummary();

    const changed = Boolean(
      afterStudent.selectedFound &&
      (
        !beforeStudent ||
        afterStudent.studentId !== beforeStudent.studentId ||
        afterStudent.studentName !== beforeStudent.studentName
      )
    );

    setText(
      'gc-result-after-navigation',
      afterStudent.selectedFound
        ? `${afterStudent.studentName || 'Name unclear'} — ${afterOriginality.normalizedSummaryText || MISSING_ORIGINALITY_TEXT}`
        : 'Student not detected after navigation'
    );

    setText(
      'gc-result-student',
      afterStudent.selectedFound ? `${afterStudent.studentName || 'Name unclear'} / ${afterStudent.studentId || 'No ID found'}` : 'Not found'
    );

    setText(
      'gc-result-originality',
      afterOriginality.normalizedSummaryText || MISSING_ORIGINALITY_TEXT
    );

    setText(
      'gc-result-originality-source',
      `${afterOriginality.sourceMethod || 'unknown'} | ${afterOriginality.sourcePreview || 'no preview'}`
    );

    info('Navigation', 'After navigation check complete', {
      changed,
      beforeStudent,
      afterStudent,
      afterOriginality
    });

    return changed;
  }

  // ------------------------ SECTION 14 AUTO CAPTURE LOOP ----------------------

  async function startAutoCapture() {
    if (state.isAutoRunning) {
      warn('Auto', 'Start requested while auto capture is already running');
      return;
    }

    state.isAutoRunning = true;
    state.isPaused = false;
    state.isStopping = false;
    state.previousAutoStudentId = '';
    state.stopReason = '';
    state.runStartedAt = state.runStartedAt || new Date().toISOString();

    state.lastAction = 'Auto capture started';
    info('Auto', 'Auto capture started');
    updateStatus();

    await autoCaptureLoop();
  }

  function pauseAutoCapture() {
    if (!state.isAutoRunning) {
      warn('Auto', 'Pause requested but auto capture is not running');
      return;
    }

    state.isPaused = true;
    state.lastAction = 'Auto capture paused';
    info('Auto', 'Auto capture paused');
    updateStatus();
  }

  function resumeAutoCapture() {
    if (!state.isAutoRunning) {
      warn('Auto', 'Resume requested but auto capture is not running');
      return;
    }

    state.isPaused = false;
    state.lastAction = 'Auto capture resumed';
    info('Auto', 'Auto capture resumed');
    updateStatus();
  }

  function stopAutoCapture() {
    if (!state.isAutoRunning) {
      warn('Auto', 'Stop requested but auto capture is not running');
      return;
    }

    state.isStopping = true;
    state.isPaused = false;
    state.stopReason = 'Manual stop requested';
    state.lastAction = 'Auto capture stop requested';
    info('Auto', 'Auto capture stop requested');
    updateStatus();
  }

  async function autoCaptureLoop() {
    try {
      while (state.isAutoRunning && !state.isStopping) {
        while (state.isPaused && !state.isStopping) {
          await sleep(500);
        }

        if (state.isStopping) break;

        const beforeStudent = getCurrentStudent();

        if (!beforeStudent.selectedFound) {
          state.stopReason = 'No current student detected';
          warn('Auto', 'No current student detected. Auto capture stopping.');
          setText('gc-result-after-navigation', 'Auto stopped: no current student detected');
          break;
        }

        if (
          state.previousAutoStudentId &&
          beforeStudent.studentId &&
          state.previousAutoStudentId === beforeStudent.studentId &&
          state.autoRunCount > 0
        ) {
          state.stopReason = 'Repeated same student before navigation';
          warn('Auto', 'Same student detected twice in a row before navigation. Auto capture stopping.', beforeStudent);
          setText('gc-result-after-navigation', 'Auto stopped: repeated same student');
          break;
        }

        state.previousAutoStudentId = beforeStudent.studentId || beforeStudent.studentName;
        state.autoRunCount += 1;

        const capture = captureCurrentStudent();

        if (!capture) {
          state.stopReason = 'Capture failed';
          warn('Auto', 'Capture failed. Auto capture stopping.');
          setText('gc-result-after-navigation', 'Auto stopped: capture failed');
          break;
        }

        if (capture.originalityMissing) {
          info('Auto', 'Continuing after missing originality report', {
            studentId: capture.studentId,
            studentName: capture.studentName,
            submissionStatus: capture.submissionStatus,
            selectedText: capture.selectedText
          });
        }

        const next = getNextTargetDetection();

        if (!next.nextCandidatesFound || !next.firstCandidate) {
          state.stopReason = 'No next target found';
          info('Auto', 'No next target found. Final student captured; auto capture complete.');
          setText('gc-result-after-navigation', 'Auto complete: final student captured; no next target found');
          break;
        }

        const moved = await goToNextStudent(beforeStudent, AUTO_LOOP_WAIT_MS);

        if (!moved) {
          state.stopReason = 'Navigation did not change student';
          warn('Auto', 'Navigation did not change student. Auto capture stopping.');
          setText('gc-result-after-navigation', 'Auto stopped: navigation did not change student');
          break;
        }

        await sleep(500);
      }
    } catch (err) {
      state.stopReason = 'Auto capture loop error';
      fail('Auto', 'Auto capture loop failed', { message: err.message });
    } finally {
      finishAutoCapture();
    }
  }

  function finishAutoCapture() {
    state.isAutoRunning = false;
    state.isPaused = false;
    state.isStopping = false;
    state.previousAutoStudentId = '';
    state.runFinishedAt = new Date().toISOString();

    if (!state.stopReason) {
      state.stopReason = 'Auto capture stopped';
    }

    state.lastAction = 'Auto capture stopped';
    info('Auto', 'Auto capture stopped', {
      captured: state.captureCount,
      duplicatesSkipped: state.duplicateSkipCount,
      missingOriginality: state.missingOriginalityCount,
      stopReason: state.stopReason,
      autoDownloadEnabled: state.autoDownloadEnabled
    });

    updateStatus();

    if (state.autoDownloadEnabled && state.captures.length) {
      downloadCsv();
    }
  }

  // ------------------------ SECTION 15 CSV EXPORT ----------------------

  function escapeCsvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function escapeXmlCell(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildWorkbookWorksheet(name, headers, rows) {
    const headerXml = headers
      .map(header => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXmlCell(header)}</Data></Cell>`)
      .join('');

    const rowXml = rows
      .map(row => `<Row>${row.map(value => `<Cell><Data ss:Type="String">${escapeXmlCell(value)}</Data></Cell>`).join('')}</Row>`)
      .join('');

    return `
      <Worksheet ss:Name="${escapeXmlCell(name)}">
        <Table>
          <Row>${headerXml}</Row>
          ${rowXml}
        </Table>
        <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
          <FreezePanes/>
          <FrozenNoSplit/>
          <SplitHorizontal>1</SplitHorizontal>
          <TopRowBottomPane>1</TopRowBottomPane>
          <ActivePane>2</ActivePane>
          <Panes>
            <Pane>
              <Number>2</Number>
              <ActiveRow>1</ActiveRow>
            </Pane>
          </Panes>
        </WorksheetOptions>
      </Worksheet>
    `;
  }

  function buildCsv() {
    const fullHeaders = [
      'Run ID',
      'Script Version',
      'Run Started At',
      'Run Finished At',
      'Stop Reason',
      'Class Period',
      'Assignment Part',
      'Full Assignment Title',
      'Student ID',
      'Student Name',
      'Submission Status',
      'Score Text',
      'Originality Summary',
      'Cited Or Quoted Text',
      'Originality Missing',
      'Originality Source Method',
      'Originality Source Title',
      'Originality Source Preview',
      'Originality Candidate Count',
      'Page Detected',
      'Selected Text',
      'Captured At'
    ];

    const fullRows = state.captures.map(item => [
      item.runId,
      item.scriptVersion,
      item.runStartedAt || state.runStartedAt,
      state.runFinishedAt,
      state.stopReason,
      item.classPeriod,
      item.assignmentPart,
      item.fullAssignmentTitle,
      item.studentId,
      item.studentName,
      item.submissionStatus,
      item.scoreText,
      item.originalitySummary,
      item.citedOrQuotedText,
      item.originalityMissing,
      item.originalitySourceMethod,
      item.originalitySourceTitle,
      item.originalitySourcePreview,
      item.originalityCandidateCount,
      item.pageDetected,
      item.selectedText,
      item.capturedAt
    ]);

    const summaryHeaders = [
      'Student Name',
      'Submission Status',
      'Originality Summary',
      'Cited Or Quoted Text'
    ];

    const summaryRows = state.captures.map(item => [
      item.studentName,
      item.submissionStatus,
      item.originalitySummary,
      item.citedOrQuotedText
    ]);

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">
    <ActiveSheet>1</ActiveSheet>
  </ExcelWorkbook>
  ${buildWorkbookWorksheet('Full Export', fullHeaders, fullRows)}
  ${buildWorkbookWorksheet('Student Summary', summaryHeaders, summaryRows)}
</Workbook>`;
  }

  function downloadCsv() {
    try {
      if (!state.captures.length) {
        warn('Export', 'Download requested but no captures exist');
        state.lastAction = 'Download requested with no captures';
        updateStatus();
        return;
      }

      const csv = buildCsv();
      const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = buildCsvFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);

      state.lastAction = 'CSV downloaded';
      info('Export', 'CSV download triggered', {
        rows: state.captures.length,
        filename: a.download
      });
      updateStatus();
    } catch (err) {
      fail('Export', 'CSV download failed', { message: err.message });
    }
  }

  // ------------------------ SECTION 16 INITIALIZATION ----------------------

  function boot() {
    try {
      if (!document.body) {
        setTimeout(boot, 250);
        return;
      }

      createOverlay();
    } catch (err) {
      console.error('[GC Originality Overlay] Boot failed', err);
      alert('GC Originality Overlay failed to load: ' + err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();