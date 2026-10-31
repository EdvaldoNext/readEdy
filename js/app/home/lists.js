/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/lists
   Listas da Home: continuar lendo, busca, carrossel e biblioteca.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function updateHomeContinue(row) {
    var rowEl = document.getElementById('home-continue-row');
    var empty = document.getElementById('home-continue-empty');
    if (!rowEl || !empty) return;
    if (!row) {
        rowEl.classList.add('hidden');
        empty.classList.remove('hidden');
        var footHide = document.getElementById('home-continue-foot');
        if (footHide) footHide.classList.add('hidden');
        return;
    }
    rowEl.classList.remove('hidden');
    empty.classList.add('hidden');
    var title = row.title || row.id;
    var titleEl = document.getElementById('home-continue-title');
    var metaEl = document.getElementById('home-continue-meta');
    var fillEl = document.getElementById('home-continue-progress-fill');
    var pctEl = document.getElementById('home-continue-pct');
    var coverEl = document.getElementById('home-continue-cover');
    if (titleEl) titleEl.textContent = title;
    var lp = row.last_page || 1;
    var np = row.num_pages;
    if (metaEl) metaEl.textContent = np ? ('Página ' + lp + ' de ' + np) : ('Página ' + lp);
    var pct = docProgressPct(row);
    if (fillEl) fillEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    applyBookCoverEl(coverEl, title, row.id ? getCachedCover(row.id) : null);
    var footEl = document.getElementById('home-continue-foot');
    if (footEl) footEl.classList.remove('hidden');
    if (row.id) {
        coverEl.setAttribute('data-cover-doc', row.id);
        hydrateBookCover(row, coverEl);
    }
}

function normalizeSearchText(text) {
    return String(text || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function rowMatchesSearch(row, qNorm) {
    if (!qNorm) return true;
    var title = normalizeSearchText(row.title || row.id || '');
    return title.indexOf(qNorm) !== -1;
}

function filterRowsBySearch(rows) {
    var q = normalizeSearchText(homeSearchQuery);
    if (!q) return rows || [];
    return (rows || []).filter(function(row) { return rowMatchesSearch(row, q); });
}

function applyHomeSearch(query) {
    homeSearchQuery = query != null ? String(query) : homeSearchQuery;
    var q = normalizeSearchText(homeSearchQuery);
    var visible = getNonTrashedRows(cloudLibraryRows);
    renderHomeCarousel(visible);
    renderHomeLibraryList(visible);
    var continueRow = document.getElementById('home-continue-row');
    var continueEmpty = document.getElementById('home-continue-empty');
    if (q) {
        if (continueRow) continueRow.classList.add('hidden');
        if (continueEmpty) continueEmpty.classList.add('hidden');
        var continueFoot = document.getElementById('home-continue-foot');
        if (continueFoot) continueFoot.classList.add('hidden');
    } else {
        refreshHomeHero();
    }
}

function renderHomeCarousel(rows) {
    var carousel = document.getElementById('home-books-carousel');
    if (!carousel) return;
    carousel.innerHTML = '';
    var filtered = filterRowsBySearch(rows);
    var q = normalizeSearchText(homeSearchQuery);
    if (q && !filtered.length) {
        var searchEmpty = document.createElement('div');
        searchEmpty.className = 'home-search-empty';
        searchEmpty.textContent = 'Nenhum livro encontrado para \u201C' + homeSearchQuery.trim() + '\u201D';
        carousel.appendChild(searchEmpty);
    }
    filtered.forEach(function(row) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'home-book-item';
        btn.setAttribute('role', 'listitem');
        btn.setAttribute('data-book-title', (row.title || row.id || '').toLowerCase());
        var coverWrap = document.createElement('div');
        coverWrap.className = 'home-book-cover-wrap';
        var cover = document.createElement('span');
        cover.className = 'home-book-cover';
        hydrateBookCover(row, cover);
        var badge = document.createElement('span');
        badge.className = 'home-pdf-badge';
        badge.textContent = 'PDF';
        coverWrap.appendChild(cover);
        coverWrap.appendChild(badge);
        var label = document.createElement('span');
        label.className = 'home-book-title';
        label.textContent = row.title || row.id;
        var meta = document.createElement('span');
        meta.className = 'home-book-meta';
        meta.textContent = row.num_pages ? (row.num_pages + ' páginas') : 'PDF';
        var progress = document.createElement('div');
        progress.className = 'home-book-progress';
        var progressFill = document.createElement('div');
        progressFill.className = 'home-book-progress-fill';
        progressFill.style.width = docProgressPct(row) + '%';
        progress.appendChild(progressFill);
        btn.appendChild(coverWrap);
        btn.appendChild(label);
        btn.appendChild(meta);
        btn.appendChild(progress);
        btn.addEventListener('click', function() {
            openCloudDocumentById(row.id);
        });
        carousel.appendChild(btn);
    });
    if (!q) {
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'home-book-add';
        addBtn.innerHTML = '<span class="home-book-add-box">'
            + '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>'
            + '</span><span class="home-book-add-label">Adicionar novo livro</span>';
        addBtn.addEventListener('click', function() {
            var fi = document.getElementById('file-input');
            if (fi) fi.click();
        });
        carousel.appendChild(addBtn);
    }
}

function renderHomeLibraryList(rows) {
    var list = document.getElementById('home-library-list');
    if (!list) return;
    list.innerHTML = '';
    rows = filterRowsForLibraryView(rows || []);
    if (!rows.length) {
        var empty = document.createElement('div');
        empty.className = 'home-library-empty';
        if (libraryViewMode === 'recent') {
            empty.textContent = 'Nenhum livro lido nos últimos ' + LIBRARY_RECENT_DAYS + ' dias.';
        } else {
            empty.textContent = 'Nenhum PDF na nuvem.';
        }
        list.appendChild(empty);
        return;
    }
    var filtered = filterRowsBySearch(rows);
    var q = normalizeSearchText(homeSearchQuery);
    if (q && !filtered.length) {
        var searchEmptyLib = document.createElement('div');
        searchEmptyLib.className = 'home-library-empty';
        searchEmptyLib.textContent = 'Nenhum livro encontrado para \u201C' + homeSearchQuery.trim() + '\u201D';
        list.appendChild(searchEmptyLib);
        return;
    }
    filtered.forEach(function(row) {
        var item = document.createElement('div');
        item.className = 'home-library-item';
        item.setAttribute('role', 'listitem');
        var cover = document.createElement('span');
        cover.className = 'home-library-cover';
        hydrateBookCover(row, cover);
        var info = document.createElement('div');
        info.className = 'home-library-info';
        var h = document.createElement('p');
        h.className = 'home-library-title';
        h.textContent = row.title || row.id;
        var meta = document.createElement('p');
        meta.className = 'home-library-meta';
        var lp = row.last_page || 1;
        meta.textContent = row.num_pages ? ('Página ' + lp + ' de ' + row.num_pages) : ('Página ' + lp);
        info.appendChild(h);
        info.appendChild(meta);
        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'home-library-open';
        openBtn.textContent = 'Abrir';
        openBtn.addEventListener('click', function() {
            openCloudDocumentById(row.id);
        });
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'home-library-del';
        delBtn.title = 'Mover para o lixeiro';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            moveToTrash(row.id, row.title || row.id);
        });
        var favBtn = createFavBtn(row);
        item.appendChild(cover);
        item.appendChild(info);
        if (favBtn) item.appendChild(favBtn);
        item.appendChild(openBtn);
        item.appendChild(delBtn);
        list.appendChild(item);
    });
}

