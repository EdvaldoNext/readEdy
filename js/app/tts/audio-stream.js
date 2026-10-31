/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/audio-stream
   URL de streaming do TTS, cache de áudio, pré-busca.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* ── Arquitetura TTS Streaming (sem Blob URL) ────────────── */
/* Constrói a URL GET do Edge Function para uso direto em <audio src>.
   Não usa fetch() nem Blob — o elemento <audio> faz o HTTP internamente. */
function _getTtsStreamUrl(text, voice, rate) {
    var MAX = 4000;
    var sendText = text.length > MAX ? text.slice(0, MAX) : text;
    var cfg = window.READERA_SUPABASE;
    var url = ttsProxyUrl
        + '?text='  + encodeURIComponent(sendText)
        + '&voice=' + encodeURIComponent(voice || 'pt-BR-FranciscaNeural')
        + '&rate='  + TTS_SERVER_RATE;
    /* Supabase exige apikey na URL quando <audio src> não envia cabeçalhos */
    if (cfg && cfg.anonKey) {
        url += '&apikey=' + encodeURIComponent(cfg.anonKey);
    }
    if (window.ReadEdyAuth && ReadEdyAuth.getAccessToken()) {
        url += '&access_token=' + encodeURIComponent(ReadEdyAuth.getAccessToken());
    }
    return url;
}

/* POST só para URLs acima de 6000 chars — streaming GET é mais rápido (começa sem esperar MP3 completo).
   6000 chars é seguro em Chrome, Firefox, Safari, SmartTVs WebKit modernas. */
function _ttsUrlTooLongForGet(text, voice, rate) {
    var probe = _getTtsStreamUrl(text, voice, rate);
    return probe.length > 6000;
}

var _ttsBlobUrlCache = null;

function _revokeTtsBlobUrl() {
    if (_ttsBlobUrlCache) {
        try { URL.revokeObjectURL(_ttsBlobUrlCache); } catch(e) {}
        _ttsBlobUrlCache = null;
    }
}

function _ttsSendText(text) {
    var MAX = 4000;
    return text.length > MAX ? text.slice(0, MAX) : text;
}

function _ttsCacheKey(pageNum, text, voice, rate) {
    var sendText = _ttsSendText(text);
    return String(pageNum) + '|' + (voice || 'pt-BR-FranciscaNeural') + '|' + String(TTS_SERVER_RATE)
        + '|' + sendText.length + '|' + sendText.slice(0, 80);
}

function invalidateTtsAudioCache() {
    ttsAudioCache = { pageNum: null, url: null, ready: false, error: false, key: null };
    ttsFetchInflight = null;
}

function _ensureMainTtsAudioEl() {
    if (!ttsAudioEl) {
        ttsAudioEl = document.createElement('audio');
        ttsAudioEl.preload = 'auto';
        ttsAudioEl.setAttribute('playsinline', '');
        ttsAudioEl.setAttribute('webkit-playsinline', '');
        document.body.appendChild(ttsAudioEl);
    }
    return ttsAudioEl;
}

function _warmTtsUrlInBackground(url) {
    if (!url) return;
    if (!ttsPrefetchAudioEl) {
        ttsPrefetchAudioEl = document.createElement('audio');
        ttsPrefetchAudioEl.preload = 'auto';
        ttsPrefetchAudioEl.setAttribute('playsinline', '');
        ttsPrefetchAudioEl.setAttribute('webkit-playsinline', '');
        ttsPrefetchAudioEl.style.position = 'absolute';
        ttsPrefetchAudioEl.style.width = '0';
        ttsPrefetchAudioEl.style.height = '0';
        ttsPrefetchAudioEl.style.opacity = '0';
        ttsPrefetchAudioEl.style.pointerEvents = 'none';
        document.body.appendChild(ttsPrefetchAudioEl);
    }
    if (ttsPrefetchAudioEl.src !== url) {
        ttsPrefetchAudioEl.src = url;
        try { ttsPrefetchAudioEl.load(); } catch (e) {}
    }
}

