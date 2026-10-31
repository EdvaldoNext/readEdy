/* ═══════════════════════════════════════════════════════════════
   ReadEdy · core/state
   Estado global compartilhado e referências de DOM usadas por vários módulos.
   (script clássico: compartilha o escopo global com os demais módulos;
    a ordem de carregamento está em index.html)
   ══════════════════════════════════════════════════════════════ */

var pdfjsLib = window['pdfjs-dist/build/pdf'];

var pdfDoc = null, pageNum = 1, isRendering = false, isReading = false;

var currentUtterance = null;

var fullPageText = '';

var speakLock = false;

var ttsStopRequested = false;

/* ── Motor TTS ──────────────────────────────────────────────── */
var ttsEngine   = null; /* 'proxy' | 'webspeech' | null */

var ttsProxyUrl = null; /* URL do Edge Function */

var ttsAudioEl  = null; /* <audio> reutilizável (engine proxy) */

/* ttsAudioCache: guarda a URL de streaming já configurada no elemento */
var ttsAudioCache = { pageNum: null, url: null, ready: false, error: false, key: null };

var ttsPrefetchAudioEl = null;

var ttsFetchInflight = null;

var TTS_PREFETCH_PROGRESS = 0.45;

var _audioUnlocked  = false; /* true após unlock por gesto do utilizador */

var _wsSynth = typeof window.speechSynthesis !== 'undefined' ? window.speechSynthesis : null;

var readeraSb = null;

var pdfCacheBytes = null;

var cloudDocumentId = null;

var lastOpenedFileName = '';

var currentBookTitle = '';

var currentPageNum = 1;

var progressSaveTimer = null;

var cloudUiBound = false;

var cloudSyncInFlight = false;

var suppressAutoCloud = false;

var cloudLibraryCount = 0;

var cloudLibraryPanelOpen = false;

var cloudLibrarySuppressClose = false;

var cloudLibraryRows = [];

var _coverMem = {};

var _coverQueue = [];

var _coverInflight = 0;

var COVER_MAX_INFLIGHT = 2;

var LS_COVER_PREFIX = 'readera-cover-v1:';

var homeFeaturedDocId = null;

var homeFeaturedIsOpen = false;

var homeActiveTab = 'inicio';

var accessLockReady = false;

var accessLockForcedConta = false;

var homeSearchQuery = '';

var libraryViewMode = 'all';

var LS_TRASH = 'readera-trash-v1';

var LIBRARY_RECENT_DAYS = 30;

var statsSelectedBookId = null;

var LS_FAVORITES = 'readera-favorites-v1';

var LS_NOTES = 'readera-notes-v1';

var _noteEditId = null;

var LS_STATS_TTS_SECONDS = 'readera-stats-tts-seconds';

var LS_REPEAT_PAGE = 'readera-repeat-page';

var ttsRepeatPage = false;

var LS_STATS_TTS_BOOK_PREFIX = 'readera-stats-tts-book:';

var _statsTtsTickAt = null;

var _statsTtsBookId = null;

/* homeView: com um PDF carregado, indica se o shell mostra a Home
   (Continue ouvindo / Biblioteca / Conta) em vez da área de leitura. */
var homeView = false;

var LS_AUTO_CLOUD = 'readera-auto-cloud';

var LS_TTS_ENGINE = 'readera-tts-engine';

var DEFAULT_TTS_ENGINE = 'proxy';

var LS_RESUME_CLOUD = 'readera-resume-cloud';

var LS_LAST_CLOUD_DOC = 'readera_last_cloud_doc_id';

var LS_PDF_ZOOM = 'readera-pdf-zoom';

var PDF_ZOOM_MIN = 1.0;

var PDF_ZOOM_MAX = 2.5;

var PDF_ZOOM_STEP = 0.2;

var pdfZoom = (function() {
    var v = parseFloat(safeStorage.getItem(LS_PDF_ZOOM));
    return (isNaN(v) || v < PDF_ZOOM_MIN || v > PDF_ZOOM_MAX) ? 1.0 : v;
}());

var ttsCharRanges = [];

var ttsPageCache = { pageNum: null, text: '', ranges: [] };

var ocrPageCache = {}; /* { pageNum: text } — cache OCR por página */

var _tesseractWorker = null;

var _tesseractLoading = false;

var _tesseractReady  = false;

var _tesseractCallbacks = [];

var ttsWatchdogTimer = null;

var pdfTextLayerSpans = null;

var ttsResumeCharOffset = 0;

var ttsResumePageNum = null;

var ttsLastFullTextLen = 0;

var ttsAbsCharEnd = 0;

var ttsScrollHighlightRaf = null;

var ttsProxyResumeFrac = 0;

var ttsProxyCharOffset = 0; /* chars do texto completo antes do início do áudio atual */

var TTS_SKIP_SECONDS = 15;

var TTS_HIGHLIGHT_MS = 110;

var ttsPdfHighlightLast = { start: -1, end: -1 };

var ttsNextPageCache = { pageNum: null, text: '', ranges: [] };

var ttsPendingRenderPage = null;

var ttsContinuousAdvanceLock = false;

var ttsProxyEndHandled = false;

var ttsProxyEndFallbackTimer = null;

var ttsProxyWatchInterval = null;

var ttsProxyWatchCapturedPage = null;

var ttsProxyRecoverAttempts = 0;

var TTS_PROXY_STALL_MS = 9000;

var TTS_PROXY_MAX_RECOVER = 5;

var cloudLoadGen = 0;

var renderGen = 0;

var pdfLoadingTask = null;

var _pendingPageJump = null; /* salto enfileirado enquanto renderização está em curso */

var _renderingWatchdog = null; /* timer de segurança para resetar isRendering em TVs lentas */

var _pageJumpDraft = ''; /* rascunho do número — teclado virtual da TV nem sempre grava em .value */

var _pageJumpInputFocused = false;

var fileInput = document.getElementById('file-input');

var loading = document.getElementById('loading');

/* ── Barra de progresso (status bar) ───────────────────── */
var _rdrSbRaf = null;

var _rdrSbHideTimer = null;

var _rdrSbTickStart = 0;

var voiceSelect = document.getElementById('voice-select');

var rateRange = document.getElementById('rate-range');

var rateLabel = document.getElementById('rate-label');

var MINI_ICON_PLAY  = '<svg class="ico ico-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

var MINI_ICON_PAUSE = '<svg class="ico ico-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';

var ICON_SUN  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';

var ICON_MOON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
