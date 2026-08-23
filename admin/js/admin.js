/* ReadEdy Admin dashboard (ES5) */
(function() {
    var client = null;

    function $(id) { return document.getElementById(id); }

    function show(el, on) {
        if (!el) return;
        if (on) el.classList.remove('hidden');
        else el.classList.add('hidden');
    }

    function isAdminUser(user) {
        if (!user) return false;
        return (user.app_metadata || {}).role === 'admin';
    }

    function setMsg(text) {
        var el = $('admin-login-msg');
        if (el) el.textContent = text || '';
    }

    function formatMb(bytes) {
        return (Number(bytes || 0) / (1024 * 1024)).toFixed(1);
    }

    function initClient() {
        var cfg = window.READERA_SUPABASE;
        if (!cfg || !cfg.url || !cfg.anonKey || !window.supabase) {
            setMsg('config.js ou Supabase JS ausente.');
            return null;
        }
        return window.supabase.createClient(cfg.url, cfg.anonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
    }

    function renderVisitsChart(rows) {
        var chart = $('admin-visits-chart');
        var tbody = $('admin-visits-table').querySelector('tbody');
        if (!chart || !tbody) return;
        chart.innerHTML = '';
        tbody.innerHTML = '';
        var list = (rows || []).slice(0, 14);
        var maxVisits = 1;
        list.forEach(function(r) {
            if (Number(r.visits) > maxVisits) maxVisits = Number(r.visits);
        });
        list.forEach(function(r) {
            var visits = Number(r.visits) || 0;
            var pct = Math.round((visits / maxVisits) * 100);
            var row = document.createElement('div');
            row.className = 'admin-bar-row';
            row.innerHTML = '<span>' + r.day + '</span><div class="admin-bar-track"><div class="admin-bar-fill" style="width:' + pct + '%"></div></div><span>' + visits + '</span>';
            chart.appendChild(row);
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + r.day + '</td><td>' + visits + '</td><td>' + (r.unique_visitors || 0) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function renderGeo(rows) {
        var tbody = $('admin-geo-table').querySelector('tbody');
        tbody.innerHTML = '';
        (rows || []).slice(0, 20).forEach(function(r) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (r.country || '—') + '</td><td>' + (r.city || '—') + '</td><td>' + (r.visits || 0) + '</td><td>' + (r.unique_visitors || 0) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function renderClients(rows) {
        var tbody = $('admin-clients-table').querySelector('tbody');
        tbody.innerHTML = '';
        (rows || []).forEach(function(r) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (r.email || r.display_name || r.user_id || '—') + '</td>' +
                '<td>' + (r.plan_name || '—') + '</td>' +
                '<td>' + (r.subscription_status || '—') + '</td>' +
                '<td>' + (r.pdf_count || 0) + '/' + (r.max_pdfs_limit || '—') + '</td>' +
                '<td>' + formatMb(r.bytes_used) + '</td>' +
                '<td>' + (r.storage_mb_limit || '—') + ' MB</td>';
            tbody.appendChild(tr);
        });
    }

    function renderSubs(rows) {
        var tbody = $('admin-subs-table').querySelector('tbody');
        tbody.innerHTML = '';
        var mrr = 0;
        (rows || []).forEach(function(r) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (r.plan_name || r.plan_slug) + '</td><td>' + r.status + '</td><td>' + r.total + '</td><td>R$ ' + Number(r.price_brl || 0).toFixed(2) + '</td>';
            tbody.appendChild(tr);
            if (r.status === 'active') {
                if (r.billing_interval === 'month') mrr += Number(r.price_brl || 0) * Number(r.total || 0);
                else mrr += (Number(r.price_brl || 0) / 12) * Number(r.total || 0);
            }
        });
        $('stat-mrr').textContent = mrr.toFixed(2);
    }

    function renderDailyLegacy(rows) {
        var tbody = $('admin-daily-table').querySelector('tbody');
        tbody.innerHTML = '';
        (rows || []).slice(0, 14).forEach(function(r) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + r.day + '</td><td>' + (r.dau || 0) + '</td><td>' + (r.sessions || 0) + '</td><td>' + (r.tts_requests || 0) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function sumVisitsForPeriod(rows, daysBack) {
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysBack);
        var cutoffStr = cutoff.toISOString().slice(0, 10);
        var total = 0;
        var uniques = 0;
        (rows || []).forEach(function(r) {
            if (String(r.day) >= cutoffStr) {
                total += Number(r.visits) || 0;
                uniques += Number(r.unique_visitors) || 0;
            }
        });
        return { total: total, uniques: uniques };
    }

    function loadStorageStats() {
        var cfg = window.READERA_SUPABASE || {};
        var token = ReadEdyAuth.getAccessToken();
        var url = cfg.url.replace(/\/$/, '') + '/functions/v1/admin-storage-stats';
        return fetch(url, {
            headers: { 'apikey': cfg.anonKey, 'Authorization': 'Bearer ' + token }
        }).then(function(r) { return r.json(); }).catch(function() { return null; });
    }

    function loadDashboard() {
        var today = new Date().toISOString().slice(0, 10);
        var monthStart = today.slice(0, 8) + '01';

        return Promise.all([
            client.from('admin_visits_daily').select('*').limit(60),
            client.from('admin_visits_geo').select('*').limit(30),
            client.from('admin_clients_summary').select('*').maybeSingle(),
            client.from('admin_user_storage').select('*').limit(200),
            client.from('admin_subscriptions_summary').select('*'),
            client.from('admin_dashboard_daily').select('*').limit(14),
            client.from('admin_project_storage').select('*').maybeSingle(),
            loadStorageStats()
        ]).then(function(results) {
            var visits = results[0].data || [];
            var geo = results[1].data || [];
            var summary = results[2].data || {};
            var clients = results[3].data || [];
            var subs = results[4].data || [];
            var legacy = results[5].data || [];
            var projectStorage = results[6].data || {};
            var storageApi = results[7];

            var visitsToday = 0;
            var visitsMonth = 0;
            var unique7d = 0;
            visits.forEach(function(r) {
                if (String(r.day) === today) visitsToday = Number(r.visits) || 0;
                if (String(r.day) >= monthStart) visitsMonth += Number(r.visits) || 0;
            });
            var week = sumVisitsForPeriod(visits, 7);
            unique7d = week.uniques;

            $('stat-visits-today').textContent = String(visitsToday);
            $('stat-visits-month').textContent = String(visitsMonth);
            $('stat-unique-7d').textContent = String(unique7d);
            $('stat-active-clients').textContent = String(summary.active_paying || 0);
            $('stat-inactive-clients').textContent = String(summary.inactive_or_unpaid || 0);
            $('stat-new-clients').textContent = String(summary.new_clients_7d || 0);

            var usedBytes = storageApi && storageApi.used_bytes != null
                ? storageApi.used_bytes
                : (projectStorage.used_bytes || 0);
            var limitBytes = storageApi && storageApi.limit_bytes != null
                ? storageApi.limit_bytes
                : (projectStorage.limit_bytes || 1073741824);
            $('stat-storage').textContent = formatMb(usedBytes) + ' / ' + formatMb(limitBytes) + ' MB';

            renderVisitsChart(visits);
            renderGeo(geo);
            renderClients(clients);
            renderSubs(subs);
            renderDailyLegacy(legacy);
        }).catch(function(err) {
            console.error(err);
            setMsg('Erro ao carregar métricas: ' + (err.message || err));
        });
    }

    function onSession(session) {
        var user = session && session.user;
        if (!user) {
            show($('admin-login'), true);
            show($('admin-dashboard'), false);
            show($('admin-user-bar'), false);
            show($('admin-denied'), false);
            return;
        }
        if (!isAdminUser(user)) {
            show($('admin-login'), false);
            show($('admin-dashboard'), false);
            show($('admin-user-bar'), true);
            show($('admin-denied'), true);
            $('admin-user-email').textContent = user.email || user.id;
            return;
        }
        show($('admin-login'), false);
        show($('admin-denied'), false);
        show($('admin-dashboard'), true);
        show($('admin-user-bar'), true);
        $('admin-user-email').textContent = user.email || user.id;
        loadDashboard();
    }

    function bindUi() {
        $('admin-btn-google').addEventListener('click', function() {
            ReadEdyAuth.signInWithGoogle().catch(function(e) { setMsg(e.message || String(e)); });
        });
        $('admin-email-form').addEventListener('submit', function(e) {
            e.preventDefault();
            ReadEdyAuth.signInWithEmail($('admin-email').value.trim())
                .then(function() { setMsg('Verifique seu e-mail para o link de acesso.'); })
                .catch(function(err) { setMsg(err.message || String(err)); });
        });
        $('admin-btn-signout').addEventListener('click', function() {
            ReadEdyAuth.signOut();
        });
    }

    client = initClient();
    if (!client) return;
    bindUi();
    ReadEdyAuth.init(client).then(function() {
        ReadEdyAuth.onAuthStateChange(onSession);
    });
})();
