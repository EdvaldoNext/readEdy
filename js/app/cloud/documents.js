/* ═══════════════════════════════════════════════════════════════
   ReadEdy · cloud/documents
   Documentos na nuvem: baixar, abrir, enviar, excluir e sync automático.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* Corrida entre uma promise e um timeout fixo */
function _raceTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error((label || 'Download') + ' timeout após ' + ms / 1000 + 's')); }, ms);
        })
    ]);
}

function downloadPdfFromStoragePath(storagePath) {
    if (!storagePath || !readeraSb) {
        return Promise.reject(new Error('Caminho do arquivo inválido'));
    }

    function signedDownload() {
        return _createSignedUrlXhr('pdfs', storagePath, 600).then(function(signedUrl) {
            return _downloadArrayBufferFetch(signedUrl, null).catch(function() {
                return _downloadArrayBufferXhr(signedUrl, 120000, null);
            });
        });
    }

    /* SDK download com race-timeout para evitar hang infinito */
    function sdkDownload() {
        return _raceTimeout(
            readeraSb.storage.from('pdfs').download(storagePath).then(function(result) {
                if (result.error) throw result.error;
                if (!result.data) throw new Error('Resposta vazia do Storage');
                return _blobToArrayBuffer(result.data);
            }),
            15000, 'SDK download'
        );
    }

    /*
     * Ordem:
     *  1. URL assinada (autenticada) — bucket privado
     *  2. SDK Supabase com timeout de 15 s — usa XHR interno, funciona em TVs
     *  3. XHR manual (30 s) — último recurso via signed URL
     */
    if (window.ReadEdyAuth && ReadEdyAuth.isLoggedIn()) {
        return signedDownload().catch(function(e1) {
            console.warn('[PDF] signed URL falhou, tentando SDK:', e1 && e1.message);
            return sdkDownload();
        }).catch(function(e2) {
            console.warn('[PDF] SDK falhou, tentando signed XHR:', e2 && e2.message);
            return _createSignedUrlXhr('pdfs', storagePath, 600).then(function(signedUrl) {
                return _downloadArrayBufferXhr(signedUrl, 30000, null);
            });
        });
    }
    return sdkDownload();
}

function openCloudDocumentById(id, opts) {
    if (!requirePaidAccess()) return;
    if (!id || !readeraSb) return;
    opts = opts || {};
    var keepHome = !!opts.keepHome;
    var autoPlay = !!opts.autoPlay;
    var jumpPage = opts.jumpPage ? (opts.jumpPage | 0) : null;
    closeCloudLibraryPanel();
    /* Já é o livro carregado: não descarrega de novo */
    if (pdfDoc && cloudDocumentId === id) {
        if (jumpPage && jumpPage > 0 && jumpPage !== pageNum) {
            pageNum = jumpPage;
            currentPageNum = jumpPage;
            renderPage(pageNum);
            openReaderView();
        } else if (autoPlay) toggleTTS();
        else if (!keepHome) openReaderView();
        return;
    }
    var gen = ++cloudLoadGen;
    setAppLoading(true, 'Carregando PDF da nuvem…', 'pdf');
    teardownCurrentPdf();

    /* Safety net: garante que o ecrã de loading desaparece mesmo se a rede travar */
    var safetyTimer = setTimeout(function() {
        if (gen === cloudLoadGen) {
            setAppLoading(false);
            showNotification('Tempo esgotado ao carregar da nuvem. Verifique a ligação.', true);
        }
    }, 60000);

    ownedDocuments().select('id, title, storage_path, last_page, deleted_at').eq('id', id).is('deleted_at', null).single()
        .then(function(result) {
            if (gen !== cloudLoadGen) return;
            var row = result.data, error = result.error;
            if (error || !row) throw error || new Error('Documento não encontrado');
            if (jumpPage) row = Object.assign({}, row, { last_page: jumpPage });
            return openCloudDocumentFromRow(row, true, gen, keepHome && !jumpPage).then(function() {
                if (gen !== cloudLoadGen) return;
                if (autoPlay) startTtsWhenReady(0);
            });
        }).catch(function(err) {
            if (gen !== cloudLoadGen) return;
            console.error(err);
            var msg = String((err && err.message) || err || 'Erro desconhecido');
            if (msg.indexOf('cancel') === -1) {
                showNotification('Erro ao abrir da nuvem: ' + msg.slice(0, 120), true);
            }
        }).then(function() {
            clearTimeout(safetyTimer);
            if (gen === cloudLoadGen) setAppLoading(false);
        });
}

