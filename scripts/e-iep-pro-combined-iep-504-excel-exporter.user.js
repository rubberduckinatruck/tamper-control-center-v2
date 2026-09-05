// ==UserScript==
// @name             e-IEP PRO - Combined IEP + 504 Excel Exporter
// @namespace        https://docs.e-iepdata.com/
// @version          5.0.0
// @description      Extracts IEP accommodations/modifications and 504 accommodations into one organized Excel workbook.
// @author           Big Poppa
//
// @cc-id            e-iep-pro-combined-iep-504-exporter
// @cc-display-name  e-IEP PRO IEP + 504 Excel Exporter
// @cc-category      special-education
// @cc-role          teaching
// @cc-status        live
// @cc-tags          iep, 504 plans, accommodations, modifications, excel, export
// @cc-note          Requires authorized access to the e-IEP PRO general education portal.
//
// @match            https://docs.e-iepdata.com/GENEDPORTALV18/*
// @grant            GM_xmlhttpRequest
// @grant            GM_notification
// @connect          www.e-ieppro10.com
// @connect          e-ieppro10.com
// @require          https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at           document-idle
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/e-iep-pro-combined-iep-504-excel-exporter.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/e-iep-pro-combined-iep-504-excel-exporter.user.js
// ==/UserScript==



(function () {
    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================

    const CONFIG = {
        IEP_MARKER: '/IEP-V7/GenEd_InfoSheetReport.asp',
        PLAN504_MARKER: '/504/504Portal_AccPlanRpt.asp',

        REQUEST_DELAY_MS: 450,

        PANEL_ID: 'gt-iep-504-excel-panel',

        OUTPUT_FILENAME: 'Student_IEP_504_Accommodations.xlsx'
    };

    let documents = [];
    let processing = false;
    let stopRequested = false;

    // ============================================================
    // UTILITIES
    // ============================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\u00A0/g, ' ')
            .replace(/\r/g, ' ')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function determinePlanType(url) {
        if (url.includes(CONFIG.IEP_MARKER)) {
            return 'IEP';
        }

        if (url.includes(CONFIG.PLAN504_MARKER)) {
            return '504';
        }

        return null;
    }

    function formatDateForExcel(value) {
        const text = normalizeText(value);

        if (!text) {
            return '';
        }

        // yyyy-mm-dd from portal
        let match = text.match(
            /^(\d{4})-(\d{2})-(\d{2})$/
        );

        if (match) {
            return `${match[2]}/${match[3]}/${match[1]}`;
        }

        // m/d/yyyy or mm/dd/yyyy
        match = text.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
        );

        if (match) {
            return `${match[1]}/${match[2]}/${match[3]}`;
        }

        return text;
    }

    // ============================================================
    // PORTAL PAGE SCANNING
    // ============================================================

    function extractPortalStudentInfo(row) {
        const firstCell = row.querySelector('td');

        if (!firstCell) {
            return {
                studentName: 'Unknown Student',
                studentId: ''
            };
        }

        const pieces = firstCell.innerText
            .split('\n')
            .map(normalizeText)
            .filter(Boolean);

        let studentName =
            pieces[0] || 'Unknown Student';

        let studentId =
            pieces[1] || '';

        if (!studentId) {
            const idMatch =
                firstCell.innerText.match(
                    /\b\d{4,10}\b/
                );

            if (idMatch) {
                studentId = idMatch[0];
            }
        }

        return {
            studentName,
            studentId
        };
    }

    function scanDocuments() {
        const found = [];
        const seenUrls = new Set();

        const rows =
            document.querySelectorAll(
                '#dynamic-table tbody tr'
            );

        rows.forEach(row => {
            const student =
                extractPortalStudentInfo(row);

            const links =
                row.querySelectorAll('a[href]');

            links.forEach(link => {
                const url = link.href;

                const planType =
                    determinePlanType(url);

                if (!planType) {
                    return;
                }

                if (seenUrls.has(url)) {
                    return;
                }

                seenUrls.add(url);

                found.push({
                    url,
                    planType,
                    portalDate:
                        normalizeText(
                            link.textContent
                        ),
                    studentName:
                        student.studentName,
                    studentId:
                        student.studentId
                });
            });
        });

        documents = found;

        updatePanel();

        console.clear();

        console.log(
            '==============================================='
        );

        console.log(
            'e-IEP PRO COMBINED IEP + 504 EXCEL EXPORTER'
        );

        console.log(
            '==============================================='
        );

        console.log(
            `Total documents found: ${documents.length}`
        );

        console.log(
            `IEP documents: ${
                documents.filter(
                    d => d.planType === 'IEP'
                ).length
            }`
        );

        console.log(
            `504 documents: ${
                documents.filter(
                    d => d.planType === '504'
                ).length
            }`
        );

        console.log(
            '==============================================='
        );

        documents.forEach(
            (doc, index) => {
                console.log(
                    `[${index + 1}/${documents.length}]`,
                    doc.studentName,
                    doc.studentId,
                    doc.planType,
                    doc.portalDate
                );
            }
        );
    }

    // ============================================================
    // HTTP FETCH
    // ============================================================

    function fetchHtml(url) {
        return new Promise(
            (resolve, reject) => {

                GM_xmlhttpRequest({
                    method: 'GET',
                    url,

                    onload(response) {
                        if (
                            response.status >= 200 &&
                            response.status < 400
                        ) {
                            resolve(
                                response.responseText
                            );
                        } else {
                            reject(
                                new Error(
                                    `HTTP ${response.status}`
                                )
                            );
                        }
                    },

                    onerror(error) {
                        reject(error);
                    },

                    ontimeout() {
                        reject(
                            new Error(
                                'Request timed out'
                            )
                        );
                    }
                });
            }
        );
    }

    // ============================================================
    // GENERIC REPORT FIELD EXTRACTION
    // ============================================================

    function getReportBodyText(reportDoc) {
        if (!reportDoc.body) {
            return '';
        }

        return reportDoc.body.innerText || '';
    }

    function extractStudentName(
        reportDoc,
        fallback
    ) {
        const text =
            getReportBodyText(reportDoc);

        const match = text.match(
            /Student Name:\s*([^\n\r]+)/i
        );

        if (match) {
            let value =
                normalizeText(match[1]);

            value = value
                .replace(
                    /\s+School:.*$/i,
                    ''
                )
                .replace(
                    /\s+IEP Information Sheet.*$/i,
                    ''
                )
                .replace(
                    /\s+504 Student Accommodation Plan.*$/i,
                    ''
                )
                .trim();

            if (value) {
                return value;
            }
        }

        return fallback;
    }

    function extractStudentId(
        reportDoc,
        fallback
    ) {
        const text =
            getReportBodyText(reportDoc);

        const match = text.match(
            /Student ID:\s*(\d+)/i
        );

        if (match) {
            return normalizeText(
                match[1]
            );
        }

        return fallback;
    }

    // ============================================================
    // IEP PLAN DATE
    // ============================================================

    function extractIepPlanDate(
        reportDoc,
        fallback
    ) {
        const text =
            getReportBodyText(reportDoc);

        const match = text.match(
            /IEP Meeting Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
        );

        if (match) {
            return formatDateForExcel(
                match[1]
            );
        }

        return formatDateForExcel(
            fallback
        );
    }

    // ============================================================
    // 504 PLAN DATE
    // ============================================================

    function extract504PlanDate(
        reportDoc,
        fallback
    ) {
        const text =
            getReportBodyText(reportDoc);

        const match = text.match(
            /\bDate:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
        );

        if (match) {
            return formatDateForExcel(
                match[1]
            );
        }

        return formatDateForExcel(
            fallback
        );
    }

    // ============================================================
    // IEP ACCOMMODATION PARSER
    // ============================================================

    function extractIepAccommodations(
        reportDoc
    ) {
        const results = [];

        const tables =
            Array.from(
                reportDoc.querySelectorAll(
                    'table'
                )
            );

        for (const table of tables) {
            const rows =
                Array.from(
                    table.querySelectorAll(
                        ':scope > tbody > tr, :scope > tr'
                    )
                );

            if (!rows.length) {
                continue;
            }

            const firstRow =
                rows[0];

            const headerCells =
                Array.from(
                    firstRow.querySelectorAll(
                        ':scope > td, :scope > th'
                    )
                )
                .map(cell =>
                    normalizeText(
                        cell.textContent
                    )
                );

            const headerText =
                headerCells
                    .join('|')
                    .toLowerCase();

            const isIepAccommodationTable =
                headerText.includes(
                    'accommodations'
                ) &&
                headerText.includes(
                    'type'
                ) &&
                headerText.includes(
                    'location'
                );

            if (!isIepAccommodationTable) {
                continue;
            }

            rows.slice(1).forEach(
                row => {
                    const cells =
                        Array.from(
                            row.querySelectorAll(
                                ':scope > td, :scope > th'
                            )
                        )
                        .map(cell =>
                            normalizeText(
                                cell.textContent
                            )
                        );

                    if (
                        cells.length < 1
                    ) {
                        return;
                    }

                    const description =
                        cells[0] || '';

                    const type =
                        cells[1] || '';

                    const location =
                        cells[2] || '';

                    if (!description) {
                        return;
                    }

                    results.push({
                        entryType:
                            'Accommodation',

                        areaOfNeed: '',

                        text:
                            description,

                        type,

                        location,

                        personResponsible: ''
                    });
                }
            );

            if (results.length) {
                break;
            }
        }

        return results;
    }

    // ============================================================
    // IEP MODIFICATION PARSER
    // ============================================================

    function extractIepModifications(
        reportDoc
    ) {
        const results = [];

        const allTables =
            Array.from(
                reportDoc.querySelectorAll(
                    'table'
                )
            );

        for (const table of allTables) {
            const rows =
                Array.from(
                    table.querySelectorAll(
                        ':scope > tbody > tr, :scope > tr'
                    )
                );

            if (!rows.length) {
                continue;
            }

            const firstTwoRowsText =
                rows
                    .slice(0, 2)
                    .map(row =>
                        normalizeText(
                            row.textContent
                        )
                    )
                    .join(' ')
                    .toLowerCase();

            const looksLikeModificationTable =
                firstTwoRowsText.includes(
                    'modification'
                ) &&
                (
                    firstTwoRowsText.includes(
                        'type'
                    ) ||
                    firstTwoRowsText.includes(
                        'location'
                    )
                );

            if (
                !looksLikeModificationTable
            ) {
                continue;
            }

            if (
                firstTwoRowsText.includes(
                    'certification of receipt'
                )
            ) {
                continue;
            }

            rows.forEach(
                row => {
                    const cells =
                        Array.from(
                            row.querySelectorAll(
                                ':scope > td, :scope > th'
                            )
                        )
                        .map(cell =>
                            normalizeText(
                                cell.textContent
                            )
                        );

                    if (!cells.length) {
                        return;
                    }

                    const combined =
                        cells
                            .join(' ')
                            .toLowerCase();

                    if (
                        combined.includes(
                            'modifications'
                        ) &&
                        cells.length === 1
                    ) {
                        return;
                    }

                    if (
                        combined.includes(
                            'legend for type'
                        )
                    ) {
                        return;
                    }

                    if (
                        combined.includes(
                            'means the provisions'
                        )
                    ) {
                        return;
                    }

                    if (
                        combined.includes(
                            'certification of receipt'
                        )
                    ) {
                        return;
                    }

                    const description =
                        cells[0] || '';

                    const type =
                        cells[1] || '';

                    const location =
                        cells[2] || '';

                    if (
                        !description ||
                        description.length < 8
                    ) {
                        return;
                    }

                    results.push({
                        entryType:
                            'Modification',

                        areaOfNeed: '',

                        text:
                            description,

                        type,

                        location,

                        personResponsible: ''
                    });
                }
            );

            if (results.length) {
                break;
            }
        }

        return results;
    }

    // ============================================================
    // 504 ACCOMMODATION PARSER
    // ============================================================

    function extract504Accommodations(
        reportDoc
    ) {
        const results = [];

        const tables =
            Array.from(
                reportDoc.querySelectorAll(
                    'table'
                )
            );

        for (const table of tables) {
            const directRows =
                Array.from(
                    table.querySelectorAll(
                        ':scope > tbody > tr, :scope > tr'
                    )
                );

            if (
                directRows.length < 3
            ) {
                continue;
            }

            const firstTwoRowsText =
                directRows
                    .slice(0, 2)
                    .map(row =>
                        normalizeText(
                            row.textContent
                        )
                    )
                    .join(' ')
                    .toLowerCase();

            const is504AccommodationTable =
                firstTwoRowsText.includes(
                    'classroom accommodations'
                ) &&
                firstTwoRowsText.includes(
                    'area(s) of need'
                ) &&
                firstTwoRowsText.includes(
                    'accommodation(s)'
                ) &&
                firstTwoRowsText.includes(
                    'person responsible'
                );

            if (
                !is504AccommodationTable
            ) {
                continue;
            }

            directRows
                .slice(2)
                .forEach(row => {

                    const cells =
                        Array.from(
                            row.querySelectorAll(
                                ':scope > td, :scope > th'
                            )
                        )
                        .map(cell =>
                            normalizeText(
                                cell.textContent
                            )
                        );

                    if (
                        cells.length < 2
                    ) {
                        return;
                    }

                    const areaOfNeed =
                        cells[0] || '';

                    const accommodation =
                        cells[1] || '';

                    const personResponsible =
                        cells[2] || '';

                    if (!accommodation) {
                        return;
                    }

                    results.push({
                        entryType:
                            'Accommodation',

                        areaOfNeed,

                        text:
                            accommodation,

                        type: '',

                        location: '',

                        personResponsible
                    });
                });

            if (results.length) {
                break;
            }
        }

        return results;
    }

    // ============================================================
    // PARSE ONE REPORT
    // ============================================================

    function parseReport(
        html,
        portalDocument
    ) {
        const parser =
            new DOMParser();

        const reportDoc =
            parser.parseFromString(
                html,
                'text/html'
            );

        const studentName =
            extractStudentName(
                reportDoc,
                portalDocument.studentName
            );

        const studentId =
            extractStudentId(
                reportDoc,
                portalDocument.studentId
            );

        let planDate = '';

        let entries = [];

        if (
            portalDocument.planType ===
            'IEP'
        ) {
            planDate =
                extractIepPlanDate(
                    reportDoc,
                    portalDocument.portalDate
                );

            entries.push(
                ...extractIepAccommodations(
                    reportDoc
                )
            );

            entries.push(
                ...extractIepModifications(
                    reportDoc
                )
            );
        }

        if (
            portalDocument.planType ===
            '504'
        ) {
            planDate =
                extract504PlanDate(
                    reportDoc,
                    portalDocument.portalDate
                );

            entries.push(
                ...extract504Accommodations(
                    reportDoc
                )
            );
        }

        return {
            studentName,
            studentId,
            planType:
                portalDocument.planType,
            planDate,
            sourceUrl:
                portalDocument.url,
            entries
        };
    }

    // ============================================================
    // REPORT -> FLAT EXCEL ROWS
    // ============================================================

    function reportToRows(report) {
        return report.entries.map(
            entry => ({
                'Student Name':
                    report.studentName,

                'Student ID':
                    report.studentId,

                'Plan Type':
                    report.planType,

                'Plan Date':
                    report.planDate,

                'Entry Type':
                    entry.entryType,

                'Area of Need':
                    entry.areaOfNeed || '',

                'Accommodation / Modification':
                    entry.text || '',

                'Type':
                    entry.type || '',

                'Location':
                    entry.location || '',

                'Person Responsible':
                    entry.personResponsible || ''
            })
        );
    }

    // ============================================================
    // WORKBOOK CREATION
    // ============================================================

    function createWorkbook(
        rows,
        reportLog
    ) {
        const workbook =
            XLSX.utils.book_new();

        // ========================================================
        // SHEET 1 - ALL ACCOMMODATIONS
        // ========================================================

        const mainHeaders = [
            'Student Name',
            'Student ID',
            'Plan Type',
            'Plan Date',
            'Entry Type',
            'Area of Need',
            'Accommodation / Modification',
            'Type',
            'Location',
            'Person Responsible'
        ];

        const mainSheet =
            XLSX.utils.json_to_sheet(
                rows,
                {
                    header:
                        mainHeaders
                }
            );

        mainSheet['!cols'] = [
            { wch: 28 },
            { wch: 12 },
            { wch: 10 },
            { wch: 14 },
            { wch: 16 },
            { wch: 28 },
            { wch: 90 },
            { wch: 10 },
            { wch: 18 },
            { wch: 35 }
        ];

        if (rows.length) {
            mainSheet['!autofilter'] = {
                ref:
                    `A1:J${rows.length + 1}`
            };
        }

        XLSX.utils.book_append_sheet(
            workbook,
            mainSheet,
            'Accommodations'
        );

        // ========================================================
        // SHEET 2 - STUDENT SUMMARY
        // ========================================================

        const summaryMap =
            new Map();

        rows.forEach(row => {
            const key =
                `${row['Student ID']}|` +
                `${row['Plan Type']}|` +
                `${row['Plan Date']}`;

            if (
                !summaryMap.has(key)
            ) {
                summaryMap.set(
                    key,
                    {
                        'Student Name':
                            row[
                                'Student Name'
                            ],

                        'Student ID':
                            row[
                                'Student ID'
                            ],

                        'Plan Type':
                            row[
                                'Plan Type'
                            ],

                        'Plan Date':
                            row[
                                'Plan Date'
                            ],

                        'Accommodations':
                            0,

                        'Modifications':
                            0,

                        'Total Entries':
                            0
                    }
                );
            }

            const summary =
                summaryMap.get(key);

            if (
                row['Entry Type'] ===
                'Accommodation'
            ) {
                summary[
                    'Accommodations'
                ]++;
            }

            if (
                row['Entry Type'] ===
                'Modification'
            ) {
                summary[
                    'Modifications'
                ]++;
            }

            summary[
                'Total Entries'
            ]++;
        });

        const summaryRows =
            Array.from(
                summaryMap.values()
            );

        summaryRows.sort(
            (a, b) =>
                a['Student Name']
                    .localeCompare(
                        b['Student Name']
                    )
        );

        const summarySheet =
            XLSX.utils.json_to_sheet(
                summaryRows
            );

        summarySheet['!cols'] = [
            { wch: 28 },
            { wch: 12 },
            { wch: 10 },
            { wch: 14 },
            { wch: 16 },
            { wch: 16 },
            { wch: 14 }
        ];

        XLSX.utils.book_append_sheet(
            workbook,
            summarySheet,
            'Student Summary'
        );

        // ========================================================
        // SHEET 3 - EXTRACTION LOG
        // ========================================================

        const logSheet =
            XLSX.utils.json_to_sheet(
                reportLog
            );

        logSheet['!cols'] = [
            { wch: 28 },
            { wch: 12 },
            { wch: 10 },
            { wch: 14 },
            { wch: 16 },
            { wch: 16 },
            { wch: 16 },
            { wch: 20 }
        ];

        XLSX.utils.book_append_sheet(
            workbook,
            logSheet,
            'Extraction Log'
        );

        // ========================================================
        // SAVE
        // ========================================================

        XLSX.writeFile(
            workbook,
            CONFIG.OUTPUT_FILENAME
        );
    }

    // ============================================================
    // FULL EXPORT PROCESS
    // ============================================================

    async function exportAllToExcel() {
        if (processing) {
            alert(
                'An extraction is already running.'
            );

            return;
        }

        if (!documents.length) {
            alert(
                'No IEP or 504 documents were found.'
            );

            return;
        }

        processing = true;
        stopRequested = false;

        disableButtons(true);

        const allRows = [];
        const reportLog = [];

        let successfulReports = 0;
        let emptyReports = 0;
        let failedReports = 0;

        setProgress(0);

        console.log(
            '==============================================='
        );

        console.log(
            'STARTING FULL EXTRACTION'
        );

        console.log(
            '==============================================='
        );

        for (
            let i = 0;
            i < documents.length;
            i++
        ) {
            if (stopRequested) {
                break;
            }

            const portalDocument =
                documents[i];

            const current =
                i + 1;

            const percent =
                Math.round(
                    (
                        i /
                        documents.length
                    ) *
                    100
                );

            setProgress(percent);

            setStatus(
                `Processing ${current} of ` +
                `${documents.length}: ` +
                `${portalDocument.studentName} ` +
                `(${portalDocument.planType})`
            );

            console.log(
                `[${current}/${documents.length}] ` +
                `${portalDocument.studentName} ` +
                `${portalDocument.studentId} ` +
                `[${portalDocument.planType}]`
            );

            try {
                const html =
                    await fetchHtml(
                        portalDocument.url
                    );

                const report =
                    parseReport(
                        html,
                        portalDocument
                    );

                const rows =
                    reportToRows(
                        report
                    );

                const accommodationCount =
                    rows.filter(
                        row =>
                            row[
                                'Entry Type'
                            ] ===
                            'Accommodation'
                    ).length;

                const modificationCount =
                    rows.filter(
                        row =>
                            row[
                                'Entry Type'
                            ] ===
                            'Modification'
                    ).length;

                if (rows.length) {
                    allRows.push(
                        ...rows
                    );

                    successfulReports++;

                    console.log(
                        `[OK] ${report.studentName}: ` +
                        `${accommodationCount} accommodation(s), ` +
                        `${modificationCount} modification(s)`
                    );

                    reportLog.push({
                        'Student Name':
                            report.studentName,

                        'Student ID':
                            report.studentId,

                        'Plan Type':
                            report.planType,

                        'Plan Date':
                            report.planDate,

                        'Accommodations':
                            accommodationCount,

                        'Modifications':
                            modificationCount,

                        'Status':
                            'Success',

                        'Notes':
                            ''
                    });
                } else {
                    emptyReports++;

                    console.warn(
                        `[NO ENTRIES] ` +
                        `${report.studentName} ` +
                        `(${report.planType})`
                    );

                    reportLog.push({
                        'Student Name':
                            report.studentName,

                        'Student ID':
                            report.studentId,

                        'Plan Type':
                            report.planType,

                        'Plan Date':
                            report.planDate,

                        'Accommodations':
                            0,

                        'Modifications':
                            0,

                        'Status':
                            'No Entries Found',

                        'Notes':
                            'Report loaded, but no classroom accommodations or modifications were extracted.'
                    });
                }
            } catch (error) {
                failedReports++;

                console.error(
                    `[FAILED] ` +
                    `${portalDocument.studentName}`,
                    error
                );

                reportLog.push({
                    'Student Name':
                        portalDocument.studentName,

                    'Student ID':
                        portalDocument.studentId,

                    'Plan Type':
                        portalDocument.planType,

                    'Plan Date':
                        formatDateForExcel(
                            portalDocument.portalDate
                        ),

                    'Accommodations':
                        0,

                    'Modifications':
                        0,

                    'Status':
                        'Failed',

                    'Notes':
                        String(
                            error.message ||
                            error
                        )
                });
            }

            if (
                i <
                    documents.length - 1 &&
                !stopRequested
            ) {
                await sleep(
                    CONFIG.REQUEST_DELAY_MS
                );
            }
        }

        // ========================================================
        // SORT OUTPUT
        // ========================================================

        allRows.sort(
            (a, b) => {
                const studentCompare =
                    a['Student Name']
                        .localeCompare(
                            b['Student Name']
                        );

                if (
                    studentCompare !== 0
                ) {
                    return studentCompare;
                }

                const idCompare =
                    String(
                        a['Student ID']
                    ).localeCompare(
                        String(
                            b['Student ID']
                        )
                    );

                if (
                    idCompare !== 0
                ) {
                    return idCompare;
                }

                const planCompare =
                    a['Plan Type']
                        .localeCompare(
                            b['Plan Type']
                        );

                if (
                    planCompare !== 0
                ) {
                    return planCompare;
                }

                const entryCompare =
                    a['Entry Type']
                        .localeCompare(
                            b['Entry Type']
                        );

                if (
                    entryCompare !== 0
                ) {
                    return entryCompare;
                }

                return (
                    a[
                        'Accommodation / Modification'
                    ] || ''
                ).localeCompare(
                    b[
                        'Accommodation / Modification'
                    ] || ''
                );
            }
        );

        // ========================================================
        // EXPORT
        // ========================================================

        if (
            allRows.length ||
            reportLog.length
        ) {
            createWorkbook(
                allRows,
                reportLog
            );
        }

        processing = false;

        disableButtons(false);

        setProgress(100);

        setStatus(
            `Complete: ${allRows.length} rows | ` +
            `${successfulReports} success | ` +
            `${emptyReports} empty | ` +
            `${failedReports} failed`
        );

        GM_notification({
            title:
                'IEP + 504 Excel Export Complete',

            text:
                `${allRows.length} total rows exported.`,

            timeout:
                6000
        });

        console.log(
            '==============================================='
        );

        console.log(
            'EXTRACTION COMPLETE'
        );

        console.log(
            `Rows exported: ${allRows.length}`
        );

        console.log(
            `Successful reports: ${successfulReports}`
        );

        console.log(
            `No-entry reports: ${emptyReports}`
        );

        console.log(
            `Failed reports: ${failedReports}`
        );

        console.log(
            '==============================================='
        );
    }

    // ============================================================
    // USER INTERFACE
    // ============================================================

    function createPanel() {
        if (
            document.getElementById(
                CONFIG.PANEL_ID
            )
        ) {
            return;
        }

        const panel =
            document.createElement(
                'div'
            );

        panel.id =
            CONFIG.PANEL_ID;

        panel.innerHTML = `
            <div class="gt-title">
                IEP + 504 Excel Export
            </div>

            <div
                id="gt-counts"
                class="gt-counts"
            >
                Scanning...
            </div>

            <button
                id="gt-export-all"
                class="gt-button gt-primary"
            >
                Export All IEP + 504 to Excel
            </button>

            <button
                id="gt-export-iep"
                class="gt-button"
            >
                Export IEP Only
            </button>

            <button
                id="gt-export-504"
                class="gt-button"
            >
                Export 504 Only
            </button>

            <button
                id="gt-rescan"
                class="gt-button"
            >
                Rescan Page
            </button>

            <button
                id="gt-stop"
                class="gt-button gt-stop"
            >
                Stop
            </button>

            <div
                class="gt-progress-wrap"
            >
                <div
                    id="gt-progress-bar"
                ></div>
            </div>

            <div
                id="gt-status"
                class="gt-status"
            >
                Ready.
            </div>
        `;

        document.body.appendChild(
            panel
        );

        addStyles();

        document
            .getElementById(
                'gt-export-all'
            )
            .addEventListener(
                'click',
                () => {
                    exportAllToExcel();
                }
            );

        document
            .getElementById(
                'gt-export-iep'
            )
            .addEventListener(
                'click',
                () => {
                    exportSubsetToExcel(
                        'IEP'
                    );
                }
            );

        document
            .getElementById(
                'gt-export-504'
            )
            .addEventListener(
                'click',
                () => {
                    exportSubsetToExcel(
                        '504'
                    );
                }
            );

        document
            .getElementById(
                'gt-rescan'
            )
            .addEventListener(
                'click',
                () => {
                    scanDocuments();

                    setStatus(
                        'Page rescanned.'
                    );
                }
            );

        document
            .getElementById(
                'gt-stop'
            )
            .addEventListener(
                'click',
                () => {
                    stopRequested = true;

                    setStatus(
                        'Stopping after current report...'
                    );
                }
            );
    }

    // ============================================================
    // SUBSET EXPORT
    // ============================================================

    async function exportSubsetToExcel(
        planType
    ) {
        const originalDocuments =
            documents;

        const subset =
            documents.filter(
                doc =>
                    doc.planType ===
                    planType
            );

        if (!subset.length) {
            alert(
                `No ${planType} documents were found.`
            );

            return;
        }

        documents = subset;

        try {
            await exportAllToExcel();
        } finally {
            documents =
                originalDocuments;

            updatePanel();
        }
    }

    // ============================================================
    // PANEL STYLING
    // ============================================================

    function addStyles() {
        const style =
            document.createElement(
                'style'
            );

        style.textContent = `
            #${CONFIG.PANEL_ID} {
                position: fixed;
                right: 20px;
                bottom: 20px;

                width: 320px;

                padding: 14px;

                background: #ffffff;
                color: #000000;

                border: 2px solid #333333;
                border-radius: 8px;

                box-shadow:
                    0 4px 16px
                    rgba(0,0,0,.25);

                font-family:
                    Arial,
                    Helvetica,
                    sans-serif;

                font-size: 13px;

                z-index: 999999;
            }

            #${CONFIG.PANEL_ID}
            .gt-title {
                font-size: 17px;
                font-weight: bold;
                margin-bottom: 9px;
            }

            #${CONFIG.PANEL_ID}
            .gt-counts {
                padding: 8px;

                margin-bottom: 9px;

                border:
                    1px solid
                    #cccccc;

                background:
                    #ffffff;

                line-height: 1.5;
            }

            #${CONFIG.PANEL_ID}
            .gt-button {
                display: block;

                width: 100%;

                margin: 5px 0;

                padding: 8px;

                cursor: pointer;

                border:
                    1px solid
                    #888888;

                border-radius:
                    4px;

                background:
                    #f4f4f4;

                color:
                    #000000;
            }

            #${CONFIG.PANEL_ID}
            .gt-button:hover {
                background:
                    #e8e8e8;
            }

            #${CONFIG.PANEL_ID}
            .gt-button:disabled {
                opacity: .5;

                cursor:
                    not-allowed;
            }

            #${CONFIG.PANEL_ID}
            .gt-primary {
                font-weight:
                    bold;

                background:
                    #dddddd;
            }

            #${CONFIG.PANEL_ID}
            .gt-stop {
                margin-top:
                    9px;
            }

            #${CONFIG.PANEL_ID}
            .gt-progress-wrap {
                width:
                    100%;

                height:
                    14px;

                margin-top:
                    10px;

                background:
                    #eeeeee;

                border:
                    1px solid
                    #999999;
            }

            #gt-progress-bar {
                width:
                    0%;

                height:
                    100%;

                background:
                    #333333;

                transition:
                    width .2s ease;
            }

            #${CONFIG.PANEL_ID}
            .gt-status {
                margin-top:
                    7px;

                font-size:
                    11px;

                line-height:
                    1.4;
            }
        `;

        document.head.appendChild(
            style
        );
    }

    // ============================================================
    // PANEL COUNTS
    // ============================================================

    function updatePanel() {
        const counts =
            document.getElementById(
                'gt-counts'
            );

        if (!counts) {
            return;
        }

        const iepCount =
            documents.filter(
                doc =>
                    doc.planType ===
                    'IEP'
            ).length;

        const plan504Count =
            documents.filter(
                doc =>
                    doc.planType ===
                    '504'
            ).length;

        counts.innerHTML = `
            Documents:
            <strong>
                ${documents.length}
            </strong>
            <br>

            IEP:
            <strong>
                ${iepCount}
            </strong>
            <br>

            504:
            <strong>
                ${plan504Count}
            </strong>
        `;
    }

    // ============================================================
    // STATUS / PROGRESS
    // ============================================================

    function setStatus(message) {
        const element =
            document.getElementById(
                'gt-status'
            );

        if (element) {
            element.textContent =
                message;
        }
    }

    function setProgress(percent) {
        const bar =
            document.getElementById(
                'gt-progress-bar'
            );

        if (bar) {
            bar.style.width =
                Math.max(
                    0,
                    Math.min(
                        100,
                        percent
                    )
                ) + '%';
        }
    }

    function disableButtons(
        disabled
    ) {
        [
            'gt-export-all',
            'gt-export-iep',
            'gt-export-504',
            'gt-rescan'
        ].forEach(id => {
            const button =
                document.getElementById(
                    id
                );

            if (button) {
                button.disabled =
                    disabled;
            }
        });
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function initialize() {
        const table =
            document.querySelector(
                '#dynamic-table'
            );

        if (!table) {
            console.warn(
                '[IEP + 504 Excel Exporter] ' +
                'Student table not found.'
            );

            return;
        }

        createPanel();

        scanDocuments();

        setStatus(
            `${documents.length} documents found.`
        );
    }

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }

})();