/* ═══════════════════════════════════════════════════════════════
   ReadEdy · features/ocr
   OCR (Tesseract.js) sob demanda para páginas sem texto.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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

var _ocrQueue = Promise.resolve();

function runOcrOnPage(page, num, reason) {
    if (!canUsePremiumFeatures()) {
        showTtsToast('OCR requer login e plano ativo.');
        return Promise.resolve({ text: '', ranges: [], fromOcr: true });
    }
    if (ocrPageCache[num]) {
        return Promise.resolve({ text: ocrPageCache[num], ranges: [], fromOcr: true });
    }
    var job = _ocrQueue.then(function() {
        if (ocrPageCache[num]) {
            return { text: ocrPageCache[num], ranges: [], fromOcr: true };
        }
        return _recognizePage(page, num, reason);
    });
    _ocrQueue = job.then(function() { return null; }, function() { return null; });
    return job;
}

function _recognizePage(page, num, reason) {
    var scale = 2;
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    var ctx = canvas.getContext('2d');
    showTtsToast(reason === 'encoded'
        ? 'Este PDF não tem texto legível. Reconhecendo a página…'
        : 'PDF escaneado — reconhecendo texto…');
    return page.render({ canvasContext: ctx, viewport: viewport }).promise
        .then(function() { return ensureTesseract(); })
        .then(function(worker) { return worker.recognize(canvas); })
        .then(function(result) {
            var text = (result.data && result.data.text) ? result.data.text.trim() : '';
            ocrPageCache[num] = text;
            return { text: text, ranges: [], fromOcr: true };
        });
}
