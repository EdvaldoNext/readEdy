/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/playback
   Reprodução do áudio da nuvem: bind, watchdog, avanço contínuo de página.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function extractPageSpeech(num) {
    return pdfDoc.getPage(num).then(function(page) {
        return page.getTextContent().then(function(textContent) {
            var items = textContent.items || [];
            var built = buildTtsTextAndRanges(items);
            if (isSpeechReadable(built.text)) {
                return { pageNum: num, text: built.text, ranges: built.ranges, fromOcr: false };
            }
            var hadGlyphs = false;
            for (var i = 0; i < items.length; i++) {
                if (items[i] && String(items[i].str || '').length) { hadGlyphs = true; break; }
            }
            var ocrCb = document.getElementById('opt-ocr-scan');
            /* Fonte simbólica: o PDF desenha as letras, mas o texto extraído é lixo.
               Página vazia de verdade só passa pelo OCR se o utilizador ligou a opção. */
            var wantOcr = hadGlyphs ? true : !!(ocrCb && ocrCb.checked);
            if (!wantOcr) return { pageNum: num, text: '', ranges: [], fromOcr: false };
            return runOcrOnPage(page, num, hadGlyphs ? 'encoded' : 'scan').then(function(ocr) {
                if ((ocr.text || '').trim()) {
                    showTtsToast('Texto reconhecido via OCR — pode ter imprecisões.');
                }
                return { pageNum: num, text: ocr.text || '', ranges: [], fromOcr: true };
            }).catch(function(err) {
                console.error('[OCR]', err);
                showTtsToast('OCR falhou nesta página.');
                return { pageNum: num, text: '', ranges: [], fromOcr: true };
            });
        });
    });
}

function ensureTtsPageCache(targetPage) {
    var num = (targetPage != null && targetPage > 0) ? (targetPage | 0) : pageNum;
    if (ttsPageCache.pageNum === num && (ttsPageCache.text || '').trim()) {
        return Promise.resolve(ttsPageCache);
    }
    if (!pdfDoc) return Promise.reject(new Error('Sem PDF aberto'));
    return extractPageSpeech(num).then(function(result) {
        ttsPageCache = { pageNum: num, text: result.text, ranges: result.ranges || [] };
        return ttsPageCache;
    });
}

function startProxyTtsPlayback(text, ranges, targetPage) {
    var num = (targetPage != null && targetPage > 0) ? (targetPage | 0) : pageNum;
    var voice = voiceSelect ? voiceSelect.value : 'pt-BR-FranciscaNeural';
    /* Usar texto fatiado quando há posição de retomada — evita seek em stream sem Range support */
    var charOffset = (ttsResumePageNum === num && ttsResumeCharOffset > 0 && ttsResumeCharOffset < text.length)
        ? ttsResumeCharOffset : 0;
    var sendText = charOffset > 0 ? text.slice(charOffset) : text;
    isReading = true;
    ttsStopRequested = false;
    setTtsButtonsState('playing');
    _fetchTtsAudioUrl(sendText, voice, _ttsRate(), function(url) {
        _playTtsUrl(url, text, ranges || [], num, charOffset);
    }, function(err) {
        console.error('[TTS proxy]', err);
        isReading = false;
        speakLock = false;
        setTtsButtonsState('idle');
        updateTtsButtonLabel();
        showTtsToast('Erro no servidor TTS. Tente de novo.');
    }, num, true);
}

function updateMediaSession(tituloLivro, paginaAtual) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: tituloLivro || 'Lendo Livro PDF',
            artist: 'ReadEra Web Pro',
            album: 'Página ' + (paginaAtual || 1)
        });

        navigator.mediaSession.setActionHandler('play', function() { if (typeof toggleTTS === 'function') toggleTTS(); });
        navigator.mediaSession.setActionHandler('pause', function() { if (typeof toggleTTS === 'function') toggleTTS(); });
    }
}

function ensureTtsHighlightState() {
    if (ttsPageCache.pageNum === pageNum && ttsPageCache.text) {
        if (!fullPageText) fullPageText = ttsPageCache.text;
        if (!ttsCharRanges.length) ttsCharRanges = ttsPageCache.ranges || [];
        ttsLastFullTextLen = fullPageText.length;
    }
}

