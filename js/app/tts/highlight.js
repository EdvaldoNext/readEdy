/* ═══════════════════════════════════════════════════════════════
   ReadEdy · tts/highlight
   Texto da página, camada de texto do PDF e sublinhado da leitura.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* PDFs antigos (Word/Ghostscript) desenham as letras numa fonte simbólica.
   O texto extraído vira caracteres de controle e símbolos — a voz diz
   "asterisco", "por cento", "barra". Isso não é prosa. */
function isSpeechReadable(text) {
    var s = String(text || '');
    var letters = 0;
    var noise = 0;
    var other = 0;
    var symbols = '*%#_^~\\|';
    for (var i = 0; i < s.length; i++) {
        var code = s.charCodeAt(i);
        if (code === 9 || code === 10 || code === 13 || code === 32) continue;
        var ch = s.charAt(i);
        if (code < 32 || (code >= 0x7F && code <= 0x9F) || (code >= 0xE000 && code <= 0xF8FF) || symbols.indexOf(ch) !== -1) {
            noise++;
        } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 192 && code <= 687 && code !== 215 && code !== 247)) {
            letters++;
        } else {
            other++;
        }
    }
    var signal = letters + noise + other;
    if (signal < 12) return letters >= 8;
    if (noise >= 8 && noise > letters * 0.08) return false;
    if (letters / signal < 0.62) return false;
    return true;
}

/* Prepara o texto que a voz recebe. Ponto, vírgula, ? e ! ficam colados na
   palavra — a voz pausa neles e não diz o nome do sinal. Sai o que uma leitura
   em voz alta não diz: marcador, travessão, aspas, linha de sumário, URL,
   hífen de quebra de linha e número de página na margem. */
