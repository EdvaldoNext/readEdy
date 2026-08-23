/* ReadEdy Billing — assinatura e checkout Mercado Pago (ES5) */
window.ReadEdyBilling = (function() {
    var client = null;
    var status = null;
    var listeners = [];

    function notify() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](status); } catch (e) { console.warn(e); }
        }
    }

    function isActive() {
        if (!status) return false;
        if (status.status !== 'active' && status.status !== 'trialing') return false;
        var end = status.current_period_end || status.trial_ends_at;
        if (!end) return true;
        return new Date(end).getTime() > Date.now();
    }

    function planLabel() {
        if (!status) return 'Sem plano';
        if (status.plan && status.plan.name) return status.plan.name;
        return status.status || 'Sem plano';
    }

    function refresh(sb) {
        client = sb || client;
        if (!client || !window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) {
            status = null;
            notify();
            return Promise.resolve(null);
        }
        return client.from('subscriptions')
            .select('id, status, current_period_end, trial_ends_at, plan:plans(slug, name, price_brl, billing_interval)')
            .eq('user_id', ReadEdyAuth.getUserId())
            .in('status', ['pending', 'trialing', 'active', 'past_due'])
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
                notify();
                return status;
            });
    }

    function onChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
        fn(status);
    }

    function startCheckout(planSlug) {
        planSlug = planSlug || 'pro_monthly';
        if (!client || !ReadEdyAuth.isLoggedIn()) {
            return Promise.reject(new Error('Faça login para assinar o ReadEdy Pro'));
        }
        var token = ReadEdyAuth.getAccessToken();
        var cfg = window.READERA_SUPABASE || {};
        var url = (cfg.url || '').replace(/\/$/, '') + '/functions/v1/create-subscription';
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': cfg.anonKey,
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ plan_slug: planSlug })
        }).then(function(resp) {
            return resp.json().then(function(body) {
                if (!resp.ok) throw new Error(body.error || ('HTTP ' + resp.status));
                if (!body.init_point) throw new Error('Checkout sem URL');
                window.location.href = body.init_point;
                return body;
            });
        });
    }

    return {
        refresh: refresh,
        onChange: onChange,
        isActive: isActive,
        planLabel: planLabel,
        getStatus: function() { return status; },
        startCheckout: startCheckout
    };
})();
