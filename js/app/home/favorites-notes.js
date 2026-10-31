/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/favorites-notes
   Favoritos e anotações.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function loadFavorites() {
    try {
        var raw = safeStorage.getItem(LS_FAVORITES);
        var list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

function saveFavorites(ids) {
    safeStorage.setItem(LS_FAVORITES, JSON.stringify(ids || []));
}

function isFavorite(id) {
    if (!id) return false;
    return loadFavorites().indexOf(id) !== -1;
}

function toggleFavorite(id) {
    if (!id) return false;
    var favs = loadFavorites();
    var idx = favs.indexOf(id);
    var added = idx === -1;
    if (added) favs.push(id);
    else favs.splice(idx, 1);
    saveFavorites(favs);
    applyHomeSearch(homeSearchQuery);
    if (homeActiveTab === 'favoritos') renderHomeFavoritesList();
    if (typeof showTtsToast === 'function') {
        showTtsToast(added ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
    }
    return added;
}

function removeFavoriteId(id) {
    if (!id) return;
    var favs = loadFavorites().filter(function(x) { return x !== id; });
    saveFavorites(favs);
}

function loadNotes() {
    try {
        var raw = safeStorage.getItem(LS_NOTES);
        var list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

function saveNotes(notes) {
    safeStorage.setItem(LS_NOTES, JSON.stringify(notes || []));
}

function removeNotesForDoc(docId) {
    if (!docId) return;
    saveNotes(loadNotes().filter(function(n) { return n.docId !== docId; }));
    if (homeActiveTab === 'anotacoes') renderHomeNotesList();
}

function deleteNoteById(noteId) {
    saveNotes(loadNotes().filter(function(n) { return n.id !== noteId; }));
    if (homeActiveTab === 'anotacoes') renderHomeNotesList();
}

function upsertNote(note) {
    var notes = loadNotes();
    var idx = -1;
    for (var i = 0; i < notes.length; i++) {
        if (notes[i].id === note.id) { idx = i; break; }
    }
    if (idx === -1) notes.unshift(note);
    else notes[idx] = note;
    saveNotes(notes);
    if (homeActiveTab === 'anotacoes') renderHomeNotesList();
}

function getCurrentDocForNotes() {
    if (!pdfDoc) return null;
    var docId = cloudDocumentId;
    if (!docId) return null;
    return {
        docId: docId,
        docTitle: currentBookTitle || lastOpenedFileName || 'Documento',
        page: pageNum || currentPageNum || 1
    };
}

function createFavBtn(row) {
    var id = row && row.id;
    if (!id) return null;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-fav-btn' + (isFavorite(id) ? ' is-fav' : '');
    btn.title = isFavorite(id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.4 5.8L21 10l-4.5 4.2L17.5 21 12 18l-5.5 3 1-6.8L3 10l6.6-1.2z"/></svg>';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleFavorite(id);
        btn.classList.toggle('is-fav', isFavorite(id));
        btn.title = isFavorite(id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
        btn.setAttribute('aria-label', btn.title);
    });
    return btn;
}

function renderHomeFavoritesList() {
    var list = document.getElementById('home-favorites-list');
    if (!list) return;
    list.innerHTML = '';
    var favIds = loadFavorites();
    if (!favIds.length) {
        var empty = document.createElement('div');
        empty.className = 'home-library-empty';
        empty.textContent = 'Nenhum favorito ainda. Toque na estrela na Biblioteca para marcar livros.';
        list.appendChild(empty);
        return;
    }
    var favRows = [];
    for (var i = 0; i < cloudLibraryRows.length; i++) {
        if (favIds.indexOf(cloudLibraryRows[i].id) !== -1 && !isTrashed(cloudLibraryRows[i].id)) {
            favRows.push(cloudLibraryRows[i]);
        }
    }
    if (!favRows.length) {
        var stale = document.createElement('div');
        stale.className = 'home-library-empty';
        stale.textContent = 'Os favoritos guardados já não estão na nuvem.';
        list.appendChild(stale);
        return;
    }
    favRows.forEach(function(row) {
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
        var favBtn = createFavBtn(row);
        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'home-library-open';
        openBtn.textContent = 'Abrir';
        openBtn.addEventListener('click', function() { openCloudDocumentById(row.id); });
        item.appendChild(cover);
        item.appendChild(info);
        if (favBtn) item.appendChild(favBtn);
        item.appendChild(openBtn);
        list.appendChild(item);
    });
}

function formatNoteDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderHomeNotesList() {
    var list = document.getElementById('home-notes-list');
    var empty = document.getElementById('home-notes-empty');
    if (!list) return;
    list.innerHTML = '';
    var notes = loadNotes().slice().sort(function(a, b) {
        return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    });
    if (!notes.length) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');
    notes.forEach(function(note) {
        var card = document.createElement('div');
        card.className = 'home-note-item';
        card.setAttribute('role', 'listitem');
        var top = document.createElement('div');
        top.className = 'home-note-top';
        var book = document.createElement('p');
        book.className = 'home-note-book';
        book.textContent = note.docTitle || 'Documento';
        var page = document.createElement('span');
        page.className = 'home-note-page';
        page.textContent = 'Pág. ' + (note.page || 1);
        top.appendChild(book);
        top.appendChild(page);
        var text = document.createElement('p');
        text.className = 'home-note-text';
        text.textContent = note.text || '';
        var date = document.createElement('p');
        date.className = 'home-note-date';
        date.textContent = formatNoteDate(note.updatedAt || note.createdAt);
        var actions = document.createElement('div');
        actions.className = 'home-note-actions';
        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'home-note-action-btn';
        openBtn.textContent = 'Abrir livro';
        openBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (note.docId) openCloudDocumentById(note.docId, { jumpPage: note.page || 1 });
        });
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'home-note-action-btn';
        editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            openNoteModal({ note: note });
        });
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'home-note-action-btn home-note-action-btn--danger';
        delBtn.textContent = 'Apagar';
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (confirm('Apagar esta anotação?')) deleteNoteById(note.id);
        });
        actions.appendChild(openBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        card.appendChild(top);
        card.appendChild(text);
        card.appendChild(date);
        card.appendChild(actions);
        card.addEventListener('click', function() {
            if (note.docId) openCloudDocumentById(note.docId, { jumpPage: note.page || 1 });
        });
        list.appendChild(card);
    });
}

