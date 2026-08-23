/* ═══════════════════════════════════════════════════════════════
   TELEMETRIA DE ERROS — intercepta erros silenciosos na TV
   ══════════════════════════════════════════════════════════════ */
window.onerror = function(message, source, lineno, colno, error) {
    console.error('TV_DEBUG_ERROR:', message, 'Linha:', lineno, 'Col:', colno);
    if (typeof showTtsToast === 'function') {
        showTtsToast('Erro: ' + String(message).slice(0, 80) + ' (L:' + lineno + ')');
    }
    return false;
};

/* ═══════════════════════════════════════════════════════════════
   POLYFILLS ES5 — garantem compatibilidade com Chrome antigo
   ══════════════════════════════════════════════════════════════ */
if (!Math.hypot) {
    Math.hypot = function() {
        var sum = 0;
        for (var i = 0; i < arguments.length; i++) { sum += arguments[i] * arguments[i]; }
        return Math.sqrt(sum);
    };
}
if (!Object.values) {
    Object.values = function(obj) {
        return Object.keys(obj).map(function(k) { return obj[k]; });
    };
}
if (!Number.isFinite) {
    Number.isFinite = function(v) { return typeof v === 'number' && isFinite(v); };
}
if (!Array.from) {
    Array.from = function(arrayLike) { return Array.prototype.slice.call(arrayLike); };
}

/* ═══════════════════════════════════════════════════════════════
   POLYFILL: fetch (TVs com WebKit antigo que não têm fetch)
   ══════════════════════════════════════════════════════════════ */
if (typeof window.fetch === 'undefined') {
    window.fetch = function(url, opts) {
        return new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            var method = (opts && opts.method) || 'GET';
            xhr.open(method, url, true);
            var headers = (opts && opts.headers) || {};
            if (headers && typeof headers === 'object') {
                Object.keys(headers).forEach(function(k) { xhr.setRequestHeader(k, headers[k]); });
            }
            xhr.responseType = 'arraybuffer';
            xhr.onload = function() {
                var ab = xhr.response;
                var decode = function() { try { return new TextDecoder().decode(new Uint8Array(ab)); } catch(e) { return ''; } };
                resolve({
                    ok: xhr.status >= 200 && xhr.status < 300,
                    status: xhr.status,
                    headers: { get: function(k) { return xhr.getResponseHeader(k); } },
                    arrayBuffer: function() { return Promise.resolve(ab); },
                    json: function() { return Promise.resolve(JSON.parse(decode())); },
                    text: function() { return Promise.resolve(decode()); },
                    blob: function() { return Promise.resolve(new Blob([ab])); }
                });
            };
            xhr.onerror = function() { reject(new Error('Erro de rede')); };
            xhr.send((opts && opts.body) || null);
        });
    };
}

/* ═══════════════════════════════════════════════════════════════
   XHR HELPERS — usados para download de PDFs da nuvem.
   Mais compatível com TVs que têm restrições CORS no fetch nativo.
   ══════════════════════════════════════════════════════════════ */
function _xhrRequest(method, url, headers, body, responseType, timeoutMs) {
    return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        if (responseType) xhr.responseType = responseType;
        if (headers) {
            Object.keys(headers).forEach(function(k) { try { xhr.setRequestHeader(k, headers[k]); } catch(e) {} });
        }
        xhr.timeout = timeoutMs || 30000;
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.response); }
            else { reject(new Error('HTTP ' + xhr.status)); }
        };
        xhr.onerror   = function() { reject(new Error('Erro de rede (XHR)')); };
        xhr.ontimeout = function() { reject(new Error('Timeout ao baixar')); };
        xhr.send(body || null);
    });
}
function _createSignedUrlXhr(bucket, storagePath, expiresIn) {
    var cfg = window.READERA_SUPABASE || {};
    var baseUrl = (cfg.url || '').replace(/\/$/, '');
    var endpoint = baseUrl + '/storage/v1/object/sign/' + bucket + '/' + storagePath;
    return _xhrRequest('POST', endpoint,
        { 'Authorization': 'Bearer ' + cfg.anonKey, 'apikey': cfg.anonKey, 'Content-Type': 'application/json' },
        JSON.stringify({ expiresIn: expiresIn || 300 }),
        '' /* text */
    ).then(function(text) {
        var obj = JSON.parse(text);
        var signed = obj.signedURL || obj.signedUrl || obj.signed_url || '';
        if (!signed) throw new Error('URL assinada vazia na resposta');
        return signed.startsWith('/') ? baseUrl + signed : signed;
    });
}
function _downloadArrayBufferXhr(url, timeoutMs, headers) {
    return _xhrRequest('GET', url, headers || {}, null, 'arraybuffer', timeoutMs || 120000);
}
function _downloadArrayBufferFetch(url, headers) {
    if (typeof fetch === 'undefined') {
        return Promise.reject(new Error('fetch indisponível'));
    }
    var opts = { method: 'GET', credentials: 'omit' };
    if (headers) opts.headers = headers;
    return fetch(url, opts).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
    });
}
function _blobToArrayBuffer(blob) {
    if (!blob) return Promise.reject(new Error('Arquivo PDF vazio'));
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function(resolve, reject) {
        var fr = new FileReader();
        fr.onload = function() { resolve(fr.result); };
        fr.onerror = function() { reject(new Error('Erro ao ler PDF')); };
        fr.readAsArrayBuffer(blob);
    });
}
function _storagePdfApiUrl(storagePath, isPublic) {
    var cfg = window.READERA_SUPABASE || {};
    var baseUrl = (cfg.url || '').replace(/\/$/, '');
    var encoded = String(storagePath || '').split('/').map(function(seg) {
        return encodeURIComponent(seg);
    }).join('/');
    if (isPublic) {
        return baseUrl + '/storage/v1/object/public/pdfs/' + encoded;
    }
    return baseUrl + '/storage/v1/object/pdfs/' + encoded;
}
function _supabaseAuthHeaders() {
    var cfg = window.READERA_SUPABASE || {};
    return { 'Authorization': 'Bearer ' + (cfg.anonKey || ''), 'apikey': cfg.anonKey || '' };
}

/* ═══════════════════════════════════════════════════════════════
   SAFE STORAGE: localStorage → sessionStorage → memória (TV safe)
   ══════════════════════════════════════════════════════════════ */
