/* ═══════════════════════════════════════════════════════════════
   ReadEdy · cloud/library
   Biblioteca na nuvem: progresso, painel da biblioteca e selo de status.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function setCloudBadge(state, title) {
    var badge = document.getElementById('cloud-badge');
    if (!badge) return;
    var states = ['on', 'off', 'wait', 'pending', 'error'];
    for (var i = 0; i < states.length; i++) {
        badge.classList.remove('cloud-status-' + states[i]);
    }
    badge.classList.add('cloud-status-' + (state || 'wait'));
    if (title) {
        badge.title = title;
        badge.setAttribute('aria-label', title);
    }
    var accountStatus = document.getElementById('home-account-cloud-status');
    if (accountStatus && title) accountStatus.textContent = title;
}

function persistLastCloudDocId(id) {
    try {
        if (id) safeStorage.setItem(LS_LAST_CLOUD_DOC, id);
        else safeStorage.removeItem(LS_LAST_CLOUD_DOC);
    } catch (e) { console.warn(e); }
}

function getAuthUserId() {
    return (window.ReadEdyAuth && ReadEdyAuth.isLoggedIn() && ReadEdyAuth.getUserId)
        ? ReadEdyAuth.getUserId()
        : null;
}

function ownedDocuments() {
    var table = readeraSb.from('documents');
    var uid = getAuthUserId();
    function scoped(q) {
        return uid ? q.eq('user_id', uid) : q;
    }
    return {
        select: function(columns, options) {
            return scoped(table.select(columns, options));
        },
        update: function(values, options) {
            return scoped(table.update(values, options));
        },
        'delete': function(options) {
            return scoped(table.delete(options));
        }
    };
}

function setDocumentDeletedAt(id, deletedAt) {
    if (!readeraSb || !id) return Promise.resolve();
    var uid = getAuthUserId();
    if (!uid) return Promise.resolve();
    return readeraSb.from('documents')
        .update({ deleted_at: deletedAt })
        .eq('id', id)
        .eq('user_id', uid)
        .then(function(r) {
            if (r.error) throw r.error;
        });
}

function persistLocalTrashToCloud(rows) {
    var trash = loadTrashIds();
    var uid = getAuthUserId();
    if (!readeraSb || !uid || !trash.length) return Promise.resolve();
    var pending = [];
    for (var i = 0; i < (rows || []).length; i++) {
        var r = rows[i];
        if (r.id && !r.deleted_at && trash.indexOf(r.id) !== -1) {
            r.deleted_at = new Date().toISOString();
            pending.push(setDocumentDeletedAt(r.id, r.deleted_at));
        }
    }
    if (!pending.length) return Promise.resolve();
    return Promise.all(pending).catch(function(err) {
        console.warn('persistLocalTrashToCloud', err);
    });
}

function updateCloudPrefsVisibility() {
    const on = !!readeraSb && window.ReadEdyAuth && ReadEdyAuth.isLoggedIn();
    var cloudGroup = document.getElementById('settings-group-cloud');
    if (cloudGroup) cloudGroup.style.display = on ? '' : 'none';
    ['opt-auto-cloud-wrap', 'opt-resume-cloud-wrap'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = on ? '' : 'none';
    });
}

function scheduleCloudProgress() {
    if (!readeraSb || !cloudDocumentId || !pdfDoc) return;
    patchCloudRowProgress(cloudDocumentId, pageNum, pdfDoc.numPages);
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(function() {
        ownedDocuments().update({
            last_page: pageNum,
            num_pages: pdfDoc.numPages
        }).eq('id', cloudDocumentId).then(function() {}).catch(function(err) {
            console.warn('Supabase: progresso não salvo', err);
        });
    }, 900);
}

function patchCloudRowProgress(id, lastPage, numPages) {
    if (!id) return;
    for (var i = 0; i < cloudLibraryRows.length; i++) {
        if (cloudLibraryRows[i].id !== id) continue;
        cloudLibraryRows[i].last_page = lastPage;
        cloudLibraryRows[i].num_pages = numPages;
        cloudLibraryRows[i].updated_at = new Date().toISOString();
        if (homeActiveTab === 'estatisticas') renderHomeStats();
        return;
    }
}

function updateCloudChrome() {
    var saveBtn = document.getElementById('btn-cloud-save');
    var delBtn  = document.getElementById('btn-cloud-delete');
    var libWrap = document.getElementById('cloud-library-wrap');
    if (!saveBtn || !libWrap) return;
    var on = !!readeraSb && window.ReadEdyAuth && ReadEdyAuth.isLoggedIn();
    /* Em TVs o classList.toggle com segundo argumento pode não funcionar em WebKit antigo */
    if (on) { libWrap.classList.remove('hidden'); } else { libWrap.classList.add('hidden'); }
    if (on && pdfDoc) { saveBtn.classList.remove('hidden'); } else { saveBtn.classList.add('hidden'); }
    saveBtn.disabled = !on || !pdfDoc || !pdfCacheBytes || !!cloudDocumentId || cloudSyncInFlight;
    if (delBtn) {
        if (on && cloudLibraryCount > 0) { delBtn.classList.remove('hidden'); } else { delBtn.classList.add('hidden'); }
        delBtn.disabled = !on || cloudLibraryCount === 0 || cloudSyncInFlight;
    }
    updateCloudPrefsVisibility();
}