function isAppInBackground() {
    return document.hidden || document.visibilityState === 'hidden';
}

function ttsShouldAutoAdvancePage(capturedPage, opts) {
    opts = opts || {};
    if (ttsRepeatPage) return false;
    var contEl = document.getElementById('continuous-read');
    if (!contEl || !contEl.checked) return false;
    if (pageNum !== capturedPage || !pdfDoc || pageNum >= pdfDoc.numPages) return false;
    if (document.body.classList.contains('tts-paused')) return false;
    if (opts.fromEnded) return true;
    if (ttsEngine === 'proxy' && ttsAudioEl && ttsAudioEl.duration > 0) {
        return ttsAudioEl.currentTime >= ttsAudioEl.duration * 0.9;
    }
    return true;
}

function prefetchNextPageForContinuous(fromPage) {
    if (!pdfDoc || ttsEngine !== 'proxy') return;
    var contEl = document.getElementById('continuous-read');
    if (!contEl || !contEl.checked) return;
    var next = fromPage + 1;
    if (next > pdfDoc.numPages || ttsNextPageCache.pageNum === next) return;
    extractPageSpeech(next).then(function(result) {
        ttsNextPageCache = { pageNum: next, text: result.text, ranges: result.ranges || [] };
        if (result.text && result.text.trim()) preFetchTtsAudio(next, result.text);
    }).catch(function() {});
}

function ttsPreparePageForBackgroundRead(num) {
    var pi = document.getElementById('page-info');
    if (pi && pdfDoc) pi.textContent = num + ' / ' + pdfDoc.numPages;
    syncPageJumpInput();
    updateMediaSession(currentBookTitle, num);
    scheduleCloudProgress();
    ttsPendingRenderPage = num;

    if (ttsNextPageCache.pageNum === num && ttsNextPageCache.text) {
        ttsPageCache = { pageNum: num, text: ttsNextPageCache.text, ranges: ttsNextPageCache.ranges || [] };
        ttsNextPageCache = { pageNum: null, text: '', ranges: [] };
        return Promise.resolve();
    }
    if (ttsPageCache.pageNum === num && ttsPageCache.text) return Promise.resolve();

    return extractPageSpeech(num).then(function(result) {
        ttsPageCache = { pageNum: num, text: result.text, ranges: result.ranges || [] };
        if (result.text && result.text.trim() && ttsEngine === 'proxy') preFetchTtsAudio(num, result.text);
    });
}

function ttsHandlePagePlaybackEnded(capturedPage) {
    if (ttsRepeatPage && pageNum === capturedPage && pdfDoc) {
        resetTtsBookmark();
        speakLock = false;
        isReading = false;
        currentUtterance = null;
        setTtsButtonsState('idle');
        updateTtsButtonLabel();
        setTimeout(function() {
            if (ttsRepeatPage && pageNum === capturedPage && pdfDoc && !isReading && !speakLock) speakCurrentPage();
        }, 350);
        return Promise.resolve();
    }
    return ttsAfterPagePlaybackFinished(capturedPage);
}