function filterHomeBooks(query) {
    applyHomeSearch(query);
}

function renderHomeFromCloudLibrary(rows) {
    cloudLibraryRows = rows || [];
    pruneStaleTrashIds();
    applyHomeSearch(homeSearchQuery);
    if (homeActiveTab === 'estatisticas') renderHomeStats();
    if (homeActiveTab === 'favoritos') renderHomeFavoritesList();
    if (homeActiveTab === 'anotacoes') renderHomeNotesList();
    if (homeActiveTab === 'lixeira') renderHomeTrashList();
}

/* O livro aberto tem prioridade no "Continue ouvindo" e no mini-player,
   mesmo que ainda não esteja guardado na nuvem. */
function currentOpenBookRow() {
    if (!pdfDoc) return null;
    return {
        id: cloudDocumentId,
        title: currentBookTitle || lastOpenedFileName || 'Documento',
        last_page: currentPageNum || pageNum,
        num_pages: pdfDoc.numPages,
        isOpen: true
    };
}

function refreshHomeHero() {
    var featured = currentOpenBookRow() || pickFeaturedDoc(cloudLibraryRows);
    homeFeaturedDocId = featured ? featured.id : null;
    homeFeaturedIsOpen = !!(featured && featured.isOpen);
    updateHomeContinue(featured);
    updateMiniPlayerFromDoc(featured);
}

/* Arranca a voz assim que a página estiver renderizada (o toggle recusa
   durante o render). Tenta durante alguns segundos e desiste em silêncio. */
function startTtsWhenReady(tries) {
    if (!pdfDoc) return;
    if (isRendering && (tries || 0) < 20) {
        setTimeout(function() { startTtsWhenReady((tries || 0) + 1); }, 300);
        return;
    }
    if (!isReading) toggleTTS();
}

/* ▶ na Home: toca o audiobook sem sair da Home.
   Se o livro em destaque ainda não está carregado, carrega-o em segundo
   plano (a Home continua à vista) e começa a ler quando estiver pronto. */
function playFeaturedAudio() {
    if (!requirePaidAccess()) return;
    _unlockAudio();
    if (pdfDoc && homeFeaturedIsOpen) {
        toggleTTS();
        return;
    }
    if (homeFeaturedDocId) {
        openCloudDocumentById(homeFeaturedDocId, { keepHome: true, autoPlay: true });
        return;
    }
    var fi = document.getElementById('file-input');
    if (fi) fi.click();
}

/* "Visualizar livro": única forma de abrir a página do PDF a partir da Home */
function viewFeaturedDocument() {
    if (!requirePaidAccess()) return;
    if (pdfDoc && homeFeaturedIsOpen) {
        openReaderView();
        return;
    }
    if (homeFeaturedDocId) openCloudDocumentById(homeFeaturedDocId);
}
