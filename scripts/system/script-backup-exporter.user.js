// ==UserScript==
// @name         Script Backup Exporter
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Exports localStorage-based script status as a JSON download
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/script-backup-exporter.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/script-backup-exporter.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "script_backup_exporter";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function exportStorage() {
        const backup = {};
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith("status_")) {
                backup[k] = localStorage.getItem(k);
            }
        });
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "tampermonkey_status_backup.json";
        a.click();
    }

    const btn = document.createElement("button");
    btn.textContent = "📦 Export Script Status";
    btn.style.cssText = "position:fixed;bottom:10px;left:10px;padding:6px;background:#444;color:#fff;z-index:9999;border:none;border-radius:4px;";
    btn.onclick = exportStorage;
    document.body.appendChild(btn);

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
