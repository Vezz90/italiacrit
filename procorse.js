/* Gare professionistiche in Italia (WorldTour e ProSeries, dati PCS): compaiono in Risultati e in Home, senza punti ICS.
   Il server (/api/data/pro-races) restituisce gare e podio; l'arrivo completo si apre nel modale gia' usato per le gare estere. */
(function () {
  'use strict';
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  var cache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nm(s) { return String(s || '').toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function load(season) {
    if (!cache[season]) cache[season] = apiCall('/data/pro-races?season=' + season).then(function (d) { return (d && d.races) || []; }).catch(function () { return []; });
    return cache[season];
  }
  function classLabel(r) {
    if (/WWT/.test(r.classe)) return "Women's WorldTour";
    if (/UWT/.test(r.classe)) return 'WorldTour';
    return 'ProSeries';
  }
  function dateTxt(r) {
    var a = (r.data_start || '').split('-'), b = (r.data_end || '').split('-');
    if (a.length < 3) return '';
    var d = +a[2] + ' ' + MESI[+a[1] - 1];
    return r.data_end && r.data_end !== r.data_start ? +a[2] + ' ' + (a[1] === b[1] ? '' : MESI[+a[1] - 1] + ' ') + '– ' + +b[2] + ' ' + MESI[+b[1] - 1] : d;
  }
  function open(slug, season, name) { if (window.showPcsRaceModal) window.showPcsRaceModal(slug, season, name); }
  window._proOpen = function (i, season) { var r = (window._proList || [])[i]; if (r) open(r.pcs_race_slug, season, r.nome); };

  function row(r, i, season) {
    var pod = (r.podio || []).map(function (p) {
      var who = p.atleta_id ? '<a href="#/atleta/' + esc(p.atleta_id) + '" onclick="event.stopPropagation()">' + esc(nm(p.nome)) + '</a>' : esc(nm(p.nome));
      return '<span class="pr-p pr-p' + p.pos + '"><i>' + p.pos + '</i>' + who + (p.team ? '<small>' + esc(p.team) + '</small>' : '') + '</span>';
    }).join('');
    return '<article class="pr-card" onclick="window._proOpen(' + i + ',' + season + ')" tabindex="0" onkeydown="if(event.key===\'Enter\')window._proOpen(' + i + ',' + season + ')">'
      + '<div class="pr-h"><span class="pr-badge">PRO · ' + esc(classLabel(r)) + '</span><span class="pr-d">' + esc(dateTxt(r)) + '</span></div>'
      + '<h3>' + esc(r.nome) + '</h3><div class="pr-pod">' + pod + '</div>'
      + '<div class="pr-f"><span>Senza punti ICS</span><b>Arrivo completo ›</b></div></article>';
  }

  function paint(host, races, season, opts) {
    opts = opts || {};
    var list = races.filter(function (r) {
      if (opts.sex === 'F' && !r.femminile) return false;
      if (opts.sex === 'M' && r.femminile) return false;
      if (opts.month && +String(r.data_end).slice(5, 7) !== +opts.month) return false;
      if (opts.q && String(r.nome).toLowerCase().indexOf(String(opts.q).toLowerCase()) < 0) return false;
      return true;
    });
    if (opts.limit) list = list.slice(0, opts.limit);
    window._proList = list;
    if (!list.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<section class="pr-sec"><div class="pr-title"><h2>' + esc(opts.title || 'Dai professionisti in Italia') + '</h2><span>WorldTour e ProSeries · dati PCS · nessun punto ICS</span></div>'
      + '<div class="pr-grid">' + list.map(function (r, i) { return row(r, i, season); }).join('') + '</div></section>';
  }

  window.ProRaces = {
    // opts: { sex:'M'|'F', month:1-12, q:'testo', limit:n, title }
    mount: function (hostId, season, opts) {
      return load(season).then(function (races) { var host = document.getElementById(hostId); if (host) paint(host, races, season, opts); });
    }
  };
})();
