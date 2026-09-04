// ==UserScript==
// @name         Settings Sync Manager
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Lets you export/import a settings blob for use across devices
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/settings-sync-manager.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/settings-sync-manager.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "settings_sync_manager";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function createSyncUI() {
        const div = document.createElement("div");
        div.style.cssText = "position:fixed;bottom:60px;left:10px;background:#eee;padding:6px;border:1px solid #ccc;z-index:9999;";
        const exportBtn = document.createElement("button");
        exportBtn.textContent = "Export Settings";
        exportBtn.onclick = () => {
            const blob = new Blob([JSON.stringify(localStorage, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "localstorage_export.json";
            a.click();
        };
        const importBtn = document.createElement("button");
        importBtn.textContent = "Import Settings";
        importBtn.onclick = () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.onchange = e => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = function(event) {
                    try {
                        const data = JSON.parse(event.target.result);
                        Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
                        alert("Settings imported.");
                        location.reload();
                    } catch {
                        alert("Invalid JSON file.");
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        };
        div.appendChild(exportBtn);
        div.appendChild(importBtn);
        document.body.appendChild(div);
    }

    createSyncUI();
    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
