/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/wire
   Ligação dos eventos da Home (wireHomeUi) e ações do livro em destaque.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

function wireHomeUi() {
    if (window._homeUiBound) return;
    window._homeUiBound = true;
    wireMobileNav();
    syncSearchPlaceholder();
    window.addEventListener('resize', syncSearchPlaceholder);
    var fileInput = document.getElementById('file-input');
    function openLocalPdf() {
        if (!requirePaidAccess()) return;
        if (fileInput) fileInput.click();
    }
    var openBtns = ['home-btn-open-pdf', 'home-btn-open-pdf-account'];
    openBtns.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', openLocalPdf);
    });
    var cloudBtn = document.getElementById('home-btn-cloud');
    if (cloudBtn) cloudBtn.addEventListener('click', function() { openHomeView('biblioteca'); });
    var verTodos = document.getElementById('home-btn-ver-todos');
    if (verTodos) verTodos.addEventListener('click', function() { openHomeView('biblioteca'); });
    /* ▶ só toca — nunca navega para o leitor */
    var continuePlay = document.getElementById('home-continue-play');
    if (continuePlay) continuePlay.addEventListener('click', playFeaturedAudio);
    var continuePlayDesktop = document.getElementById('home-continue-play-desktop');
    if (continuePlayDesktop) continuePlayDesktop.addEventListener('click', playFeaturedAudio);
    var miniTts = document.getElementById('home-mini-tts');
    if (miniTts) miniTts.addEventListener('click', playFeaturedAudio);
    /* Ver as páginas do PDF é uma acção explícita */
    var viewBtn = document.getElementById('home-btn-view-book');
    if (viewBtn) viewBtn.addEventListener('click', viewFeaturedDocument);
    var viewBtnMobile = document.getElementById('home-btn-view-book-mobile');
    if (viewBtnMobile) viewBtnMobile.addEventListener('click', viewFeaturedDocument);
    var miniInfo = document.getElementById('home-mini-info');
    var miniThumb = document.getElementById('home-mini-thumb');
    if (miniInfo) miniInfo.addEventListener('click', viewFeaturedDocument);
    if (miniThumb) miniThumb.addEventListener('click', viewFeaturedDocument);
    var navItems = document.querySelectorAll('.home-nav-item');
    for (var i = 0; i < navItems.length; i++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                var tab = btn.getAttribute('data-home-nav');
                if (tab !== 'conta' && !requirePaidAccess()) return;
                openHomeView(tab, true);
            });
        })(navItems[i]);
    }
    var sidebarSubs = document.querySelectorAll('.sidebar-sub-item[data-library-view]');
    for (var s = 0; s < sidebarSubs.length; s++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                if (!requirePaidAccess()) return;
                setLibraryView(btn.getAttribute('data-library-view'));
            });
        })(sidebarSubs[s]);
    }
    var sidebarTrash = document.querySelectorAll('.sidebar-sub-item[data-home-nav="lixeira"]');
    for (var t = 0; t < sidebarTrash.length; t++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                if (!requirePaidAccess()) return;
                openHomeView('lixeira');
            });
        })(sidebarTrash[t]);
    }
    var sidebarActions = document.querySelectorAll('[data-sidebar-action]');
    for (var a = 0; a < sidebarActions.length; a++) {
        (function(btn) {
            btn.addEventListener('click', function() {
                var action = btn.getAttribute('data-sidebar-action');
                if (action === 'estatisticas') openHomeView('estatisticas');
                else if (typeof showTtsToast === 'function') showTtsToast('Em breve');
            });
        })(sidebarActions[a]);
    }
    var statsBtn = document.getElementById('home-btn-stats');
    if (statsBtn) statsBtn.addEventListener('click', function() { openHomeView('estatisticas'); });
    var statsBack = document.getElementById('stats-book-back');
    if (statsBack) statsBack.addEventListener('click', function() { selectBookStats(null); });
    var noteFloat = document.getElementById('btn-note-float');
    if (noteFloat) noteFloat.addEventListener('click', function() { openNoteModal(); });
    var noteCancel = document.getElementById('note-modal-cancel');
    if (noteCancel) noteCancel.addEventListener('click', closeNoteModal);
    var noteSave = document.getElementById('note-modal-save');
    if (noteSave) noteSave.addEventListener('click', saveNoteFromModal);
    var noteModal = document.getElementById('note-modal');
    if (noteModal) noteModal.addEventListener('click', function(e) {
        if (e.target === noteModal) closeNoteModal();
    });
    var topbarAdd = document.getElementById('topbar-add-pdf');
    if (topbarAdd) topbarAdd.addEventListener('click', openLocalPdf);
    var searchInput = document.getElementById('home-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() { filterHomeBooks(searchInput.value); });
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                searchInput.value = '';
                filterHomeBooks('');
                searchInput.blur();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                var q = normalizeSearchText(searchInput.value);
                if (!q) return;
                var matches = filterRowsBySearch(cloudLibraryRows);
                if (matches.length) openHomeView('biblioteca');
            }
        });
    }
    var carousel = document.getElementById('home-books-carousel');
    var prevBtn = document.getElementById('home-books-prev');
    var nextBtn = document.getElementById('home-books-next');
    if (carousel && prevBtn) prevBtn.addEventListener('click', function() { carousel.scrollBy({ left: -300, behavior: 'smooth' }); });
    if (carousel && nextBtn) nextBtn.addEventListener('click', function() { carousel.scrollBy({ left: 300, behavior: 'smooth' }); });
    var playerPrev = document.getElementById('player-prev');
    var playerNext = document.getElementById('player-next');
    var playerMenu = document.getElementById('player-menu');
    var playerRepeat = document.getElementById('player-repeat');
    if (playerPrev) playerPrev.addEventListener('click', function() { if (pdfDoc) changePage(-1); });
    if (playerNext) playerNext.addEventListener('click', function() { if (pdfDoc) changePage(1); });
    if (playerRepeat) playerRepeat.addEventListener('click', toggleRepeatPage);
    updatePlayerRepeatButton();
    if (playerMenu) playerMenu.addEventListener('click', function() {
        if (typeof window._readEdyOpenSettings === 'function') window._readEdyOpenSettings();
    });
    var backBtn = document.getElementById('btn-reader-back');
    if (backBtn) backBtn.addEventListener('click', function() { openHomeView('inicio'); });
    var headerAccount = document.getElementById('home-header-account');
    if (headerAccount) headerAccount.addEventListener('click', function() { openHomeView('conta', true); });
    var settingsBtn = document.getElementById('home-btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', function() {
        if (typeof window._readEdyOpenSettings === 'function') window._readEdyOpenSettings();
    });
    wireThemeButtons();
    setHomeTab('inicio');
    renderHomeFromCloudLibrary([]);
    applyShellState();
}
