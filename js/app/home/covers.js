/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/covers
   Capas dos livros (geração e cache).
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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
