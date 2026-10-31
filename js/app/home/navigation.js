/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/navigation
   Navegação da Home/leitor, menu mobile e estado do shell.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* Aba destacada só quando a Home está à vista — durante a leitura
   nenhuma aba fica ativa (o utilizador está no livro). */
function updateHomeNavActive() {
    var onHome = !document.body.classList.contains('pdf-is-open');
    var navItems = document.querySelectorAll('.home-nav-item');
    for (var i = 0; i < navItems.length; i++) {
        var btn = navItems[i];
        var active = onHome && btn.getAttribute('data-home-nav') === homeActiveTab;
        if (active) {
            btn.classList.add('is-active');
            btn.setAttribute('aria-current', 'page');
        } else {
            btn.classList.remove('is-active');
            btn.removeAttribute('aria-current');
        }
    }
}

/* ══ Shell da aplicação ═══════════════════════════════════════
   Um único layout: cabeçalho + conteúdo + navegação persistente.
   showHome = sem PDF carregado, ou PDF carregado com a Home à vista. */
function applyShellState() {
    var showHome = homeView || !pdfDoc;
    var welcome = document.getElementById('welcome');
    var renderArea = document.getElementById('pdf-render-area');
    var navControls = document.getElementById('nav-controls');
    /* classList.toggle com 2º argumento não é fiável em WebKit antigo (TVs) */
    if (showHome) document.body.classList.remove('pdf-is-open');
    else document.body.classList.add('pdf-is-open');
    if (welcome) {
        if (showHome) welcome.classList.remove('hidden');
        else welcome.classList.add('hidden');
    }
    if (renderArea) renderArea.style.display = showHome ? 'none' : '';
    if (navControls) {
        if (showHome || !pdfDoc) navControls.classList.add('hidden');
        else navControls.classList.remove('hidden');
    }
    syncChromeHiddenState();
    refreshHomeHero();
    updateHomeNavActive();
    updateSidebarLibraryActive();
}

function openMobileNav() {
    if (window.innerWidth > 1023) return;
    document.body.classList.add('mobile-nav-open');
    var btn = document.getElementById('btn-mobile-menu');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    var backdrop = document.getElementById('mobile-nav-backdrop');
    if (backdrop) backdrop.setAttribute('aria-hidden', 'false');
}

function closeMobileNav() {
    document.body.classList.remove('mobile-nav-open');
    var btn = document.getElementById('btn-mobile-menu');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    var backdrop = document.getElementById('mobile-nav-backdrop');
    if (backdrop) backdrop.setAttribute('aria-hidden', 'true');
}

function syncSearchPlaceholder() {
    var input = document.getElementById('home-search');
    if (!input) return;
    input.placeholder = window.innerWidth <= 1023 ? 'Buscar...' : 'Buscar livros, autores, temas...';
}

function wireMobileNav() {
    var menuBtn = document.getElementById('btn-mobile-menu');
    var closeBtn = document.getElementById('btn-mobile-menu-close');
    var backdrop = document.getElementById('mobile-nav-backdrop');
    if (menuBtn) {
        menuBtn.addEventListener('click', function() {
            if (document.body.classList.contains('mobile-nav-open')) closeMobileNav();
            else openMobileNav();
        });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeMobileNav);
    if (backdrop) backdrop.addEventListener('click', closeMobileNav);
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && document.body.classList.contains('mobile-nav-open')) closeMobileNav();
    });
}

function openHomeView(tab, userInitiated) {
    tab = tab || homeActiveTab;
    if (userInitiated) accessLockForcedConta = false;
    if (tab !== 'conta' && !canUsePremiumFeatures()) {
        tab = 'conta';
        showNotification('Crie a conta e pague para usar o ReadEdy.', true);
    }
    closeMobileNav();
    homeView = true;
    applyShellState();
    setHomeTab(tab);
    var viewer = document.getElementById('viewer-container');
    if (viewer) viewer.scrollTop = 0;
}

function openReaderView() {
    if (!requirePaidAccess()) return;
    if (!pdfDoc) return;
    closeMobileNav();
    homeView = false;
    applyShellState();
    /* A área de render estava oculta: refazer o layout com a largura real */
    schedulePdfRelayout();
}

function setReaderTitle(title) {
    var el = document.getElementById('reader-book-title');
    if (el) el.textContent = title || 'Leitura';
}