function openCloudDocumentFromRow(row, resetSelectValue, loadGen, startInHome) {
    if (loadGen == null) loadGen = cloudLoadGen;
    if (!row || !row.storage_path) {
        return Promise.reject(new Error('Documento sem arquivo na nuvem'));
    }
    return downloadPdfFromStoragePath(row.storage_path).then(function(buf) {
        if (loadGen !== cloudLoadGen) return Promise.reject(new Error('cancelled'));
        var byteLen = buf ? (buf.byteLength != null ? buf.byteLength : buf.size) : 0;
        if (!buf || !byteLen) throw new Error('Arquivo PDF vazio');
        lastOpenedFileName = row.title || 'documento.pdf';
        currentBookTitle = lastOpenedFileName;
        return loadPdfFromArrayBuffer(buf, {
            documentId: row.id,
            initialPage: row.last_page || 1,
            startInHome: !!startInHome
        }, loadGen);
    }).then(function() {
        if (loadGen !== cloudLoadGen) return;
        if (resetSelectValue) resetCloudLibraryTrigger();
    });
}

function tryResumeLastCloudDocument() {
    if (!readeraSb) return Promise.resolve();
    if (safeStorage.getItem(LS_RESUME_CLOUD) === '0') return Promise.resolve();
    var id = safeStorage.getItem(LS_LAST_CLOUD_DOC);
    if (!id) return Promise.resolve();
    return ownedDocuments().select('id, title, storage_path, last_page, deleted_at').eq('id', id).is('deleted_at', null).maybeSingle()
        .then(function(result) {
            var row = result.data, error = result.error;
            if (error || !row) { persistLastCloudDocId(null); return; }
            var gen = ++cloudLoadGen;
            setAppLoading(true, 'Abrindo último PDF da nuvem…', 'pdf');

            /* Safety net */
            var safetyTimer = setTimeout(function() {
                if (gen === cloudLoadGen) {
                    setAppLoading(false);
                    showNotification('Não foi possível retomar o último PDF. Tente abrir manualmente.', true);
                }
            }, 60000);

            /* Retoma silenciosa: o livro fica pronto na Home ("Continue
               ouvindo") em vez de saltar direto para a leitura. */
            return openCloudDocumentFromRow(row, false, gen, true).catch(function(err) {
                console.warn('Retoma nuvem:', err);
                persistLastCloudDocId(null);
            }).then(function() {
                clearTimeout(safetyTimer);
                if (gen === cloudLoadGen) setAppLoading(false);
            });
        });
}

