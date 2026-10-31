/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/controls
   Controles da leitura: tocar/pausar/parar, pular segundos, marcador, botões.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function resetTtsBookmark() {
    ttsResumeCharOffset = 0;
    ttsResumePageNum = null;
    ttsLastFullTextLen = 0;
    ttsAbsCharEnd = 0;
    ttsProxyResumeFrac = 0;
    ttsProxyCharOffset = 0;
    ttsProxyEndHandled = false;
    ttsProxyRecoverAttempts = 0;
    if (ttsProxyEndFallbackTimer != null) {
        clearTimeout(ttsProxyEndFallbackTimer);
        ttsProxyEndFallbackTimer = null;
    }
    stopTtsProxyWatchdog();
    document.body.classList.remove('tts-paused');
    updateTtsSeekButtonsVisible();
}

function updateTtsSeekButtonsVisible() {
    var ready = false;
    if (pdfDoc) {
        if (ttsPageCache.pageNum === pageNum && (ttsPageCache.text || '').trim()) ready = true;
        if (isReading) ready = true;
        if (ttsResumePageNum === pageNum && ttsResumeCharOffset > 0) ready = true;
    }
    if (ready) document.body.classList.add('tts-seek-ready');
    else document.body.classList.remove('tts-seek-ready');
}

function getTtsPageTextLen() {
    var text = '';
    if (ttsPageCache.pageNum === pageNum && ttsPageCache.text) text = ttsPageCache.text;
    else if (fullPageText) text = fullPageText;
    return text.length;
}

function getTtsPlaybackCharIndex() {
    var len = getTtsPageTextLen();
    if (len <= 0) return 0;
    if (isReading && ttsEngine === 'proxy' && ttsAudioEl && ttsAudioEl.duration > 0) {
        var progress = ttsAudioEl.currentTime / ttsAudioEl.duration;
        var tmText = (ttsPageCache.pageNum === pageNum && ttsPageCache.text) ? ttsPageCache.text : fullPageText;
        if (tmText && tmText.length === len) return _ttsCharFromProgress(progress, tmText);
        return Math.floor((ttsProxyResumeFrac + progress * (1 - ttsProxyResumeFrac)) * len);
    }
    if (ttsAbsCharEnd > 0) return ttsAbsCharEnd;
    if (ttsResumePageNum === pageNum && ttsResumeCharOffset > 0) return ttsResumeCharOffset;
    return 0;
}

function proxyTimeFromCharIndex(charIdx, textLen, duration, resumeFrac) {
    if (textLen <= 0 || duration <= 0) return 0;
    var frac = Math.max(0, Math.min(1, charIdx / textLen));
    var span = 1 - resumeFrac;
    if (span < 0.001) return 0;
    var progress = (frac - resumeFrac) / span;
    progress = Math.max(0, Math.min(1, progress));
    return progress * duration;
}

function applyTtsSeekCharIndex(charIdx) {
    var text = (ttsPageCache.pageNum === pageNum && ttsPageCache.text) ? ttsPageCache.text : (fullPageText || '');
    var len = text.length;
    if (len <= 0) {
        showTtsToast('Sem texto nesta página para posicionar a leitura.');
        return false;
    }
    charIdx = Math.max(0, Math.min(len, charIdx | 0));
    ttsResumeCharOffset = charIdx;
    ttsResumePageNum = pageNum;
    ttsAbsCharEnd = charIdx;
    ttsLastFullTextLen = len;
    updateHighlight(charIdx, 8);
    scrollTtsHighlightIntoView();
    updateTtsButtonLabel();
    updateTtsSeekButtonsVisible();
    return true;
}

