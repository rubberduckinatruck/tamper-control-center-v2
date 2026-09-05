// ==UserScript==
// @name             ARCHIVE chats - v2 ChatGPT Project Chat Archiver
// @namespace        https://chatgpt.com/
// @version          2
// @description      Discover backend ChatGPT project folders, count chats for all projects, and archive chats by project.
// @author           Big Poppa
//
// @cc-id            chatgpt-project-chat-archiver
// @cc-display-name  ChatGPT Project Chat Archiver
// @cc-category      gpt
// @cc-role          personal
// @cc-status        live
// @cc-tags          chatgpt, projects, conversations, archive, cleanup
// @cc-note          Archives ChatGPT conversations by project; verify the selected project before running.
//
// @match            https://chatgpt.com/*
// @grant            GM_setClipboard
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gpt/chatgpt-project-chat-archiver.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gpt/chatgpt-project-chat-archiver.user.js
// ==/UserScript==


(function () {
  'use strict';

  const STATE = {
    stopRequested: false,
    running: false,
    discoveredProjects: [],
    selectedProjectIds: new Set(),
    extractedData: null,
    accessToken: null,
    accessTokenFetchedAt: 0,
    currentProjectName: '',
    currentConversationTitle: '',
    currentConversationId: '',
    currentConversationIndex: 0,
    currentConversationTotal: 0,
    phase: 'Idle',
    lastStep: 'Ready',
    discoveryPagesFetched: 0,
    discoveryPagesExpected: 0,
    countProjectsDone: 0,
    countProjectsTotal: 0,
    minimized: false,
  };

  const CFG = {
    tokenTtlMs: 5 * 60 * 1000,
    discoveryDelayMs: 100,
    discoveryQueries: [
      '/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=5',
      '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=20&s=true',
      '/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=100',
      '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=100&s=true',
      '/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=100'
    ]
  };

  function nowTime() { return new Date().toLocaleTimeString(); }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function safeText(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[s]));
  }

  function copyText(text, successMessage) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      alert(successMessage);
      return;
    }
    navigator.clipboard.writeText(text).then(() => alert(successMessage));
  }

  function log(msg) {
    const line = `[${nowTime()}] ${msg}`;
    logBox.value += line + '\n';
    logBox.scrollTop = logBox.scrollHeight;
    STATE.lastStep = msg;
    updateLiveDetails();
  }

  function updateProjectCount() {
    projectCount.textContent = String(STATE.discoveredProjects.length);
  }

  function updateSelectedCount() {
    selectedCount.textContent = String(STATE.selectedProjectIds.size);
  }

  function setPhase(msg) {
    STATE.phase = msg || 'Idle';
    updateLiveDetails();
  }

  function setCurrentContext(projectName, conversationTitle, convoIndex, convoTotal) {
    STATE.currentProjectName = projectName || '';
    STATE.currentConversationTitle = conversationTitle || '';
    STATE.currentConversationIndex = convoIndex || 0;
    STATE.currentConversationTotal = convoTotal || 0;
    updateLiveDetails();
  }

  function updateLiveDetails() {
    const lines = [];
    lines.push(`Phase: ${STATE.phase || 'Idle'}`);
    if (STATE.currentProjectName) lines.push(`Project: ${STATE.currentProjectName}`);
    if (STATE.currentConversationTotal > 0) lines.push(`Chat: ${STATE.currentConversationIndex}/${STATE.currentConversationTotal}`);
    if (STATE.currentConversationTitle) lines.push(`Title: ${STATE.currentConversationTitle}`);
    if (STATE.currentConversationId) lines.push(`Chat ID: ${STATE.currentConversationId}`);
    if (STATE.phase === 'Discovery' && STATE.discoveryPagesFetched > 0) {
      if (STATE.discoveryPagesExpected > 0) {
        lines.push(`Discovery pages: ${STATE.discoveryPagesFetched}/${STATE.discoveryPagesExpected}`);
      } else {
        lines.push(`Discovery pages fetched: ${STATE.discoveryPagesFetched}`);
      }
    }
    if (STATE.phase === 'Counting project chats' && STATE.countProjectsTotal > 0) {
      lines.push(`Projects counted: ${STATE.countProjectsDone}/${STATE.countProjectsTotal}`);
    }
    lines.push(`Step: ${STATE.lastStep || 'Ready'}`);
    liveDetailsBox.textContent = lines.join('\n');
  }

  function setProgress(pct, label = '') {
    progressBar.value = Math.max(0, Math.min(100, pct));
    progressLabel.textContent = `${Math.round(pct)}%${label ? ' - ' + label : ''}`;
  }

  function setDiscoveryProgress(pageNum, maybeExpected = 0) {
    STATE.discoveryPagesFetched = pageNum;
    STATE.discoveryPagesExpected = maybeExpected || STATE.discoveryPagesExpected || 0;

    if (STATE.discoveryPagesExpected > 0) {
      setProgress((pageNum / STATE.discoveryPagesExpected) * 100, `Discovery page ${pageNum}/${STATE.discoveryPagesExpected}`);
    } else {
      const capped = Math.min(95, Math.max(5, pageNum * 5));
      setProgress(capped, `Discovery page ${pageNum}`);
    }

    updateLiveDetails();
  }

  function setCountProgress(done, total) {
    STATE.countProjectsDone = done;
    STATE.countProjectsTotal = total;
    if (total > 0) setProgress((done / total) * 100, `Counted ${done}/${total} projects`);
    updateLiveDetails();
  }

  function resetRunState() {
    STATE.currentProjectName = '';
    STATE.currentConversationTitle = '';
    STATE.currentConversationId = '';
    STATE.currentConversationIndex = 0;
    STATE.currentConversationTotal = 0;
    STATE.discoveryPagesFetched = 0;
    STATE.discoveryPagesExpected = 0;
    STATE.countProjectsDone = 0;
    STATE.countProjectsTotal = 0;
    STATE.lastStep = 'Ready';
    setProgress(0, '');
    updateLiveDetails();
  }

  async function getAccessToken(forceRefresh = false) {
    const fresh = STATE.accessToken && (Date.now() - STATE.accessTokenFetchedAt < CFG.tokenTtlMs);
    if (fresh && !forceRefresh) return STATE.accessToken;

    const res = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'accept': 'application/json, text/plain, */*' }
    });

    if (!res.ok) throw new Error(`Session fetch failed: HTTP ${res.status}`);

    const data = await res.json().catch(() => ({}));
    const token =
      data?.accessToken ||
      data?.access_token ||
      data?.user?.accessToken ||
      data?.user?.access_token ||
      null;

    if (!token) throw new Error('Could not find access token in /api/auth/session response.');

    STATE.accessToken = token;
    STATE.accessTokenFetchedAt = Date.now();
    return token;
  }

  async function apiFetch(path, opts = {}, retry401 = true) {
    const token = await getAccessToken(false);

    const headers = Object.assign({}, opts.headers || {}, {
      'accept': 'application/json, text/plain, */*',
      'authorization': `Bearer ${token}`
    });

    const res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'include',
      cache: 'no-store',
      ...opts,
      headers
    });

    if (res.status === 401 && retry401) {
      log(`401 on ${path}; refreshing token and retrying once`);
      await getAccessToken(true);
      return apiFetch(path, opts, false);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} for ${path} :: ${body.slice(0, 500)}`);
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  function normalizeProjectItem(item) {
    const outer = item?.gizmo || item?.project || null;
    const inner = outer?.gizmo || outer || null;
    const id = inner?.id || inner?.gizmo_id || null;
    if (!id || !String(id).startsWith('g-p-')) return null;

    const name =
      inner?.display?.name ||
      inner?.display_name ||
      inner?.name ||
      inner?.title ||
      inner?.project_name ||
      `Project ${id}`;

    return {
      gizmo_id: id,
      project_name: name,
      conversation_count: null,
      count_complete: false,
      count_failed: false,
      raw: item,
      preview_conversations: Array.isArray(item?.conversations) ? item.conversations : []
    };
  }

  function renderProjectChecklist(projects) {
    projectList.innerHTML = '';

    for (const p of projects) {
      const row = document.createElement('div');
      row.className = 'tmpe-project-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'tmpe-project-checkbox';
      cb.checked = STATE.selectedProjectIds.has(p.gizmo_id);

      const txt = document.createElement('div');
      txt.className = 'tmpe-project-text';

      let label = p.project_name;
      if (p.count_failed) label += ' (count failed)';
      else if (typeof p.conversation_count === 'number') label += ` (${p.conversation_count} chats)`;
      else if (p.count_complete) label += ' (0 chats)';
      else label += ' (counting...)';

      txt.innerHTML = `<div class="tmpe-project-name">${escapeHtml(label)}</div>`;

      const syncState = () => {
        if (cb.checked) STATE.selectedProjectIds.add(p.gizmo_id);
        else STATE.selectedProjectIds.delete(p.gizmo_id);
        row.classList.toggle('selected', cb.checked);
        updateSelectedCount();
      };

      cb.addEventListener('change', (ev) => {
        ev.stopPropagation();
        syncState();
      });

      row.addEventListener('click', (ev) => {
        if (ev.target === cb) return;
        cb.checked = !cb.checked;
        syncState();
      });

      row.classList.toggle('selected', cb.checked);
      row.appendChild(cb);
      row.appendChild(txt);
      projectList.appendChild(row);
    }

    updateProjectCount();
    updateSelectedCount();
  }

  async function discoverProjects() {
    resetRunState();
    setPhase('Discovery');
    log('Starting backend project discovery');
    await getAccessToken(false);

    const byId = new Map();
    let globalPageCount = 0;

    async function fetchProjectSequence(initialUrl, label) {
      let cursor = null;
      let localPage = 0;
      const seenCursors = new Set();

      while (!STATE.stopRequested) {
        let url = initialUrl;

        if (cursor) {
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}cursor=${encodeURIComponent(cursor)}`;
        }

        const data = await apiFetch(url);
        localPage += 1;
        globalPageCount += 1;
        setDiscoveryProgress(globalPageCount);

        const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
        let addedOnPage = 0;

        for (const item of items) {
          const p = normalizeProjectItem(item);
          if (p && !byId.has(p.gizmo_id)) {
            byId.set(p.gizmo_id, p);
            addedOnPage += 1;
          }
        }

        STATE.discoveredProjects = [...byId.values()];
        renderProjectChecklist(STATE.discoveredProjects);
        log(`Fetched ${label} page ${localPage} (${items.length} items, ${addedOnPage} new projects)`);

        const next = data?.cursor || data?.next_cursor || null;
        if (!next) break;
        if (seenCursors.has(next)) break;

        seenCursors.add(next);
        cursor = next;

        await sleep(CFG.discoveryDelayMs);
      }
    }

    for (const url of CFG.discoveryQueries) {
      if (STATE.stopRequested) break;
      try {
        await fetchProjectSequence(url, 'snorlax project discovery');
      } catch (err) {
        log(`Discovery query failed: ${url} :: ${err.message}`);
      }
    }

    STATE.discoveredProjects = [...byId.values()];
    renderProjectChecklist(STATE.discoveredProjects);

    if (!STATE.discoveredProjects.length) {
      throw new Error('No projects discovered from backend project queries.');
    }

    STATE.discoveryPagesExpected = globalPageCount;
    setDiscoveryProgress(globalPageCount, globalPageCount);
    setProgress(100, 'Discovery complete');
    setPhase('Discovery complete');
    log(`Discovery complete: ${STATE.discoveredProjects.length} projects`);
  }

  async function fetchProjectConversations(gizmoId, includeArchived = true) {
    const rows = [];
    let cursor = null;
    let page = 0;
    const seenCursors = new Set();

    do {
      if (STATE.stopRequested) break;

      const qs = new URLSearchParams();
      if (cursor) qs.set('cursor', cursor);
      if (includeArchived) qs.set('all', 'true');

      const path = `/backend-api/gizmos/${encodeURIComponent(gizmoId)}/conversations${qs.toString() ? `?${qs.toString()}` : ''}`;
      const data = await apiFetch(path);
      page += 1;

      const items = Array.isArray(data?.items) ? data.items : [];
      for (const item of items) {
        rows.push({
          id: item?.id || item?.conversation_id || '',
          title: item?.title || '',
          create_time: item?.create_time || null,
          update_time: item?.update_time || null,
          workspace_id: item?.workspace_id || null,
          gizmo_id: gizmoId,
          conversation_template_id: item?.conversation_template_id || null,
          is_archived: !!item?.is_archived,
          raw: item
        });
      }

      const next = data?.cursor || data?.next_cursor || null;
      log(`Fetched project ${gizmoId} conversation page ${page} (${items.length} chats)`);

      if (!next || seenCursors.has(next)) {
        cursor = null;
      } else {
        seenCursors.add(next);
        cursor = next;
      }
    } while (cursor && !STATE.stopRequested);

    return rows;
  }

  async function countChatsForAllProjects() {
    setPhase('Counting project chats');
    const projects = STATE.discoveredProjects;
    setCountProgress(0, projects.length);

    for (let i = 0; i < projects.length; i += 1) {
      if (STATE.stopRequested) break;

      const p = projects[i];
      try {
        log(`Counting chats for project ${i + 1}/${projects.length}: ${p.project_name}`);
        const convos = await fetchProjectConversations(p.gizmo_id, true);
        p.conversation_count = convos.length;
        p.count_complete = true;
        p.count_failed = false;
      } catch (err) {
        p.conversation_count = null;
        p.count_complete = false;
        p.count_failed = true;
        log(`Count failed for ${p.project_name}: ${err.message}`);
      }

      setCountProgress(i + 1, projects.length);
      renderProjectChecklist(projects);
      await sleep(100);
    }

    if (STATE.stopRequested) {
      setPhase('Stopped');
      log('Counting stopped');
    } else {
      setPhase('Counting complete');
      log('Counting complete');
    }
  }

  function selectAllProjects() {
    for (const p of STATE.discoveredProjects) STATE.selectedProjectIds.add(p.gizmo_id);
    renderProjectChecklist(STATE.discoveredProjects);
  }

  function selectNoProjects() {
    STATE.selectedProjectIds.clear();
    renderProjectChecklist(STATE.discoveredProjects);
  }

  function requestStop() {
    STATE.stopRequested = true;
    setPhase('Stopping');
    log('Stop requested by user');
  }

  async function archiveConversation(conversationId) {
    return apiFetch(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_archived: true })
    });
  }

  function copyLog() {
    const text = logBox.value || '';
    if (!text.trim()) return alert('Log is empty.');
    copyText(text, 'Log copied to clipboard.');
  }

  async function runExtraction() {
    if (STATE.running) return;
    STATE.running = true;
    STATE.stopRequested = false;
    STATE.extractedData = null;
    resetRunState();

    try {
      if (!STATE.discoveredProjects.length) await discoverProjects();

      const needsCounts = STATE.discoveredProjects.some(p => typeof p.conversation_count !== 'number' && !p.count_failed);
      if (needsCounts && !STATE.stopRequested) await countChatsForAllProjects();

      const selected = STATE.discoveredProjects.filter(p => STATE.selectedProjectIds.has(p.gizmo_id));
      if (!selected.length) throw new Error('No projects selected.');

      const maxProjects = Number(maxProjectsInput.value || selected.length);
      const chosen = selected.slice(0, maxProjects);
      const delayMs = Number(delayInput.value || 250);

      log(`Starting archive for ${chosen.length} selected project(s)`);
      setPhase('Project archive');

      const result = {
        archived_at: new Date().toISOString(),
        project_count: chosen.length,
        projects: []
      };

      let completedProjects = 0;

      for (const project of chosen) {
        if (STATE.stopRequested) break;

        setCurrentContext(project.project_name, '', 0, 0);
        STATE.currentConversationId = '';
        updateLiveDetails();
        log(`Project start: ${project.project_name}`);

        const conversations = await fetchProjectConversations(project.gizmo_id, true);
        STATE.currentConversationTotal = conversations.length;
        updateLiveDetails();

        const projectOut = {
          gizmo_id: project.gizmo_id,
          project_name: project.project_name,
          conversation_count: conversations.length,
          archived_count: 0,
          skipped_count: 0,
          failed_count: 0,
          conversations: []
        };

        for (let i = 0; i < conversations.length; i += 1) {
          if (STATE.stopRequested) break;

          const c = conversations[i];
          const shownTitle = c.title || '(untitled)';
          setCurrentContext(project.project_name, shownTitle, i + 1, conversations.length);
          STATE.currentConversationId = c.id || '';
          updateLiveDetails();

          const projectFraction = completedProjects / chosen.length;
          const withinProjectFraction = conversations.length ? (i / conversations.length) / chosen.length : 0;
          setProgress((projectFraction + withinProjectFraction) * 100, `${completedProjects}/${chosen.length} projects`);

          log(`Archiving chat ${i + 1}/${conversations.length}: ${shownTitle} (${c.id})`);

          if (c.is_archived) {
            projectOut.skipped_count += 1;
            projectOut.conversations.push({
              id: c.id,
              title: shownTitle,
              status: 'skipped'
            });
            log(`Skipped archive: already archived :: ${shownTitle}`);
            await sleep(delayMs);
            continue;
          }

          try {
            await archiveConversation(c.id);
            projectOut.archived_count += 1;
            projectOut.conversations.push({
              id: c.id,
              title: shownTitle,
              status: 'archived'
            });
            log(`Archived: ${shownTitle}`);
          } catch (err) {
            projectOut.failed_count += 1;
            projectOut.conversations.push({
              id: c.id,
              title: shownTitle,
              status: 'failed',
              error: err.message
            });
            log(`Archive failed: ${shownTitle} :: ${err.message}`);
          }

          await sleep(delayMs);
        }

        result.projects.push(projectOut);
        completedProjects += 1;
        setProgress((completedProjects / chosen.length) * 100, `${completedProjects}/${chosen.length} projects`);
        log(`Project complete: ${project.project_name} (${projectOut.archived_count} archived, ${projectOut.skipped_count} skipped, ${projectOut.failed_count} failed)`);
      }

      STATE.extractedData = result;

      if (STATE.stopRequested) {
        setPhase('Stopped');
        log('Archive stopped');
      } else {
        setPhase('Complete');
        setProgress(100, 'Archive complete');
        log('Archive complete');
      }
    } catch (err) {
      console.error(err);
      setPhase('Error');
      log(`ERROR: ${err.message}`);
      alert(`Archive error:\n${err.message}`);
    } finally {
      STATE.running = false;
    }
  }

  function toggleMinimize() {
    STATE.minimized = !STATE.minimized;
    if (STATE.minimized) {
      body.style.display = 'none';
      root.style.height = 'auto';
      root.style.resize = 'none';
      root.style.width = '360px';
      minBtn.textContent = '+';
    } else {
      body.style.display = 'flex';
      root.style.height = '86vh';
      root.style.resize = 'both';
      root.style.width = '430px';
      minBtn.textContent = '−';
    }
  }

  const root = document.createElement('div');
  root.id = 'tm-chatgpt-project-extractor';
  Object.assign(root.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '430px',
    height: '86vh',
    zIndex: '999999',
    background: '#111827',
    color: '#f9fafb',
    border: '1px solid #374151',
    borderRadius: '12px',
    padding: '12px',
    boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
    fontFamily: 'Arial, sans-serif',
    fontSize: '12px',
    overflow: 'hidden',
    resize: 'both'
  });

  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong style="font-size:14px;">ChatGPT Project Chat Archiver</strong>
      <button id="tmpe-min" style="background:#374151;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;">−</button>
    </div>

    <div id="tmpe-body" style="display:flex;flex-direction:column;height:calc(100% - 32px);">
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px;align-items:end;">
        <label>Max projects
          <input id="tmpe-max-projects" type="number" min="1" value="9999" style="width:120px;margin-top:3px;">
        </label>
        <label>Delay ms
          <input id="tmpe-delay" type="number" min="0" value="250" style="width:72px;margin-top:3px;">
        </label>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
        <button id="tmpe-discover">Discover Projects</button>
        <button id="tmpe-select-all">Select All</button>
        <button id="tmpe-select-none">Select None</button>
        <button id="tmpe-start">Archive Chats</button>
        <button id="tmpe-stop">Stop</button>
      </div>

      <progress id="tmpe-progress" value="0" max="100" style="width:100%;height:18px;"></progress>
      <div id="tmpe-progress-label" style="margin:4px 0 6px 0;">0%</div>
      <div id="tmpe-live-details" class="tmpe-box" style="min-height:84px;margin-bottom:8px;font-size:11px;line-height:1.3;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;">Idle</div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <strong>Discovered Projects</strong>
        <span><span id="tmpe-selected-count">0</span> selected / <span id="tmpe-project-count">0</span></span>
      </div>
      <div id="tmpe-project-list" class="tmpe-box" style="height:360px;overflow:auto;margin-bottom:8px;"></div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <strong>Log</strong>
        <button id="tmpe-copy-log" style="padding:4px 8px;">Copy Log</button>
      </div>
      <textarea id="tmpe-log" readonly style="width:100%;flex:1;min-height:96px;max-height:120px;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:6px;padding:6px;resize:none;font-size:10px;line-height:1.25;"></textarea>
    </div>
  `;

  document.documentElement.appendChild(root);

  const style = document.createElement('style');
  style.textContent = `
    #tm-chatgpt-project-extractor button,
    #tm-chatgpt-project-extractor input:not([type="checkbox"]) {
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid #4b5563;
      padding: 6px 8px;
      background: #1f2937;
      color: #f9fafb;
      box-sizing: border-box;
    }
    #tm-chatgpt-project-extractor input[type="checkbox"] {
      appearance: auto;
      -webkit-appearance: checkbox;
      width: 18px;
      height: 18px;
      padding: 0;
      margin: 0;
      border: none;
      background: transparent;
      box-shadow: none;
      accent-color: #60a5fa;
      cursor: pointer;
      box-sizing: border-box;
    }
    #tm-chatgpt-project-extractor button {
      cursor: pointer;
    }
    #tm-chatgpt-project-extractor button:hover {
      filter: brightness(1.08);
    }
    #tm-chatgpt-project-extractor .tmpe-box {
      background: #0b1220;
      border: 1px solid #374151;
      border-radius: 6px;
      padding: 6px;
    }
    #tm-chatgpt-project-extractor .tmpe-project-row {
      display: grid;
      grid-template-columns: 20px 1fr;
      gap: 6px;
      align-items: center;
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 2px;
      border: 1px solid transparent;
      user-select: none;
    }
    #tm-chatgpt-project-extractor .tmpe-project-row:hover {
      background: #162033;
      border-color: #334155;
    }
    #tm-chatgpt-project-extractor .tmpe-project-row.selected {
      background: #1d2b42;
      border-color: #60a5fa;
    }
    #tm-chatgpt-project-extractor .tmpe-project-checkbox {
      width: 16px;
      height: 16px;
      margin: 0;
      cursor: pointer;
    }
    #tm-chatgpt-project-extractor .tmpe-project-name {
      font-size: 12px;
      line-height: 1.1;
      word-break: break-word;
      margin: 0;
    }
  `;
  document.head.appendChild(style);

  const minBtn = root.querySelector('#tmpe-min');
  const body = root.querySelector('#tmpe-body');
  const maxProjectsInput = root.querySelector('#tmpe-max-projects');
  const delayInput = root.querySelector('#tmpe-delay');
  const progressBar = root.querySelector('#tmpe-progress');
  const progressLabel = root.querySelector('#tmpe-progress-label');
  const liveDetailsBox = root.querySelector('#tmpe-live-details');
  const projectList = root.querySelector('#tmpe-project-list');
  const projectCount = root.querySelector('#tmpe-project-count');
  const selectedCount = root.querySelector('#tmpe-selected-count');
  const logBox = root.querySelector('#tmpe-log');

  root.querySelector('#tmpe-discover').addEventListener('click', async () => {
    try {
      STATE.stopRequested = false;
      await discoverProjects();
      if (!STATE.stopRequested) await countChatsForAllProjects();
    } catch (err) {
      console.error(err);
      setPhase('Discovery failed');
      log(`ERROR: ${err.message}`);
      alert(`Discovery failed:\n${err.message}`);
    }
  });

  root.querySelector('#tmpe-select-all').addEventListener('click', selectAllProjects);
  root.querySelector('#tmpe-select-none').addEventListener('click', selectNoProjects);
  root.querySelector('#tmpe-start').addEventListener('click', runExtraction);
  root.querySelector('#tmpe-stop').addEventListener('click', requestStop);
  root.querySelector('#tmpe-copy-log').addEventListener('click', copyLog);
  minBtn.addEventListener('click', toggleMinimize);

  log('Overlay loaded');
  setPhase('Idle');
  updateProjectCount();
  updateSelectedCount();
})();