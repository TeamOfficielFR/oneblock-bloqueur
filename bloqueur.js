(function () {
  if (window.__lwab) return;
  window.__lwab = true;

  // journal de diagnostic du menu (si present) : on y note les decisions du bloqueur
  function LOG(m) {
    try {
      if (window.__lwD) window.__lwD('bloqueur: ' + m, true);
      else { var q = (window.__lwQ = window.__lwQ || []); if (q.length < 60) q.push('bloqueur: ' + m); }
    } catch (e) {}
  }
  function call(m, a) {
    try {
      var b = window.LecteurWebApp;
      if (!b || typeof b[m] !== 'function') return undefined;
      return a === undefined ? b[m]() : b[m](a);
    } catch (e) { return undefined; }
  }
  try {
    LOG('demarrage ' + (window.ytcfg || window.yt ? 'APRES les scripts du site (trop tard)' : 'avant les scripts du site') +
      ' (scripts ' + document.scripts.length + ', ' + document.readyState + ', ' + location.pathname.slice(0, 14) + ')');
  } catch (e) {}
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
  var nPrune = 0, nFlag = 0, nRep = 0, nReq = 0, tFlag = 0, SRC = '', pubsId = {}, repT = {};
  var KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams'];
  var prune = function (o, d) {
    d = d || 0;
    if (!ACTIF || !o || typeof o !== 'object' || d > 4) return o;
    try {
      if (o.adPlacements || o.adSlots || o.playerAds) compterPubsRetirees(o);
      var gone = [];
      for (var i = 0; i < KEYS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(o, KEYS[i])) { delete o[KEYS[i]]; gone.push(KEYS[i]); }
      }
      var vid = o.videoDetails && o.videoDetails.videoId;
      if (vid && (gone.length || o.streamingData)) {
        // reponse du lecteur : on note si YouTube avait prevu une pub et si le drapeau "sans pub" etait parti avec la demande
        var now = Date.now(), cle = vid + (gone.length ? 'P' : 'S');
        if (gone.length) pubsId[vid] = now;
        var doublon = repT[cle] && now - repT[cle] < 5000 || (!gone.length && pubsId[vid] && now - pubsId[vid] < 5000);
        repT[cle] = now;
        if (!doublon && nRep++ < 60) {
          LOG('reponse lecteur ' + vid + (SRC ? ' [' + SRC + ']' : '') + ' : ' + (gone.length ? 'PUBS retirees (' + gone.join(',') + ')' : 'sans pub') +
            ', drapeau ' + (tFlag && now - tFlag < 25000 ? 'envoye il y a ' + ((now - tFlag) / 1000).toFixed(1) + ' s' : 'NON envoye'));
        }
      } else if (gone.length && nPrune++ < 60) LOG('reponse nettoyee : ' + gone.join(','));
      // fenetre "les bloqueurs de pub ne sont pas autorises" : elle met la video en pause
      var mr = o.auxiliaryUi && o.auxiliaryUi.messageRenderers;
      if (mr && mr.enforcementMessageViewModel) delete mr.enforcementMessageViewModel;
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
    if (ACTIF && o && typeof o === 'object' && !d && !(o.streamingData && o.videoDetails)) {
      retires = 0;
      try { nettoyer(o, 0); } catch (e) {}
      for (var r = 0; r < retires && r < 20; r++) bump();
    }
    return o;
  };
  var jp = JSON.parse;
  var wParse = function () { return prune(jp.apply(this, arguments)); };
  JSON.parse = wParse;
  var wJson = null;
  try {
    var rj = Response.prototype.json;
    wJson = function () { return rj.apply(this, arguments).then(function (r) { return prune(r); }); };
    Response.prototype.json = wJson;
  } catch (e) {}
  // Reponses recues par XMLHttpRequest en JSON (elles ne passent ni par JSON.parse ni par Response.json)
  try {
    var xr = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
    if (xr && xr.get) {
      Object.defineProperty(XMLHttpRequest.prototype, 'response', {
        configurable: true, enumerable: xr.enumerable,
        get: function () {
          var r = xr.get.call(this);
          if (r && typeof r === 'object' && this.responseType === 'json' && this.readyState === 4) { try { prune(r); } catch (e) {} }
          return r;
        }
      });
    }
  } catch (e) {}
  ['ytInitialPlayerResponse', 'playerResponse', 'ytInitialData'].forEach(function (n) {
    try {
      var v = typeof window[n] === 'object' ? prune(window[n]) : window[n];
      Object.defineProperty(window, n, { configurable: true, get: function () { return v; }, set: function (x) {
        SRC = 'chargement a froid'; try { v = (x && typeof x === 'object') ? prune(x) : x; } finally { SRC = ''; }
      } });
    } catch (e) {}
  });

  /* ---------- 1b. Evite l'attente factice du debut de video (methode d'uBlock Origin) ---------- */
  // Pour certains comptes avec bloqueur, YouTube retarde le premier flux video de la duree d'une pub (ecran noir).
  // On ajoute "isInlinePlaybackNoAd" dans la requete du lecteur : le serveur n'envoie alors ni pub ni attente.
  // Fonctionne quand on passe d'une video a l'autre dans la page (la requete est faite ici, pas par le serveur).
  // La requete peut etre fabriquee de plusieurs facons selon la version de YouTube : on regarde donc a 4 endroits
  // (JSON.stringify, Object.assign, fetch, XMLHttpRequest) ; le premier qui voit le corps le complete, les autres le laissent.
  var FLAG_RE = /contentPlaybackContext":\{(\}?)/;
  var PLAYER_RE = /\/youtubei\/v1\/player(\?|$)/;
  var oa = Object.assign;
  function idDe(c) { var m = /"videoId":"([\w-]{11})"/.exec(c); return m ? m[1] : null; }
  function ajouterDrapeau(c, via) {
    if (!ACTIF || typeof c !== 'string' || c.length > 60000 || c.indexOf('contentPlaybackContext') < 0 || c.indexOf('isInlinePlaybackNoAd') > -1) return c;
    var r = c.replace(FLAG_RE, function (m, fin) { return 'contentPlaybackContext":{"isInlinePlaybackNoAd":true' + (fin ? '}' : ','); });
    if (r !== c) { tFlag = Date.now(); if (nFlag++ < 60) LOG('drapeau ajoute (' + via + ') ' + (idDe(r) || '')); }
    return r;
  }
  // une ligne par demande du lecteur, avec l'etat final du drapeau
  function noterRequete(via, c) {
    if (nReq++ >= 60) return;
    var etat = typeof c !== 'string' ? 'corps ' + typeof c :
      c.indexOf('isInlinePlaybackNoAd') > -1 ? 'drapeau present' :
      c.indexOf('contentPlaybackContext') > -1 ? 'drapeau ABSENT' : 'pas de contentPlaybackContext';
    var cles = '';
    if (typeof c === 'string' && etat.indexOf('pas de') === 0) { try { cles = ' {' + Object.keys(jp.call(JSON, c)).join(',').slice(0, 60) + '}'; } catch (e) {} }
    LOG('requete lecteur (' + via + ') ' + ((typeof c === 'string' && idDe(c)) || '?') + ' : ' + etat + cles);
  }
  var wStringify = null, wAssign = null, wFetch = null, wSend = null;
  try {
    var js = JSON.stringify;
    wStringify = function () {
      var r = js.apply(this, arguments);
      if (typeof r === 'string' && r.length < 60000 && r.indexOf('contentPlaybackContext') > -1) r = ajouterDrapeau(r, 'JSON');
      return r;
    };
    JSON.stringify = wStringify;
  } catch (e) {}
  try {
    // YouTube fabrique parfois les options de la demande avec Object.assign(cible, base, {body: "..."})
    wAssign = function (t, a, b) {
      if (arguments.length === 3 && ACTIF && b && typeof b === 'object' && typeof b.body === 'string' && b.body.indexOf('contentPlaybackContext') > -1) {
        try {
          var nb = ajouterDrapeau(b.body, 'Object.assign');
          if (nb !== b.body) return oa.call(this, t, a, oa({}, b, { body: nb }));
        } catch (e) {}
      }
      return oa.apply(this, arguments);
    };
    Object.assign = wAssign;
  } catch (e) {}
  try {
    var of = window.fetch;
    if (typeof of === 'function') {
      wFetch = function (input, init) {
        try {
          var u = typeof input === 'string' ? input : (input && input.url) || String(input || '');
          if (PLAYER_RE.test(u)) {
            if (init && typeof init.body === 'string') {
              var nb = ajouterDrapeau(init.body, 'fetch');
              noterRequete('fetch', nb);
              if (nb !== init.body) return of.call(this, input, oa({}, init, { body: nb }));
            } else if (!init && input && typeof input === 'object' && typeof input.clone === 'function' && input.method === 'POST') {
              var me = this;
              return input.clone().text().then(function (txt) {
                var nb2 = ajouterDrapeau(txt, 'fetch/Request');
                noterRequete('fetch/Request', nb2);
                return nb2 === txt ? of.call(me, input) : of.call(me, new Request(input, { body: nb2 }));
              }, function () { return of.call(me, input); });
            } else noterRequete('fetch', init && init.body);
          }
        } catch (e) {}
        return of.apply(this, arguments);
      };
      window.fetch = wFetch;
    }
  } catch (e) {}
  try {
    var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { try { this.__lwP = PLAYER_RE.test(String(u)); } catch (e) {} return xo.apply(this, arguments); };
    wSend = function (b) {
      try {
        if (this.__lwP) {
          var nb = ajouterDrapeau(b, 'XHR');
          noterRequete('XHR', nb);
          if (nb !== b) return xs.call(this, nb);
        }
      } catch (e) {}
      return xs.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = wSend;
  } catch (e) {}
  // Auto-verification : le site ou un autre script a-t-il repris la main sur nos crochets ?
  function etatCrochets() {
    function ok(obj, nom, w) {
      if (!w) return nom + ' absent';
      var d = null; try { d = Object.getOwnPropertyDescriptor(obj, nom); } catch (e) {}
      return nom + (obj[nom] === w ? ' ok' : ' REMPLACE') + (d && d.writable === false ? ' (verrouille)' : '');
    }
    return [ok(JSON, 'stringify', wStringify), ok(JSON, 'parse', wParse), ok(Object, 'assign', wAssign), ok(window, 'fetch', wFetch),
      ok(Response.prototype, 'json', wJson), ok(XMLHttpRequest.prototype, 'send', wSend)].join(', ');
  }
  var etat0 = etatCrochets();
  LOG('crochets : ' + etat0);
  [3000, 12000].forEach(function (ms) {
    setTimeout(function () { try { var e2 = etatCrochets(); LOG('crochets a ' + (ms / 1000) + ' s : ' + (e2 === etat0 ? 'inchanges' : e2)); } catch (e) {} }, ms);
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
  var muted = false, mutedEl = null, seen = false, shortsPasses = new WeakSet();
  // Le son coupe pendant une pub est toujours remis sur le meme element (et jamais laisse coupe)
  function rendreSon(v) {
    try { if (mutedEl) mutedEl.muted = false; } catch (e) {}
    try { if (v && muted) v.muted = false; } catch (e) {}
    mutedEl = null; muted = false;
  }
  // Ecran noir "fantome" : YouTube garde le lecteur en mode pub (duree d'une pub sur la barre) alors qu'il n'y a plus rien a jouer.
  // 1) apres 4 s : relance douce (le lecteur redemande la video, avec le drapeau "sans pub", sans recharger la page)
  // 2) si toujours bloque 5 s plus tard : on recharge la page, une seule fois par video (dernier recours)
  var fantId = null, fantDebut = 0, fantEtape = 0;
  function fantome(p, v, ad) {
    if (location.pathname.indexOf('/watch') !== 0 || !p || !v) { fantId = null; return; }
    var id = new URLSearchParams(location.search).get('v');
    if (id !== fantId) { fantId = id; fantDebut = 0; fantEtape = 0; }
    if (!ad || v.currentTime > 0.5 || (window.__lwAgr && Date.now() < window.__lwAgr) || window.__lwPip) { fantDebut = 0; fantEtape = 0; return; }
    if (!fantDebut) { fantDebut = Date.now(); fantEtape = 0; LOG('mode pub sans lecture, attente'); return; }
    var d = Date.now() - fantDebut;
    if (d < 4000) return;
    if (!fantEtape && typeof p.loadVideoById === 'function') {
      fantEtape = 1;
      LOG('bloque ' + (d / 1000).toFixed(1) + ' s -> relance douce');
      try {
        var t = parseInt(new URLSearchParams(location.search).get('t'), 10) || 0;
        p.loadVideoById(t > 0 ? { videoId: id, startSeconds: t } : id);
      } catch (e) {}
      return;
    }
    if (fantEtape && d < 9000) return;
    try {
      var cle = 'lw_fant', dej = sessionStorage.getItem(cle) || '';
      var m = /^(.*)\|(\d+)$/.exec(dej);
      if (m && m[1] === id && Date.now() - +m[2] < 120000) return; // deja recharge pour cette video
      sessionStorage.setItem(cle, id + '|' + Date.now());
    } catch (e) { return; }
    fantDebut = 0; fantEtape = 0;
    LOG('RECHARGEMENT de la page (toujours bloque apres ' + (d / 1000).toFixed(1) + ' s)');
    location.reload();
  }
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
    LOG('lecteur en attente, relance ' + blocEssais + '/4');
    try { v.currentTime = Math.max(0, v.currentTime) + 0.001; } catch (e) {}
    try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  }
  // Depart bloque alors que YouTube avait prevu une pub (attente factice) : on redemande la video une fois, avec le drapeau
  // "sans pub" (la requete passe par nos crochets) ; utile surtout quand la page a ete chargee avec la reponse deja integree.
  var rdId = null, rdDebut = 0, rdFait = {};
  function relanceDepart(p, v) {
    if (location.pathname.indexOf('/watch') !== 0 || !p || !v) { rdId = null; rdDebut = 0; return; }
    var id = new URLSearchParams(location.search).get('v');
    if (id !== rdId) { rdId = id; rdDebut = 0; }
    var cl = p.classList;
    var bloque = v.currentTime < 0.5 && !cl.contains('paused-mode') && !cl.contains('ad-showing') && !cl.contains('ad-interrupting') &&
      (cl.contains('buffering-mode') || cl.contains('unstarted-mode') || v.readyState < 3);
    if (!bloque || !id || !pubsId[id] || (rdFait[id] && Date.now() - rdFait[id] < 120000) ||
        (window.__lwAgr && Date.now() < window.__lwAgr) || window.__lwPip || window.__pauseUser || typeof p.loadVideoById !== 'function') { rdDebut = 0; return; }
    if (!rdDebut) { rdDebut = Date.now(); return; }
    var d = Date.now() - rdDebut;
    if (d < 3000) return;
    rdFait[id] = Date.now(); rdDebut = 0;
    var st = parseInt(new URLSearchParams(location.search).get('t'), 10) || 0;
    if (!st) { try { var pr = p.getPlayerResponse && p.getPlayerResponse(), c = pr && pr.playerConfig && pr.playerConfig.playbackStartConfig; if (c && c.startSeconds > 0) st = c.startSeconds; } catch (e) {} }
    LOG('depart bloque ' + (d / 1000).toFixed(1) + ' s apres pubs retirees -> relance (nouvelle demande)');
    try { p.loadVideoById(st > 0 ? { videoId: id, startSeconds: st } : id); } catch (e) {}
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
  var prochain = 400;
  function tour() {
    prochain = 400;
    style();
    var p = document.querySelector('.html5-video-player');
    var v = document.querySelector('.html5-main-video') || document.querySelector('video');
    if (!ACTIF) {
      if (muted || mutedEl) rendreSon(v);
      seen = false;
      return;
    }
    passerShortPub();
    debloquer(p, v);
    relanceDepart(p, v);
    var ad = !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
    fantome(p, v, ad);
    if (ad && v) {
      prochain = 150;
      if (!v.muted) { v.muted = true; mutedEl = v; muted = true; }
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) v.currentTime = v.duration;
      var sk = document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button');
      if (sk) sk.click();
      if (!seen) { seen = true; LOG('pub detectee, saut'); if (Date.now() - dernierComptage > 20000) bump(); }
    } else {
      seen = false;
      if (muted || mutedEl) rendreSon(v);
      // au demarrage d'une video on regarde plus souvent (pour reagir vite si le lecteur reste bloque)
      if (v && location.pathname.indexOf('/watch') === 0 && !(v.currentTime > 1)) prochain = 150;
    }
  }
  (function boucle() {
    try { tour(); } catch (e) {}
    setTimeout(boucle, prochain);
  })();
})();
