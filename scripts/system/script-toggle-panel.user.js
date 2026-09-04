// ==UserScript==
// @name         Script Toggle Panel
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Floating panel to toggle script activation per role.
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/script-toggle-panel.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/script-toggle-panel.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "script_toggle_panel";
    const roles = ["teaching", "union", "system", "research", "price"];

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function createTogglePanel() {
        const panel = document.createElement("div");
        panel.style.cssText = "position:fixed;bottom:10px;right:10px;background:#fff;border:1px solid #999;padding:0.5rem;z-index:9999;font-size:12px;";
        panel.innerHTML = "<strong>Toggle Roles:</strong><br>";
        roles.forEach(role => {
            const btn = document.createElement("button");
            btn.textContent = role;
            btn.onclick = () => {
                const current = localStorage.getItem("status_" + role);
                const next = current?.includes("enabled") ? "disabled" : "enabled";
                localStorage.setItem("status_" + role, JSON.stringify({ value: next, updated: new Date().toISOString() }));
                btn.textContent = role + " (" + next + ")";
            };
            panel.appendChild(btn);
        });
        document.body.appendChild(panel);
    }

    createTogglePanel();
    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
