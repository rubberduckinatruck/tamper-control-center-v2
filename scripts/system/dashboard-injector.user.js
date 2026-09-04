// ==UserScript==
// @name         Dashboard Injector
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Injects quick-access buttons into known dashboard pages (e.g., BoardDocs, YouTube, Synergy).
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/dashboard-injector.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/system/dashboard-injector.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "dashboard_injector";
    const TARGETS = [
        { keyword: "boarddocs", label: "Control Center", url: "https://rubberduckinatruck.github.io/tamper-control-center/" },
        { keyword: "youtube.com", label: "Board Meeting Notes", url: "https://rubberduckinatruck.github.io/tamper-control-center/scripts.html" }
    ];

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function injectButton(label, link) {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.style.cssText = "position:fixed;top:20px;right:20px;z-index:9999;padding:6px 10px;background:#8B0000;color:#fff;border:none;border-radius:4px;";
        btn.onclick = () => window.open(link, "_blank");
        document.body.appendChild(btn);
    }

    const matched = TARGETS.find(t => window.location.href.includes(t.keyword));
    if (matched) injectButton(matched.label, matched.url);

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
