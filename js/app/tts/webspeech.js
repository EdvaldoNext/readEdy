/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/webspeech
   Voz do navegador (Web Speech API): vozes disponíveis e execução da leitura.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* ── WebSpeech (fallback) ─────────────────────────────────── */
function voiceKey(v) { return v.voiceURI || v.name + '|' + v.lang; }

function _initWebSpeechVoices() {
    _populateWebSpeechVoices();
    if (_wsSynth) _wsSynth.onvoiceschanged = _populateWebSpeechVoices;
}

function _populateWebSpeechVoices() {
    if (!_wsSynth || !voiceSelect) return;
    var voices = _wsSynth.getVoices().filter(function(v) { return v.lang; });
    var prev = voiceSelect.value;
    voiceSelect.innerHTML = '';
    voices.forEach(function(v) {
        var opt = document.createElement('option');
        opt.value = voiceKey(v);
        opt.textContent = (v.name || 'Voz') + ' (' + v.lang + ')';
        voiceSelect.appendChild(opt);
    });
    var optArr = Array.prototype.slice.call(voiceSelect.options);
    var keyMap = {};
    optArr.forEach(function(o) { keyMap[o.value] = true; });
    var saved = safeStorage.getItem('readera-voice-key');
    if (saved && keyMap[saved]) voiceSelect.value = saved;
    else if (prev && keyMap[prev]) voiceSelect.value = prev;
    else {
        var pt = voices.filter(function(v) { return /^pt/i.test(v.lang); })[0];
        if (pt) voiceSelect.value = voiceKey(pt);
    }
}

function _getSelectedWebSpeechVoice() {
    if (!_wsSynth) return null;
    var voices = _wsSynth.getVoices().filter(function(v) { return v.lang; });
    var val = voiceSelect ? voiceSelect.value : '';
    return voices.filter(function(v) { return voiceKey(v) === val; })[0] || voices[0];
}

/* ── WebSpeech (Nível 2 / fallback) ─────────────────────── */
function _executeSpeechWebSpeech(text, ranges) {
    if (!_wsSynth) return;
    if (speakLock && currentUtterance) return;
    speakLock = true;
    ttsStopRequested = false;
    var btn = document.getElementById('btn-tts');

    if (!text || !text.trim()) {
        speakLock = false;
        setTtsButtonsState('idle');
        var contEl0 = document.getElementById('continuous-read');
        var isCont0 = contEl0 && contEl0.checked;
        var hasNext0 = pdfDoc && pageNum < pdfDoc.numPages;
        if (isCont0 && hasNext0) {
            showTtsToast('Página sem texto — avançando...');
            ttsAfterPagePlaybackFinished(pageNum);
        } else {
            showTtsToast('Esta página não tem texto legível.');
        }
        return;
    }

    ttsLastFullTextLen = text.length;
    var resumeFrom = 0;
    if (ttsResumePageNum === pageNum && ttsResumeCharOffset > 0 && ttsResumeCharOffset < text.length) resumeFrom = ttsResumeCharOffset;
    var speakText = text.slice(resumeFrom);
    if (!speakText.trim()) {
        resetTtsBookmark(); speakLock = false;
        setTtsButtonsState('idle');
        updateTtsButtonLabel(); return;
    }

    var utteranceCharOffset = resumeFrom;
    ttsAbsCharEnd = resumeFrom;
    ttsCharRanges = ranges;
    fullPageText = text;
    var utterance = new SpeechSynthesisUtterance(speakText);
    var utteranceStarted = false;
    currentUtterance = utterance;
    var voice = _getSelectedWebSpeechVoice();
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang || 'pt-BR'; }
    else { utterance.lang = 'pt-BR'; }
    utterance.rate = Number(rateRange.value);

    utterance.onstart = function() {
        if (currentUtterance !== utterance) return;
        _clearTtsWatchdog(); utteranceStarted = true;
        document.body.classList.remove('tts-paused');
        ttsAbsCharEnd = utteranceCharOffset; isReading = true; speakLock = false;
        if (utteranceCharOffset > 0) updateHighlight(utteranceCharOffset, 8);
        setTtsButtonsState('playing');
    };
    utterance.onboundary = function(ev) {
        if (currentUtterance !== utterance) return;
        if (!ev || ev.charIndex == null) return;
        var cl = (ev.charLength != null && ev.charLength > 0) ? ev.charLength : 1;
        ttsAbsCharEnd = utteranceCharOffset + ev.charIndex + cl;
        updateHighlight(utteranceCharOffset + ev.charIndex, cl);
    };
    utterance.onend = function() {
        if (currentUtterance !== utterance) return;
        _clearTtsWatchdog();
        if (!utteranceStarted) {
            isReading = false; currentUtterance = null; speakLock = false;
            setTtsButtonsState('idle');
            updateTtsButtonLabel();
            showTtsToast('Toque em Ouvir para iniciar (requer interação com a página).');
            return;
        }
        var contEl = document.getElementById('continuous-read');
        var continuous = contEl && contEl.checked;
        var hasNext = pageNum < pdfDoc.numPages;
        isReading = false; currentUtterance = null;
        ttsAbsCharEnd = text.length;
        if (ttsRepeatPage) {
            resetTtsBookmark(); speakLock = false;
            setTtsButtonsState('idle');
            updateTtsButtonLabel();
            setTimeout(function() {
                if (ttsRepeatPage && pdfDoc && !isReading && !speakLock) speakCurrentPage();
            }, 350);
        } else if (continuous && hasNext) {
            setTtsButtonsState('idle');
            ttsAfterPagePlaybackFinished(pageNum);
        } else {
            resetTtsBookmark(); speakLock = false;
            setTtsButtonsState('idle');
            updateTtsButtonLabel();
        }
    };
    utterance.onerror = function(ev) {
        _clearTtsWatchdog();
        var code = (ev && ev.error) ? String(ev.error).toLowerCase() : '';
        var isSilent = code === 'interrupted' || code === 'canceled' || code === 'cancelled';
        if (isSilent && utteranceStarted) return;
        if (!isSilent) console.warn('TTS WebSpeech onerror:', ev.error);
        stopTTS();
        if (code === 'not-allowed') showTtsToast('Leitura bloqueada pelo browser. Toque em Ouvir para tentar novamente.');
    };

    try { if (_wsSynth.paused) _wsSynth.resume(); } catch(e) {}
    _clearTtsWatchdog();
    ttsWatchdogTimer = setTimeout(function() {
        ttsWatchdogTimer = null;
        if (currentUtterance === utterance && !utteranceStarted) {
            console.warn('TTS watchdog: onstart nunca disparou.');
            stopTTS();
            showTtsToast('Toque em Ouvir para iniciar (requer interação com a página).');
        }
    }, 3000);
    try { _wsSynth.speak(utterance); } catch(e) {
        console.error('[WebSpeech] speak() falhou:', e);
        stopTTS();
    }
}
