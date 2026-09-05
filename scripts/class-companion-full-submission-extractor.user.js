// ==UserScript==
// @name             Class Companion - Full Submission Extractor
// @namespace        https://openai.com/
// @version          2.0.0
// @description      Export full student written submission data from Class Companion for the current assignment or current class period.
// @author           Big Poppa
//
// @cc-id            class-companion-full-submission-extractor
// @cc-display-name  Class Companion Full Submission Extractor
// @cc-category      class-companion
// @cc-role          teaching
// @cc-status        live
// @cc-tags          class companion, student submissions, assignments, class periods, export
// @cc-note          Exports student submission data from the currently open assignment or class-period view.
//
// @match            https://classcompanion.com/teacher/classes/*
// @match            https://classcompanion.com/teacher/classes/*/assignments/*/submissions
// @match            https://classcompanion.com/teacher/classes/*/assignments/*/submissions*
// @match            https://classcompanion.com/teacher/classes/*/submissions/*
// @grant            none
// @run-at           document-idle
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/class-companion-full-submission-extractor.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/class-companion-full-submission-extractor.user.js
// ==/UserScript==


(() => {
  'use strict';


//--------------- SECTION 1 - SETTINGS / CONFIG ---------------
  // GraphQL Endpoint Configuration
  // Pagination Settings
  // Detail Fetch Concurrency Settings
  // Retry And Delay Settings
  // UI Element Id Configuration
  // Mount Root Configuration
  // Debug Configuration

  const CONFIG = {
    version: '2.0.0',

    graphqlUrl: 'https://classcompanion.com/api/graphql',

    pageSize: 100,
    assignmentPickerMax: 200,

    detailConcurrency: 4,

    retryCount: 2,
    retryDelayMs: 700,

    buttonId: 'cc-full-export-launcher',
    panelId: 'cc-full-export-panel',
    overlayId: 'cc-full-export-overlay',
    mountAttr: 'data-cc-export-root',

    modeLabels: {
      assignment: 'Export This Assignment',
      classPeriod: 'Export This Class Period',
    },

    includeFields: {
      promptText: true,
      sourceText: true,
      rubricText: true,
      feedbackText: true,
      diagnostics: true,
    },

    diagnostics: {
      enabled: true,
      logGraphqlFailures: true,
      logNormalizationWarnings: true,
      includeRawDetailInJson: true,
    },

    debug: false,
  };

  const STATUS_VALUES = Object.freeze({
    success: 'success',
    graphqlError: 'graphql_error',
    malformedPayload: 'malformed_payload',
    noDetailPayload: 'no_detail_payload',
    requestFailed: 'request_failed',
  });

  const DETAIL_FETCH_STATUS = Object.freeze({
    notNeeded: 'no_submission',
    pending: 'pending_detail_fetch',
    loaded: 'detail_loaded',
    loadedNoResponse: 'detail_loaded_no_response_found',
    failed: 'detail_fetch_failed',
  });

  const SUBMISSION_PRESENCE = Object.freeze({
    none: 'no_submission',
    present: 'submission_present',
  });

  const RESPONSE_SOURCE_PATH_NOTE = Object.freeze({
    shortAnswerAttemptBody: 'shortanswer_attempt_body',
    nonShortAnswerAttemptBody: 'non_shortanswer_attempt_body',
    latestAttemptFallback: 'latest_attempt_fallback',
    currentDraftFallback: 'current_draft_fallback',
    noResponseFound: 'no_response_found',
  });

  const PAGE_TYPE = Object.freeze({
    unknown: 'unknown',
    teacherClassPage: 'teacher_class_page',
    assignmentSubmissionsPage: 'assignment_submissions_page',
    singleSubmissionPage: 'single_submission_page',
  });

  const CSV_COLUMNS = Object.freeze([
    'class_slug',
    'assignment_id',
    'assignment_name',
    'student_name',
    'student_first_name',
    'student_last_name',
    'student_user_id',
    'student_profile_id',
    'submission_id',
    'submission_presence',
    'submission_status',
    'submission_flags',
    'submitted_at',
    'viewer_last_attempt_read_at',
    'score_current',
    'score_max',
    'score_percent',
    'detail_fetch_status',
    'response_found',
    'response_question_format',
    'response_attempt_count',
    'response_source_path_note',
    'response_text',
    'latest_attempt_submitted_at',
    'latest_attempt_updated_at',
    'latest_attempt_id',
    'latest_attempt_score_current',
    'latest_attempt_score_max',
    'question_prompt_text',
    'source_excerpt_text',
    'feedback_text',
    'rubric_labels_and_scores',
    'extraction_note',
    'detail_error',
  ]);


//--------------- SECTION 2 - GRAPHQL QUERY DEFINITIONS ---------------
  // Teacher Assignments Page Query
  // Assignment Submissions Query
  // Teacher Submission Page Query

  const QUERIES = {
    TeacherAssignmentsPage: `
      query TeacherAssignmentsPage($classSlug: String!) {
        classBySlug(slug: $classSlug) {
          id
          slug
          assignmentCount
          isDemo
          assignments: allAssignments {
            id
            url
            createdAt
            publishAt
            dueAt
            isShownToStudents
            status
            submissionCount(status: Complete)
            assignedStudentCount
            problem {
              id
              rootId
              name
              questionFormats
              taxonomy {
                id
                label
              }
            }
            group {
              id
              label
              index
            }
          }
        }
        viewer {
          id
          isPremium
          inDistrict
        }
        versionDiff(clientVersion: "1.0")
      }
    `,

    AssignmentSubmissions: `
      query AssignmentSubmissions(
        $first: Int,
        $after: String,
        $id: ID!,
        $order: Order!,
        $orderField: String!,
        $userIds: [ID!],
        $status: [SubmissionStatus!],
        $flags: [SubmissionFlag!],
        $search: String
      ) {
        assignmentById(id: $id) {
          id
          submissionCount
          class {
            id
            slug
            isPremium
            studentProfiles {
              id
              user {
                id
                displayName
                firstName
                lastName
              }
            }
            allAssignments {
              id
              createdAt
              problem {
                id
                name
                enabledSubmissionFlags
              }
            }
          }
          submissions(
            first: $first
            after: $after
            order: $order
            orderField: $orderField
            userIds: $userIds
            status: $status
            flags: $flags
            search: $search
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                user {
                  id
                  displayName
                  firstName
                  lastName
                }
                assignment {
                  id
                  createdAt
                  problem {
                    id
                    name
                    enabledSubmissionFlags
                  }
                }
                submission {
                  id
                  status
                  flags
                  submittedAt
                  viewerLastAttemptReadAt
                  score {
                    max
                    current
                    percent
                  }
                }
              }
            }
          }
        }
        versionDiff(clientVersion: "1.0")
      }
    `,

    TeacherSubmissionPage: `
      query TeacherSubmissionPage($submissionId: ID!, $classSlug: String!) {
        viewer {
          id
          displayName
          isTeacher
        }
        classBySlug(slug: $classSlug) {
          id
          slug
        }
        submissionById(id: $submissionId) {
          id
          viewerIsOwner
          isFeedbackReleased
          status
          createdAt
          submittedAt
          lastSentAttemptAt
          score {
            max
            current
          }
          user {
            id
            displayName
            isTeacher
            isStudent
          }
          lastUpdatedAttempt {
            id
          }
          accessibilitySettings {
            isDictationEnabled
            timerMultiplier
          }
          assignment {
            id
            status
            isShownToStudents
            closeAt
            class {
              id
              slug
              viewerIsTeacher
            }
            problem {
              id
              name
              isScoreShown
              isRubricShown
              timeLimit
              submissionFormat
              feedbackTiming
              isOrdered
              isPastingDisabled
              enabledSubmissionFlags
              shuffleAnswerChoices
              isTutorShown
              taxonomy {
                id
                label
              }
              essayRubric {
                id
              }
              shortAnswerRubric {
                id
              }
            }
          }
          questionsAttemptsMap {
            id
            questionMaxScore
            isMissingResponse
            attemptCount
            pasteCount
            copiedAndLeftCount
            averageWordsPerMinute
            isEditable
            canGenerateExemplaryResponse
            currentDraft {
              id
              body
              submittedAt
              updatedAt
              score {
                current
                max
              }
            }
            exemplaryResponse {
              id
              body
              submittedAt
              updatedAt
              score {
                current
                max
              }
            }
            question {
              id
              format
              question
              indexPath
              maxAttempts
              relevantAttachments {
                id
                type
                excerpt
                url
                citation
                questionIndexPath
                excerptAtReadingLevel
              }
            }
            attempts {
              id
              body
              copiedAndLeftCount
              submittedAt
              feedbackFailedAt
              updatedAt
              pastedItems
              score {
                current
                max
              }
              user {
                id
                displayName
              }
              assessments {
                id
                criteriaId
                score
                status
                feedback {
                  id
                  content
                  adjustedContent
                  references
                }
                criteria {
                  id
                  label
                  maxScore
                }
                user {
                  id
                  displayName
                }
              }
            }
          }
        }
      }
    `,
  };
//--------------- SECTION 3 - BASIC UTILITIES ---------------
  // Logging Utility
  // Sleep Utility
  // CSV Escaping
  // Filename Sanitization
  // Timestamp Generator

  function log(...args) {
    if (!CONFIG.debug) return;
    console.log('[CC Extractor]', ...args);
  }

  function warn(...args) {
    if (!CONFIG.debug && !CONFIG.diagnostics.enabled) return;
    console.warn('[CC Extractor]', ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeString(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function safeTrimmedString(value) {
    return safeString(value).trim();
  }

  function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function getNestedValue(obj, path, fallback = undefined) {
    if (!obj || !Array.isArray(path) || !path.length) return fallback;
    let current = obj;
    for (const key of path) {
      if (current === null || current === undefined) return fallback;
      current = current[key];
    }
    return current === undefined ? fallback : current;
  }

  function hasNonEmptyText(value) {
    return safeTrimmedString(value).length > 0;
  }

  function normalizeWhitespace(value) {
    return safeString(value)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cleanupResponseText(value) {
    return normalizeWhitespace(value);
  }

  function escCsv(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function sanitizeFilenamePart(value) {
    return safeString(value)
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      '_',
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join('');
  }

  function joinNameParts(firstName, lastName, displayName) {
    const explicit = safeTrimmedString(displayName);
    if (explicit) return explicit;
    return [safeTrimmedString(firstName), safeTrimmedString(lastName)]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function dedupeStrings(values) {
    const out = [];
    const seen = new Set();
    for (const value of safeArray(values)) {
      const cleaned = normalizeWhitespace(value);
      if (!cleaned) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      out.push(cleaned);
    }
    return out;
  }

  function summarizeRubricEntries(entries) {
    const out = [];
    for (const entry of safeArray(entries)) {
      const label = safeTrimmedString(entry?.criteria_label);
      const score = entry?.score ?? '';
      const maxScore = entry?.max_score ?? '';
      if (!label && score === '' && maxScore === '') continue;
      out.push(`${label}: ${score}/${maxScore}`.trim());
    }
    return out.join(' | ');
  }

  function buildExtractionNote(parts) {
    return dedupeStrings(parts).join(' | ');
  }

  function createBaseRow({
    classSlug = '',
    assignmentId = '',
    assignmentName = '',
    studentName = '',
    studentFirstName = '',
    studentLastName = '',
    studentUserId = '',
    studentProfileId = '',
    submissionId = '',
    submissionStatus = 'NoSubmission',
    submissionFlags = [],
    submittedAt = '',
    viewerLastAttemptReadAt = '',
    scoreCurrent = '',
    scoreMax = '',
    scorePercent = '',
  }) {
    const hasSubmission = Boolean(submissionId);

    return {
      class_slug: classSlug,
      assignment_id: assignmentId,
      assignment_name: assignmentName,
      student_name: studentName,
      student_first_name: studentFirstName,
      student_last_name: studentLastName,
      student_user_id: studentUserId,
      student_profile_id: studentProfileId,
      submission_id: submissionId,

      submission_presence: hasSubmission ? SUBMISSION_PRESENCE.present : SUBMISSION_PRESENCE.none,
      submission_status: submissionStatus,
      submission_flags: Array.isArray(submissionFlags) ? submissionFlags : [],
      submitted_at: submittedAt,
      viewer_last_attempt_read_at: viewerLastAttemptReadAt,

      score_current: scoreCurrent,
      score_max: scoreMax,
      score_percent: scorePercent,

      detail_fetch_status: hasSubmission ? DETAIL_FETCH_STATUS.pending : DETAIL_FETCH_STATUS.notNeeded,
      response_found: false,
      response_question_format: '',
      response_attempt_count: 0,
      response_source_path_note: hasSubmission ? '' : RESPONSE_SOURCE_PATH_NOTE.noResponseFound,
      response_text: '',

      latest_attempt_submitted_at: '',
      latest_attempt_updated_at: '',
      latest_attempt_id: '',
      latest_attempt_score_current: '',
      latest_attempt_score_max: '',

      question_prompts: [],
      question_prompt_text: '',
      source_excerpts: [],
      source_excerpt_text: '',
      feedback_texts: [],
      feedback_text: '',
      rubric_labels_and_scores: [],

      extraction_note: hasSubmission ? 'Awaiting detail fetch.' : 'No submission exists for this student.',
      detail_error: '',
      raw_detail: null,
    };
  }

  function cloneWithoutRawDetail(row) {
    return {
      ...row,
      raw_detail: undefined,
    };
  }


//--------------- SECTION 4 - URL PARSING / PAGE CONTEXT DETECTION ---------------
  // Class Slug Extraction
  // Assignment Id Extraction
  // Assignment Page Detection

  function getClassSlugFromPath(pathname = location.pathname) {
    const match = safeString(pathname).match(/^\/teacher\/classes\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getAssignmentIdFromPath(pathname = location.pathname) {
    const match = safeString(pathname).match(
      /^\/teacher\/classes\/[^/]+\/assignments\/([^/]+)\/submissions/
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getSubmissionIdFromPath(pathname = location.pathname) {
    const match = safeString(pathname).match(
      /^\/teacher\/classes\/[^/]+\/submissions\/([^/?#]+)/
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function isAssignmentSubmissionsPage(pathname = location.pathname) {
    return /^\/teacher\/classes\/[^/]+\/assignments\/[^/]+\/submissions/.test(safeString(pathname));
  }

  function isSingleSubmissionPage(pathname = location.pathname) {
    return /^\/teacher\/classes\/[^/]+\/submissions\/[^/?#]+/.test(safeString(pathname));
  }

  function isTeacherClassPage(pathname = location.pathname) {
    return /^\/teacher\/classes\/[^/]+\/?$/.test(safeString(pathname));
  }

  function detectPageType(pathname = location.pathname) {
    if (isAssignmentSubmissionsPage(pathname)) return PAGE_TYPE.assignmentSubmissionsPage;
    if (isSingleSubmissionPage(pathname)) return PAGE_TYPE.singleSubmissionPage;
    if (isTeacherClassPage(pathname)) return PAGE_TYPE.teacherClassPage;
    return PAGE_TYPE.unknown;
  }

  function getPageContext(pathname = location.pathname, href = location.href) {
    const pageType = detectPageType(pathname);
    const classSlug = getClassSlugFromPath(pathname);
    const assignmentId = getAssignmentIdFromPath(pathname);
    const submissionId = getSubmissionIdFromPath(pathname);

    return {
      href,
      pathname,
      page_type: pageType,
      class_slug: classSlug || '',
      assignment_id: assignmentId || '',
      submission_id: submissionId || '',
      can_export_assignment: Boolean(classSlug && assignmentId && pageType === PAGE_TYPE.assignmentSubmissionsPage),
      can_export_class_period: Boolean(classSlug),
      is_known_teacher_page: pageType !== PAGE_TYPE.unknown,
    };
  }

  function assertRequiredContext(context, requirement) {
    if (!context || typeof context !== 'object') {
      throw new Error('Page context could not be determined.');
    }

    if (requirement === 'assignment' && !context.can_export_assignment) {
      throw new Error('This export requires an assignment submissions page with both class and assignment context.');
    }

    if (requirement === 'class' && !context.can_export_class_period) {
      throw new Error('This export requires a teacher class context.');
    }

    return context;
  }

  const INITIAL_PAGE_CONTEXT = getPageContext();
  log('Initial page context:', INITIAL_PAGE_CONTEXT);


//--------------- SECTION 5 - UI ROOT + OVERLAY SYSTEM ---------------
  // Mount Root Creation
  // Overlay Construction

  function getMountRoot() {
    let root = document.querySelector(`[${CONFIG.mountAttr}="1"]`);
    if (root && document.body.contains(root)) return root;

    root = document.createElement('div');
    root.setAttribute(CONFIG.mountAttr, '1');
    root.style.position = 'fixed';
    root.style.right = '0';
    root.style.bottom = '0';
    root.style.zIndex = '2147483645';
    root.style.pointerEvents = 'none';
    document.body.appendChild(root);
    return root;
  }

  function buildOverlay() {
    const root = getMountRoot();

    let overlay = document.getElementById(CONFIG.overlayId);
    if (overlay && root.contains(overlay)) return overlay;
    if (overlay && overlay.parentNode) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = CONFIG.overlayId;
    overlay.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'width:360px',
      'max-width:calc(100vw - 32px)',
      'background:#0f172a',
      'color:#fff',
      'border-radius:12px',
      'box-shadow:0 10px 30px rgba(0,0,0,.35)',
      'padding:14px 16px',
      'font-family:Arial, sans-serif',
      'display:none',
      'pointer-events:auto',
      'z-index:2147483647',
    ].join(';');

    overlay.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Class Companion Export</div>
      <div id="${CONFIG.overlayId}-status" style="font-size:13px;line-height:1.4;white-space:pre-wrap;">Starting...</div>
      <div style="height:8px;background:rgba(255,255,255,.16);border-radius:999px;margin-top:12px;overflow:hidden;">
        <div id="${CONFIG.overlayId}-bar" style="height:100%;width:0%;background:#3b82f6;transition:width .2s ease;"></div>
      </div>
      <div id="${CONFIG.overlayId}-note" style="font-size:11px;line-height:1.4;opacity:.85;margin-top:10px;display:none;"></div>
    `;
    root.appendChild(overlay);
    return overlay;
  }

  function getOverlayElements() {
    const overlay = buildOverlay();
    return {
      overlay,
      statusEl: document.getElementById(`${CONFIG.overlayId}-status`),
      barEl: document.getElementById(`${CONFIG.overlayId}-bar`),
      noteEl: document.getElementById(`${CONFIG.overlayId}-note`),
    };
  }


//--------------- SECTION 6 - OVERLAY STATE MANAGEMENT ---------------
  // Status Display
  // Progress Bar Updates
  // Overlay Visibility Control

  function setOverlay(status, current = null, total = null, note = '') {
    const { overlay, statusEl, barEl, noteEl } = getOverlayElements();
    overlay.style.display = 'block';

    if (statusEl) {
      statusEl.textContent = safeString(status) || 'Working...';
    }

    if (barEl) {
      let pct = 0;
      if (typeof current === 'number' && typeof total === 'number' && total > 0) {
        pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
      }
      barEl.style.width = `${pct}%`;
    }

    if (noteEl) {
      const showNote = CONFIG.diagnostics.enabled && hasNonEmptyText(note);
      noteEl.style.display = showNote ? 'block' : 'none';
      noteEl.textContent = showNote ? safeString(note) : '';
    }
  }

  function setOverlayPhaseLoadingRoster(current = null, total = null, note = '') {
    setOverlay('Loading assignment roster...', current, total, note);
  }

  function setOverlayPhaseFetchingDetails(current = null, total = null, note = '') {
    setOverlay('Fetching submission details...', current, total, note);
  }

  function setOverlayPhaseBuildingExport(current = null, total = null, note = '') {
    setOverlay('Building export rows...', current, total, note);
  }

  function setOverlayPhaseDownloading(current = null, total = null, note = '') {
    setOverlay('Preparing download...', current, total, note);
  }

  function hideOverlay() {
    const overlay = document.getElementById(CONFIG.overlayId);
    if (overlay) overlay.style.display = 'none';
  }

  function hideOverlaySoon(delayMs = 1800) {
    setTimeout(hideOverlay, delayMs);
  }


//--------------- SECTION 7 - GRAPHQL REQUEST ENGINE ---------------
  // Request Execution
  // Retry Logic
  // Error Handling

  async function graphqlRequest(operationName, query, variables) {
    let attempt = 0;
    let lastError = null;

    while (attempt <= CONFIG.retryCount) {
      try {
        const response = await fetch(CONFIG.graphqlUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: '*/*',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            operationName,
            query,
            variables,
          }),
        });

        const text = await response.text();

        let json;
        try {
          json = JSON.parse(text);
        } catch {
          return {
            ok: false,
            status: STATUS_VALUES.malformedPayload,
            operationName,
            error_message: `Non-JSON response for ${operationName}: ${text.slice(0, 500)}`,
            data: null,
            raw_text: text,
            http_status: response.status,
          };
        }

        if (!response.ok) {
          return {
            ok: false,
            status: STATUS_VALUES.requestFailed,
            operationName,
            error_message: `${operationName} failed with HTTP ${response.status}`,
            data: null,
            raw_text: text,
            http_status: response.status,
            graphql_errors: safeArray(json?.errors),
          };
        }

        if (safeArray(json?.errors).length) {
          return {
            ok: false,
            status: STATUS_VALUES.graphqlError,
            operationName,
            error_message: safeArray(json.errors).map((e) => e?.message || 'Unknown GraphQL error').join(' | '),
            data: null,
            raw_text: text,
            http_status: response.status,
            graphql_errors: safeArray(json.errors),
          };
        }

        if (!json || typeof json !== 'object' || !('data' in json)) {
          return {
            ok: false,
            status: STATUS_VALUES.malformedPayload,
            operationName,
            error_message: `${operationName} returned a payload without a data property.`,
            data: null,
            raw_text: text,
            http_status: response.status,
          };
        }

        return {
          ok: true,
          status: STATUS_VALUES.success,
          operationName,
          error_message: '',
          data: json.data,
          raw_text: text,
          http_status: response.status,
        };
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt > CONFIG.retryCount) {
          break;
        }
        await sleep(CONFIG.retryDelayMs * attempt);
      }
    }

    return {
      ok: false,
      status: STATUS_VALUES.requestFailed,
      operationName,
      error_message: lastError?.message || String(lastError || 'Unknown request failure'),
      data: null,
      raw_text: '',
      http_status: null,
    };
  }

  function assertGraphqlSuccess(result) {
    if (!result?.ok) {
      const err = new Error(result?.error_message || 'GraphQL request failed.');
      err.graphqlStatus = result?.status || STATUS_VALUES.requestFailed;
      err.graphqlOperationName = result?.operationName || '';
      err.graphqlResult = result || null;
      throw err;
    }
    return result.data;
  }

  function buildMalformedPayloadError(message, operationName, extra = {}) {
    const error = new Error(message);
    error.graphqlStatus = STATUS_VALUES.malformedPayload;
    error.graphqlOperationName = operationName;
    Object.assign(error, extra);
    return error;
  }


//--------------- SECTION 8 - GRAPHQL DATA FETCHERS ---------------
  // Fetch Teacher Assignments
  // Fetch Assignment Submissions (Paginated)
  // Fetch Submission Detail

  async function fetchTeacherAssignmentsPage(classSlug) {
    const result = await graphqlRequest(
      'TeacherAssignmentsPage',
      QUERIES.TeacherAssignmentsPage,
      { classSlug }
    );

    const data = assertGraphqlSuccess(result);
    const classBySlug = getNestedValue(data, ['classBySlug'], null);

    if (!classBySlug) {
      throw buildMalformedPayloadError(
        'TeacherAssignmentsPage returned no classBySlug payload.',
        'TeacherAssignmentsPage',
        { graphqlData: data, classSlug }
      );
    }

    return {
      classBySlug,
      viewer: getNestedValue(data, ['viewer'], null),
      versionDiff: getNestedValue(data, ['versionDiff'], null),
      raw: data,
    };
  }

  async function fetchAssignmentSubmissionsPage(assignmentId, after = null) {
    const result = await graphqlRequest(
      'AssignmentSubmissions',
      QUERIES.AssignmentSubmissions,
      {
        id: assignmentId,
        first: CONFIG.pageSize,
        after,
        orderField: 'submittedAt',
        order: 'desc',
        search: null,
      }
    );

    const data = assertGraphqlSuccess(result);
    const assignmentById = getNestedValue(data, ['assignmentById'], null);
    const submissions = getNestedValue(assignmentById, ['submissions'], null);

    if (!assignmentById) {
      throw buildMalformedPayloadError(
        'AssignmentSubmissions returned no assignmentById payload.',
        'AssignmentSubmissions',
        { graphqlData: data, assignmentId }
      );
    }

    if (!submissions) {
      throw buildMalformedPayloadError(
        'AssignmentSubmissions returned no submissions connection.',
        'AssignmentSubmissions',
        { graphqlData: data, assignmentId }
      );
    }

    return {
      assignment: assignmentById,
      connection: submissions,
      raw: data,
    };
  }

  async function fetchAssignmentSubmissionsAll(assignmentId) {
    const allEdges = [];
    let after = null;
    let pageCount = 0;
    let finalAssignment = null;

    while (true) {
      const page = await fetchAssignmentSubmissionsPage(assignmentId, after);
      pageCount += 1;

      finalAssignment = page.assignment;
      const edges = safeArray(getNestedValue(page, ['connection', 'edges'], []));
      const pageInfo = safeObject(getNestedValue(page, ['connection', 'pageInfo'], {}));

      allEdges.push(...edges);

      if (!pageInfo.hasNextPage) {
        break;
      }

      if (!pageInfo.endCursor) {
        warn('AssignmentSubmissions indicated more pages but provided no endCursor.', {
          assignmentId,
          pageCount,
        });
        break;
      }

      after = pageInfo.endCursor;
    }

    return {
      assignment: finalAssignment,
      edges: allEdges,
      page_count: pageCount,
    };
  }

  async function fetchTeacherSubmissionDetail(submissionId, classSlug) {
    const result = await graphqlRequest(
      'TeacherSubmissionPage',
      QUERIES.TeacherSubmissionPage,
      {
        submissionId,
        classSlug,
      }
    );

    const data = assertGraphqlSuccess(result);
    const submissionById = getNestedValue(data, ['submissionById'], null);

    if (!submissionById || typeof submissionById !== 'object') {
      const error = new Error('TeacherSubmissionPage returned no submissionById.');
      error.graphqlStatus = STATUS_VALUES.noDetailPayload;
      error.graphqlOperationName = 'TeacherSubmissionPage';
      error.graphqlData = data;
      error.submissionId = submissionId;
      error.classSlug = classSlug;
      throw error;
    }

    if (!Array.isArray(submissionById.questionsAttemptsMap)) {
      throw buildMalformedPayloadError(
        'TeacherSubmissionPage returned submissionById without questionsAttemptsMap.',
        'TeacherSubmissionPage',
        { graphqlData: data, submissionId, classSlug }
      );
    }

    return {
      submissionById,
      raw: data,
    };
  }


//--------------- SECTION 9 - BASE ROSTER EXTRACTION ---------------
  // Student Profile Mapping
  // Submission Node Mapping
  // Full Roster Row Construction
  // Missing Submission Handling

  function buildSubmissionNodeMap(edges) {
    const byUserId = new Map();

    for (const edge of safeArray(edges)) {
      const node = safeObject(edge?.node);
      const user = safeObject(node?.user);
      const submission = node?.submission ? safeObject(node.submission) : null;
      const assignment = safeObject(node?.assignment);

      const userId = safeTrimmedString(user?.id);
      if (!userId) continue;

      byUserId.set(userId, {
        user,
        submission,
        assignment,
        node,
      });
    }

    return byUserId;
  }

  function normalizeRosterRowFromProfile(profile, submissionNodeRecord, fallbackAssignment, classSlug) {
    const profileObj = safeObject(profile);
    const user = safeObject(profileObj?.user);
    const nodeRecord = submissionNodeRecord ? safeObject(submissionNodeRecord) : null;

    const submission = nodeRecord?.submission ? safeObject(nodeRecord.submission) : null;
    const nodeAssignment = nodeRecord?.assignment ? safeObject(nodeRecord.assignment) : {};
    const assignment = Object.keys(nodeAssignment).length ? nodeAssignment : safeObject(fallbackAssignment);
    const problem = safeObject(assignment?.problem);

    const studentName = joinNameParts(
      user?.firstName,
      user?.lastName,
      user?.displayName
    );

    return createBaseRow({
      classSlug,
      assignmentId: safeTrimmedString(assignment?.id),
      assignmentName: safeTrimmedString(problem?.name),
      studentName,
      studentFirstName: safeTrimmedString(user?.firstName),
      studentLastName: safeTrimmedString(user?.lastName),
      studentUserId: safeTrimmedString(user?.id),
      studentProfileId: safeTrimmedString(profileObj?.id),
      submissionId: safeTrimmedString(submission?.id),
      submissionStatus: safeTrimmedString(submission?.status) || 'NoSubmission',
      submissionFlags: safeArray(submission?.flags),
      submittedAt: safeTrimmedString(submission?.submittedAt),
      viewerLastAttemptReadAt: safeTrimmedString(submission?.viewerLastAttemptReadAt),
      scoreCurrent: submission?.score?.current ?? '',
      scoreMax: submission?.score?.max ?? '',
      scorePercent: submission?.score?.percent ?? '',
    });
  }

  function normalizeRosterRowFromUnmatchedSubmission(record, fallbackAssignment, classSlug) {
    const nodeRecord = safeObject(record);
    const user = safeObject(nodeRecord?.user);
    const submission = nodeRecord?.submission ? safeObject(nodeRecord.submission) : null;
    const nodeAssignment = nodeRecord?.assignment ? safeObject(nodeRecord.assignment) : {};
    const assignment = Object.keys(nodeAssignment).length ? nodeAssignment : safeObject(fallbackAssignment);
    const problem = safeObject(assignment?.problem);

    const studentName = joinNameParts(
      user?.firstName,
      user?.lastName,
      user?.displayName
    );

    const row = createBaseRow({
      classSlug,
      assignmentId: safeTrimmedString(assignment?.id),
      assignmentName: safeTrimmedString(problem?.name),
      studentName,
      studentFirstName: safeTrimmedString(user?.firstName),
      studentLastName: safeTrimmedString(user?.lastName),
      studentUserId: safeTrimmedString(user?.id),
      studentProfileId: '',
      submissionId: safeTrimmedString(submission?.id),
      submissionStatus: safeTrimmedString(submission?.status) || 'NoSubmission',
      submissionFlags: safeArray(submission?.flags),
      submittedAt: safeTrimmedString(submission?.submittedAt),
      viewerLastAttemptReadAt: safeTrimmedString(submission?.viewerLastAttemptReadAt),
      scoreCurrent: submission?.score?.current ?? '',
      scoreMax: submission?.score?.max ?? '',
      scorePercent: submission?.score?.percent ?? '',
    });

    if (!row.student_profile_id) {
      row.extraction_note = buildExtractionNote([
        row.extraction_note,
        'Student appeared in submissions but not in studentProfiles.',
      ]);
    }

    return row;
  }

  function extractBaseRowsFromAssignment(assignmentPayload) {
    const assignment = safeObject(assignmentPayload?.assignment);
    const edges = safeArray(assignmentPayload?.edges);
    const classObj = safeObject(assignment?.class);
    const classSlug = safeTrimmedString(classObj?.slug);
    const studentProfiles = safeArray(classObj?.studentProfiles);
    const fallbackAssignment = {
      id: safeTrimmedString(assignment?.id),
      problem: safeObject(assignment?.problem),
    };

    const nodeMap = buildSubmissionNodeMap(edges);
    const rows = [];
    const seenUserIds = new Set();

    for (const profile of studentProfiles) {
      const userId = safeTrimmedString(profile?.user?.id);
      const row = normalizeRosterRowFromProfile(
        profile,
        userId ? nodeMap.get(userId) : null,
        fallbackAssignment,
        classSlug
      );

      if (!row.assignment_id) {
        row.assignment_id = safeTrimmedString(assignment?.id);
      }

      if (!row.assignment_name) {
        row.assignment_name = safeTrimmedString(assignment?.problem?.name);
      }

      if (row.submission_presence === SUBMISSION_PRESENCE.none) {
        row.detail_fetch_status = DETAIL_FETCH_STATUS.notNeeded;
        row.response_found = false;
        row.response_source_path_note = RESPONSE_SOURCE_PATH_NOTE.noResponseFound;
        row.extraction_note = 'No submission exists for this student.';
      } else {
        row.detail_fetch_status = DETAIL_FETCH_STATUS.pending;
        row.extraction_note = 'Roster row created; awaiting submission detail fetch.';
      }

      rows.push(row);
      if (userId) seenUserIds.add(userId);
    }

    for (const record of nodeMap.values()) {
      const userId = safeTrimmedString(record?.user?.id);
      if (!userId || seenUserIds.has(userId)) continue;

      const row = normalizeRosterRowFromUnmatchedSubmission(
        record,
        fallbackAssignment,
        classSlug
      );

      if (row.submission_presence === SUBMISSION_PRESENCE.none) {
        row.detail_fetch_status = DETAIL_FETCH_STATUS.notNeeded;
        row.response_found = false;
        row.response_source_path_note = RESPONSE_SOURCE_PATH_NOTE.noResponseFound;
        row.extraction_note = buildExtractionNote([
          row.extraction_note,
          'Unmatched submission row had no submission id.',
        ]);
      } else {
        row.detail_fetch_status = DETAIL_FETCH_STATUS.pending;
        row.extraction_note = buildExtractionNote([
          row.extraction_note,
          'Roster row created from unmatched submission node; awaiting detail fetch.',
        ]);
      }

      rows.push(row);
    }

    return rows;
  }

  function finalizeBlankSubmissionRows(rows) {
    for (const row of safeArray(rows)) {
      if (row.submission_presence !== SUBMISSION_PRESENCE.none) continue;

      row.detail_fetch_status = DETAIL_FETCH_STATUS.notNeeded;
      row.response_found = false;
      row.response_question_format = '';
      row.response_attempt_count = 0;
      row.response_source_path_note = RESPONSE_SOURCE_PATH_NOTE.noResponseFound;
      row.response_text = '';

      row.latest_attempt_submitted_at = '';
      row.latest_attempt_updated_at = '';
      row.latest_attempt_id = '';
      row.latest_attempt_score_current = '';
      row.latest_attempt_score_max = '';

      row.question_prompts = [];
      row.question_prompt_text = '';
      row.source_excerpts = [];
      row.source_excerpt_text = '';
      row.feedback_texts = [];
      row.feedback_text = '';
      row.rubric_labels_and_scores = [];
      row.detail_error = '';
      row.raw_detail = null;

      row.extraction_note = 'No submission exists for this student.';
    }

    return rows;
  }


//--------------- SECTION 10 - SOURCE / ATTACHMENT NORMALIZATION ---------------
  // Relevant Attachment Flattening
  // Source Deduplication
  // Normalized Source Output

  function normalizeSourceItem(item) {
    const obj = safeObject(item);
    return {
      id: safeTrimmedString(obj?.id),
      type: safeTrimmedString(obj?.type),
      excerpt: normalizeWhitespace(obj?.excerpt || ''),
      url: safeTrimmedString(obj?.url),
      citation: safeTrimmedString(obj?.citation),
    };
  }

  function buildSourceDedupKey(item) {
    return [
      safeTrimmedString(item?.id),
      safeTrimmedString(item?.type),
      normalizeWhitespace(item?.excerpt || ''),
      safeTrimmedString(item?.url),
      safeTrimmedString(item?.citation),
    ].join('||');
  }

  function flattenSources(question) {
    const questionObj = safeObject(question);
    const relevantAttachments = safeArray(questionObj?.relevantAttachments);
    const combined = [...relevantAttachments];

    const out = [];
    const seen = new Set();

    for (const rawItem of combined) {
      const normalized = normalizeSourceItem(rawItem);
      const key = buildSourceDedupKey(normalized);

      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }

    return out;
  }

  function sourceItemsToText(items) {
    const excerpts = [];
    for (const item of safeArray(items)) {
      if (hasNonEmptyText(item?.excerpt)) {
        excerpts.push(normalizeWhitespace(item.excerpt));
      }
    }
    return dedupeStrings(excerpts).join('\n\n-----\n\n');
  }


//--------------- SECTION 11 - FULL SUBMISSION DETAIL NORMALIZATION (CRITICAL SECTION) ---------------
  // Submission Detail Validation
  // Question Map Collection
  // Response Bearing Map Selection
  // Attempt Candidate Ranking
  // Primary Response Extraction
  // Prompt Extraction
  // Source Extraction
  // Feedback Extraction
  // Rubric Extraction
  // Latest Attempt Resolution
  // Normalized Detail Output

  function normalizeQuestionPrompt(question) {
    const q = safeObject(question);
    return {
      question_id: safeTrimmedString(q?.id),
      format: safeTrimmedString(q?.format),
      index_path: Array.isArray(q?.indexPath) ? q.indexPath : [],
      question: normalizeWhitespace(q?.question || ''),
    };
  }

  function normalizeAssessment(assessment) {
    const a = safeObject(assessment);
    const criteria = safeObject(a?.criteria);
    const feedbackList = safeArray(a?.feedback).map((feedback) => {
      const f = safeObject(feedback);
      return {
        feedback_id: safeTrimmedString(f?.id),
        content: normalizeWhitespace(f?.content || ''),
        adjusted_content: normalizeWhitespace(f?.adjustedContent || ''),
        references: safeArray(f?.references),
      };
    });

    return {
      assessment_id: safeTrimmedString(a?.id),
      criteria_id: safeTrimmedString(criteria?.id || a?.criteriaId),
      criteria_label: safeTrimmedString(criteria?.label),
      criteria_max_score: criteria?.maxScore ?? '',
      score: a?.score ?? '',
      status: safeTrimmedString(a?.status),
      feedback: feedbackList,
    };
  }

  function normalizeAttempt(attempt, question, map) {
    const attemptObj = safeObject(attempt);
    const questionObj = safeObject(question);
    const mapObj = safeObject(map);

    const assessments = safeArray(attemptObj?.assessments).map(normalizeAssessment);

    return {
      attempt_id: safeTrimmedString(attemptObj?.id),
      question_id: safeTrimmedString(questionObj?.id),
      question_format: safeTrimmedString(questionObj?.format),
      question_index_path: Array.isArray(questionObj?.indexPath) ? questionObj.indexPath : [],
      body: cleanupResponseText(attemptObj?.body || ''),
      copied_and_left_count: attemptObj?.copiedAndLeftCount ?? mapObj?.copiedAndLeftCount ?? 0,
      pasted_items: safeArray(attemptObj?.pastedItems),
      submitted_at: safeTrimmedString(attemptObj?.submittedAt),
      updated_at: safeTrimmedString(attemptObj?.updatedAt),
      feedback_failed_at: safeTrimmedString(attemptObj?.feedbackFailedAt),
      score_current: attemptObj?.score?.current ?? '',
      score_max: attemptObj?.score?.max ?? '',
      assessments,
    };
  }

  function normalizeDraftAttempt(draft, question, map) {
    const draftObj = safeObject(draft);
    const questionObj = safeObject(question);
    const mapObj = safeObject(map);

    if (!draftObj || !Object.keys(draftObj).length) {
      return null;
    }

    return {
      attempt_id: safeTrimmedString(draftObj?.id),
      question_id: safeTrimmedString(questionObj?.id),
      question_format: safeTrimmedString(questionObj?.format),
      question_index_path: Array.isArray(questionObj?.indexPath) ? questionObj.indexPath : [],
      body: cleanupResponseText(draftObj?.body || ''),
      copied_and_left_count: mapObj?.copiedAndLeftCount ?? 0,
      pasted_items: [],
      submitted_at: safeTrimmedString(draftObj?.submittedAt),
      updated_at: safeTrimmedString(draftObj?.updatedAt),
      feedback_failed_at: '',
      score_current: draftObj?.score?.current ?? '',
      score_max: draftObj?.score?.max ?? '',
      assessments: [],
    };
  }

  function collectQuestionMaps(detail) {
    const maps = safeArray(detail?.questionsAttemptsMap);
    const collected = [];

    for (const rawMap of maps) {
      const mapObj = safeObject(rawMap);
      const question = safeObject(mapObj?.question);
      const normalizedQuestion = normalizeQuestionPrompt(question);
      const attempts = safeArray(mapObj?.attempts).map((attempt) =>
        normalizeAttempt(attempt, question, mapObj)
      );
      const currentDraftAttempt = normalizeDraftAttempt(mapObj?.currentDraft, question, mapObj);
      const currentDraft = cleanupResponseText(getNestedValue(mapObj, ['currentDraft', 'body'], '') || '');

      collected.push({
        map_id: safeTrimmedString(mapObj?.id),
        question: normalizedQuestion,
        question_max_score: mapObj?.questionMaxScore ?? '',
        is_missing_response: Boolean(mapObj?.isMissingResponse),
        attempt_count: Number(mapObj?.attemptCount ?? attempts.length ?? 0),
        current_draft: currentDraft,
        current_draft_attempt: currentDraftAttempt,
        paste_count: mapObj?.pasteCount ?? 0,
        copied_and_left_count: mapObj?.copiedAndLeftCount ?? 0,
        attempts,
        sources: flattenSources(question),
      });
    }

    return collected;
  }

  function hasAttemptBody(attempt) {
    return hasNonEmptyText(attempt?.body);
  }

  function buildAttemptTimestampScore(attempt) {
    const updated = attempt?.updated_at ? new Date(attempt.updated_at).getTime() : 0;
    const submitted = attempt?.submitted_at ? new Date(attempt.submitted_at).getTime() : 0;
    return Math.max(updated || 0, submitted || 0, 0);
  }

  function chooseBestAttemptFromMap(mapEntry, preferredAttemptId = '') {
    const attempts = safeArray(mapEntry?.attempts);
    if (!attempts.length) return null;

    const preferred = safeTrimmedString(preferredAttemptId);
    if (preferred) {
      const exact = attempts.find((attempt) => safeTrimmedString(attempt?.attempt_id) === preferred);
      if (exact && hasAttemptBody(exact)) return exact;
    }

    const attemptsWithBody = attempts.filter(hasAttemptBody);
    if (!attemptsWithBody.length) return null;

    return [...attemptsWithBody].sort((a, b) => {
      return buildAttemptTimestampScore(b) - buildAttemptTimestampScore(a);
    })[0];
  }

  function scoreResponseBearingMap(mapEntry, preferredAttemptId = '') {
    const questionFormat = safeTrimmedString(mapEntry?.question?.format);
    const bestAttempt = chooseBestAttemptFromMap(mapEntry, preferredAttemptId);
    const hasBodyAttempt = Boolean(bestAttempt && hasAttemptBody(bestAttempt));
    const hasDraft = hasNonEmptyText(mapEntry?.current_draft);

    let score = 0;
    if (questionFormat === 'ShortAnswer' && hasBodyAttempt) score += 1000;
    else if (hasBodyAttempt) score += 500;
    else if (questionFormat === 'ShortAnswer' && hasDraft) score += 200;
    else if (hasDraft) score += 100;

    score += Math.min(Number(mapEntry?.attempt_count || 0), 50);

    if (bestAttempt) {
      score += Math.min(buildAttemptTimestampScore(bestAttempt) / 1e10, 99);
    } else if (mapEntry?.current_draft_attempt) {
      score += Math.min(buildAttemptTimestampScore(mapEntry.current_draft_attempt) / 1e10, 99);
    }

    return {
      mapEntry,
      bestAttempt,
      score,
      hasBodyAttempt,
      hasDraft,
      questionFormat,
    };
  }

  function selectResponseBearingMap(mapEntries, preferredAttemptId = '') {
    const scored = safeArray(mapEntries).map((entry) =>
      scoreResponseBearingMap(entry, preferredAttemptId)
    );

    const viable = scored.filter((entry) => entry.hasBodyAttempt || entry.hasDraft);
    if (!viable.length) return null;

    viable.sort((a, b) => b.score - a.score);
    return viable[0];
  }

  function resolveResponseFromSelectedMap(selectedMapInfo, preferredAttemptId = '') {
    if (!selectedMapInfo) {
      return {
        response_text: '',
        response_question_format: '',
        response_attempt_count: 0,
        response_found: false,
        response_source_path_note: RESPONSE_SOURCE_PATH_NOTE.noResponseFound,
        selected_attempt: null,
      };
    }

    const mapEntry = selectedMapInfo.mapEntry;
    let chosenAttempt = selectedMapInfo.bestAttempt;

    if (!chosenAttempt && preferredAttemptId) {
      chosenAttempt = chooseBestAttemptFromMap(mapEntry, preferredAttemptId);
    }

    if (chosenAttempt && hasAttemptBody(chosenAttempt)) {
      const sourcePathNote =
        safeTrimmedString(mapEntry?.question?.format) === 'ShortAnswer'
          ? RESPONSE_SOURCE_PATH_NOTE.shortAnswerAttemptBody
          : RESPONSE_SOURCE_PATH_NOTE.nonShortAnswerAttemptBody;

      return {
        response_text: chosenAttempt.body,
        response_question_format: safeTrimmedString(mapEntry?.question?.format),
        response_attempt_count: safeArray(mapEntry?.attempts).filter(hasAttemptBody).length,
        response_found: true,
        response_source_path_note: sourcePathNote,
        selected_attempt: chosenAttempt,
      };
    }

    if (hasNonEmptyText(mapEntry?.current_draft)) {
      return {
        response_text: cleanupResponseText(mapEntry.current_draft),
        response_question_format: safeTrimmedString(mapEntry?.question?.format),
        response_attempt_count: safeArray(mapEntry?.attempts).length,
        response_found: true,
        response_source_path_note: RESPONSE_SOURCE_PATH_NOTE.currentDraftFallback,
        selected_attempt: mapEntry?.current_draft_attempt || null,
      };
    }

    return {
      response_text: '',
      response_question_format: safeTrimmedString(mapEntry?.question?.format),
      response_attempt_count: safeArray(mapEntry?.attempts).length,
      response_found: false,
      response_source_path_note: RESPONSE_SOURCE_PATH_NOTE.noResponseFound,
      selected_attempt: null,
    };
  }

  function resolveLatestAttempt(mapEntries, preferredAttemptId = '') {
    const allAttempts = [];
    for (const mapEntry of safeArray(mapEntries)) {
      allAttempts.push(...safeArray(mapEntry?.attempts));
      if (mapEntry?.current_draft_attempt) {
        allAttempts.push(mapEntry.current_draft_attempt);
      }
    }

    if (!allAttempts.length) return null;

    const preferred = safeTrimmedString(preferredAttemptId);
    if (preferred) {
      const exact = allAttempts.find((attempt) => safeTrimmedString(attempt?.attempt_id) === preferred);
      if (exact) return exact;
    }

    return [...allAttempts].sort((a, b) => {
      return buildAttemptTimestampScore(b) - buildAttemptTimestampScore(a);
    })[0];
  }

  function collectQuestionPromptsFromMaps(mapEntries) {
    const prompts = [];
    for (const mapEntry of safeArray(mapEntries)) {
      const q = safeObject(mapEntry?.question);
      if (!hasNonEmptyText(q?.question)) continue;
      prompts.push(q);
    }
    return prompts;
  }

  function collectSourceExcerptsFromMaps(mapEntries) {
    const out = [];
    for (const mapEntry of safeArray(mapEntries)) {
      out.push(...safeArray(mapEntry?.sources));
    }
    return out;
  }

  function collectFeedbackAndRubricFromMaps(mapEntries) {
    const allFeedback = [];
    const rubricLabelsAndScores = [];

    for (const mapEntry of safeArray(mapEntries)) {
      for (const attempt of safeArray(mapEntry?.attempts)) {
        for (const assessment of safeArray(attempt?.assessments)) {
          if (assessment.criteria_label || assessment.score !== '') {
            rubricLabelsAndScores.push({
              attempt_id: safeTrimmedString(attempt?.attempt_id),
              criteria_label: safeTrimmedString(assessment?.criteria_label),
              score: assessment?.score ?? '',
              max_score: assessment?.criteria_max_score ?? '',
            });
          }

          for (const feedback of safeArray(assessment?.feedback)) {
            const content = normalizeWhitespace(feedback?.content || '');
            const adjusted = normalizeWhitespace(feedback?.adjusted_content || '');
            if (!content && !adjusted) continue;

            allFeedback.push({
              attempt_id: safeTrimmedString(attempt?.attempt_id),
              criteria_label: safeTrimmedString(assessment?.criteria_label),
              content,
              adjusted_content: adjusted,
              references: safeArray(feedback?.references),
            });
          }
        }
      }
    }

    return {
      allFeedback,
      rubricLabelsAndScores,
    };
  }

  function normalizeTeacherSubmissionDetail(detailPayload) {
    const detail = safeObject(detailPayload?.submissionById || detailPayload);
    if (!detail || !detail.id) {
      throw new Error('TeacherSubmissionPage returned no submissionById.');
    }

    const mapEntries = collectQuestionMaps(detail);
    const preferredAttemptId = safeTrimmedString(detail?.lastUpdatedAttempt?.id);

    const selectedMapInfo = selectResponseBearingMap(mapEntries, preferredAttemptId);
    const responseResolution = resolveResponseFromSelectedMap(selectedMapInfo, preferredAttemptId);
    const latestAttempt = responseResolution.selected_attempt || resolveLatestAttempt(mapEntries, preferredAttemptId);

    const questionPrompts = collectQuestionPromptsFromMaps(mapEntries);
    const sourceExcerpts = collectSourceExcerptsFromMaps(mapEntries);
    const { allFeedback, rubricLabelsAndScores } = collectFeedbackAndRubricFromMaps(mapEntries);

    const extractionNotes = [];

    if (!selectedMapInfo) {
      extractionNotes.push('No response-bearing question map found.');
    } else {
      extractionNotes.push(
        `Selected response map format: ${safeTrimmedString(selectedMapInfo?.mapEntry?.question?.format) || 'Unknown'}.`
      );

      if (responseResolution.response_source_path_note === RESPONSE_SOURCE_PATH_NOTE.currentDraftFallback) {
        extractionNotes.push('Used currentDraft fallback because no non-empty attempt body was selected.');
      }

      if (!responseResolution.response_found) {
        extractionNotes.push('Detail loaded but no response text was extracted.');
      }
    }

    if (preferredAttemptId && latestAttempt && safeTrimmedString(latestAttempt?.attempt_id) !== preferredAttemptId) {
      extractionNotes.push('Preferred lastUpdatedAttempt was not usable; used latest available attempt fallback.');
    }

    const feedbackText = dedupeStrings(
      allFeedback.map((item) => item.content || item.adjusted_content || '')
    ).join('\n\n');

    return {
      response_text: responseResolution.response_text,
      response_question_format: responseResolution.response_question_format,
      response_attempt_count: responseResolution.response_attempt_count,
      response_found: responseResolution.response_found,
      response_source_path_note: responseResolution.response_source_path_note,

      latest_attempt_submitted_at: safeTrimmedString(latestAttempt?.submitted_at),
      latest_attempt_updated_at: safeTrimmedString(latestAttempt?.updated_at),
      latest_attempt_id: safeTrimmedString(latestAttempt?.attempt_id),
      latest_attempt_score_current: latestAttempt?.score_current ?? '',
      latest_attempt_score_max: latestAttempt?.score_max ?? '',

      question_prompts: questionPrompts,
      question_prompt_text: CONFIG.includeFields.promptText
        ? questionPrompts.map((q) => q.question).filter(Boolean).join('\n\n-----\n\n')
        : '',
      source_excerpts: sourceExcerpts,
      source_excerpt_text: CONFIG.includeFields.sourceText ? sourceItemsToText(sourceExcerpts) : '',
      feedback_texts: allFeedback,
      feedback_text: CONFIG.includeFields.feedbackText ? feedbackText : '',
      rubric_labels_and_scores: rubricLabelsAndScores,

      extraction_note: buildExtractionNote(extractionNotes),
      raw_detail: CONFIG.diagnostics.includeRawDetailInJson ? detail : null,
    };
  }


//--------------- SECTION 12 - DETAIL ENRICHMENT ENGINE (PARALLEL FETCH LOOP) ---------------
  // Real Submission Filtering
  // Parallel Detail Fetch Queue
  // Row Level Detail Assignment
  // Detail Failure Capture
  // Blank Submission Row Finalization

  function getRowsRequiringDetail(rows) {
    return safeArray(rows).filter(
      (row) =>
        row.submission_presence === SUBMISSION_PRESENCE.present &&
        hasNonEmptyText(row.submission_id)
    );
  }

  function applyNormalizedDetailToRow(row, normalizedDetail) {
    row.response_text = normalizedDetail.response_text;
    row.response_question_format = normalizedDetail.response_question_format;
    row.response_attempt_count = normalizedDetail.response_attempt_count;
    row.response_found = Boolean(normalizedDetail.response_found);
    row.response_source_path_note = normalizedDetail.response_source_path_note;

    row.latest_attempt_submitted_at = normalizedDetail.latest_attempt_submitted_at;
    row.latest_attempt_updated_at = normalizedDetail.latest_attempt_updated_at;
    row.latest_attempt_id = normalizedDetail.latest_attempt_id;
    row.latest_attempt_score_current = normalizedDetail.latest_attempt_score_current;
    row.latest_attempt_score_max = normalizedDetail.latest_attempt_score_max;

    row.question_prompts = normalizedDetail.question_prompts;
    row.question_prompt_text = normalizedDetail.question_prompt_text;
    row.source_excerpts = normalizedDetail.source_excerpts;
    row.source_excerpt_text = normalizedDetail.source_excerpt_text;
    row.feedback_texts = normalizedDetail.feedback_texts;
    row.feedback_text = normalizedDetail.feedback_text;
    row.rubric_labels_and_scores = normalizedDetail.rubric_labels_and_scores;

    row.raw_detail = normalizedDetail.raw_detail;
    row.detail_error = '';
    row.extraction_note = normalizedDetail.extraction_note || '';

    row.detail_fetch_status = row.response_found
      ? DETAIL_FETCH_STATUS.loaded
      : DETAIL_FETCH_STATUS.loadedNoResponse;
  }

  function applyDetailFailureToRow(row, error) {
    row.response_text = '';
    row.response_question_format = '';
    row.response_attempt_count = 0;
    row.response_found = false;
    row.response_source_path_note = RESPONSE_SOURCE_PATH_NOTE.noResponseFound;

    row.latest_attempt_submitted_at = '';
    row.latest_attempt_updated_at = '';
    row.latest_attempt_id = '';
    row.latest_attempt_score_current = '';
    row.latest_attempt_score_max = '';

    row.question_prompts = [];
    row.question_prompt_text = '';
    row.source_excerpts = [];
    row.source_excerpt_text = '';
    row.feedback_texts = [];
    row.feedback_text = '';
    row.rubric_labels_and_scores = [];
    row.raw_detail = null;

    row.detail_fetch_status = DETAIL_FETCH_STATUS.failed;
    row.detail_error = error?.message || String(error || 'Unknown detail fetch failure');
    row.extraction_note = buildExtractionNote([
      'Submission detail fetch failed.',
      row.detail_error,
    ]);
  }

  async function enrichRowsWithDetails(rows, classSlug, progressPrefix = '') {
    const rowsNeedingDetail = getRowsRequiringDetail(rows);
    let completed = 0;

    if (!rowsNeedingDetail.length) {
      finalizeBlankSubmissionRows(rows);
      return rows;
    }

    async function worker(queue) {
      while (queue.length) {
        const row = queue.shift();
        if (!row) continue;

        try {
          setOverlayPhaseFetchingDetails(
            completed,
            rowsNeedingDetail.length,
            `${progressPrefix}\n${completed + 1} / ${rowsNeedingDetail.length}`
          );

          const detailPayload = await fetchTeacherSubmissionDetail(
            row.submission_id,
            classSlug
          );
          const normalizedDetail = normalizeTeacherSubmissionDetail(detailPayload.submissionById);
          applyNormalizedDetailToRow(row, normalizedDetail);
        } catch (error) {
          applyDetailFailureToRow(row, error);
        } finally {
          completed += 1;
          setOverlayPhaseFetchingDetails(
            completed,
            rowsNeedingDetail.length,
            `${progressPrefix}\n${completed} / ${rowsNeedingDetail.length}`
          );
        }
      }
    }

    const queue = rowsNeedingDetail.slice();
    const workers = [];
    const workerCount = Math.min(
      CONFIG.detailConcurrency,
      Math.max(1, queue.length)
    );

    for (let i = 0; i < workerCount; i += 1) {
      workers.push(worker(queue));
    }

    await Promise.all(workers);
    finalizeBlankSubmissionRows(rows);
    return rows;
  }

//--------------- SECTION 13 - CSV + DOWNLOAD UTILITIES ---------------
  // Export Column Definitions
  // CSV Row Serialization
  // Blob Download Helper

  function serializeRowForCsv(row) {
    const csvRow = {
      ...row,
      submission_flags: Array.isArray(row?.submission_flags)
        ? row.submission_flags.join(' | ')
        : '',
      rubric_labels_and_scores: Array.isArray(row?.rubric_labels_and_scores)
        ? summarizeRubricEntries(row.rubric_labels_and_scores)
        : '',
    };

    if (!CONFIG.includeFields.promptText) {
      csvRow.question_prompt_text = '';
    }

    if (!CONFIG.includeFields.sourceText) {
      csvRow.source_excerpt_text = '';
    }

    if (!CONFIG.includeFields.feedbackText) {
      csvRow.feedback_text = '';
    }

    if (!CONFIG.includeFields.rubricText) {
      csvRow.rubric_labels_and_scores = '';
    }

    if (!CONFIG.includeFields.diagnostics) {
      csvRow.detail_fetch_status = '';
      csvRow.response_found = '';
      csvRow.response_source_path_note = '';
      csvRow.extraction_note = '';
      csvRow.detail_error = '';
    }

    return csvRow;
  }

  function getActiveCsvColumns() {
    if (CONFIG.includeFields.diagnostics) return [...CSV_COLUMNS];

    return CSV_COLUMNS.filter((column) => {
      return ![
        'detail_fetch_status',
        'response_found',
        'response_source_path_note',
        'extraction_note',
        'detail_error',
      ].includes(column);
    });
  }

  function rowsToCsv(rows) {
    const columns = getActiveCsvColumns();
    const lines = [columns.join(',')];

    for (const row of safeArray(rows)) {
      const serialized = serializeRowForCsv(row);
      lines.push(columns.map((column) => escCsv(serialized[column])).join(','));
    }

    return lines.join('\n');
  }

  function buildJsonExportRows(rows) {
    return safeArray(rows).map((row) => {
      if (CONFIG.diagnostics.includeRawDetailInJson) {
        return row;
      }
      return cloneWithoutRawDetail(row);
    });
  }

  function downloadBlob(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildAssignmentExportBaseName(classSlug, assignmentName) {
    const stamp = nowStamp();
    const safeClass = sanitizeFilenamePart(classSlug);
    const safeAssignment = sanitizeFilenamePart(assignmentName);
    return `classcompanion_${safeClass}_${safeAssignment}_${stamp}`;
  }

  function buildClassPeriodExportBaseName(classSlug) {
    const stamp = nowStamp();
    const safeClass = sanitizeFilenamePart(classSlug);
    return `classcompanion_${safeClass}_class_period_${stamp}`;
  }


//--------------- SECTION 14 - EXPORT PAYLOAD + DEDUP LOGIC ---------------
  // Export Payload Builder
  // Class Period Deduplication
  // Submission State Preservation

  function buildExportPayload(rows, mode, classSlug) {
    return {
      exported_at: new Date().toISOString(),
      exporter_version: CONFIG.version,
      mode,
      class_slug: classSlug,
      page_url: location.href,
      row_count: safeArray(rows).length,
      rows: buildJsonExportRows(rows),
    };
  }

  function getRowStateScore(row) {
    if (row?.submission_presence === SUBMISSION_PRESENCE.none) return 0;
    if (row?.detail_fetch_status === DETAIL_FETCH_STATUS.failed) return 1;
    if (row?.detail_fetch_status === DETAIL_FETCH_STATUS.loadedNoResponse) return 2;
    if (row?.detail_fetch_status === DETAIL_FETCH_STATUS.loaded && row?.response_found) return 3;
    if (row?.submission_presence === SUBMISSION_PRESENCE.present) return 1;
    return 0;
  }

  function getRowRecencyScore(row) {
    const submittedAt = row?.submitted_at ? new Date(row.submitted_at).getTime() : 0;
    const updatedAt = row?.latest_attempt_updated_at ? new Date(row.latest_attempt_updated_at).getTime() : 0;
    return Math.max(submittedAt || 0, updatedAt || 0, 0);
  }

  function mergeRowDiagnostics(baseRow, candidateRow) {
    const merged = { ...baseRow };

    if (!hasNonEmptyText(merged.extraction_note) && hasNonEmptyText(candidateRow?.extraction_note)) {
      merged.extraction_note = candidateRow.extraction_note;
    }

    if (!hasNonEmptyText(merged.detail_error) && hasNonEmptyText(candidateRow?.detail_error)) {
      merged.detail_error = candidateRow.detail_error;
    }

    if ((!merged.raw_detail || typeof merged.raw_detail !== 'object') && candidateRow?.raw_detail) {
      merged.raw_detail = candidateRow.raw_detail;
    }

    return merged;
  }

  function dedupeClassPeriodRows(rows) {
    const map = new Map();

    for (const row of safeArray(rows)) {
      const key = [
        safeTrimmedString(row?.assignment_id),
        safeTrimmedString(row?.student_user_id),
      ].join('::');

      if (!map.has(key)) {
        map.set(key, row);
        continue;
      }

      const existing = map.get(key);
      const existingStateScore = getRowStateScore(existing);
      const currentStateScore = getRowStateScore(row);

      if (currentStateScore > existingStateScore) {
        map.set(key, mergeRowDiagnostics(row, existing));
        continue;
      }

      if (currentStateScore < existingStateScore) {
        map.set(key, mergeRowDiagnostics(existing, row));
        continue;
      }

      const existingRecency = getRowRecencyScore(existing);
      const currentRecency = getRowRecencyScore(row);

      if (currentRecency > existingRecency) {
        map.set(key, mergeRowDiagnostics(row, existing));
      } else {
        map.set(key, mergeRowDiagnostics(existing, row));
      }
    }

    return Array.from(map.values());
  }

//--------------- SECTION 15 - EXPORT: SINGLE ASSIGNMENT ---------------
  // Assignment Context Resolution
  // Assignment Roster Load
  // Assignment Detail Enrichment
  // Assignment File Naming
  // Assignment Export Download

  async function exportThisAssignment(selectedAssignmentId = '') {
    const context = assertRequiredContext(getPageContext(), 'assignment');
    const classSlug = context.class_slug;
    const assignmentId = safeTrimmedString(selectedAssignmentId || context.assignment_id);

    if (!assignmentId) {
      throw new Error('Could not determine assignment id for assignment export.');
    }

    setOverlayPhaseLoadingRoster(0, 1, 'Loading assignment roster and submission list...');
    const payload = await fetchAssignmentSubmissionsAll(assignmentId);
    const rows = extractBaseRowsFromAssignment(payload);

    const assignmentName =
      safeTrimmedString(rows?.[0]?.assignment_name) ||
      safeTrimmedString(payload?.assignment?.problem?.name) ||
      sanitizeFilenamePart(assignmentId);

    setOverlayPhaseBuildingExport(
      0,
      Math.max(1, getRowsRequiringDetail(rows).length),
      `Assignment: ${assignmentName}\nPreparing detail enrichment...`
    );

    await enrichRowsWithDetails(rows, classSlug, `Assignment: ${assignmentName}`);

    const baseName = buildAssignmentExportBaseName(classSlug, assignmentName);
    const csvText = rowsToCsv(rows);
    const jsonText = JSON.stringify(buildExportPayload(rows, 'assignment', classSlug), null, 2);

    setOverlayPhaseDownloading(1, 1, `Downloading ${rows.length} assignment rows...`);
    downloadBlob(`${baseName}.csv`, csvText, 'text/csv;charset=utf-8');
    downloadBlob(`${baseName}.json`, jsonText, 'application/json;charset=utf-8');

    setOverlay(
      `Done.\nExported ${rows.length} rows for this assignment.`,
      1,
      1,
      assignmentName
    );
    hideOverlaySoon();

    return rows;
  }


//--------------- SECTION 16 - EXPORT: FULL CLASS PERIOD ---------------
  // Class Context Resolution
  // Class Assignment Discovery
  // Per Assignment Roster Collection
  // Class Period Deduplication Pass
  // Class Period Detail Enrichment
  // Class Period File Naming
  // Class Period Export Download

  async function exportThisClassPeriod() {
    const context = assertRequiredContext(getPageContext(), 'class');
    const classSlug = context.class_slug;

    setOverlayPhaseLoadingRoster(0, 1, 'Loading class assignments...');
    const assignmentPageData = await fetchTeacherAssignmentsPage(classSlug);
    const assignments = safeArray(assignmentPageData?.classBySlug?.assignments);

    if (!assignments.length) {
      throw new Error('No assignments found for this class.');
    }

    const allRows = [];
    let assignmentIndex = 0;

    for (const assignment of assignments) {
      assignmentIndex += 1;

      const assignmentId = safeTrimmedString(assignment?.id);
      const assignmentName =
        safeTrimmedString(assignment?.problem?.name) ||
        sanitizeFilenamePart(assignmentId) ||
        `assignment_${assignmentIndex}`;

      setOverlayPhaseLoadingRoster(
        assignmentIndex - 1,
        assignments.length,
        `Assignment ${assignmentIndex} / ${assignments.length}\n${assignmentName}`
      );

      if (!assignmentId) {
        warn('Skipping assignment with missing id during class period export.', assignment);
        continue;
      }

      try {
        const payload = await fetchAssignmentSubmissionsAll(assignmentId);
        const rows = extractBaseRowsFromAssignment(payload);
        allRows.push(...rows);
      } catch (error) {
        warn('Failed to load assignment during class period export.', {
          assignmentId,
          assignmentName,
          error: error?.message || String(error),
        });
      }
    }

    const dedupedRows = dedupeClassPeriodRows(allRows);

    setOverlayPhaseBuildingExport(
      0,
      Math.max(1, getRowsRequiringDetail(dedupedRows).length),
      `Class Period: ${classSlug}\nPreparing detail enrichment...`
    );

    await enrichRowsWithDetails(dedupedRows, classSlug, `Class Period: ${classSlug}`);

    const baseName = buildClassPeriodExportBaseName(classSlug);
    const csvText = rowsToCsv(dedupedRows);
    const jsonText = JSON.stringify(buildExportPayload(dedupedRows, 'class_period', classSlug), null, 2);

    setOverlayPhaseDownloading(1, 1, `Downloading ${dedupedRows.length} class-period rows...`);
    downloadBlob(`${baseName}.csv`, csvText, 'text/csv;charset=utf-8');
    downloadBlob(`${baseName}.json`, jsonText, 'application/json;charset=utf-8');

    setOverlay(
      `Done.\nExported ${dedupedRows.length} rows for this class period.`,
      1,
      1,
      classSlug
    );
    hideOverlaySoon();

    return dedupedRows;
  }

  function closePanel() {
    const panel = document.getElementById(CONFIG.panelId);
    if (panel) panel.remove();
  }



//--------------- SECTION 17 - UI PANEL (BUTTON + DROPDOWN OPTIONS) ---------------
  // Panel Open Close Handling
  // Export Action Buttons
  // Outside Click Close Logic

  function getCurrentAssignmentLabel() {
    const context = getPageContext();
    if (!context.assignment_id) return 'Current assignment';

    const pathBits = safeString(location.pathname).split('/').filter(Boolean);
    const rawSlug = pathBits[pathBits.length - 2] || pathBits[pathBits.length - 1] || context.assignment_id;
    const decoded = safeTrimmedString(decodeURIComponent(rawSlug));
    return decoded || context.assignment_id;
  }

  function buildPanelButton(text, handler, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.disabled = disabled;
    button.style.cssText = [
      'display:block',
      'width:100%',
      'padding:10px 12px',
      'margin:0',
      'border:0',
      'border-radius:8px',
      disabled ? 'background:#e5e7eb' : 'background:#eff6ff',
      disabled ? 'color:#6b7280' : 'color:#1d4ed8',
      'font-weight:600',
      'font-size:13px',
      'text-align:left',
      'cursor:pointer',
    ].join(';');

    button.addEventListener('click', async () => {
      closePanel();
      try {
        await handler();
      } catch (error) {
        console.error(error);
        hideOverlay();
        alert(`Export failed:\n${error?.message || String(error)}`);
      }
    });

    return button;
  }

  function togglePanel() {
    const existing = document.getElementById(CONFIG.panelId);
    if (existing) {
      closePanel();
      return;
    }

    const launcher = document.getElementById(CONFIG.buttonId);
    if (!launcher) return;

    const context = getPageContext();
    const rect = launcher.getBoundingClientRect();

    const panel = document.createElement('div');
    panel.id = CONFIG.panelId;
    panel.style.cssText = [
      'position:fixed',
      `right:${Math.max(16, window.innerWidth - rect.right)}px`,
      `bottom:${window.innerHeight - rect.top + 10}px`,
      'background:#ffffff',
      'border:1px solid rgba(15,23,42,.12)',
      'border-radius:12px',
      'box-shadow:0 10px 30px rgba(0,0,0,.18)',
      'padding:10px',
      'z-index:2147483646',
      'width:280px',
      'font-family:Arial,sans-serif',
      'pointer-events:auto',
    ].join(';');

    const contextBox = document.createElement('div');
    contextBox.style.cssText = [
      'font-size:12px',
      'line-height:1.45',
      'color:#334155',
      'background:#f8fafc',
      'border:1px solid #e2e8f0',
      'border-radius:8px',
      'padding:8px 10px',
      'margin-bottom:10px',
    ].join(';');
    contextBox.innerHTML = [
      `<div><strong>Class:</strong> ${escCsv(context.class_slug || 'Unknown').replace(/^"|"$/g, '')}</div>`,
      `<div><strong>Assignment:</strong> ${escCsv(getCurrentAssignmentLabel()).replace(/^"|"$/g, '')}</div>`,
      `<div><strong>Page:</strong> ${safeString(context.page_type || 'unknown')}</div>`,
    ].join('');
    panel.appendChild(contextBox);

    panel.appendChild(
      buildPanelButton(
        CONFIG.modeLabels.assignment,
        () => exportThisAssignment(),
        !context.can_export_assignment
      )
    );

    const spacer = document.createElement('div');
    spacer.style.height = '8px';
    panel.appendChild(spacer);

    panel.appendChild(
      buildPanelButton(
        CONFIG.modeLabels.classPeriod,
        () => exportThisClassPeriod(),
        !context.can_export_class_period
      )
    );

    getMountRoot().appendChild(panel);

    const onDocumentClick = (event) => {
      if (!panel.contains(event.target) && event.target !== launcher) {
        closePanel();
        document.removeEventListener('click', onDocumentClick, true);
      }
    };

    setTimeout(() => document.addEventListener('click', onDocumentClick, true), 0);
  }


//--------------- SECTION 18 - LAUNCH BUTTON (FLOATING UI) ---------------
  // Launcher Construction
  // Launcher Click Handling
  // Ui Mount Scheduling

  function buildLauncher() {
    const root = getMountRoot();

    let button = document.getElementById(CONFIG.buttonId);
    if (button && root.contains(button)) return button;
    if (button && button.parentNode) button.remove();

    button = document.createElement('button');
    button.id = CONFIG.buttonId;
    button.type = 'button';
    button.textContent = 'Export Submissions';
    button.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483645',
      'background:#2563eb',
      'color:#fff',
      'border:0',
      'border-radius:999px',
      'padding:12px 16px',
      'font-family:Arial,sans-serif',
      'font-size:14px',
      'font-weight:700',
      'box-shadow:0 10px 24px rgba(37,99,235,.35)',
      'cursor:pointer',
      'pointer-events:auto',
    ].join(';');

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    });

    root.appendChild(button);
    return button;
  }

  let ensureTimer = null;

  function ensureUiMounted() {
    if (!document.body) return;
    getMountRoot();
    buildOverlay();
    buildLauncher();
  }

  function scheduleEnsureUiMounted() {
    if (ensureTimer) return;
    ensureTimer = setTimeout(() => {
      ensureTimer = null;
      ensureUiMounted();
    }, 50);
  }


//--------------- SECTION 19 - DOM OBSERVER (PREVENT BUTTON DISAPPEARING) ---------------
  // Mutation Observer Setup
  // Ui Recovery Trigger

  let observerStarted = false;

  function startMutationWatcher() {
    if (observerStarted) return;
    observerStarted = true;

    const observer = new MutationObserver(() => {
      const root = document.querySelector(`[${CONFIG.mountAttr}="1"]`);
      const button = document.getElementById(CONFIG.buttonId);

      if (!root || !button || !document.body.contains(root) || !root.contains(button)) {
        scheduleEnsureUiMounted();
      }
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }


//--------------- SECTION 20 - ROUTE CHANGE DETECTION (SPA NAVIGATION FIX) ---------------
  // Url Change Detection
  // Route Refresh Handling
  // Ui Remount Trigger

  let routeWatchStarted = false;
  let lastHref = location.href;

  function handlePotentialRouteChange() {
    const currentHref = location.href;
    if (currentHref === lastHref) return;

    lastHref = currentHref;
    closePanel();
    scheduleEnsureUiMounted();
  }

  function startRouteWatcher() {
    if (routeWatchStarted) return;
    routeWatchStarted = true;

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(handlePotentialRouteChange, 0);
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(handlePotentialRouteChange, 0);
      return result;
    };

    window.addEventListener('popstate', () => {
      setTimeout(handlePotentialRouteChange, 0);
    });

    setInterval(handlePotentialRouteChange, 750);
  }


//--------------- SECTION 21 - INITIALIZATION ---------------
  // Initial Ui Mount
  // Observer Startup
  // Route Watch Startup

  function init() {
    try {
      ensureUiMounted();
      startMutationWatcher();
      startRouteWatcher();
      log('Class Companion extractor initialized.', {
        version: CONFIG.version,
        pageContext: getPageContext(),
      });
    } catch (error) {
      console.error('[CC Extractor] Initialization failed:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();


