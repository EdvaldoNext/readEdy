/* ReadEdy API client — mesma superfície usada por auth, biblioteca, billing e admin. */
window.ReadEdyCloud = (function() {
    var SESSION_KEY = 'readedy-auth';

    function baseUrl(url) {
        return String(url || '').replace(/\/$/, '');
    }

    function storageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function storageSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) {}
    }

    function storageRemove(key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }

    function decodeUser(value) {
        if (!value) return null;
        try {
            var padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
            while (padded.length % 4) padded += '=';
            var binary = atob(padded);
            var encoded = '';
            for (var i = 0; i < binary.length; i++) {
                encoded += '%' + ('00' + binary.charCodeAt(i).toString(16)).slice(-2);
            }
            return JSON.parse(decodeURIComponent(encoded));
        } catch (e) {
            return null;
        }
    }

    function readHash() {
        var hash = window.location.hash || '';
        if (hash.charAt(0) === '#') hash = hash.slice(1);
        if (!hash || hash.indexOf('access_token=') < 0) return null;
        var params = {};
        hash.split('&').forEach(function(part) {
            var eq = part.indexOf('=');
            if (eq < 0) return;
            params[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
        });
        if (!params.access_token) return null;
        var expiresIn = Number(params.expires_in || 3600);
        return {
            type: params.type || '',
            session: {
                access_token: params.access_token,
                refresh_token: params.refresh_token || '',
                expires_at: Math.floor(Date.now() / 1000) + expiresIn,
                token_type: 'bearer',
                user: decodeUser(params.user)
            }
        };
    }

    function clearHash() {
        try {
            var u = new URL(window.location.href);
            if (!u.hash) return;
            window.history.replaceState({}, document.title, u.pathname + u.search);
        } catch (e) {}
    }

    function createClient(url, anonKey) {
        var root = baseUrl(url);
        var listeners = [];
        var session = null;
        var refreshTimer = null;

        function persist(next) {
            session = next;
            if (next) storageSet(SESSION_KEY, JSON.stringify(next));
            else storageRemove(SESSION_KEY);
        }

        function emit(event, next) {
            persist(next);
            scheduleRefresh();
            for (var i = 0; i < listeners.length; i++) {
                try { listeners[i](event, next); } catch (e) { console.warn(e); }
            }
        }

        function authHeaders(extra) {
            var headers = extra || {};
            headers.apikey = anonKey || '';
            var token = session && session.access_token ? session.access_token : (anonKey || '');
            headers.Authorization = 'Bearer ' + token;
            return headers;
        }

        function api(path, options) {
            options = options || {};
            var headers = authHeaders(options.headers || {});
            if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
            return fetch(root + path, {
                method: options.method || 'GET',
                headers: headers,
                body: options.body || null
            }).then(function(res) {
                var type = res.headers.get('content-type') || '';
                if (type.indexOf('application/json') < 0) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res;
                }
                return res.json().then(function(body) {
                    if (!res.ok) {
                        var message = (body && (body.error && body.error.message || body.error)) || ('HTTP ' + res.status);
                        var err = new Error(typeof message === 'string' ? message : 'Erro na nuvem');
                        err.status = res.status;
                        err.body = body;
                        throw err;
                    }
                    return body;
                });
            });
        }

        function loadStored() {
            try {
                var raw = storageGet(SESSION_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        }

        function refresh() {
            var current = session || loadStored();
            if (!current || !current.refresh_token) return Promise.reject(new Error('Sessão expirada'));
            return fetch(root + '/auth/v1/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: anonKey || '' },
                body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: current.refresh_token })
            }).then(function(res) {
                return res.json().then(function(body) {
                    if (!res.ok) throw new Error((body && body.error) || 'Sessão expirada');
                    emit('TOKEN_REFRESHED', body.session);
                    return body.session;
                });
            });
        }

        function scheduleRefresh() {
            if (refreshTimer) clearTimeout(refreshTimer);
            if (!session || !session.expires_at || !session.refresh_token) return;
            var ms = session.expires_at * 1000 - Date.now() - 60000;
            if (ms < 5000) ms = 5000;
            refreshTimer = setTimeout(function() {
                refresh().catch(function() { emit('SIGNED_OUT', null); });
            }, ms);
        }

        function ensureFresh() {
            var current = session || loadStored();
            if (!current) return Promise.resolve(null);
            if (current.expires_at && current.expires_at * 1000 - Date.now() < 30000 && current.refresh_token) {
                session = current;
                return refresh().catch(function() {
                    emit('SIGNED_OUT', null);
                    return null;
                });
            }
            if (!session) persist(current);
            scheduleRefresh();
            return Promise.resolve(current);
        }

        var auth = {
            onAuthStateChange: function(fn) {
                if (typeof fn === 'function') listeners.push(fn);
                return { data: { subscription: { unsubscribe: function() {} } } };
            },
            getSession: function() {
                var fromHash = readHash();
                if (fromHash) {
                    clearHash();
                    var event = fromHash.type === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN';
                    emit(event, fromHash.session);
                    return Promise.resolve({ data: { session: fromHash.session }, error: null });
                }
                return ensureFresh().then(function(current) {
                    return { data: { session: current }, error: null };
                });
            },
            signUp: function(payload) {
                return api('/auth/v1/signup', {
                    method: 'POST',
                    body: JSON.stringify({ email: payload.email, password: payload.password })
                }).then(function(body) {
                    if (body.session) emit('SIGNED_IN', body.session);
                    return { data: body, error: null };
                });
            },
            signInWithPassword: function(payload) {
                return api('/auth/v1/token', {
                    method: 'POST',
                    body: JSON.stringify({ email: payload.email, password: payload.password })
                }).then(function(body) {
                    if (body.session) emit('SIGNED_IN', body.session);
                    return { data: body, error: null };
                });
            },
            signInWithOtp: function(payload) {
                var redirect = payload && payload.options && payload.options.emailRedirectTo;
                return api('/auth/v1/otp', {
                    method: 'POST',
                    body: JSON.stringify({ email: payload.email, redirect_to: redirect || '' })
                }).then(function() {
                    return { data: {}, error: null };
                });
            },
            signInWithOAuth: function(payload) {
                var redirect = payload && payload.options && payload.options.redirectTo;
                window.location.assign(root + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirect || window.location.href));
                return Promise.resolve({ data: {}, error: null });
            },
            resetPasswordForEmail: function(email, options) {
                return api('/auth/v1/recover', {
                    method: 'POST',
                    body: JSON.stringify({ email: email, redirect_to: (options && options.redirectTo) || '' })
                }).then(function() {
                    return { data: {}, error: null };
                });
            },
            updateUser: function(payload) {
                return api('/auth/v1/user', {
                    method: 'PUT',
                    body: JSON.stringify({ password: payload.password })
                }).then(function(body) {
                    return { data: body, error: null };
                });
            },
            signOut: function() {
                var done = function() {
                    emit('SIGNED_OUT', null);
                };
                return api('/auth/v1/logout', { method: 'POST', body: '{}' }).then(done, done);
            }
        };

        function Query(table) {
            this.table = table;
            this.action = 'select';
            this.payload = null;
            this.filters = [];
            this.orderBy = null;
            this.rowLimit = null;
            this.mode = null;
            this.columns = '*';
        }

        Query.prototype.select = function(columns) {
            if (this.action !== 'insert' && this.action !== 'upsert') this.action = 'select';
            this.columns = columns || '*';
            return this;
        };
        Query.prototype.insert = function(payload) { this.action = 'insert'; this.payload = payload; return this; };
        Query.prototype.upsert = function(payload) { this.action = 'upsert'; this.payload = payload; return this; };
        Query.prototype.update = function(payload) { this.action = 'update'; this.payload = payload; return this; };
        Query.prototype.delete = function() { this.action = 'delete'; return this; };
        Query.prototype.eq = function(column, value) { this.filters.push({ op: 'eq', column: column, value: value }); return this; };
        Query.prototype.in = function(column, value) { this.filters.push({ op: 'in', column: column, value: value }); return this; };
        Query.prototype.is = function(column, value) { this.filters.push({ op: 'is', column: column, value: value }); return this; };
        Query.prototype.order = function(column, options) {
            this.orderBy = { column: column, ascending: !(options && options.ascending === false) };
            return this;
        };
        Query.prototype.limit = function(value) { this.rowLimit = value; return this; };
        Query.prototype.maybeSingle = function() { this.mode = 'maybe'; return this; };
        Query.prototype.single = function() { this.mode = 'one'; return this; };
        Query.prototype.then = function(ok, err) { return this.exec().then(ok, err); };
        Query.prototype.exec = function() {
            return ensureFresh().then(function() {
                return api('/v1/query', {
                    method: 'POST',
                    body: JSON.stringify({
                        table: this.table,
                        action: this.action,
                        columns: this.columns,
                        payload: this.payload,
                        filters: this.filters,
                        order: this.orderBy,
                        limit: this.rowLimit,
                        mode: this.mode
                    })
                });
            }.bind(this)).then(function(body) {
                if (body && body.error) return body;
                return body;
            }).catch(function(err) {
                if (err && err.body && err.body.data !== undefined) return err.body;
                return { data: null, error: { message: err.message || String(err) } };
            });
        };

        function storageError(err) {
            return { data: null, error: { message: err && err.message ? err.message : String(err) } };
        }

        var storageApi = {
            from: function() {
                return {
                    upload: function(path, body) {
                        return ensureFresh().then(function() {
                            var headers = authHeaders({ 'Content-Type': 'application/pdf' });
                            return fetch(root + '/storage/v1/object/pdfs/' + String(path).split('/').map(encodeURIComponent).join('/'), {
                                method: 'PUT',
                                headers: headers,
                                body: body
                            });
                        }).then(function(res) {
                            if (!res.ok) {
                                return res.json().catch(function() { return {}; }).then(function(data) {
                                    return storageError(new Error((data && data.error) || ('HTTP ' + res.status)));
                                });
                            }
                            return { data: { path: path }, error: null };
                        }).catch(storageError);
                    },
                    download: function(path) {
                        return ensureFresh().then(function() {
                            return fetch(root + '/storage/v1/object/pdfs/' + String(path).split('/').map(encodeURIComponent).join('/'), {
                                method: 'GET',
                                headers: authHeaders()
                            });
                        }).then(function(res) {
                            if (!res.ok) throw new Error('HTTP ' + res.status);
                            return res.blob();
                        }).then(function(blob) {
                            return { data: blob, error: null };
                        }).catch(storageError);
                    },
                    remove: function(paths) {
                        return ensureFresh().then(function() {
                            return api('/storage/v1/object/pdfs/remove', {
                                method: 'POST',
                                body: JSON.stringify({ paths: paths || [] })
                            });
                        }).then(function() {
                            return { data: paths, error: null };
                        }).catch(storageError);
                    }
                };
            }
        };

        return { auth: auth, from: function(table) { return new Query(table); }, storage: storageApi };
    }

    return { createClient: createClient };
})();
