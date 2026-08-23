/* ReadEdy Billing — assinatura pay-first e checkout Mercado Pago (ES5) */
window.ReadEdyBilling = (function() {
    var client = null;
    var status = null;
    var usage = null;
    var listeners = [];
    var CHECKOUT_KEY = 'readedy_checkout_token';

    function notify() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](status); } catch (e) { console.warn(e); }
        }
    }

    function fnUrl(name) {
        var cfg = window.READERA_SUPABASE || {};
        return (cfg.url || '').replace(/\/$/, '') + '/functions/v1/' + name;
    }

    function apiHeaders(token) {
        var cfg = window.READERA_SUPABASE || {};
        return {
            'Content-Type': 'application/json',
            'apikey': cfg.anonKey || '',
            'Authorization': 'Bearer ' + (token || cfg.anonKey || '')
        };
    }

    function saveCheckoutToken(token) {
        if (!token) return;
        try { localStorage.setItem(CHECKOUT_KEY, token); } catch (e) {}
    }

    function getCheckoutToken() {
        try { return localStorage.getItem(CHECKOUT_KEY) || ''; } catch (e) { return ''; }
    }

    function clearCheckoutToken() {
        try { localStorage.removeItem(CHECKOUT_KEY); } catch (e) {}
    }

    function isActive() {
        if (!status) return false;
        if (status.status !== 'active' && status.status !== 'past_due') return false;
        var end = status.current_period_end;
        if (!end) return status.status === 'active';
        var graceMs = status.status === 'past_due' ? 3 * 86400000 : 0;
        return new Date(end).getTime() + graceMs > Date.now();
    }

    function planLabel() {
        if (!status) return 'Sem plano';
        if (status.plan && status.plan.name) return status.plan.name;
        return status.status || 'Sem plano';
    }

    function getUsage() { return usage; }

    function loadUsage(sb, userId) {
        if (!sb || !userId || !status || !status.plan) {
            usage = null;
            return Promise.resolve(null);
        }
        return sb.from('documents')
            .select('bytes')
            .eq('user_id', userId)
            .then(function(res) {
                var rows = res.data || [];
                var pdfCount = rows.length;
                var totalBytes = 0;
                for (var i = 0; i < rows.length; i++) {
                    totalBytes += Number(rows[i].bytes) || 0;
                }
                usage = {
                    pdf_count: pdfCount,
                    bytes_used: totalBytes,
                    max_pdfs: status.plan.max_pdfs || 0,
                    storage_mb: status.plan.storage_mb || 0
                };
                return usage;
            });
    }

    function refresh(sb) {
        client = sb || client;
        if (!client || !window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) {
            status = null;
            usage = null;
            notify();
            return Promise.resolve(null);
        }
        return client.from('subscriptions')
            .select('id, status, current_period_end, trial_ends_at, plan:plans(slug, name, price_brl, billing_interval, storage_mb, max_pdfs)')
            .eq('user_id', ReadEdyAuth.getUserId())
            .in('status', ['pending', 'active', 'past_due'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(function(res) {
                if (res.error) {
                    console.warn('subscriptions', res.error);
                    status = null;
                } else {
                    var row = res.data;
                    status = row ? {
                        id: row.id,
                        status: row.status,
                        current_period_end: row.current_period_end,
                        trial_ends_at: row.trial_ends_at,
                        plan: row.plan || null
                    } : null;
                }
                return loadUsage(client, ReadEdyAuth.getUserId());
            })
            .then(function() {
                notify();
                return status;
            });
    }

    function onChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
        fn(status);
    }

    function startCheckout(planSlug, payerEmail) {
        planSlug = planSlug || 'basic_monthly';
        var cfg = window.READERA_SUPABASE || {};
        var token = (window.ReadEdyAuth && ReadEdyAuth.isLoggedIn())
            ? ReadEdyAuth.getAccessToken()
            : cfg.anonKey;
        var body = { plan_slug: planSlug };
        if (payerEmail) body.payer_email = payerEmail;
        return fetch(fnUrl('create-subscription'), {
            method: 'POST',
            headers: apiHeaders(token),
            body: JSON.stringify(body)
        }).then(function(resp) {
            return resp.json().then(function(data) {
                if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
                if (!data.init_point) throw new Error('Checkout sem URL');
                if (data.checkout_token) saveCheckoutToken(data.checkout_token);
                window.location.href = data.init_point;
                return data;
            });
        });
    }

    function linkAfterAuth(checkoutToken) {
        checkoutToken = checkoutToken || getCheckoutToken();
        if (!checkoutToken) return Promise.resolve(null);
        if (!window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) {
            return Promise.reject(new Error('Faça login com Google para vincular a assinatura'));
        }
        return fetch(fnUrl('link-subscription'), {
            method: 'POST',
            headers: apiHeaders(ReadEdyAuth.getAccessToken()),
            body: JSON.stringify({ checkout_token: checkoutToken })
        }).then(function(resp) {
            return resp.json().then(function(data) {
                if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
                clearCheckoutToken();
                return refresh(client);
            });
        });
    }

    function onReturnFromMp() {
        try {
            var u = new URL(window.location.href);
            var token = u.searchParams.get('checkout');
            if (token) saveCheckoutToken(token);
            if (u.searchParams.get('tab') === 'conta' && window.wireHomeUi) {
                /* wireHomeUi may not exist yet at parse time */
            }
            if (token) {
                u.searchParams.delete('checkout');
                var qs = u.searchParams.toString();
                window.history.replaceState({}, document.title, u.pathname + (qs ? '?' + qs : '') + u.hash);
            }
            return token || getCheckoutToken();
        } catch (e) {
            return getCheckoutToken();
        }
    }

    function needsGoogleLink() {
        var token = getCheckoutToken();
        if (!token) return false;
        if (window.ReadEdyAuth && ReadEdyAuth.isLoggedIn() && isActive()) return false;
        return true;
    }

    function formatUsageText() {
        if (!usage || !status || !status.plan) return '';
        var mbUsed = (usage.bytes_used / (1024 * 1024)).toFixed(1);
        return usage.pdf_count + '/' + (usage.max_pdfs || '—') + ' PDFs · ' +
            mbUsed + '/' + (usage.storage_mb || '—') + ' MB';
    }

    return {
        refresh: refresh,
        onChange: onChange,
        isActive: isActive,
        planLabel: planLabel,
        getStatus: function() { return status; },
        getUsage: getUsage,
        formatUsageText: formatUsageText,
        startCheckout: startCheckout,
        linkAfterAuth: linkAfterAuth,
        onReturnFromMp: onReturnFromMp,
        needsGoogleLink: needsGoogleLink,
        getCheckoutToken: getCheckoutToken,
        clearCheckoutToken: clearCheckoutToken
    };
})();
