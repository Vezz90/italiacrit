/* Scheda "Forma" del profilo atleta: in quali mesi rende di piu', su tutto lo storico (ICS + ciclismo.info + PCS).
   Il server (/api/atleta/:id/forma) restituisce le righe gia' unite senza doppioni; qui si calcola e si disegna.
   Riga: [data, posizione, categoria, nome gara, fonte ('I' nostri dati, 'IP' in entrambi, 'P' solo PCS), paese] */
(function () {
  'use strict';
  var PTS = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
  var MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  var MESI_L = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  var CAT = { ESORDIENTI1: 'Esord. 1', ESORDIENTI2: 'Esord. 2', ALLIEVI: 'Allievi', JUNIORES: 'Juniores', ELITE_UNDER23: 'Elite/U23' };
  var MIN_RISULTATI = 15, MIN_STAGIONI = 2;
  var state = { pro: {}, rows: null, mode: 'all', id: null, cat: 'all', base: null };
  var basePromise = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) { return (Math.round(n * 10) / 10).toString().replace('.', ','); }
  function ris(n) { return n + (n === 1 ? ' risultato' : ' risultati'); }
  function catName(c) {
    if (CAT[c]) return CAT[c];
    var s = String(c || '');
    if (/elite|u23|under/i.test(s)) return 'Elite/U23';
    if (/junior/i.test(s)) return 'Juniores';
    if (/allie/i.test(s)) return 'Allievi';
    if (/esord/i.test(s)) return /2/.test(s) ? 'Esord. 2' : /1/.test(s) ? 'Esord. 1' : 'Esordienti';
    return '';
  }

  var GRP_L = { ES: 'Esordienti', AL: 'Allievi', JU: 'Juniores', EL: 'Elite/U23', PR: 'Professionisti' };
  var GRP_ORDER = ['ES', 'AL', 'JU', 'EL', 'PR'];
  function grpOf(c) {
    var s = String(c || '');
    if (!s) return '';
    if (/elite|u23|under|^ELI_/i.test(s)) return 'EL';
    if (/junior|^JUN_/i.test(s)) return 'JU';
    if (/allie|^AL\d?_/i.test(s)) return 'AL';
    if (/esord|^ES\d?_/i.test(s)) return 'ES';
    return '';
  }
  // Aggiunge a ogni riga il gruppo di categoria (indice 6). Le righe solo-PCS non hanno categoria: prendono quella dell'anno
  // (la piu' frequente tra le righe con categoria); se l'anno non ne ha, quella dell'anno vicino piu' prossimo.
  // il nome gara PCS porta la categoria ("World Championships WJ - Road Race"): MJ/WJ = Juniores, MU/WU = Under 23
  function grpFromName(n) { var s = String(n || ''); if (/\b[MW]J\b/.test(s)) return 'JU'; if (/\b[MW]U\b/.test(s)) return 'EL'; return ''; }
  function withGroups(rows) {
    var cnt = {}, pro = state.pro || {};
    rows.forEach(function (x) {
      var g = grpOf(x[2]); if (!g) return;
      var y = x[0].slice(0, 4); (cnt[y] = cnt[y] || {})[g] = (cnt[y][g] || 0) + 1;
    });
    var yg = {};
    Object.keys(cnt).forEach(function (y) { var best = '', n = 0; Object.keys(cnt[y]).forEach(function (g) { if (cnt[y][g] > n) { n = cnt[y][g]; best = g; } }); yg[y] = best; });
    var known = Object.keys(yg).map(Number).sort(function (a, b) { return a - b; });
    function near(y) {
      if (yg[y]) return yg[y];
      var bestD = 99, g = '';
      known.forEach(function (k) { var d = Math.abs(k - y); if (d < bestD) { bestD = d; g = yg[k]; } });
      return g;
    }
    // anni in squadra WorldTour/ProTeam: le righe PCS (senza categoria) sono da professionista; nel passaggio da under 23 le righe con categoria restano Elite/U23
    return rows.map(function (x) { var yy = +x[0].slice(0, 4); return x.slice(0, 6).concat([grpOf(x[2]) || (x[4] === 'P' ? grpFromName(x[3]) : '') || (pro[yy] ? 'PR' : near(yy))]); });
  }
  // Testo della "forma di adesso": percentuale se il confronto ha una base solida, altrimenti differenza in punti (le percentuali su pochi punti ingannano)
  function formaTxt(a) {
    if (!a.nPrev) return { t: '—', cls: '' };
    if (a.avgP >= 15) return { t: (a.diff >= 0 ? '+' : '') + a.diff + '%', cls: a.diff >= 0 ? 'fm-up' : 'fm-down' };
    var d = Math.round(a.nowW.tot - a.avgP);
    return { t: (d >= 0 ? '+' : '') + d + (Math.abs(d) === 1 ? ' punto' : ' punti'), cls: d >= 0 ? 'fm-up' : 'fm-down' };
  }

  function analyze(all, mode) {
    var TODAY = new Date(), Y0 = TODAY.getFullYear(), M0 = TODAY.getMonth();
    var rows = all.filter(function (x) { return mode === 'all' || x[4] !== 'P'; });
    if (!rows.length) return null;
    // anni "coperti da PCS": li' conosciamo TUTTE le gare (anche oltre il 10 posto), non solo la top 10
    var pcsYear = {};
    all.forEach(function (x) { if (x[4] !== 'I') { var yy = +x[0].slice(0, 4); pcsYear[yy] = (pcsYear[yy] || 0) + 1; } });
    var covered = {};
    if (mode === 'all') Object.keys(pcsYear).forEach(function (yy) { if (pcsYear[yy] >= 3) covered[yy] = true; });
    var cells = {}, years = {};
    rows.forEach(function (x) {
      var y = +x[0].slice(0, 4), m = +x[0].slice(5, 7) - 1, k = y + '-' + m, pos = x[1];
      var c = cells[k] || (cells[k] = { y: y, m: m, pts: 0, n: 0, top10: 0, pod: 0, w: 0, sumPos: 0, foreign: 0, cat: '' });
      c.pts += PTS[pos] || 0; c.n++; c.sumPos += pos; if (pos <= 10) c.top10++; if (pos <= 3) c.pod++; if (pos === 1) c.w++;
      if (x[5] && String(x[5]).toLowerCase() !== 'it') c.foreign++;
      if (x[2]) c.cat = x[2];
      years[y] = 1;
    });
    var ys = Object.keys(years).map(Number).sort(function (a, b) { return a - b; });
    var first = ys[0], last = ys[ys.length - 1];
    var ey = []; for (var y2 = first; y2 <= Math.max(last, Y0); y2++) ey.push(y2);
    var mon = MESI.map(function (_, m) {
      var pts = 0, el = 0, n = 0, top10 = 0, pod = 0, w = 0, fr = 0, ncov = 0, topCov = 0, sumPosCov = 0;
      ey.forEach(function (yy) {
        if (yy === Y0 && m > M0) return;
        el++;
        var c = cells[yy + '-' + m];
        if (!c) return;
        pts += c.pts; n += c.n; top10 += c.top10; pod += c.pod; w += c.w; fr += c.foreign;
        if (covered[yy]) { ncov += c.n; topCov += c.top10; sumPosCov += c.sumPos; }
      });
      return { m: m, avg: el ? pts / el : 0, el: el, n: n, top10: top10, pod: pod, w: w, fr: fr, ncov: ncov, topCov: topCov, posAvg: ncov ? sumPosCov / ncov : null };
    });
    var mean = mon.reduce(function (s, x) { return s + x.avg; }, 0) / 12 || 1;
    mon.forEach(function (x) { x.idx = Math.round(100 * x.avg / mean); });
    var cand = mon.filter(function (x) { return x.el >= 2 && x.top10 >= 4; }).sort(function (a, b) { return b.avg - a.avg; });
    var gold = cand[0] || null;
    // forma di adesso: ultimi 45 giorni contro la stessa finestra negli anni precedenti
    var W = 45, end = new Date(); end.setHours(0, 0, 0, 0);
    function win(e) {
      var s = new Date(e); s.setDate(s.getDate() - W);
      var tot = 0, n = 0, sp = 0;
      rows.forEach(function (x) { var d = new Date(x[0] + 'T00:00:00'); if (d > s && d <= e) { tot += PTS[x[1]] || 0; n++; sp += x[1]; } });
      return { tot: tot, n: n, pos: n ? sp / n : null };
    }
    var nowW = win(end), prevPts = [], prevPos = [];
    ey.forEach(function (yy) {
      if (yy >= Y0) return;
      var e2 = new Date(end); e2.setFullYear(yy);
      var w2 = win(e2); prevPts.push(w2.tot);
      if (covered[yy] && w2.pos !== null) prevPos.push(w2.pos);
    });
    var avgP = prevPts.length ? prevPts.reduce(function (a, b) { return a + b; }, 0) / prevPts.length : 0;
    var avgPos = prevPos.length ? prevPos.reduce(function (a, b) { return a + b; }, 0) / prevPos.length : null;
    var maxCell = 0; Object.keys(cells).forEach(function (k) { maxCell = Math.max(maxCell, cells[k].pts); });
    var tot = rows.length, wins = rows.filter(function (x) { return x[1] === 1; }).length, pod = rows.filter(function (x) { return x[1] <= 3; }).length;
    var pcsOnly = all.filter(function (x) { return x[4] === 'P'; });
    var fOnly = pcsOnly.filter(function (x) { return x[5] && String(x[5]).toLowerCase() !== 'it'; }).length;
    return { Y0: Y0, M0: M0, cells: cells, ey: ey, first: first, last: last, mon: mon, gold: gold, nowW: nowW, avgP: avgP, avgPos: avgPos, maxCell: maxCell,
      tot: tot, wins: wins, pod: pod, mean: mean, covered: covered, pcsOnly: pcsOnly.length, fOnly: fOnly, icsN: all.length - pcsOnly.length, hasPcs: Object.keys(pcsYear).length > 0,
      nPrev: prevPts.length, diff: avgP ? Math.round(100 * (nowW.tot - avgP) / avgP) : null };
  }

  function heat(a) {
    var h = '<table class="fm-heat"><thead><tr><th></th>' + MESI.map(function (m) { return '<th>' + m + '</th>'; }).join('') + '</tr></thead><tbody>';
    // con una categoria scelta restano solo gli anni in cui ha davvero risultati in quella categoria (niente righe vuote degli altri anni)
    var yrs = a.ey;
    if (state.cat !== 'all') yrs = yrs.filter(function (y) { for (var m = 0; m < 12; m++) if (a.cells[y + '-' + m]) return true; return false; });
    yrs.forEach(function (y) {
      var catLbl = '';
      for (var m = 0; m < 12; m++) { var c = a.cells[y + '-' + m]; if (c && c.cat) catLbl = catName(c.cat); }
      if (!catLbl && state.pro && state.pro[y]) catLbl = 'Professionisti';
      h += '<tr><th class="fm-y">' + y + '<span class="fm-cat">' + esc(catLbl) + (a.covered[y] ? ' · tutte le gare' : '') + '</span></th>';
      for (var m2 = 0; m2 < 12; m2++) {
        if (y === a.Y0 && m2 > a.M0) { h += '<td class="fm-fut">·</td>'; continue; }
        var c2 = a.cells[y + '-' + m2];
        if (!c2) { h += '<td class="fm-k0">–</td>'; continue; }
        var rr = a.maxCell ? c2.pts / a.maxCell : 0, k = c2.pts === 0 ? 'z' : rr > .66 ? 4 : rr > .4 ? 3 : rr > .2 ? 2 : 1;
        var lbl = a.covered[y] ? c2.n + (c2.n === 1 ? ' gara' : ' gare') : c2.n + ' top10';
        h += '<td class="fm-k' + k + '" title="' + MESI_L[m2] + ' ' + y + ': ' + c2.n + (a.covered[y] ? ' gare disputate' : ' risultati nei primi 10') + ', ' + c2.top10 + ' nei primi 10, ' + c2.pod + ' podi, ' + c2.w + ' vittorie' + (c2.foreign ? ', ' + c2.foreign + ' all\'estero' : '') + ', posizione media ' + fmt(c2.sumPos / c2.n) + '">'
          + c2.pts + '<small>' + lbl + '</small>' + (c2.w ? '<span class="fm-w">★' + (c2.w > 1 ? c2.w : '') + '</span>' : '') + (c2.foreign ? '<span class="fm-ft">🌍</span>' : '') + '</td>';
      }
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  function bars(a, rl) {
    var max = Math.max.apply(null, a.mon.map(function (x) { return x.avg; }).concat(rl ? rl.exp : [])) || 1;
    var h = '<div class="fm-bars">';
    a.mon.forEach(function (x) {
      var isGold = a.gold && a.gold.m === x.m;
      h += '<div class="fm-bar' + (isGold ? ' fm-gold' : '') + '" title="' + MESI_L[x.m] + ': ' + fmt(x.avg) + ' punti in media per anno' + (rl ? ' (per la sua categoria ci si aspetterebbe ' + fmt(rl.exp[x.m]) + ')' : '') + '"><b>' + (x.avg ? fmt(x.avg) : '') + '</b><i style="height:' + Math.round(100 * x.avg / max * 0.82) + '%"></i>'
        + (rl ? '<u class="fm-exp" style="bottom:' + Math.round(100 * rl.exp[x.m] / max * 0.82) + '%"></u>' : '') + '</div>';
    });
    h += '<div class="fm-avgline" style="bottom:' + Math.round(100 * a.mean / max * 0.82) + '%"><span>media mensile ' + fmt(a.mean) + '</span></div></div>';
    return h + '<div class="fm-labels">' + MESI.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>';
  }

  function table(a, rl) {
    var anyCov = Object.keys(a.covered).length > 0;
    var h = '<div class="fm-scroll"><table class="fm-mt"><thead><tr><th>Mese</th><th>Punti medi / anno</th><th>Indice</th>' + (rl ? '<th>vs categoria</th>' : '')
      + (anyCov ? '<th>Gare disputate</th><th>% top 10</th><th>Pos. media</th>' : '<th>Risultati top 10</th>') + '<th>Podi</th><th>Vitt.</th><th>Estero</th></tr></thead><tbody>';
    a.mon.forEach(function (x) {
      if (!x.n) return;
      var cl = x.idx >= 130 ? 'hi' : x.idx <= 60 ? 'lo' : 'mid';
      var r = rl ? rl.rel[x.m] : null;
      h += '<tr' + (a.gold && a.gold.m === x.m ? ' class="fm-goldrow"' : '') + '><td>' + MESI_L[x.m] + '</td><td>' + fmt(x.avg) + '</td><td><span class="fm-idx fm-' + cl + '">' + x.idx + '</span></td>'
        + (rl ? '<td>' + (r === null ? '–' : relBadge(r)) + '</td>' : '')
        + (anyCov ? '<td>' + (x.ncov || '–') + '</td><td>' + (x.ncov ? Math.round(100 * x.topCov / x.ncov) + '%' : '–') + '</td><td>' + (x.posAvg !== null ? fmt(x.posAvg) + '°' : '–') + '</td>' : '<td>' + x.top10 + '</td>')
        + '<td>' + x.pod + '</td><td>' + x.w + '</td><td>' + (x.fr || '–') + '</td></tr>';
    });
    return h + '</tbody></table></div><p class="fm-small">Indice 100 = la sua media mensile (sopra 130 mese forte, sotto 60 debole).'
      + (rl ? ' «vs categoria» confronta i suoi punti del mese con quelli attesi da un corridore della sua categoria con lo stesso totale: ▲ sopra (oltre il 15% in più), ▼ sotto (oltre il 15% in meno), ＝ in linea.' : '')
      + (anyCov ? ' «Gare disputate», «% top 10» e «Pos. media» contano solo gli anni in cui PCS ci dà tutte le gare.' : '') + '</p>';
  }

  function paint(host) {
    var rowsG = withGroups(state.rows);
    var cntG = {}; rowsG.forEach(function (x) { cntG[x[6]] = (cntG[x[6]] || 0) + 1; });
    var present = GRP_ORDER.filter(function (g) { return cntG[g] >= 3; });
    if (state.cat !== 'all' && present.indexOf(state.cat) < 0) state.cat = 'all';
    var sel = state.cat === 'all' ? rowsG : rowsG.filter(function (x) { return x[6] === state.cat; });
    var catBar = present.length >= 2
      ? '<div class="fm-toggle" role="group" aria-label="Categoria"><button type="button" data-c="all" aria-pressed="' + (state.cat === 'all') + '">Tutte le categorie</button>'
        + present.map(function (g) { return '<button type="button" data-c="' + g + '" aria-pressed="' + (state.cat === g) + '">' + GRP_L[g] + '</button>'; }).join('') + '</div>'
      : '';
    var a = analyze(sel, state.mode);
    if (!a) { host.innerHTML = catBar + '<div class="fm-card">Nessun risultato per questa categoria.</div>'; bindCat(host); return; }
    var posLine = (a.nowW.pos !== null && a.avgPos !== null) ? '<br>Posizione media: <b>' + fmt(a.nowW.pos) + '°</b> (di solito in questo periodo ' + fmt(a.avgPos) + '°)' : '';
    var rl = relative(a, sel, isFemale(state.rows));
    var ft = formaTxt(a);
    var formCard = '<div class="fm-card"><h3>Forma di adesso</h3><div class="fm-big ' + ft.cls + '">' + ft.t + '</div>'
      + '<div class="fm-small">Ultimi 45 giorni: <b>' + a.nowW.tot + ' punti</b> (' + ris(a.nowW.n) + ')<br>Stesso periodo negli anni scorsi: ' + fmt(a.avgP) + ' punti in media' + posLine + '</div></div>';
    var goldCard = a.gold
      ? '<div class="fm-card"><h3>Il suo mese d\'oro</h3><div class="fm-big fm-accent">' + MESI_L[a.gold.m] + '</div><div class="fm-small">' + fmt(a.gold.avg) + ' punti in media per anno · ' + a.gold.w + ' vittorie e ' + a.gold.pod + ' podi in ' + a.gold.el + ' stagioni</div></div>'
      : '<div class="fm-card"><h3>Il suo mese d\'oro</h3><div class="fm-big">—</div><div class="fm-small">Dati ancora troppo pochi</div></div>';
    var distCard = (rl && rl.best)
      ? '<div class="fm-card"><h3>Dove si distingue</h3><div class="fm-big fm-accent">' + MESI_L[rl.best.m] + '</div><div class="fm-small"><span class="fm-rel fm-ra">▲</span> In quel mese rende più di quanto fanno gli altri della sua categoria a parità di totale (' + (rl.best.r >= 2 ? 'più del doppio' : '+' + Math.round((rl.best.r - 1) * 100) + '%') + ')</div></div>'
      : (rl ? '<div class="fm-card"><h3>Dove si distingue</h3><div class="fm-big">—</div><div class="fm-small">Nessun mese si stacca in modo netto dalla sua categoria</div></div>' : '');
    var srcTxt = a.hasPcs
      ? a.icsN + ' da ICS/ciclismo.info + <b>' + a.pcsOnly + ' solo PCS</b> (' + (a.pcsOnly - a.fOnly) + ' in Italia, ' + a.fOnly + ' all\'estero)'
      : 'solo ICS/ciclismo.info: nessun dato PCS per questo corridore';
    var carCard = '<div class="fm-card"><h3>Carriera nei dati</h3><div class="fm-big">' + a.first + '–' + a.last + '</div><div class="fm-small">' + a.tot + ' risultati · ' + a.pod + ' podi · ' + a.wins + ' vittorie<br>' + srcTxt + '</div></div>';
    host.innerHTML = catBar + '<div class="fm-grid">' + goldCard + formCard + distCard + carCard + '</div>'
      + '<div class="fm-card fm-section"><h2>Anno per anno, mese per mese</h2><p class="fm-small">Punti nel mese (scala base del sito) e numero di gare. ★ = vittoria · 🌍 = almeno un risultato all\'estero. Il colore è relativo al suo mese migliore; «0» = ha corso ma mai nei primi 10.</p><div class="fm-scroll">' + heat(a) + '</div></div>'
      + '<div class="fm-card fm-section"><h2>Quando rende di più</h2><p class="fm-small">Punti medi per ogni anno di attività. In arancione il mese d\'oro; la linea tratteggiata è la sua media mensile.' + (rl ? ' Il trattino scuro su ogni barra è quanto farebbe in quel mese un corridore della sua categoria con lo stesso totale: barra sopra il trattino = mese che lo distingue.' : '') + '</p>' + bars(a, rl) + table(a, rl) + '</div>'
      + '<p class="fm-note"><b>Come sono uniti i dati.</b> ICS/ciclismo.info (dal 2007) contiene solo i primi 10 di ogni gara. PCS aggiunge tutte le gare, anche all\'estero e oltre il 10° posto, ma solo per gli anni importati e per i corridori presenti su PCS. Dove PCS manca, un mese vuoto può voler dire «non ha corso» oppure «ha corso fuori dai primi 10». Le gare presenti in entrambe le fonti sono contate una volta sola. I punti sono quelli base del regolamento, indicativi per le gare fuori ICS.</p>';
    bindCat(host);
  }

  function isFemale(rows) { return rows.some(function (x) { return /donn/i.test(String(x[2] || '')); }); }
  // Quanto renderebbe in ogni mese un corridore con il suo stesso totale annuo che segue la stagionalita' della sua categoria
  // (da tutto lo storico): se lui supera quel valore, il mese e' davvero suo e non e' solo il mese in cui tutti fanno punti.
  function relative(a, sel, female) {
    if (!state.base || !state.base.shares) return null;
    var w = {}, tot = 0;
    sel.forEach(function (x) {
      var g = x[6], p = PTS[x[1]] || 0;
      if (!g || !p) return;
      var k = g + (female ? '_F' : '');
      if (!state.base.shares[k]) return;
      w[k] = (w[k] || 0) + p; tot += p;
    });
    if (!tot) return null;
    var mix = []; for (var m0 = 0; m0 < 12; m0++) mix.push(0);
    Object.keys(w).forEach(function (k) { var sh = state.base.shares[k]; for (var m = 0; m < 12; m++) mix[m] += (w[k] / tot) * sh[m]; });
    var T = a.mon.reduce(function (s, x) { return s + x.avg; }, 0);
    var exp = mix.map(function (v) { return T * v; });
    var rel = a.mon.map(function (x, m) { return (exp[m] > 0.4 && x.el >= 2) ? x.avg / exp[m] : null; });
    var best = null;
    a.mon.forEach(function (x, m) { if (rel[m] !== null && x.top10 >= 3 && x.avg >= 3 && (!best || rel[m] > best.r)) best = { m: m, r: rel[m] }; });
    return { exp: exp, rel: rel, best: best };
  }

  function relBadge(r) {
    var pct = Math.round((r - 1) * 100), tip = (pct > 0 ? '+' : '') + pct + '% rispetto alla sua categoria';
    if (r >= 1.15) return '<span class="fm-rel fm-ra" title="' + tip + '" aria-label="sopra la sua categoria">▲</span>';
    if (r <= 0.85) return '<span class="fm-rel fm-rb" title="' + tip + '" aria-label="sotto la sua categoria">▼</span>';
    return '<span class="fm-rel fm-rm" title="in linea con la sua categoria" aria-label="in linea con la sua categoria">＝</span>';
  }

  function bindCat(host) {
    Array.prototype.forEach.call(host.querySelectorAll('.fm-toggle button'), function (b) {
      b.onclick = function () { state.cat = b.dataset.c; paint(host); };
    });
  }

  function enough(rows) {
    if (!rows || rows.length < MIN_RISULTATI) return false;
    var ys = {}; rows.forEach(function (x) { ys[x[0].slice(0, 4)] = 1; });
    return Object.keys(ys).length >= MIN_STAGIONI;
  }

  // Chiamata da renderAtleta: scarica le righe, e se ce ne sono abbastanza mostra la scheda "Forma" e il richiamo nella scheda "Stagione".
  window.Forma = {
    mountAthlete: function (id) {
      state.id = id; state.rows = null; state.mode = 'all'; state.cat = 'all';
      var base = (typeof API_BASE !== 'undefined') ? API_BASE : '/api';
      if (!basePromise) basePromise = fetch(base + '/forma/baseline').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      return Promise.all([fetch(base + '/atleta/' + encodeURIComponent(id) + '/forma?v=2').then(function (r) { return r.ok ? r.json() : null; }), basePromise]).then(function (res) {
        var d = res[0]; state.base = res[1];
        if (state.id !== id || !d || !enough(d.rows)) return;
        state.rows = d.rows; state.pro = d.pro || {};
        var tab = document.getElementById('ath-tab-f'), host = document.getElementById('ath-forma');
        if (!tab || !host) return;
        tab.hidden = false;
        paint(host);
        var a = analyze(state.rows, 'all'), tz = document.getElementById('ath-forma-teaser');
        if (tz && a && a.gold) {
          tz.innerHTML = '<a class="fm-teaser" href="#" onclick="window._athTab(\'f\');return false;"><span>📅 Mese d\'oro: <b>' + MESI_L[a.gold.m] + '</b>'
            + (a.nPrev ? ' · forma di adesso <b class="' + formaTxt(a).cls + '">' + formaTxt(a).t + '</b> rispetto al solito' : '') + '</span><span class="fm-go">Vedi la scheda Forma ›</span></a>';
        }
      }).catch(function () {});
    }
  };
})();