function cleanItemForSpeech(raw) {
    var s = String(raw || '');
    s = s.replace(/[\u00AD\u200B\u200C\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    s = s.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '');
    s = s.replace(/https?:\/\/[^\s]+/gi, ' link ');
    s = s.replace(/\bwww\.[^\s]+/gi, ' link ');
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' e-mail ');
    s = s.replace(/(\d)\s*[–—]\s*(\d)/g, '$1 a $2');
    s = s.replace(/[–—]/g, ', ');
    s = s.replace(/[“”«»„‟]/g, '');
    s = s.replace(/([0-9A-Za-zÀ-ÿ])['’]([0-9A-Za-zÀ-ÿ])/g, '$1\u0001$2');
    s = s.replace(/[“”«»„‟"'’‘]/g, '');
    s = s.replace(/\u0001/g, "'");
    s = s.replace(/[•·▪◦‣⁃●○■□►▸]/g, ' ');
    s = s.replace(/[*#~^_|\\/]/g, ' ');
    s = s.replace(/[()[\]{}]/g, ', ');
    s = s.replace(/\u2026+/g, '...');
    /* Quatro pontos ou mais é linha de sumário. Três é reticência e a pausa fica. */
    s = s.replace(/\.(?:\s*\.){3,}/g, ' ');
    s = s.replace(/\.(?:\s*\.){2}/g, '...');
    s = s.replace(/\s+([.,;:!?])/g, '$1');
    s = s.replace(/^\s*[-\u2010]\s+(?=\D)/, '');
    s = s.replace(/^\s*[-\u2010](?=[A-Za-zÀ-ÿ])/, '');
    s = s.replace(/^\s*,\s+/, '');
    s = s.replace(/\s{2,}/g, ' ');
    return s.trim();
}

function isDecorativeSpeech(s) {
    var t = String(s || '').trim();
    if (!t) return true;
    if (t === '...' || /^[,.;:!?]+$/.test(t)) return false;
    if (/^[•·▪◦‣⁃●○■□►▸]$/.test(t)) return true;
    if (/^[\s.\u00b7•\-_=*~#|\\…]{2,}$/.test(t)) return true;
    return false;
}

function startsWithLower(s) {
    var ch = String(s || '').charAt(0);
    if (!ch) return false;
    return ch !== ch.toUpperCase() && ch === ch.toLowerCase();
}

function isPageNumberSpeech(s) {
    var t = String(s || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 16) return false;
    return /^(?:p[aá]g\.?\s*)?[-.]?\s*\d{1,4}\s*[-.]?$/i.test(t);
}

function itemFontH(item) {
    var t = item && item.transform;
    if (!t) return 0;
    return Math.abs(t[3]) || Math.hypot(t[2] || 0, t[3] || 0) || 0;
}

function isVisualLineBreak(prev, curr) {
    if (!prev || !curr) return false;
    if (prev.hasEOL) return true;
    var pt = prev.item && prev.item.transform;
    var ct = curr.item && curr.item.transform;
    if (!pt || !ct) return false;
    var fontH = Math.abs(pt[3]) || 10;
    var dy = pt[5] - ct[5];
    return dy > fontH * 0.45 && ct[4] < pt[4] - fontH * 0.5;
}

function groupSpeechLines(entries) {
    var lines = [];
    var cur = [];
    for (var i = 0; i < entries.length; i++) {
        if (cur.length && isVisualLineBreak(cur[cur.length - 1], entries[i])) {
            lines.push(cur);
            cur = [];
        }
        cur.push(entries[i]);
    }
    if (cur.length) lines.push(cur);
    return lines;
}

function lineRawText(line) {
    var parts = [];
    for (var i = 0; i < line.length; i++) {
        parts.push(line[i].item && line[i].item.str != null ? String(line[i].item.str) : '');
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function lineFont(line) {
    var h = 0;
    for (var i = 0; i < line.length; i++) h = Math.max(h, itemFontH(line[i].item));
    return h;
}

function dropEdgePageNumbers(lines) {
    if (lines.length < 2) return lines;
    var fonts = [];
    for (var i = 0; i < lines.length; i++) fonts.push(lineFont(lines[i]));
    var sorted = fonts.slice().sort(function(a, b) { return a - b; });
    var med = sorted[Math.floor(sorted.length / 2)] || 10;
    function droppable(line) {
        return isPageNumberSpeech(lineRawText(line)) && lineFont(line) <= med * 1.05;
    }
    var start = 0;
    var end = lines.length;
    if (droppable(lines[0])) start = 1;
    if (end - start > 1 && droppable(lines[end - 1])) end -= 1;
    if (start === 0 && end === lines.length) return lines;
    return lines.slice(start, end);
}

function sameLineGapIsTight(prevItem, currItem) {
    var pt = prevItem && prevItem.transform;
    var ct = currItem && currItem.transform;
    if (!pt || !ct) return false;
    var fontH = Math.abs(pt[3]) || 10;
    var prevW = (prevItem.width != null ? prevItem.width : 0) * (Math.hypot(pt[0], pt[1]) || 1);
    var gap = ct[4] - (pt[4] + prevW);
    return gap >= 0 && gap < fontH * 0.3;
}

function isFootnoteMarker(entry, prevEntry) {
    if (!entry || !prevEntry) return false;
    var s = String(entry.item.str || '').replace(/\s+/g, '');
    if (!/^\d{1,3}$/.test(s)) return false;
    var ph = itemFontH(prevEntry.item) || 10;
    var ch = itemFontH(entry.item);
    return ch > 0 && ch < ph * 0.75;
}

/* Junta frases de OCR (sem mapa de sublinhado) com as mesmas regras. */
function normalizeSpeechText(text) {
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    var out = '';
    var hangHyphen = false;
    function push(piece) {
        if (!piece) return;
        if (!out) { out = piece; return; }
        if (/^[.,;:!?]/.test(piece)) {
            out = out.replace(/[ \t]+$/, '');
            while (piece.charAt(0) === '.' && out.charAt(out.length - 1) === '.') piece = piece.slice(1);
            if (piece.charAt(0) === ',' && out.charAt(out.length - 1) === ',') piece = piece.replace(/^,\s*/, '');
            if (piece) out += piece;
            return;
        }
        if (out.charAt(out.length - 1) !== ' ') out += ' ';
        out += piece;
    }
    for (var i = 0; i < lines.length; i++) {
        var piece = cleanItemForSpeech(lines[i]);
        if (!piece || isDecorativeSpeech(piece)) {
            if (/[-\u2010]\s*$/.test(lines[i])) hangHyphen = true;
            continue;
        }
        if (/^[-\u2010]$/.test(piece)) { hangHyphen = true; continue; }
        var broken = hangHyphen || /[-\u2010]$/.test(out);
        if (broken && startsWithLower(piece)) {
            out = out.replace(/[-\u2010]\s*$/, '') + piece;
        } else if (broken && /[-\u2010]$/.test(out)) {
            out += piece;
        } else {
            push(piece);
        }
        hangHyphen = false;
    }
    return out.replace(/[ \t]{2,}/g, ' ').trim();
}

function rawPageText(items) {
    var text = '';
    for (var i = 0; i < items.length; i++) {
        var s = items[i] && items[i].str != null ? String(items[i].str) : '';
        if (!s) continue;
        if (text) text += ' ';
        text += s;
    }
    return text;
}

function buildTtsTextAndRanges(items) {
    /* Fonte simbólica continua rejeitada pelo texto cru, antes da limpeza.
       Senão, ao tirar os símbolos, o lixo pareceria prosa e seria lido. */
    var raw = rawPageText(items);
    if (!isSpeechReadable(raw)) return { text: raw, ranges: [] };

    var entries = [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i] || {};
        var src = item.str != null ? String(item.str) : '';
        if (!src.length) continue;
        entries.push({ index: i, item: item, hasEOL: !!item.hasEOL, piece: cleanItemForSpeech(src) });
    }
    var lines = dropEdgePageNumbers(groupSpeechLines(entries));
    var text = '';
    var ranges = [];
    var prevEntry = null;
    var hangHyphen = false;
    var glueNext = false;

    function appendMapped(piece, itemIndex) {
        if (!piece) return;
        var start = text.length;
        text += piece;
        ranges.push({ start: start, end: text.length, itemIndex: itemIndex });
    }

    function fitPiece(piece) {
        if (!piece || !text) return piece || '';
        if (/^[.,;:!?]/.test(piece) && text.charAt(text.length - 1) === ' ') text = text.slice(0, -1);
        while (piece && piece.charAt(0) === '.' && text.charAt(text.length - 1) === '.') piece = piece.slice(1);
        if (piece && piece.charAt(0) === ',' && text.charAt(text.length - 1) === ',') piece = piece.replace(/^,\s*/, '');
        return piece;
    }

    function stripTrailingHyphen() {
        var m = text.match(/[ \t]*[-\u2010]$/);
        if (!m) return;
        var cut = m[0].length;
        text = text.slice(0, -cut);
        while (ranges.length && cut > 0) {
            var last = ranges[ranges.length - 1];
            var span = last.end - last.start;
            if (span <= cut) {
                cut -= span;
                ranges.pop();
            } else {
                last.end -= cut;
                cut = 0;
            }
        }
    }

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var atLineStart = true;
        for (var j = 0; j < line.length; j++) {
            var entry = line[j];
            var piece = entry.piece;
            if (!piece || isDecorativeSpeech(piece)) continue;
            if (!atLineStart && isFootnoteMarker(entry, prevEntry)) {
                prevEntry = entry;
                continue;
            }
            var endOfLinePiece = entry.hasEOL || j === line.length - 1;
            if (/^[-\u2010]$/.test(piece) && !atLineStart && !endOfLinePiece) {
                if (text.charAt(text.length - 1) === ' ') text = text.slice(0, -1);
                appendMapped(piece, entry.index);
                glueNext = true;
                prevEntry = entry;
                atLineStart = false;
                continue;
            }
            if (/^[-\u2010]$/.test(piece) && (atLineStart || endOfLinePiece)) {
                hangHyphen = true;
                prevEntry = entry;
                atLineStart = false;
                continue;
            }
            if (glueNext && text) {
                piece = fitPiece(piece);
                appendMapped(piece, entry.index);
                glueNext = false;
                hangHyphen = false;
                atLineStart = false;
                prevEntry = entry;
                continue;
            }
            if (!text) {
                piece = piece.replace(/^[,\s]+/, '');
                if (!piece) { prevEntry = entry; continue; }
                appendMapped(piece, entry.index);
            } else if (hangHyphen && startsWithLower(piece)) {
                appendMapped(piece, entry.index);
            } else if (hangHyphen) {
                appendMapped('-', prevEntry ? prevEntry.index : entry.index);
                piece = fitPiece(piece);
                appendMapped(piece, entry.index);
            } else if (atLineStart && /[-\u2010]$/.test(text) && startsWithLower(piece)) {
                stripTrailingHyphen();
                appendMapped(piece, entry.index);
            } else if (atLineStart && /[-\u2010]$/.test(text)) {
                piece = fitPiece(piece);
                appendMapped(piece, entry.index);
            } else {
                var tight = !atLineStart && prevEntry && sameLineGapIsTight(prevEntry.item, entry.item);
                var prevPiece = prevEntry && prevEntry.piece ? prevEntry.piece : '';
                if (!atLineStart && prevPiece.length <= 2 && piece.length <= 2 && !/^[.,;:!?]/.test(piece)) tight = true;
                if (/^[.,;:!?]/.test(piece)) tight = true;
                var addedSpace = false;
                if (!tight && text.charAt(text.length - 1) !== ' ') {
                    text += ' ';
                    addedSpace = true;
                }
                piece = fitPiece(piece);
                if (!piece) {
                    if (addedSpace && text.charAt(text.length - 1) === ' ') text = text.slice(0, -1);
                    prevEntry = entry;
                    continue;
                }
                appendMapped(piece, entry.index);
            }
            hangHyphen = false;
            atLineStart = false;
            prevEntry = entry;
        }
        glueNext = false;
    }
    text = text.replace(/[ \t]+$/, '');
    return { text: text, ranges: ranges };
}

function highlightSpeechText() {
    if (fullPageText && fullPageText.length) return fullPageText;
    if (ttsPageCache && ttsPageCache.pageNum === pageNum && ttsPageCache.text) return ttsPageCache.text;
    return '';
}

function isSpeechSpace(ch) {
    return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

/* Palavra falada que contém este índice. Espaço entre palavras cai na seguinte. */
function speechWordAt(text, charIndex) {
    var n = text ? text.length : 0;
    if (!n) return null;
    var i = charIndex | 0;
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    if (isSpeechSpace(text.charAt(i))) {
        var fwd = i;
        while (fwd < n && isSpeechSpace(text.charAt(fwd))) fwd++;
        if (fwd < n) i = fwd;
        else {
            while (i > 0 && isSpeechSpace(text.charAt(i - 1))) i--;
            if (i > 0) i--;
        }
    }
    var start = i;
    while (start > 0 && !isSpeechSpace(text.charAt(start - 1))) start--;
    var end = i + 1;
    while (end < n && !isSpeechSpace(text.charAt(end))) end++;
    if (end <= start) return null;
    return { start: start, end: end };
}

/* Largura relativa: o risco acompanha o desenho da palavra, não só a contagem de letras. */
function speechCharWeight(ch) {
    if (isSpeechSpace(ch)) return 0.35;
    if ('ilíìïĩI|\'´`’.,:;!¡'.indexOf(ch) !== -1) return 0.42;
    if ('tfjr'.indexOf(ch) !== -1) return 0.58;
    if ('mwMW@%'.indexOf(ch) !== -1) return 1.45;
    var code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) return 1.12;
    return 1;
}

function speechSliceWeight(text, from, to) {
    var n = text ? text.length : 0;
    if (from < 0) from = 0;
    if (to > n) to = n;
    var w = 0;
    for (var i = from; i < to; i++) w += speechCharWeight(text.charAt(i));
    return w;
}

function clearSpanWordMarks(el) {
    if (!el) return;
    if (el.classList) el.classList.remove('tts-active');
    var marks = el.querySelectorAll ? el.querySelectorAll('.tts-word-mark') : [];
    for (var i = marks.length - 1; i >= 0; i--) {
        if (marks[i].parentNode) marks[i].parentNode.removeChild(marks[i]);
    }
}

function clearPdfHighlight() {
    ttsPdfHighlightLast = { start: -1, end: -1 };
    if (!pdfTextLayerSpans) return;
    Object.keys(pdfTextLayerSpans).forEach(function(k) {
        clearSpanWordMarks(pdfTextLayerSpans[k]);
    });
}

function placeWordMark(span, leftPct, widthPct) {
    if (!(widthPct > 0)) return;
    var mark = document.createElement('span');
    mark.className = 'tts-word-mark';
    mark.style.left = leftPct + '%';
    mark.style.width = widthPct + '%';
    span.appendChild(mark);
    span.classList.add('tts-active');
}

function updatePdfReadHighlight(charIndex) {
    if (!pdfTextLayerSpans || !ttsCharRanges.length) return;
    var text = highlightSpeechText();
    var word = speechWordAt(text, charIndex);
    if (!word) {
        clearPdfHighlight();
        return;
    }
    if (word.start === ttsPdfHighlightLast.start && word.end === ttsPdfHighlightLast.end) return;
    ttsPdfHighlightLast = { start: word.start, end: word.end };

    var hit = Object.create(null);
    var byItem = Object.create(null);
    for (var i = 0; i < ttsCharRanges.length; i++) {
        var r = ttsCharRanges[i];
        if (r.end > word.start && r.start < word.end && pdfTextLayerSpans[r.itemIndex]) {
            hit[String(r.itemIndex)] = true;
        }
    }
    for (var h = 0; h < ttsCharRanges.length; h++) {
        var range = ttsCharRanges[h];
        var key = String(range.itemIndex);
        if (!hit[key]) continue;
        if (!byItem[key]) byItem[key] = [];
        byItem[key].push(range);
    }

    Object.keys(pdfTextLayerSpans).forEach(function(k) {
        clearSpanWordMarks(pdfTextLayerSpans[k]);
    });

    Object.keys(byItem).forEach(function(key) {
        var span = pdfTextLayerSpans[key];
        var parts = byItem[key].slice().sort(function(a, b) { return a.start - b.start; });
        var total = 0;
        var weights = [];
        for (var p = 0; p < parts.length; p++) {
            var rw = speechSliceWeight(text, parts[p].start, parts[p].end);
            if (!(rw > 0)) rw = Math.max(0, parts[p].end - parts[p].start);
            weights.push(rw);
            total += rw;
        }
        if (!(total > 0)) return;
        var acc = 0;
        for (var j = 0; j < parts.length; j++) {
            var part = parts[j];
            var a = part.start > word.start ? part.start : word.start;
            var b = part.end < word.end ? part.end : word.end;
            if (b > a) {
                var before = speechSliceWeight(text, part.start, a);
                var mid = speechSliceWeight(text, a, b);
                if (!(mid > 0)) mid = b - a;
                placeWordMark(span, ((acc + before) / total) * 100, (mid / total) * 100);
            }
            acc += weights[j];
        }
    });
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
        var mark = document.querySelector('#pdf-render-area .text-layer .tts-word-mark');
        if (mark) safeScrollIntoView(mark);
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
        span.style.width = spanW + 'px';
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