function openNoteModal(opts) {
    opts = opts || {};
    var modal = document.getElementById('note-modal');
    var meta = document.getElementById('note-modal-meta');
    var textEl = document.getElementById('note-modal-text');
    var titleEl = document.getElementById('note-modal-title');
    if (!modal || !textEl) return;
    var ctx = opts.note ? {
        docId: opts.note.docId,
        docTitle: opts.note.docTitle,
        page: opts.note.page
    } : getCurrentDocForNotes();
    if (!ctx || !ctx.docId) {
        if (typeof showTtsToast === 'function') showTtsToast('Abra um livro da nuvem para anotar.');
        else if (typeof showNotification === 'function') showNotification('Abra um livro da nuvem para anotar.', true);
        return;
    }
    _noteEditId = opts.note ? opts.note.id : null;
    if (titleEl) titleEl.textContent = _noteEditId ? 'Editar anotação' : 'Nova anotação';
    if (meta) meta.textContent = (ctx.docTitle || 'Documento') + ' · Página ' + (ctx.page || 1);
    textEl.value = opts.note ? (opts.note.text || '') : '';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(function() { textEl.focus(); }, 50);
}

function closeNoteModal() {
    var modal = document.getElementById('note-modal');
    var textEl = document.getElementById('note-modal-text');
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }
    if (textEl) textEl.value = '';
    _noteEditId = null;
}

function saveNoteFromModal() {
    var textEl = document.getElementById('note-modal-text');
    var meta = document.getElementById('note-modal-meta');
    if (!textEl) return;
    var text = String(textEl.value || '').trim();
    if (!text) {
        if (typeof showTtsToast === 'function') showTtsToast('Escreva algo na anotação.');
        return;
    }
    var ctx = getCurrentDocForNotes();
    var existing = null;
    if (_noteEditId) {
        var notes = loadNotes();
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === _noteEditId) { existing = notes[i]; break; }
        }
    }
    if (existing) {
        upsertNote(Object.assign({}, existing, { text: text, updatedAt: new Date().toISOString() }));
    } else {
        if (!ctx || !ctx.docId) return;
        upsertNote({
            id: generateUUID(),
            docId: ctx.docId,
            docTitle: ctx.docTitle,
            page: ctx.page,
            text: text,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    closeNoteModal();
    if (typeof showTtsToast === 'function') showTtsToast('Anotação guardada');
    if (homeView || !pdfDoc) openHomeView('anotacoes');
}