function _flushTtsFetchInflight(err, url, pageNum, key) {
    var batch = ttsFetchInflight;
    ttsFetchInflight = null;
    if (!batch) return;
    if (err) {
        if (batch.showBar) hideStatusBar(false);
        batch.callbacks.forEach(function(cb) { if (cb.onErr) cb.onErr(err); });
        return;
    }
    if (batch.showBar) hideStatusBar(true);
    ttsAudioCache = { pageNum: pageNum, url: url, ready: true, error: false, key: key };
    batch.callbacks.forEach(function(cb) { if (cb.onOk) cb.onOk(url); });
}

function _fetchTtsAudioUrl(text, voice, rate, onOk, onErr, targetPage, showBar) {
    var num = (targetPage != null && targetPage > 0) ? (targetPage | 0) : pageNum;
    var key = _ttsCacheKey(num, text, voice, rate);

    if (ttsAudioCache.pageNum === num && ttsAudioCache.ready && ttsAudioCache.url && ttsAudioCache.key === key) {
        onOk(ttsAudioCache.url);
        return;
    }

    if (ttsFetchInflight && ttsFetchInflight.key === key) {
        ttsFetchInflight.callbacks.push({ onOk: onOk, onErr: onErr });
        return;
    }

    if (!_ttsUrlTooLongForGet(text, voice, rate)) {
        var streamUrl = _getTtsStreamUrl(text, voice, rate);
        ttsAudioCache = { pageNum: num, url: streamUrl, ready: true, error: false, key: key };
        onOk(streamUrl);
        return;
    }

    var cfg = window.READERA_SUPABASE;
    if (!ttsProxyUrl || !cfg || !cfg.anonKey) {
        onErr('Proxy TTS não configurado.');
        return;
    }
    if (!window.ReadEdyAuth || !ReadEdyAuth.getAccessToken()) {
        onErr('Faça login para usar TTS na nuvem.');
        return;
    }

    ttsFetchInflight = { key: key, pageNum: num, callbacks: [{ onOk: onOk, onErr: onErr }], showBar: !!showBar };
    if (showBar) showStatusBar('tts');
    var sendText = _ttsSendText(text);
    var postHeaders = ReadEdyAuth.authHeaders();
    postHeaders['Content-Type'] = 'application/json';
    fetch(ttsProxyUrl, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({
            text: sendText,
            voice: voice || 'pt-BR-FranciscaNeural',
            rate: TTS_SERVER_RATE
        })
    }).then(function(resp) {
        if (!resp.ok) {
            return resp.text().then(function(t) {
                throw new Error('TTS HTTP ' + resp.status + (t ? ': ' + t.slice(0, 120) : ''));
            });
        }
        return resp.blob();
    }).then(function(blob) {
        if (!blob || blob.size < 80) throw new Error('TTS: áudio vazio');
        _revokeTtsBlobUrl();
        _ttsBlobUrlCache = URL.createObjectURL(blob);
        _flushTtsFetchInflight(null, _ttsBlobUrlCache, num, key);
    }).catch(function(e) {
        var msg = e && e.message ? e.message : String(e);
        _flushTtsFetchInflight(msg, null, num, key);
    });
}

/* Pré-busca: grava URL em cache; não interrompe áudio da página em reprodução. */
function preFetchTtsAudio(num, text) {
    if (ttsEngine !== 'proxy' || !ttsProxyUrl || !text || !text.trim()) return;
    var voice = voiceSelect ? voiceSelect.value : 'pt-BR-FranciscaNeural';
    var rate  = Number(rateRange.value);
    var key = _ttsCacheKey(num, text, voice, rate);

    if (ttsAudioCache.pageNum === num && ttsAudioCache.ready && ttsAudioCache.key === key && ttsAudioCache.url) {
        return;
    }

    if (_ttsUrlTooLongForGet(text, voice, rate)) {
        _fetchTtsAudioUrl(text, voice, rate, function() {}, function() {}, num);
        return;
    }

    var url = _getTtsStreamUrl(text, voice, rate);
    ttsAudioCache = { pageNum: num, url: url, ready: true, error: false, key: key };

    var playbackOnThisPage = isReading && ttsAudioEl && !ttsAudioEl.paused && pageNum === num;
    if (playbackOnThisPage) {
        return;
    }

    if (isReading && pageNum !== num) {
        _warmTtsUrlInBackground(url);
        return;
    }

    var el = _ensureMainTtsAudioEl();
    if (el.src !== url) {
        el.src = url;
        try { el.load(); } catch (e) {}
    }
    _applyTtsPlaybackRate(el);
}
