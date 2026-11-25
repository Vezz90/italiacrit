/* Iscritti e Partenti nelle pagine gara (da SegreteriaGare): due schede prima dell'Albo d'oro, solo se la gara ha un elenco. */
(function () {
  'use strict';
  var cache = {}, busy = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function garaId() { var m = (location.pathname + location.hash).match(/\/gara\/([^\/?#]+)/); return m ? decodeURIComponent(m[1]) : null; }
  function apiBase() { return (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : 'https://italiacrit.onrender.com/api'; }
  // ── Elenco a riquadri per squadra (stile start list) ──
  var NAT = { ITA: 'it', SUI: 'ch', SLO: 'si', NED: 'nl', GER: 'de', FRA: 'fr', ESP: 'es', GBR: 'gb', BEL: 'be', AUT: 'at', POL: 'pl', UKR: 'ua', CZE: 'cz', SVK: 'sk', CRO: 'hr', HUN: 'hu', ROU: 'ro', POR: 'pt', IRL: 'ie', NOR: 'no', LUX: 'lu', LTU: 'lt', LAT: 'lv', BLR: 'by', RUS: 'ru', GRE: 'gr', ALB: 'al', BIH: 'ba', SMR: 'sm', USA: 'us', CAN: 'ca', MEX: 'mx', COL: 'co', VEN: 've', BRA: 'br', AUS: 'au', NZL: 'nz', JPN: 'jp', KAZ: 'kz', RSA: 'za', ETH: 'et', CPV: 'cv' };
  var LOGO_SG = '<img class="sl-logo" src="/assets/logo-segreteriagare.png" alt="SegreteriaGare.it" width="139" height="44">';
  var COLORI = ['#e8001d', '#1565c0', '#2e7d32', '#f59e0b', '#6a1b9a', '#00838f', '#ad1457', '#37474f', '#ef6c00', '#283593'];
  function flag(nat) { var c = NAT[nat || 'ITA']; return c ? '<img src="https://flagcdn.com/16x12/' + c + '.png" width="16" height="12" alt="' + esc(nat || 'ITA') + '" loading="lazy">' : '<i></i>'; }
  // I nomi squadra letti dai PDF hanno spesso code: regione tra parentesi, sigla di categoria o nazione, trattini
  var CODA = /\s+(?:ES[12]?|AL|JU|UN|EL|DJ|DA|DU|DE|ED|U23|ITA|NED|CZE|SUI|SLO|FRA|GBR|GER|ESP|BEL|AUT|POL|UKR|LAT|MEX|RSM)$/;
  function pulisci(n) {
    var s = String(n || '').replace(/\s+\d+\s+[A-Z]{3}\s+NAZIONALE.*$/, '');
    if (/\b(?:ES[12]?|AL|JU|UN|EL)\s+\d{1,3}\s+[A-Z']{3,}/.test(s)) return '';   // riga letta male: contiene altri corridori
    s = s.replace(/\([^)]*\)/g, ' ').replace(/\([^)]*$/, ' ').replace(/\b\d \d\b/g, ' ').replace(/\s+\d{1,3}\s+[A-Z']{3,}\s+[A-Z']{3,}$/, '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(?:(?:ES[12]?|AL|JU|UN|EL)\s+)+/, '');
    var prima; do { prima = s; s = s.replace(/[\s\-–]+$/, '').replace(CODA, ''); } while (s !== prima);
    return s.length > 2 ? s : '';
  }
  function chiave(s) { return String(s || '').replace(/\./g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(function (w) { return w && w !== 'ASD' && w !== 'SSD'; }).join(''); }
  function parole(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).sort().join(' '); }
  function gd(k) { return (typeof globalData !== 'undefined' && globalData && globalData[k]) || {}; }
  // stessa squadra solo se i nomi coincidono davvero (non basta una parola come "AVIS" o un termine generico)
  var GENERICHE = /^(ASD|SSD|USD|POL|TEAM|CLUB|GRUPPO|SPORTIVO|SPORTIVA|SPORT|SPORTING|UNIONE|CICLISMO|CICLISTICA|CICLISTICO|CICLI|CYCLING|BIKE|MTB|RACING|PEDALE|VELO|ACADEMY|SQUADRA|CORSE|SCUOLA|POLISPORTIVA|COSTRUZIONI|DEL|DELLA|SAN|SANTA|TOSCANA|VENETO|EMILIA|ROMAGNA|LOMBARDIA|UMBRIA|LAZIO|LIGURIA|PIEMONTE|MARCHE|FRIULI|TRENTINO)$/;
  function distintive(s) { return parole(String(s || '').replace(/\([^)]*\)?/g, ' ')).split(' ').filter(function (w) { return w.length > 2 && !GENERICHE.test(w) && !/^\d+$/.test(w); }); }
  function stessaSquadra(a, b) {
    var ca = chiave(pulisci(a) || a), cb = chiave(b);
    if (ca.length > 5 && cb.length > 5 && (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0)) return true;
    var pa = distintive(a), pb = distintive(b), com = pa.filter(function (w) { return pb.indexOf(w) >= 0; });
    return com.length >= 2 || (com.length === 1 && (Math.min(pa.length, pb.length) === 1 || com[0].length >= 8));
  }
  function squadreSito() {
    var m = {}, t = gd('teams');
    Object.keys(t).forEach(function (id) { var k = chiave(t[id].nome); if (k && !m[k]) m[k] = id; });
    return m;
  }
  function atletiSito() {   // nome (parole in qualsiasi ordine) -> scheda, solo se e' una sola
    var m = {}, a = gd('athletes');
    Object.keys(a).forEach(function (id) { var k = parole(id.replace(/_/g, ' ')); m[k] = k in m ? '' : id; });
    return m;
  }
  function elenco(rows, tipo) {
    if (!rows.length) return '<div class="empty-state">Nessun elenco disponibile</div>';
    var sito = squadreSito(), teams = gd('teams'), atleti = gd('athletes'), nomi = atletiSito(), gruppi = {}, daScheda = 0;
    var senzaNome = [];
    // un riquadro per ogni squadra scritta nell'elenco: mai unire squadre con nomi diversi
    rows.forEach(function (r) {
      var scritto = String(r.team_name || ''), nome = pulisci(scritto);
      var aid = r.athlete_id || nomi[parole(r.athlete_name)] || '', a = atleti[aid];
      var scheda = a && a.team_id && teams[a.team_id] ? a.team_id : '';
      var x = { bib: r.bib, athlete_name: r.athlete_name, nat: r.nat, aid: aid, presa: false };
      if (!nome) { senzaNome.push({ x: x, scheda: scheda }); return; }
      // pagina della squadra: nome identico nel sito, oppure quella (compatibile col nome) che ha il corridore o la riga
      var id = sito[chiave(nome)] || '';
      if (!id && scheda && stessaSquadra(scritto, teams[scheda].nome)) id = scheda;
      if (!id && r.team_id && teams[r.team_id] && stessaSquadra(scritto, teams[r.team_id].nome)) id = r.team_id;
      var k = chiave(nome);
      var g = gruppi[k] || (gruppi[k] = { id: '', scritto: nome, voti: {}, atleti: [] });
      if (id) g.voti[id] = (g.voti[id] || 0) + 1;
      g.atleti.push(x);
    });
    var unisci = function (da, a) { gruppi[a].atleti = gruppi[a].atleti.concat(gruppi[da].atleti); Object.keys(gruppi[da].voti).forEach(function (i) { gruppi[a].voti[i] = (gruppi[a].voti[i] || 0) + gruppi[da].voti[i]; }); delete gruppi[da]; };
    var scelta = function (g) { return Object.keys(g.voti).sort(function (x, y) { return g.voti[y] - g.voti[x]; })[0] || ''; };
    // la stessa squadra scritta in due modi: stessa pagina squadra, oppure un nome che e' l'inizio dell'altro
    Object.keys(gruppi).sort(function (x, y) { return gruppi[y].atleti.length - gruppi[x].atleti.length; }).forEach(function (k) {
      if (!gruppi[k]) return;
      Object.keys(gruppi).forEach(function (j) {
        if (j === k || !gruppi[j] || !gruppi[k]) return;
        var stessa = scelta(gruppi[k]) && scelta(gruppi[k]) === scelta(gruppi[j]);
        var inizio = j.length >= 12 && (k.indexOf(j) === 0 || j.indexOf(k) === 0);
        if (stessa || inizio) unisci(j, k);
      });
    });
    Object.keys(gruppi).forEach(function (k) { var g = gruppi[k]; g.id = scelta(g); g.nome = (g.id && teams[g.id] && teams[g.id].nome) || g.scritto; });
    // elenco senza squadra: quella della scheda dell'atleta (segnata con l'asterisco)
    senzaNome.forEach(function (v) {
      var k = '~';
      if (v.scheda) {
        v.x.presa = true; daScheda++;
        k = Object.keys(gruppi).filter(function (j) { return gruppi[j].id === v.scheda; })[0] || v.scheda;
      }
      var g = gruppi[k] || (gruppi[k] = { id: v.scheda, nome: v.scheda ? teams[v.scheda].nome : '', atleti: [] });
      g.atleti.push(v.x);
    });
    var num = function (r) { return r.bib == null ? 9999 : +r.bib; };
    var lista = Object.keys(gruppi).map(function (k) { var g = gruppi[k]; g.k = k; g.atleti.sort(function (a, b) { return num(a) - num(b); }); return g; })
      .sort(function (a, b) { return (a.k === '~') - (b.k === '~') || num(a.atleti[0]) - num(b.atleti[0]); });
    var nSq = lista.filter(function (g) { return g.k !== '~'; }).length;
    var riga = function (r) {
      var n = esc(r.athlete_name), stella = r.presa ? '<sup title="Squadra presa dalla scheda atleta">*</sup>' : '';
      return '<li><b>' + esc(r.bib) + '</b>' + flag(r.nat) + (r.aid ? '<a href="#/atleta/' + encodeURIComponent(r.aid) + '">' + n + stella + '</a>' : '<span>' + n + '</span>') + '</li>';
    };
    var card = function (g) {
      var h = 0; for (var i = 0; i < g.k.length; i++) h = (h * 31 + g.k.charCodeAt(i)) >>> 0;
      var senza = g.k === '~', titolo = senza ? 'Squadra non indicata' : esc(g.nome);
      return '<section class="sl-team' + (senza ? ' sl-noteam' : '') + '" style="--sl-c:' + (senza ? '#9aa4b2' : COLORI[h % COLORI.length]) + '"><h4>' + (g.id ? '<a href="#/team/' + encodeURIComponent(g.id) + '">' + titolo + '</a>' : titolo) + '</h4><ul>' + g.atleti.map(riga).join('') + '</ul></section>';
    };
    var nota = daScheda ? '<p class="sl-nota">* L’elenco non riporta la squadra: è quella della scheda dell’atleta.</p>' : '';
    return '<div class="sl-sum"><strong>' + rows.length + '</strong> ' + tipo + (nSq ? ' · <strong>' + nSq + '</strong> squadre' : '') + '<span>fonte ' + LOGO_SG + '</span></div><div class="sl-grid">' + lista.map(card).join('') + '</div>' + nota;
  }
  function stile() {
    if (document.getElementById('sl-style')) return;
    var st = document.createElement('style'); st.id = 'sl-style';
    st.textContent = '.sl-nota{font-size:.75rem;color:var(--text-muted);margin:10px 0 0}.sl-sum{font-size:.85rem;color:var(--text-muted);margin:10px 0 14px}.sl-sum strong{color:var(--text-primary)}.sl-sum span{float:right;font-size:.75rem;display:inline-flex;align-items:center;gap:6px;margin-top:-14px}.sl-logo{height:44px;width:auto;vertical-align:middle;background:#fff;border-radius:6px;padding:2px 4px}' +
      '.sl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}' +
      '.sl-team{background:var(--bg-card,#fff);border:1px solid var(--border-subtle,#dde2ea);border-top:3px solid var(--sl-c);border-radius:6px;overflow:hidden;min-width:0}' +
      '.sl-noteam{grid-column:1/-1}.sl-noteam ul{columns:3 220px;column-gap:24px}' +
      '.sl-team h4{margin:0;padding:8px 10px;font-size:.82rem;line-height:1.25;border-bottom:1px solid var(--border-subtle,#dde2ea)}' +
      '.sl-team h4 a{color:var(--text-primary);text-decoration:none}.sl-team h4 a:hover{text-decoration:underline}' +
      '.sl-team ul{list-style:none;margin:0;padding:6px 10px 8px}' +
      '.sl-team li{display:flex;align-items:center;gap:7px;padding:3px 0;font-size:.83rem;break-inside:avoid;min-width:0}' +
      '.sl-team li b{min-width:26px;text-align:right;font-weight:600;font-size:.75rem;color:var(--text-muted);font-variant-numeric:tabular-nums}' +
      '.sl-team li img,.sl-team li i{width:16px;height:12px;border-radius:2px;flex:none}' +
      '.sl-team li a,.sl-team li span{color:var(--text-primary);text-decoration:none;min-width:0;overflow-wrap:anywhere;line-height:1.25}.sl-team li a{font-weight:600}.sl-team li a:hover{text-decoration:underline;color:var(--accent,#e8001d)}';
    document.head.appendChild(st);
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
        b.textContent = (x[0] === 'iscritti' ? '📝 ' : '🏁 ') + x[1];
        b.onclick = function () { window._switchGaraTab(x[0]); };
        albo.parentNode.insertBefore(b, albo);
        var p = document.createElement('div'); p.id = 'sl-panel-' + x[0]; p.style.display = 'none'; p.style.marginTop = '8px';
        stile(); p.innerHTML = elenco(x[2], x[0]);
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
    var rr = perAtleta[id]; if (!rr || !rr.length) return; stile();
    var by = {}; rr.forEach(function (r) { var x = by[r.gara_id] || (by[r.gara_id] = r); if (r.kind === 'partenti') by[r.gara_id] = r; else by[r.gara_id] = x; });
    var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return String(b.race_date).localeCompare(String(a.race_date)); });
    var sec = document.createElement('section'); sec.id = 'sl-athlete'; sec.className = 'apc apc-wide'; sec.setAttribute('data-id', id);
    sec.innerHTML = '<div class="apc-h"><h3>Gare in elenco (' + list.length + ')</h3></div><p class="apc-sub">Iscritto o partente, con o senza piazzamento · fonte ' + LOGO_SG + '</p><div class="results-table-wrap"><table class="results-table"><thead><tr><th>DATA</th><th>GARA</th><th>ELENCO</th></tr></thead><tbody>' +
      list.map(function (r) {
        var d = String(r.race_date || '').split('-');
        return '<tr><td class="td-date">' + esc(d[2] + '/' + d[1] + '/' + d[0]) + '</td><td class="td-race"><a href="#/gara/' + encodeURIComponent(r.gara_id) + '">' + esc(nomeGara(r)) + '</a></td><td>' + (r.kind === 'partenti' ? 'Partente' : 'Iscritto') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    host.parentNode.insertBefore(sec, host.nextSibling);
  }
  function init() { new MutationObserver(function () { clearTimeout(init._t); init._t = setTimeout(function () { decorate(); decorateAthlete(); }, 80); }).observe(document.body, { childList: true, subtree: true }); decorate(); decorateAthlete(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
