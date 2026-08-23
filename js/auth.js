/* ReadEdy Auth — login, sessão e helpers (ES5) */
window.ReadEdyAuth = (function() {
    var client = null;
    var session = null;
    var listeners = [];
    var _bound = false;

    function notify() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](session); } catch (e) { console.warn(e); }
        }
    }

    function cleanOAuthParams() {
        try {
            var u = new URL(window.location.href);
            var keys = ['code', 'state', 'error', 'error_description', 'access_token', 'refresh_token', 'type'];
            var changed = false;
            keys.forEach(function(k) {
                if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; }
            });
            if (changed) {
                var qs = u.searchParams.toString();
                window.history.replaceState({}, document.title, u.pathname + (qs ? '?' + qs : '') + u.hash);
            }
        } catch (e) {}
    }

    function getRedirectTo() {
        return window.location.origin + window.location.pathname;
    }

    function init(sb) {
        client = sb;
        if (!client || _bound) return Promise.resolve(session);
        _bound = true;

        return client.auth.getSession().then(function(res) {
            session = res.data && res.data.session ? res.data.session : null;
            cleanOAuthParams();
            notify();
            client.auth.onAuthStateChange(function(_event, newSession) {
                session = newSession;
                notify();
            });
            return session;
        });
    }

    function onAuthStateChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
        if (session) fn(session);
    }

    function getSession() { return session; }

    function getAccessToken() {
        return session && session.access_token ? session.access_token : null;
    }

    function getUserId() {
        return session && session.user && session.user.id ? session.user.id : null;
    }

    function getUser() {
        return session && session.user ? session.user : null;
    }

    function isLoggedIn() { return !!getAccessToken(); }

    function authHeaders() {
        var cfg = window.READERA_SUPABASE || {};
        var token = getAccessToken() || cfg.anonKey || '';
        return { 'Authorization': 'Bearer ' + token, 'apikey': cfg.anonKey || '' };
    }

    function signInWithGoogle() {
        if (!client) return Promise.reject(new Error('Cliente Supabase não iniciado'));
        return client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: getRedirectTo() }
        });
    }

    function signInWithEmail(email) {
        if (!client) return Promise.reject(new Error('Cliente Supabase não iniciado'));
        if (!email) return Promise.reject(new Error('Informe o e-mail'));
        return client.auth.signInWithOtp({
            email: email,
            options: { emailRedirectTo: getRedirectTo() }
        });
    }

    function signOut() {
        if (!client) return Promise.resolve();
        return client.auth.signOut().then(function() {
            session = null;
            notify();
        });
    }

    function logSessionStart() {
        if (!client || !isLoggedIn()) return Promise.resolve();
        return client.from('usage_logs').insert({
            user_id: getUserId(),
            event_type: 'session_start',
            metadata: { path: window.location.pathname }
        }).then(function() {}, function(err) { console.warn('usage_logs', err); });
    }

    return {
        init: init,
        onAuthStateChange: onAuthStateChange,
        getSession: getSession,
        getAccessToken: getAccessToken,
        getUserId: getUserId,
        getUser: getUser,
        isLoggedIn: isLoggedIn,
        authHeaders: authHeaders,
        signInWithGoogle: signInWithGoogle,
        signInWithEmail: signInWithEmail,
        signOut: signOut,
        logSessionStart: logSessionStart
    };
})();
