/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/engine
   Motor de voz: preferência (nuvem/navegador), desbloqueio de áudio, vozes Edge, warm-up.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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
        if (ttsProxyUrl && window.ReadEdyAuth && ReadEdyAuth.isLoggedIn()
            && window.ReadEdyBilling && ReadEdyBilling.isActive()) return 'proxy';
        if (_wsSynth) return 'webspeech';
        if (ttsProxyUrl) return null;
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
            if (window.ReadEdyAuth && !ReadEdyAuth.isLoggedIn()) {
                hint.textContent = 'Faça login para TTS na nuvem — a usar Navegador.';
            } else if (window.ReadEdyBilling && !ReadEdyBilling.isActive()) {
                hint.textContent = 'Assinatura inativa — a usar Navegador (gratuito).';
            } else {
                hint.textContent = 'Backend indisponível neste momento — a usar Navegador.';
            }
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

/* Aquece o worker Deno da Edge Function para eliminar cold-start na primeira leitura.
   Chamado depois de um PDF abrir. Usa fetch silencioso (ignora erros). */
var _ttsWarmUpDone = false;

function warmUpTtsProxy() {
    if (_ttsWarmUpDone || ttsEngine !== 'proxy' || !ttsProxyUrl) return;
    var cfg = window.READERA_SUPABASE;
    if (!cfg || !cfg.anonKey) return;
    if (!window.ReadEdyAuth || !ReadEdyAuth.getAccessToken()) return;
    _ttsWarmUpDone = true;
    var url = ttsProxyUrl + '?text=.&voice=pt-BR-FranciscaNeural&rate=1'
        + '&apikey=' + encodeURIComponent(cfg.anonKey)
        + '&access_token=' + encodeURIComponent(ReadEdyAuth.getAccessToken());
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

var ttsEngineSelect = document.getElementById('tts-engine-select');