function skipTtsBySeconds(deltaSec) {
    if (!pdfDoc) return;
    var text = (ttsPageCache.pageNum === pageNum && ttsPageCache.text) ? ttsPageCache.text : '';
    if (!text.trim()) {
        showTtsToast('Inicie a leitura em voz alta antes de usar ⏪ ⏩.');
        return;
    }
    var len = text.length;
    var pos = getTtsPlaybackCharIndex();
    var rate = rateRange ? Number(rateRange.value) : 1;
    if (!isFinite(rate) || rate <= 0) rate = 1;

    /* ── Calcular nova posição em chars ── */
    /* Para proxy: estimar densidade real com base na duração do áudio fatiado atual */
    var approxChars;
    if (ttsEngine === 'proxy' && ttsAudioEl && ttsAudioEl.duration > 0 && isFinite(ttsAudioEl.duration)) {
        var slicedLen = len - ttsProxyCharOffset;
        if (slicedLen < 1) slicedLen = 1;
        var charsPerSec = slicedLen / ttsAudioEl.duration;
        approxChars = Math.round(Math.abs(deltaSec) * charsPerSec);
    } else {
        approxChars = Math.round(TTS_SKIP_SECONDS * 14 * rate);
    }
    if (deltaSec < 0) approxChars = -approxChars;
    var newPos = Math.max(0, Math.min(len - 1, pos + approxChars));

    if (!applyTtsSeekCharIndex(newPos)) return;
    ttsProxyResumeFrac = len > 0 ? newPos / len : 0;
    updateHighlight(newPos, 8);
    updateTtsSeekButtonsVisible();

    if (isReading) {
        if (ttsEngine === 'proxy') {
            /* NÃO usar currentTime seek (Edge Function não suporta Range requests).
               Parar o áudio atual e reiniciar com texto fatiado a partir da nova posição. */
            ttsStopRequested = true;       /* onpause vê ttsStopRequested=true → não aciona recover */
            if (ttsAudioEl) ttsAudioEl.pause();
            stopTtsProxyWatchdog();
            ttsStopRequested = false;
            isReading = false;
            speakLock = false;
            speakCurrentPage();            /* lerá ttsResumeCharOffset=newPos e fatiará o texto */
        } else if (ttsEngine === 'webspeech') {
            if (_wsSynth) { try { _wsSynth.cancel(); } catch (e) {} }
            isReading = false;
            currentUtterance = null;
            speakLock = false;
            speakCurrentPage();
        }
    }
    /* Se pausado: ttsResumeCharOffset atualizado — ao retomar vai do novo ponto */
}

function setTtsButtonsState(state) {
    var title = 'Ouvir em voz alta';
    var cls = 'btn-tts-ui tts-state-idle';
    if (state === 'playing') {
        title = 'Parar leitura';
        cls = 'btn-tts-ui tts-state-playing';
    } else if (state === 'continue') {
        title = 'Continuar leitura';
        cls = 'btn-tts-ui tts-state-continue';
    }
    ['btn-tts', 'btn-tts-float'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.className = cls;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.innerHTML = (state === 'playing') ? MINI_ICON_PAUSE : MINI_ICON_PLAY;
    });
    setMiniTtsIcon(state === 'playing');
    if (state === 'playing') statsMarkTtsActive();
    else statsFlushTtsTime();
}

function updateTtsButtonLabel() {
    if (isReading || speakLock) return;
    var canContinue = pdfDoc && ttsResumePageNum === pageNum && ttsResumeCharOffset > 0
        && ttsLastFullTextLen > 0 && ttsResumeCharOffset < ttsLastFullTextLen;
    setTtsButtonsState(canContinue ? 'continue' : 'idle');
}

