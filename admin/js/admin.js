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
        var meta = user.app_metadata || {};
        return meta.role === 'admin';
    }

    function setMsg(text) {
        var el = $('admin-login-msg');
        if (el) el.textContent = text || '';
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

    function renderDaily(rows) {
        var tbody = $('admin-daily-table').querySelector('tbody');
        tbody.innerHTML = '';
        (rows || []).slice(0, 14).forEach(function(r) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + r.day + '</td><td>' + (r.dau || 0) + '</td><td>' + (r.sessions || 0) + '</td><td>' + (r.tts_requests || 0) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function renderSubs(rows) {
        var tbody = $('admin-subs-table').querySelector('tbody');
        tbody.innerHTML = '';
        var mrr = 0;
        var active = 0;
        (rows || []).forEach(function(r) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (r.plan_name || r.plan_slug) + '</td><td>' + r.status + '</td><td>' + r.total + '</td><td>R$ ' + Number(r.price_brl || 0).toFixed(2) + '</td>';
            tbody.appendChild(tr);
            if (r.status === 'active' || r.status === 'trialing') {
                active += Number(r.total || 0);
                if (r.billing_interval === 'month') mrr += Number(r.price_brl || 0) * Number(r.total || 0);
                else mrr += (Number(r.price_brl || 0) / 12) * Number(r.total || 0);
            }
        });
        $('stat-active-subs').textContent = String(active);
        $('stat-mrr').textContent = mrr.toFixed(2);
    }

    function loadDashboard() {
        var since = new Date();
        since.setDate(since.getDate() - 7);
        var sinceIso = since.toISOString();

        return Promise.all([
            client.from('profiles').select('id', { count: 'exact', head: true }),
            client.from('usage_logs').select('id', { count: 'exact', head: true }).eq('event_type', 'session_start').gte('created_at', sinceIso),
            client.from('usage_logs').select('id', { count: 'exact', head: true }).eq('event_type', 'tts_request').gte('created_at', sinceIso),
            client.from('documents').select('id', { count: 'exact', head: true }),
            client.from('admin_dashboard_daily').select('*').limit(30),
            client.from('admin_subscriptions_summary').select('*')
        ]).then(function(results) {
            $('stat-profiles').textContent = String(results[0].count || 0);
            $('stat-sessions').textContent = String(results[1].count || 0);
            $('stat-tts').textContent = String(results[2].count || 0);
            $('stat-docs').textContent = String(results[3].count || 0);
            renderDaily(results[4].data || []);
            renderSubs(results[5].data || []);
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
