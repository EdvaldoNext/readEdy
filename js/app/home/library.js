/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/library
   Biblioteca da Home: abas, lixeira, filtros e visão atual.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function pickFeaturedDoc(rows) {
    rows = getNonTrashedRows(rows);
    if (!rows || !rows.length) return null;
    var lastId = safeStorage.getItem(LS_LAST_CLOUD_DOC);
    if (lastId) {
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].id === lastId) return rows[i];
        }
    }
    return rows[0];
}

function setHomeTab(tab) {
    homeActiveTab = tab || 'inicio';
    ['inicio', 'biblioteca', 'lixeira', 'favoritos', 'anotacoes', 'estatisticas', 'conta'].forEach(function(t) {
        var panel = document.getElementById('home-tab-' + t);
        if (!panel) return;
        if (t === homeActiveTab) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
    });
    if (homeActiveTab === 'estatisticas') renderHomeStats();
    if (homeActiveTab === 'favoritos') renderHomeFavoritesList();
    if (homeActiveTab === 'anotacoes') renderHomeNotesList();
    if (homeActiveTab === 'lixeira') renderHomeTrashList();
    if (homeActiveTab === 'biblioteca') updateLibraryHeader();
    updateHomeNavActive();
    updateSidebarLibraryActive();
}

function loadTrashIds() {
    try {
        var raw = safeStorage.getItem(LS_TRASH);
        var list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

function saveTrashIds(ids) {
    safeStorage.setItem(LS_TRASH, JSON.stringify(ids || []));
}

function isTrashed(id) {
    if (!id) return false;
    if (loadTrashIds().indexOf(id) !== -1) return true;
    for (var i = 0; i < cloudLibraryRows.length; i++) {
        if (cloudLibraryRows[i].id === id && cloudLibraryRows[i].deleted_at) return true;
    }
    return false;
}

function removeFromTrash(id) {
    if (!id) return;
    saveTrashIds(loadTrashIds().filter(function(x) { return x !== id; }));
}

function getNonTrashedRows(rows) {
    var trash = loadTrashIds();
    return (rows || cloudLibraryRows || []).filter(function(r) {
        if (!r.id) return false;
        if (r.deleted_at) return false;
        return trash.indexOf(r.id) === -1;
    });
}

function getTrashedRows() {
    var trash = loadTrashIds();
    return (cloudLibraryRows || []).filter(function(r) {
        if (!r.id) return false;
        if (r.deleted_at) return true;
        return trash.indexOf(r.id) !== -1;
    });
}

function pruneStaleTrashIds() {
    var trash = loadTrashIds();
    if (!trash.length || !cloudLibraryRows || !cloudLibraryRows.length) return;
    var known = {};
    for (var i = 0; i < cloudLibraryRows.length; i++) {
        if (cloudLibraryRows[i].id) known[cloudLibraryRows[i].id] = true;
    }
    var pruned = trash.filter(function(id) { return known[id]; });
    if (pruned.length !== trash.length) saveTrashIds(pruned);
}

function filterRowsForLibraryView(rows) {
    rows = rows || [];
    if (libraryViewMode === 'recent') {
        var cutoff = Date.now() - LIBRARY_RECENT_DAYS * 24 * 60 * 60 * 1000;
        return rows.filter(function(r) {
            if (!r.updated_at) return false;
            var t = new Date(r.updated_at).getTime();
            return !isNaN(t) && t >= cutoff;
        }).sort(function(a, b) {
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
    }
    if (libraryViewMode === 'cloud') {
        return rows.filter(function(r) { return !!r.storage_path; });
    }
    return rows.slice();
}

function updateLibraryHeader() {
    var titleEl = document.getElementById('home-library-title');
    var subEl = document.getElementById('home-library-sub');
    var titles = {
        all: ['Biblioteca', 'Todos os PDFs guardados na nuvem'],
        recent: ['Recentes', 'Lidos ou atualizados nos últimos ' + LIBRARY_RECENT_DAYS + ' dias'],
        cloud: ['Na nuvem', 'PDFs sincronizados na sua conta']
    };
    var info = titles[libraryViewMode] || titles.all;
    if (titleEl) titleEl.textContent = info[0];
    if (subEl) subEl.textContent = info[1];
}

function setLibraryView(mode) {
    libraryViewMode = mode || 'all';
    openHomeView('biblioteca');
    updateLibraryHeader();
    applyHomeSearch(homeSearchQuery);
}

function updateSidebarLibraryActive() {
    var onHome = !document.body.classList.contains('pdf-is-open');
    var subs = document.querySelectorAll('.sidebar-sub-item');
    for (var i = 0; i < subs.length; i++) {
        var btn = subs[i];
        var view = btn.getAttribute('data-library-view');
        var nav = btn.getAttribute('data-home-nav');
        var active = false;
        if (onHome && nav === 'lixeira') active = homeActiveTab === 'lixeira';
        else if (onHome && view) active = homeActiveTab === 'biblioteca' && libraryViewMode === view;
        if (active) btn.classList.add('is-active');
        else btn.classList.remove('is-active');
    }
}

function markLocalRowDeleted(id, deletedAt) {
    for (var i = 0; i < cloudLibraryRows.length; i++) {
        if (cloudLibraryRows[i].id === id) {
            cloudLibraryRows[i].deleted_at = deletedAt;
            return;
        }
    }
}

function moveToTrash(id, title) {
    if (!id) return;
    var label = title || id;
    if (!confirm('Mover para o lixeiro?\n\n' + label + '\n\nPode restaurar depois em Lixeiro.')) return;
    var ids = loadTrashIds();
    if (ids.indexOf(id) === -1) ids.push(id);
    saveTrashIds(ids);
    removeFavoriteId(id);
    markLocalRowDeleted(id, new Date().toISOString());
    applyHomeSearch(homeSearchQuery);
    if (homeActiveTab === 'lixeira') renderHomeTrashList();
    if (typeof showTtsToast === 'function') showTtsToast('Movido para o lixeiro');
    setDocumentDeletedAt(id, new Date().toISOString()).catch(function(err) {
        console.warn('moveToTrash', err);
    });
}

function restoreFromTrash(id, title) {
    if (!id) return;
    removeFromTrash(id);
    markLocalRowDeleted(id, null);
    applyHomeSearch(homeSearchQuery);
    renderHomeTrashList();
    if (typeof showTtsToast === 'function') {
        showTtsToast('Restaurado: ' + (title || 'livro'));
    }
    setDocumentDeletedAt(id, null).catch(function(err) {
        console.warn('restoreFromTrash', err);
    });
}

function renderHomeTrashList() {
    var list = document.getElementById('home-trash-list');
    if (!list) return;
    list.innerHTML = '';
    pruneStaleTrashIds();
    var rows = getTrashedRows();
    if (!rows.length) {
        var empty = document.createElement('div');
        empty.className = 'home-library-empty';
        empty.textContent = 'O lixeiro está vazio.';
        list.appendChild(empty);
        return;
    }
    rows.forEach(function(row) {
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
        meta.textContent = row.updated_at
            ? ('Apagado · última leitura ' + formatStatDate(row.updated_at))
            : 'Apagado da biblioteca';
        info.appendChild(h);
        info.appendChild(meta);
        var restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'home-library-restore';
        restoreBtn.textContent = 'Restaurar';
        restoreBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            restoreFromTrash(row.id, row.title || row.id);
        });
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'home-library-del';
        delBtn.title = 'Apagar permanentemente';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteCloudDocumentById(row.id, row.title || row.id, true);
        });
        item.appendChild(cover);
        item.appendChild(info);
        item.appendChild(restoreBtn);
        item.appendChild(delBtn);
        list.appendChild(item);
    });
}
