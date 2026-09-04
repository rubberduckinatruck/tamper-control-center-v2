// ==UserScript==
// @name         Multi-Table Exporter
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Export all tables on a page into one downloadable spreadsheet
// @match        *://*/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/multi-table-exporter.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/multi-table-exporter.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "multi_table_exporter";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function exportTables() {
        const tables = document.querySelectorAll("table");
        const wb = XLSX.utils.book_new();
        tables.forEach((table, idx) => {
            const ws = XLSX.utils.table_to_sheet(table);
            XLSX.utils.book_append_sheet(wb, ws, "Table" + (idx + 1));
        });
        XLSX.writeFile(wb, "page_tables.xlsx");
    }

    const btn = document.createElement("button");
    btn.textContent = "📤 Export All Tables";
    btn.style.cssText = "position:fixed;top:10px;left:10px;z-index:9999;background:#444;color:#fff;padding:6px;border:none;border-radius:4px;";
    btn.onclick = exportTables;
    document.body.appendChild(btn);

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
