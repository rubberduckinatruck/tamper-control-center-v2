// ==UserScript==
// @name         Price Watcher
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Tracks price on Amazon/Walmart/etc. and stores history locally
// @match        *://*.amazon.com/*
// @match        *://*.walmart.com/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/price-trackers/price-watcher.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/price-trackers/price-watcher.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "price_watcher";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function extractPrice() {
        const selectors = ['#priceblock_ourprice', '#priceblock_dealprice', '.price-characteristic'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const text = el.textContent.replace(/[^\d.]/g, '');
                const price = parseFloat(text);
                return isNaN(price) ? null : price;
            }
        }
        return null;
    }

    const price = extractPrice();
    const url = location.href.split("?")[0];
    const historyKey = "price_history_" + url;
    const history = JSON.parse(localStorage.getItem(historyKey) || "[]");

    if (price) {
        history.push({ time: new Date().toISOString(), price });
        localStorage.setItem(historyKey, JSON.stringify(history));
        console.log(`[Price Watcher] Logged $${price} for ${url}`);
    }

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
