/* ═══════════════════════════════════════════════════════════════
   ReadEdy · boot
   Inicialização: liga eventos e executa o que precisa rodar na carga. Carrega por último.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
VERIFICAÇÃO DE BIBLIOTECAS (sem throw — TV pode continuar)
══════════════════════════════════════════════════════════════ */
(function checkCdnLoads() {
    var pdfFailed = window._PDFJS_FAILED || !window['pdfjs-dist/build/pdf'];
    var sbFailed  = window._SUPABASEJS_FAILED;
    if (pdfFailed || sbFailed) {
        document.getElementById('cdn-error-banner').style.display = 'block';
    }
    if (pdfFailed) {
        ['home-btn-open-pdf', 'home-btn-open-pdf-account'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.disabled = true;
        });
        console.error('[ReadEra] PDF.js não carregou. Verifique extensões ou rede.');
    }
})();

if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.min.js';
}

try { ttsRepeatPage = safeStorage.getItem(LS_REPEAT_PAGE) === '1'; } catch (e) {}

wireThemeButtons();

applyTheme(safeStorage.getItem('readera-theme') === 'dark');

/* Desbloquear na primeira interação com a página (qualquer clique) */
document.addEventListener('click', function _firstClick() {
    _unlockAudio();
    document.removeEventListener('click', _firstClick);
});

/* TTS não depende do cliente Supabase — só de config.example.js / config.js */
initTtsEngine();

document.getElementById('continuous-read').addEventListener('change', schedulePushUserPreferences);

if (ttsEngineSelect) {
    ttsEngineSelect.addEventListener('change', function() {
        var val = ttsEngineSelect.value;
        if (val !== 'proxy' && val !== 'webspeech') val = DEFAULT_TTS_ENGINE;
        safeStorage.setItem(LS_TTS_ENGINE, val);
        if (isReading) stopTTS({ resetBookmark: false });
        var resolved = applyTtsEngineFromPreference();
        if (val === 'proxy' && resolved !== 'proxy') {
            showNotification('Backend indisponível — a usar Navegador.', true);
        } else if (val === 'webspeech' && resolved !== 'webspeech') {
            showNotification('Navegador sem voz disponível neste aparelho.', true);
        }
        schedulePushUserPreferences();
    });
}

voiceSelect.addEventListener('change', function() {
    safeStorage.setItem('readera-voice-key', voiceSelect.value);
    invalidateTtsAudioCache();
    schedulePushUserPreferences();
});

_rateBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
        var rate = btn.dataset.rate;
        rateRange.value = rate;
        safeStorage.setItem(_RATE_KEY, rate);
        /* Velocidade é aplicada no player: não precisa invalidar o áudio em cache */
        _applyTtsPlaybackRateAll();
        _applyRateBtn(rate);
    });
});

if (_savedRate && _VALID_RATES.indexOf(_savedRate) !== -1) {
    rateRange.value = _savedRate;
} else {
    rateRange.value = '1.0';
}

_applyRateBtn(rateRange.value);

wireScrollNavControls();

wireSettingsUi();

/* Mantém a tela acesa enquanto o app está visível (Chrome, Brave, Safari 16.4+).
   O navegador solta o cadeado ao ir para segundo plano; o áudio não é pausado. */
var screenWakeLock = null;

function acquireScreenWakeLock() {
    if (!('wakeLock' in navigator) || document.hidden || screenWakeLock) return;
    navigator.wakeLock.request('screen').then(function(lock) {
        screenWakeLock = lock;
        lock.addEventListener('release', function() { screenWakeLock = null; });
    }).catch(function() {});
}

acquireScreenWakeLock();
document.addEventListener('pointerdown', acquireScreenWakeLock);

document.addEventListener('visibilitychange', function() {
    if (document.hidden) return;
    acquireScreenWakeLock();
    flushTtsPendingRender();
    /* Retomar avanço contínuo se o áudio parou em background (mobile). */
    if (pdfDoc && !isReading && !speakLock && !ttsContinuousAdvanceLock && !document.body.classList.contains('tts-paused')) {
        var contEl = document.getElementById('continuous-read');
        if (contEl && contEl.checked && pageNum < pdfDoc.numPages) {
            var pageText = (ttsPageCache.pageNum === pageNum && ttsPageCache.text) ? ttsPageCache.text : '';
            var textLen = pageText.length;
            var playedMost = textLen > 0 && ttsAbsCharEnd >= textLen * 0.85;
            var audioEnded = !ttsAudioEl || ttsAudioEl.ended || !ttsAudioEl.src;
            if (playedMost && audioEnded && ttsShouldAutoAdvancePage(pageNum, { fromEnded: true })) {
                setTimeout(function() { ttsAfterPagePlaybackFinished(pageNum); }, 120);
            }
        }
    }
});

