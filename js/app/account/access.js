/* ═══════════════════════════════════════════════════════════════
   ReadEdy · account/access
   Acesso pago: bloqueio premium, checkout e botões de plano.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function canUsePremiumFeatures() {
    if (window.ReadEdyAuth && ReadEdyAuth.isAdmin && ReadEdyAuth.isAdmin()) return true;
    return !!(window.ReadEdyBilling && ReadEdyBilling.isActive());
}

function requirePaidAccess() {
    if (canUsePremiumFeatures()) return true;
    showNotification('Crie a conta e pague para usar o ReadEdy.', true);
    openHomeView('conta');
    return false;
}

function urlWantsAccountTab() {
    try {
        return new URL(window.location.href).searchParams.get('tab') === 'conta';
    } catch (e) {
        return false;
    }
}

function applyAccessLock() {
    if (!accessLockReady) return;
    var locked = !canUsePremiumFeatures();
    if (locked) document.body.classList.add('access-locked');
    else document.body.classList.remove('access-locked');
    if (locked) {
        if (typeof isReading !== 'undefined' && isReading && typeof stopTTS === 'function') {
            try { stopTTS(); } catch (e) {}
        }
        if (!homeView || homeActiveTab !== 'conta') {
            accessLockForcedConta = true;
            openHomeView('conta');
        } else if (!urlWantsAccountTab()) {
            accessLockForcedConta = true;
        }
        return;
    }
    if (accessLockForcedConta && homeActiveTab === 'conta') {
        accessLockForcedConta = false;
        var recovering = window.ReadEdyAuth && ReadEdyAuth.isPasswordRecovery();
        if (!recovering && !urlWantsAccountTab()) openHomeView('inicio');
    }
}

function pollPaidCheckout() {
    if (!window.ReadEdyBilling || !ReadEdyBilling.getCheckoutToken()) return;
    if (!window.ReadEdyAuth || !ReadEdyAuth.isLoggedIn()) return;
    var tries = 0;
    var timer = setInterval(function() {
        tries += 1;
        ReadEdyBilling.linkAfterAuth().then(function() {
            return ReadEdyBilling.refresh(readeraSb);
        }).then(function() {
            updateAccountUi();
            if (ReadEdyBilling.isActive()) clearInterval(timer);
        }).catch(function() {});
        if (tries >= 8) clearInterval(timer);
    }, 4000);
}

function startPlanCheckout(planSlug) {
    if (!window.ReadEdyBilling) return;
    var loggedIn = window.ReadEdyAuth && ReadEdyAuth.isLoggedIn();
    var user = loggedIn ? ReadEdyAuth.getUser() : null;
    var email = user && user.email ? user.email : '';
    if (!email) {
        showNotification('Crie sua conta ou entre antes de assinar.', true);
        var emailInput = document.getElementById('home-signup-email');
        if (emailInput) emailInput.focus();
        return;
    }
    setAppLoading(true, 'A abrir checkout…');
    ReadEdyBilling.startCheckout(planSlug, email).catch(function(err) {
        showNotification(err.message || String(err), true);
    }).then(function() {
        setAppLoading(false);
    });
}

var premiumButtonsBound = false;

function wirePremiumButtons() {
    if (premiumButtonsBound) return;
    premiumButtonsBound = true;
    document.querySelectorAll('.sidebar-premium-btn, .home-pro-banner').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            openHomeView('conta', true);
        });
    });
    var manageBtn = document.getElementById('home-btn-manage-subscription');
    if (manageBtn) {
        manageBtn.addEventListener('click', function() {
            if (window.ReadEdyBilling && ReadEdyBilling.isActive()) {
                showNotification('Assinatura ativa: ' + ReadEdyBilling.planLabel(), false);
                return;
            }
            startPlanCheckout('basic_monthly');
        });
    }
}