function positionCloudLibraryPanel() {
    var panel = document.getElementById('cloud-library-panel');
    var trigger = document.getElementById('cloud-library-trigger');
    if (!panel || !trigger) return;
    var r = trigger.getBoundingClientRect();
    var gap = 6;
    var panelW = Math.min(Math.max(r.width, 280), Math.min(380, window.innerWidth - 16));
    var left = r.right - panelW;
    if (left < 8) left = 8;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - 8 - panelW;
    var top = r.bottom + gap;
    var maxH = Math.min(window.innerHeight * 0.5, 360);
    if (top + maxH > window.innerHeight - 8) {
        top = Math.max(8, r.top - gap - maxH);
    }
    panel.style.width = panelW + 'px';
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    panel.style.maxHeight = maxH + 'px';
}

function setCloudLibraryPanelOpen(open) {
    var panel = document.getElementById('cloud-library-panel');
    var trigger = document.getElementById('cloud-library-trigger');
    var wrap = document.getElementById('cloud-library-wrap');
    cloudLibraryPanelOpen = !!open;
    if (panel) {
        if (open) {
            if (wrap && panel.parentNode !== document.body) {
                document.body.appendChild(panel);
            }
            panel.classList.remove('hidden');
            positionCloudLibraryPanel();
        } else {
            panel.classList.add('hidden');
            if (wrap && panel.parentNode !== wrap) {
                wrap.appendChild(panel);
            }
        }
    }
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeCloudLibraryPanel() {
    setCloudLibraryPanelOpen(false);
}

function resetCloudLibraryTrigger() {
    var trigger = document.getElementById('cloud-library-trigger');
    if (trigger) trigger.textContent = 'PDFs';
}

function renderCloudLibraryList(rows) {
    var panel = document.getElementById('cloud-library-panel');
    if (!panel) return;
    panel.innerHTML = '';
    rows = rows || [];
    var list = getNonTrashedRows(rows);
    cloudLibraryCount = list.length;
    if (!list.length) {
        var empty = document.createElement('div');
        empty.className = 'cloud-library-empty';
        empty.textContent = 'Nenhum PDF na nuvem.';
        panel.appendChild(empty);
        updateCloudChrome();
        renderHomeFromCloudLibrary(rows);
        return;
    }
    list.forEach(function(row) {
        var item = document.createElement('div');
        item.className = 'cloud-library-item';
        item.setAttribute('role', 'option');

        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'cloud-library-item-name';
        openBtn.textContent = row.title || row.id;
        openBtn.title = 'Abrir — última página: ' + (row.last_page || 1);
        openBtn.addEventListener('click', function() {
            openCloudDocumentById(row.id);
        });

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cloud-library-item-del';
        delBtn.title = 'Mover para o lixeiro';
        delBtn.setAttribute('aria-label', 'Mover ' + (row.title || row.id) + ' para o lixeiro');
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            moveToTrash(row.id, row.title || row.id);
        });

        item.appendChild(openBtn);
        item.appendChild(delBtn);
        panel.appendChild(item);
    });
    updateCloudChrome();
    renderHomeFromCloudLibrary(rows);
}

function toggleCloudLibraryPanel() {
    if (!readeraSb) return;
    if (cloudLibraryPanelOpen) {
        closeCloudLibraryPanel();
        return;
    }
    cloudLibrarySuppressClose = true;
    setCloudLibraryPanelOpen(true);
    refreshCloudLibrary().catch(function() {});
    setTimeout(function() { cloudLibrarySuppressClose = false; }, 0);
}

function bindCloudLibraryUi() {
    var wrap = document.getElementById('cloud-library-wrap');
    var trigger = document.getElementById('cloud-library-trigger');
    if (!wrap || !trigger || trigger._cloudLibBound) return;
    trigger._cloudLibBound = true;
    var touchToggleLock = false;
    function onTriggerActivate(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        toggleCloudLibraryPanel();
    }
    trigger.addEventListener('click', function(e) {
        if (touchToggleLock) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        onTriggerActivate(e);
    });
    trigger.addEventListener('touchend', function(e) {
        e.preventDefault();
        e.stopPropagation();
        touchToggleLock = true;
        onTriggerActivate(e);
        setTimeout(function() { touchToggleLock = false; }, 450);
    }, { passive: false });
    if (!window._cloudLibraryOutsideBound) {
        window._cloudLibraryOutsideBound = true;
        document.addEventListener('click', function(e) {
            if (cloudLibrarySuppressClose) return;
            var panel = document.getElementById('cloud-library-panel');
            if (panel && panel.contains(e.target)) return;
            if (trigger && trigger.contains(e.target)) return;
            if (cloudLibraryPanelOpen) closeCloudLibraryPanel();
        });
        window.addEventListener('resize', function() {
            if (cloudLibraryPanelOpen) positionCloudLibraryPanel();
        });
    }
}
