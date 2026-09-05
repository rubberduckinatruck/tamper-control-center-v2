// ==UserScript==
// @name             Google Classroom Overlay Test
// @namespace        classroom-overlay-test
// @version          0.1
// @description      Displays a simple test overlay on Google Classroom student work pages.
// @author           Big Poppa
//
// @cc-id            google-classroom-overlay-test
// @cc-display-name  Google Classroom Overlay Test
// @cc-category      google-classroom
// @cc-role          teaching
// @cc-status        beta
// @cc-tags          google classroom, student work, overlay, testing
// @cc-note          Experimental test overlay intended for development and verification.
//
// @match            https://classroom.google.com/g/*
// @grant            none
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gc/google-classroom-overlay-test.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/gc/google-classroom-overlay-test.user.js
// ==/UserScript==


(function () {
  'use strict';

  // ------------------------ SECTION 1 CONFIGURATION ----------------------

  const OVERLAY_ID = 'gc-originality-overlay-test';

  // ------------------------ SECTION 2 OVERLAY CREATION ----------------------

  function createOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const panel = document.createElement('div');
    panel.id = OVERLAY_ID;

    panel.textContent = 'Originality Extractor Overlay Loaded';

    panel.style.position = 'fixed';
    panel.style.bottom = '20px';
    panel.style.left = '20px';
    panel.style.zIndex = '2147483647';
    panel.style.background = '#111';
    panel.style.color = '#fff';
    panel.style.padding = '12px 16px';
    panel.style.borderRadius = '10px';
    panel.style.fontFamily = 'Arial, sans-serif';
    panel.style.fontSize = '14px';
    panel.style.fontWeight = 'bold';
    panel.style.boxShadow = '0 4px 14px rgba(0,0,0,0.35)';
    panel.style.pointerEvents = 'auto';

    document.body.appendChild(panel);
  }

  // ------------------------ SECTION 3 INITIALIZATION ----------------------

  function boot() {
    createOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();