function uploadPdfToCloudInternal(silent) {
    if (!readeraSb || !pdfDoc || !pdfCacheBytes) return Promise.reject(new Error('Sem PDF para enviar'));
    if (!window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) {
        return Promise.reject(new Error('Faça login para guardar na nuvem'));
    }
    if (!canUsePremiumFeatures()) {
        return Promise.reject(new Error('Assinatura ativa necessária. Escolha um plano na aba Conta.'));
    }
    if (cloudDocumentId) return Promise.resolve(null);
    if (!pdfCacheBytes.byteLength) {
        return Promise.reject(new Error('O PDF foi lido, mas a cópia para a nuvem se perdeu. Abra o arquivo outra vez.'));
    }
    var userId = ReadEdyAuth.getUserId();
    var uploadBody = new Blob([pdfCacheBytes], { type: 'application/pdf' });
    var newBytes = uploadBody.size || pdfCacheBytes.byteLength;
    var pageCount = pdfDoc.numPages;
    var savedPage = pageNum;
    var lifetime = !!(ReadEdyAuth.isAdmin && ReadEdyAuth.isAdmin());
    return ownedDocuments()
        .select('bytes')
        .then(function(res) {
            if (res.error) throw res.error;
            if (!lifetime) {
                var rows = res.data || [];
                var pdfCount = rows.length;
                var totalBytes = 0;
                for (var i = 0; i < rows.length; i++) totalBytes += Number(rows[i].bytes) || 0;
                var plan = window.ReadEdyBilling && ReadEdyBilling.getStatus() && ReadEdyBilling.getStatus().plan;
                var maxPdfs = plan && plan.max_pdfs ? plan.max_pdfs : 3;
                var maxMb = plan && plan.storage_mb ? plan.storage_mb : 45;
                var maxBytes = maxMb * 1024 * 1024;
                if (pdfCount >= maxPdfs) {
                    throw new Error('Limite do plano: máximo ' + maxPdfs + ' PDFs na nuvem.');
                }
                if (totalBytes + newBytes > maxBytes) {
                    throw new Error('Limite do plano: máximo ' + maxMb + ' MB na nuvem.');
                }
            }
            var docId = generateUUID();
            var path = userId + '/' + docId + '.pdf';
            var title = lastOpenedFileName || 'documento.pdf';
            return readeraSb.storage.from('pdfs').upload(path, uploadBody, { contentType: 'application/pdf', upsert: false })
                .then(function(r) {
                    if (r.error) throw r.error;
                    return readeraSb.from('documents').insert({
                        id: docId, user_id: userId, title: title, storage_path: path,
                        bytes: newBytes, num_pages: pageCount, last_page: savedPage
                    }).select('id').single();
                }).then(function(r) {
                    if (r.error) throw r.error;
                    cloudDocumentId = r.data.id;
                    persistLastCloudDocId(r.data.id);
                    if (window.ReadEdyBilling) ReadEdyBilling.refresh(readeraSb);
                    return refreshCloudLibrary();
                }).then(function() {
                    updateCloudChrome();
                    if (!silent) showNotification('PDF guardado na nuvem.', false);
                });
        });
}

function savePdfToCloud() {
    if (!readeraSb) { showNotification('Nuvem não está ligada. Verifique config.js.', true); return; }
    if (!window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) {
        showNotification('Faça login na aba Conta para usar a nuvem.', true);
        return;
    }
    if (!canUsePremiumFeatures()) {
        showNotification('Assinatura ativa necessária. Escolha um plano na aba Conta.', true);
        openHomeView('conta');
        return;
    }
    if (!pdfDoc || !pdfCacheBytes) { showNotification('Abra um PDF primeiro para guardar na nuvem.', true); return; }
    if (cloudDocumentId) { showNotification('Este PDF já está guardado na nuvem.', false); return; }
    setAppLoading(true, 'Enviando PDF para a nuvem…', 'upload');
    uploadPdfToCloudInternal(false).catch(function(err) {
        console.error(err);
        showNotification('Erro ao guardar na nuvem: ' + (err.message || err), true);
    }).then(function() {
        setAppLoading(false);
    });
}

function clearCloudLinkForDocument(id) {
    if (cloudDocumentId === id) {
        cloudDocumentId = null;
        suppressAutoCloud = true;
        if (pdfDoc) stopTTS({ resetBookmark: true });
    }
    if (safeStorage.getItem(LS_LAST_CLOUD_DOC) === id) persistLastCloudDocId(null);
    removeFavoriteId(id);
    removeNotesForDoc(id);
    removeFromTrash(id);
}

