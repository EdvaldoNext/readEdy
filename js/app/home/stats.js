/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/stats
   Estatísticas de leitura da Home.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function docProgressPct(row) {
    if (!row) return 0;
    var lp = row.last_page || 1;
    var np = row.num_pages;
    if (np && np > 0) return Math.min(100, Math.round((lp / np) * 100));
    return 0;
}

function statsMarkTtsActive() {
    if (!_statsTtsTickAt) {
        _statsTtsTickAt = Date.now();
        _statsTtsBookId = cloudDocumentId || null;
    }
}

function statsFlushTtsTime() {
    if (!_statsTtsTickAt) return;
    var elapsed = Math.floor((Date.now() - _statsTtsTickAt) / 1000);
    var bookId = _statsTtsBookId;
    _statsTtsTickAt = null;
    _statsTtsBookId = null;
    if (elapsed <= 0) return;
    var prev = parseInt(safeStorage.getItem(LS_STATS_TTS_SECONDS) || '0', 10) || 0;
    safeStorage.setItem(LS_STATS_TTS_SECONDS, String(prev + elapsed));
    if (bookId) {
        var bookPrev = parseInt(safeStorage.getItem(LS_STATS_TTS_BOOK_PREFIX + bookId) || '0', 10) || 0;
        safeStorage.setItem(LS_STATS_TTS_BOOK_PREFIX + bookId, String(bookPrev + elapsed));
    }
    if (homeActiveTab === 'estatisticas') renderHomeStats();
}

function getBookTtsSeconds(bookId) {
    if (!bookId) return 0;
    var sec = parseInt(safeStorage.getItem(LS_STATS_TTS_BOOK_PREFIX + bookId) || '0', 10) || 0;
    if (_statsTtsTickAt && _statsTtsBookId === bookId) {
        sec += Math.floor((Date.now() - _statsTtsTickAt) / 1000);
    }
    return sec;
}

function formatStatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function bookStatusLabel(lp, np, pct) {
    if (np > 0 && lp >= np) return { text: 'Concluído', cls: 'is-done' };
    if (lp > 1 || pct > 0) return { text: 'Em leitura', cls: '' };
    return { text: 'Não iniciado', cls: 'is-new' };
}

function statsBookKey(row) {
    return row.id || ('local:' + (row.title || row.storage_path || 'doc'));
}

function selectBookStats(bookKey) {
    statsSelectedBookId = bookKey || null;
    renderHomeStats();
    if (bookKey) {
        var detail = document.getElementById('stats-book-detail');
        if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function formatStatDuration(totalSeconds) {
    var sec = Math.max(0, Math.round(totalSeconds || 0));
    if (sec < 60) return sec + ' s';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60);
    var rm = min % 60;
    return h + ' h' + (rm ? ' ' + rm + ' min' : '');
}

function formatStatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
}

function mergeStatsRows(rows) {
    var list = (rows || []).slice();
    var open = currentOpenBookRow();
    if (!open || !open.id) return list;
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === open.id) {
            list[i] = Object.assign({}, list[i], open);
            return list;
        }
    }
    if (open.isOpen) list.unshift(open);
    return list;
}

function computeLibraryStats(rows) {
    rows = mergeStatsRows(rows);
    var totalBooks = rows.length;
    var completed = 0;
    var inProgress = 0;
    var totalPages = 0;
    var pagesRead = 0;
    var totalBytes = 0;
    var activeWeek = 0;
    var now = Date.now();
    var weekMs = 7 * 24 * 60 * 60 * 1000;
    var books = [];

    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var np = r.num_pages || 0;
        var lp = r.last_page || 1;
        var pct = docProgressPct(r);
        if (np > 0) {
            totalPages += np;
            pagesRead += Math.min(lp, np);
            if (lp >= np) completed++;
            else if (lp > 1) inProgress++;
        } else {
            pagesRead += lp;
            if (lp > 1) inProgress++;
        }
        if (r.bytes) totalBytes += Number(r.bytes) || 0;
        if (r.updated_at) {
            var t = new Date(r.updated_at).getTime();
            if (!isNaN(t) && (now - t) < weekMs) activeWeek++;
        }
        books.push({ row: r, pct: pct, lp: lp, np: np });
    }

    books.sort(function(a, b) {
        var ta = a.row.updated_at ? new Date(a.row.updated_at).getTime() : 0;
        var tb = b.row.updated_at ? new Date(b.row.updated_at).getTime() : 0;
        return tb - ta;
    });

    var ttsSec = parseInt(safeStorage.getItem(LS_STATS_TTS_SECONDS) || '0', 10) || 0;
    if (_statsTtsTickAt) ttsSec += Math.floor((Date.now() - _statsTtsTickAt) / 1000);

    return {
        totalBooks: totalBooks,
        completed: completed,
        inProgress: inProgress,
        totalPages: totalPages,
        pagesRead: pagesRead,
        avgProgress: totalPages > 0 ? Math.round((pagesRead / totalPages) * 100) : 0,
        totalBytes: totalBytes,
        activeWeek: activeWeek,
        books: books,
        ttsSeconds: ttsSec
    };
}

