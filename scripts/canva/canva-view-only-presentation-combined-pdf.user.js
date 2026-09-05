// ==UserScript==
// @name             Canva View-Only Presentation to Combined PDF
// @namespace        local.canva.offline
// @version          1.0.2
// @description      Captures every page displayed in a Canva view-only design and combines the pages into one PDF.
// @author           Big Poppa
//
// @cc-id            canva-view-only-presentation-combined-pdf
// @cc-display-name  Canva View-Only Presentation to PDF
// @cc-category      canva
// @cc-role          personal
// @cc-status        live
// @cc-tags          canva, presentations, pdf, capture, export
// @cc-note          Requires access to the complete view-only Canva presentation.
//
// @match            https://www.canva.com/design/*/view*
// @match            https://www.canva.com/design/*/watch*
// @grant            none
// @run-at           document-idle
// @require          https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @require          https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
//
// @updateURL        https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/canva/canva-view-only-presentation-combined-pdf.user.js
// @downloadURL      https://raw.githubusercontent.com/rubberduckinatruck/tamper-control-center-v2/main/scripts/canva/canva-view-only-presentation-combined-pdf.user.js
// ==/UserScript==



(() => {
  'use strict';

  const CONFIG = {
    captureScale: 2,
    pageSettleMs: 900,
    imageTimeoutMs: 20000,
    navigationTimeoutMs: 20000,
    jpegQuality: 0.94,
    initializeRetryMs: 1000,
  };

  const sleep = (milliseconds) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });

  function resolveHtml2Canvas() {
    if (typeof html2canvas === 'function') {
      return html2canvas;
    }

    if (typeof window.html2canvas === 'function') {
      return window.html2canvas;
    }

    if (typeof globalThis.html2canvas === 'function') {
      return globalThis.html2canvas;
    }

    throw new Error(
      'html2canvas did not load. Confirm that the @require lines are present, save the script, and reload Canva.'
    );
  }

  function resolveJsPdf() {
    if (
      typeof jspdf !== 'undefined' &&
      jspdf &&
      typeof jspdf.jsPDF === 'function'
    ) {
      return jspdf.jsPDF;
    }

    if (
      window.jspdf &&
      typeof window.jspdf.jsPDF === 'function'
    ) {
      return window.jspdf.jsPDF;
    }

    if (
      globalThis.jspdf &&
      typeof globalThis.jspdf.jsPDF === 'function'
    ) {
      return globalThis.jspdf.jsPDF;
    }

    if (typeof window.jsPDF === 'function') {
      return window.jsPDF;
    }

    if (typeof globalThis.jsPDF === 'function') {
      return globalThis.jsPDF;
    }

    throw new Error(
      'jsPDF did not load. Confirm that the @require URL uses jsPDF version 2.5.1, save the script, and reload Canva.'
    );
  }

  function verifyDependencies() {
    resolveHtml2Canvas();
    resolveJsPdf();
  }

  function getSlider() {
    return document.querySelector(
      '[aria-label="Design slider"][role="slider"]'
    );
  }

  function getPageState() {
    const slider = getSlider();

    if (slider) {
      const current = Number(
        slider.getAttribute('aria-valuenow')
      );

      const total = Number(
        slider.getAttribute('aria-valuemax')
      );

      if (
        Number.isInteger(current) &&
        Number.isInteger(total) &&
        current >= 1 &&
        total >= current
      ) {
        return { current, total };
      }

      const valueText =
        slider.getAttribute('aria-valuetext') || '';

      const sliderMatch = valueText.match(
        /Page\s+(\d+)\s+of\s+(\d+)/i
      );

      if (sliderMatch) {
        return {
          current: Number(sliderMatch[1]),
          total: Number(sliderMatch[2]),
        };
      }
    }

    const liveRegions = [
      ...document.querySelectorAll('[aria-live]'),
    ];

    for (const region of liveRegions) {
      const text = region.textContent || '';

      const match = text.match(
        /Page\s+(\d+)\s+of\s+(\d+)/i
      );

      if (match) {
        return {
          current: Number(match[1]),
          total: Number(match[2]),
        };
      }
    }

    const pageButton = document.querySelector(
      'button[aria-label="Go to page"]'
    );

    if (pageButton) {
      const text = pageButton.textContent || '';

      const match = text.match(
        /(\d+)\s*\/\s*(\d+)/
      );

      if (match) {
        return {
          current: Number(match[1]),
          total: Number(match[2]),
        };
      }
    }

    throw new Error(
      'Could not determine the current Canva page or total page count.'
    );
  }

  function getButton(label) {
    return document.querySelector(
      `button[aria-label="${label}"]`
    );
  }

  function isDisabled(button) {
    return (
      !button ||
      button.disabled ||
      button.getAttribute('aria-disabled') === 'true'
    );
  }

  function isVisuallyUsable(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 100 &&
      rect.height > 100 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0
    );
  }

  function findVisiblePage() {
    const preferredCandidates = [
      ...document.querySelectorAll(
        '.fMSICA[aria-hidden="false"] .GDnEHQ'
      ),
    ].filter(isVisuallyUsable);

    if (preferredCandidates.length > 0) {
      return preferredCandidates
        .sort((first, second) => {
          const firstRect =
            first.getBoundingClientRect();

          const secondRect =
            second.getBoundingClientRect();

          return (
            secondRect.width * secondRect.height -
            firstRect.width * firstRect.height
          );
        })[0];
    }

    const renderedCandidates = [
      ...document.querySelectorAll('.GDnEHQ'),
    ].filter((element) => {
      if (!isVisuallyUsable(element)) {
        return false;
      }

      const hiddenAncestor = element.closest(
        '[aria-hidden="true"]'
      );

      return !hiddenAncestor;
    });

    if (renderedCandidates.length > 0) {
      return renderedCandidates
        .sort((first, second) => {
          const firstRect =
            first.getBoundingClientRect();

          const secondRect =
            second.getBoundingClientRect();

          return (
            secondRect.width * secondRect.height -
            firstRect.width * firstRect.height
          );
        })[0];
    }

    const pageContent = document.querySelector(
      '[aria-label="Page content"]'
    );

    if (pageContent) {
      const renderedPage =
        pageContent.closest('.GDnEHQ') ||
        pageContent.parentElement?.closest('.GDnEHQ') ||
        pageContent.parentElement?.querySelector('.GDnEHQ');

      if (
        renderedPage &&
        isVisuallyUsable(renderedPage)
      ) {
        return renderedPage;
      }
    }

    throw new Error(
      'Could not locate the currently visible Canva page.'
    );
  }

  async function waitForImages(root) {
    const images = [
      ...root.querySelectorAll('img'),
    ];

    const imagePromises = images.map(
      (image) =>
        new Promise((resolve) => {
          if (
            image.complete &&
            image.naturalWidth > 0
          ) {
            resolve();
            return;
          }

          const finish = () => {
            image.removeEventListener(
              'load',
              finish
            );

            image.removeEventListener(
              'error',
              finish
            );

            resolve();
          };

          image.addEventListener(
            'load',
            finish,
            { once: true }
          );

          image.addEventListener(
            'error',
            finish,
            { once: true }
          );
        })
    );

    await Promise.race([
      Promise.all(imagePromises),
      sleep(CONFIG.imageTimeoutMs),
    ]);

    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        sleep(7000),
      ]);
    }

    await sleep(CONFIG.pageSettleMs);
  }

  async function waitForPage(targetPage) {
    const startedAt = Date.now();

    while (
      Date.now() - startedAt <
      CONFIG.navigationTimeoutMs
    ) {
      let state = null;

      try {
        state = getPageState();
      } catch {
        await sleep(150);
        continue;
      }

      if (state.current === targetPage) {
        try {
          const page = findVisiblePage();

          await waitForImages(page);

          const confirmedState =
            getPageState();

          if (
            confirmedState.current ===
            targetPage
          ) {
            return;
          }
        } catch {
          // Canva may still be replacing the page DOM.
        }
      }

      await sleep(150);
    }

    throw new Error(
      `Timed out waiting for Canva page ${targetPage}.`
    );
  }

  async function goToFirstPage() {
    let { current } = getPageState();

    while (current > 1) {
      const previousButton =
        getButton('Previous page');

      if (isDisabled(previousButton)) {
        throw new Error(
          `The Previous page button became unavailable on page ${current}.`
        );
      }

      previousButton.click();

      await waitForPage(current - 1);

      current = getPageState().current;
    }
  }

  async function navigateToPage(targetPage) {
    let { current } = getPageState();

    while (current > targetPage) {
      const previousButton =
        getButton('Previous page');

      if (isDisabled(previousButton)) {
        break;
      }

      previousButton.click();

      await waitForPage(current - 1);

      current = getPageState().current;
    }

    while (current < targetPage) {
      const nextButton =
        getButton('Next page');

      if (isDisabled(nextButton)) {
        break;
      }

      nextButton.click();

      await waitForPage(current + 1);

      current = getPageState().current;
    }
  }

  function createPanel() {
    const panel = document.createElement('div');

    panel.id = 'canva-pdf-capture-panel';

    Object.assign(panel.style, {
      position: 'fixed',
      right: '18px',
      top: '72px',
      zIndex: '2147483647',
      width: '290px',
      padding: '14px',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '12px',
      background: 'rgba(20,20,24,0.97)',
      color: '#ffffff',
      font: '14px/1.4 Arial, sans-serif',
      boxShadow:
        '0 8px 30px rgba(0,0,0,0.4)',
    });

    const title = document.createElement('div');

    title.textContent = 'Canva PDF Capture';

    Object.assign(title.style, {
      marginBottom: '8px',
      fontSize: '15px',
      fontWeight: '700',
    });

    const status = document.createElement('div');

    status.textContent = 'Ready.';

    Object.assign(status.style, {
      minHeight: '40px',
      marginBottom: '8px',
      overflowWrap: 'anywhere',
    });

    const progress =
      document.createElement('progress');

    progress.max = 1;
    progress.value = 0;

    Object.assign(progress.style, {
      display: 'block',
      width: '100%',
      marginBottom: '10px',
    });

    const button =
      document.createElement('button');

    button.type = 'button';
    button.textContent =
      'Download combined PDF';

    Object.assign(button.style, {
      width: '100%',
      padding: '10px 12px',
      border: '0',
      borderRadius: '8px',
      background: '#ffffff',
      color: '#111111',
      cursor: 'pointer',
      fontWeight: '700',
    });

    const note = document.createElement('div');

    note.textContent =
      'Keep this Canva tab visible until the PDF download begins.';

    Object.assign(note.style, {
      marginTop: '9px',
      fontSize: '12px',
      opacity: '0.75',
    });

    panel.append(
      title,
      status,
      progress,
      button,
      note
    );

    document.body.appendChild(panel);

    return {
      panel,
      status,
      progress,
      button,
    };
  }

  function createSafeFilename() {
    const rawTitle =
      document.title ||
      'Canva presentation';

    const cleanedTitle = rawTitle
      .replace(/\s*[-|]\s*Canva\s*$/i, '')
      .replace(
        /[<>:"/\\|?*\u0000-\u001F]/g,
        '_'
      )
      .replace(/\s+/g, ' ')
      .trim();

    return `${
      cleanedTitle || 'Canva presentation'
    }.pdf`;
  }

  function setButtonDisabled(
    button,
    disabled
  ) {
    button.disabled = disabled;
    button.style.cursor = disabled
      ? 'not-allowed'
      : 'pointer';
    button.style.opacity = disabled
      ? '0.65'
      : '1';
  }

  async function capturePageToCanvas(
    pageElement
  ) {
    const html2Canvas =
      resolveHtml2Canvas();

    const rect =
      pageElement.getBoundingClientRect();

    if (
      rect.width < 100 ||
      rect.height < 100
    ) {
      throw new Error(
        'The visible Canva page has an invalid capture size.'
      );
    }

    return html2Canvas(pageElement, {
      backgroundColor: '#ffffff',
      scale: CONFIG.captureScale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout:
        CONFIG.imageTimeoutMs,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      windowWidth:
        document.documentElement.clientWidth,
      windowHeight:
        document.documentElement.clientHeight,
      scrollX: 0,
      scrollY: 0,
      removeContainer: true,
    });
  }

  async function captureAllPages(ui) {
    setButtonDisabled(ui.button, true);

    ui.button.textContent = 'Working...';

    let originalPage = 1;

    try {
      verifyDependencies();

      originalPage =
        getPageState().current;

      ui.status.textContent =
        'Moving to page 1...';

      await goToFirstPage();

      const { total } =
        getPageState();

      ui.progress.max = total;
      ui.progress.value = 0;

      const JsPdf = resolveJsPdf();

      let pdf = null;
      let pdfPageWidth = 0;
      let pdfPageHeight = 0;
      let orientation = 'portrait';

      for (
        let pageNumber = 1;
        pageNumber <= total;
        pageNumber += 1
      ) {
        ui.status.textContent =
          `Capturing page ${pageNumber} of ${total}...`;

        await waitForPage(pageNumber);

        const pageElement =
          findVisiblePage();

        await waitForImages(pageElement);

        const canvas =
          await capturePageToCanvas(
            pageElement
          );

        if (
          canvas.width === 0 ||
          canvas.height === 0
        ) {
          throw new Error(
            `Page ${pageNumber} produced an empty capture.`
          );
        }

        const imageData =
          canvas.toDataURL(
            'image/jpeg',
            CONFIG.jpegQuality
          );

        const aspectRatio =
          canvas.height / canvas.width;

        if (!pdf) {
          /*
           * 612 points is the standard PDF width
           * for US Letter portrait. Height is
           * calculated from the actual Canva page
           * ratio so no stretching occurs.
           */
          pdfPageWidth = 612;
          pdfPageHeight =
            pdfPageWidth * aspectRatio;

          orientation =
            pdfPageWidth >
            pdfPageHeight
              ? 'landscape'
              : 'portrait';

          pdf = new JsPdf({
            orientation,
            unit: 'pt',
            format: [
              pdfPageWidth,
              pdfPageHeight,
            ],
            compress: true,
            putOnlyUsedFonts: true,
          });
        } else {
          pdf.addPage(
            [
              pdfPageWidth,
              pdfPageHeight,
            ],
            orientation
          );
        }

        pdf.addImage(
          imageData,
          'JPEG',
          0,
          0,
          pdfPageWidth,
          pdfPageHeight,
          undefined,
          'FAST'
        );

        ui.progress.value = pageNumber;

        /*
         * Release the large temporary canvas
         * before processing the next page.
         */
        canvas.width = 1;
        canvas.height = 1;

        if (pageNumber < total) {
          const nextButton =
            getButton('Next page');

          if (isDisabled(nextButton)) {
            throw new Error(
              `The Next page button became unavailable after page ${pageNumber}.`
            );
          }

          nextButton.click();

          await waitForPage(
            pageNumber + 1
          );
        }
      }

      if (!pdf) {
        throw new Error(
          'No Canva pages were captured.'
        );
      }

      ui.status.textContent =
        'Building and downloading PDF...';

      pdf.save(createSafeFilename());

      ui.status.textContent =
        `Finished. ${total} pages were saved.`;

      ui.button.textContent =
        'Download again';
    } catch (error) {
      console.error(
        '[Canva PDF Capture]',
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      ui.status.textContent =
        `Stopped: ${message}`;

      ui.button.textContent =
        'Try again';

      window.alert(
        `Canva PDF Capture stopped:\n\n${message}\n\nOpen DevTools Console for additional details.`
      );
    } finally {
      setButtonDisabled(
        ui.button,
        false
      );

      try {
        const currentPage =
          getPageState().current;

        if (
          currentPage !== originalPage
        ) {
          ui.status.textContent +=
            ' Restoring your original page...';

          await navigateToPage(
            originalPage
          );
        }
      } catch (restoreError) {
        console.warn(
          '[Canva PDF Capture] Could not restore the original page.',
          restoreError
        );
      }
    }
  }

  function initialize() {
    if (
      document.getElementById(
        'canva-pdf-capture-panel'
      )
    ) {
      return;
    }

    try {
      verifyDependencies();
      getPageState();
      findVisiblePage();
    } catch (error) {
      console.debug(
        '[Canva PDF Capture] Waiting for Canva viewer...',
        error
      );

      window.setTimeout(
        initialize,
        CONFIG.initializeRetryMs
      );

      return;
    }

    const ui = createPanel();

    ui.button.addEventListener(
      'click',
      () => {
        captureAllPages(ui);
      }
    );
  }

  initialize();
})();