window.addEventListener('pageshow', function() {
    acquireScreenWakeLock();
    flushTtsPendingRender();
});

fileInput.onchange = function(e) {
    if (!requirePaidAccess()) {
        e.target.value = '';
        return;
    }
    var file = e.target.files[0];
    if (!file) return;
    var gen = ++cloudLoadGen;
    persistLastCloudDocId(null);
    cloudDocumentId = null;
    suppressAutoCloud = false;
    lastOpenedFileName = file.name;
    currentBookTitle = file.name;
    teardownCurrentPdf();
    var reader = new FileReader();
    reader.onload = function() {
        loadPdfFromArrayBuffer(this.result, { initialPage: 1 }, gen);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
};

(function wirePageJump() {
    var inp = document.getElementById('page-jump-input');
    var btn = document.getElementById('btn-page-jump');
    if (!inp || !btn) return;
    var pageJumpTouchLock = false;
    function onEnterKey(e) {
        if (e.code === 'Enter' || e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
            activatePageJumpFromInput();
        }
    }
    inp.addEventListener('focus', function() { _pageJumpInputFocused = true; });
    inp.addEventListener('input', function() { capturePageJumpDraft(inp); });
    inp.addEventListener('change', function() { capturePageJumpDraft(inp); });
    inp.addEventListener('blur', function() {
        _pageJumpInputFocused = false;
        capturePageJumpDraft(inp);
    });
    inp.addEventListener('keydown', onEnterKey);
    inp.addEventListener('keyup', onEnterKey);
    btn.addEventListener('click', function(e) {
        if (pageJumpTouchLock) {
            e.preventDefault();
            return;
        }
        activatePageJumpFromInput();
    });
    btn.addEventListener('touchend', function(e) {
        e.preventDefault();
        pageJumpTouchLock = true;
        activatePageJumpFromInput();
        setTimeout(function() { pageJumpTouchLock = false; }, 450);
    }, { passive: false });
})();

window.toggleTTS = toggleTTS;

document.addEventListener('keydown', function(e) {
    if (e.target.closest('input, select, textarea, button')) return;
    if (!pdfDoc) return;
    var code = e.code || '';
    var key  = e.key  || '';
    if (code === 'ArrowLeft'  || key === 'ArrowLeft')  { e.preventDefault(); changePage(-1); }
    if (code === 'ArrowRight' || key === 'ArrowRight') { e.preventDefault(); changePage(1); }
    if (code === 'Space' || key === ' ') {
        e.preventDefault();
        toggleTTS();
    }
});

window.addEventListener('resize', function() {
    if (!pdfDoc || isReading || speakLock) return;
    clearTimeout(readeraResizeTimer);
    readeraResizeTimer = setTimeout(function() {
        renderPage(pageNum, true);
    }, 280);
});

if (btnToggleLayout) {
    btnToggleLayout.addEventListener('click', toggleVirtualLandscape);
}

(function initZoomButtons() {
    var btnOut = document.getElementById('btn-zoom-out');
    var btnIn  = document.getElementById('btn-zoom-in');
    if (btnOut) {
        btnOut.disabled = pdfZoom <= PDF_ZOOM_MIN;
        btnOut.addEventListener('click', function() { applyPdfZoom(-PDF_ZOOM_STEP); });
    }
    if (btnIn) {
        btnIn.disabled = pdfZoom >= PDF_ZOOM_MAX;
        btnIn.addEventListener('click', function() { applyPdfZoom(PDF_ZOOM_STEP); });
    }
}());

if (btnTtsSkipBack) {
    btnTtsSkipBack.addEventListener('click', function() { skipTtsBySeconds(-TTS_SKIP_SECONDS); });
}

if (btnTtsSkipFwd) {
    btnTtsSkipFwd.addEventListener('click', function() { skipTtsBySeconds(TTS_SKIP_SECONDS); });
}

window.addEventListener('resize', function() {
    updateLayoutToggleVisible();
});

wireAuthUi();

if (window.ReadEdyBilling) ReadEdyBilling.onReturnFromMp();

try {
    var bootUrl = new URL(window.location.href);
    if (bootUrl.searchParams.get('tab') === 'conta') {
        setTimeout(function() { openHomeView('conta'); }, 0);
    }
} catch (e) {}

initSupabaseClient();

wireHomeUi();