function deleteCloudDocumentById(id, title, fromTrash) {
    if (!readeraSb || !id) return;
    var uid = getAuthUserId();
    if (!uid) {
        showNotification('Faça login para apagar PDFs da nuvem.', true);
        return;
    }
    var label = title || id;
    var msg = fromTrash
        ? ('Apagar permanentemente?\n\n' + label + '\n\nEsta ação não pode ser desfeita.')
        : ('Remover da nuvem?\n\n' + label + '\n\nO ficheiro no Storage e o registo na base serão apagados.');
    if (!confirm(msg)) return;
    closeCloudLibraryPanel();
    setAppLoading(true, 'A apagar da nuvem…');
    ownedDocuments().select('storage_path').eq('id', id).maybeSingle()
        .then(function(r) {
            if (r.error) throw r.error;
            if (!r.data || !r.data.storage_path) throw new Error('Este PDF não pertence à sua conta ou já foi apagado.');
            return readeraSb.storage.from('pdfs').remove([r.data.storage_path]);
        }).then(function(r) {
            if (r.error) throw r.error;
            return ownedDocuments().delete().eq('id', id);
        }).then(function(r) {
            if (r.error) throw r.error;
            clearCloudLinkForDocument(id);
            removeFromTrash(id);
            return refreshCloudLibrary();
        }).then(function() {
            updateCloudChrome();
            showNotification('PDF removido da nuvem.', false);
        }).catch(function(err) {
            console.error(err);
            showNotification('Erro ao apagar na nuvem: ' + (err.message || err), true);
        }).then(function() {
            setAppLoading(false);
        });
}

function deleteAllCloudDocuments() {
    if (!readeraSb || cloudLibraryCount === 0) return;
    if (!getAuthUserId()) {
        showNotification('Faça login para apagar PDFs da nuvem.', true);
        return;
    }
    if (!confirm('Apagar TODOS os PDFs da nuvem?\n\nSerão removidos ' + cloudLibraryCount + ' ficheiro(s) no Storage e todos os registos na base de dados.\n\nEsta ação não pode ser desfeita.')) return;
    closeCloudLibraryPanel();
    setAppLoading(true, 'A apagar todos os PDFs da nuvem…');
    ownedDocuments().select('id, storage_path')
        .then(function(r) {
            if (r.error) throw r.error;
            var rows = r.data || [];
            if (!rows.length) return { ids: [], paths: [] };
            var ids = rows.map(function(row) { return row.id; }).filter(Boolean);
            var paths = rows.map(function(row) { return row.storage_path; }).filter(Boolean);
            return readeraSb.storage.from('pdfs').remove(paths).then(function(sr) {
                if (sr.error) throw sr.error;
                return { ids: ids, paths: paths };
            });
        }).then(function(meta) {
            if (!meta || !meta.ids || !meta.ids.length) return;
            return ownedDocuments().delete().in('id', meta.ids);
        }).then(function(r) {
            if (r && r.error) throw r.error;
            cloudDocumentId = null;
            suppressAutoCloud = true;
            persistLastCloudDocId(null);
            if (pdfDoc) stopTTS({ resetBookmark: true });
            return refreshCloudLibrary();
        }).then(function() {
            updateCloudChrome();
            showNotification('Todos os PDFs foram removidos da nuvem.', false);
        }).catch(function(err) {
            console.error(err);
            showNotification('Erro ao apagar todos na nuvem: ' + (err.message || err), true);
        }).then(function() {
            setAppLoading(false);
        });
}

function attemptAutoCloudSync() {
    if (suppressAutoCloud) return;
    if (!readeraSb || cloudDocumentId || !pdfCacheBytes || !pdfDoc) return;
    if (safeStorage.getItem(LS_AUTO_CLOUD) === '0') return;
    if (cloudSyncInFlight) return;
    cloudSyncInFlight = true;
    updateCloudChrome();
    var badge = document.getElementById('cloud-badge');
    setCloudBadge('pending', 'Nuvem: a enviar PDF…');
    uploadPdfToCloudInternal(false).then(function() {
        setCloudBadge('on', 'Nuvem ligada');
    }).catch(function(err) {
        console.warn('Auto-nuvem:', err);
        var msg = (err && err.message) ? err.message : String(err || 'erro desconhecido');
        showNotification('Não foi possível guardar o PDF na nuvem: ' + msg.slice(0, 160), true);
        setCloudBadge('error', 'Nuvem: o PDF não foi guardado');
    }).then(function() {
        cloudSyncInFlight = false;
        updateCloudChrome();
    });
}
