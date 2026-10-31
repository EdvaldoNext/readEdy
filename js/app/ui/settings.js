/* ═══════════════════════════════════════════════════════════════
   ReadEdy · ui/settings
   Preferências de interface, painel de configurações e navegação por rolagem.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function syncChromeHiddenState() {
    var hidePref = safeStorage.getItem('readera-hide-chrome') === '1';
    /* O modo imersivo só se aplica à área de leitura, nunca à Home */
    document.body.classList.toggle('ui-chrome-hidden', hidePref && !!pdfDoc && !homeView);
}

function applyUiPrefs() {
    const hide       = safeStorage.getItem('readera-hide-chrome') === '1';
    const read       = safeStorage.getItem('readera-reading-mode') === '1';
    const autoCloud  = safeStorage.getItem(LS_AUTO_CLOUD) !== '0';
    const resumeCloud = safeStorage.getItem(LS_RESUME_CLOUD) !== '0';
    syncChromeHiddenState();
    document.body.classList.toggle('reading-mode', read);
    const h  = document.getElementById('opt-hide-chrome');
    const r  = document.getElementById('opt-reading-mode');
    const ac = document.getElementById('opt-auto-cloud');
    const rc = document.getElementById('opt-resume-cloud');
    if (h)  h.checked  = hide;
    if (r)  r.checked  = read;
    if (ac) ac.checked = autoCloud;
    if (rc) rc.checked = resumeCloud;
    /* Ler em sequência */
    const cont = safeStorage.getItem('readera-continuous');
    const contEl = document.getElementById('continuous-read');
    if (contEl && cont !== null) contEl.checked = cont === '1';
}

function wireSettingsUi() {
    const btn = document.getElementById('btn-settings');
    const screen = document.getElementById('settings-screen');
    const backBtn = document.getElementById('btn-settings-back');
    const hideCb = document.getElementById('opt-hide-chrome');
    const readCb = document.getElementById('opt-reading-mode');
    const autoCloudCb = document.getElementById('opt-auto-cloud');
    const resumeCloudCb = document.getElementById('opt-resume-cloud');
    const showChrome = document.getElementById('btn-show-chrome');
    if (!btn || !screen || !showChrome) return;

    function closeSettingsScreen() {
        screen.classList.remove('open');
        screen.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
    }
    function openSettingsScreen() {
        screen.classList.add('open');
        screen.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
        if (window._refreshSettingsScrollNav) {
            setTimeout(window._refreshSettingsScrollNav, 60);
            setTimeout(window._refreshSettingsScrollNav, 400);
        }
    }
    window._readEdyOpenSettings = openSettingsScreen;
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (screen.classList.contains('open')) closeSettingsScreen();
        else openSettingsScreen();
    });
    if (backBtn) backBtn.addEventListener('click', closeSettingsScreen);

    if (hideCb) {
        hideCb.addEventListener('change', function() {
            safeStorage.setItem('readera-hide-chrome', hideCb.checked ? '1' : '0');
            syncChromeHiddenState();
            schedulePdfRelayout();
        });
    }
    if (readCb) {
        readCb.addEventListener('change', function() {
            safeStorage.setItem('readera-reading-mode', readCb.checked ? '1' : '0');
            document.body.classList.toggle('reading-mode', readCb.checked);
            if (pdfDoc && !isRendering) renderPage(pageNum, isReading);
        });
    }
    if (autoCloudCb) {
        autoCloudCb.addEventListener('change', function() {
            safeStorage.setItem(LS_AUTO_CLOUD, autoCloudCb.checked ? '1' : '0');
        });
    }
    if (resumeCloudCb) {
        resumeCloudCb.addEventListener('change', function() {
            safeStorage.setItem(LS_RESUME_CLOUD, resumeCloudCb.checked ? '1' : '0');
        });
    }
    showChrome.addEventListener('click', function() {
        var isNowHidden = document.body.classList.toggle('ui-chrome-hidden');
        if (hideCb) hideCb.checked = isNowHidden;
        safeStorage.setItem('readera-hide-chrome', isNowHidden ? '1' : '0');
        schedulePdfRelayout();
    });

    const resetBtn = document.getElementById('btn-reset-storage');
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            if (!confirm('Apagar todas as preferências guardadas neste browser (tema, opções, ID do último documento)?\n\nA página será recarregada.')) return;
            ['readera-theme','readera-hide-chrome','readera-reading-mode','readera-tts-highlight',
             LS_AUTO_CLOUD,LS_RESUME_CLOUD,LS_LAST_CLOUD_DOC,'readera-voice-key',LS_TTS_ENGINE,
             'readera-speed','readera-continuous']
                .forEach(function(k) { safeStorage.removeItem(k); });
            location.reload();
        });
    }

    /* ── opt-tts-highlight (tarja amarela, desligada por padrão) ── */
    var hlCb = document.getElementById('opt-tts-highlight');
    if (hlCb) {
        hlCb.checked = safeStorage.getItem('readera-tts-highlight') === '1';
        hlCb.addEventListener('change', function() {
            safeStorage.setItem('readera-tts-highlight', hlCb.checked ? '1' : '0');
            if (!hlCb.checked) clearPdfHighlight();
        });
    }

    /* ── opt-ocr-scan (OCR para PDFs escaneados, desligado por padrão) ── */
    var ocrCb = document.getElementById('opt-ocr-scan');
    if (ocrCb) {
        ocrCb.checked = safeStorage.getItem('readera-ocr-scan') === '1';
        ocrCb.addEventListener('change', function() {
            safeStorage.setItem('readera-ocr-scan', ocrCb.checked ? '1' : '0');
            /* Limpar cache OCR ao alternar para forçar re-reconhecimento */
            ocrPageCache = {};
            ttsPageCache = { pageNum: null, text: '', ranges: [] };
        });
    }

    /* ── Botão Salvar e aplicar ── */
    var saveSettingsBtn = document.getElementById('btn-save-settings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', function() {
            /* Gravar todos os campos de configuração no localStorage */
            var voiceSel   = document.getElementById('voice-select');
            var engineSel  = document.getElementById('tts-engine-select');
            var rateInp    = document.getElementById('rate-range');
            var contRead   = document.getElementById('continuous-read');
            var hlCb2      = document.getElementById('opt-tts-highlight');
            var hideCb2    = document.getElementById('opt-hide-chrome');
            var readCb2    = document.getElementById('opt-reading-mode');
            var autoClCb   = document.getElementById('opt-auto-cloud');
            var resumeClCb = document.getElementById('opt-resume-cloud');

            if (voiceSel)   safeStorage.setItem('readera-voice-key', voiceSel.value);
            if (engineSel)  safeStorage.setItem(LS_TTS_ENGINE, engineSel.value);
            if (rateInp)    safeStorage.setItem('readera-speed', rateInp.value);
            if (contRead)   safeStorage.setItem('readera-continuous', contRead.checked ? '1' : '0');
            if (hlCb2)      safeStorage.setItem('readera-tts-highlight', hlCb2.checked ? '1' : '0');
            if (hideCb2)    safeStorage.setItem('readera-hide-chrome', hideCb2.checked ? '1' : '0');
            if (readCb2)    safeStorage.setItem('readera-reading-mode', readCb2.checked ? '1' : '0');
            if (autoClCb)   safeStorage.setItem(LS_AUTO_CLOUD, autoClCb.checked ? '1' : '0');
            if (resumeClCb) safeStorage.setItem(LS_RESUME_CLOUD, resumeClCb.checked ? '1' : '0');
            var ocrCb2 = document.getElementById('opt-ocr-scan');
            if (ocrCb2)     safeStorage.setItem('readera-ocr-scan', ocrCb2.checked ? '1' : '0');

            /* Feedback visual antes de recarregar */
            saveSettingsBtn.textContent = '✔ Salvando…';
            saveSettingsBtn.disabled = true;
            setTimeout(function() { location.reload(); }, 300);
        });
    }

    applyUiPrefs();
}

