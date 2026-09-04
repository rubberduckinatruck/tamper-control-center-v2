// ==UserScript==
// @name         Unit Price Auto-Calculator
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Calculates cost per oz/lb/item on product pages
// @match        *://*.target.com/*
// @match        *://*.costco.com/*
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/price-trackers/unit-price-calculator.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/price-trackers/unit-price-calculator.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "unit_price_calculator";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function injectUnitPrice(price, quantity, unit) {
        const info = document.createElement("div");
        info.textContent = `💲 ${unit} Price: $${(price / quantity).toFixed(2)} per ${unit}`;
        info.style.cssText = "font-weight: bold; color: darkgreen; margin-top: 6px;";
        const target = document.querySelector('#price') || document.body;
        target.appendChild(info);
    }

    const text = document.body.innerText;
    const matchPrice = text.match(/\$([\d\.]+)/);
    const matchQuantity = text.match(/(\d+(\.\d+)?)\s*(oz|lb|count|ct)/i);

    if (matchPrice && matchQuantity) {
        const price = parseFloat(matchPrice[1]);
        const quantity = parseFloat(matchQuantity[1]);
        const unit = matchQuantity[3];
        if (!isNaN(price) && !isNaN(quantity)) {
            injectUnitPrice(price, quantity, unit);
        }
    }

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
