/* ═══════════════════════════════════════════════════════════════
   ReadEdy · core/polyfills
   Telemetria de erros e polyfills (TVs / navegadores antigos). Precisa carregar primeiro.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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
