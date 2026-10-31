/* ═══════════════════════════════════════════════════════════════
   ReadEdy · ui/layout
   Layout (paisagem virtual), zoom do PDF e visibilidade dos botões de layout.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

var readeraResizeTimer = null;

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