function ttsAfterPagePlaybackFinished(capturedPage) {
    if (ttsContinuousAdvanceLock) return Promise.resolve();
    if (!ttsShouldAutoAdvancePage(capturedPage, { fromEnded: true })) {
        resetTtsBookmark();
        speakLock = false;
        setTtsButtonsState('idle');
        updateTtsButtonLabel();
        return Promise.resolve();
    }
    var next = capturedPage + 1;
    if (!pdfDoc || next > pdfDoc.numPages) {
        resetTtsBookmark();
        speakLock = false;
        setTtsButtonsState('idle');
        updateTtsButtonLabel();
        return Promise.resolve();
    }

    ttsContinuousAdvanceLock = true;
    resetTtsBookmark();
    /* speakLock mantém-se true durante o avanço para bloquear toggleTTS acidental */
    speakLock = true;
    isReading = false;
    currentUtterance = null;
    pageNum = next;
    currentPageNum = pageNum;
    /* NÃO apagar ttsNextPageCache aqui — ttsPreparePageForBackgroundRead consome-o */

    var done = function() {
        setTimeout(function() { ttsContinuousAdvanceLock = false; }, 400);
    };

    var _unlockAndSpeak = function() {
        speakLock = false;
        return speakCurrentPage();
    };

    var chain;
    if (isAppInBackground()) {
        chain = ttsPreparePageForBackgroundRead(pageNum).then(_unlockAndSpeak);
    } else {
        ttsPendingRenderPage = null;
        /* Consumir texto pré-carregado da próxima página (leitura contínua). */
        if (ttsNextPageCache.pageNum === pageNum && ttsNextPageCache.text) {
            ttsPageCache = { pageNum: pageNum, text: ttsNextPageCache.text, ranges: ttsNextPageCache.ranges || [] };
            ttsNextPageCache = { pageNum: null, text: '', ranges: [] };
        }
        var piAdv = document.getElementById('page-info');
        if (piAdv && pdfDoc) piAdv.textContent = pageNum + ' / ' + pdfDoc.numPages;
        syncPageJumpInput(true);
        scheduleCloudProgress();
        /* Mobile: iniciar áudio ANTES do render — render lento não deve bloquear a sequência. */
        speakLock = false;
        var speakP = speakCurrentPage();
        chain = Promise.resolve(speakP).then(function() {
            return renderPage(pageNum, true);
        }).then(function() {
            ttsNextPageCache = { pageNum: null, text: '', ranges: [] };
        });
    }
    return chain.then(done, function(err) {
        console.warn('[TTS] avanço contínuo:', err);
        isReading = false;
        speakLock = false;
        ttsNextPageCache = { pageNum: null, text: '', ranges: [] };
        setTtsButtonsState('idle');
        done();
        updateTtsButtonLabel();
    });
}

function flushTtsPendingRender() {
    if (!pdfDoc || !ttsPendingRenderPage || isRendering) return;
    if (ttsPendingRenderPage !== pageNum) return;
    if (isAppInBackground()) return;
    var n = ttsPendingRenderPage;
    ttsPendingRenderPage = null;
    renderPage(n, true).catch(function() {});
}

function stopTtsProxyWatchdog() {
    if (ttsProxyWatchInterval != null) {
        clearInterval(ttsProxyWatchInterval);
        ttsProxyWatchInterval = null;
    }
    ttsProxyWatchCapturedPage = null;
}

function isProxyAudioActivelyPlaying() {
    return !!(ttsAudioEl && !ttsAudioEl.paused && !ttsAudioEl.ended);
}

function tryRecoverProxyPlayback(capturedPage) {
    if (!ttsAudioEl || !ttsAudioEl.src) return false;
    if (document.body.classList.contains('tts-paused') || ttsStopRequested) return false;
    if (pageNum !== capturedPage || ttsProxyEndHandled) return false;
    if (isProxyAudioActivelyPlaying()) {
        ttsProxyRecoverAttempts = 0;
        if (!isReading) isReading = true;
        setTtsButtonsState('playing');
        return true;
    }
    if (ttsAudioEl.ended) return false;

    var pp;
    try { pp = ttsAudioEl.play(); } catch (e) { return false; }
    if (pp && typeof pp.then === 'function') {
        pp.then(function() {
            ttsProxyRecoverAttempts = 0;
            isReading = true;
            setTtsButtonsState('playing');
            if ('mediaSession' in navigator) {
                try { navigator.mediaSession.playbackState = 'playing'; } catch (err) {}
            }
        }).catch(function() {});
    } else {
        isReading = true;
        setTtsButtonsState('playing');
    }
    return true;
}

function syncTtsPlaybackUi(capturedPage) {
    if (ttsEngine !== 'proxy' || !ttsAudioEl || !ttsAudioEl.src) return;
    if (document.body.classList.contains('tts-paused')) return;
    var pg = capturedPage != null ? capturedPage : pageNum;
    if (isProxyAudioActivelyPlaying()) {
        ttsProxyRecoverAttempts = 0;
        if (!isReading) isReading = true;
        setTtsButtonsState('playing');
        return;
    }
    if (isReading && !ttsAudioEl.ended) {
        tryRecoverProxyPlayback(pg);
    }
}

