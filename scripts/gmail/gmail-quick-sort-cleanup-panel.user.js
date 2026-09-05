// ==UserScript==
// @name             Gmail Quick-Sort Cleanup Panel
// @namespace        http://tampermonkey.net/
// @version          1.0
// @description      Injects quick-sorting buttons into Gmail using native search parameters.
// @author           Big Poppa
//
// @cc-id            gmail-quick-sort-cleanup-panel
// @cc-display-name  Gmail Quick-Sort Cleanup Panel
// @cc-category      gmail
// @cc-role          personal
// @cc-status        live
// @cc-tags          gmail, email, inbox, sorting, cleanup
//
// @match            https://mail.google.com/*
// @grant            none
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gmail/gmail-quick-sort-cleanup-panel.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gmail/gmail-quick-sort-cleanup-panel.user.js
// ==/UserScript==


(function() {
    'use strict';

    // Function to inject the custom button panel
    function injectCleanupPanel() {
        // Prevent duplicate panels from loading
        if (document.getElementById('gmail-cleanup-panel')) return;

        // Target the search bar area or top bar wrapper to place our buttons
        const targetArea = document.querySelector('header') || document.querySelector('.gb_re');
        if (!targetArea) return;

        const panel = document.createElement('div');
        panel.id = 'gmail-cleanup-panel';
        panel.style.cssText = 'position: absolute; top: 12px; left: 65%; z-index: 9999; display: flex; gap: 8px; font-family: Roboto, Arial, sans-serif;';

        // Define your custom sorting views
        const buttons = [
            { text: '🎯 True Inbox', search: 'label:unread -(in:sent) -(is:social) -(is:promotions) -(is:updates) -(is:forums)' },
            { text: '📬 Old Read Mail', search: 'is:read in:inbox' },
            { text: '🗑️ Mass Unsubscribe', search: 'label:unread unsubscribe' }
        ];

        buttons.forEach(btnData => {
            const btn = document.createElement('button');
            btn.innerText = btnData.text;
            btn.style.cssText = 'background-color: #f1f3f4; border: 1px solid #dadce0; border-radius: 4px; padding: 6px 12px; font-size: 13px; font-weight: 500; color: #3c4043; cursor: pointer; transition: background 0.2s;';

            btn.addEventListener('mouseover', () => btn.style.backgroundColor = '#e8eaed');
            btn.addEventListener('mouseout', () => btn.style.backgroundColor = '#f1f3f4');

            btn.addEventListener('click', () => {
                // Change the URL hash to trigger Gmail's native search routing instantly
                window.location.hash = `#search/${encodeURIComponent(btnData.search)}`;
            });

            panel.appendChild(btn);
        });

        targetArea.appendChild(panel);
    }

    // Gmail loads elements dynamically, so we need a brief interval check to ensure it injects safely
    const checkExist = setInterval(() => {
        if (document.querySelector('header')) {
            injectCleanupPanel();
            clearInterval(checkExist);
        }
    }, 1000);
})();