function renderHomeStats() {
    var stats = computeLibraryStats(getNonTrashedRows(cloudLibraryRows));
    var setText = function(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setText('stats-books', String(stats.totalBooks));
    setText('stats-pages', stats.totalPages
        ? (stats.pagesRead.toLocaleString('pt-BR') + ' / ' + stats.totalPages.toLocaleString('pt-BR'))
        : String(stats.pagesRead));
    setText('stats-avg', stats.avgProgress + '%');
    setText('stats-completed', String(stats.completed));
    setText('stats-tts', formatStatDuration(stats.ttsSeconds));
    setText('stats-active-week', String(stats.activeWeek));

    var summary = document.getElementById('stats-summary');
    if (summary) {
        if (!stats.totalBooks) {
            summary.textContent = 'Adicione livros na nuvem para acompanhar seu progresso.';
        } else {
            summary.textContent = stats.inProgress + ' em leitura · ' + formatStatBytes(stats.totalBytes) + ' na nuvem';
        }
    }

    var fill = document.getElementById('stats-overall-fill');
    var bar = document.getElementById('stats-overall-bar');
    var meta = document.getElementById('stats-overall-meta');
    if (fill) fill.style.width = stats.avgProgress + '%';
    if (bar) {
        bar.setAttribute('aria-valuenow', String(stats.avgProgress));
        bar.setAttribute('aria-valuetext', stats.avgProgress + '% concluído');
    }
    if (meta) {
        meta.textContent = stats.totalPages
            ? (stats.pagesRead.toLocaleString('pt-BR') + ' de ' + stats.totalPages.toLocaleString('pt-BR') + ' páginas · ' + stats.avgProgress + '%')
            : (stats.pagesRead.toLocaleString('pt-BR') + ' páginas lidas');
    }

    var list = document.getElementById('stats-books-list');
    var empty = document.getElementById('stats-books-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!stats.books.length) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    stats.books.forEach(function(item) {
        var row = item.row;
        var bookKey = statsBookKey(row);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'home-stats-book-item';
        if (statsSelectedBookId === bookKey) btn.classList.add('is-selected');
        btn.setAttribute('role', 'listitem');
        btn.setAttribute('data-stats-book', bookKey);
        var top = document.createElement('div');
        top.className = 'home-stats-book-top';
        var title = document.createElement('p');
        title.className = 'home-stats-book-title';
        title.textContent = row.title || row.id || 'Documento';
        var pctEl = document.createElement('span');
        pctEl.className = 'home-stats-book-pct';
        pctEl.textContent = item.pct + '%';
        top.appendChild(title);
        top.appendChild(pctEl);
        var metaEl = document.createElement('p');
        metaEl.className = 'home-stats-book-meta';
        if (item.np) metaEl.textContent = 'Página ' + item.lp + ' de ' + item.np;
        else metaEl.textContent = 'Página ' + item.lp;
        var barWrap = document.createElement('div');
        barWrap.className = 'home-stats-book-bar';
        var barFill = document.createElement('div');
        barFill.className = 'home-stats-book-bar-fill';
        barFill.style.width = item.pct + '%';
        barWrap.appendChild(barFill);
        btn.appendChild(top);
        btn.appendChild(metaEl);
        btn.appendChild(barWrap);
        btn.addEventListener('click', function() {
            selectBookStats(bookKey);
        });
        list.appendChild(btn);
    });

    renderBookStatsDetail(stats);
}

function renderBookStatsDetail(stats) {
    var detail = document.getElementById('stats-book-detail');
    if (!detail) return;
    if (!statsSelectedBookId) {
        detail.classList.add('hidden');
        return;
    }

    var selected = null;
    for (var i = 0; i < stats.books.length; i++) {
        if (statsBookKey(stats.books[i].row) === statsSelectedBookId) {
            selected = stats.books[i];
            break;
        }
    }
    if (!selected) {
        statsSelectedBookId = null;
        detail.classList.add('hidden');
        return;
    }

    detail.classList.remove('hidden');
    var row = selected.row;
    var lp = selected.lp;
    var np = selected.np;
    var pct = selected.pct;
    var status = bookStatusLabel(lp, np, pct);
    var remaining = np > 0 ? Math.max(0, np - lp) : '—';

    var titleEl = document.getElementById('stats-detail-title');
    if (titleEl) titleEl.textContent = row.title || row.id || 'Documento';

    var statusEl = document.getElementById('stats-detail-status');
    if (statusEl) {
        statusEl.textContent = status.text;
        statusEl.className = 'home-stats-detail-badge' + (status.cls ? ' ' + status.cls : '');
    }

    var coverEl = document.getElementById('stats-detail-cover');
    if (coverEl) {
        coverEl.className = 'home-stats-detail-cover';
        coverEl.textContent = '';
        coverEl.style.backgroundImage = '';
        hydrateBookCover(row, coverEl);
    }

    var fill = document.getElementById('stats-detail-fill');
    var bar = document.getElementById('stats-detail-bar');
    var progressMeta = document.getElementById('stats-detail-progress-meta');
    if (fill) fill.style.width = pct + '%';
    if (bar) {
        bar.setAttribute('aria-valuenow', String(pct));
        bar.setAttribute('aria-valuetext', pct + '% concluído');
    }
    if (progressMeta) {
        progressMeta.textContent = np
            ? (lp.toLocaleString('pt-BR') + ' de ' + np.toLocaleString('pt-BR') + ' páginas · ' + pct + '%')
            : (lp.toLocaleString('pt-BR') + ' páginas lidas');
    }

    var setText = function(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setText('stats-detail-pages', np ? (lp + ' / ' + np) : String(lp));
    setText('stats-detail-remaining', typeof remaining === 'number' ? String(remaining) : remaining);
    setText('stats-detail-tts', formatStatDuration(getBookTtsSeconds(row.id)));
    setText('stats-detail-size', formatStatBytes(row.bytes));
    setText('stats-detail-updated', formatStatDate(row.updated_at));
    setText('stats-detail-created', formatStatDate(row.created_at));
}
