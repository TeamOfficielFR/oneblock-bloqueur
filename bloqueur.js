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
  var ATT = {};                      // videos pour lesquelles YouTube avait prevu une pub au debut (ecran d'attente)
  // 1.14 (essai, facon IgeBlock) : la pub du DEBUT n'est plus retiree de la reponse ; on la laisse au lecteur et on la passe
  // aussitot (son coupe, cachee sous l'ecran d'attente, avancee jusqu'a la fin). Si le serveur la voit "jouee", il ne retient
  // plus la video. Les pubs plus tard dans la video sont toujours retirees. Si la pub reste bloquee, on revient au retrait.
  var PASSER = true, passerEchec = {}, nEchecPasser = 0, GARDE = {};
  try { if (window.__lwPasser === false) PASSER = false; } catch (e) {}
  // 1.16 : MODE IGEBLOCK. On ne touche plus du tout aux donnees de YouTube (aucune fonction de la page remplacee,
  // pas de drapeau, pubs laissees dans les reponses). Les pubs video sont seulement cachees, coupees et sautees quand elles
  // passent, les pubs des listes cachees par le style. C'est ce que fait IgeBlock. Pas d'ecran d'attente.
  var IGE = true, ECRAN = false;
  try { if (window.__lwIge === false) { IGE = false; ECRAN = true; } } catch (e) {}
  var jsO = JSON.stringify;
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
  var nPrune = 0, nFlag = 0, nRep = 0, nReq = 0, tFlag = 0, SRC = '', repVues = (typeof WeakSet === 'function' ? new WeakSet() : null);
  var KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams'];
  var prune = function (o, d) {
    d = d || 0;
    if (!ACTIF || !o || typeof o !== 'object' || d > 4) return o;
    try {
      if (o.adPlacements || o.adSlots || o.playerAds) { compterPubsRetirees(o); try { noterAttente(o); } catch (e) {} }
      var garde = false; try { garde = garderDebut(o); } catch (e) { garde = false; }
      var gone = [];
      if (!garde) for (var i = 0; i < KEYS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(o, KEYS[i])) { delete o[KEYS[i]]; gone.push(KEYS[i]); }
      }
      var vid = o.videoDetails && o.videoDetails.videoId;
      if (vid && (gone.length || o.streamingData)) {
        // reponse du lecteur : on note si YouTube avait prevu une pub et si le drapeau "sans pub" etait parti avec la demande
        // (un objet deja traite n'est pas note deux fois ; deux reponses successives pour la meme video le sont toutes les deux)
        var now = Date.now(), deja = repVues ? repVues.has(o) : false;
        if (repVues) repVues.add(o);
        if (!deja) { var en = entree(vid); en.tp = now; if (gone.length || garde) en.a = 1; if (garde) en.p = 1; }
        if (!deja && nRep++ < 60) {
          LOG('reponse lecteur ' + vid + (SRC ? ' [' + SRC + ']' : '') + ' : ' + (garde ? 'pub de DEBUT gardee pour etre passee (' + garde + ')' :
            gone.length ? 'PUBS retirees (' + gone.join(',') + ')' : 'sans pub') +
            ', drapeau ' + (tFlag && now - tFlag < 25000 ? 'envoye il y a ' + ((now - tFlag) / 1000).toFixed(1) + ' s' : 'NON envoye') +
            (o.videoDetails.isLive ? ', direct' : ''));
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
    for (var k in o) {
      if (o.videoDetails && (k === 'adPlacements' || k === 'adSlots' || k === 'playerAds')) continue;   // pub de debut gardee (1.14)
      var v = o[k]; if (v && typeof v === 'object') nettoyer(v, d + 1);
    }
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
  if (!IGE) JSON.parse = wParse;
  var wJson = null;
  try {
    var rj = Response.prototype.json;
    wJson = function () { return rj.apply(this, arguments).then(function (r) { return prune(r); }); };
    if (!IGE) Response.prototype.json = wJson;
  } catch (e) {}
  // Reponses recues par XMLHttpRequest en JSON (elles ne passent ni par JSON.parse ni par Response.json)
  try {
    var xr = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
    if (xr && xr.get && !IGE) {
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
  if (!IGE) ['ytInitialPlayerResponse', 'playerResponse', 'ytInitialData'].forEach(function (n) {
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
  var GROUPE_RE = /"playerRequest"\s*:\s*\{/;
  var PLAYER_RE = /\/youtubei\/v1\/player(\?|$)/;
  var oa = Object.assign;
  function client(c) { var m = /"clientName":"([A-Z_]+)"/.exec(c); return m ? m[1] : null; }
  function idDe(c) { var m = /"videoId":"([\w-]{11})"/.exec(c); return m ? m[1] : null; }
  // statistiques par video (demande -> reponse -> premiere lecture), gardees pour le journal du menu
  var ST = {}, STL = [];
  try { STL = jp.call(JSON, localStorage.getItem('lw_bqstat') || '[]'); if (!Array.isArray(STL)) STL = []; } catch (e) { STL = []; }
  function entree(id, neuf) {
    var e = ST[id];
    if (!e || (neuf && e.d !== null)) e = ST[id] = { v: id, a: 0, s: 0, d: null, tq: 0, tp: 0 };
    return e;
  }
  function aDesPubs(x) {
    return !!(x && ((x.adPlacements && x.adPlacements.length) || (x.adSlots && x.adSlots.length) || (x.playerAds && x.playerAds.length)));
  }
  var combine = null;   // derniere demande groupee (lecteur + suite) fabriquee par la page : {t, corps}
  function ajouterDrapeau(c, via) {
    if (!ACTIF || typeof c !== 'string' || c.length > 60000) return c;
    var groupe = GROUPE_RE.test(c);
    if (!groupe && (c.indexOf('contentPlaybackContext') < 0 || c.indexOf('isInlinePlaybackNoAd') > -1)) return c;
    var r = null, ou = '';
    if (groupe) {
      // version mobile : une seule demande pour le lecteur ET la suite ; le drapeau doit etre dans la partie "playerRequest"
      try {
        var o = jp.call(JSON, c), pr = o && o.playerRequest;
        if (pr && typeof pr === 'object') {
          var pc = (pr.playbackContext && typeof pr.playbackContext === 'object') ? pr.playbackContext : (pr.playbackContext = {});
          var cc = (pc.contentPlaybackContext && typeof pc.contentPlaybackContext === 'object') ? pc.contentPlaybackContext : (pc.contentPlaybackContext = {});
          if (cc.isInlinePlaybackNoAd === true) r = c; else { cc.isInlinePlaybackNoAd = true; r = js.call(JSON, o); }
          ou = 'playerRequest';
          combine = { t: Date.now(), corps: r };
        }
      } catch (e) { r = null; }
    }
    if (r === null) {
      r = c.replace(FLAG_RE, function (m, fin) { return 'contentPlaybackContext":{"isInlinePlaybackNoAd":true' + (fin ? '}' : ','); });
      ou = 'texte';
    }
    var id = idDe(r);
    if (id) { var en = entree(id, true); if (!en.tq || Date.now() - en.tq > 20000) en.tq = Date.now(); }
    if (r !== c) {
      tFlag = Date.now();
      if (nFlag++ < 60) {
        var cles = ''; try { cles = ' {' + Object.keys(jp.call(JSON, r)).join(',').slice(0, 70) + '}'; } catch (e) {}
        LOG('drapeau ajoute (' + via + ', ' + ou + ') ' + (id || '') + ' ' + (client(r) || '') + cles);
      }
    }
    return r;
  }
  // une ligne par demande du lecteur, avec l'etat final du drapeau
  function noterRequete(via, c, info) {
    if (nReq++ >= 60) return;
    var etat = typeof c !== 'string' ? 'corps ' + (c === undefined || c === null ? 'vide' : (c.constructor && c.constructor.name) || typeof c) :
      c.indexOf('isInlinePlaybackNoAd') > -1 ? 'drapeau present' :
      c.indexOf('contentPlaybackContext') > -1 ? 'drapeau ABSENT' : 'pas de contentPlaybackContext (' + c.length + ' car.)';
    var cles = '';
    if (typeof c === 'string' && etat.indexOf('pas de') === 0) { try { cles = ' {' + Object.keys(jp.call(JSON, c)).join(',').slice(0, 60) + '}'; } catch (e) {} }
    LOG('requete lecteur (' + via + ') ' + ((typeof c === 'string' && idDe(c)) || '?') + ' ' + ((typeof c === 'string' && client(c)) || '') + ' : ' + etat + cles + (info ? ' ' + info : ''));
  }
  // corps binaire (compresse ou non) : on le lit, on ajoute le drapeau, on le recompresse de la meme facon
  function enTexte(buf) {
    var u = new Uint8Array(buf);
    if (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b && typeof DecompressionStream === 'function') {
      return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(function (t) { return { txt: t, gz: true, n: u.length }; });
    }
    return Promise.resolve({ txt: new TextDecoder().decode(u), gz: false, n: u.length });
  }
  function enOctets(txt, gz) {
    if (gz && typeof CompressionStream === 'function') return new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return Promise.resolve(new Blob([txt]));
  }
  // prepare : promesse de la demande a envoyer (null = on envoie l'originale)
  function preparerBinaire(octetsP, via, refaire) {
    return octetsP.then(enTexte).then(function (r) {
      var nb = ajouterDrapeau(r.txt, via + (r.gz ? ' gzip' : ''));
      noterRequete(via, nb, (r.gz ? 'gzip ' : 'brut ') + r.n + ' o');
      if (nb === r.txt) return null;
      return enOctets(nb, r.gz).then(refaire);
    }).catch(function (e) { LOG('corps de la demande illisible (' + via + ') : ' + String(e && e.message || e).slice(0, 40)); return null; });
  }
  var YT_RE = /\/youtubei\/v1\/(?!log_event|att\b|feedback|pacing|counters)[\w]+/;
  var nEssai = 0, rjOrig = (typeof rj === 'function' ? rj : Response.prototype.json);
  // Si la reponse groupee contient quand meme des pubs (le drapeau n'a pas suffi), on redemande le lecteur seul, avec le drapeau :
  // si cette 2e reponse est sans pub, c'est elle qu'on donne a la page (plus d'attente factice). Sinon : reponse d'origine.
  function remplacer(resp, u, input, init, cb) {
    var ct = resp && resp.headers && resp.headers.get && resp.headers.get('content-type') || '';
    if (!resp || !resp.ok || ct.indexOf('json') < 0) return Promise.resolve(resp);
    var t0 = Date.now();
    return resp.clone().text().then(function (txt) {
      if (!/"(adPlacements|adSlots|playerAds)":\s*\[\s*\{/.test(txt)) return resp;     // pas de pub : on ne touche a rien
      var oc = jp.call(JSON, txt), pr = oc && oc.playerResponse, vid = pr && pr.videoDetails && pr.videoDetails.videoId;
      if (!vid || !aDesPubs(pr) || idDe(cb.corps) !== vid) return resp;
      combine = null;
      entree(vid).a = 1;
      if (nEssai++ >= 40) return resp;
      var o = jp.call(JSON, cb.corps), b = oa({}, o.playerRequest); b.context = o.context;
      var url2 = u.replace(/\/youtubei\/v1\/\w+/, '/youtubei/v1/player');
      var h = new Headers((init && init.headers) || (input && input.headers) || {});
      h.delete('content-encoding'); h.delete('content-length');
      if (!h.has('content-type')) h.set('content-type', 'application/json');
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, 2500);
      return of.call(window, url2, { method: 'POST', headers: h, body: js.call(JSON, b), credentials: 'include', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r2) { if (!r2.ok) throw new Error('http ' + r2.status); return rjOrig.call(r2); })
        .then(function (os) {
          clearTimeout(timer);
          var ms = Date.now() - t0;
          if (os && os.streamingData && os.playabilityStatus && os.playabilityStatus.status === 'OK' &&
              os.videoDetails && os.videoDetails.videoId === vid && !aDesPubs(os)) {
            oc.playerResponse = os; entree(vid).s = 1;
            var hd = new Headers(resp.headers); hd.delete('content-encoding'); hd.delete('content-length');
            LOG('essai ' + vid + ' : lecteur seul SANS pub -> reponse remplacee (' + ms + ' ms)');
            return new Response(js.call(JSON, oc), { status: resp.status, statusText: resp.statusText, headers: hd });
          }
          LOG('essai ' + vid + ' : lecteur seul ' + (aDesPubs(os) ? 'avec pubs aussi' : 'inutilisable') + ' (' + ms + ' ms) -> reponse d\'origine');
          return resp;
        }, function (e) {
          clearTimeout(timer);
          LOG('essai ' + vid + ' : echec (' + String(e && e.message || e).slice(0, 30) + ', ' + (Date.now() - t0) + ' ms) -> reponse d\'origine');
          return resp;
        });
    });
  }
  var wStringify = null, wAssign = null, wFetch = null, wSend = null;
  try {
    var js = JSON.stringify;
    wStringify = function () {
      var r = js.apply(this, arguments);
      if (typeof r === 'string' && r.length < 60000 && (r.indexOf('contentPlaybackContext') > -1 || GROUPE_RE.test(r))) r = ajouterDrapeau(r, 'JSON');
      return r;
    };
    if (!IGE) JSON.stringify = wStringify;
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
    if (!IGE) Object.assign = wAssign;
  } catch (e) {}
  try {
    var of = window.fetch;
    if (typeof of === 'function') {
      // envoi d'origine (avec ajout du drapeau dans les corps du lecteur)
      var fetchBase = function (me, args, input, init, u) {
        try {
          if (ACTIF && PLAYER_RE.test(u)) {
            var b0 = init && init.body;
            if (init && typeof b0 === 'string') {
              var nb = ajouterDrapeau(b0, 'fetch');
              noterRequete('fetch', nb);
              if (nb !== b0) return of.call(me, input, oa({}, init, { body: nb }));
            } else if (init && b0 && (b0 instanceof Blob || b0 instanceof ArrayBuffer || ArrayBuffer.isView(b0))) {
              return preparerBinaire(new Response(b0).arrayBuffer(), 'fetch/binaire', function (blob) { return oa({}, init, { body: blob }); })
                .then(function (ni) { return ni ? of.call(me, input, ni) : of.call(me, input, init); });
            } else if (!init && input && typeof input === 'object' && typeof input.clone === 'function' && input.method === 'POST') {
              return preparerBinaire(input.clone().arrayBuffer(), 'fetch/Request', function (blob) { return new Request(input, { body: blob }); })
                .then(function (nr) { return of.call(me, nr || input); });
            } else noterRequete('fetch', b0);
          }
          else if (ACTIF && init && typeof init.body === 'string' && GROUPE_RE.test(init.body) && YT_RE.test(u)) {
            var nb2 = ajouterDrapeau(init.body, 'fetch');
            if (nb2 !== init.body) return of.call(me, input, oa({}, init, { body: nb2 }));
          }
        } catch (e) {}
        return of.apply(me, args);
      };
      wFetch = function (input, init) {
        var u = '';
        try { u = typeof input === 'string' ? input : (input && input.url) || String(input || ''); } catch (e) {}
        var pr = fetchBase(this, arguments, input, init, u);
        var cb = null;
        try { if (ACTIF && !PASSER && combine && Date.now() - combine.t < 700 && YT_RE.test(u) && !PLAYER_RE.test(u)) cb = combine; } catch (e) {}
        if (!cb) return pr;
        return pr.then(function (resp) {
          return remplacer(resp, u, input, init, cb).then(null, function (e) { LOG('essai : echec (' + String(e && e.message || e).slice(0, 40) + ')'); return resp; });
        });
      };
      if (!IGE) window.fetch = wFetch;
    }
  } catch (e) {}
  try {
    var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
    if (!IGE) XMLHttpRequest.prototype.open = function (m, u) { try { this.__lwP = PLAYER_RE.test(String(u)); } catch (e) {} return xo.apply(this, arguments); };
    wSend = function (b) {
      try {
        if (this.__lwP && ACTIF) {
          var nb = ajouterDrapeau(b, 'XHR');
          noterRequete('XHR', nb);
          if (nb !== b) return xs.call(this, nb);
        }
      } catch (e) {}
      return xs.apply(this, arguments);
    };
    if (!IGE) XMLHttpRequest.prototype.send = wSend;
  } catch (e) {}
  try {
    document.addEventListener('playing', function (e) {
      try {
        var v = e.target; if (!v || v.tagName !== 'VIDEO' || v.currentTime > 3) return;
        var id = new URLSearchParams(location.search).get('v'), en = id && ST[id];
        if (!en || en.d !== null || !(en.tq || en.tp)) return;
        var t0 = en.tq || en.tp; if (Date.now() - t0 > 60000) return;
        en.d = (Date.now() - t0) / 1000;
        STL.push([id, en.a ? 1 : 0, en.s ? 1 : 0, +en.d.toFixed(1), en.p ? 1 : 0]); if (STL.length > 12) STL.shift();
        try { localStorage.setItem('lw_bqstat', js.call(JSON, STL)); } catch (x) {}
      } catch (x) {}
    }, true);
  } catch (e) {}
  // resume affiche par le journal : + = YouTube avait prevu une pub, - = sans pub, S = reponse remplacee ; nombre = secondes avant la lecture
  window.__lwStat = function () {
    var a = STL.slice(-7), r = [], pubs = 0;
    for (var i = 0; i < a.length; i++) { if (a[i][1]) pubs++; r.push((a[i][1] ? '+' : '-') + (a[i][2] ? 'S' : '') + (a[i][4] ? 'P' : '') + a[i][3]); }
    return a.length ? 'depart ' + a.length + ' videos, ' + pubs + ' avec pub : ' + r.join(' ') : '';
  };
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
  var etat0 = IGE ? '' : etatCrochets();
  LOG(IGE ? 'mode IgeBlock : donnees de YouTube non modifiees (aucun crochet, pas de drapeau), pubs sautees quand elles passent' : 'crochets : ' + etat0);
  if (!IGE) [3000, 12000].forEach(function (ms) {
    setTimeout(function () { try { var e2 = etatCrochets(); LOG('crochets a ' + (ms / 1000) + ' s : ' + (e2 === etat0 ? 'inchanges' : e2)); } catch (e) {} }, ms);
  });

  /* ---------- 2. Cache les emplacements publicitaires ---------- */
  var CSS_PUB = 'ytm-promoted-sparkles-web-renderer,ad-slot-renderer,ytm-companion-ad-renderer,ytm-promoted-video-renderer,' +
    'ytm-display-ad-renderer,ytm-statement-banner-renderer,ytm-mealbar-promo-renderer,.mealbar-promo-renderer,' +
    'ytm-paid-content-overlay-renderer,.ytp-ad-overlay-container,.ytp-ad-module .ytp-ad-overlay-slot,ytm-in-feed-ad-layout-renderer,' +
    'ytm-rich-item-renderer:has(ad-slot-renderer),ytm-rich-item-renderer:has(ytm-ad-slot-renderer),ytm-item-section-renderer:has(>ad-slot-renderer),' +
    'ytm-promoted-sparkles-text-search-renderer,ytm-search-pyv-renderer,ytm-reel-shelf-renderer:has(ad-slot-renderer),' +
    'ytm-mini-game-card-view-model,ytm-rich-section-renderer:has(ytm-mini-game-card-view-model),ytm-rich-item-renderer:has(ytm-mini-game-card-view-model),' +
    'ytm-rich-section-renderer:has(ytm-statement-banner-renderer){display:none!important}' +
    '.html5-video-player.ad-showing video,.html5-video-player.ad-showing .ytp-ad-player-overlay,.html5-video-player.ad-showing .ytp-ad-module,' +
    '.html5-video-player.ad-interrupting video{visibility:hidden!important}';
  function style() {
    var s = document.getElementById('lw-css-pub');
    if (!s) { s = document.createElement('style'); s.id = 'lw-css-pub'; (document.head || document.documentElement).appendChild(s); }
    var css = ACTIF ? CSS_PUB : '';
    if (s.textContent !== css) s.textContent = css;
  }
  style();

  /* ---------- 2b. Ecran d'attente ----------
     Quand YouTube avait prevu une pub au debut, son serveur retient la video pendant ~80 % de la duree de cette pub,
     meme si la pub n'est pas jouee. On ne peut pas l'empecher : on remplace l'ecran noir par l'image de la video,
     un rond de chargement, un message et un compte a rebours. */
  function nombre(x) { var n = typeof x === 'number' ? x : (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x) ? +x : NaN); return isFinite(n) ? n : NaN; }
  function dureeAnnonce(v) {
    var m = typeof v.playerVars === 'string' && /(?:^|&)length_seconds=(\d+(?:\.\d+)?)/.exec(v.playerVars);
    if (m) return +m[1];
    var best = 0;
    (function scan(o, d) {
      if (!o || typeof o !== 'object' || d > 6 || best) return;
      for (var k in o) {
        var val = o[k];
        if (/^(lengthSeconds|videoLengthSeconds|durationSeconds|adDurationSeconds)$/.test(k)) { var n = nombre(val); if (n > 0 && n < 900) { best = n; return; } }
        else if (/^(durationMs|durationMilliseconds|videoDurationMs|lengthMs|adDurationMs|videoLengthMs)$/.test(k)) { var n2 = nombre(val); if (n2 > 0 && n2 < 900000) { best = n2 / 1000; return; } }
        else if (val && typeof val === 'object' && k !== 'pings' && k !== 'trackingParams') scan(val, d + 1);
      }
    })(v, 0);
    return best;
  }
  function annonces(x, d, acc) {
    if (!x || typeof x !== 'object' || d > 18) return;
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) annonces(x[i], d + 1, acc); return; }
    for (var k in x) {
      var v = x[k];
      if (k === 'instreamVideoAdRenderer' && v && typeof v === 'object') {
        var cle = v.externalVideoId || v.adVideoId || v.layoutId || ('#' + acc.n);
        if (acc.vus[cle]) continue;
        acc.vus[cle] = 1; acc.n++;
        var sec = dureeAnnonce(v); if (sec > 0) acc.s += sec; else acc.inconnu++;
      } else if (v && typeof v === 'object') annonces(v, d + 1, acc);
    }
  }
  function estDebut(pl) {
    try {
      var c = pl && pl.adPlacementRenderer && pl.adPlacementRenderer.config && pl.adPlacementRenderer.config.adPlacementConfig;
      if (c && (c.kind === 'AD_PLACEMENT_KIND_START' || (c.adTimeOffset && String(c.adTimeOffset.offsetStartMilliseconds) === '0'))) return true;
      return /BEFORE_CONTENT|beforeContentVideoIdStartedTrigger|AD_PLACEMENT_KIND_START/.test(jsO.call(JSON, pl) || '');
    } catch (e) { return false; }
  }
  function noterAttente(o) {
    var id = o.videoDetails && o.videoDetails.videoId;
    if (!id || !ACTIF) return;
    var acc = { s: 0, n: 0, inconnu: 0, vus: {} }, debut = false;
    [o.adPlacements, o.adSlots].forEach(function (l) {
      if (!Array.isArray(l)) return;
      for (var i = 0; i < l.length; i++) if (estDebut(l[i])) { debut = true; annonces(l[i], 0, acc); }
    });
    var prev = ATT[id];
    if (prev && !prev.fini && Date.now() - prev.t < 3000) return;   // meme chargement, reponse vue deux fois
    var att = debut && acc.s > 0 && !acc.inconnu ? Math.round(acc.s * 8) / 10 : null;
    ATT[id] = { t: Date.now(), att: att, debut: debut, fini: false, vu: 0 };
    LOG(debut ? 'pub de debut prevue (' + acc.n + ' annonce' + (acc.n > 1 ? 's' : '') +
      (att ? ', ' + acc.s + ' s) -> attente ~' + att + ' s' : ', duree inconnue)') : 'pas de pub de debut (pubs plus tard seulement)');
  }
  // garde seulement la pub du debut (retire celles de plus tard) ; renvoie le resume, ou false si on retire tout comme avant
  function garderDebut(o) {
    var id = o.videoDetails && o.videoDetails.videoId;
    if (!PASSER || !id || passerEchec[id] || nEchecPasser >= 2) return false;
    var dp = Array.isArray(o.adPlacements) ? o.adPlacements.filter(estDebut) : [];
    var ds = Array.isArray(o.adSlots) ? o.adSlots.filter(estDebut) : [];
    if (!dp.length && !ds.length) return false;
    var nP = Array.isArray(o.adPlacements) ? o.adPlacements.length - dp.length : 0;
    var nS = Array.isArray(o.adSlots) ? o.adSlots.length - ds.length : 0;
    if (o.adPlacements) o.adPlacements = dp;
    if (o.adSlots) o.adSlots = ds;
    GARDE[id] = Date.now();
    return dp.length + ' emplacement(s), ' + ds.length + ' slot(s)' + (nP + nS ? ', ' + (nP + nS) + ' pub(s) plus tard retiree(s)' : '');
  }
  function echecPasser(id, pourquoi) {
    if (passerEchec[id]) return;
    passerEchec[id] = 1; nEchecPasser++;
    LOG('pub de debut ' + pourquoi + ' -> retour au retrait des pubs' + (nEchecPasser >= 2 ? ' (pour toute la session)' : ' pour cette video'));
  }
  function idPage() { return location.pathname.indexOf('/watch') === 0 ? new URLSearchParams(location.search).get('v') : null; }
  var ecran = null, ecranId = null;
  function finirAttente(a, pourquoi) {
    a.fini = true;
    if (a.vu) LOG('ecran d\'attente retire (' + pourquoi + ') apres ' + ((Date.now() - a.vu) / 1000).toFixed(1) + ' s');
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
  function construireEcran(id) {
    var coul = '#F7D154';
    try { var cc = jp.call(JSON, localStorage.getItem('lw_color') || 'null'); if (typeof cc === 'string' && /^#[0-9a-f]{3,8}$/i.test(cc)) coul = cc; } catch (e) {}
    var css = document.getElementById('lw-attente-css');
    if (!css) { css = el('style'); css.id = 'lw-attente-css'; (document.head || document.documentElement).appendChild(css); }
    css.textContent = '@keyframes lwaRot{to{transform:rotate(360deg)}}' +
      '#lw-attente{position:fixed;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;' +
      'pointer-events:none;background:#000;font-family:Roboto,Arial,sans-serif;color:#fff;text-align:center;box-sizing:border-box;padding:8px}' +
      '#lw-attente .lwa-f{position:absolute;left:0;top:0;right:0;bottom:0;background-position:center;background-size:cover;filter:brightness(.35);transform:scale(1.05)}' +
      '#lw-attente .lwa-r{position:relative;width:38px;height:38px;border-radius:50%;box-sizing:border-box;border:3px solid rgba(255,255,255,.22);' +
      'border-top-color:' + coul + ';animation:lwaRot .9s linear infinite;margin-bottom:10px}' +
      '#lw-attente .lwa-t{position:relative;font-size:15px;font-weight:700;text-shadow:0 1px 3px #000}' +
      '#lw-attente .lwa-s{position:relative;font-size:12.5px;margin-top:2px;opacity:.92;text-shadow:0 1px 3px #000}' +
      '#lw-attente .lwa-c{position:relative;font-size:12px;margin-top:8px;padding:3px 10px;border-radius:12px;background:rgba(0,0,0,.5);color:' + coul + '}';
    var e = el('div'); e.id = 'lw-attente';
    var f = el('div', 'lwa-f');
    if (id && /^[\w-]{11}$/.test(id)) f.style.backgroundImage = 'url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg)';
    e.appendChild(f);
    e.appendChild(el('div', 'lwa-r'));
    e.appendChild(el('div', 'lwa-t', 'ONEBlock s\u2019excuse'));
    e.appendChild(el('div', 'lwa-s', 'YouTube oblige l\u2019attente'));
    e.appendChild(el('div', 'lwa-c', ''));
    return e;
  }
  function montrerAttente(a, p, id) {
    if (!a) { if (ecran) { try { ecran.remove(); } catch (e) {} ecran = null; ecranId = null; } return; }
    var r = p.getBoundingClientRect();
    if (!ecran || !ecran.isConnected || ecranId !== id) {
      if (ecran) { try { ecran.remove(); } catch (e) {} }
      ecran = construireEcran(id); ecranId = id;
      document.documentElement.appendChild(ecran);
      if (!a.vu) { a.vu = Date.now(); LOG('ecran d\'attente affiche' + (a.att ? ' (~' + a.att + ' s prevues)' : '')); }
    }
    var st = ecran.style;
    if (r.width < 80 || r.height < 60) { st.display = 'none'; return; }
    st.display = 'flex'; st.left = r.left + 'px'; st.top = r.top + 'px'; st.width = r.width + 'px'; st.height = r.height + 'px';
    var reste = a.att && !GARDE[id] ? Math.ceil(a.att - (Date.now() - a.t) / 1000) : null;
    var txt = a.pub ? 'Pub en cours de saut\u2026' : reste === null ? 'La lecture va d\u00e9marrer' : (reste >= 1 ? 'Lecture dans ' + reste + ' s' : 'Encore un instant\u2026');
    var c = ecran.lastChild; if (c && c.textContent !== txt) c.textContent = txt;
  }
  // vrai pendant l'attente imposee (l'ecran est alors affiche)
  function attenteEcran(p, v) {
    if (!ECRAN) { if (ecran) montrerAttente(null); return false; }
    var id = idPage(), a = id && ATT[id], on = false;
    if (a && !a.fini) {
      var dep = Date.now() - a.t, pub = !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
      if (!ACTIF) finirAttente(a, 'bloqueur coupe');
      else if (dep > 60000) finirAttente(a, 'delai');
      else if (!pub && v && !v.paused && v.readyState >= 3 && dep > 300 && !(a.pubVue && Date.now() - a.pubVue < 400)) finirAttente(a, 'lecture');
      else if (p && v && !(window.__lwAgr && Date.now() < window.__lwAgr) && !window.__lwPip && !document.documentElement.classList.contains('lw-pip')) {
        if (pub) { a.pubVue = Date.now(); if (GARDE[id]) { on = true; a.pub = true; } }
        else if ((dep > 1500 || (a.pubVue && GARDE[id])) && !p.classList.contains('paused-mode')) { on = true; a.pub = false; }
      }
    }
    montrerAttente(on ? a : null, p, id);
    return on;
  }
  try {
    document.addEventListener('playing', function (e) {
      try {
        var v = e.target; if (!v || v.tagName !== 'VIDEO') return;
        var id = idPage(), a = id && ATT[id];
        if (!a || a.fini || Date.now() - a.t <= 200) return;
        var pl = document.querySelector('.html5-video-player');
        function enPub() { return !!(pl && (pl.classList.contains('ad-showing') || pl.classList.contains('ad-interrupting'))); }
        if (enPub()) return;                                   // c'est la pub qui demarre (on la passe), pas la video
        if (!GARDE[id]) { finirAttente(a, 'lecture'); montrerAttente(null); return; }
        // pub gardee : la classe "pub" peut arriver juste apres ; on reverifie un instant plus tard
        setTimeout(function () { try { if (!a.fini && !enPub() && !v.paused) { finirAttente(a, 'lecture'); montrerAttente(null); } } catch (x) {} }, 350);
      } catch (x) {}
    }, true);
  } catch (e) {}

  /* ---------- 3. Secours : saute les pubs qui passeraient quand meme ---------- */
  var muted = false, mutedEl = null, seen = false, shortsPasses = new WeakSet(), vitesseEl = null, vitesseAvant = 1, pubDebut = 0;
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
      if (GARDE[id]) echecPasser(id, 'bloquee ' + (d / 1000).toFixed(1) + ' s');
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
      if (ecran) { try { attenteEcran(p, v); } catch (e) {} }
      if (vitesseEl) { try { if (vitesseEl.playbackRate === 16) vitesseEl.playbackRate = vitesseAvant > 0 && vitesseAvant < 16 ? vitesseAvant : 1; } catch (e) {} vitesseEl = null; }
      if (muted || mutedEl) rendreSon(v);
      seen = false;
      return;
    }
    passerShortPub();
    var enAttente = false;
    try { enAttente = attenteEcran(p, v); } catch (e) {}
    if (!enAttente && !IGE) debloquer(p, v);
    var ad = !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
    fantome(p, v, ad);
    if (ad && v) {
      prochain = 100;
      if (!v.muted) { v.muted = true; mutedEl = v; muted = true; }
      try { if (vitesseEl !== v) { vitesseEl = v; vitesseAvant = v.playbackRate; } if (v.playbackRate !== 16) v.playbackRate = 16; } catch (e) {}
      if (!pubDebut) pubDebut = Date.now();
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) v.currentTime = v.duration;
      var sk = document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button');
      if (sk) sk.click();
      if (!seen) { seen = true; LOG('pub detectee, saut'); if (Date.now() - dernierComptage > 20000) bump(); }
    } else {
      if (pubDebut) { LOG('pub passee en ' + ((Date.now() - pubDebut) / 1000).toFixed(1) + ' s'); pubDebut = 0; }
      if (vitesseEl) { try { if (vitesseEl.playbackRate === 16) vitesseEl.playbackRate = vitesseAvant > 0 && vitesseAvant < 16 ? vitesseAvant : 1; } catch (e) {} vitesseEl = null; }
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
