/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/highlight
   Texto da página, camada de texto do PDF e tarja amarela da leitura.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

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
