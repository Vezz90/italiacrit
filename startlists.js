/* Iscritti e Partenti nelle pagine gara (da SegreteriaGare): due schede prima dell'Albo d'oro, solo se la gara ha un elenco. */
(function () {
  'use strict';
  var cache = {}, busy = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function garaId() { var m = (location.pathname + location.hash).match(/\/gara\/([^\/?#]+)/); return m ? decodeURIComponent(m[1]) : null; }
  function apiBase() { return (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : 'https://italiacrit.onrender.com/api'; }
  function table(rows) {
    if (!rows.length) return '<div class="empty-state">Nessun elenco disponibile</div>';
    return '<div class="results-table-wrap"><table class="results-table"><thead><tr><th>N°</th><th>ATLETA</th><th class="td-hide-mobile">TEAM</th><th class="td-hide-mobile">CAT.</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var nm = r.athlete_id ? '<a href="#/atleta/' + encodeURIComponent(r.athlete_id) + '">' + esc(r.athlete_name) + '</a>' : esc(r.athlete_name);
        var tn = (r.team_name && r.team_name.length <= 46 && !/(NAZIONALE|\(FRA\)|ITA|ACADEMY U19).*1/.test(r.team_name)) ? r.team_name : '';
        var tm = r.team_id ? '<a href="#/team/' + encodeURIComponent(r.team_id) + '">' + esc(tn || r.team_id.replace(/_/g, ' ')) + '</a>' : esc(tn);
        return '<tr><td>' + esc(r.bib) + '</td><td>' + nm + '</td><td class="td-hide-mobile">' + tm + '</td><td class="td-hide-mobile">' + esc(r.cat_code || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function setTab(which) {
    var res = document.getElementById('gara-results-panel'), albo = document.getElementById('race-albo-doro');
    ['iscritti', 'partenti'].forEach(function (k) {
      var p = document.getElementById('sl-panel-' + k), b = document.getElementById('sl-tab-' + k);
      if (p) p.style.display = (k === which) ? 'block' : 'none';
      if (b) b.classList.toggle('active-cat', k === which);
    });
    if (res) res.style.display = 'none'; if (albo) albo.style.display = 'none';
    ['tab-risultati', 'tab-albo'].forEach(function (id) { var b = document.getElementById(id); if (b) b.classList.remove('active-cat'); });
  }
  function hook() {
    if (window._switchGaraTab && !window._switchGaraTab._sl) {
      var orig = window._switchGaraTab;
      var w = function (tab) {
        if (tab === 'iscritti' || tab === 'partenti') return setTab(tab);
        ['iscritti', 'partenti'].forEach(function (k) { var p = document.getElementById('sl-panel-' + k), b = document.getElementById('sl-tab-' + k); if (p) p.style.display = 'none'; if (b) b.classList.remove('active-cat'); });
        return orig(tab);
      };
      w._sl = true; window._switchGaraTab = w;
    }
  }
  function decorate() {
    var albo = document.getElementById('tab-albo'); var id = garaId();
    if (!albo || !id || albo.getAttribute('data-sl') === id) return;
    albo.setAttribute('data-sl', id);
    hook();
    function build(d) {
      if (document.getElementById('sl-tab-iscritti') || document.getElementById('sl-tab-partenti')) return;
      var ai = d.iscritti || [], ap = d.partenti || [];
      if (!ai.length && !ap.length) return;
      var holder = document.getElementById('gara-results-panel'); if (!holder) return;
      [['iscritti', 'Iscritti', ai], ['partenti', 'Partenti', ap]].forEach(function (x) {
        if (!x[2].length) return;
        var b = document.createElement('button'); b.id = 'sl-tab-' + x[0]; b.className = 'tab-btn'; b.type = 'button';
        b.innerHTML = (x[0] === 'iscritti' ? '📝 ' : '🏁 ') + x[1] + ' <span style="opacity:.7">' + x[2].length + '</span>';
        b.onclick = function () { window._switchGaraTab(x[0]); };
        albo.parentNode.insertBefore(b, albo);
        var p = document.createElement('div'); p.id = 'sl-panel-' + x[0]; p.style.display = 'none'; p.style.marginTop = '8px';
        p.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);margin:6px 0 10px">Elenco ' + x[1].toLowerCase() + ' · fonte SegreteriaGare.it · ' + x[2].length + ' atleti</div>' + table(x[2]);
        holder.parentNode.insertBefore(p, holder.nextSibling);
      });
    }
    if (cache[id]) return build(cache[id]);
    if (busy[id]) return; busy[id] = 1;
    fetch(apiBase() + '/startlists/' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : { iscritti: [], partenti: [] }; })
      .then(function (d) { cache[id] = d; busy[id] = 0; if (garaId() === id) build(d); }).catch(function () { busy[id] = 0; });
  }
  // Scheda atleta: tutte le gare in cui compare negli elenchi, anche senza piazzamento
  var perAtleta = {};
  function atletaId() { var m = (location.pathname + location.hash).match(/\/atleta\/([^\/?#]+)/); return m ? decodeURIComponent(m[1]) : null; }
  function nomeGara(r) {
    var g = (typeof globalData !== 'undefined' && globalData && globalData.calendar || []).filter(function (c) { return c.id === r.gara_id; })[0];
    var res = !g && (typeof globalData !== 'undefined' && globalData && globalData.resultsRaw || []).filter(function (c) { return c.gara_id === r.gara_id; })[0];
    if (g) return g.nome || g.nome_gara; if (res) return res.nome_gara;
    var n = String(r.gara_id || '').replace(/_\d{4}-\d{2}-\d{2}.*$/, '');
    if (/^\d+_/.test(n) || /^\d+$/.test(n)) n = String(r.source_event || '').replace(/-/g, ' ');
    return n.replace(/_/g, ' ').toUpperCase();
  }
  function decorateAthlete() {
    var id = atletaId(), host = document.getElementById('ap-cards'); if (!id || !host) return;
    var old = document.getElementById('sl-athlete'); if (old && old.getAttribute('data-id') === id) return; if (old) old.remove();
    if (perAtleta[id] === undefined) {
      perAtleta[id] = null;
      fetch(apiBase() + '/startlists/atleta/' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : { righe: [] }; })
        .then(function (d) { perAtleta[id] = d.righe || []; decorateAthlete(); }).catch(function () { delete perAtleta[id]; });
      return;
    }
    var rr = perAtleta[id]; if (!rr || !rr.length) return;
    var by = {}; rr.forEach(function (r) { var x = by[r.gara_id] || (by[r.gara_id] = r); if (r.kind === 'partenti') by[r.gara_id] = r; else by[r.gara_id] = x; });
    var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return String(b.race_date).localeCompare(String(a.race_date)); });
    var sec = document.createElement('section'); sec.id = 'sl-athlete'; sec.className = 'apc apc-wide'; sec.setAttribute('data-id', id);
    sec.innerHTML = '<div class="apc-h"><h3>Gare in elenco (' + list.length + ')</h3></div><p class="apc-sub">Iscritto o partente, con o senza piazzamento · fonte SegreteriaGare.it</p><div class="results-table-wrap"><table class="results-table"><thead><tr><th>DATA</th><th>GARA</th><th>ELENCO</th></tr></thead><tbody>' +
      list.map(function (r) {
        var d = String(r.race_date || '').split('-');
        return '<tr><td class="td-date">' + esc(d[2] + '/' + d[1] + '/' + d[0]) + '</td><td class="td-race"><a href="#/gara/' + encodeURIComponent(r.gara_id) + '">' + esc(nomeGara(r)) + '</a></td><td>' + (r.kind === 'partenti' ? 'Partente' : 'Iscritto') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    host.parentNode.insertBefore(sec, host.nextSibling);
  }
  function init() { new MutationObserver(function () { clearTimeout(init._t); init._t = setTimeout(function () { decorate(); decorateAthlete(); }, 80); }).observe(document.body, { childList: true, subtree: true }); decorate(); decorateAthlete(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
