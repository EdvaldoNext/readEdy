/* ═══════════════════════════════════════════════════════════════
   ReadEdy · reader/render
   Renderização das páginas, ajuste de largura, salto de página e navegação.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* Largura útil do PDF: em paisagem virtual usa o lado longo do ecrã (não clientWidth pré-giro) */
function isMobileViewport() {
    var w = window.visualViewport ? window.visualViewport.width
        : (typeof window.innerWidth === 'number' ? window.innerWidth : 0);
    return w > 0 && w <= 768;
}

function isMobileFullBleedPdf() {
    if (!isMobileViewport() || !document.body.classList.contains('pdf-is-open')) return false;
    return document.body.classList.contains('reading-mode')
        || document.body.classList.contains('ui-chrome-hidden');
}

function schedulePdfRelayout() {
    if (!pdfDoc || typeof renderPage !== 'function') return;
    setTimeout(function() {
        if (!isRendering) renderPage(pageNum, isReading);
    }, 50);
    setTimeout(function() {
        if (!isRendering) renderPage(pageNum, isReading);
    }, 280);
}

function getPdfFitMaxWidth(viewer) {
    var appEl = document.getElementById('app-container');
    if (appEl && appEl.classList.contains('forced-landscape')) {
        var iw = typeof window.innerWidth === 'number' ? window.innerWidth : 0;
        var ih = typeof window.innerHeight === 'number' ? window.innerHeight : 0;
        if (window.visualViewport) {
            iw = window.visualViewport.width || iw;
            ih = window.visualViewport.height || ih;
        }
        var longEdge = Math.max(iw, ih);
        return Math.max(280, longEdge - 8);
    }
    /* Mobile imersivo: largura total da viewport (zoom aplicado via CSS transform). */
    if (isMobileFullBleedPdf()) {
        var vv = window.visualViewport;
        var fullW = vv ? vv.width : (typeof window.innerWidth === 'number' ? window.innerWidth : 0);
        return Math.max(280, Math.floor(fullW));
    }
    var rect = viewer.getBoundingClientRect();
    var innerW = typeof window.innerWidth === 'number' ? window.innerWidth : rect.width;
    var useW = viewer.clientWidth > 80 ? viewer.clientWidth : Math.max(Math.floor(rect.width), Math.floor(innerW * 0.96));
    return Math.max(280, Math.min(useW, innerW) - 32);
}

function renderPage(num, skipStopTts) {
    if (!pdfjsLib || !pdfDoc) return Promise.resolve();
    if (isReading && !skipStopTts) stopTTS();
    var myRender = ++renderGen;
    isRendering = true;
    /* Watchdog para TVs/dispositivos lentos: se o render travar por mais de 12 s,
       força o reset e executa qualquer salto pendente para não deixar o app preso. */
    if (_renderingWatchdog) clearTimeout(_renderingWatchdog);
    _renderingWatchdog = setTimeout(function() {
        _renderingWatchdog = null;
        if (!isRendering) return;
        isRendering = false;
        var jump = _pendingPageJump;
        _pendingPageJump = null;
        if (jump !== null) setTimeout(function() { goToPage(jump); }, 50);
    }, 12000);
    ttsPageCache = { pageNum: null, text: '', ranges: [] };
    if (ttsAudioCache.pageNum !== num) {
        ttsAudioCache = { pageNum: null, url: null, ready: false, error: false, key: null };
    }
    ['btn-tts', 'btn-tts-float'].forEach(function(id) {
        var b = document.getElementById(id);
        if (b) b.disabled = true;
    });
    clearPdfHighlight();
    ttsCharRanges = [];
    pdfTextLayerSpans = null;

    return pdfDoc.getPage(num).then(function(page) {
        if (myRender !== renderGen) return Promise.resolve();
        var viewer = document.getElementById('viewer-container');
        var maxW = getPdfFitMaxWidth(viewer);
        var vp1 = page.getViewport({ scale: 1 });
        var fit = maxW / vp1.width;
        var sharpen = window.devicePixelRatio > 1 ? 1.22 : 1;
        var scale = fit * sharpen;
        var viewport = page.getViewport({ scale: scale });
        if (viewport.width > maxW + 0.5) {
            scale = fit;
            viewport = page.getViewport({ scale: scale });
        }

        var renderArea = document.getElementById('pdf-render-area');
        renderArea.innerHTML = '';
        ttsPdfHighlightLast = { start: -1, end: -1 };
        /* Zoom visual centrado: só no mobile imersivo */
        if (isMobileFullBleedPdf() && pdfZoom !== 1.0) {
            renderArea.style.transform = 'scale(' + pdfZoom + ')';
            renderArea.style.transformOrigin = 'top center';
        } else {
            renderArea.style.transform = '';
            renderArea.style.transformOrigin = '';
        }

        var wrap = document.createElement('div');
        wrap.className = 'pdf-page-wrap';
        var inner = document.createElement('div');
        inner.className = 'pdf-page-inner';
        inner.style.position = 'relative';
        inner.style.width = viewport.width + 'px';
        inner.style.height = viewport.height + 'px';

        var canvas = document.createElement('canvas');
        var context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        var textLayer = document.createElement('div');
        textLayer.className = 'text-layer';
        textLayer.setAttribute('aria-hidden', 'true');
        textLayer.style.width = viewport.width + 'px';
        textLayer.style.height = viewport.height + 'px';

        inner.appendChild(canvas);
        inner.appendChild(textLayer);
        wrap.appendChild(inner);
        renderArea.appendChild(wrap);

        var k = Math.min(1, maxW / viewport.width);
        wrap.style.width = (viewport.width * k) + 'px';
        wrap.style.height = (viewport.height * k) + 'px';
        inner.style.transform = 'scale(' + k + ')';
        inner.style.transformOrigin = 'top left';

        return page.render({ canvasContext: context, viewport: viewport }).promise.then(function() {
            if (myRender !== renderGen) return Promise.resolve();
            return page.getTextContent();
        }).then(function(textContent) {
            if (myRender !== renderGen) return Promise.resolve();
            pdfTextLayerSpans = buildPdfTextLayer(viewport, textContent, textLayer);
            var ttsBuilt = buildTtsTextAndRanges(textContent.items || []);
            ttsPageCache = { pageNum: num, text: ttsBuilt.text, ranges: ttsBuilt.ranges };
            /* O início do render zera ttsCharRanges; na leitura contínua o áudio da página nova já
               começou antes do render terminar — restaurar as faixas para a tarja continuar. */
            if (pageNum === num && (isReading || document.body.classList.contains('tts-paused'))) {
                ttsCharRanges = ttsBuilt.ranges || [];
                if (!fullPageText) fullPageText = ttsBuilt.text || '';
                ttsLastFullTextLen = fullPageText.length;
                ttsPdfHighlightLast = { start: -1, end: -1 };
            }
            updateTtsSeekButtonsVisible();

            document.getElementById('page-info').textContent = num + ' / ' + pdfDoc.numPages;
            /* A Home partilha o scroller: só reposicionar no leitor */
            if (!homeView) document.getElementById('viewer-container').scrollTop = 0;
            scheduleCloudProgress();
            updateTtsButtonLabel();
            syncPageJumpInput(true);
            refreshHomeHero();

            if (ttsBuilt.text && ttsBuilt.text.trim()) {
                preFetchTtsAudio(num, ttsBuilt.text);
            }
            var contPrefetch = document.getElementById('continuous-read');
            if (contPrefetch && contPrefetch.checked && num < pdfDoc.numPages) {
                prefetchNextPageForContinuous(num);
            }
        });
    }).catch(function(err) {
        if (myRender === renderGen) {
            showNotification('Erro ao renderizar página: ' + (err && err.message || String(err)));
        }
    }).then(function() {
        if (myRender !== renderGen) return;
        if (_renderingWatchdog) { clearTimeout(_renderingWatchdog); _renderingWatchdog = null; }
        isRendering = false;
        ['btn-tts', 'btn-tts-float'].forEach(function(id) {
            var b = document.getElementById(id);
            if (b) b.disabled = false;
        });
        updateLayoutToggleVisible();
        if (window._refreshReaderScrollNav) {
            setTimeout(window._refreshReaderScrollNav, 50);
        }
        /* Executa salto de página enfileirado (ex.: clique em "Ir" durante renderização na TV). */
        var jump = _pendingPageJump;
        _pendingPageJump = null;
        if (jump !== null) setTimeout(function() { goToPage(jump); }, 50);
    });
}