function proxyAudioStalledAtEnd() {
    if (!ttsAudioEl || !(ttsAudioEl.duration > 0)) return false;
    return ttsAudioEl.currentTime >= ttsAudioEl.duration * 0.97;
}

function finalizeProxyPageEnd(capturedPage, capturedText) {
    if (ttsProxyEndHandled || pageNum !== capturedPage) return;
    ttsProxyEndHandled = true;
    if (ttsProxyEndFallbackTimer != null) {
        clearTimeout(ttsProxyEndFallbackTimer);
        ttsProxyEndFallbackTimer = null;
    }
    stopTtsProxyWatchdog();
    isReading = false;
    currentUtterance = null;
    ttsAbsCharEnd = capturedText.length;
    if (!isAppInBackground()) updateHighlight(capturedText.length - 1, 8);
    setTtsButtonsState('idle');
    ttsHandlePagePlaybackEnded(capturedPage);
}

function startTtsProxyWatchdog(capturedPage, capturedText) {
    stopTtsProxyWatchdog();
    ttsProxyWatchCapturedPage = capturedPage;
    ttsProxyRecoverAttempts = 0;
    var lastTime = -1;
    var lastProgressMs = Date.now();

    ttsProxyWatchInterval = setInterval(function() {
        if (pageNum !== capturedPage || ttsProxyWatchCapturedPage !== capturedPage) {
            stopTtsProxyWatchdog();
            return;
        }
        if (!ttsAudioEl || !ttsAudioEl.src) {
            stopTtsProxyWatchdog();
            return;
        }
        if (document.body.classList.contains('tts-paused')) return;

        if (ttsAudioEl.ended && !ttsProxyEndHandled) {
            finalizeProxyPageEnd(capturedPage, capturedText);
            return;
        }

        var playing = isProxyAudioActivelyPlaying();
        if (playing) {
            var ct = ttsAudioEl.currentTime;
            if (Math.abs(ct - lastTime) > 0.04) {
                lastTime = ct;
                lastProgressMs = Date.now();
            } else if (Date.now() - lastProgressMs >= TTS_PROXY_STALL_MS) {
                if (ttsProxyRecoverAttempts < TTS_PROXY_MAX_RECOVER) {
                    ttsProxyRecoverAttempts++;
                    tryRecoverProxyPlayback(capturedPage);
                    lastProgressMs = Date.now();
                } else {
                    showTtsToast('Leitura travou. Toque em Ouvir para continuar.');
                    pauseTTS();
                }
            }
        } else if (isReading && proxyAudioStalledAtEnd() && !ttsProxyEndHandled) {
            finalizeProxyPageEnd(capturedPage, capturedText);
            return;
        } else if (isReading && !playing && !ttsAudioEl.ended) {
            var len = capturedText.length;
            if (len > 0 && ttsAudioEl.duration > 0) {
                var frac = ttsAudioEl.currentTime / ttsAudioEl.duration;
                var charP = _ttsCharFromProgress(frac, capturedText);
                ttsAbsCharEnd = charP;
                ttsResumeCharOffset = charP;
                ttsResumePageNum = capturedPage;
                ttsLastFullTextLen = len;
            }
            if (ttsProxyRecoverAttempts < TTS_PROXY_MAX_RECOVER) {
                ttsProxyRecoverAttempts++;
                tryRecoverProxyPlayback(capturedPage);
            }
        }

        syncTtsPlaybackUi(capturedPage);
    }, 2000);
}

