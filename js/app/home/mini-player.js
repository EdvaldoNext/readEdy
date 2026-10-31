/* ═══════════════════════════════════════════════════════════════
   ReadEdy · home/mini-player
   Mini player: ícones, repetir página e rótulo de velocidade.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

/* Play/pause em SVG nos três lugares: card da Home, mini-player e leitor */
function setPlayPauseIcon(el, playing) {
    if (!el) return;
    if (el.classList.contains('home-continue-play--fab')) {
        el.innerHTML = playing ? MINI_ICON_PAUSE : MINI_ICON_PLAY;
    } else if (el.classList.contains('home-continue-btn') || el.id === 'home-continue-play-desktop') {
        el.innerHTML = (playing ? MINI_ICON_PAUSE : MINI_ICON_PLAY) + ' ' + (playing ? 'Pausar' : 'Continuar');
    } else {
        el.innerHTML = playing ? MINI_ICON_PAUSE : MINI_ICON_PLAY;
    }
    el.title = playing ? 'Pausar' : 'Ouvir';
    el.setAttribute('aria-label', el.title);
}

function setMiniTtsIcon(playing) {
    setPlayPauseIcon(document.getElementById('home-mini-tts'), playing);
    setPlayPauseIcon(document.getElementById('home-continue-play'), playing);
    setPlayPauseIcon(document.getElementById('home-continue-play-desktop'), playing);
}

function updateMiniPlayerFromDoc(row) {
    var mini = document.getElementById('home-mini-player');
    if (!mini) return;
    if (!row || document.body.classList.contains('pdf-is-open')) {
        mini.classList.add('hidden');
        document.body.classList.remove('has-mini-player');
        return;
    }
    mini.classList.remove('hidden');
    document.body.classList.add('has-mini-player');
    var titleEl = document.getElementById('home-mini-title');
    var fillEl = document.getElementById('home-mini-progress-fill');
    var thumbEl = document.getElementById('home-mini-thumb');
    var title = row.title || row.id;
    if (titleEl) titleEl.textContent = title;
    if (fillEl) fillEl.style.width = docProgressPct(row) + '%';
    applyBookCoverEl(thumbEl, title, row.id ? getCachedCover(row.id) : null);
    if (row.id) hydrateBookCover(row, thumbEl);
    var pageEl = document.getElementById('home-mini-page');
    var lp = row.last_page || 1;
    if (pageEl) pageEl.textContent = row.num_pages ? ('Página ' + lp + ' de ' + row.num_pages) : ('Página ' + lp);
    setMiniTtsIcon(!!(row.isOpen && isReading));
}

function updatePlayerRepeatButton() {
    var btn = document.getElementById('player-repeat');
    if (!btn) return;
    btn.classList.toggle('is-active', !!ttsRepeatPage);
    btn.setAttribute('aria-pressed', ttsRepeatPage ? 'true' : 'false');
    var label = ttsRepeatPage ? 'Repetir página: ligado' : 'Repetir página';
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

function toggleRepeatPage() {
    ttsRepeatPage = !ttsRepeatPage;
    try { safeStorage.setItem(LS_REPEAT_PAGE, ttsRepeatPage ? '1' : '0'); } catch (e) {}
    updatePlayerRepeatButton();
    if (typeof showTtsToast === 'function') {
        showTtsToast(ttsRepeatPage ? 'Repetir página ativado' : 'Repetir página desativado');
    }
}

function updatePlayerSpeedLabel() { /* removido do mini-player */ }
