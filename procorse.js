/* Gare professionistiche in Italia (WorldTour e ProSeries, dati PCS, nessun punto ICS).
   Le trasforma in "gare" della stessa forma di quelle FCI, cosi' Risultati e Home le disegnano con le card di sempre.
   Server: /api/data/pro-races (elenco + podio) e /api/data/pro-race/:id (arrivo completo, usato dalla pagina gara). */
(function () {
  'use strict';
  var cache = {};
  function clean(d) { d = String(d || '').trim(); if (!d || /^[,.\-]+$/.test(d) || /^s\.?t\.?$/i.test(d)) return ''; return d.replace(/^\+\s*/, ''); }
  function load(season) {
    if (!cache[season]) cache[season] = apiCall('/data/pro-races?season=' + season).then(function (d) { return (d && d.races) || []; }).catch(function () { return []; });
    return cache[season];
  }
  function toEvent(r) {
    var code = r.genere === 'F' ? 'PRO_F' : 'PRO_M', bc = {};
    bc[code] = {
      gara_id: r.id,
      results: (r.top3 || []).map(function (p) {
        return { gara_id: r.id, posizione: p.posizione, cognome: p.nome_completo || '', nome: '', atleta_id: p.atleta_id || null, team: p.team || '', tempo: clean(p.distacco), km: '', media: '', punti_effettivi: 0, categoria: code };
      })
    };
    return {
      id: r.id, nome: r.nome, data: r.data, genere: r.genere, tipo: 'internazionale', regione: '', mult: 1,
      campionato_regionale: false, campionato_italiano: false, byCategory: bc, _seq: 0, _pro: true, _proClasse: r.classe, _proCode: code
    };
  }
  window.ProRaces = {
    events: function (season) { return load(season).then(function (rs) { return rs.map(toEvent); }); },
    label: function (classe) { return /WWT/.test(classe) ? "Women's WorldTour" : /UWT/.test(classe) ? 'WorldTour' : 'ProSeries'; }
  };
})();