function capturePageJumpDraft(el) {
    if (!el) return;
    var v = String(el.value || '').replace(/\D/g, '');
    if (v !== el.value) el.value = v;
    _pageJumpDraft = v;
}

function readPageJumpValue(el) {
    if (!el) return '';
    capturePageJumpDraft(el);
    return String(_pageJumpDraft || el.value || '').trim();
}

function syncPageJumpInput(force) {
    const el = document.getElementById('page-jump-input');
    if (!el || !pdfDoc) return;
    /* Não apagar o que o utilizador está a digitar (teclado virtual da TV). */
    if (!force && (_pageJumpInputFocused || _pageJumpDraft !== '')) return;
    _pageJumpDraft = '';
    el.value = String(pageNum);
}

function goToPage(target) {
    if (!pdfDoc) return;
    const n = Math.floor(Number(target));
    if (!Number.isFinite(n)) {
        showTtsToast('Digite um número de página válido.');
        return;
    }
    if (n < 1 || n > pdfDoc.numPages) {
        showTtsToast('Fora do intervalo: 1 a ' + pdfDoc.numPages + ' páginas.');
        return;
    }
    /* Se a renderização ainda está em curso (TVs lentas), enfileira o salto
       em vez de descartar silenciosamente — o salto será executado ao final do render atual. */
    if (isRendering) {
        _pendingPageJump = n;
        showTtsToast('Aguardando renderização…');
        return;
    }
    if (n === pageNum) return;
    _pendingPageJump = null;
    _pageJumpDraft = '';
    resetTtsBookmark();
    pageNum = n;
    currentPageNum = pageNum;
    renderPage(pageNum);
}

function goToPageFromInput() {
    const el = document.getElementById('page-jump-input');
    if (!el || !pdfDoc) return;
    const raw = readPageJumpValue(el);
    if (raw === '') {
        syncPageJumpInput(true);
        return;
    }
    _pageJumpDraft = '';
    goToPage(parseInt(raw, 10));
}

function activatePageJumpFromInput() {
    var el = document.getElementById('page-jump-input');
    if (el && document.activeElement === el) el.blur();
    /* TVs demoram a gravar o valor no DOM após fechar o teclado virtual. */
    setTimeout(goToPageFromInput, 80);
}

function changePage(delta) {
    if (!pdfDoc || isRendering) return;
    const next = pageNum + delta;
    if (next > 0 && next <= pdfDoc.numPages) {
        resetTtsBookmark();
        pageNum = next;
        currentPageNum = pageNum;
        renderPage(pageNum);
    }
}
