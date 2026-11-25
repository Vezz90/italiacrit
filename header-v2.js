/* Testata v2 — SOLO MOBILE (≤640px): riorganizza la navbar esistente (nessun markup duplicato: gli handler dell'app restano agganciati
   agli stessi elementi). menu a sinistra · logo al centro · lingua + ricerca (lente cliccabile) a destra · menu con icone.
   Desktop: testata a una riga con menu a tendine. Passando da un formato all'altro gli elementi spostati vengono rimessi al loro posto. */
(function () {
  'use strict';
  var mq = window.matchMedia('(max-width: 640px)');
  var st = null;   // stato: elementi creati e posizioni originali

  var P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    risultati: '<path d="M4 4v17"/><path d="M4 5h13l-2 4 2 4H4"/>',
    class: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>',
    albo: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/>',
    atleti: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0114 0"/><circle cx="17" cy="9" r="2.7"/><path d="M16 14.2A6 6 0 0122 21"/>',
    gare: '<path d="M4 4v17"/><path d="M4 5h13l-2 4 2 4H4"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    media: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
    stats: '<path d="M4 21V10M10 21V4M16 21v-8M22 21H2"/>',
    comp: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    msg: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    login: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18a6.5 6.5 0 0111 0"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>'
  };
  function icon(k) { return '<svg class="hv2-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[k] || P.home) + '</svg>'; }

  function setSearch(on) {
    var drawer = document.getElementById('nav-drawer'), burger = document.getElementById('nav-hamburger');
    document.body.classList.toggle('hv2-search', on);
    if (on) {
      if (drawer) drawer.classList.remove('open');
      if (burger) burger.setAttribute('aria-expanded', 'false');
      var i = document.getElementById('m-search'); if (i) setTimeout(function () { i.focus(); }, 30);
    }
  }

  function addIcons(drawer) {
    drawer.querySelectorAll('.nav-link').forEach(function (a) {
      if (a.querySelector('.hv2-ic')) return;
      var share = a.classList.contains('drawer-share-btn');
      if (share) a.textContent = a.textContent.replace(/^[^A-Za-z]+/, '');
      a.insertAdjacentHTML('afterbegin', icon(share ? 'share' : (a.id || '').replace('drawer-', '')));
    });
  }

  // MOBILE: Risultati, Classifiche, Atleti, Team, Calendario e Media diventano voci a fisarmonica con le categorie (Uomini, poi Donne)
  var MEDIA_SEC = [['Creator', 'creator'], ['Dirette', 'dirette'], ['Video', 'video'], ['Presentazioni', 'presentazioni'], ['Programmi TV', 'programmi-tv'], ['Altro', 'altro']];
  function buildAccordions(drawer, burger) {
    var defs = [
      ['drawer-risultati', 'Risultati', 'risultati', 'risultati'],
      ['drawer-class', 'Classifiche', 'classifica', 'class'],
      ['drawer-atleti', 'Atleti', 'atleti', 'atleti'],
      ['drawer-team', 'Team', 'team', 'team'],
      ['drawer-cal', 'Calendario', 'calendario', 'cal'],
      ['drawer-media', 'Media', 'media', 'media']
    ];
    var accs = [];
    defs.forEach(function (d) {
      var orig = document.getElementById(d[0]); if (!orig) return;
      var seg = d[2];
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'nav-link hv2-acc'; btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = icon(d[3]) + '<span>' + d[1] + '</span>' + CHEV;
      var sub = document.createElement('div'); sub.className = 'hv2-sub'; sub.hidden = true;
      if (seg === 'media') {
        sub.innerHTML = MEDIA_SEC.map(function (m) { return '<a href="#/media/' + m[1] + '" class="hv2-subl" data-k="' + m[1] + '">' + m[0] + '</a>'; }).join('');
      } else {
        sub.innerHTML = ((seg === 'risultati' || seg === 'calendario') ? '<a href="#/' + seg + '" class="hv2-subl" data-k="">Tutti</a>' : '') + [['M', 'Uomini'], ['F', 'Donne']].map(function (g) {
          return '<div class="hv2-subh">' + g[1] + '</div>' + catsFor(seg).map(function (c) {
            var code = c[0] + '_' + g[0];
            return '<a href="#/' + (seg === 'calendario' ? 'calendario/cat' : seg) + '/' + code + '" class="hv2-subl" data-k="' + code + '">' + c[1] + '</a>';
          }).join('');
        }).join('');
      }
      btn.addEventListener('click', function () {
        var open = sub.hidden; sub.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); btn.classList.toggle('open', open);
      });
      sub.addEventListener('click', function (e) {
        if (!e.target.closest('a')) return;
        drawer.classList.remove('open'); burger.setAttribute('aria-expanded', 'false');
      });
      orig.style.display = 'none';
      st.moved.push({ el: orig, parent: orig.parentNode, next: orig.nextSibling, restoreStyle: true });
      orig.parentNode.insertBefore(btn, orig); orig.parentNode.insertBefore(sub, orig);
      st.created.push(btn); st.created.push(sub);
      accs.push({ seg: seg, btn: btn, sub: sub });
    });
    function mark() {
      var h = curHash();
      accs.forEach(function (a) {
        var on = h.seg === a.seg || (a.seg === 'risultati' && h.seg === 'gara');
        a.btn.classList.toggle('active', on);
        var key = a.seg === 'media' ? (h.cat || 'video') : h.cat;
        a.sub.querySelectorAll('.hv2-subl').forEach(function (l) { l.classList.toggle('active', on && l.getAttribute('data-k') === key); });
      });
    }
    mark(); st.timer = setInterval(mark, 800);
  }

  function toMobile() {
    if (st) return;
    var row = document.getElementById('navbar-row1'), drawer = document.getElementById('nav-drawer'), burger = document.getElementById('nav-hamburger');
    if (!row || !drawer || !burger) return;
    st = { moved: [], created: [], mode: 'mob' };
    // sposta ricordando dove stava (per rimetterlo a posto su desktop)
    function move(el, parent, before) {
      if (!el) return;
      st.moved.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      parent.insertBefore(el, before || null);
    }
    var right = document.createElement('div'); right.className = 'hv2-right'; st.created.push(right);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'hv2-search-btn'; btn.setAttribute('aria-label', 'Cerca');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    btn.addEventListener('click', function (e) { e.stopPropagation(); setSearch(!document.body.classList.contains('hv2-search')); });
    st.created.push(btn);
    row.appendChild(right);
    move(burger, row, row.firstChild);
    ['badge-live', 'msg-bell', 'notif-bell'].forEach(function (id) { move(document.getElementById(id), right); });
    right.appendChild(btn);
    move(document.getElementById('lang-select'), right);

    addIcons(drawer);
    buildAccordions(drawer, burger);
    var login = document.getElementById('drawer-login');
    if (login) { var sep = document.createElement('div'); sep.className = 'hv2-sep'; login.parentNode.insertBefore(sep, login); st.created.push(sep); }
    var tools = document.createElement('div'); tools.className = 'hv2-tools'; tools.innerHTML = '<span>Tema chiaro / scuro</span>';
    drawer.appendChild(tools); st.created.push(tools);
    move(document.getElementById('theme-toggle'), tools, tools.firstChild);
    // l'app riscrive il testo di "Login / Profilo" quando cambia lo stato di accesso: l'icona si rimette
    st.obs = new MutationObserver(function () { addIcons(drawer); });
    st.obs.observe(drawer, { childList: true, subtree: true });
  }

  function restore() {
    if (!st) return;
    if (st.timer) clearInterval(st.timer);
    if (st.mediaTimer) clearInterval(st.mediaTimer); if (st.catTimer) clearInterval(st.catTimer);
    if (st.mediaFn) window.removeEventListener('hashchange', st.mediaFn);
    if (st.catFn) window.removeEventListener('hashchange', st.catFn);
    var nb0 = document.getElementById('navbar'); if (nb0) nb0.classList.remove('hv2-logged');
    document.body.classList.remove('hv2-search');
    if (st.obs) st.obs.disconnect();
    for (var i = st.moved.length - 1; i >= 0; i--) { var m = st.moved[i]; m.parent.insertBefore(m.el, m.next && m.next.parentNode === m.parent ? m.next : null); if (m.restoreStyle) m.el.style.display = ''; }
    st.created.forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
    var drawer = document.getElementById('nav-drawer'); if (drawer) drawer.querySelectorAll('.hv2-ic').forEach(function (e) { e.remove(); });
    st = null;
  }

  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  var GROUPS = [
    ['Risultati', ['@cat:risultati']],
    ['Calendario', ['@cat:calendario']],
    ['__gare'],
    ['Classifiche', ['@cat:classifica', 'nav-albo']],
    ['Atleti', ['@cat:atleti']],
    ['Team', ['@cat:team']],
    ['Statistiche', ['nav-stats', 'nav-comp']]
  ];
  // elenco categorie per le tendine Classifiche / Atleti / Team: prima uomini, poi donne
  var CATS = [['ES1', 'Esordienti 1° anno'], ['ES2', 'Esordienti 2° anno'], ['AL', 'Allievi'], ['JUN', 'Juniores'], ['ELI', 'Elite · Under 23']];
  // Calendario: il filtro ha un solo gruppo Esordienti (niente 1°/2° anno)
  function catsFor(seg) { return seg === 'calendario' ? CATS.filter(function (c) { return c[0] !== 'ES2'; }).map(function (c) { return c[0] === 'ES1' ? ['ES1', 'Esordienti'] : c; }) : CATS; }
  function catList(seg) {
    function col(sx, title) {
      return '<div class="hv2-col"><div class="hv2-ch">' + title + '</div>' + catsFor(seg).map(function (c) {
        var code = c[0] + '_' + sx;
        return '<a href="#/' + (seg === 'calendario' ? 'calendario/cat' : seg) + '/' + code + '" class="nav-link hv2-cat" data-cat="' + code + '">' + c[1] + '</a>';
      }).join('') + '</div>';
    }
    var all = (seg === 'risultati' || seg === 'calendario') ? '<a href="#/' + seg + '" class="nav-link hv2-cat hv2-all" data-cat="">Tutti</a>' : '';
    return all + '<div class="hv2-cols">' + col('M', 'Uomini') + col('F', 'Donne') + '</div>';
  }
  function curHash() { var h = (location.hash && location.hash.length > 1 ? location.hash : location.pathname).replace(/^#?\/?/, '').split('?')[0].split('/'); if (h[0] === 'calendario' && h[1] === 'cat') return { seg: 'calendario', cat: h[2] || '' };
    return { seg: h[0] || '', cat: h[1] || '' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function closeAll() { document.querySelectorAll('.hv2-grp.open, .hv2-acct.open').forEach(function (e) { e.classList.remove('open'); }); }

  function toDesk() {
    if (st) return;
    var row = document.getElementById('navbar-row1'), nb = document.getElementById('navbar');
    if (!row || !nb) return;
    st = { moved: [], created: [], mode: 'desk' };
    function move(el, parent, before) {
      if (!el) return;
      st.moved.push({ el: el, parent: el.parentNode, next: el.nextSibling });
      parent.insertBefore(el, before || null);
    }
    // menu con tendine: gli STESSI link della seconda riga (id e handler invariati: evidenziazione e navigazione restano quelle dell'app)
    var menu = document.createElement('nav'); menu.className = 'hv2-menu'; menu.setAttribute('aria-label', 'Menu principale'); st.created.push(menu);
    var grpEls = [];
    GROUPS.forEach(function (g) {
      if (g[0] === '__gare') { move(document.getElementById('nav-gare'), menu); return; }   // Gare: voce singola
      var grp = document.createElement('div'); grp.className = 'hv2-grp';
      grp.innerHTML = '<button type="button" class="hv2-top" aria-haspopup="true">' + g[0] + CHEV + '</button><div class="hv2-dd"><div class="hv2-dd-in"></div></div>';
      var inn = grp.querySelector('.hv2-dd-in');
      g[1].forEach(function (id) {
        if (id.indexOf('@cat:') === 0) { var sg = id.slice(5); grp.setAttribute('data-seg', sg); inn.insertAdjacentHTML('beforeend', catList(sg)); grp.classList.add('hv2-wide'); }
        else move(document.getElementById(id), inn);
      });
      grp.querySelector('.hv2-top').addEventListener('click', function (e) {
        e.stopPropagation();
        var was = grp.classList.contains('open');
        closeAll(); if (!was) grp.classList.add('open');
      });
      grp.addEventListener('click', function (e) { if (e.target.closest('a')) closeAll(); });
      menu.appendChild(grp); grpEls.push(grp);
    });
    // Media: tendina con le sezioni della pagina Media
    var mg = document.createElement('div'); mg.className = 'hv2-grp'; st.created.push(mg);
    var MSEC = [['Creator', 'creator'], ['Dirette', 'dirette'], ['Video', 'video'], ['Presentazioni', 'presentazioni'], ['Programmi TV', 'programmi-tv'], ['Altro', 'altro']];
    mg.innerHTML = '<button type="button" class="hv2-top" aria-haspopup="true">Media' + CHEV + '</button><div class="hv2-dd"><div class="hv2-dd-in">' +
      MSEC.map(function (m) { return '<a href="#/media/' + m[1] + '" class="nav-link hv2-msec" data-ms="' + m[1] + '">' + m[0] + '</a>'; }).join('') + '</div></div>';
    mg.querySelector('.hv2-top').addEventListener('click', function (e) { e.stopPropagation(); var was = mg.classList.contains('open'); closeAll(); if (!was) mg.classList.add('open'); });
    mg.addEventListener('click', function (e) { if (e.target.closest('a')) closeAll(); });
    menu.appendChild(mg); grpEls.push(mg);
    function markMedia() {
      var h = (location.hash && location.hash.length > 1 ? location.hash : location.pathname).replace(/^#?\/?/, '').split('?')[0].split('/');
      var on = h[0] === 'media', sec = on ? (h[1] || 'video') : '';
      mg.querySelectorAll('.hv2-msec').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-ms') === sec); });
    }
    markMedia(); window.addEventListener('hashchange', markMedia); window.addEventListener('popstate', markMedia); st.mediaTimer = setInterval(markMedia, 800);
    st.mediaFn = markMedia;
    move(document.getElementById('nav-home'), menu);
    move(document.getElementById('nav-msg'), menu);
    var logo = document.getElementById('nav-logo-link');
    row.insertBefore(menu, logo ? logo.nextSibling : row.firstChild);
    function markCats() {
      var h = curHash();
      grpEls.forEach(function (g) {
        var sg = g.getAttribute('data-seg'); if (!sg) return;
        g.querySelectorAll('.hv2-cat').forEach(function (a) { a.classList.toggle('active', h.seg === sg && a.getAttribute('data-cat') === h.cat); });
      });
    }
    function markActive() { markCats(); grpEls.forEach(function (g) { var sg = g.getAttribute('data-seg'); g.classList.toggle('has-active', !!g.querySelector('.nav-link.active') || (!!sg && (curHash().seg === sg || (sg === 'risultati' && curHash().seg === 'gara')))); }); }
    window.addEventListener('hashchange', markActive); window.addEventListener('popstate', markActive); st.catTimer = setInterval(markActive, 800); st.catFn = markActive;
    markActive();
    st.obs = new MutationObserver(markActive);
    st.obs.observe(menu, { attributes: true, attributeFilter: ['class'], subtree: true });

    // lente (apre la barra di ricerca) prima delle campanelle/lingua
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'hv2-search-btn'; btn.setAttribute('aria-label', 'Cerca');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    btn.addEventListener('click', function (e) { e.stopPropagation(); setSearch(!document.body.classList.contains('hv2-search')); });
    st.created.push(btn);
    row.insertBefore(btn, document.getElementById('badge-live') || document.getElementById('lang-select') || null);

    // blocco account (solo se collegato): avatar, nome, ruolo e tendina
    var acct = document.createElement('div'); acct.className = 'hv2-acct'; acct.style.display = 'none'; st.created.push(acct);
    row.appendChild(acct);
    function user() { try { return JSON.parse(localStorage.getItem('italiacrit-user') || 'null'); } catch (e) { return null; } }
    var lastSig = '';
    function refreshAcct() {
      var u = user(), sig = u ? (u.display_name || '') + '|' + (u.role || '') : '';
      if (sig === lastSig) return; lastSig = sig;
      nb.classList.toggle('hv2-logged', !!u);
      if (!u) { acct.style.display = 'none'; acct.innerHTML = ''; return; }
      var name = u.display_name || 'Profilo', role = u.role === 'admin' ? 'Admin' : 'Membro';
      acct.style.display = '';
      acct.innerHTML = '<button type="button" class="hv2-acct-btn" aria-haspopup="true"><span class="hv2-av">' + esc(name.charAt(0).toUpperCase()) + '</span><span class="hv2-meta"><b>' + esc(name) + '</b><small>' + role + '</small></span>' + CHEV + '</button>' +
        '<div class="hv2-dd"><div class="hv2-dd-in"><a href="#/profilo">Il mio profilo</a><a href="#/messaggi">Messaggi</a><button type="button" data-out="1">Esci</button></div></div>';
      acct.querySelector('.hv2-acct-btn').addEventListener('click', function (e) { e.stopPropagation(); var was = acct.classList.contains('open'); closeAll(); if (!was) acct.classList.add('open'); });
      acct.querySelector('[data-out]').addEventListener('click', function () { closeAll(); if (typeof window.doLogout === 'function') window.doLogout(); });
      acct.addEventListener('click', function (e) { if (e.target.closest('a')) closeAll(); });
    }
    refreshAcct();
    st.timer = setInterval(refreshAcct, 1500);
  }

  function sync() {
    var want = mq.matches ? 'mob' : 'desk';
    if (st && st.mode === want) return;
    restore();
    if (want === 'mob') toMobile(); else toDesk();
  }

  function init() {
    sync();
    if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setSearch(false); closeAll(); } });
    document.addEventListener('click', closeAll);
    window.addEventListener('hashchange', function () { setSearch(false); closeAll(); });
    window.addEventListener('popstate', function () { setSearch(false); });
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('hv2-search')) return;
      if (e.target.closest('#mobile-search-bar') || e.target.closest('.hv2-search-btn')) return;
      setSearch(false);
    });
    var burger = document.getElementById('nav-hamburger');
    if (burger) burger.addEventListener('click', function () { document.body.classList.remove('hv2-search'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