function pauseTTS() {
    ttsStopRequested = true;
    isReading = false;
    currentUtterance = null;
    ensureTtsHighlightState();

    if (ttsEngine === 'proxy' && ttsAudioEl && ttsAudioEl.duration > 0) {
        var lenP = fullPageText.length || (ttsPageCache.text || '').length;
        if (lenP > 0) {
            var fracP = Math.max(0, Math.min(1, ttsAudioEl.currentTime / ttsAudioEl.duration));
            var textP = fullPageText.length ? fullPageText : (ttsPageCache.text || '');
            var charP = _ttsCharFromProgress(fracP, textP);
            ttsAbsCharEnd = charP;
            ttsResumeCharOffset = charP;
            ttsResumePageNum = pageNum;
            ttsLastFullTextLen = lenP;
            ttsProxyResumeFrac = charP / lenP;
        }
        if (ttsAudioEl && !ttsAudioEl.paused) ttsAudioEl.pause();
    } else {
        var cap = ttsLastFullTextLen > 0 ? ttsLastFullTextLen : Math.max(0, ttsAbsCharEnd);
        ttsResumeCharOffset = Math.min(Math.max(0, ttsAbsCharEnd), cap);
        ttsResumePageNum = pageNum;
        if (_wsSynth) { try { _wsSynth.cancel(); } catch (e) {} }
    }

    speakLock = false;
    stopTtsProxyWatchdog();
    document.body.classList.add('tts-paused');
    if (ttsResumeCharOffset > 0) updateHighlight(ttsResumeCharOffset, 8);
    setTtsButtonsState('continue');
    updateTtsSeekButtonsVisible();
    ttsStopRequested = false;
}

function stopTTS(opts) {
    const resetBookmark = !opts || opts.resetBookmark !== false;
    ttsStopRequested = true;
    isReading = false;
    currentUtterance = null;
    /* Proxy */
    stopTtsProxyWatchdog();
    if (ttsAudioEl) {
        ttsAudioEl.pause();
        ttsAudioEl.ontimeupdate = null; ttsAudioEl.onended = null;
        ttsAudioEl.onerror = null; ttsAudioEl.onplay = null;
        ttsAudioEl.onpause = null; ttsAudioEl.onwaiting = null; ttsAudioEl.onstalled = null;
        ttsAudioEl.src = '';
    }
    _revokeTtsBlobUrl();
    /* WebSpeech */
    if (_wsSynth) { try { _wsSynth.cancel(); } catch(e) {} }
    _clearTtsWatchdog();
    fullPageText = '';
    ttsCharRanges = [];
    speakLock = false;
    clearPdfHighlight();
    setTtsButtonsState('idle');
    if (resetBookmark) resetTtsBookmark();
    else document.body.classList.remove('tts-paused');
    updateTtsButtonLabel();
    ttsStopRequested = false;
}

function _clearTtsWatchdog() {
    if (ttsWatchdogTimer != null) { clearTimeout(ttsWatchdogTimer); ttsWatchdogTimer = null; }
}

/* ── speakCurrentPage: usa o motor TTS correto ──────────── */
function speakCurrentPage() {
    if (speakLock || !pdfDoc) return Promise.resolve();
    if (ttsStopRequested) return Promise.resolve();

    if (ttsEngine === 'proxy') {
        return ensureTtsPageCache(pageNum).then(function(cache) {
            if (ttsStopRequested) return;
            if (!(cache.text || '').trim()) {
                showTtsToast('Esta página não tem texto legível.');
                return;
            }
            startProxyTtsPlayback(cache.text, cache.ranges || [], pageNum);
        }).catch(function(e) {
            console.error(e);
            showTtsToast('Erro ao extrair texto da página.');
        });
    }

    /* WebSpeech */
    if (ttsPageCache.pageNum === pageNum && ttsPageCache.text && ttsPageCache.text.trim()) {
        _executeSpeechWebSpeech(ttsPageCache.text, ttsPageCache.ranges || []);
        return Promise.resolve();
    }
    return pdfDoc.getPage(pageNum).then(function(page) {
        return page.getTextContent();
    }).then(function(textContent) {
        var built = buildTtsTextAndRanges(textContent.items || []);
        ttsPageCache = { pageNum: pageNum, text: built.text, ranges: built.ranges };
        _executeSpeechWebSpeech(built.text, built.ranges);
    }).catch(function(e) {
        console.error(e); showTtsToast('Erro ao extrair texto da página.'); stopTTS();
    });
}

