/* ═══════════════════════════════════════════════════════════════
   ReadEdy · core/utils
   Utilitários: XHR/Storage helpers, safeStorage, UUID, rastreio de visitas.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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
    var headers = _supabaseAuthHeaders();
    headers['Content-Type'] = 'application/json';
    return _xhrRequest('POST', endpoint,
        headers,
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
    if (window.ReadEdyAuth && ReadEdyAuth.authHeaders) return ReadEdyAuth.authHeaders();
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

function getVisitorId() {
    var key = 'readedy_visitor_id';
    try {
        var id = localStorage.getItem(key);
        if (id) return id;
        id = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(key, id);
        return id;
    } catch (e) {
        return 'v_anon';
    }
}

function trackSiteVisit() {
    var cfg = window.READERA_SUPABASE;
    if (!cfg || !cfg.url || !cfg.anonKey) return;
    var token = (window.ReadEdyAuth && ReadEdyAuth.isLoggedIn())
        ? ReadEdyAuth.getAccessToken() : cfg.anonKey;
    var url = cfg.url.replace(/\/$/, '') + '/functions/v1/track-visit';
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': cfg.anonKey,
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
            visitor_id: getVisitorId(),
            path: window.location.pathname + window.location.search,
            referrer: document.referrer || ''
        })
    }).catch(function() {});
}
