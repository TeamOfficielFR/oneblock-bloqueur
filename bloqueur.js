(function () {
  if (window.__lwab) return;
  window.__lwab = true;

  function call(m, a) {
    try {
      var b = window.LecteurWebApp;
      if (!b || typeof b[m] !== 'function') return undefined;
      return a === undefined ? b[m]() : b[m](a);
    } catch (e) { return undefined; }
  }
  // Le bloqueur peut etre coupe/active depuis le menu, a chaud (sans recharger la page)
  var ACTIF = call('bloqueurActif') !== false;
  setInterval(function () { ACTIF = call('bloqueurActif') !== false; }, 800);
  function bump() { call('compter'); }

  // Compte les vraies pubs video que YouTube avait decide de diffuser (et seulement celles-la).
  // Un simple emplacement de pub (sans video dedans) ne compte pas : YouTube en envoie presque toujours.
  var dejaVues = {}, dernierComptage = 0;
  function compterVideosPub(x, d, acc) {
    if (!x || typeof x !== 'object' || d > 14) return;
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) compterVideosPub(x[i], d + 1, acc); return; }
    for (var k in x) {
      var v = x[k];
      if (k === 'instreamVideoAdRenderer' && v && typeof v === 'object') {
        var cle = v.externalVideoId || v.adVideoId || (v.playerVars ? String(v.playerVars).slice(0, 80) : '') || JSON.stringify(v).slice(0, 120);
        acc.ids.push(cle);
      } else if (k === 'linearAdSequenceRenderer') {
        acc.seq++;
        compterVideosPub(v, d + 1, acc);
      } else if (v && typeof v === 'object') compterVideosPub(v, d + 1, acc);
    }
  }
  function compterPubsRetirees(o) {
    var acc = { ids: [], seq: 0 };
    ['adPlacements', 'adSlots', 'playerAds'].forEach(function (k) { if (o[k]) compterVideosPub(o[k], 0, acc); });
    var n = 0;
    acc.ids.forEach(function (id) { if (!dejaVues[id]) { dejaVues[id] = 1; n++; } });
    if (!acc.ids.length && acc.seq) {
      var cle = 'seq:' + ((o.videoDetails && o.videoDetails.videoId) || location.search) + ':' + acc.seq;
      if (!dejaVues[cle]) { dejaVues[cle] = 1; n = acc.seq; }
    }
    if (n) { dernierComptage = Date.now(); for (var i = 0; i < n && i < 10; i++) bump(); }
  }

  /* ---------- 1. Retire les pubs des donnees de YouTube ---------- */
  var KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams'];
  var prune = function (o, d) {
    d = d || 0;
    if (!ACTIF || !o || typeof o !== 'object' || d > 4) return o;
    try {
      if (o.adPlacements || o.adSlots || o.playerAds) compterPubsRetirees(o);
      for (var i = 0; i < KEYS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(o, KEYS[i])) delete o[KEYS[i]];
      }
      if (o.playerResponse) prune(o.playerResponse, d + 1);
      if (o.response) prune(o.response, d + 1);
      if (Array.isArray(o)) for (var j = 0; j < o.length && j < 10; j++) prune(o[j], d + 1);
    } catch (e) {}
    return o;
  };
  // Elements de liste publicitaires (accueil, recherche, Shorts) et jeux Playables
  var AD_R = {};
  ['adSlotRenderer', 'promotedSparklesWebRenderer', 'promotedSparklesTextSearchRenderer', 'promotedVideoRenderer',
   'compactPromotedVideoRenderer', 'displayAdRenderer', 'inFeedAdLayoutRenderer', 'statementBannerRenderer',
   'mealbarPromoRenderer', 'brandVideoShelfRenderer', 'brandVideoSingletonRenderer', 'searchPyvRenderer',
   'adBreakServiceRenderer', 'miniGameCardViewModel', 'playableGameCardViewModel', 'gameCardRenderer',
   'reelPlayerAdOverlayRenderer', 'shortsAdRenderer'].forEach(function (k) { AD_R[k] = 1; });
  function adItem(x, d) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || d > 4) return false;
    for (var k in x) { if (AD_R[k]) return true; }
    if (x.command && x.command.reelWatchEndpoint && x.command.reelWatchEndpoint.adClientParams) return true;
    var w = x.richItemRenderer || x.richSectionRenderer || x.itemSectionRenderer || x.reelItemRenderer || x.shortsLockupViewModel;
    if (w) {
      if (adItem(w, d + 1)) return true;
      if (w.content && adItem(w.content, d + 1)) return true;
      if (Array.isArray(w.contents) && w.contents.length && w.contents.every(function (c) { return adItem(c, d + 2); })) return true;
    }
    var sh = x.richShelfRenderer || (x.content && x.content.richShelfRenderer);
    if (sh && sh.title) { try { if (/playables/i.test(JSON.stringify(sh.title))) return true; } catch (e) {} }
    return false;
  }
  var retires = 0;
  function nettoyer(o, d) {
    if (!o || typeof o !== 'object' || d > 40) return;
    if (Array.isArray(o)) {
      for (var i = o.length - 1; i >= 0; i--) {
        if (adItem(o[i], 0)) { o.splice(i, 1); retires++; } else nettoyer(o[i], d + 1);
      }
      return;
    }
    for (var k in o) { var v = o[k]; if (v && typeof v === 'object') nettoyer(v, d + 1); }
  }
  var pruneBase = prune;
  prune = function (o, d) {
    o = pruneBase(o, d);
    if (ACTIF && o && typeof o === 'object' && !d) {
      retires = 0;
      try { nettoyer(o, 0); } catch (e) {}
      for (var r = 0; r < retires && r < 20; r++) bump();
    }
    return o;
  };
  var jp = JSON.parse;
  JSON.parse = function () { return prune(jp.apply(this, arguments)); };
  try {
    var rj = Response.prototype.json;
    Response.prototype.json = function () { return rj.apply(this, arguments).then(function (r) { return prune(r); }); };
  } catch (e) {}
  ['ytInitialPlayerResponse', 'playerResponse', 'ytInitialData'].forEach(function (n) {
    try {
      var v = typeof window[n] === 'object' ? prune(window[n]) : window[n];
      Object.defineProperty(window, n, { configurable: true, get: function () { return v; }, set: function (x) { v = (x && typeof x === 'object') ? prune(x) : x; } });
    } catch (e) {}
  });

  /* ---------- 2. Cache les emplacements publicitaires ---------- */
  var CSS_PUB = 'ytm-promoted-sparkles-web-renderer,ad-slot-renderer,ytm-companion-ad-renderer,ytm-promoted-video-renderer,' +
    'ytm-display-ad-renderer,ytm-statement-banner-renderer,ytm-mealbar-promo-renderer,.mealbar-promo-renderer,' +
    'ytm-paid-content-overlay-renderer,.ytp-ad-overlay-container,.ytp-ad-module .ytp-ad-overlay-slot,ytm-in-feed-ad-layout-renderer,' +
    'ytm-rich-item-renderer:has(ad-slot-renderer),ytm-rich-item-renderer:has(ytm-ad-slot-renderer),ytm-item-section-renderer:has(>ad-slot-renderer),' +
    'ytm-promoted-sparkles-text-search-renderer,ytm-search-pyv-renderer,ytm-reel-shelf-renderer:has(ad-slot-renderer),' +
    'ytm-mini-game-card-view-model,ytm-rich-section-renderer:has(ytm-mini-game-card-view-model),ytm-rich-item-renderer:has(ytm-mini-game-card-view-model),' +
    'ytm-rich-section-renderer:has(ytm-statement-banner-renderer){display:none!important}';
  function style() {
    var s = document.getElementById('lw-css-pub');
    if (!s) { s = document.createElement('style'); s.id = 'lw-css-pub'; (document.head || document.documentElement).appendChild(s); }
    var css = ACTIF ? CSS_PUB : '';
    if (s.textContent !== css) s.textContent = css;
  }
  style();

  /* ---------- 3. Secours : saute les pubs qui passeraient quand meme ---------- */
  var muted = false, seen = false, shortsPasses = new WeakSet();
  // Sans les pubs, le lecteur attend parfois une pub qui ne vient pas : on le relance comme si on touchait le curseur
  var blocVid = null, blocDebut = 0, blocEssais = 0;
  function debloquer(p, v) {
    if (location.pathname.indexOf('/watch') !== 0 || !v || !p) { blocVid = null; return; }
    var id = new URLSearchParams(location.search).get('v');
    if (id !== blocVid) { blocVid = id; blocDebut = Date.now(); blocEssais = 0; return; }
    if (v.currentTime > 0.6 || blocEssais >= 4) return;
    var attente = p.classList.contains('buffering-mode') || p.classList.contains('unstarted-mode') ||
      (!v.paused && v.readyState < 3);
    if (!attente || p.classList.contains('paused-mode')) return;
    if (Date.now() - blocDebut < 1500 + blocEssais * 1500) return;
    blocEssais++;
    try { v.currentTime = Math.max(0, v.currentTime) + 0.001; } catch (e) {}
    try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  }
  var BADGES = /^(sponsoris[eé]|sponsored|annonce|ad|publicit[eé])$/i;
  function shortPub(el) {
    if (el.querySelector('ad-slot-renderer,ytm-ad-slot-renderer,[class*="ad-badge"],ytm-promoted-sparkles-web-renderer')) return true;
    var sp = el.querySelectorAll('span,div.badge-shape-wiz__text,ytm-badge');
    for (var i = 0; i < sp.length && i < 200; i++) {
      var t = sp[i].textContent; if (t && t.length < 16 && BADGES.test(t.trim())) return true;
    }
    return false;
  }
  function passerShortPub() {
    if (location.pathname.indexOf('/shorts') !== 0) return;
    var reels = document.querySelectorAll('ytm-reel-video-renderer,.reel-video-in-sequence');
    var h = window.innerHeight;
    for (var i = 0; i < reels.length; i++) {
      var r = reels[i], b = r.getBoundingClientRect();
      if (Math.abs(b.top) < h / 2 && !shortsPasses.has(r) && shortPub(r)) {
        shortsPasses.add(r);
        var next = r.nextElementSibling;
        if (next) { try { next.scrollIntoView({ block: 'start' }); } catch (e) {} }
        bump();
        break;
      }
    }
  }
  setInterval(function () {
    style();
    var p = document.querySelector('.html5-video-player');
    var v = document.querySelector('video');
    if (!ACTIF) {
      if (muted && v) { v.muted = false; muted = false; }
      seen = false;
      return;
    }
    passerShortPub();
    debloquer(p, v);
    var ad = p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
    if (ad && v) {
      if (!v.muted) { v.muted = true; muted = true; }
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) v.currentTime = v.duration;
      var sk = document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button');
      if (sk) sk.click();
      if (!seen) { seen = true; if (Date.now() - dernierComptage > 20000) bump(); }
    } else {
      seen = false;
      if (muted && v) { v.muted = false; muted = false; }
    }
  }, 400);
})();
