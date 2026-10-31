/* ═══════════════════════════════════════════════════════════════
   ReadEdy · cloud/client
   Inicialização do cliente da nuvem e sincronização de preferências.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function initSupabaseClient() {
    var cfg = window.READERA_SUPABASE;
    var badge = document.getElementById('cloud-badge');
    if (!cfg || !cfg.url || !cfg.anonKey) {
        setCloudBadge('off', 'Nuvem desligada (sem config.js)');
        updateCloudPrefsVisibility();
        initTtsEngine();
        return;
    }
    if (!window.ReadEdyCloud || typeof window.ReadEdyCloud.createClient !== 'function') {
        setCloudBadge('error', 'Erro ao carregar biblioteca da nuvem');
        updateCloudPrefsVisibility();
        initTtsEngine();
        return;
    }
    _doInitSupabase(cfg, window.ReadEdyCloud, badge);
}

function _doInitSupabase(cfg, sb, badge) {
    try {
        readeraSb = sb.createClient(cfg.url, cfg.anonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
    } catch(e) {
        readeraSb = null;
        setCloudBadge('error', 'Erro ao iniciar cliente da nuvem');
        updateCloudPrefsVisibility();
        initTtsEngine();
        return;
    }
    var authReady = window.ReadEdyAuth
        ? ReadEdyAuth.init(readeraSb)
        : Promise.resolve(null);
    authReady.then(function() {
        if (window.ReadEdyBilling) {
            ReadEdyBilling.onReturnFromMp();
            return ReadEdyBilling.refresh(readeraSb);
        }
    }).then(function() {
        if (window.ReadEdyAuth) ReadEdyAuth.logSessionStart();
        accessLockReady = true;
        updateAccountUi();
        applyAccessLock();
        trackSiteVisit();
        pollPaidCheckout();
    }).catch(function(err) {
        console.warn('Auth init', err);
    });
    setCloudBadge('on', 'Sistema ativo');
    if (!cloudUiBound) {
        cloudUiBound = true;
        document.getElementById('btn-cloud-save').addEventListener('click', savePdfToCloud);
        var delBtn = document.getElementById('btn-cloud-delete');
        if (delBtn) delBtn.addEventListener('click', deleteAllCloudDocuments);
        bindCloudLibraryUi();
    }
    if (window.ReadEdyAuth) {
        ReadEdyAuth.onAuthStateChange(function() {
            var afterBilling = window.ReadEdyBilling
                ? ReadEdyBilling.refresh(readeraSb)
                : Promise.resolve();
            afterBilling.then(function() {
                accessLockReady = true;
                updateAccountUi();
                applyAccessLock();
                applyTtsEngineFromPreference({ invalidateCache: false });
            }).catch(function() {
                accessLockReady = true;
                updateAccountUi();
                applyAccessLock();
            });
            updateCloudPrefsVisibility();
            updateCloudChrome();
            if (ReadEdyAuth.isLoggedIn()) {
                pullUserPreferences();
                refreshCloudLibrary().catch(function() {});
            } else {
                renderCloudLibraryList([]);
            }
        });
    }
    refreshCloudLibrary().then(function() {
        updateCloudChrome();
        return tryResumeLastCloudDocument();
    }).catch(function(err) {
        var msg = String((err && (err.message || err.error_description)) || '');
        setCloudBadge('error', msg ? ('Erro de rede: ' + msg.slice(0, 180)) : 'Erro de rede na nuvem');
        console.error(err);
        showNotification('Nuvem: falhou ao ligar. Confira config.js e rede. ' + msg.slice(0, 120));
    }).then(function() {
        updateCloudPrefsVisibility();
        initTtsEngine();
        wirePremiumButtons();
    });
}

var prefsPushTimer = null;

function pullUserPreferences() {
    if (!readeraSb || !window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) return Promise.resolve();
    return readeraSb.from('user_preferences').select('*').eq('user_id', ReadEdyAuth.getUserId()).maybeSingle()
        .then(function(r) {
            if (r.error || !r.data) return;
            var p = r.data;
            if (p.theme) safeStorage.setItem('readera-theme', p.theme);
            if (p.tts_rate != null && rateRange) rateRange.value = String(p.tts_rate);
            if (p.continuous_read != null) {
                var cr = document.getElementById('continuous-read');
                if (cr) cr.checked = !!p.continuous_read;
            }
            if (p.voice_key) safeStorage.setItem('readera-voice-key', p.voice_key);
        }).catch(function(err) { console.warn('pullUserPreferences', err); });
}

function schedulePushUserPreferences() {
    if (!readeraSb || !window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) return;
    clearTimeout(prefsPushTimer);
    prefsPushTimer = setTimeout(pushUserPreferences, 800);
}

function pushUserPreferences() {
    if (!readeraSb || !window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) return Promise.resolve();
    var crEl = document.getElementById('continuous-read');
    var payload = {
        user_id: ReadEdyAuth.getUserId(),
        theme: safeStorage.getItem('readera-theme') || 'light',
        tts_rate: rateRange ? Number(rateRange.value) : 1,
        continuous_read: crEl ? !!crEl.checked : true,
        voice_key: safeStorage.getItem('readera-voice-key') || null
    };
    return readeraSb.from('user_preferences').upsert(payload, { onConflict: 'user_id' })
        .then(function(r) { if (r.error) console.warn('pushUserPreferences', r.error); });
}

function refreshCloudLibrary() {
    if (!readeraSb) return Promise.resolve();
    var uid = getAuthUserId();
    if (!uid) {
        renderCloudLibraryList([]);
        return Promise.resolve();
    }
    return ownedDocuments()
        .select('id, title, storage_path, last_page, num_pages, bytes, created_at, updated_at, deleted_at')
        .order('updated_at', { ascending: false })
        .limit(80)
        .then(function(result) {
            var data = result.data, error = result.error;
            if (error) {
                console.warn(error);
                renderCloudLibraryList(cloudLibraryRows || []);
                return;
            }
            var rows = data || [];
            return persistLocalTrashToCloud(rows).then(function() {
                renderCloudLibraryList(rows);
                resetCloudLibraryTrigger();
            });
        });
}
