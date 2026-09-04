// ==UserScript==
// @name         "Why I Saved This" Autofill
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Prompts you to write a note when saving pages for later reference
// @match        *://*/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/why-saved-autofill.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/why-saved-autofill.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "why_saved_autofill";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    if (!localStorage.getItem("note_" + location.href)) {
        const reason = prompt("📝 Why are you saving this page?");
        if (reason) {
            localStorage.setItem("note_" + location.href, reason);
            alert("Saved your note.");
        }
    }

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
