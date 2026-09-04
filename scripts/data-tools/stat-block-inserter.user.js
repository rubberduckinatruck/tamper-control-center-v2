// ==UserScript==
// @name         Dynamic Stat Block Inserter
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Inserts stats from clipboard into page for analysis notes
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/stat-block-inserter.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/stat-block-inserter.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "stat_block_inserter";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function insertBlock(stats) {
        const div = document.createElement("div");
        div.innerText = "📌 Stats: " + stats;
        div.style.cssText = "background:#e3e3e3;padding:6px;border:1px solid #ccc;margin:10px;";
        document.body.insertBefore(div, document.body.firstChild);
    }

    window.addEventListener("keydown", async (e) => {
        if (e.altKey && e.key === "s") {
            const text = await navigator.clipboard.readText();
            insertBlock(text);
        }
    });

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
