// ==UserScript==
// @name         Update Checker
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Displays a timestamp when this script was last updated
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/update-checker.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/update-checker.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "update_checker";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    console.log("[Update Checker] Last updated:", new Date().toISOString());

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