function wireScrollNavControls() {
    function attachScrollNav(opts) {
        var container = opts.container;
        var upBtn = opts.upBtn;
        var downBtn = opts.downBtn;
        var stack = opts.stack;
        if (!container || !upBtn || !downBtn) return null;
        var stepRatio = opts.stepRatio || 0.55;

        function maxScroll() {
            return Math.max(0, container.scrollHeight - container.clientHeight);
        }

        function updateState() {
            var max = maxScroll();
            var st = container.scrollTop;
            var canScroll = max > 4;
            if (stack) stack.classList.toggle('is-dimmed', !canScroll);
            upBtn.disabled = !canScroll || st <= 2;
            downBtn.disabled = !canScroll || st >= max - 2;
        }

        function scrollByDir(dir) {
            var delta = container.clientHeight * stepRatio * dir;
            try {
                container.scrollBy({ top: delta, behavior: 'smooth' });
            } catch (e) {
                container.scrollTop += delta;
            }
            setTimeout(updateState, 400);
        }

        upBtn.addEventListener('click', function(e) {
            e.preventDefault();
            scrollByDir(-1);
        });
        downBtn.addEventListener('click', function(e) {
            e.preventDefault();
            scrollByDir(1);
        });
        container.addEventListener('scroll', updateState);
        window.addEventListener('resize', updateState);
        updateState();
        return { refresh: updateState };
    }

    var settingsNav = attachScrollNav({
        container: document.getElementById('settings-screen-scroll'),
        upBtn: document.getElementById('btn-settings-scroll-up'),
        downBtn: document.getElementById('btn-settings-scroll-down'),
        stack: document.getElementById('settings-scroll-nav'),
        stepRatio: 0.5
    });
    var viewer = document.getElementById('viewer-container');
    var readerNav = attachScrollNav({
        container: viewer,
        upBtn: document.getElementById('btn-reader-scroll-up'),
        downBtn: document.getElementById('btn-reader-scroll-down'),
        stack: document.getElementById('reader-scroll-nav'),
        stepRatio: 0.55
    });
    window._refreshSettingsScrollNav = settingsNav ? settingsNav.refresh : null;
    window._refreshReaderScrollNav = readerNav ? readerNav.refresh : null;
    if (viewer && readerNav) {
        var obs = new MutationObserver(function() {
            readerNav.refresh();
        });
        obs.observe(viewer, { childList: true, subtree: true });
    }
}