function _bindProxyTtsPlayback(url, capturedText, capturedRanges, capturedPage, opts) {
    opts = opts || {};
    var skipSeek = !!opts.skipSeek;
    var autoPlay = opts.autoPlay !== false;
    var charOffset = typeof opts.charOffset === 'number' ? opts.charOffset : 0;

    stopTtsProxyWatchdog();
    ttsAudioEl.ontimeupdate = null;
    ttsAudioEl.onended = null;
    ttsAudioEl.onerror = null;
    ttsAudioEl.onplay = null;
    ttsAudioEl.onpause = null;
    ttsAudioEl.onwaiting = null;
    ttsAudioEl.onstalled = null;

    var resumeFrac;
    if (charOffset > 0 && capturedText.length > 0) {
        /* Áudio fatiado: fração base = charOffset / fullLen */
        resumeFrac = charOffset / capturedText.length;
    } else if (skipSeek && ttsAudioEl.duration > 0) {
        /* Retomada de pausa em áudio completo: usar posição atual do áudio */
        resumeFrac = Math.max(0, Math.min(1, ttsAudioEl.currentTime / ttsAudioEl.duration));
    } else {
        resumeFrac = (ttsResumePageNum === capturedPage && ttsResumeCharOffset > 0 && capturedText.length > 0)
            ? ttsResumeCharOffset / capturedText.length : 0;
    }
    ttsProxyResumeFrac = resumeFrac;
    ttsProxyCharOffset = charOffset;

    fullPageText = capturedText;
    ttsLastFullTextLen = capturedText.length;
    ttsCharRanges = capturedRanges;
    ttsAbsCharEnd = Math.floor(resumeFrac * capturedText.length);

    ttsProxyEndHandled = false;
    ttsProxyRecoverAttempts = 0;
    if (ttsProxyEndFallbackTimer != null) {
        clearTimeout(ttsProxyEndFallbackTimer);
        ttsProxyEndFallbackTimer = null;
    }

    var hlLast = 0;
    var prefetchNextDone = false;
    ttsAudioEl.ontimeupdate = function() {
        if (!isReading || ttsAudioEl.duration <= 0) return;
        var progress = ttsAudioEl.currentTime / ttsAudioEl.duration;
        if (!prefetchNextDone && progress >= TTS_PREFETCH_PROGRESS) {
            prefetchNextDone = true;
            prefetchNextPageForContinuous(capturedPage);
        }
        if (progress >= 0.985 && !ttsProxyEndHandled) {
            if (ttsProxyEndFallbackTimer != null) clearTimeout(ttsProxyEndFallbackTimer);
            ttsProxyEndFallbackTimer = setTimeout(function() {
                ttsProxyEndFallbackTimer = null;
                if (ttsProxyEndHandled || pageNum !== capturedPage || !ttsAudioEl) return;
                if (ttsAudioEl.ended) {
                    finalizeProxyPageEnd(capturedPage, capturedText);
                    return;
                }
                if (isProxyAudioActivelyPlaying()) return;
                if (proxyAudioStalledAtEnd()) finalizeProxyPageEnd(capturedPage, capturedText);
            }, isAppInBackground() ? 120 : 450);
        }
        var now = Date.now();
        if (now - hlLast < TTS_HIGHLIGHT_MS) return;
        hlLast = now;
        var charIdx = _ttsCharFromProgress(progress, capturedText);
        ttsAbsCharEnd = charIdx;
        updateHighlight(charIdx, 8);
    };

    function seekProxyToResumeFrac() {
        if (resumeFrac <= 0 || !ttsAudioEl || !(ttsAudioEl.duration > 0)) return;
        try {
            var t = resumeFrac * ttsAudioEl.duration;
            if (isFinite(t) && t > 0.05) ttsAudioEl.currentTime = t;
        } catch (e) {}
    }
    /* Para áudio fatiado (charOffset > 0): o áudio JÁ começa no ponto certo — não fazer seek.
       Para áudio completo com skipSeek: apenas retomar (play), sem seek.
       Para áudio completo sem skipSeek: seek para a posição de retomada. */
    if (!skipSeek && charOffset <= 0) {
        if (ttsAudioEl.readyState >= 1) seekProxyToResumeFrac();
        else {
            var seekMetaDone = false;
            ttsAudioEl.addEventListener('loadedmetadata', function onMeta() {
                if (seekMetaDone) return;
                seekMetaDone = true;
                seekProxyToResumeFrac();
            });
        }
    }

    ttsAudioEl.onplay = function() {
        _applyTtsPlaybackRate(ttsAudioEl);
        document.body.classList.remove('tts-paused');
        ttsProxyRecoverAttempts = 0;
        isReading = true;
        speakLock = false;
        updateTtsSeekButtonsVisible();
        setTtsButtonsState('playing');
        if ('mediaSession' in navigator) {
            try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
        }
    };

    ttsAudioEl.onpause = function() {
        if (ttsStopRequested || document.body.classList.contains('tts-paused')) return;
        setTimeout(function() {
            if (ttsStopRequested || document.body.classList.contains('tts-paused')) return;
            if (!isProxyAudioActivelyPlaying() && !ttsAudioEl.ended) tryRecoverProxyPlayback(capturedPage);
        }, 400);
    };

    ttsAudioEl.onwaiting = function() {
        if (ttsStopRequested || document.body.classList.contains('tts-paused')) return;
        tryRecoverProxyPlayback(capturedPage);
    };

    ttsAudioEl.onstalled = function() {
        if (ttsStopRequested || document.body.classList.contains('tts-paused')) return;
        tryRecoverProxyPlayback(capturedPage);
    };

    ttsAudioEl.onended = function() {
        finalizeProxyPageEnd(capturedPage, capturedText);
    };

    ttsAudioEl.onerror = function() {
        console.error('[TTS proxy] erro ao reproduzir áudio da URL:', url);
        stopTTS();
        if (getTtsEnginePreference() === 'proxy') {
            showTtsToast('Áudio da nuvem falhou. Verifique rede ou escolha Navegador nas definições.');
        } else {
            showTtsToast('Erro no áudio da nuvem.');
        }
    };

    startTtsProxyWatchdog(capturedPage, capturedText);

    _applyTtsPlaybackRate(ttsAudioEl);
    if (!autoPlay) return;
    var pp = ttsAudioEl.play();
    updateMediaSession(currentBookTitle, currentPageNum);
    if (pp && typeof pp.then === 'function') {
        pp.then(function() {
            syncTtsPlaybackUi(capturedPage);
            updateMediaSession(currentBookTitle, currentPageNum);
            if ('mediaSession' in navigator) {
                try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
            }
        }).catch(function(err) {
            console.warn('[TTS] play() bloqueado:', err);
            stopTTS();
            _audioUnlocked = false;
            showTtsToast('Toque em Ouvir novamente para iniciar.');
        });
    }
}