/* toggleTTS — SÍNCRONA para Chrome HTTPS respeitar gesto do utilizador */
function toggleTTS() {
    if (!requirePaidAccess()) return;
    /* Desbloquear áudio a cada clique (garante unlock mesmo se primeiro clique foi noutro elemento) */
    _unlockAudio();
    applyTtsEngineFromPreference({ invalidateCache: false });
    if (isReading) {
        if (ttsEngine === 'proxy' && !isProxyAudioActivelyPlaying() && !document.body.classList.contains('tts-paused')) {
            if (tryRecoverProxyPlayback(pageNum)) return;
            if (tryResumePausedProxyTts()) return;
            speakCurrentPage();
            return;
        }
        pauseTTS();
        return;
    }
    if (speakLock) {
        if (ttsContinuousAdvanceLock) {
            /* Utilizador clicou durante o avanço de página — abortar o avanço */
            ttsContinuousAdvanceLock = false;
            stopTTS();
        } else {
            /* speakLock de outro motivo (a preparar texto) — cancelar */
            _clearTtsWatchdog();
            ttsStopRequested = true; speakLock = false;
            setTtsButtonsState('idle');
            updateTtsButtonLabel();
        }
        return;
    }
    if (!pdfDoc) {
        showTtsToast('Abra um PDF primeiro.');
        return;
    }
    if (isRendering) {
        showTtsToast('Aguarde a página terminar de carregar.');
        return;
    }

    if (tryResumePausedProxyTts()) return;

    if (ttsEngine === 'proxy') {
        if (ttsPageCache.pageNum === pageNum && (ttsPageCache.text || '').trim()) {
            startProxyTtsPlayback(ttsPageCache.text, ttsPageCache.ranges || [], pageNum);
            return;
        }
        speakLock = true;
        setTtsButtonsState('playing');
        ensureTtsPageCache(pageNum).then(function(cache) {
            speakLock = false;
            if (pageNum !== cache.pageNum) {
                isReading = false;
                setTtsButtonsState('idle');
                updateTtsButtonLabel();
                return;
            }
            if (!(cache.text || '').trim()) {
                isReading = false;
                setTtsButtonsState('idle');
                showTtsToast('Esta página não tem texto legível.');
                return;
            }
            startProxyTtsPlayback(cache.text, cache.ranges || [], pageNum);
        }).catch(function(e) {
            console.error(e);
            speakLock = false;
            isReading = false;
            setTtsButtonsState('idle');
            updateTtsButtonLabel();
            showTtsToast('Erro ao extrair texto da página.');
        });
        return;
    }

    /* ── Engine WebSpeech ── */
    if (ttsEngine === 'webspeech') {
        if (ttsPageCache.pageNum === pageNum && (ttsPageCache.text || '').trim()) {
            _executeSpeechWebSpeech(ttsPageCache.text, ttsPageCache.ranges || []); return;
        }
        speakLock = true;
        ['btn-tts', 'btn-tts-float'].forEach(function(id) {
            var b = document.getElementById(id);
            if (b) { b.disabled = true; b.title = 'A preparar leitura…'; }
        });
        var targetPage = pageNum;
        pdfDoc.getPage(targetPage).then(function(pg) { return pg.getTextContent(); }).then(function(tc) {
            var built = buildTtsTextAndRanges(tc.items || []);
            ttsPageCache = { pageNum: targetPage, text: built.text, ranges: built.ranges };
            speakLock = false;
            ['btn-tts', 'btn-tts-float'].forEach(function(id) {
                var b = document.getElementById(id);
                if (b) b.disabled = false;
            });
            if (pageNum === targetPage && !isReading) _executeSpeechWebSpeech(built.text, built.ranges);
            else { updateTtsButtonLabel(); }
        }).catch(function(e) {
            console.error(e); speakLock = false;
            ['btn-tts', 'btn-tts-float'].forEach(function(id) {
                var b = document.getElementById(id);
                if (b) b.disabled = false;
            });
            updateTtsButtonLabel();
        });
        return;
    }

    showTtsToast('TTS não disponível neste dispositivo.');
}

var btnTtsSkipBack = document.getElementById('btn-tts-skip-back');

var btnTtsSkipFwd = document.getElementById('btn-tts-skip-fwd');
