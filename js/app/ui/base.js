/* ═══════════════════════════════════════════════════════════════
   ReadEdy · ui/base
   Barra de progresso, loading, tema claro/escuro, toasts e notificações.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function showStatusBar(kind) {
    clearTimeout(_rdrSbHideTimer);
    if (_rdrSbRaf) { cancelAnimationFrame(_rdrSbRaf); _rdrSbRaf = null; }
    var bar = document.getElementById('rdr-status-bar');
    var fill = document.getElementById('rdr-status-fill');
    if (!bar || !fill) return;
    bar.className = 'sb-' + (kind || 'pdf') + ' sb-active';
    fill.style.width = '0%';
    _rdrSbTickStart = Date.now();
    _rdrSbSimTick();
}

function _rdrSbSimTick() {
    var fill = document.getElementById('rdr-status-fill');
    if (!fill) return;
    var elapsed = Date.now() - _rdrSbTickStart;
    /* Rápido até 70% em 3s, depois desacelera logaritmicamente até máx 90% */
    var p = elapsed < 3000
        ? (elapsed / 3000) * 0.70
        : 0.70 + (1 - Math.exp(-(elapsed - 3000) / 10000)) * 0.20;
    fill.style.width = Math.min(p * 100, 90) + '%';
    _rdrSbRaf = requestAnimationFrame(_rdrSbSimTick);
}

function hideStatusBar(success) {
    if (_rdrSbRaf) { cancelAnimationFrame(_rdrSbRaf); _rdrSbRaf = null; }
    var bar = document.getElementById('rdr-status-bar');
    var fill = document.getElementById('rdr-status-fill');
    if (!bar || !fill) return;
    if (success !== false) {
        fill.style.width = '100%';
        _rdrSbHideTimer = setTimeout(function() { bar.classList.remove('sb-active'); }, 420);
    } else {
        bar.classList.remove('sb-active');
    }
}

/* Aceita 3.º parâmetro opcional 'kind' para a cor da barra: 'pdf' | 'tts' | 'upload' */
function setAppLoading(show, message, kind) {
    if (!loading) return;
    if (message) loading.textContent = message;
    else if (!show) loading.textContent = 'Carregando PDF...';
    if (show) {
        loading.classList.remove('hidden');
        showStatusBar(kind || 'pdf');
    } else {
        loading.classList.add('hidden');
        hideStatusBar();
    }
}

function isPdfThemeDark() {
    return document.body.classList.contains('dark');
}

function applyTheme(dark) {
    if (dark) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
    safeStorage.setItem('readera-theme', dark ? 'dark' : 'light');
    var icon = dark ? ICON_SUN : ICON_MOON;
    var title = dark
        ? 'Cores invertidas — toque para voltar ao normal'
        : 'Inverter cores da página do PDF';
    ['btn-theme', 'btn-theme-reader'].forEach(function(id) {
        var themeBtn = document.getElementById(id);
        if (!themeBtn) return;
        themeBtn.innerHTML = icon;
        themeBtn.title = title;
        themeBtn.setAttribute('aria-label', title);
        themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        if (dark) themeBtn.classList.add('is-active');
        else themeBtn.classList.remove('is-active');
    });
}

function togglePdfTheme() {
    applyTheme(!isPdfThemeDark());
    schedulePushUserPreferences();
    if (typeof showTtsToast === 'function') {
        showTtsToast(isPdfThemeDark() ? 'Cores do PDF invertidas' : 'Cores normais do PDF');
    }
}

function wireThemeButtons() {
    ['btn-theme', 'btn-theme-reader'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn || btn._themeBound) return;
        btn._themeBound = true;
        btn.addEventListener('click', togglePdfTheme);
    });
    var homeBtn = document.getElementById('home-btn-theme');
    if (homeBtn && !homeBtn._themeBound) {
        homeBtn._themeBound = true;
        homeBtn.addEventListener('click', togglePdfTheme);
    }
}

let _toastTimer = null;

function showTtsToast(msg) {
    const el = document.getElementById('tts-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function() { el.classList.remove('visible'); }, 2800);
}

/* Notificação não-bloqueante (substitui alert() — funciona em TVs) */
let _notifTimer = null;

function showNotification(msg, isError) {
    const el = document.getElementById('app-notification');
    const txt = document.getElementById('app-notification-text');
    if (!el || !txt) { console.warn('[notify]', msg); return; }
    txt.textContent = msg;
    el.style.background = isError === false ? '#27ae60' : '#c0392b';
    el.style.display = 'flex';
    clearTimeout(_notifTimer);
    /* Auto-fechar após 6 s para erros, 3 s para sucesso */
    _notifTimer = setTimeout(function() { el.style.display = 'none'; }, isError === false ? 3000 : 6000);
}
