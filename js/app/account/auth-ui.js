/* ═══════════════════════════════════════════════════════════════
   ReadEdy · account/auth-ui
   Interface de conta: login, cadastro, recuperação e troca de senha.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function updateAccountUi() {
    var loggedIn = window.ReadEdyAuth && ReadEdyAuth.isLoggedIn();
    var user = loggedIn ? ReadEdyAuth.getUser() : null;
    if (loggedIn) document.body.classList.add('auth-session');
    else document.body.classList.remove('auth-session');
    var active = window.ReadEdyBilling && ReadEdyBilling.isActive();
    var isAdminUser = window.ReadEdyAuth && ReadEdyAuth.isAdmin && ReadEdyAuth.isAdmin();
    var unlocked = !!(active || isAdminUser);
    var needsLink = window.ReadEdyBilling && ReadEdyBilling.needsGoogleLink();
    var nameEl = document.getElementById('home-account-name');
    var subEl = document.getElementById('home-account-cloud-status');
    var planEl = document.getElementById('home-account-plan-status');
    var usageEl = document.getElementById('home-account-usage-status');
    var authGuest = document.getElementById('home-auth-guest');
    var authUser = document.getElementById('home-auth-user');
    var authPostpay = document.getElementById('home-auth-postpay');
    var authPassword = document.getElementById('home-auth-password');
    var recovering = window.ReadEdyAuth && ReadEdyAuth.isPasswordRecovery();
    if (recovering) {
        passwordFormMode = 'recovery';
        document.body.classList.add('password-recovery');
        if (typeof openHomeView === 'function') openHomeView('conta');
    } else {
        document.body.classList.remove('password-recovery');
        if (passwordFormMode === 'recovery') passwordFormMode = null;
    }
    if (nameEl) nameEl.textContent = loggedIn ? (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || user.email || 'Conta ReadEdy') : 'ReadEdy';
    if (subEl) {
        if (!readeraSb) subEl.textContent = 'Nuvem desligada (sem config.js)';
        else if (!loggedIn) subEl.textContent = 'Entre com e-mail ou Google para continuar';
        else if (isAdminUser) subEl.textContent = 'Nuvem ligada · acesso vitalício';
        else if (active) subEl.textContent = 'Nuvem ligada · sessão ativa';
        else if (needsLink) subEl.textContent = 'Pagamento recebido — vincule com Google';
        else if (loggedIn && window.ReadEdyBilling && ReadEdyBilling.getCheckoutToken()) {
            subEl.textContent = 'Pagamento em confirmação. Se já pagou no PIX, aguarde e recarregue.';
        }
        else subEl.textContent = 'Conta sem assinatura ativa';
    }
    if (planEl && window.ReadEdyBilling) {
        if (!loggedIn && !needsLink) planEl.textContent = 'Planos a partir de R$ 5,99/mês';
        else if (needsLink) planEl.textContent = 'Último passo: vincular conta Google';
        else if (isAdminUser) planEl.textContent = 'Plano: Vitalício';
        else if (active) planEl.textContent = 'Plano: ' + ReadEdyBilling.planLabel();
        else planEl.textContent = 'Assinatura inativa — escolha um plano abaixo';
    }
    if (usageEl) {
        if (unlocked && window.ReadEdyBilling && ReadEdyBilling.formatUsageText()) {
            usageEl.textContent = 'Uso: ' + ReadEdyBilling.formatUsageText();
            usageEl.classList.remove('hidden');
        } else {
            usageEl.classList.add('hidden');
        }
    }
    if (authPassword) {
        if (passwordFormMode === 'recovery' || passwordFormMode === 'change') {
            authPassword.classList.remove('hidden');
            syncPasswordFormCopy();
        } else {
            authPassword.classList.add('hidden');
        }
    }
    if (authGuest) {
        if (passwordFormMode === 'recovery') authGuest.classList.add('hidden');
        else if (!loggedIn && !needsLink) authGuest.classList.remove('hidden');
        else if (loggedIn && !unlocked && !needsLink && passwordFormMode !== 'change') authGuest.classList.remove('hidden');
        else if (passwordFormMode === 'change' && loggedIn && !unlocked && !needsLink) authGuest.classList.add('hidden');
        else authGuest.classList.add('hidden');
    }
    if (authPostpay) {
        if (needsLink && !unlocked && passwordFormMode !== 'recovery') authPostpay.classList.remove('hidden');
        else authPostpay.classList.add('hidden');
    }
    if (authUser) {
        if (loggedIn && unlocked && !needsLink && passwordFormMode !== 'recovery' && passwordFormMode !== 'change') authUser.classList.remove('hidden');
        else authUser.classList.add('hidden');
    }
    var signupBlock = document.getElementById('home-signup-block');
    if (signupBlock) {
        if (loggedIn) signupBlock.classList.add('hidden');
        else signupBlock.classList.remove('hidden');
    }
    var planCards = document.querySelector('#home-auth-guest .home-plan-cards');
    if (planCards) {
        if (isAdminUser || unlocked) planCards.classList.add('hidden');
        else planCards.classList.remove('hidden');
    }
    var leadText = document.getElementById('home-auth-lead-text');
    if (leadText) {
        leadText.textContent = isAdminUser
            ? 'Conta com acesso vitalício. Você já pode usar o ReadEdy.'
            : (loggedIn
                ? 'Conta criada. Pague um plano para liberar o uso do ReadEdy.'
                : 'Entre com suas credenciais para acessar');
    }
    var signoutLogged = document.getElementById('home-btn-signout-logged');
    if (signoutLogged) {
        if (loggedIn && !needsLink && passwordFormMode !== 'recovery' && passwordFormMode !== 'change') signoutLogged.classList.remove('hidden');
        else signoutLogged.classList.add('hidden');
    }
    var changeGuest = document.getElementById('home-btn-change-password-guest');
    if (changeGuest) {
        if (loggedIn && !needsLink && passwordFormMode !== 'recovery' && passwordFormMode !== 'change') changeGuest.classList.remove('hidden');
        else changeGuest.classList.add('hidden');
    }
}

var signupMode = 'signup';

var passwordFormMode = null;

function syncPasswordFormCopy() {
    var title = document.getElementById('home-password-title');
    var lead = document.getElementById('home-password-lead');
    var cancel = document.getElementById('home-password-cancel');
    var changing = passwordFormMode === 'change';
    if (title) title.textContent = changing ? 'Alterar senha' : 'Definir senha';
    if (lead) {
        lead.textContent = changing
            ? 'Digite a nova senha para esta conta.'
            : 'Crie uma senha para entrar com e-mail da próxima vez.';
    }
    if (cancel) {
        if (changing) cancel.classList.remove('hidden');
        else cancel.classList.add('hidden');
    }
}

function wireSignupForm() {
    var tabSignup = document.getElementById('home-tab-signup');
    var tabSignin = document.getElementById('home-tab-signin');
    var form = document.getElementById('home-signup-form');
    var emailInput = document.getElementById('home-signup-email');
    var passInput = document.getElementById('home-signup-password');
    var submitBtn = document.getElementById('home-signup-submit');
    var googleBtn = document.getElementById('home-btn-google-signup');
    var rememberEl = document.getElementById('home-signup-remember');
    var recoverToggle = document.getElementById('home-btn-recover-toggle');
    var recoverForm = document.getElementById('home-auth-email-form');
    if (!form || !emailInput || !passInput || !submitBtn) return;

    try {
        var savedEmail = localStorage.getItem('readedy_remember_email');
        if (savedEmail) emailInput.value = savedEmail;
    } catch (e) {}

    function setMode(mode) {
        signupMode = mode;
        var creating = mode === 'signup';
        submitBtn.textContent = creating ? 'Criar conta' : 'Entrar';
        passInput.setAttribute('autocomplete', creating ? 'new-password' : 'current-password');
        if (tabSignup) tabSignup.classList.toggle('is-active', creating);
        if (tabSignin) tabSignin.classList.toggle('is-active', !creating);
        if (recoverToggle) recoverToggle.style.visibility = creating ? 'hidden' : 'visible';
        if (creating && recoverForm) recoverForm.classList.add('hidden');
    }

    if (tabSignup) tabSignup.addEventListener('click', function() { setMode('signup'); });
    if (tabSignin) tabSignin.addEventListener('click', function() { setMode('signin'); });

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        if (!window.ReadEdyAuth) return;
        var email = String(emailInput.value || '').trim();
        var password = String(passInput.value || '');
        try {
            if (rememberEl && rememberEl.checked) localStorage.setItem('readedy_remember_email', email);
            else localStorage.removeItem('readedy_remember_email');
        } catch (err) {}
        submitBtn.disabled = true;
        var action = signupMode === 'signup'
            ? ReadEdyAuth.signUpWithPassword(email, password)
            : ReadEdyAuth.signInWithPassword(email, password);
        action.then(function(data) {
            if (signupMode === 'signup' && data && !data.session) {
                showNotification('Confirme o e-mail que enviamos para ativar a conta.', false);
                return;
            }
            passInput.value = '';
            showNotification(signupMode === 'signup'
                ? 'Conta criada. Escolha o plano para pagar.'
                : 'Bem-vindo de volta.', false);
            if (signupMode !== 'signup' && canUsePremiumFeatures()) openHomeView('inicio');
        }).catch(function(err) {
            showNotification(translateAuthError(err), true);
        }).then(function() {
            submitBtn.disabled = false;
        });
    });

    if (googleBtn) {
        googleBtn.addEventListener('click', function() {
            if (!window.ReadEdyAuth) return;
            ReadEdyAuth.signInWithGoogle().catch(function(err) {
                showNotification(err.message || String(err), true);
            });
        });
    }

    setMode('signup');
}

function translateAuthError(err) {
    var msg = (err && err.message ? err.message : String(err || '')).toLowerCase();
    if (msg.indexOf('already registered') >= 0 || msg.indexOf('already exists') >= 0) {
        return 'Este e-mail já tem conta. Use "Já tenho conta" para entrar.';
    }
    if (msg.indexOf('invalid login credentials') >= 0) {
        return 'E-mail ou senha incorretos.';
    }
    if (msg.indexOf('email not confirmed') >= 0) {
        return 'Confirme o e-mail que enviamos antes de entrar.';
    }
    if (msg.indexOf('password') >= 0 && msg.indexOf('6') >= 0) {
        return 'A senha precisa ter no mínimo 6 caracteres.';
    }
    if (msg.indexOf('same password') >= 0 || msg.indexOf('should be different') >= 0) {
        return 'A nova senha precisa ser diferente da atual.';
    }
    if (msg.indexOf('rate limit') >= 0 || msg.indexOf('for security purposes') >= 0) {
        return 'Aguarde um minuto e tente enviar o e-mail de novo.';
    }
    return err && err.message ? err.message : String(err);
}

function wireAuthUi() {
    var btnLinkGoogle = document.getElementById('home-btn-link-google');
    var btnSignOut = document.getElementById('home-btn-signout');
    var btnSignOutLogged = document.getElementById('home-btn-signout-logged');
    var emailInput = document.getElementById('home-auth-email-input');
    var form = document.getElementById('home-auth-email-form');
    var recoverToggle = document.getElementById('home-btn-recover-toggle');
    var planBasic = document.getElementById('home-btn-plan-basic');
    var planPremium = document.getElementById('home-btn-plan-premium');
    if (planBasic) {
        planBasic.addEventListener('click', function() {
            startPlanCheckout('basic_monthly');
        });
    }
    if (planPremium) {
        planPremium.addEventListener('click', function() {
            startPlanCheckout('premium_monthly');
        });
    }
    if (btnLinkGoogle) {
        btnLinkGoogle.addEventListener('click', function() {
            if (!window.ReadEdyAuth) return;
            ReadEdyAuth.signInWithGoogle().catch(function(e) {
                showNotification(e.message || String(e), true);
            });
        });
    }
    wireSignupForm();
    if (recoverToggle && form) {
        recoverToggle.addEventListener('click', function() {
            form.classList.toggle('hidden');
            if (!form.classList.contains('hidden') && emailInput) {
                var signupEmail = document.getElementById('home-signup-email');
                if (signupEmail && signupEmail.value && !emailInput.value) {
                    emailInput.value = signupEmail.value;
                }
                emailInput.focus();
            }
        });
    }
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            if (!window.ReadEdyAuth || !emailInput) return;
            var recoverBtn = form.querySelector('button[type="submit"]');
            if (recoverBtn) recoverBtn.disabled = true;
            ReadEdyAuth.resetPasswordForEmail(emailInput.value.trim()).then(function() {
                showNotification('Se o e-mail existir, enviaremos um link da ReadEdy para criar a senha.', false);
                form.classList.add('hidden');
            }).catch(function(err) {
                showNotification(translateAuthError(err), true);
            }).then(function() {
                if (recoverBtn) recoverBtn.disabled = false;
            });
        });
    }
    var passwordForm = document.getElementById('home-password-form');
    var passwordNew = document.getElementById('home-password-new');
    var passwordConfirm = document.getElementById('home-password-confirm');
    var passwordSubmit = document.getElementById('home-password-submit');
    var passwordCancel = document.getElementById('home-password-cancel');
    function openChangePassword() {
        if (!window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) return;
        passwordFormMode = 'change';
        syncPasswordFormCopy();
        if (passwordNew) passwordNew.value = '';
        if (passwordConfirm) passwordConfirm.value = '';
        updateAccountUi();
        if (passwordNew) passwordNew.focus();
    }
    var btnChange = document.getElementById('home-btn-change-password');
    var btnChangeGuest = document.getElementById('home-btn-change-password-guest');
    if (btnChange) btnChange.addEventListener('click', openChangePassword);
    if (btnChangeGuest) btnChangeGuest.addEventListener('click', openChangePassword);
    if (passwordCancel) {
        passwordCancel.addEventListener('click', function() {
            passwordFormMode = null;
            if (passwordNew) passwordNew.value = '';
            if (passwordConfirm) passwordConfirm.value = '';
            updateAccountUi();
        });
    }
    if (passwordForm) {
        passwordForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (!window.ReadEdyAuth) return;
            var next = passwordNew ? String(passwordNew.value || '') : '';
            var again = passwordConfirm ? String(passwordConfirm.value || '') : '';
            if (next !== again) {
                showNotification('As senhas não coincidem.', true);
                return;
            }
            if (passwordSubmit) passwordSubmit.disabled = true;
            ReadEdyAuth.updatePassword(next).then(function() {
                passwordFormMode = null;
                if (passwordNew) passwordNew.value = '';
                if (passwordConfirm) passwordConfirm.value = '';
                showNotification('Senha salva. Agora você pode entrar com e-mail e senha.', false);
                updateAccountUi();
            }).catch(function(err) {
                showNotification(translateAuthError(err), true);
            }).then(function() {
                if (passwordSubmit) passwordSubmit.disabled = false;
            });
        });
    }
    if (btnSignOut) {
        btnSignOut.addEventListener('click', function() {
            if (window.ReadEdyAuth) ReadEdyAuth.signOut();
        });
    }
    if (btnSignOutLogged) {
        btnSignOutLogged.addEventListener('click', function() {
            if (window.ReadEdyAuth) ReadEdyAuth.signOut();
        });
    }
    if (window.ReadEdyBilling) {
        ReadEdyBilling.onChange(function() {
            updateAccountUi();
            applyAccessLock();
            applyTtsEngineFromPreference({ invalidateCache: false });
        });
    }
}
