// ==UserScript==
// @name         Interactive Data Summary
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Summarizes table stats like averages and percentages
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/interactive-summary.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/interactive-summary.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "interactive_summary";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    const tables = document.querySelectorAll("table");
    tables.forEach((table, idx) => {
        const numbers = Array.from(table.innerText.matchAll(/\b\d+(\.\d+)?\b/g)).map(n => parseFloat(n[0]));
        if (numbers.length < 2) return;
        const sum = numbers.reduce((a, b) => a + b, 0);
        const avg = (sum / numbers.length).toFixed(2);
        const summary = document.createElement("div");
        summary.innerHTML = `📊 Summary: Count = ${numbers.length}, Avg = ${avg}, Sum = ${sum}`;
        summary.style.cssText = "font-style: italic; font-size: 0.9em; color: #555;";
        table.parentNode.insertBefore(summary, table);
    });

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
