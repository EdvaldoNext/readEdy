/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/rate
   Velocidade da voz (playbackRate) e mapa tempo→texto usado pela tarja.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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

/* Carregar velocidade salva */
var _savedRate = safeStorage.getItem(_RATE_KEY);

function _ttsRate() {
    var r = rateRange ? Number(rateRange.value) : 1;
    return (isFinite(r) && r > 0) ? r : 1;
}

/* Velocidade da voz da nuvem aplicada NO PLAYER (playbackRate), igual para qualquer motor TTS.
   O servidor sempre sintetiza a 1.0×: Google Translate / StreamElements ignoram "rate", e assim
   o áudio fica idêntico em todas as velocidades (sem nova requisição ao trocar a velocidade).
   Nota: definir/alterar o src reseta playbackRate para defaultPlaybackRate — por isso ambos são definidos. */
var TTS_SERVER_RATE = 1;

function _applyTtsPlaybackRate(el) {
    if (!el) return;
    var r = _ttsRate();
    try { el.defaultPlaybackRate = r; } catch (e) {}
    try { el.playbackRate = r; } catch (e) {}
    try { el.preservesPitch = true; } catch (e) {}
    try { el.mozPreservesPitch = true; } catch (e) {}
    try { el.webkitPreservesPitch = true; } catch (e) {}
}

function _applyTtsPlaybackRateAll() {
    _applyTtsPlaybackRate(ttsAudioEl);
    _applyTtsPlaybackRate(ttsPrefetchAudioEl);
}

/* Mapa tempo→texto: a voz faz pausas em pontuação, então cada caractere pesa 1 e pontuação
   soma "caracteres equivalentes" de pausa. Muito mais fiel que a proporção linear simples. */
var _ttsTimeMapText = null;

var _ttsTimeMapCum = null;

function _ttsGetTimeMap(text) {
    if (_ttsTimeMapText === text && _ttsTimeMapCum) return _ttsTimeMapCum;
    var n = text.length;
    var cum = new Array(n + 1);
    var acc = 0;
    for (var i = 0; i < n; i++) {
        cum[i] = acc;
        var c = text.charAt(i);
        var w = 1;
        var nx = i + 1 < n ? text.charAt(i + 1) : ' ';
        var boundary = (nx === ' ' || nx === '\n' || nx === '\t');
        if (c === '\n') w += 5;
        else if (boundary) {
            if ('.!?\u2026'.indexOf(c) !== -1) w += 8;
            else if (',;:'.indexOf(c) !== -1) w += 3;
        }
        acc += w;
    }
    cum[n] = acc;
    _ttsTimeMapText = text;
    _ttsTimeMapCum = cum;
    return cum;
}

/* Posição (índice de caractere) do texto da página para um progresso 0..1 do áudio atual.
   Áudio fatiado (ttsProxyCharOffset > 0) cobre só o trecho final do texto. */
function _ttsCharFromProgress(progress, text) {
    var n = text ? text.length : 0;
    if (n <= 0) return 0;
    var p = Number(progress);
    if (!(p > 0)) p = 0;
    if (p > 1) p = 1;
    var base = (ttsProxyCharOffset > 0 && ttsProxyCharOffset < n) ? (ttsProxyCharOffset | 0) : 0;
    var cum = _ttsGetTimeMap(text);
    var target = cum[base] + p * (cum[n] - cum[base]);
    var lo = base, hi = n - 1, res = base;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (cum[mid] <= target) { res = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return res;
}