function tryResumePausedProxyTts() {
    if (ttsEngine !== 'proxy' || !ttsAudioEl || !ttsAudioEl.src) return false;
    if (ttsResumePageNum !== pageNum || ttsResumeCharOffset <= 0) return false;
    var text = ttsPageCache.pageNum === pageNum ? (ttsPageCache.text || '') : '';
    var ranges = ttsPageCache.ranges || [];
    if (!text.trim()) return false;
    if (ttsAudioEl.duration > 0 && ttsAudioEl.currentTime >= ttsAudioEl.duration - 0.2) return false;

    /* Se o áudio atual é fatiado (após um skip), não tentar retomar — deixar speakCurrentPage
       gerar novo áudio fatiado a partir de ttsResumeCharOffset (posição correta). */
    if (ttsProxyCharOffset > 0) return false;

    /* Áudio completo (pausa simples): retomar do ponto onde pausou sem nova requisição. */
    document.body.classList.remove('tts-paused');
    _bindProxyTtsPlayback(ttsAudioEl.src, text, ranges, pageNum, { skipSeek: true, charOffset: 0 });
    return true;
}

/* Reproduz a URL de streaming e gerencia todo o ciclo de vida do áudio */
function _playTtsUrl(url, capturedText, capturedRanges, capturedPage, charOffset) {
    if (!url) { showTtsToast('URL de áudio não disponível.'); return; }

    if (!ttsAudioEl) {
        ttsAudioEl = document.createElement('audio');
        ttsAudioEl.preload = 'auto';
        ttsAudioEl.setAttribute('playsinline', '');
        ttsAudioEl.setAttribute('webkit-playsinline', '');
        document.body.appendChild(ttsAudioEl);
    }

    if (ttsAudioEl.src !== url) {
        ttsAudioEl.src = url;
        try { ttsAudioEl.load(); } catch (e) {}
    }
    _applyTtsPlaybackRate(ttsAudioEl);

    document.body.classList.remove('tts-paused');
    isReading = true;
    ttsStopRequested = false;
    setTtsButtonsState('playing');
    _bindProxyTtsPlayback(url, capturedText, capturedRanges, capturedPage, { charOffset: charOffset || 0 });
}