var safeStorage = (function() {
    var _mem = Object.create(null);
    var _backends = [];
    ['localStorage', 'sessionStorage'].forEach(function(name) {
        try {
            var s = window[name];
            if (!s) return;
            s.setItem('__readera_probe__', '1');
            s.removeItem('__readera_probe__');
            _backends.push(s);
        } catch (e) {}
    });
    return {
        getItem: function(k) {
            for (var i = 0; i < _backends.length; i++) {
                try { var v = _backends[i].getItem(k); if (v !== null) return v; } catch(e) {}
            }
            return (k in _mem) ? _mem[k] : null;
        },
        setItem: function(k, v) {
            _mem[k] = String(v);
            for (var i = 0; i < _backends.length; i++) { try { _backends[i].setItem(k, String(v)); } catch(e) {} }
        },
        removeItem: function(k) {
            delete _mem[k];
            for (var i = 0; i < _backends.length; i++) { try { _backends[i].removeItem(k); } catch(e) {} }
        }
    };
})();

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

    var pdfjsLib = window['pdfjs-dist/build/pdf'];
    if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.min.js';
    }

    /* Polyfill: crypto.randomUUID() não existe em Firefox<92, Safari<15.4 nem em HTTP */
    function generateUUID() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = (typeof crypto !== 'undefined' && crypto.getRandomValues)
                ? (crypto.getRandomValues(new Uint8Array(1))[0] & 15)
                : Math.floor(Math.random() * 16);
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    var pdfDoc = null, pageNum = 1, isRendering = false, isReading = false;
    var currentUtterance = null;
    var fullPageText = '';
    var speakLock = false;
    var ttsStopRequested = false;

    /* ── Motor TTS ──────────────────────────────────────────────── */
    var ttsEngine   = null;    /* 'proxy' | 'webspeech' | null */
    var ttsProxyUrl = null;    /* URL do Edge Function */
    var ttsAudioEl  = null;    /* <audio> reutilizável (engine proxy) */
    /* ttsAudioCache: guarda a URL de streaming já configurada no elemento */
    var ttsAudioCache = { pageNum: null, url: null, ready: false, error: false, key: null };
    var ttsPrefetchAudioEl = null;
    var ttsFetchInflight = null;
    var TTS_PREFETCH_PROGRESS = 0.45;
    var _audioUnlocked  = false; /* true após unlock por gesto do utilizador */
    var _wsSynth = typeof window.speechSynthesis !== 'undefined' ? window.speechSynthesis : null;
    var readeraSb = null;
    var pdfCacheBytes = null;
    var cloudDocumentId = null;
    var lastOpenedFileName = '';
    var currentBookTitle = '';
    var currentPageNum = 1;
    var progressSaveTimer = null;
    var cloudUiBound = false;
    var cloudSyncInFlight = false;
    var cloudLibraryCount = 0;
    var cloudLibraryPanelOpen = false;
    var cloudLibrarySuppressClose = false;
    var cloudLibraryRows = [];
    var _coverMem = {};
    var _coverQueue = [];
    var _coverInflight = 0;
    var COVER_MAX_INFLIGHT = 2;
    var LS_COVER_PREFIX = 'readera-cover-v1:';
    var homeFeaturedDocId = null;
    var homeFeaturedIsOpen = false;
    var homeActiveTab = 'inicio';
    var homeSearchQuery = '';
    var libraryViewMode = 'all';
    var LS_TRASH = 'readera-trash-v1';
    var LIBRARY_RECENT_DAYS = 30;
    var statsSelectedBookId = null;
    var LS_FAVORITES = 'readera-favorites-v1';
    var LS_NOTES = 'readera-notes-v1';
    var _noteEditId = null;
    var LS_STATS_TTS_SECONDS = 'readera-stats-tts-seconds';
    var LS_STATS_TTS_BOOK_PREFIX = 'readera-stats-tts-book:';
    var _statsTtsTickAt = null;
    var _statsTtsBookId = null;
    /* homeView: com um PDF carregado, indica se o shell mostra a Home
       (Continue ouvindo / Biblioteca / Conta) em vez da área de leitura. */
    var homeView = false;
    var LS_AUTO_CLOUD = 'readera-auto-cloud';
    var LS_TTS_ENGINE = 'readera-tts-engine';
    var DEFAULT_TTS_ENGINE = 'proxy';
    var LS_RESUME_CLOUD = 'readera-resume-cloud';
    var LS_LAST_CLOUD_DOC = 'readera_last_cloud_doc_id';
    var LS_PDF_ZOOM = 'readera-pdf-zoom';
    var PDF_ZOOM_MIN = 1.0;
    var PDF_ZOOM_MAX = 2.5;
    var PDF_ZOOM_STEP = 0.2;
    var pdfZoom = (function() {
        var v = parseFloat(safeStorage.getItem(LS_PDF_ZOOM));
        return (isNaN(v) || v < PDF_ZOOM_MIN || v > PDF_ZOOM_MAX) ? 1.0 : v;
    }());
    var ttsCharRanges = [];
    var ttsPageCache = { pageNum: null, text: '', ranges: [] };
    var ocrPageCache = {};          /* { pageNum: text } — cache OCR por página */
    var _tesseractWorker = null;
    var _tesseractLoading = false;
    var _tesseractReady  = false;
    var _tesseractCallbacks = [];
    var ttsWatchdogTimer = null;
    var pdfTextLayerSpans = null;
    var ttsResumeCharOffset = 0;
    var ttsResumePageNum = null;
    var ttsLastFullTextLen = 0;
    var ttsAbsCharEnd = 0;
    var ttsScrollHighlightRaf = null;
    var ttsProxyResumeFrac = 0;
    var ttsProxyCharOffset = 0;   /* chars do texto completo antes do início do áudio atual */
    var TTS_SKIP_SECONDS = 15;
    var TTS_HIGHLIGHT_MS = 110;
    var ttsPdfHighlightLast = { start: -1, end: -1 };
    var ttsNextPageCache = { pageNum: null, text: '', ranges: [] };
    var ttsPendingRenderPage = null;
    var ttsContinuousAdvanceLock = false;
    var ttsProxyEndHandled = false;
    var ttsProxyEndFallbackTimer = null;
    var ttsProxyWatchInterval = null;
    var ttsProxyWatchCapturedPage = null;
    var ttsProxyRecoverAttempts = 0;
    var TTS_PROXY_STALL_MS = 9000;
    var TTS_PROXY_MAX_RECOVER = 5;
    var cloudLoadGen = 0;
    var renderGen = 0;
    var pdfLoadingTask = null;
    var _pendingPageJump = null;   /* salto enfileirado enquanto renderização está em curso */
    var _renderingWatchdog = null; /* timer de segurança para resetar isRendering em TVs lentas */
    var _pageJumpDraft = '';       /* rascunho do número — teclado virtual da TV nem sempre grava em .value */
    var _pageJumpInputFocused = false;

    var fileInput = document.getElementById('file-input');
    var loading = document.getElementById('loading');

    /* ── Barra de progresso (status bar) ───────────────────── */
    var _rdrSbRaf = null;
    var _rdrSbHideTimer = null;
    var _rdrSbTickStart = 0;

    function showStatusBar(kind) {
        clearTimeout(_rdrSbHideTimer);
        if (_rdrSbRaf) { cancelAnimationFrame(_rdrSbRaf); _rdrSbRaf = null; }
        var bar = document.getElementById('rdr-status-bar');
        var fill = document.getElementById('rdr-status-fill');
        if (!bar || !fill) return;
        bar.className = 'sb-' + (kind || 'pdf') + ' sb-active';
        fill.style.width = '0%';
        _rdrSbTickStart = Date.now();
        _rdrSbSimTick();
    }

    function _rdrSbSimTick() {
        var fill = document.getElementById('rdr-status-fill');
        if (!fill) return;
        var elapsed = Date.now() - _rdrSbTickStart;
        /* Rápido até 70% em 3s, depois desacelera logaritmicamente até máx 90% */
        var p = elapsed < 3000
            ? (elapsed / 3000) * 0.70
            : 0.70 + (1 - Math.exp(-(elapsed - 3000) / 10000)) * 0.20;
        fill.style.width = Math.min(p * 100, 90) + '%';
        _rdrSbRaf = requestAnimationFrame(_rdrSbSimTick);
    }

    function hideStatusBar(success) {
        if (_rdrSbRaf) { cancelAnimationFrame(_rdrSbRaf); _rdrSbRaf = null; }
        var bar = document.getElementById('rdr-status-bar');
        var fill = document.getElementById('rdr-status-fill');
        if (!bar || !fill) return;
        if (success !== false) {
            fill.style.width = '100%';
            _rdrSbHideTimer = setTimeout(function() { bar.classList.remove('sb-active'); }, 420);
        } else {
            bar.classList.remove('sb-active');
        }
    }

    /* Aceita 3.º parâmetro opcional 'kind' para a cor da barra: 'pdf' | 'tts' | 'upload' */
    function setAppLoading(show, message, kind) {
        if (!loading) return;
        if (message) loading.textContent = message;
        else if (!show) loading.textContent = 'Carregando PDF...';
        if (show) {
            loading.classList.remove('hidden');
            showStatusBar(kind || 'pdf');
        } else {
            loading.classList.add('hidden');
            hideStatusBar();
        }
    }

    function abortPdfLoadingTask() {
        if (pdfLoadingTask && pdfLoadingTask.destroy) {
            try { pdfLoadingTask.destroy(); } catch (e) {}
        }
        pdfLoadingTask = null;
    }

    function teardownCurrentPdf() {
        renderGen++;
        isRendering = false;
        abortPdfLoadingTask();
        stopTTS({ resetBookmark: true });
        invalidateTtsAudioCache();
        ttsNextPageCache = { pageNum: null, text: '', ranges: [] };
        if (pdfDoc && pdfDoc.destroy) {
            try { pdfDoc.destroy(); } catch (e) {}
        }
        pdfDoc = null;
        pdfTextLayerSpans = null;
        ttsPageCache = { pageNum: null, text: '', ranges: [] };
        ocrPageCache = {};
    }
    var voiceSelect = document.getElementById('voice-select');
    var rateRange = document.getElementById('rate-range');
    var rateLabel = document.getElementById('rate-label');
    var MINI_ICON_PLAY  = '<svg class="ico ico-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    var MINI_ICON_PAUSE = '<svg class="ico ico-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
    var ICON_SUN  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
    var ICON_MOON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

    function isPdfThemeDark() {
        return document.body.classList.contains('dark');
    }

    function applyTheme(dark) {
        if (dark) document.body.classList.add('dark');
        else document.body.classList.remove('dark');
        safeStorage.setItem('readera-theme', dark ? 'dark' : 'light');
        var icon = dark ? ICON_SUN : ICON_MOON;
        var title = dark
            ? 'Cores invertidas — toque para voltar ao normal'
            : 'Inverter cores da página do PDF';
        ['btn-theme', 'btn-theme-reader'].forEach(function(id) {
            var themeBtn = document.getElementById(id);
            if (!themeBtn) return;
            themeBtn.innerHTML = icon;
            themeBtn.title = title;
            themeBtn.setAttribute('aria-label', title);
            themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
            if (dark) themeBtn.classList.add('is-active');
            else themeBtn.classList.remove('is-active');
        });
    }

    function togglePdfTheme() {
        applyTheme(!isPdfThemeDark());
        schedulePushUserPreferences();
        if (typeof showTtsToast === 'function') {
            showTtsToast(isPdfThemeDark() ? 'Cores do PDF invertidas' : 'Cores normais do PDF');
        }
    }

    function wireThemeButtons() {
        ['btn-theme', 'btn-theme-reader'].forEach(function(id) {
            var btn = document.getElementById(id);
            if (!btn || btn._themeBound) return;
            btn._themeBound = true;
            btn.addEventListener('click', togglePdfTheme);
        });
        var homeBtn = document.getElementById('home-btn-theme');
        if (homeBtn && !homeBtn._themeBound) {
            homeBtn._themeBound = true;
            homeBtn.addEventListener('click', togglePdfTheme);
        }
    }

    function setCloudBadge(state, title) {
        var badge = document.getElementById('cloud-badge');
        if (!badge) return;
        var states = ['on', 'off', 'wait', 'pending', 'error'];
        for (var i = 0; i < states.length; i++) {
            badge.classList.remove('cloud-status-' + states[i]);
        }
        badge.classList.add('cloud-status-' + (state || 'wait'));
        if (title) {
            badge.title = title;
            badge.setAttribute('aria-label', title);
        }
        var accountStatus = document.getElementById('home-account-cloud-status');
        if (accountStatus && title) accountStatus.textContent = title;
    }
    wireThemeButtons();
    applyTheme(safeStorage.getItem('readera-theme') === 'dark');

    /* ══════════════════════════════════════════════════════════════
       MOTOR TTS — 3 NÍVEIS
       Nível 1 (proxy):    Supabase Edge Function → Microsoft Edge TTS → MP3
       Nível 2 (webspeech): Web Speech API (voz do dispositivo)
       Nível 3 (null):     TTS desativado (TV sem suporte)
       ══════════════════════════════════════════════════════════════ */

    const EDGE_TTS_VOICES = [
        { key: 'pt-BR-FranciscaNeural', label: 'Francisca – pt-BR (Neural)' },
        { key: 'pt-BR-AntonioNeural',   label: 'Antonio – pt-BR (Neural)'   },
        { key: 'pt-PT-RaquelNeural',    label: 'Raquel – pt-PT (Neural)'    },
        { key: 'pt-PT-DuarteNeural',    label: 'Duarte – pt-PT (Neural)'    },
        { key: 'en-US-JennyNeural',     label: 'Jenny – en-US (Neural)'     },
        { key: 'en-US-GuyNeural',       label: 'Guy – en-US (Neural)'       },
        { key: 'es-ES-ElviraNeural',    label: 'Elvira – es-ES (Neural)'    },
        { key: 'fr-FR-DeniseNeural',    label: 'Denise – fr-FR (Neural)'    },
        { key: 'de-DE-KatjaNeural',     label: 'Katja – de-DE (Neural)'     },
        { key: 'it-IT-ElsaNeural',      label: 'Elsa – it-IT (Neural)'      },
    ];

    /* ── Audio Unlock (TV / iOS / Mobile) ───────────────────────
       TVs exigem que audio.play() tenha sido chamado dentro de um
       gesto do utilizador.  Esta função cria um silêncio de 0.1 s
       e "desbloqueia" o elemento <audio> na primeira interação.
       Depois disso, todos os play() seguintes funcionam livremente.
       ──────────────────────────────────────────────────────────── */
    function _createSilentBlobUrl() {
        /* WAV mínimo: 0.1 s, mono, 8 kHz, 8-bit unsigned PCM */
        const RATE = 8000, N = 800;
        const buf = new ArrayBuffer(44 + N);
        const v   = new DataView(buf);
        var ws = function(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        ws(0,  'RIFF'); v.setUint32(4,  36 + N, true); ws(8, 'WAVE');
        ws(12, 'fmt '); v.setUint32(16, 16,     true); v.setUint16(20, 1,     true);
        v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE, true);
        v.setUint16(32, 1, true); v.setUint16(34, 8,    true);
        ws(36, 'data'); v.setUint32(40, N, true);
        for (let i = 44; i < 44 + N; i++) v.setUint8(i, 128); /* silêncio em PCM 8-bit */
        return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }

    function _unlockAudio() {
        if (_audioUnlocked) return;
        /* Desbloquear AudioContext (webkitAudioContext em TVs antigas) */
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                var ctx = new AC();
                if (ctx.resume) ctx.resume().catch(function() {});
                setTimeout(function() { try { ctx.close(); } catch(e) {} }, 1500);
            }
        } catch(e) {}
        /* Usar elemento TEMPORÁRIO separado para desbloquear play() */
        try {
            var tmp = document.createElement('audio');
            var silentUrl = null;
            try { silentUrl = _createSilentBlobUrl(); } catch(e) {}
            if (silentUrl) {
                tmp.src = silentUrl;
                tmp.volume = 0;
                var cleanup = function() {
                    try { tmp.pause(); tmp.src = ''; URL.revokeObjectURL(silentUrl); } catch(e) {}
                };
                var p = tmp.play();
                if (p && typeof p.then === 'function') {
                    p.then(function() { cleanup(); _audioUnlocked = true; console.log('[TTS] Áudio desbloqueado.'); })
                     .catch(function() { cleanup(); });
                } else {
                    cleanup(); _audioUnlocked = true;
                }
            } else {
                /* Fallback: sem blob, marcar como desbloqueado na esperança de o gesto bastar */
                _audioUnlocked = true;
            }
        } catch(e) { console.warn('[TTS unlock]', e); _audioUnlocked = true; }
    }

    /* Desbloquear na primeira interação com a página (qualquer clique) */
    document.addEventListener('click', function _firstClick() {
        _unlockAudio();
        document.removeEventListener('click', _firstClick);
    });

    function getTtsEnginePreference() {
        var p = safeStorage.getItem(LS_TTS_ENGINE);
        if (p === 'auto' || p == null || p === '') {
            safeStorage.setItem(LS_TTS_ENGINE, DEFAULT_TTS_ENGINE);
            return DEFAULT_TTS_ENGINE;
        }
        if (p === 'proxy' || p === 'webspeech') return p;
        safeStorage.setItem(LS_TTS_ENGINE, DEFAULT_TTS_ENGINE);
        return DEFAULT_TTS_ENGINE;
    }

    function resolveTtsEngine() {
        var pref = getTtsEnginePreference();
        if (pref === 'proxy') {
            if (ttsProxyUrl) return 'proxy';
            if (_wsSynth) return 'webspeech';
            return null;
        }
        if (pref === 'webspeech') {
            if (_wsSynth) return 'webspeech';
            return null;
        }
        return null;
    }

    function setTtsButtonsAvailability(enabled) {
        ['btn-tts', 'btn-tts-float'].forEach(function(id) {
            var b = document.getElementById(id);
            if (!b) return;
            if (enabled) {
                b.disabled = false;
                b.title = 'Ouvir em voz alta';
            } else {
                b.disabled = true;
                b.title = 'TTS não disponível neste dispositivo';
            }
        });
    }

    function updateTtsEngineHint() {
        var hint = document.getElementById('tts-engine-hint');
        if (!hint) return;
        var pref = getTtsEnginePreference();
        var active = ttsEngine;
        if (pref === 'proxy') {
            if (active === 'proxy') {
                hint.textContent = 'Backend (nuvem): vozes neurais via servidor. Recomendado na TV.';
            } else if (active === 'webspeech') {
                hint.textContent = 'Backend indisponível neste momento — a usar Navegador.';
            } else {
                hint.textContent = 'Backend não disponível (sem configuração da nuvem).';
            }
            return;
        }
        if (active === 'webspeech') {
            hint.textContent = 'Navegador: vozes instaladas no dispositivo. Pode variar entre TV e PC.';
        } else {
            hint.textContent = 'Navegador não disponível neste dispositivo.';
        }
    }

    function syncTtsEngineSelectUi() {
        var sel = document.getElementById('tts-engine-select');
        if (!sel) return;
        var pref = getTtsEnginePreference();
        sel.value = pref === 'webspeech' ? 'webspeech' : DEFAULT_TTS_ENGINE;
        var optProxy = sel.querySelector('option[value="proxy"]');
        var optWs = sel.querySelector('option[value="webspeech"]');
        if (optProxy) optProxy.disabled = !ttsProxyUrl;
        if (optWs) optWs.disabled = !_wsSynth;
        updateTtsEngineHint();
    }

    function applyTtsEngineFromPreference(opts) {
        opts = opts || {};
        var prev = ttsEngine;
        var resolved = resolveTtsEngine();
        ttsEngine = resolved;
        if (resolved === 'proxy') {
            setTtsButtonsAvailability(true);
            _populateEdgeVoices();
        } else if (resolved === 'webspeech') {
            setTtsButtonsAvailability(true);
            _initWebSpeechVoices();
        } else {
            setTtsButtonsAvailability(false);
        }
        syncTtsEngineSelectUi();
        if (opts.invalidateCache !== false && prev !== resolved) invalidateTtsAudioCache();
        return resolved;
    }

    /* Chamada após initSupabaseClient() determinar a config disponível */
    function initTtsEngine() {
        var cfg = window.READERA_SUPABASE;
        ttsProxyUrl = (cfg && cfg.url) ? (cfg.url + '/functions/v1/tts-proxy') : null;
        if (!safeStorage.getItem(LS_TTS_ENGINE)) {
            safeStorage.setItem(LS_TTS_ENGINE, DEFAULT_TTS_ENGINE);
        }
        applyTtsEngineFromPreference({ invalidateCache: false });
    }
    /* TTS não depende do cliente Supabase — só de config.example.js / config.js */
    initTtsEngine();

    /* Aquece o worker Deno da Edge Function para eliminar cold-start na primeira leitura.
       Chamado depois de um PDF abrir. Usa fetch silencioso (ignora erros). */
    var _ttsWarmUpDone = false;
    function warmUpTtsProxy() {
        if (_ttsWarmUpDone || ttsEngine !== 'proxy' || !ttsProxyUrl) return;
        var cfg = window.READERA_SUPABASE;
        if (!cfg || !cfg.anonKey) return;
        _ttsWarmUpDone = true;
        var url = ttsProxyUrl + '?text=.&voice=pt-BR-FranciscaNeural&rate=1'
            + '&apikey=' + encodeURIComponent(cfg.anonKey);
        fetch(url, { method: 'GET', credentials: 'omit' }).catch(function() {});
    }

    function _populateEdgeVoices() {
        if (!voiceSelect) return;
        var saved = safeStorage.getItem('readera-voice-key');
        voiceSelect.innerHTML = '';
        EDGE_TTS_VOICES.forEach(function(v) {
            var opt = document.createElement('option');
            opt.value = v.key; opt.textContent = v.label;
            voiceSelect.appendChild(opt);
        });
        if (saved) {
            var opts = Array.prototype.slice.call(voiceSelect.options);
            if (opts.some(function(o) { return o.value === saved; })) voiceSelect.value = saved;
        }
    }

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

    document.getElementById('continuous-read').addEventListener('change', schedulePushUserPreferences);
    var ttsEngineSelect = document.getElementById('tts-engine-select');
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

    /* Botões de velocidade — substituem o slider */
    var _rateBtns = document.querySelectorAll('#rate-btn-group .rate-btn');
    var _RATE_KEY = 'readera-speed';
    var _VALID_RATES = ['0.5', '0.8', '1.0', '1.5', '2.0'];

    function _applyRateBtn(val) {
        var target = String(parseFloat(val || 1).toFixed(1));
        /* corrigir "1" → "1.0" etc para o match */
        _rateBtns.forEach(function(b) {
            var bVal = String(parseFloat(b.dataset.rate).toFixed(1));
            var active = bVal === target;
            b.classList.toggle('rate-active', active);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (typeof updatePlayerSpeedLabel === 'function') updatePlayerSpeedLabel();
    }

    _rateBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var rate = btn.dataset.rate;
            rateRange.value = rate;
            safeStorage.setItem(_RATE_KEY, rate);
            invalidateTtsAudioCache();
            _applyRateBtn(rate);
        });
    });

    /* Carregar velocidade salva */
    var _savedRate = safeStorage.getItem(_RATE_KEY);
    if (_savedRate && _VALID_RATES.indexOf(_savedRate) !== -1) {
        rateRange.value = _savedRate;
    } else {
        rateRange.value = '1.0';
    }
    _applyRateBtn(rateRange.value);

    function _ttsRate() {
        var r = rateRange ? Number(rateRange.value) : 1;
        return (isFinite(r) && r > 0) ? r : 1;
    }

    /* ── OCR: carrega Tesseract.js sob demanda (lazy) ───────────── */
    function ensureTesseract() {
        return new Promise(function(resolve, reject) {
            if (_tesseractReady && _tesseractWorker) { resolve(_tesseractWorker); return; }
            if (_tesseractLoading) { _tesseractCallbacks.push({ resolve: resolve, reject: reject }); return; }
            _tesseractLoading = true;
            _tesseractCallbacks.push({ resolve: resolve, reject: reject });
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            s.onload = function() {
                if (typeof Tesseract === 'undefined') {
                    var err = new Error('Tesseract.js indefinido após carga');
                    _tesseractLoading = false;
                    _tesseractCallbacks.splice(0).forEach(function(cb) { cb.reject(err); });
                    return;
                }
                Tesseract.createWorker('por', 1, { logger: function() {} }).then(function(w) {
                    _tesseractWorker = w;
                    _tesseractReady  = true;
                    _tesseractLoading = false;
                    _tesseractCallbacks.splice(0).forEach(function(cb) { cb.resolve(w); });
                }).catch(function(err) {
                    _tesseractLoading = false;
                    _tesseractCallbacks.splice(0).forEach(function(cb) { cb.reject(err); });
                });
            };
            s.onerror = function() {
                _tesseractLoading = false;
                var err = new Error('Tesseract.js não carregou');
                _tesseractCallbacks.splice(0).forEach(function(cb) { cb.reject(err); });
            };
            document.head.appendChild(s);
        });
    }

    function runOcrOnPage(page, num) {
        if (ocrPageCache[num]) {
            return Promise.resolve({ text: ocrPageCache[num], ranges: [], fromOcr: true });
        }
        var scale = 2;
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        showTtsToast('PDF escaneado — reconhecendo texto…');
        return page.render({ canvasContext: ctx, viewport: viewport }).promise
            .then(function() { return ensureTesseract(); })
            .then(function(worker) { return worker.recognize(canvas); })
            .then(function(result) {
                var text = (result.data && result.data.text) ? result.data.text.trim() : '';
                ocrPageCache[num] = text;
                return { text: text, ranges: [], fromOcr: true };
            });
    }

    function ensureTtsPageCache(targetPage) {
        var num = (targetPage != null && targetPage > 0) ? (targetPage | 0) : pageNum;
        if (ttsPageCache.pageNum === num && (ttsPageCache.text || '').trim()) {
            return Promise.resolve(ttsPageCache);
        }
        if (!pdfDoc) return Promise.reject(new Error('Sem PDF aberto'));
        return pdfDoc.getPage(num).then(function(page) {
            return page.getTextContent().then(function(textContent) {
                var built = buildTtsTextAndRanges(textContent.items || []);
                if (built.text.trim()) {
                    ttsPageCache = { pageNum: num, text: built.text, ranges: built.ranges };
                    return ttsPageCache;
                }
                /* Sem texto digital — tentar OCR se ativado pelo utilizador */
                var ocrCb = document.getElementById('opt-ocr-scan');
                if (!ocrCb || !ocrCb.checked) {
                    ttsPageCache = { pageNum: num, text: '', ranges: [] };
                    return ttsPageCache;
                }
                return runOcrOnPage(page, num).then(function(ocr) {
                    ttsPageCache = { pageNum: num, text: ocr.text, ranges: [] };
                    if (ocr.text.trim()) {
                        showTtsToast('Texto reconhecido via OCR — pode ter imprecisões.');
                    }
                    return ttsPageCache;
                }).catch(function(err) {
                    console.error('[OCR]', err);
                    showTtsToast('OCR falhou nesta página.');
                    ttsPageCache = { pageNum: num, text: '', ranges: [] };
                    return ttsPageCache;
                });
            });
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
            + '&rate='  + (rate || 1.0);
        /* Supabase exige apikey na URL quando <audio src> não envia cabeçalhos */
        if (cfg && cfg.anonKey) {
            url += '&apikey=' + encodeURIComponent(cfg.anonKey);
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
        return String(pageNum) + '|' + (voice || 'pt-BR-FranciscaNeural') + '|' + String(rate || 1)
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

        ttsFetchInflight = { key: key, pageNum: num, callbacks: [{ onOk: onOk, onErr: onErr }], showBar: !!showBar };
        if (showBar) showStatusBar('tts');
        var sendText = _ttsSendText(text);
        fetch(ttsProxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.anonKey,
                'Authorization': 'Bearer ' + cfg.anonKey
            },
            body: JSON.stringify({
                text: sendText,
                voice: voice || 'pt-BR-FranciscaNeural',
                rate: rate || 1.0
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
        pdfDoc.getPage(next).then(function(page) { return page.getTextContent(); }).then(function(tc) {
            var built = buildTtsTextAndRanges(tc.items || []);
            ttsNextPageCache = { pageNum: next, text: built.text, ranges: built.ranges };
            if (built.text && built.text.trim()) preFetchTtsAudio(next, built.text);
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

        return pdfDoc.getPage(num).then(function(page) { return page.getTextContent(); }).then(function(textContent) {
            var built = buildTtsTextAndRanges(textContent.items || []);
            ttsPageCache = { pageNum: num, text: built.text, ranges: built.ranges };
            if (built.text && built.text.trim() && ttsEngine === 'proxy') preFetchTtsAudio(num, built.text);
        });
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
        ttsAfterPagePlaybackFinished(capturedPage);
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
                    var charP = Math.floor((ttsProxyResumeFrac + frac * (1 - ttsProxyResumeFrac)) * len);
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
            var charIdx = Math.floor((resumeFrac + progress * (1 - resumeFrac)) * capturedText.length);
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

        document.body.classList.remove('tts-paused');
        isReading = true;
        ttsStopRequested = false;
        setTtsButtonsState('playing');
        _bindProxyTtsPlayback(url, capturedText, capturedRanges, capturedPage, { charOffset: charOffset || 0 });
    }

    function buildTtsTextAndRanges(items) {
        let text = '';
        const ranges = [];

        function shouldGlue(prev, curr) {
            /* Itens vazios nunca geram espaço */
            if (!prev.str || !curr.str) return true;
            const ps = String(prev.str);
            const cs = String(curr.str);
            /* Se ambos são fragmentos curtos (≤2 chars) — provavelmente mesma palavra */
            if (ps.length <= 2 && cs.length <= 2) return true;
            /* Usar posição horizontal: transform[4] = x do item; transform[3] = altura da fonte */
            const pt = prev.transform, ct = curr.transform;
            if (pt && ct) {
                const fontH = Math.abs(pt[3]) || 10;
                const prevX  = pt[4];
                const prevW  = (prev.width != null ? prev.width : 0) * (Math.hypot(pt[0], pt[1]) || 1);
                const currX  = ct[4];
                const gap    = currX - (prevX + prevW);
                /* Gap menor que 30% da altura da fonte = sem espaço */
                if (gap >= 0 && gap < fontH * 0.3) return true;
            }
            return false;
        }

        for (let i = 0; i < items.length; i++) {
            const s = items[i].str != null ? String(items[i].str) : '';
            if (!s.length) continue;
            if (i > 0 && text.length > 0) {
                /* Decidir se cola ou separa com espaço */
                const prev = items[i - 1];
                if (!shouldGlue(prev, items[i])) {
                    text += ' ';
                }
            }
            const start = text.length;
            text += s;
            ranges.push({ start, end: text.length, itemIndex: i });
        }
        return { text, ranges };
    }

    function clearPdfHighlight() {
        ttsPdfHighlightLast = { start: -1, end: -1 };
        if (!pdfTextLayerSpans) return;
        Object.keys(pdfTextLayerSpans).forEach(function(k) {
            var el = pdfTextLayerSpans[k];
            if (el && el.classList) el.classList.remove('tts-active');
        });
    }

    function updatePdfReadHighlight(charIndex, charLength) {
        if (!pdfTextLayerSpans || !ttsCharRanges.length) return;
        var start = Math.max(0, charIndex | 0);
        var end = start + Math.max(1, charLength | 0);
        if (start === ttsPdfHighlightLast.start && end === ttsPdfHighlightLast.end) return;
        ttsPdfHighlightLast = { start: start, end: end };
        Object.keys(pdfTextLayerSpans).forEach(function(k) {
            var el = pdfTextLayerSpans[k];
            if (el && el.classList) el.classList.remove('tts-active');
        });
        var seen = {};
        for (var i = 0; i < ttsCharRanges.length; i++) {
            var r = ttsCharRanges[i];
            if (r.end > start && r.start < end && pdfTextLayerSpans[r.itemIndex]) {
                if (!seen[r.itemIndex]) {
                    seen[r.itemIndex] = true;
                    pdfTextLayerSpans[r.itemIndex].classList.add('tts-active');
                }
            }
        }
    }

    /* scrollIntoView com opções não é suportado em Safari < 15.4 — usar try/catch */
    function safeScrollIntoView(el) {
        if (!el) return;
        try {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        } catch (e) {
            try { el.scrollIntoView(true); } catch (_) {}
        }
    }

    function scrollTtsHighlightIntoView() {
        /* A ouvir com a Home à vista: não mexer no scroll da Home */
        if (homeView) return;
        if (ttsScrollHighlightRaf != null) return;
        ttsScrollHighlightRaf = requestAnimationFrame(function() {
            ttsScrollHighlightRaf = null;
            var span = document.querySelector('#pdf-render-area .text-layer span.tts-active');
            if (span) safeScrollIntoView(span);
        });
    }

    function buildPdfTextLayer(viewport, textContent, textLayerDiv) {
        var Util = pdfjsLib.Util;
        var spans = Object.create(null);
        textLayerDiv.textContent = '';
        var items = textContent.items || [];
        items.forEach(function(item, idx) {
            var str = item.str != null ? String(item.str) : '';
            if (!str.length) return;
            var tx = Util.transform(viewport.transform, item.transform);
            var fontHeight = Math.hypot(tx[2], tx[3]) || 12;
            if (fontHeight < 0.5) return;
            var angle = Math.atan2(tx[1], tx[0]);
            var left = tx[4];
            var top = tx[5];
            var horizScale = Math.hypot(tx[0], tx[1]) || 1;
            var wFromPdf = (item.width != null ? item.width : 0) * horizScale;
            var wGuess = str.length * fontHeight * 0.52;
            var spanW = Math.max(wFromPdf, wGuess, fontHeight * 0.35);

            var span = document.createElement('span');
            span.textContent = str;
            span.dataset.itemIndex = String(idx);
            span.style.left = (left - 1) + 'px';
            span.style.top = (top - fontHeight * 1.02) + 'px';
            span.style.fontSize = fontHeight + 'px';
            span.style.lineHeight = '1';
            span.style.fontFamily = 'sans-serif';
            span.style.minWidth = spanW + 'px';
            if (Math.abs(angle) > 0.003) span.style.transform = 'rotate(' + angle + 'rad)';
            textLayerDiv.appendChild(span);
            spans[idx] = span;
        });
        return spans;
    }

    function updateHighlight(charIndex, charLength) {
        var hlEl = document.getElementById('opt-tts-highlight');
        if (hlEl && !hlEl.checked) {
            clearPdfHighlight();
            return;
        }
        updatePdfReadHighlight(charIndex, charLength);
        if (isReading) scrollTtsHighlightIntoView();
    }

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

    wireScrollNavControls();
    wireSettingsUi();

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) return;
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
        flushTtsPendingRender();
    });

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

    function persistLastCloudDocId(id) {
        try {
            if (id) safeStorage.setItem(LS_LAST_CLOUD_DOC, id);
            else safeStorage.removeItem(LS_LAST_CLOUD_DOC);
        } catch (e) { console.warn(e); }
    }

    function updateCloudPrefsVisibility() {
        const on = !!readeraSb;
        var cloudGroup = document.getElementById('settings-group-cloud');
        if (cloudGroup) cloudGroup.style.display = on ? '' : 'none';
        ['opt-auto-cloud-wrap', 'opt-resume-cloud-wrap'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = on ? '' : 'none';
        });
    }

    function scheduleCloudProgress() {
        if (!readeraSb || !cloudDocumentId || !pdfDoc) return;
        patchCloudRowProgress(cloudDocumentId, pageNum, pdfDoc.numPages);
        clearTimeout(progressSaveTimer);
        progressSaveTimer = setTimeout(function() {
            readeraSb.from('documents').update({
                last_page: pageNum,
                num_pages: pdfDoc.numPages
            }).eq('id', cloudDocumentId).then(function() {}).catch(function(err) {
                console.warn('Supabase: progresso não salvo', err);
            });
        }, 900);
    }

    function patchCloudRowProgress(id, lastPage, numPages) {
        if (!id) return;
        for (var i = 0; i < cloudLibraryRows.length; i++) {
            if (cloudLibraryRows[i].id !== id) continue;
            cloudLibraryRows[i].last_page = lastPage;
            cloudLibraryRows[i].num_pages = numPages;
            cloudLibraryRows[i].updated_at = new Date().toISOString();
            if (homeActiveTab === 'estatisticas') renderHomeStats();
            return;
        }
    }

    function updateCloudChrome() {
        var saveBtn = document.getElementById('btn-cloud-save');
        var delBtn  = document.getElementById('btn-cloud-delete');
        var libWrap = document.getElementById('cloud-library-wrap');
        if (!saveBtn || !libWrap) return;
        var on = !!readeraSb;
        /* Em TVs o classList.toggle com segundo argumento pode não funcionar em WebKit antigo */
        if (on) { libWrap.classList.remove('hidden'); } else { libWrap.classList.add('hidden'); }
        if (on && pdfDoc) { saveBtn.classList.remove('hidden'); } else { saveBtn.classList.add('hidden'); }
        saveBtn.disabled = !on || !pdfDoc || !pdfCacheBytes || !!cloudDocumentId || cloudSyncInFlight;
        if (delBtn) {
            if (on && cloudLibraryCount > 0) { delBtn.classList.remove('hidden'); } else { delBtn.classList.add('hidden'); }
            delBtn.disabled = !on || cloudLibraryCount === 0 || cloudSyncInFlight;
        }
        updateCloudPrefsVisibility();
    }

    function positionCloudLibraryPanel() {
        var panel = document.getElementById('cloud-library-panel');
        var trigger = document.getElementById('cloud-library-trigger');
        if (!panel || !trigger) return;
        var r = trigger.getBoundingClientRect();
        var gap = 6;
        var panelW = Math.min(Math.max(r.width, 280), Math.min(380, window.innerWidth - 16));
        var left = r.right - panelW;
        if (left < 8) left = 8;
        if (left + panelW > window.innerWidth - 8) left = window.innerWidth - 8 - panelW;
        var top = r.bottom + gap;
        var maxH = Math.min(window.innerHeight * 0.5, 360);
        if (top + maxH > window.innerHeight - 8) {
            top = Math.max(8, r.top - gap - maxH);
        }
        panel.style.width = panelW + 'px';
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.maxHeight = maxH + 'px';
    }

    function setCloudLibraryPanelOpen(open) {
        var panel = document.getElementById('cloud-library-panel');
        var trigger = document.getElementById('cloud-library-trigger');
        var wrap = document.getElementById('cloud-library-wrap');
        cloudLibraryPanelOpen = !!open;
        if (panel) {
            if (open) {
                if (wrap && panel.parentNode !== document.body) {
                    document.body.appendChild(panel);
                }
                panel.classList.remove('hidden');
                positionCloudLibraryPanel();
            } else {
                panel.classList.add('hidden');
                if (wrap && panel.parentNode !== wrap) {
                    wrap.appendChild(panel);
                }
            }
        }
        if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeCloudLibraryPanel() {
        setCloudLibraryPanelOpen(false);
    }

    /* Play/pause em SVG nos três lugares: card da Home, mini-player e leitor */
    function setPlayPauseIcon(el, playing) {
        if (!el) return;
        if (el.id === 'home-continue-play') {
            el.innerHTML = (playing ? MINI_ICON_PAUSE : MINI_ICON_PLAY) + ' ' + (playing ? 'Pausar' : 'Continuar');
        } else {
            el.innerHTML = playing ? MINI_ICON_PAUSE : MINI_ICON_PLAY;
        }
        el.title = playing ? 'Pausar' : 'Ouvir';
        el.setAttribute('aria-label', el.title);
    }

    function setMiniTtsIcon(playing) {
        setPlayPauseIcon(document.getElementById('home-mini-tts'), playing);
        setPlayPauseIcon(document.getElementById('home-continue-play'), playing);
    }

    function bookCoverInitial(title) {
        var t = String(title || '?').trim();
        return t ? t.charAt(0).toUpperCase() : '?';
    }

    function bookCoverHue(title) {
        var h = 0;
        var s = String(title || '');
        for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        return Math.abs(h) % 360;
    }

    function applyBookCoverEl(el, title, imageUrl) {
        if (!el) return;
        var t = String(title || '?').trim();
        el.setAttribute('data-cover-title', t);
        if (imageUrl) {
            el.textContent = '';
            el.classList.add('has-cover-img');
            el.style.backgroundImage = 'url("' + imageUrl + '")';
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center top';
            el.style.backgroundRepeat = 'no-repeat';
            el.style.backgroundColor = '#1a1d26';
            return;
        }
        el.classList.remove('has-cover-img');
        el.style.backgroundImage = '';
        el.textContent = bookCoverInitial(title);
        var hue = bookCoverHue(title);
        el.style.background = 'linear-gradient(145deg, hsl(' + hue + ',45%,28%), hsl(' + hue + ',35%,14%))';
    }

    function getCachedCover(id) {
        if (!id) return null;
        if (_coverMem[id]) return _coverMem[id];
        try {
            var stored = safeStorage.getItem(LS_COVER_PREFIX + id);
            if (stored) {
                _coverMem[id] = stored;
                return stored;
            }
        } catch (e) {}
        return null;
    }

    function setCachedCover(id, imageUrl) {
        if (!id || !imageUrl) return;
        _coverMem[id] = imageUrl;
        try { safeStorage.setItem(LS_COVER_PREFIX + id, imageUrl); } catch (e) {}
        var nodes = document.querySelectorAll('[data-cover-doc="' + id + '"]');
        for (var i = 0; i < nodes.length; i++) {
            applyBookCoverEl(nodes[i], nodes[i].getAttribute('data-cover-title') || '', imageUrl);
        }
    }

    function generatePdfCoverDataUrl(arrayBuffer, targetWidth) {
        if (!pdfjsLib || !arrayBuffer) return Promise.resolve(null);
        var copy = arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer;
        var loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(copy) });
        return loadingTask.promise.then(function(doc) {
            return doc.getPage(1).then(function(page) {
                var width = targetWidth || 280;
                var vp1 = page.getViewport({ scale: 1 });
                var scale = width / vp1.width;
                var viewport = page.getViewport({ scale: scale });
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
                    var url = canvas.toDataURL('image/jpeg', 0.84);
                    try { doc.destroy(); } catch (e) {}
                    return url;
                });
            });
        }).catch(function() { return null; });
    }

    function ensureCoverForBytes(docId, bytes) {
        if (!docId || !bytes || getCachedCover(docId)) return Promise.resolve(null);
        var buf = bytes.buffer
            ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            : bytes;
        return generatePdfCoverDataUrl(buf, 280).then(function(url) {
            if (url) setCachedCover(docId, url);
            return url;
        });
    }

    function drainCoverQueue() {
        while (_coverInflight < COVER_MAX_INFLIGHT && _coverQueue.length) {
            var row = _coverQueue.shift();
            if (!row || !row.id || getCachedCover(row.id)) continue;
            _coverInflight++;
            downloadPdfFromStoragePath(row.storage_path).then(function(buf) {
                return generatePdfCoverDataUrl(buf, 280);
            }).then(function(url) {
                if (url) setCachedCover(row.id, url);
            }).catch(function() {}).then(function() {
                _coverInflight--;
                drainCoverQueue();
            });
        }
    }

    function hydrateBookCover(row, el) {
        if (!el || !row) return;
        var title = row.title || row.id;
        if (row.id) el.setAttribute('data-cover-doc', row.id);
        var cached = row.id ? getCachedCover(row.id) : null;
        if (cached) {
            applyBookCoverEl(el, title, cached);
            return;
        }
        applyBookCoverEl(el, title, null);
        if (row.id && cloudDocumentId === row.id && pdfCacheBytes) {
            ensureCoverForBytes(row.id, pdfCacheBytes);
            return;
        }
        if (row.id && row.storage_path && readeraSb) {
            _coverQueue.push(row);
            drainCoverQueue();
        }
    }

    function docProgressPct(row) {
        if (!row) return 0;
        var lp = row.last_page || 1;
        var np = row.num_pages;
        if (np && np > 0) return Math.min(100, Math.round((lp / np) * 100));
        return 0;
    }

    function statsMarkTtsActive() {
        if (!_statsTtsTickAt) {
            _statsTtsTickAt = Date.now();
            _statsTtsBookId = cloudDocumentId || null;
        }
    }

    function statsFlushTtsTime() {
        if (!_statsTtsTickAt) return;
        var elapsed = Math.floor((Date.now() - _statsTtsTickAt) / 1000);
        var bookId = _statsTtsBookId;
        _statsTtsTickAt = null;
        _statsTtsBookId = null;
        if (elapsed <= 0) return;
        var prev = parseInt(safeStorage.getItem(LS_STATS_TTS_SECONDS) || '0', 10) || 0;
        safeStorage.setItem(LS_STATS_TTS_SECONDS, String(prev + elapsed));
        if (bookId) {
            var bookPrev = parseInt(safeStorage.getItem(LS_STATS_TTS_BOOK_PREFIX + bookId) || '0', 10) || 0;
            safeStorage.setItem(LS_STATS_TTS_BOOK_PREFIX + bookId, String(bookPrev + elapsed));
        }
        if (homeActiveTab === 'estatisticas') renderHomeStats();
    }

    function getBookTtsSeconds(bookId) {
        if (!bookId) return 0;
        var sec = parseInt(safeStorage.getItem(LS_STATS_TTS_BOOK_PREFIX + bookId) || '0', 10) || 0;
        if (_statsTtsTickAt && _statsTtsBookId === bookId) {
            sec += Math.floor((Date.now() - _statsTtsTickAt) / 1000);
        }
        return sec;
    }

    function formatStatDate(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function bookStatusLabel(lp, np, pct) {
        if (np > 0 && lp >= np) return { text: 'Concluído', cls: 'is-done' };
        if (lp > 1 || pct > 0) return { text: 'Em leitura', cls: '' };
        return { text: 'Não iniciado', cls: 'is-new' };
    }

    function statsBookKey(row) {
        return row.id || ('local:' + (row.title || row.storage_path || 'doc'));
    }

    function selectBookStats(bookKey) {
        statsSelectedBookId = bookKey || null;
        renderHomeStats();
        if (bookKey) {
            var detail = document.getElementById('stats-book-detail');
            if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function formatStatDuration(totalSeconds) {
        var sec = Math.max(0, Math.round(totalSeconds || 0));
        if (sec < 60) return sec + ' s';
        var min = Math.floor(sec / 60);
        if (min < 60) return min + ' min';
        var h = Math.floor(min / 60);
        var rm = min % 60;
        return h + ' h' + (rm ? ' ' + rm + ' min' : '');
    }

    function formatStatBytes(bytes) {
        var n = Number(bytes) || 0;
        if (!n) return '0 B';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function mergeStatsRows(rows) {
        var list = (rows || []).slice();
        var open = currentOpenBookRow();
        if (!open || !open.id) return list;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === open.id) {
                list[i] = Object.assign({}, list[i], open);
                return list;
            }
        }
        if (open.isOpen) list.unshift(open);
        return list;
    }

    function computeLibraryStats(rows) {
        rows = mergeStatsRows(rows);
        var totalBooks = rows.length;
        var completed = 0;
        var inProgress = 0;
        var totalPages = 0;
        var pagesRead = 0;
        var totalBytes = 0;
        var activeWeek = 0;
        var now = Date.now();
        var weekMs = 7 * 24 * 60 * 60 * 1000;
        var books = [];

        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var np = r.num_pages || 0;
            var lp = r.last_page || 1;
            var pct = docProgressPct(r);
            if (np > 0) {
                totalPages += np;
                pagesRead += Math.min(lp, np);
                if (lp >= np) completed++;
                else if (lp > 1) inProgress++;
            } else {
                pagesRead += lp;
                if (lp > 1) inProgress++;
            }
            if (r.bytes) totalBytes += Number(r.bytes) || 0;
            if (r.updated_at) {
                var t = new Date(r.updated_at).getTime();
                if (!isNaN(t) && (now - t) < weekMs) activeWeek++;
            }
            books.push({ row: r, pct: pct, lp: lp, np: np });
        }

        books.sort(function(a, b) {
            var ta = a.row.updated_at ? new Date(a.row.updated_at).getTime() : 0;
            var tb = b.row.updated_at ? new Date(b.row.updated_at).getTime() : 0;
            return tb - ta;
        });

        var ttsSec = parseInt(safeStorage.getItem(LS_STATS_TTS_SECONDS) || '0', 10) || 0;
        if (_statsTtsTickAt) ttsSec += Math.floor((Date.now() - _statsTtsTickAt) / 1000);

        return {
            totalBooks: totalBooks,
            completed: completed,
            inProgress: inProgress,
            totalPages: totalPages,
            pagesRead: pagesRead,
            avgProgress: totalPages > 0 ? Math.round((pagesRead / totalPages) * 100) : 0,
            totalBytes: totalBytes,
            activeWeek: activeWeek,
            books: books,
            ttsSeconds: ttsSec
        };
    }

    function renderHomeStats() {
        var stats = computeLibraryStats(getNonTrashedRows(cloudLibraryRows));
        var setText = function(id, text) {
            var el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        setText('stats-books', String(stats.totalBooks));
        setText('stats-pages', stats.totalPages
            ? (stats.pagesRead.toLocaleString('pt-BR') + ' / ' + stats.totalPages.toLocaleString('pt-BR'))
            : String(stats.pagesRead));
        setText('stats-avg', stats.avgProgress + '%');
        setText('stats-completed', String(stats.completed));
        setText('stats-tts', formatStatDuration(stats.ttsSeconds));
        setText('stats-active-week', String(stats.activeWeek));

        var summary = document.getElementById('stats-summary');
        if (summary) {
            if (!stats.totalBooks) {
                summary.textContent = 'Adicione livros na nuvem para acompanhar seu progresso.';
            } else {
                summary.textContent = stats.inProgress + ' em leitura · ' + formatStatBytes(stats.totalBytes) + ' na nuvem';
            }
        }

        var fill = document.getElementById('stats-overall-fill');
        var bar = document.getElementById('stats-overall-bar');
        var meta = document.getElementById('stats-overall-meta');
        if (fill) fill.style.width = stats.avgProgress + '%';
        if (bar) {
            bar.setAttribute('aria-valuenow', String(stats.avgProgress));
            bar.setAttribute('aria-valuetext', stats.avgProgress + '% concluído');
        }
        if (meta) {
            meta.textContent = stats.totalPages
                ? (stats.pagesRead.toLocaleString('pt-BR') + ' de ' + stats.totalPages.toLocaleString('pt-BR') + ' páginas · ' + stats.avgProgress + '%')
                : (stats.pagesRead.toLocaleString('pt-BR') + ' páginas lidas');
        }

        var list = document.getElementById('stats-books-list');
        var empty = document.getElementById('stats-books-empty');
        if (!list) return;
        list.innerHTML = '';
        if (!stats.books.length) {
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        stats.books.forEach(function(item) {
            var row = item.row;
            var bookKey = statsBookKey(row);
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'home-stats-book-item';
            if (statsSelectedBookId === bookKey) btn.classList.add('is-selected');
            btn.setAttribute('role', 'listitem');
            btn.setAttribute('data-stats-book', bookKey);
            var top = document.createElement('div');
            top.className = 'home-stats-book-top';
            var title = document.createElement('p');
            title.className = 'home-stats-book-title';
            title.textContent = row.title || row.id || 'Documento';
            var pctEl = document.createElement('span');
            pctEl.className = 'home-stats-book-pct';
            pctEl.textContent = item.pct + '%';
            top.appendChild(title);
            top.appendChild(pctEl);
            var metaEl = document.createElement('p');
            metaEl.className = 'home-stats-book-meta';
            if (item.np) metaEl.textContent = 'Página ' + item.lp + ' de ' + item.np;
            else metaEl.textContent = 'Página ' + item.lp;
            var barWrap = document.createElement('div');
            barWrap.className = 'home-stats-book-bar';
            var barFill = document.createElement('div');
            barFill.className = 'home-stats-book-bar-fill';
            barFill.style.width = item.pct + '%';
            barWrap.appendChild(barFill);
            btn.appendChild(top);
            btn.appendChild(metaEl);
            btn.appendChild(barWrap);
            btn.addEventListener('click', function() {
                selectBookStats(bookKey);
            });
            list.appendChild(btn);
        });

        renderBookStatsDetail(stats);
    }

    function renderBookStatsDetail(stats) {
        var detail = document.getElementById('stats-book-detail');
        if (!detail) return;
        if (!statsSelectedBookId) {
            detail.classList.add('hidden');
            return;
        }

        var selected = null;
        for (var i = 0; i < stats.books.length; i++) {
            if (statsBookKey(stats.books[i].row) === statsSelectedBookId) {
                selected = stats.books[i];
                break;
            }
        }
        if (!selected) {
            statsSelectedBookId = null;
            detail.classList.add('hidden');
            return;
        }

        detail.classList.remove('hidden');
        var row = selected.row;
        var lp = selected.lp;
        var np = selected.np;
        var pct = selected.pct;
        var status = bookStatusLabel(lp, np, pct);
        var remaining = np > 0 ? Math.max(0, np - lp) : '—';

        var titleEl = document.getElementById('stats-detail-title');
        if (titleEl) titleEl.textContent = row.title || row.id || 'Documento';

        var statusEl = document.getElementById('stats-detail-status');
        if (statusEl) {
            statusEl.textContent = status.text;
            statusEl.className = 'home-stats-detail-badge' + (status.cls ? ' ' + status.cls : '');
        }

        var coverEl = document.getElementById('stats-detail-cover');
        if (coverEl) {
            coverEl.className = 'home-stats-detail-cover';
            coverEl.textContent = '';
            coverEl.style.backgroundImage = '';
            hydrateBookCover(row, coverEl);
        }

        var fill = document.getElementById('stats-detail-fill');
        var bar = document.getElementById('stats-detail-bar');
        var progressMeta = document.getElementById('stats-detail-progress-meta');
        if (fill) fill.style.width = pct + '%';
        if (bar) {
            bar.setAttribute('aria-valuenow', String(pct));
            bar.setAttribute('aria-valuetext', pct + '% concluído');
        }
        if (progressMeta) {
            progressMeta.textContent = np
                ? (lp.toLocaleString('pt-BR') + ' de ' + np.toLocaleString('pt-BR') + ' páginas · ' + pct + '%')
                : (lp.toLocaleString('pt-BR') + ' páginas lidas');
        }

        var setText = function(id, text) {
            var el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        setText('stats-detail-pages', np ? (lp + ' / ' + np) : String(lp));
        setText('stats-detail-remaining', typeof remaining === 'number' ? String(remaining) : remaining);
        setText('stats-detail-tts', formatStatDuration(getBookTtsSeconds(row.id)));
        setText('stats-detail-size', formatStatBytes(row.bytes));
        setText('stats-detail-updated', formatStatDate(row.updated_at));
        setText('stats-detail-created', formatStatDate(row.created_at));
    }

    function pickFeaturedDoc(rows) {
        rows = getNonTrashedRows(rows);
        if (!rows || !rows.length) return null;
        var lastId = safeStorage.getItem(LS_LAST_CLOUD_DOC);
        if (lastId) {
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].id === lastId) return rows[i];
            }
        }
        return rows[0];
    }

    function setHomeTab(tab) {
        homeActiveTab = tab || 'inicio';
        ['inicio', 'biblioteca', 'lixeira', 'favoritos', 'anotacoes', 'estatisticas', 'conta'].forEach(function(t) {
            var panel = document.getElementById('home-tab-' + t);
            if (!panel) return;
            if (t === homeActiveTab) panel.classList.remove('hidden');
            else panel.classList.add('hidden');
        });
        if (homeActiveTab === 'estatisticas') renderHomeStats();
        if (homeActiveTab === 'favoritos') renderHomeFavoritesList();
        if (homeActiveTab === 'anotacoes') renderHomeNotesList();
        if (homeActiveTab === 'lixeira') renderHomeTrashList();
        if (homeActiveTab === 'biblioteca') updateLibraryHeader();
        updateHomeNavActive();
        updateSidebarLibraryActive();
    }

    function loadTrashIds() {
        try {
            var raw = safeStorage.getItem(LS_TRASH);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function saveTrashIds(ids) {
        safeStorage.setItem(LS_TRASH, JSON.stringify(ids || []));
    }

    function isTrashed(id) {
        if (!id) return false;
        return loadTrashIds().indexOf(id) !== -1;
    }

    function removeFromTrash(id) {
        if (!id) return;
        saveTrashIds(loadTrashIds().filter(function(x) { return x !== id; }));
    }

    function getNonTrashedRows(rows) {
        var trash = loadTrashIds();
        return (rows || cloudLibraryRows || []).filter(function(r) {
            return r.id && trash.indexOf(r.id) === -1;
        });
    }

    function getTrashedRows() {
        var trash = loadTrashIds();
        if (!trash.length) return [];
        return (cloudLibraryRows || []).filter(function(r) {
            return r.id && trash.indexOf(r.id) !== -1;
        });
    }

    function pruneStaleTrashIds() {
        var trash = loadTrashIds();
        var known = {};
        for (var i = 0; i < cloudLibraryRows.length; i++) {
            if (cloudLibraryRows[i].id) known[cloudLibraryRows[i].id] = true;
        }
        var pruned = trash.filter(function(id) { return known[id]; });
        if (pruned.length !== trash.length) saveTrashIds(pruned);
    }

    function filterRowsForLibraryView(rows) {
        rows = rows || [];
        if (libraryViewMode === 'recent') {
            var cutoff = Date.now() - LIBRARY_RECENT_DAYS * 24 * 60 * 60 * 1000;
            return rows.filter(function(r) {
                if (!r.updated_at) return false;
                var t = new Date(r.updated_at).getTime();
                return !isNaN(t) && t >= cutoff;
            }).sort(function(a, b) {
                return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            });
        }
        if (libraryViewMode === 'cloud') {
            return rows.filter(function(r) { return !!r.storage_path; });
        }
        return rows.slice();
    }

    function updateLibraryHeader() {
        var titleEl = document.getElementById('home-library-title');
        var subEl = document.getElementById('home-library-sub');
        var titles = {
            all: ['Biblioteca', 'Todos os PDFs guardados na nuvem'],
            recent: ['Recentes', 'Lidos ou atualizados nos últimos ' + LIBRARY_RECENT_DAYS + ' dias'],
            cloud: ['Na nuvem', 'PDFs sincronizados na sua conta']
        };
        var info = titles[libraryViewMode] || titles.all;
        if (titleEl) titleEl.textContent = info[0];
        if (subEl) subEl.textContent = info[1];
    }

    function setLibraryView(mode) {
        libraryViewMode = mode || 'all';
        openHomeView('biblioteca');
        updateLibraryHeader();
        applyHomeSearch(homeSearchQuery);
    }

    function updateSidebarLibraryActive() {
        var onHome = !document.body.classList.contains('pdf-is-open');
        var subs = document.querySelectorAll('.sidebar-sub-item');
        for (var i = 0; i < subs.length; i++) {
            var btn = subs[i];
            var view = btn.getAttribute('data-library-view');
            var nav = btn.getAttribute('data-home-nav');
            var active = false;
            if (onHome && nav === 'lixeira') active = homeActiveTab === 'lixeira';
            else if (onHome && view) active = homeActiveTab === 'biblioteca' && libraryViewMode === view;
            if (active) btn.classList.add('is-active');
            else btn.classList.remove('is-active');
        }
    }

    function moveToTrash(id, title) {
        if (!id) return;
        var label = title || id;
        if (!confirm('Mover para o lixeiro?\n\n' + label + '\n\nPode restaurar depois em Lixeiro.')) return;
        var ids = loadTrashIds();
        if (ids.indexOf(id) === -1) ids.push(id);
        saveTrashIds(ids);
        removeFavoriteId(id);
        applyHomeSearch(homeSearchQuery);
        if (homeActiveTab === 'lixeira') renderHomeTrashList();
        if (typeof showTtsToast === 'function') showTtsToast('Movido para o lixeiro');
    }

    function restoreFromTrash(id, title) {
        if (!id) return;
        removeFromTrash(id);
        applyHomeSearch(homeSearchQuery);
        renderHomeTrashList();
        if (typeof showTtsToast === 'function') {
            showTtsToast('Restaurado: ' + (title || 'livro'));
        }
    }

    function renderHomeTrashList() {
        var list = document.getElementById('home-trash-list');
        if (!list) return;
        list.innerHTML = '';
        pruneStaleTrashIds();
        var rows = getTrashedRows();
        if (!rows.length) {
            var empty = document.createElement('div');
            empty.className = 'home-library-empty';
            empty.textContent = 'O lixeiro está vazio.';
            list.appendChild(empty);
            return;
        }
        rows.forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'home-library-item';
            item.setAttribute('role', 'listitem');
            var cover = document.createElement('span');
            cover.className = 'home-library-cover';
            hydrateBookCover(row, cover);
            var info = document.createElement('div');
            info.className = 'home-library-info';
            var h = document.createElement('p');
            h.className = 'home-library-title';
            h.textContent = row.title || row.id;
            var meta = document.createElement('p');
            meta.className = 'home-library-meta';
            meta.textContent = row.updated_at
                ? ('Apagado · última leitura ' + formatStatDate(row.updated_at))
                : 'Apagado da biblioteca';
            info.appendChild(h);
            info.appendChild(meta);
            var restoreBtn = document.createElement('button');
            restoreBtn.type = 'button';
            restoreBtn.className = 'home-library-restore';
            restoreBtn.textContent = 'Restaurar';
            restoreBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                restoreFromTrash(row.id, row.title || row.id);
            });
            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'home-library-del';
            delBtn.title = 'Apagar permanentemente';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteCloudDocumentById(row.id, row.title || row.id, true);
            });
            item.appendChild(cover);
            item.appendChild(info);
            item.appendChild(restoreBtn);
            item.appendChild(delBtn);
            list.appendChild(item);
        });
    }

    function loadFavorites() {
        try {
            var raw = safeStorage.getItem(LS_FAVORITES);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function saveFavorites(ids) {
        safeStorage.setItem(LS_FAVORITES, JSON.stringify(ids || []));
    }

    function isFavorite(id) {
        if (!id) return false;
        return loadFavorites().indexOf(id) !== -1;
    }

    function toggleFavorite(id) {
        if (!id) return false;
        var favs = loadFavorites();
        var idx = favs.indexOf(id);
        var added = idx === -1;
        if (added) favs.push(id);
        else favs.splice(idx, 1);
        saveFavorites(favs);
        applyHomeSearch(homeSearchQuery);
        if (homeActiveTab === 'favoritos') renderHomeFavoritesList();
        if (typeof showTtsToast === 'function') {
            showTtsToast(added ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
        }
        return added;
    }

    function removeFavoriteId(id) {
        if (!id) return;
        var favs = loadFavorites().filter(function(x) { return x !== id; });
        saveFavorites(favs);
    }

    function loadNotes() {
        try {
            var raw = safeStorage.getItem(LS_NOTES);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function saveNotes(notes) {
        safeStorage.setItem(LS_NOTES, JSON.stringify(notes || []));
    }

    function removeNotesForDoc(docId) {
        if (!docId) return;
        saveNotes(loadNotes().filter(function(n) { return n.docId !== docId; }));
        if (homeActiveTab === 'anotacoes') renderHomeNotesList();
    }

    function deleteNoteById(noteId) {
        saveNotes(loadNotes().filter(function(n) { return n.id !== noteId; }));
        if (homeActiveTab === 'anotacoes') renderHomeNotesList();
    }

    function upsertNote(note) {
        var notes = loadNotes();
        var idx = -1;
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === note.id) { idx = i; break; }
        }
        if (idx === -1) notes.unshift(note);
        else notes[idx] = note;
        saveNotes(notes);
        if (homeActiveTab === 'anotacoes') renderHomeNotesList();
    }

    function getCurrentDocForNotes() {
        if (!pdfDoc) return null;
        var docId = cloudDocumentId;
        if (!docId) return null;
        return {
            docId: docId,
            docTitle: currentBookTitle || lastOpenedFileName || 'Documento',
            page: pageNum || currentPageNum || 1
        };
    }

    function createFavBtn(row) {
        var id = row && row.id;
        if (!id) return null;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'home-fav-btn' + (isFavorite(id) ? ' is-fav' : '');
        btn.title = isFavorite(id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
        btn.setAttribute('aria-label', btn.title);
        btn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.4 5.8L21 10l-4.5 4.2L17.5 21 12 18l-5.5 3 1-6.8L3 10l6.6-1.2z"/></svg>';
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleFavorite(id);
            btn.classList.toggle('is-fav', isFavorite(id));
            btn.title = isFavorite(id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
            btn.setAttribute('aria-label', btn.title);
        });
        return btn;
    }

    function renderHomeFavoritesList() {
        var list = document.getElementById('home-favorites-list');
        if (!list) return;
        list.innerHTML = '';
        var favIds = loadFavorites();
        if (!favIds.length) {
            var empty = document.createElement('div');
            empty.className = 'home-library-empty';
            empty.textContent = 'Nenhum favorito ainda. Toque na estrela na Biblioteca para marcar livros.';
            list.appendChild(empty);
            return;
        }
        var favRows = [];
        for (var i = 0; i < cloudLibraryRows.length; i++) {
            if (favIds.indexOf(cloudLibraryRows[i].id) !== -1 && !isTrashed(cloudLibraryRows[i].id)) {
                favRows.push(cloudLibraryRows[i]);
            }
        }
        if (!favRows.length) {
            var stale = document.createElement('div');
            stale.className = 'home-library-empty';
            stale.textContent = 'Os favoritos guardados já não estão na nuvem.';
            list.appendChild(stale);
            return;
        }
        favRows.forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'home-library-item';
            item.setAttribute('role', 'listitem');
            var cover = document.createElement('span');
            cover.className = 'home-library-cover';
            hydrateBookCover(row, cover);
            var info = document.createElement('div');
            info.className = 'home-library-info';
            var h = document.createElement('p');
            h.className = 'home-library-title';
            h.textContent = row.title || row.id;
            var meta = document.createElement('p');
            meta.className = 'home-library-meta';
            var lp = row.last_page || 1;
            meta.textContent = row.num_pages ? ('Página ' + lp + ' de ' + row.num_pages) : ('Página ' + lp);
            info.appendChild(h);
            info.appendChild(meta);
            var favBtn = createFavBtn(row);
            var openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'home-library-open';
            openBtn.textContent = 'Abrir';
            openBtn.addEventListener('click', function() { openCloudDocumentById(row.id); });
            item.appendChild(cover);
            item.appendChild(info);
            if (favBtn) item.appendChild(favBtn);
            item.appendChild(openBtn);
            list.appendChild(item);
        });
    }

    function formatNoteDate(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function renderHomeNotesList() {
        var list = document.getElementById('home-notes-list');
        var empty = document.getElementById('home-notes-empty');
        if (!list) return;
        list.innerHTML = '';
        var notes = loadNotes().slice().sort(function(a, b) {
            return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
        });
        if (!notes.length) {
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');
        notes.forEach(function(note) {
            var card = document.createElement('div');
            card.className = 'home-note-item';
            card.setAttribute('role', 'listitem');
            var top = document.createElement('div');
            top.className = 'home-note-top';
            var book = document.createElement('p');
            book.className = 'home-note-book';
            book.textContent = note.docTitle || 'Documento';
            var page = document.createElement('span');
            page.className = 'home-note-page';
            page.textContent = 'Pág. ' + (note.page || 1);
            top.appendChild(book);
            top.appendChild(page);
            var text = document.createElement('p');
            text.className = 'home-note-text';
            text.textContent = note.text || '';
            var date = document.createElement('p');
            date.className = 'home-note-date';
            date.textContent = formatNoteDate(note.updatedAt || note.createdAt);
            var actions = document.createElement('div');
            actions.className = 'home-note-actions';
            var openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'home-note-action-btn';
            openBtn.textContent = 'Abrir livro';
            openBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (note.docId) openCloudDocumentById(note.docId, { jumpPage: note.page || 1 });
            });
            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'home-note-action-btn';
            editBtn.textContent = 'Editar';
            editBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                openNoteModal({ note: note });
            });
            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'home-note-action-btn home-note-action-btn--danger';
            delBtn.textContent = 'Apagar';
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (confirm('Apagar esta anotação?')) deleteNoteById(note.id);
            });
            actions.appendChild(openBtn);
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            card.appendChild(top);
            card.appendChild(text);
            card.appendChild(date);
            card.appendChild(actions);
            card.addEventListener('click', function() {
                if (note.docId) openCloudDocumentById(note.docId, { jumpPage: note.page || 1 });
            });
            list.appendChild(card);
        });
    }

    function openNoteModal(opts) {
        opts = opts || {};
        var modal = document.getElementById('note-modal');
        var meta = document.getElementById('note-modal-meta');
        var textEl = document.getElementById('note-modal-text');
        var titleEl = document.getElementById('note-modal-title');
        if (!modal || !textEl) return;
        var ctx = opts.note ? {
            docId: opts.note.docId,
            docTitle: opts.note.docTitle,
            page: opts.note.page
        } : getCurrentDocForNotes();
        if (!ctx || !ctx.docId) {
            if (typeof showTtsToast === 'function') showTtsToast('Abra um livro da nuvem para anotar.');
            else if (typeof showNotification === 'function') showNotification('Abra um livro da nuvem para anotar.', true);
            return;
        }
        _noteEditId = opts.note ? opts.note.id : null;
        if (titleEl) titleEl.textContent = _noteEditId ? 'Editar anotação' : 'Nova anotação';
        if (meta) meta.textContent = (ctx.docTitle || 'Documento') + ' · Página ' + (ctx.page || 1);
        textEl.value = opts.note ? (opts.note.text || '') : '';
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(function() { textEl.focus(); }, 50);
    }

    function closeNoteModal() {
        var modal = document.getElementById('note-modal');
        var textEl = document.getElementById('note-modal-text');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
        if (textEl) textEl.value = '';
        _noteEditId = null;
    }

    function saveNoteFromModal() {
        var textEl = document.getElementById('note-modal-text');
        var meta = document.getElementById('note-modal-meta');
        if (!textEl) return;
        var text = String(textEl.value || '').trim();
        if (!text) {
            if (typeof showTtsToast === 'function') showTtsToast('Escreva algo na anotação.');
            return;
        }
        var ctx = getCurrentDocForNotes();
        var existing = null;
        if (_noteEditId) {
            var notes = loadNotes();
            for (var i = 0; i < notes.length; i++) {
                if (notes[i].id === _noteEditId) { existing = notes[i]; break; }
            }
        }
        if (existing) {
            upsertNote(Object.assign({}, existing, { text: text, updatedAt: new Date().toISOString() }));
        } else {
            if (!ctx || !ctx.docId) return;
            upsertNote({
                id: generateUUID(),
                docId: ctx.docId,
                docTitle: ctx.docTitle,
                page: ctx.page,
                text: text,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        closeNoteModal();
        if (typeof showTtsToast === 'function') showTtsToast('Anotação guardada');
        if (homeView || !pdfDoc) openHomeView('anotacoes');
    }

    /* Aba destacada só quando a Home está à vista — durante a leitura
       nenhuma aba fica ativa (o utilizador está no livro). */
    function updateHomeNavActive() {
        var onHome = !document.body.classList.contains('pdf-is-open');
        var navItems = document.querySelectorAll('.home-nav-item');
        for (var i = 0; i < navItems.length; i++) {
            var btn = navItems[i];
            var active = onHome && btn.getAttribute('data-home-nav') === homeActiveTab;
            if (active) {
                btn.classList.add('is-active');
                btn.setAttribute('aria-current', 'page');
            } else {
                btn.classList.remove('is-active');
                btn.removeAttribute('aria-current');
            }
        }
    }

    /* ══ Shell da aplicação ═══════════════════════════════════════
       Um único layout: cabeçalho + conteúdo + navegação persistente.
       showHome = sem PDF carregado, ou PDF carregado com a Home à vista. */
    function applyShellState() {
        var showHome = homeView || !pdfDoc;
        var welcome = document.getElementById('welcome');
        var renderArea = document.getElementById('pdf-render-area');
        var navControls = document.getElementById('nav-controls');
        /* classList.toggle com 2º argumento não é fiável em WebKit antigo (TVs) */
        if (showHome) document.body.classList.remove('pdf-is-open');
        else document.body.classList.add('pdf-is-open');
        if (welcome) {
            if (showHome) welcome.classList.remove('hidden');
            else welcome.classList.add('hidden');
        }
        if (renderArea) renderArea.style.display = showHome ? 'none' : '';
        if (navControls) {
            if (showHome || !pdfDoc) navControls.classList.add('hidden');
            else navControls.classList.remove('hidden');
        }
        syncChromeHiddenState();
        refreshHomeHero();
        updateHomeNavActive();
        updateSidebarLibraryActive();
    }

    function openHomeView(tab) {
        homeView = true;
        applyShellState();
        setHomeTab(tab || homeActiveTab);
        var viewer = document.getElementById('viewer-container');
        if (viewer) viewer.scrollTop = 0;
    }

    function openReaderView() {
        if (!pdfDoc) return;
        homeView = false;
        applyShellState();
        /* A área de render estava oculta: refazer o layout com a largura real */
        schedulePdfRelayout();
    }

    function setReaderTitle(title) {
        var el = document.getElementById('reader-book-title');
        if (el) el.textContent = title || 'Leitura';
    }

    function updateHomeContinue(row) {
        var rowEl = document.getElementById('home-continue-row');
        var empty = document.getElementById('home-continue-empty');
        if (!rowEl || !empty) return;
        if (!row) {
            rowEl.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }
        rowEl.classList.remove('hidden');
        empty.classList.add('hidden');
        var title = row.title || row.id;
        var titleEl = document.getElementById('home-continue-title');
        var metaEl = document.getElementById('home-continue-meta');
        var fillEl = document.getElementById('home-continue-progress-fill');
        var pctEl = document.getElementById('home-continue-pct');
        var coverEl = document.getElementById('home-continue-cover');
        if (titleEl) titleEl.textContent = title;
        var lp = row.last_page || 1;
        var np = row.num_pages;
        if (metaEl) metaEl.textContent = np ? ('Página ' + lp + ' de ' + np) : ('Página ' + lp);
        var pct = docProgressPct(row);
        if (fillEl) fillEl.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '% concluído';
        applyBookCoverEl(coverEl, title, row.id ? getCachedCover(row.id) : null);
        if (row.id) {
            coverEl.setAttribute('data-cover-doc', row.id);
            hydrateBookCover(row, coverEl);
        }
    }

    function normalizeSearchText(text) {
        return String(text || '').trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function rowMatchesSearch(row, qNorm) {
        if (!qNorm) return true;
        var title = normalizeSearchText(row.title || row.id || '');
        return title.indexOf(qNorm) !== -1;
    }

    function filterRowsBySearch(rows) {
        var q = normalizeSearchText(homeSearchQuery);
        if (!q) return rows || [];
        return (rows || []).filter(function(row) { return rowMatchesSearch(row, q); });
    }

    function applyHomeSearch(query) {
        homeSearchQuery = query != null ? String(query) : homeSearchQuery;
        var q = normalizeSearchText(homeSearchQuery);
        var visible = getNonTrashedRows(cloudLibraryRows);
        renderHomeCarousel(visible);
        renderHomeLibraryList(visible);
        var continueRow = document.getElementById('home-continue-row');
        var continueEmpty = document.getElementById('home-continue-empty');
        if (q) {
            if (continueRow) continueRow.classList.add('hidden');
            if (continueEmpty) continueEmpty.classList.add('hidden');
        } else {
            refreshHomeHero();
        }
    }

    function renderHomeCarousel(rows) {
        var carousel = document.getElementById('home-books-carousel');
        if (!carousel) return;
        carousel.innerHTML = '';
        var filtered = filterRowsBySearch(rows);
        var q = normalizeSearchText(homeSearchQuery);
        if (q && !filtered.length) {
            var searchEmpty = document.createElement('div');
            searchEmpty.className = 'home-search-empty';
            searchEmpty.textContent = 'Nenhum livro encontrado para \u201C' + homeSearchQuery.trim() + '\u201D';
            carousel.appendChild(searchEmpty);
        }
        filtered.forEach(function(row) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'home-book-item';
            btn.setAttribute('role', 'listitem');
            btn.setAttribute('data-book-title', (row.title || row.id || '').toLowerCase());
            var coverWrap = document.createElement('div');
            coverWrap.className = 'home-book-cover-wrap';
            var cover = document.createElement('span');
            cover.className = 'home-book-cover';
            hydrateBookCover(row, cover);
            var badge = document.createElement('span');
            badge.className = 'home-pdf-badge';
            badge.textContent = 'PDF';
            coverWrap.appendChild(cover);
            coverWrap.appendChild(badge);
            var label = document.createElement('span');
            label.className = 'home-book-title';
            label.textContent = row.title || row.id;
            var meta = document.createElement('span');
            meta.className = 'home-book-meta';
            meta.textContent = row.num_pages ? (row.num_pages + ' páginas') : 'PDF';
            var progress = document.createElement('div');
            progress.className = 'home-book-progress';
            var progressFill = document.createElement('div');
            progressFill.className = 'home-book-progress-fill';
            progressFill.style.width = docProgressPct(row) + '%';
            progress.appendChild(progressFill);
            btn.appendChild(coverWrap);
            btn.appendChild(label);
            btn.appendChild(meta);
            btn.appendChild(progress);
            btn.addEventListener('click', function() {
                openCloudDocumentById(row.id);
            });
            carousel.appendChild(btn);
        });
        if (!q) {
            var addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'home-book-add';
            addBtn.innerHTML = '<span class="home-book-add-box">'
                + '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>'
                + '</span><span class="home-book-add-label">Adicionar novo livro</span>';
            addBtn.addEventListener('click', function() {
                var fi = document.getElementById('file-input');
                if (fi) fi.click();
            });
            carousel.appendChild(addBtn);
        }
    }

    function renderHomeLibraryList(rows) {
        var list = document.getElementById('home-library-list');
        if (!list) return;
        list.innerHTML = '';
        rows = filterRowsForLibraryView(rows || []);
        if (!rows.length) {
            var empty = document.createElement('div');
            empty.className = 'home-library-empty';
            if (libraryViewMode === 'recent') {
                empty.textContent = 'Nenhum livro lido nos últimos ' + LIBRARY_RECENT_DAYS + ' dias.';
            } else {
                empty.textContent = 'Nenhum PDF na nuvem.';
            }
            list.appendChild(empty);
            return;
        }
        var filtered = filterRowsBySearch(rows);
        var q = normalizeSearchText(homeSearchQuery);
        if (q && !filtered.length) {
            var searchEmptyLib = document.createElement('div');
            searchEmptyLib.className = 'home-library-empty';
            searchEmptyLib.textContent = 'Nenhum livro encontrado para \u201C' + homeSearchQuery.trim() + '\u201D';
            list.appendChild(searchEmptyLib);
            return;
        }
        filtered.forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'home-library-item';
            item.setAttribute('role', 'listitem');
            var cover = document.createElement('span');
            cover.className = 'home-library-cover';
            hydrateBookCover(row, cover);
            var info = document.createElement('div');
            info.className = 'home-library-info';
            var h = document.createElement('p');
            h.className = 'home-library-title';
            h.textContent = row.title || row.id;
            var meta = document.createElement('p');
            meta.className = 'home-library-meta';
            var lp = row.last_page || 1;
            meta.textContent = row.num_pages ? ('Página ' + lp + ' de ' + row.num_pages) : ('Página ' + lp);
            info.appendChild(h);
            info.appendChild(meta);
            var openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'home-library-open';
            openBtn.textContent = 'Abrir';
            openBtn.addEventListener('click', function() {
                openCloudDocumentById(row.id);
            });
            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'home-library-del';
            delBtn.title = 'Mover para o lixeiro';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                moveToTrash(row.id, row.title || row.id);
            });
            var favBtn = createFavBtn(row);
            item.appendChild(cover);
            item.appendChild(info);
            if (favBtn) item.appendChild(favBtn);
            item.appendChild(openBtn);
            item.appendChild(delBtn);
            list.appendChild(item);
        });
    }

    function updateMiniPlayerFromDoc(row) {
        var mini = document.getElementById('home-mini-player');
        if (!mini) return;
        if (!row || document.body.classList.contains('pdf-is-open')) {
            mini.classList.add('hidden');
            document.body.classList.remove('has-mini-player');
            return;
        }
        mini.classList.remove('hidden');
        document.body.classList.add('has-mini-player');
        var titleEl = document.getElementById('home-mini-title');
        var fillEl = document.getElementById('home-mini-progress-fill');
        var thumbEl = document.getElementById('home-mini-thumb');
        var title = row.title || row.id;
        if (titleEl) titleEl.textContent = title;
        if (fillEl) fillEl.style.width = docProgressPct(row) + '%';
        applyBookCoverEl(thumbEl, title, row.id ? getCachedCover(row.id) : null);
        if (row.id) hydrateBookCover(row, thumbEl);
        var pageEl = document.getElementById('home-mini-page');
        var lp = row.last_page || 1;
        if (pageEl) pageEl.textContent = row.num_pages ? ('Página ' + lp + ' de ' + row.num_pages) : ('Página ' + lp);
        setMiniTtsIcon(!!(row.isOpen && isReading));
        updatePlayerSpeedLabel();
    }

    function updatePlayerSpeedLabel() {
        var el = document.getElementById('player-speed-label');
        var rate = document.getElementById('rate-range');
        if (el && rate) el.textContent = parseFloat(rate.value || '1').toFixed(1) + '×';
    }

    function filterHomeBooks(query) {
        applyHomeSearch(query);
    }

    function renderHomeFromCloudLibrary(rows) {
        cloudLibraryRows = rows || [];
        pruneStaleTrashIds();
        applyHomeSearch(homeSearchQuery);
        if (homeActiveTab === 'estatisticas') renderHomeStats();
        if (homeActiveTab === 'favoritos') renderHomeFavoritesList();
        if (homeActiveTab === 'anotacoes') renderHomeNotesList();
        if (homeActiveTab === 'lixeira') renderHomeTrashList();
    }

    /* O livro aberto tem prioridade no "Continue ouvindo" e no mini-player,
       mesmo que ainda não esteja guardado na nuvem. */
    function currentOpenBookRow() {
        if (!pdfDoc) return null;
        return {
            id: cloudDocumentId,
            title: currentBookTitle || lastOpenedFileName || 'Documento',
            last_page: currentPageNum || pageNum,
            num_pages: pdfDoc.numPages,
            isOpen: true
        };
    }

    function refreshHomeHero() {
        var featured = currentOpenBookRow() || pickFeaturedDoc(cloudLibraryRows);
        homeFeaturedDocId = featured ? featured.id : null;
        homeFeaturedIsOpen = !!(featured && featured.isOpen);
        updateHomeContinue(featured);
        updateMiniPlayerFromDoc(featured);
    }

    /* Arranca a voz assim que a página estiver renderizada (o toggle recusa
       durante o render). Tenta durante alguns segundos e desiste em silêncio. */
    function startTtsWhenReady(tries) {
        if (!pdfDoc) return;
        if (isRendering && (tries || 0) < 20) {
            setTimeout(function() { startTtsWhenReady((tries || 0) + 1); }, 300);
            return;
        }
        if (!isReading) toggleTTS();
    }

    /* ▶ na Home: toca o audiobook sem sair da Home.
       Se o livro em destaque ainda não está carregado, carrega-o em segundo
       plano (a Home continua à vista) e começa a ler quando estiver pronto. */
    function playFeaturedAudio() {
        _unlockAudio();
        if (pdfDoc && homeFeaturedIsOpen) {
            toggleTTS();
            return;
        }
        if (homeFeaturedDocId) {
            openCloudDocumentById(homeFeaturedDocId, { keepHome: true, autoPlay: true });
            return;
        }
        var fi = document.getElementById('file-input');
        if (fi) fi.click();
    }

    /* "Visualizar livro": única forma de abrir a página do PDF a partir da Home */
    function viewFeaturedDocument() {
        if (pdfDoc && homeFeaturedIsOpen) {
            openReaderView();
            return;
        }
        if (homeFeaturedDocId) openCloudDocumentById(homeFeaturedDocId);
    }

    function wireHomeUi() {
        if (window._homeUiBound) return;
        window._homeUiBound = true;
        var fileInput = document.getElementById('file-input');
        function openLocalPdf() {
            if (fileInput) fileInput.click();
        }
        var openBtns = ['home-btn-open-pdf', 'home-btn-open-pdf-account'];
        openBtns.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('click', openLocalPdf);
        });
        var cloudBtn = document.getElementById('home-btn-cloud');
        if (cloudBtn) cloudBtn.addEventListener('click', function() { openHomeView('biblioteca'); });
        var verTodos = document.getElementById('home-btn-ver-todos');
        if (verTodos) verTodos.addEventListener('click', function() { openHomeView('biblioteca'); });
        /* ▶ só toca — nunca navega para o leitor */
        var continuePlay = document.getElementById('home-continue-play');
        if (continuePlay) continuePlay.addEventListener('click', playFeaturedAudio);
        var miniTts = document.getElementById('home-mini-tts');
        if (miniTts) miniTts.addEventListener('click', playFeaturedAudio);
        /* Ver as páginas do PDF é uma acção explícita */
        var viewBtn = document.getElementById('home-btn-view-book');
        if (viewBtn) viewBtn.addEventListener('click', viewFeaturedDocument);
        var miniInfo = document.getElementById('home-mini-info');
        var miniThumb = document.getElementById('home-mini-thumb');
        if (miniInfo) miniInfo.addEventListener('click', viewFeaturedDocument);
        if (miniThumb) miniThumb.addEventListener('click', viewFeaturedDocument);
        var navItems = document.querySelectorAll('.home-nav-item');
        for (var i = 0; i < navItems.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    openHomeView(btn.getAttribute('data-home-nav'));
                });
            })(navItems[i]);
        }
        var sidebarSubs = document.querySelectorAll('.sidebar-sub-item[data-library-view]');
        for (var s = 0; s < sidebarSubs.length; s++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    setLibraryView(btn.getAttribute('data-library-view'));
                });
            })(sidebarSubs[s]);
        }
        var sidebarTrash = document.querySelectorAll('.sidebar-sub-item[data-home-nav="lixeira"]');
        for (var t = 0; t < sidebarTrash.length; t++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    openHomeView('lixeira');
                });
            })(sidebarTrash[t]);
        }
        var sidebarActions = document.querySelectorAll('[data-sidebar-action]');
        for (var a = 0; a < sidebarActions.length; a++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    var action = btn.getAttribute('data-sidebar-action');
                    if (action === 'estatisticas') openHomeView('estatisticas');
                    else if (typeof showTtsToast === 'function') showTtsToast('Em breve');
                });
            })(sidebarActions[a]);
        }
        var statsBtn = document.getElementById('home-btn-stats');
        if (statsBtn) statsBtn.addEventListener('click', function() { openHomeView('estatisticas'); });
        var statsBack = document.getElementById('stats-book-back');
        if (statsBack) statsBack.addEventListener('click', function() { selectBookStats(null); });
        var noteFloat = document.getElementById('btn-note-float');
        if (noteFloat) noteFloat.addEventListener('click', function() { openNoteModal(); });
        var noteCancel = document.getElementById('note-modal-cancel');
        if (noteCancel) noteCancel.addEventListener('click', closeNoteModal);
        var noteSave = document.getElementById('note-modal-save');
        if (noteSave) noteSave.addEventListener('click', saveNoteFromModal);
        var noteModal = document.getElementById('note-modal');
        if (noteModal) noteModal.addEventListener('click', function(e) {
            if (e.target === noteModal) closeNoteModal();
        });
        var topbarAdd = document.getElementById('topbar-add-pdf');
        if (topbarAdd) topbarAdd.addEventListener('click', openLocalPdf);
        var searchInput = document.getElementById('home-search');
        if (searchInput) {
            searchInput.addEventListener('input', function() { filterHomeBooks(searchInput.value); });
            searchInput.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    searchInput.value = '';
                    filterHomeBooks('');
                    searchInput.blur();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var q = normalizeSearchText(searchInput.value);
                    if (!q) return;
                    var matches = filterRowsBySearch(cloudLibraryRows);
                    if (matches.length) openHomeView('biblioteca');
                }
            });
        }
        var carousel = document.getElementById('home-books-carousel');
        var prevBtn = document.getElementById('home-books-prev');
        var nextBtn = document.getElementById('home-books-next');
        if (carousel && prevBtn) prevBtn.addEventListener('click', function() { carousel.scrollBy({ left: -300, behavior: 'smooth' }); });
        if (carousel && nextBtn) nextBtn.addEventListener('click', function() { carousel.scrollBy({ left: 300, behavior: 'smooth' }); });
        var playerPrev = document.getElementById('player-prev');
        var playerNext = document.getElementById('player-next');
        var playerMenu = document.getElementById('player-menu');
        if (playerPrev) playerPrev.addEventListener('click', function() { if (pdfDoc) changePage(-1); });
        if (playerNext) playerNext.addEventListener('click', function() { if (pdfDoc) changePage(1); });
        if (playerMenu) playerMenu.addEventListener('click', function() {
            if (typeof window._readEdyOpenSettings === 'function') window._readEdyOpenSettings();
        });
        var playerVol = document.getElementById('player-volume');
        if (playerVol) playerVol.addEventListener('input', function() {
            if (window.speechSynthesis && typeof speechSynthesis.volume !== 'undefined') {
                /* Web Speech API volume is per-utterance; guardamos preferência local */
                safeStorage.setItem('readera_volume', playerVol.value);
            }
        });
        var backBtn = document.getElementById('btn-reader-back');
        if (backBtn) backBtn.addEventListener('click', function() { openHomeView('inicio'); });
        var headerAccount = document.getElementById('home-header-account');
        if (headerAccount) headerAccount.addEventListener('click', function() { openHomeView('conta'); });
        var settingsBtn = document.getElementById('home-btn-settings');
        if (settingsBtn) settingsBtn.addEventListener('click', function() {
            if (typeof window._readEdyOpenSettings === 'function') window._readEdyOpenSettings();
        });
        wireThemeButtons();
        setHomeTab('inicio');
        renderHomeFromCloudLibrary([]);
        applyShellState();
    }

    function resetCloudLibraryTrigger() {
        var trigger = document.getElementById('cloud-library-trigger');
        if (trigger) trigger.textContent = 'PDFs';
    }

    function renderCloudLibraryList(rows) {
        var panel = document.getElementById('cloud-library-panel');
        if (!panel) return;
        panel.innerHTML = '';
        var list = getNonTrashedRows(rows || []);
        cloudLibraryCount = list.length;
        if (!list.length) {
            var empty = document.createElement('div');
            empty.className = 'cloud-library-empty';
            empty.textContent = 'Nenhum PDF na nuvem.';
            panel.appendChild(empty);
            updateCloudChrome();
            renderHomeFromCloudLibrary([]);
            return;
        }
        list.forEach(function(row) {
            var item = document.createElement('div');
            item.className = 'cloud-library-item';
            item.setAttribute('role', 'option');

            var openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'cloud-library-item-name';
            openBtn.textContent = row.title || row.id;
            openBtn.title = 'Abrir — última página: ' + (row.last_page || 1);
            openBtn.addEventListener('click', function() {
                openCloudDocumentById(row.id);
            });

            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'cloud-library-item-del';
            delBtn.title = 'Mover para o lixeiro';
            delBtn.setAttribute('aria-label', 'Mover ' + (row.title || row.id) + ' para o lixeiro');
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                moveToTrash(row.id, row.title || row.id);
            });

            item.appendChild(openBtn);
            item.appendChild(delBtn);
            panel.appendChild(item);
        });
        updateCloudChrome();
        renderHomeFromCloudLibrary(list);
    }

    function toggleCloudLibraryPanel() {
        if (!readeraSb) return;
        if (cloudLibraryPanelOpen) {
            closeCloudLibraryPanel();
            return;
        }
        cloudLibrarySuppressClose = true;
        setCloudLibraryPanelOpen(true);
        refreshCloudLibrary().catch(function() {});
        setTimeout(function() { cloudLibrarySuppressClose = false; }, 0);
    }

    function bindCloudLibraryUi() {
        var wrap = document.getElementById('cloud-library-wrap');
        var trigger = document.getElementById('cloud-library-trigger');
        if (!wrap || !trigger || trigger._cloudLibBound) return;
        trigger._cloudLibBound = true;
        var touchToggleLock = false;
        function onTriggerActivate(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            toggleCloudLibraryPanel();
        }
        trigger.addEventListener('click', function(e) {
            if (touchToggleLock) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            onTriggerActivate(e);
        });
        trigger.addEventListener('touchend', function(e) {
            e.preventDefault();
            e.stopPropagation();
            touchToggleLock = true;
            onTriggerActivate(e);
            setTimeout(function() { touchToggleLock = false; }, 450);
        }, { passive: false });
        if (!window._cloudLibraryOutsideBound) {
            window._cloudLibraryOutsideBound = true;
            document.addEventListener('click', function(e) {
                if (cloudLibrarySuppressClose) return;
                var panel = document.getElementById('cloud-library-panel');
                if (panel && panel.contains(e.target)) return;
                if (trigger && trigger.contains(e.target)) return;
                if (cloudLibraryPanelOpen) closeCloudLibraryPanel();
            });
            window.addEventListener('resize', function() {
                if (cloudLibraryPanelOpen) positionCloudLibraryPanel();
            });
        }
    }

    function initSupabaseClient() {
        var cfg = window.READERA_SUPABASE;
        var badge = document.getElementById('cloud-badge');
        if (!cfg || !cfg.url || !cfg.anonKey) {
            setCloudBadge('off', 'Nuvem desligada (sem config.js)');
            updateCloudPrefsVisibility();
            initTtsEngine();
            return;
        }
        var sb = window.supabase;
        /* Em TVs a biblioteca pode demorar mais para carregar — retry após 3 s */
        if (!sb || typeof sb.createClient !== 'function') {
            setCloudBadge('wait', 'Aguardando biblioteca da nuvem…');
            initTtsEngine();
            setTimeout(function() {
                var sb2 = window.supabase;
                if (!sb2 || typeof sb2.createClient !== 'function') {
                    setCloudBadge('error', 'Erro ao carregar biblioteca da nuvem');
                    updateCloudPrefsVisibility();
                    initTtsEngine();
                } else {
                    _doInitSupabase(cfg, sb2, badge);
                }
            }, 3000);
            return;
        }
        _doInitSupabase(cfg, sb, badge);
    }

    function _doInitSupabase(cfg, sb, badge) {
        try {
            readeraSb = sb.createClient(cfg.url, cfg.anonKey, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });
        } catch(e) {
            readeraSb = null;
            setCloudBadge('error', 'Erro ao iniciar cliente da nuvem');
            updateCloudPrefsVisibility();
            initTtsEngine();
            return;
        }
        setCloudBadge('on', 'Nuvem ligada — PDFs em Storage e metadados na base');
        if (!cloudUiBound) {
            cloudUiBound = true;
            document.getElementById('btn-cloud-save').addEventListener('click', savePdfToCloud);
            var delBtn = document.getElementById('btn-cloud-delete');
            if (delBtn) delBtn.addEventListener('click', deleteAllCloudDocuments);
            bindCloudLibraryUi();
        }
        refreshCloudLibrary().then(function() {
            updateCloudChrome();
            return tryResumeLastCloudDocument();
        }).catch(function(err) {
            var msg = String((err && (err.message || err.error_description)) || '');
            setCloudBadge('error', msg ? ('Erro de rede: ' + msg.slice(0, 180)) : 'Erro de rede na nuvem');
            console.error(err);
            showNotification('Nuvem: falhou ao ligar. Confira config.js e rede. ' + msg.slice(0, 120));
        }).then(function() {
            updateCloudPrefsVisibility();
            initTtsEngine();
        });
    }

    function pullUserPreferences() { return Promise.resolve(); }
    function schedulePushUserPreferences() { return; }
    function pushUserPreferences() { return Promise.resolve(); }

    function refreshCloudLibrary() {
        if (!readeraSb) return Promise.resolve();
        return readeraSb.from('documents')
            .select('id, title, storage_path, last_page, num_pages, bytes, created_at, updated_at')
            .order('updated_at', { ascending: false })
            .limit(50)
            .then(function(result) {
                var data = result.data, error = result.error;
                if (error) {
                    console.warn(error);
                    renderCloudLibraryList([]);
                    return;
                }
                renderCloudLibraryList(data || []);
                resetCloudLibraryTrigger();
            });
    }

    /* Corrida entre uma promise e um timeout fixo */
    function _raceTimeout(promise, ms, label) {
        return Promise.race([
            promise,
            new Promise(function(_, reject) {
                setTimeout(function() { reject(new Error((label || 'Download') + ' timeout após ' + ms / 1000 + 's')); }, ms);
            })
        ]);
    }

    function downloadPdfFromStoragePath(storagePath) {
        if (!storagePath || !readeraSb) {
            return Promise.reject(new Error('Caminho do arquivo inválido'));
        }
        var authHeaders = _supabaseAuthHeaders();
        var pubApiUrl   = _storagePdfApiUrl(storagePath, true);  /* /object/public/… */

        /* Fetch com AbortController + timeout */
        function fetchAb(url, headers, timeoutMs) {
            var ctrl  = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var timer = ctrl ? setTimeout(function() { try { ctrl.abort(); } catch(e) {} }, timeoutMs) : null;
            var opts  = { method: 'GET' };
            if (headers && Object.keys(headers).length) opts.headers = headers;
            if (ctrl) opts.signal = ctrl.signal;
            return fetch(url, opts).then(function(res) {
                if (timer) clearTimeout(timer);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.arrayBuffer();
            }, function(err) {
                if (timer) clearTimeout(timer);
                throw err;
            });
        }

        /* SDK download com race-timeout para evitar hang infinito */
        function sdkDownload() {
            return _raceTimeout(
                readeraSb.storage.from('pdfs').download(storagePath).then(function(result) {
                    if (result.error) throw result.error;
                    if (!result.data) throw new Error('Resposta vazia do Storage');
                    return _blobToArrayBuffer(result.data);
                }),
                15000, 'SDK download'
            );
        }

        /*
         * Ordem:
         *  1. fetch directo à API URL pública com auth (12 s) — rápido, evita redirect
         *  2. SDK Supabase com timeout de 15 s — usa XHR interno, funciona em TVs
         *  3. XHR manual (30 s) — último recurso
         */
        return fetchAb(pubApiUrl, authHeaders, 12000).catch(function(e1) {
            console.warn('[PDF] fetch directo falhou, tentando SDK:', e1 && e1.message);
            return sdkDownload();
        }).catch(function(e2) {
            console.warn('[PDF] SDK falhou, tentando XHR:', e2 && e2.message);
            return _downloadArrayBufferXhr(pubApiUrl, 30000, authHeaders);
        });
    }

    function openCloudDocumentById(id, opts) {
        if (!id || !readeraSb) return;
        opts = opts || {};
        var keepHome = !!opts.keepHome;
        var autoPlay = !!opts.autoPlay;
        var jumpPage = opts.jumpPage ? (opts.jumpPage | 0) : null;
        closeCloudLibraryPanel();
        /* Já é o livro carregado: não descarrega de novo */
        if (pdfDoc && cloudDocumentId === id) {
            if (jumpPage && jumpPage > 0 && jumpPage !== pageNum) {
                pageNum = jumpPage;
                currentPageNum = jumpPage;
                renderPage(pageNum);
                openReaderView();
            } else if (autoPlay) toggleTTS();
            else if (!keepHome) openReaderView();
            return;
        }
        var gen = ++cloudLoadGen;
        setAppLoading(true, 'Carregando PDF da nuvem…', 'pdf');
        teardownCurrentPdf();

        /* Safety net: garante que o ecrã de loading desaparece mesmo se a rede travar */
        var safetyTimer = setTimeout(function() {
            if (gen === cloudLoadGen) {
                setAppLoading(false);
                showNotification('Tempo esgotado ao carregar da nuvem. Verifique a ligação.', true);
            }
        }, 60000);

        readeraSb.from('documents').select('id, title, storage_path, last_page').eq('id', id).single()
            .then(function(result) {
                if (gen !== cloudLoadGen) return;
                var row = result.data, error = result.error;
                if (error || !row) throw error || new Error('Documento não encontrado');
                if (jumpPage) row = Object.assign({}, row, { last_page: jumpPage });
                return openCloudDocumentFromRow(row, true, gen, keepHome && !jumpPage).then(function() {
                    if (gen !== cloudLoadGen) return;
                    if (autoPlay) startTtsWhenReady(0);
                });
            }).catch(function(err) {
                if (gen !== cloudLoadGen) return;
                console.error(err);
                var msg = String((err && err.message) || err || 'Erro desconhecido');
                if (msg.indexOf('cancel') === -1) {
                    showNotification('Erro ao abrir da nuvem: ' + msg.slice(0, 120), true);
                }
            }).then(function() {
                clearTimeout(safetyTimer);
                if (gen === cloudLoadGen) setAppLoading(false);
            });
    }

    function openCloudDocumentFromRow(row, resetSelectValue, loadGen, startInHome) {
        if (loadGen == null) loadGen = cloudLoadGen;
        if (!row || !row.storage_path) {
            return Promise.reject(new Error('Documento sem arquivo na nuvem'));
        }
        return downloadPdfFromStoragePath(row.storage_path).then(function(buf) {
            if (loadGen !== cloudLoadGen) return Promise.reject(new Error('cancelled'));
            var byteLen = buf ? (buf.byteLength != null ? buf.byteLength : buf.size) : 0;
            if (!buf || !byteLen) throw new Error('Arquivo PDF vazio');
            lastOpenedFileName = row.title || 'documento.pdf';
            currentBookTitle = lastOpenedFileName;
            return loadPdfFromArrayBuffer(buf, {
                documentId: row.id,
                initialPage: row.last_page || 1,
                startInHome: !!startInHome
            }, loadGen);
        }).then(function() {
            if (loadGen !== cloudLoadGen) return;
            if (resetSelectValue) resetCloudLibraryTrigger();
        });
    }

    function tryResumeLastCloudDocument() {
        if (!readeraSb) return Promise.resolve();
        if (safeStorage.getItem(LS_RESUME_CLOUD) === '0') return Promise.resolve();
        var id = safeStorage.getItem(LS_LAST_CLOUD_DOC);
        if (!id) return Promise.resolve();
        return readeraSb.from('documents').select('id, title, storage_path, last_page').eq('id', id).maybeSingle()
            .then(function(result) {
                var row = result.data, error = result.error;
                if (error || !row) { persistLastCloudDocId(null); return; }
                var gen = ++cloudLoadGen;
                setAppLoading(true, 'Abrindo último PDF da nuvem…', 'pdf');

                /* Safety net */
                var safetyTimer = setTimeout(function() {
                    if (gen === cloudLoadGen) {
                        setAppLoading(false);
                        showNotification('Não foi possível retomar o último PDF. Tente abrir manualmente.', true);
                    }
                }, 60000);

                /* Retoma silenciosa: o livro fica pronto na Home ("Continue
                   ouvindo") em vez de saltar direto para a leitura. */
                return openCloudDocumentFromRow(row, false, gen, true).catch(function(err) {
                    console.warn('Retoma nuvem:', err);
                    persistLastCloudDocId(null);
                }).then(function() {
                    clearTimeout(safetyTimer);
                    if (gen === cloudLoadGen) setAppLoading(false);
                });
            });
    }

    function uploadPdfToCloudInternal(silent) {
        if (!readeraSb || !pdfDoc || !pdfCacheBytes) return Promise.reject(new Error('Sem PDF para enviar'));
        if (cloudDocumentId) return Promise.resolve(null);
        var docId = generateUUID();
        var path = 'readera/' + docId + '.pdf';
        var title = lastOpenedFileName || 'documento.pdf';
        return readeraSb.storage.from('pdfs').upload(path, pdfCacheBytes, { contentType: 'application/pdf', upsert: false })
            .then(function(r) {
                if (r.error) throw r.error;
                return readeraSb.from('documents').insert({
                    id: docId, title: title, storage_path: path,
                    bytes: pdfCacheBytes.byteLength, num_pages: pdfDoc.numPages, last_page: pageNum
                }).select('id').single();
            }).then(function(r) {
                if (r.error) throw r.error;
                cloudDocumentId = r.data.id;
                persistLastCloudDocId(r.data.id);
                return refreshCloudLibrary();
            }).then(function() {
                updateCloudChrome();
                if (!silent) showNotification('PDF guardado na nuvem.', false);
            });
    }

    function savePdfToCloud() {
        if (!readeraSb) { showNotification('Nuvem não está ligada. Verifique config.js.', true); return; }
        if (!pdfDoc || !pdfCacheBytes) { showNotification('Abra um PDF primeiro para guardar na nuvem.', true); return; }
        if (cloudDocumentId) { showNotification('Este PDF já está guardado na nuvem.', false); return; }
        setAppLoading(true, 'Enviando PDF para a nuvem…', 'upload');
        uploadPdfToCloudInternal(false).catch(function(err) {
            console.error(err);
            showNotification('Erro ao guardar na nuvem: ' + (err.message || err), true);
        }).then(function() {
            setAppLoading(false);
        });
    }

    function clearCloudLinkForDocument(id) {
        if (cloudDocumentId === id) {
            cloudDocumentId = null;
            if (pdfDoc) stopTTS({ resetBookmark: true });
        }
        if (safeStorage.getItem(LS_LAST_CLOUD_DOC) === id) persistLastCloudDocId(null);
        removeFavoriteId(id);
        removeNotesForDoc(id);
        removeFromTrash(id);
    }

    function deleteCloudDocumentById(id, title, fromTrash) {
        if (!readeraSb || !id) return;
        var label = title || id;
        var msg = fromTrash
            ? ('Apagar permanentemente?\n\n' + label + '\n\nEsta ação não pode ser desfeita.')
            : ('Remover da nuvem?\n\n' + label + '\n\nO ficheiro no Storage e o registo na base serão apagados.');
        if (!confirm(msg)) return;
        closeCloudLibraryPanel();
        setAppLoading(true, 'A apagar da nuvem…');
        readeraSb.from('documents').select('storage_path').eq('id', id).single()
            .then(function(r) {
                if (r.error || !r.data || !r.data.storage_path) throw r.error || new Error('Metadados do documento não encontrados');
                return readeraSb.storage.from('pdfs').remove([r.data.storage_path]);
            }).then(function(r) {
                if (r.error) throw r.error;
                return readeraSb.from('documents').delete().eq('id', id);
            }).then(function(r) {
                if (r.error) throw r.error;
                clearCloudLinkForDocument(id);
                removeFromTrash(id);
                return refreshCloudLibrary();
            }).then(function() {
                updateCloudChrome();
                showNotification('PDF removido da nuvem.', false);
            }).catch(function(err) {
                console.error(err);
                showNotification('Erro ao apagar na nuvem: ' + (err.message || err), true);
            }).then(function() {
                setAppLoading(false);
            });
    }

    function deleteAllCloudDocuments() {
        if (!readeraSb || cloudLibraryCount === 0) return;
        if (!confirm('Apagar TODOS os PDFs da nuvem?\n\nSerão removidos ' + cloudLibraryCount + ' ficheiro(s) no Storage e todos os registos na base de dados.\n\nEsta ação não pode ser desfeita.')) return;
        closeCloudLibraryPanel();
        setAppLoading(true, 'A apagar todos os PDFs da nuvem…');
        readeraSb.from('documents').select('id, storage_path')
            .then(function(r) {
                if (r.error) throw r.error;
                var rows = r.data || [];
                if (!rows.length) return { ids: [], paths: [] };
                var ids = rows.map(function(row) { return row.id; }).filter(Boolean);
                var paths = rows.map(function(row) { return row.storage_path; }).filter(Boolean);
                return readeraSb.storage.from('pdfs').remove(paths).then(function(sr) {
                    if (sr.error) throw sr.error;
                    return { ids: ids, paths: paths };
                });
            }).then(function(meta) {
                if (!meta || !meta.ids || !meta.ids.length) return;
                return readeraSb.from('documents').delete().in('id', meta.ids);
            }).then(function(r) {
                if (r && r.error) throw r.error;
                cloudDocumentId = null;
                persistLastCloudDocId(null);
                if (pdfDoc) stopTTS({ resetBookmark: true });
                return refreshCloudLibrary();
            }).then(function() {
                updateCloudChrome();
                showNotification('Todos os PDFs foram removidos da nuvem.', false);
            }).catch(function(err) {
                console.error(err);
                showNotification('Erro ao apagar todos na nuvem: ' + (err.message || err), true);
            }).then(function() {
                setAppLoading(false);
            });
    }

    function attemptAutoCloudSync() {
        if (!readeraSb || cloudDocumentId || !pdfCacheBytes || !pdfDoc) return;
        if (safeStorage.getItem(LS_AUTO_CLOUD) === '0') return;
        if (cloudSyncInFlight) return;
        cloudSyncInFlight = true;
        updateCloudChrome();
        var badge = document.getElementById('cloud-badge');
        setCloudBadge('pending', 'Nuvem: a enviar PDF…');
        uploadPdfToCloudInternal(true).then(function() {
            setCloudBadge('on', 'Nuvem ligada');
        }).catch(function(err) {
            console.warn('Auto-nuvem:', err);
            setCloudBadge('on', 'Nuvem ligada — toque em ☁️⬆ para guardar');
        }).then(function() {
            cloudSyncInFlight = false;
            updateCloudChrome();
        });
    }

    function loadPdfFromArrayBuffer(arrayBuffer, opts, loadGen) {
        if (loadGen == null) loadGen = cloudLoadGen;
        if (!pdfjsLib) {
            showNotification('PDF.js não está disponível. Verifique a ligação ou extensões do navegador.');
            if (loadGen === cloudLoadGen) setAppLoading(false);
            return Promise.resolve();
        }
        setAppLoading(true, 'Carregando PDF…');
        abortPdfLoadingTask();
        stopTTS({ resetBookmark: true });
        isRendering = false;
        renderGen++;
        var copy = arrayBuffer.slice ? arrayBuffer.slice(0) : arrayBuffer;
        var typedarray = new Uint8Array(copy);
        pdfCacheBytes = typedarray;
        pdfLoadingTask = pdfjsLib.getDocument({ data: typedarray });
        return pdfLoadingTask.promise.then(function(doc) {
            if (loadGen !== cloudLoadGen) {
                try { doc.destroy(); } catch (e) {}
                return Promise.reject(new Error('cancelled'));
            }
            if (pdfDoc && pdfDoc !== doc && pdfDoc.destroy) {
                try { pdfDoc.destroy(); } catch (e) {}
            }
            pdfDoc = doc;
            pdfLoadingTask = null;
            cloudDocumentId = opts && opts.documentId ? opts.documentId : null;
            var want = opts && opts.initialPage ? opts.initialPage : 1;
            pageNum = Math.min(Math.max(1, want), pdfDoc.numPages);
            currentPageNum = pageNum;
            currentBookTitle = lastOpenedFileName || 'Lendo Livro PDF';
            setReaderTitle(currentBookTitle);
            homeView = !!(opts && opts.startInHome);
            applyShellState();
            return renderPage(pageNum);
        }).then(function() {
            if (loadGen !== cloudLoadGen) return;
            warmUpTtsProxy();
            updateCloudChrome();
            if (cloudDocumentId) persistLastCloudDocId(cloudDocumentId);
            if (cloudDocumentId && pdfCacheBytes) ensureCoverForBytes(cloudDocumentId, pdfCacheBytes);
            if (!cloudDocumentId && pdfCacheBytes && readeraSb && safeStorage.getItem(LS_AUTO_CLOUD) !== '0') {
                attemptAutoCloudSync();
            }
        }).catch(function(err) {
            if (loadGen !== cloudLoadGen) return;
            var msg = String((err && err.message) || err || '');
            if (msg.indexOf('cancel') === -1) {
                showNotification('Erro ao abrir PDF: ' + msg.slice(0, 120), true);
            }
        }).then(function() {
            if (loadGen === cloudLoadGen) setAppLoading(false);
            if (!pdfDoc) applyShellState();
        });
    }

    fileInput.onchange = function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var gen = ++cloudLoadGen;
        persistLastCloudDocId(null);
        cloudDocumentId = null;
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

    function pauseTTS() {
        ttsStopRequested = true;
        isReading = false;
        currentUtterance = null;
        ensureTtsHighlightState();

        if (ttsEngine === 'proxy' && ttsAudioEl && ttsAudioEl.duration > 0) {
            var lenP = fullPageText.length || (ttsPageCache.text || '').length;
            if (lenP > 0) {
                var fracP = Math.max(0, Math.min(1, ttsAudioEl.currentTime / ttsAudioEl.duration));
                var charP = Math.floor((ttsProxyResumeFrac + fracP * (1 - ttsProxyResumeFrac)) * lenP);
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

    let _toastTimer = null;
    function showTtsToast(msg) {
        const el = document.getElementById('tts-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('visible');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(function() { el.classList.remove('visible'); }, 2800);
    }

    /* Notificação não-bloqueante (substitui alert() — funciona em TVs) */
    let _notifTimer = null;
    function showNotification(msg, isError) {
        const el = document.getElementById('app-notification');
        const txt = document.getElementById('app-notification-text');
        if (!el || !txt) { console.warn('[notify]', msg); return; }
        txt.textContent = msg;
        el.style.background = isError === false ? '#27ae60' : '#c0392b';
        el.style.display = 'flex';
        clearTimeout(_notifTimer);
        /* Auto-fechar após 6 s para erros, 3 s para sucesso */
        _notifTimer = setTimeout(function() { el.style.display = 'none'; }, isError === false ? 3000 : 6000);
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
    window.toggleTTS = toggleTTS;

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
            if (continuous && hasNext) {
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

    var readeraResizeTimer = null;
    window.addEventListener('resize', function() {
        if (!pdfDoc || isReading || speakLock) return;
        clearTimeout(readeraResizeTimer);
        readeraResizeTimer = setTimeout(function() {
            renderPage(pageNum, true);
        }, 280);
    });

    function updateLayoutToggleVisible() {
        applyShellState();
    }

    /* Modo leitura larga: PDF usa o lado longo do ecrã, texto permanece horizontal */
    function toggleVirtualLandscape() {
        var appContainer = document.getElementById('app-container');
        var btnLayout = document.getElementById('btn-toggle-layout');
        if (!appContainer) return;

        var ativar = !appContainer.classList.contains('forced-landscape');
        if (ativar) {
            appContainer.classList.add('forced-landscape');
            if (btnLayout) {
                btnLayout.textContent = '↩';
                btnLayout.title = 'Voltar ao tamanho normal da página';
                btnLayout.setAttribute('aria-label', 'Voltar ao tamanho normal');
            }
        } else {
            appContainer.classList.remove('forced-landscape');
            if (btnLayout) {
                btnLayout.textContent = '↔';
                btnLayout.title = 'Modo leitura larga (página em tela cheia)';
                btnLayout.setAttribute('aria-label', 'Modo leitura larga');
            }
        }

        if (typeof renderPage !== 'function' || !pdfDoc) return;

        function relayoutPdf() {
            renderPage(currentPageNum, isReading);
        }

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    setTimeout(relayoutPdf, 50);
                    setTimeout(relayoutPdf, 250);
                });
            });
        } else {
            setTimeout(relayoutPdf, 100);
            setTimeout(relayoutPdf, 350);
        }
    }

    var btnToggleLayout = document.getElementById('btn-toggle-layout');
    if (btnToggleLayout) {
        btnToggleLayout.addEventListener('click', toggleVirtualLandscape);
    }

    function applyPdfZoom(delta) {
        var next = Math.round((pdfZoom + delta) * 10) / 10;
        next = Math.max(PDF_ZOOM_MIN, Math.min(PDF_ZOOM_MAX, next));
        if (next === pdfZoom) return;
        pdfZoom = next;
        safeStorage.setItem(LS_PDF_ZOOM, String(pdfZoom));
        var btnOut = document.getElementById('btn-zoom-out');
        var btnIn  = document.getElementById('btn-zoom-in');
        if (btnOut) btnOut.disabled = pdfZoom <= PDF_ZOOM_MIN;
        if (btnIn)  btnIn.disabled  = pdfZoom >= PDF_ZOOM_MAX;
        schedulePdfRelayout();
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

    var btnTtsSkipBack = document.getElementById('btn-tts-skip-back');
    var btnTtsSkipFwd = document.getElementById('btn-tts-skip-fwd');
    if (btnTtsSkipBack) {
        btnTtsSkipBack.addEventListener('click', function() { skipTtsBySeconds(-TTS_SKIP_SECONDS); });
    }
    if (btnTtsSkipFwd) {
        btnTtsSkipFwd.addEventListener('click', function() { skipTtsBySeconds(TTS_SKIP_SECONDS); });
    }

    window.addEventListener('resize', function() {
        updateLayoutToggleVisible();
    });

    initSupabaseClient();
    wireHomeUi();
