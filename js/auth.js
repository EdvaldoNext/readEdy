/* ReadEdy Auth — login, sessão e helpers (ES5) */
window.ReadEdyAuth = (function() {
    var client = null;
    var session = null;
    var listeners = [];
    var _bound = false;
    var _linkingCheckout = false;
    var _passwordRecovery = false;

    function urlIndicatesRecovery() {
        try {
            var href = window.location.href || '';
            if (href.indexOf('type=recovery') >= 0) return true;
            var u = new URL(href);
            if (u.searchParams.get('type') === 'recovery') return true;
        } catch (e) {}
        return false;
    }

    function persistRecoveryFlag() {
        try {
            if (_passwordRecovery) sessionStorage.setItem('readedy_pw_recovery', '1');
            else sessionStorage.removeItem('readedy_pw_recovery');
        } catch (e) {}
    }

    function isPasswordRecovery() { return !!_passwordRecovery; }

    function beginPasswordRecovery() {
        _passwordRecovery = true;
        persistRecoveryFlag();
        notify();
    }

    function clearPasswordRecovery() {
        _passwordRecovery = false;
        persistRecoveryFlag();
    }

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
        var base = window.location.origin + window.location.pathname;
        try {
            if (window.ReadEdyBilling) {
                var token = ReadEdyBilling.getCheckoutToken();
                if (token) return base + '?checkout=' + encodeURIComponent(token) + '&tab=conta';
            }
            var u = new URL(window.location.href);
            if (u.searchParams.get('tab') === 'conta') {
                return base + '?tab=conta';
            }
        } catch (e) {}
        return base;
    }

    function getRecoveryRedirectTo() {
        return window.location.origin + window.location.pathname + '?tab=conta';
    }

    function tryLinkCheckoutAfterLogin() {
        if (_linkingCheckout) return Promise.resolve();
        if (!window.ReadEdyBilling || !ReadEdyBilling.getCheckoutToken()) return Promise.resolve();
        if (!isLoggedIn()) return Promise.resolve();
        _linkingCheckout = true;
        return ReadEdyBilling.linkAfterAuth().catch(function(err) {
            console.warn('link-subscription', err);
        }).then(function() {
            _linkingCheckout = false;
        });
    }

    function init(sb) {
        client = sb;
        if (!client || _bound) {
            return Promise.resolve(session).then(function() {
                return tryLinkCheckoutAfterLogin().then(function() { return session; });
            });
        }
        _bound = true;
        if (urlIndicatesRecovery()) _passwordRecovery = true;
        try {
            if (!_passwordRecovery && sessionStorage.getItem('readedy_pw_recovery') === '1') {
                _passwordRecovery = true;
            }
        } catch (e) {}

        client.auth.onAuthStateChange(function(event, newSession) {
            session = newSession;
            if (event === 'PASSWORD_RECOVERY') {
                _passwordRecovery = true;
                persistRecoveryFlag();
            }
            if (event === 'SIGNED_OUT') clearPasswordRecovery();
            notify();
            if (newSession && window.ReadEdyBilling && !_passwordRecovery) {
                tryLinkCheckoutAfterLogin();
            }
        });

        return client.auth.getSession().then(function(res) {
            session = res.data && res.data.session ? res.data.session : null;
            if (!session) clearPasswordRecovery();
            persistRecoveryFlag();
            cleanOAuthParams();
            notify();
            return _passwordRecovery ? Promise.resolve() : tryLinkCheckoutAfterLogin();
        }).then(function() {
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

    function isAdmin() {
        var user = getUser();
        if (!user) return false;
        return (user.app_metadata || {}).role === 'admin';
    }

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

    function signUpWithPassword(email, password) {
        if (!client) return Promise.reject(new Error('Cliente Supabase não iniciado'));
        if (!email) return Promise.reject(new Error('Informe o e-mail'));
        if (!password || password.length < 6) {
            return Promise.reject(new Error('A senha precisa ter no mínimo 6 caracteres'));
        }
        return client.auth.signUp({
            email: email,
            password: password,
            options: { emailRedirectTo: getRedirectTo() }
        }).then(function(res) {
            if (res.error) throw res.error;
            return res.data;
        });
    }

    function signInWithPassword(email, password) {
        if (!client) return Promise.reject(new Error('Cliente Supabase não iniciado'));
        if (!email || !password) return Promise.reject(new Error('Informe e-mail e senha'));
        return client.auth.signInWithPassword({
            email: email,
            password: password
        }).then(function(res) {
            if (res.error) throw res.error;
            return res.data;
        });
    }

    function resetPasswordForEmail(email) {
        if (!client) return Promise.reject(new Error('Cliente Supabase não iniciado'));
        if (!email) return Promise.reject(new Error('Informe o e-mail'));
        return client.auth.resetPasswordForEmail(email, {
            redirectTo: getRecoveryRedirectTo()
        }).then(function(res) {
            if (res.error) throw res.error;
            return res.data;
        });
    }

    function updatePassword(password) {
        if (!client) return Promise.reject(new Error('Cliente Supabase não iniciado'));
        if (!isLoggedIn()) return Promise.reject(new Error('Sessão expirada. Peça um novo link.'));
        if (!password || password.length < 6) {
            return Promise.reject(new Error('A senha precisa ter no mínimo 6 caracteres'));
        }
        return client.auth.updateUser({ password: password }).then(function(res) {
            if (res.error) throw res.error;
            clearPasswordRecovery();
            notify();
            return res.data;
        });
    }

    function signOut() {
        if (!client) return Promise.resolve();
        return client.auth.signOut().then(function() {
            session = null;
            clearPasswordRecovery();
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
        isAdmin: isAdmin,
        authHeaders: authHeaders,
        signInWithGoogle: signInWithGoogle,
        signInWithEmail: signInWithEmail,
        signUpWithPassword: signUpWithPassword,
        signInWithPassword: signInWithPassword,
        resetPasswordForEmail: resetPasswordForEmail,
        updatePassword: updatePassword,
        isPasswordRecovery: isPasswordRecovery,
        beginPasswordRecovery: beginPasswordRecovery,
        clearPasswordRecovery: clearPasswordRecovery,
        signOut: signOut,
        logSessionStart: logSessionStart,
        tryLinkCheckoutAfterLogin: tryLinkCheckoutAfterLogin
    };
})();
