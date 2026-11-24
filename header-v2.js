/* Testata v2: riorganizza la navbar esistente (nessun markup duplicato, gli handler dell'app restano agganciati agli stessi elementi).
   menu a sinistra · logo al centro · lingua + ricerca (lente cliccabile) a destra · menu con icone. */
(function () {
  'use strict';
  function init() {
    var row = document.getElementById('navbar-row1');
    var drawer = document.getElementById('nav-drawer');
    var burger = document.getElementById('nav-hamburger');
    if (!row || !drawer || !burger || row.dataset.hv2) return;
    row.dataset.hv2 = '1';

    // hamburger per primo, poi logo
    row.insertBefore(burger, row.firstChild);

    // gruppo di destra: (live) campanelle · lente · lingua
    var right = document.createElement('div');
    right.className = 'hv2-right';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hv2-search-btn'; btn.setAttribute('aria-label', 'Cerca');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    ['badge-live', 'msg-bell', 'notif-bell'].forEach(function (id) { var e = document.getElementById(id); if (e) right.appendChild(e); });
    right.appendChild(btn);
    var lang = document.getElementById('lang-select'); if (lang) right.appendChild(lang);
    row.appendChild(right);

    // ricerca: apre/chiude la barra sotto la testata
    function setSearch(on) {
      document.body.classList.toggle('hv2-search', on);
      if (on) { drawer.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); var i = document.getElementById('m-search'); if (i) setTimeout(function () { i.focus(); }, 30); }
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); setSearch(!document.body.classList.contains('hv2-search')); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setSearch(false); });
    window.addEventListener('hashchange', function () { setSearch(false); });
    window.addEventListener('popstate', function () { setSearch(false); });
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('hv2-search')) return;
      if (e.target.closest('#mobile-search-bar') || e.target.closest('.hv2-search-btn')) return;
      setSearch(false);
    });
    burger.addEventListener('click', function () { document.body.classList.remove('hv2-search'); });

    // icone del menu
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
    function addIcons() {
      drawer.querySelectorAll('.nav-link').forEach(function (a) {
        var m = (a.id || '').replace('drawer-', '');
        if (a.querySelector('.hv2-ic')) return;
        if (a.classList.contains('drawer-share-btn')) a.textContent = a.textContent.replace(/^[^A-Za-z]+/, '');
        a.insertAdjacentHTML('afterbegin', icon(a.classList.contains('drawer-share-btn') ? 'share' : m));
      });
    }
    addIcons();
    // l'app riscrive il testo di "Login / Profilo" quando cambia lo stato di accesso: l'icona si rimette
    new MutationObserver(function () { addIcons(); }).observe(drawer, { childList: true, subtree: true });
    // separatore e strumenti (tema) in fondo al menu
    var login = document.getElementById('drawer-login');
    if (login) login.insertAdjacentHTML('beforebegin', '<div class="hv2-sep"></div>');
    var tools = document.createElement('div');
    tools.className = 'hv2-tools';
    var theme = document.getElementById('theme-toggle');
    tools.innerHTML = '<span>Tema chiaro / scuro</span>';
    if (theme) tools.insertBefore(theme, tools.firstChild);
    drawer.appendChild(tools);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
