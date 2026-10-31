/* ═══════════════════════════════════════════════════════════════
   ReadEdy · reader/pdf-loader
   Carregamento do PDF (arquivo/ArrayBuffer) e encerramento do documento atual.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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
            try { attemptAutoCloudSync(); } catch (syncErr) { console.warn('Auto-nuvem:', syncErr); }
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
