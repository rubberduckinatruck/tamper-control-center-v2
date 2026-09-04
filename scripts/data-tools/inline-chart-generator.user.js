// ==UserScript==
// @name         Inline Chart Generator
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Turns table numbers into inline bar/line/pie charts using Chart.js
// @match        *://*/*
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @updateURL    https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/inline-chart-generator.user.js
// @downloadURL  https://github.com/rubberduckinatruck/tamper-control-center/raw/refs/heads/main/scripts/data-tools/inline-chart-generator.user.js
// @grant        none
// ==/UserScript==

(function() {
    const HAT_ID = "inline_chart_generator";

    function updateStatus(state) {
        const payload = { value: state, updated: new Date().toISOString() };
        localStorage.setItem("status_" + HAT_ID, JSON.stringify(payload));
    }

    function createChart(data) {
        const canvas = document.createElement("canvas");
        canvas.style.marginTop = "10px";
        document.body.appendChild(canvas);
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.map((_, i) => `Item ${i + 1}`),
                datasets: [{ label: "Data", data }]
            },
            options: { responsive: true, height: 150 }
        });
    }

    const numbers = Array.from(document.body.innerText.matchAll(/\b\d+(\.\d+)?\b/g)).map(n => parseFloat(n[0])).slice(0, 10);
    if (numbers.length >= 2) createChart(numbers);

    updateStatus("enabled");
    window.addEventListener("beforeunload", () => updateStatus("disabled"));
})();
