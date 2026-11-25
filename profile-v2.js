/* Scheda atleta v2 — i numeri in evidenza (Vittorie · Podi · 4°–10° · Punti/Gare · Posizione) in un riquadro a destra della testata,
   con due selettori: Strada | Ciclocross e Carriera | Stagione. Non riscrive la pagina: legge i valori già calcolati dalla testata
   esistente (che l'app continua ad aggiornare) e i totali di carriera calcolati da app.js (window._athCareer). */
(function () {
  'use strict';
  var T = null, SCOPE_KEY = 'ap-scope';

  function num(el) { var n = parseInt(String(el && el.textContent || '').replace(/[^\d-]/g, ''), 10); return isNaN(n) ? 0 : n; }
  function scope() { try { return localStorage.getItem(SCOPE_KEY) === 'stagione' ? 'stagione' : 'carriera'; } catch (e) { return 'carriera'; } }
  function setScope(v) { try { localStorage.setItem(SCOPE_KEY, v); } catch (e) {} }
  function isCx() { return document.body.classList.contains('disc-cx'); }
  function athId() { var m = location.pathname.match(/\/atleta\/([^/?#]+)/) || location.hash.match(/#\/atleta\/([^/?#]+)/); return m ? decodeURIComponent(m[1]) : ''; }
  function seg(k, items, cur) {
    return '<div class="ap-seg" role="group" data-k="' + k + '">' + items.map(function (i) { return '<button type="button" data-v="' + i[0] + '" aria-pressed="' + (i[0] === cur) + '">' + i[1] + '</button>'; }).join('') + '</div>';
  }

  function decorate(hero) {
    if (hero.dataset.ap) return;
    hero.dataset.ap = '1';
    hero.classList.add('ap');
    var grid = hero.querySelector('.ath-hero-grid'), aside = hero.querySelector('.ath-hero-standing');
    if (!grid || !aside) return;
    var box = document.createElement('div');
    box.className = 'ap-kpis-wrap';
    grid.appendChild(box);

    function refresh() {
      var sc = scope(), id = athId(), cx = isCx();
      var vals = aside.querySelectorAll('#atleta-stats-italia-bar .athlete-stat-val');
      var yrTxt = ((aside.querySelector('#atleta-stats-italia-label') || {}).textContent || '').match(/\d{4}/);
      var year = yrTxt ? yrTxt[0] : '';
      var w, s, b, o, c4v, c4l, pos, sub, foot;
      if (sc === 'carriera') {
        var c = (window._athCareer || {})[id + '|' + (cx ? 'cx' : 'road')];
        if (c) {
          w = c.p1; s = c.p2; b = c.p3; o = c.pout; c4v = c.n; c4l = 'Gare';
          sub = s + ' × 2° · ' + b + ' × 3°';
          foot = '<span class="ap-klbl">Carriera ' + (cx ? 'ciclocross' : 'strada') + (c.from ? ' · ' + (c.from === c.to ? c.from : c.from + '–' + c.to) : '') + '</span><span class="ap-note">Posizioni da tutte le fonti disponibili (FCI, ciclismo.info, PCS). Il ranking assoluto arriverà.</span>';
        } else { w = s = b = o = c4v = '…'; c4l = 'Gare'; sub = ''; foot = '<span class="ap-klbl">Carriera: calcolo in corso…</span>'; }
        pos = 'x';
      } else {
        w = num(vals[0]); s = num(vals[1]); b = num(vals[2]); o = num(vals[3]);
        c4v = String((aside.querySelector('#atleta-pts-value') || {}).textContent || '0').trim(); c4l = 'Punti';
        var posEl = aside.querySelector('.ath-rank-block .athlete-pts-value');
        pos = posEl ? posEl.textContent.trim() : '—';
        sub = s + ' × 2° · ' + b + ' × 3°';
        var gap = aside.querySelector('.ath-gap-line');
        foot = '<span class="ap-klbl">' + ((aside.querySelector('.ath-stand-lbl') || {}).textContent || '').replace(/</g, '&lt;') + '</span>' + (gap ? gap.outerHTML : '');
      }
      var podi = (typeof w === 'number') ? w + s + b : '…';
      var html =
        '<div class="ap-ctl">' +
        (typeof window.cxSetMode === 'function' && window.CX && window.CX.hasCx(id) === true && window.CX.hasRoad(id) === true ? seg('disc', [['strada', 'Strada'], ['ciclocross', 'Ciclocross']], cx ? 'ciclocross' : 'strada') : '') +
        seg('scope', [['carriera', 'Carriera'], ['stagione', 'Stagione' + (cx && window.CX && window.CX.season ? ' ' + window.CX.season() : (year ? ' ' + year : ''))]], sc) +
        '</div>' +
        '<div class="ap-kpis">' +
        '<div class="ap-k ap-gold"><b>' + w + '</b><span>Vittorie</span></div>' +
        '<div class="ap-k"><b>' + podi + '</b><span>Podi</span><i>' + sub + '</i></div>' +
        '<div class="ap-k"><b>' + o + '</b><span>4°–10°</span></div>' +
        '<div class="ap-k"><b>' + c4v + '</b><span>' + c4l + '</span></div>' +
        '<div class="ap-k ap-pos"><b>' + pos + '</b><span>Posizione</span></div>' +
        '</div>' +
        '<div class="ap-kfoot">' + foot + '</div>';
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    }
    box.addEventListener('click', function (e) {
      var bt = e.target.closest('.ap-seg button'); if (!bt) return;
      var k = bt.parentNode.getAttribute('data-k'), v = bt.getAttribute('data-v');
      if (k === 'scope') { setScope(v); refresh(); }
      else if (k === 'disc' && typeof window.cxSetMode === 'function' && (v === 'ciclocross') !== isCx()) window.cxSetMode(v, { force: true });
    });
    document.addEventListener('ics-career', function () { refresh(); fillCareer(); fillKey(); fillCards(); });
    document.addEventListener('ics-cx-ready', refresh);
    refresh();
    new MutationObserver(function () { refresh(); }).observe(aside, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-base'] });
  }


  // ── Scheda "Carriera": totali, grafico per anno (1° · 2° · 3° · 4°–10°) e tabella stagione per stagione ──
  function fillCareer() {
    var host = document.getElementById('atleta-career-stats'), mini = document.getElementById('atleta-career-mini');
    var putIn = function (el, h) { if (el && el.dataset.sig !== h) { el.dataset.sig = h; el.innerHTML = h; } };
    var put = function (h) { putIn(host, h); };
    if (!host && !mini) return;
    var id = athId(), cx = isCx();
    var c = (window._athCareer || {})[id + '|' + (cx ? 'cx' : 'road')];
    if (!c || !c.n) { put('<div class="ap-loading">' + (c ? 'Nessun piazzamento registrato.' : 'Statistiche di carriera in caricamento…') + '</div>'); return; }
    var ys = Object.keys(c.by).map(Number).sort(function (a, b) { return a - b; });
    var y0 = ys[0], y1 = ys[ys.length - 1], years = []; for (var y = y0; y <= y1; y++) years.push(y);
    var tot = function (b) { return b ? b.p1 + b.p2 + b.p3 + b.pout : 0; };
    var max = Math.max.apply(null, years.map(function (y) { return tot(c.by[y]); })) || 1;
    var W = 720, H = 220, pl = 30, pr = 8, pt = 12, pb = 28, bw = (W - pl - pr) / years.length;
    var COL = { p1: '#f5c542', p2: '#b8c0cc', p3: '#c98a4b', pout: '#5b7192' };
    var bars = years.map(function (y, i) {
      var b = c.by[y] || { p1: 0, p2: 0, p3: 0, pout: 0 }, x = pl + i * bw + bw * 0.14, w = bw * 0.72, yy = H - pb, g = '';
      ['p1', 'p2', 'p3', 'pout'].forEach(function (k) {
        var h = (b[k] / max) * (H - pt - pb); if (!h) return; yy -= h;
        g += '<rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + COL[k] + '"><title>' + y + ': ' + b[k] + ' × ' + (k === 'pout' ? '4°–10°' : k.slice(1) + '°') + '</title></rect>';
      });
      var lab = (years.length <= 14 || i % 2 === 0) ? '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="ap-tk">' + String(y).slice(2) + '</text>' : '';
      return g + lab;
    }).join('');
    var grid = [0, 0.5, 1].map(function (f) { var yy = H - pb - f * (H - pt - pb); return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" class="ap-grid"/><text x="' + (pl - 5) + '" y="' + (yy + 3) + '" text-anchor="end" class="ap-tk">' + Math.round(max * f) + '</text>'; }).join('');
    var legend = [['p1', '1°'], ['p2', '2°'], ['p3', '3°'], ['pout', '4°–10°']].map(function (l) { return '<span><i style="background:' + COL[l[0]] + '"></i>' + l[1] + '</span>'; }).join('');
    var rows = years.slice().reverse().filter(function (y) { return c.by[y]; }).map(function (y) {
      var b = c.by[y]; return '<tr><th>' + y + (cx ? '/' + String(y + 1).slice(2) : '') + '</th><td>' + b.n + '</td><td>' + b.p1 + '</td><td>' + b.p2 + '</td><td>' + b.p3 + '</td><td>' + b.pout + '</td></tr>';
    }).join('');
    var head = '<div class="ap-cs-head"><h3>Statistiche di carriera · ' + (cx ? 'ciclocross' : 'strada') + '</h3><span>' + y0 + (y1 > y0 ? '–' + y1 : '') + '</span></div>';
    var totHtml = '<div class="ap-cs-tot"><div><b>' + c.n + '</b><span>Gare</span></div><div><b>' + c.p1 + '</b><span>1°</span></div><div><b>' + c.p2 + '</b><span>2°</span></div><div><b>' + c.p3 + '</b><span>3°</span></div><div><b>' + c.pout + '</b><span>4°–10°</span></div></div>';
    var chartHtml = '<div class="ap-cs-chart"><div class="ap-cs-leg">' + legend + '</div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Piazzamenti per anno">' + grid + bars + '</svg></div>';
    putIn(mini, '<div class="ap-mini">' + head + totHtml + chartHtml + '<button type="button" class="ap-more" onclick="window._athTab(\'c\')">Tutte le stagioni ›</button></div>');
    put(
      '<div class="ap-cs-head"><h3>Statistiche di carriera · ' + (cx ? 'ciclocross' : 'strada') + '</h3><span>' + y0 + (y1 > y0 ? '–' + y1 : '') + '</span></div>' +
      '<div class="ap-cs-tot"><div><b>' + c.n + '</b><span>Gare</span></div><div><b>' + c.p1 + '</b><span>1°</span></div><div><b>' + c.p2 + '</b><span>2°</span></div><div><b>' + c.p3 + '</b><span>3°</span></div><div><b>' + c.pout + '</b><span>4°–10°</span></div></div>' +
      '<div class="ap-cs-chart"><div class="ap-cs-leg">' + legend + '</div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Piazzamenti per anno">' + grid + bars + '</svg></div>' +
      '<div class="ap-cs-table"><table><thead><tr><th>Stagione</th><th>Gare</th><th>1°</th><th>2°</th><th>3°</th><th>4°–10°</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="ap-note2">Piazzamenti dalle fonti disponibili (FCI, ciclismo.info, PCS), senza doppioni. Dove una gara non ha la classifica completa, i piazzamenti oltre il 3° possono mancare.</p>');
  }

  // celle senza valore ("—") nelle schede dei risultati su mobile: si nascondono
  function markNil() {
    document.querySelectorAll('.atleta-results tr[data-date] > td:nth-child(5):not([data-nil]), .atleta-results tr[data-date] > td:nth-child(6):not([data-nil]), #tm-panel-r tr[data-date] > td:nth-child(6):not([data-nil]), #tm-panel-r tr[data-date] > td:nth-child(7):not([data-nil])').forEach(function (td) {
      var t = td.textContent.trim(); td.dataset.nil = '1'; if (t === '' || t === '—' || t === '-') td.classList.add('ap-nil');
    });
  }


  // ── Risultati chiave: le gare vinte (o i podi) raggruppate per corsa, con conteggio e anni ──
  function fillKey() {
    var host = document.getElementById('atleta-key-results'); if (!host) return;
    var id = athId(), cx = isCx();
    var k = (window._athKey || {})[id + '|' + (cx ? 'cx' : 'road')];
    var html = '';
    if (k) {
      var items = k.w, title = 'Risultati chiave', sub = 'Vittorie';
      if (!items.length) { items = k.p2.concat(k.p3).sort(function (a, b) { return b.count - a.count; }).slice(0, 8); sub = 'Podi'; }
      if (items.length) {
        var esc2 = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
        var yy = function (ys) { return ys.map(function (y) { return cx ? y + '/' + String(+y + 1).slice(2) : y; }).join(' · '); };
        html = '<div class="ap-key"><div class="ap-key-head"><h3>' + title + '</h3><span>' + sub + '</span></div><div class="ap-key-grid">' +
          items.map(function (g) { return '<div class="ap-key-card"><b>' + g.count + '</b><div><strong>' + esc2(g.n) + '</strong><span>' + esc2(yy(g.years)) + '</span></div></div>'; }).join('') + '</div></div>';
      }
    }
    if (host.dataset.sig !== html) { host.dataset.sig = html; host.innerHTML = html; }
  }


  // ════════════════════════════════════════════════════════════════
  // Schede della Panoramica (stile CyclingDB): Stagione · Ultimi risultati · Statistiche di carriera · Vittorie per anno ·
  // Squadre · Posizione in classifica · Rivali frequenti. Tutti dati nostri (stesse fonti del resto della scheda).
  // ════════════════════════════════════════════════════════════════
  var MULT = { 1: 'Reg.le', 2: 'Naz.le', 3: 'Int.le' };
  var carrCache = null;
  function esc3(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function chipOf(r) {
    if (r.m && MULT[r.m]) return MULT[r.m];
    var m = String(r.n || '').match(/\(([12]\.(?:UWT|HC|Pro|Ncup|\d)|WC|CC|NC)\)/);
    return m ? m[1] : '';
  }
  function cleanName(n) { return esc3(String(n || '').replace(/_/g, ' ').replace(/\s*\((?:[12]\.[A-Za-z0-9]+|NAT|WC|CC|CM|NC)\)\s*/g, ' ').replace(/\s+/g, ' ').trim()); }
  function fmtD(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } }
  var TROPHY = function (col) { return '<svg class="apc-tr" viewBox="0 0 24 24" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/></svg>'; };
  var CHEV3 = '<svg class="apc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
  var ICONS = {
    win: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>',
    pod: '<path d="M3 21h18"/><rect x="9" y="6" width="6" height="15"/><rect x="2.5" y="12" width="6.5" height="9"/><rect x="15" y="14" width="6.5" height="7"/>',
    top: '<polygon points="12 2 15 9 22 9.5 16.5 14.5 18 22 12 18 6 22 7.5 14.5 2 9.5 9 9"/>',
    gar: '<path d="M4 4v17"/><path d="M4 5h13l-2 4 2 4H4"/>',
    sta: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
  };
  function ico(k) { return '<svg class="apc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + '</svg>'; }
  function rowLink(r, inner) {
    if (!r.h) return '<div class="apc-row">' + inner + '</div>';
    var ext = /^https?:/.test(r.h);
    return '<a class="apc-row" href="' + esc3(r.h) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + inner + '</a>';
  }
  function shown(p) { return p ? p : '—'; }
  function posCell(p) { return p === 1 ? '<span class="apc-pos apc-p1">1</span>' : p === 2 ? '<span class="apc-pos apc-p2">2</span>' : p === 3 ? '<span class="apc-pos apc-p3">3</span>' : '<span class="apc-pos">' + shown(p) + '</span>'; }


  // ── Ciambella: ripartizione dei piazzamenti (vittorie · podi · 4°–10° · oltre) ──
  var donutScope = 'car';
  function donutCard(rows, withScope, year) {
    var all = rows.filter(function (r) { return r.p; });
    var use = (withScope && donutScope === 'sta') ? all.filter(function (r) { return r.y === year; }) : all;
    if (!all.length) return '';
    var c = [use.filter(function (r) { return r.p === 1; }).length, use.filter(function (r) { return r.p === 2 || r.p === 3; }).length, use.filter(function (r) { return r.p >= 4 && r.p <= 10; }).length, use.filter(function (r) { return r.p > 10; }).length];
    var tot = c[0] + c[1] + c[2] + c[3];
    var COL = ['#e0a800', '#9aa4b2', '#e8601c', '#cdd3dc'], LAB = ['Vittorie', 'Podi (2°–3°)', '4°–10°', 'Oltre il 10°'];
    var R = 52, C = 2 * Math.PI * R, off = 0, segs = '';
    if (tot) c.forEach(function (v, i) { if (!v) return; var len = v / tot * C; segs += '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + COL[i] + '" stroke-width="18" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"/>'; off += len; });
    else segs = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + COL[3] + '" stroke-width="18"/>';
    var sel = withScope ? '<select class="apc-sel apc-dsel" aria-label="Periodo"><option value="car"' + (donutScope === 'car' ? ' selected' : '') + '>Carriera</option><option value="sta"' + (donutScope === 'sta' ? ' selected' : '') + '>Stagione ' + esc3(year) + '</option></select>' : '';
    return '<section class="apc"><div class="apc-h"><h3>Piazzamenti per tipo</h3>' + sel + '</div><div class="apc-donut"><svg viewBox="0 0 140 140" role="img" aria-label="Ripartizione dei piazzamenti">' + segs + '<text x="70" y="68" text-anchor="middle" class="apc-dn">' + tot + '</text><text x="70" y="86" text-anchor="middle" class="apc-dt">piazzamenti</text></svg><ul>' +
      c.map(function (v, i) { return '<li><i style="background:' + COL[i] + '"></i><span>' + LAB[i] + '</span><b>' + v + '</b></li>'; }).join('') + '</ul></div></section>';
  }

  function seasonCard(K, year, ptsTxt) {
    var all = (window._athRows || {})[K] || [], rows = all.filter(function (r) { return r.y === year; });
    if (!rows.length) return '';
    var w = rows.filter(function (r) { return r.p === 1; }).length, pod = rows.filter(function (r) { return r.p && r.p <= 3; }).length;
    var top = rows.slice().sort(function (a, b) { return (a.p - b.p) || (b.m - a.m) || b.d.localeCompare(a.d); }).slice(0, 8);
    var list = top.map(function (r) {
      var col = r.p === 1 ? '#e0a800' : r.p === 2 ? '#9aa4b2' : r.p === 3 ? '#c27a3a' : '#c9ced6', ch = chipOf(r);
      return rowLink(r, '<span class="apc-rn">' + cleanName(r.n) + '</span>' + (ch ? '<span class="apc-chip">' + esc3(ch) + '</span>' : '') + TROPHY(col) + '<b class="apc-val">' + shown(r.p) + '</b>' + CHEV3);
    }).join('');
    return '<section class="apc apc-wide"><div class="apc-h"><h3>Stagione ' + esc3(year) + '</h3><button type="button" class="apc-lnk" onclick="window._athTab(\'r\')">Vedi stagione ' + ARROW + '</button></div>' +
      '<div class="apc-stats"><div>' + ico('gar') + '<b>' + rows.length + '</b><span>Gare</span></div><div>' + ico('win') + '<b>' + w + '</b><span>Vittorie</span></div><div>' + ico('pod') + '<b>' + pod + '</b><span>Podi</span></div><div>' + '<svg class="apc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 21V10M12 21V4M19 21v-8"/></svg>' + '<b>' + esc3(ptsTxt || '0') + '</b><span>Punti</span></div></div>' +
      '<div class="apc-list">' + list + '</div><button type="button" class="apc-btn" onclick="window._athTab(\'r\')">Tutti i risultati ' + esc3(year) + ' ' + ARROW + '</button></section>';
  }

  function latestCard(K) {
    var rows = ((window._athRows || {})[K] || []).slice(0, 9);
    if (!rows.length) return '';
    var body = rows.map(function (r) {
      var ch = chipOf(r);
      return rowLink(r, '<span class="apc-d">' + esc3(fmtD(r.d)) + '</span><span class="apc-rn">' + cleanName(r.n) + '</span>' + (ch ? '<span class="apc-chip">' + esc3(ch) + '</span>' : '<span></span>') + '<b class="apc-val">' + shown(r.p) + '</b>' + CHEV3);
    }).join('');
    return '<section class="apc"><div class="apc-h"><h3>Ultimi risultati</h3><button type="button" class="apc-lnk" onclick="window._athTab(\'r\')">Tutti ' + ARROW + '</button></div><div class="apc-thead"><span>Data</span><span>Gara</span><span></span><span>Pos.</span><span></span></div><div class="apc-list apc-latest">' + body + '</div></section>';
  }

  function careerCard(c, cx) {
    if (!c || !c.n) return '';
    var top10 = c.p1 + c.p2 + c.p3 + c.pout, years = Object.keys(c.by).length, n = c.n;
    var rows = [['win', 'Vittorie', c.p1, c.p1 / n], ['pod', 'Podi', c.p1 + c.p2 + c.p3, (c.p1 + c.p2 + c.p3) / n], ['top', 'Top 10', top10, top10 / n], ['gar', 'Gare', n, 1], ['sta', 'Stagioni', years, Math.min(1, years / 19)]];
    return '<section class="apc"><div class="apc-h"><h3>Statistiche di carriera</h3></div><div class="apc-tabs"><span class="on">Riepilogo</span></div><div class="apc-list">' +
      rows.map(function (r) { return '<div class="apc-row apc-bar-row">' + ico(r[0]) + '<span class="apc-rn">' + r[1] + '</span><i class="apc-bar"><b style="width:' + Math.max(3, Math.round(r[3] * 100)) + '%"></b></i><b class="apc-val">' + r[2] + '</b></div>'; }).join('') +
      '</div><p class="apc-note">Dati delle fonti disponibili' + (c.from ? ' (' + c.from + (c.to && c.to !== c.from ? '–' + c.to : '') + ')' : '') + (cx ? ' per il ciclocross' : '') + '.</p></section>';
  }

  var byMode = 'win';
  function winsCard(c, cx) {
    if (!c || !c.n) return '';
    var ys = Object.keys(c.by).map(Number).sort(function (a, b) { return a - b; }), y0 = ys[0], y1 = ys[ys.length - 1], yrs = [];
    for (var y = y0; y <= y1; y++) yrs.push(y);
    var val = function (b) { if (!b) return 0; return byMode === 'win' ? b.p1 : byMode === 'pod' ? b.p1 + b.p2 + b.p3 : b.p1 + b.p2 + b.p3 + b.pout; };
    var max = Math.max.apply(null, yrs.map(function (y) { return val(c.by[y]); })) || 1;
    var bars = yrs.map(function (y) {
      var v = val(c.by[y]);
      return '<div class="apc-col"><em>' + (v || '') + '</em><i style="height:' + Math.max(v ? 3 : 1, Math.round(v / max * 100)) + '%"></i><span>' + (cx ? String(y).slice(2) + '/' + String(y + 1).slice(2) : "'" + String(y).slice(2)) + '</span></div>';
    }).join('');
    var title = byMode === 'win' ? 'Vittorie per anno' : byMode === 'pod' ? 'Podi per anno' : 'Top 10 per anno';
    return '<section class="apc apc-wide"><div class="apc-h"><h3>' + title + '</h3><select class="apc-sel" aria-label="Cosa contare"><option value="win"' + (byMode === 'win' ? ' selected' : '') + '>Tutte le vittorie</option><option value="pod"' + (byMode === 'pod' ? ' selected' : '') + '>Podi</option><option value="top"' + (byMode === 'top' ? ' selected' : '') + '>Top 10</option></select></div>' +
      '<div class="apc-bars' + (yrs.length > 12 ? ' apc-dense' : '') + '">' + bars + '</div></section>';
  }

  function teamsCard(K, id) {
    var t = (window._athTeams || {})[K] || [];
    if (!t.length) return '';
    var rows = ((window._athRows || {})[K] || []);
    var groups = [];
    t.forEach(function (e) { var g = groups[groups.length - 1]; if (g && g.team === e.team) { g.from = e.y; g.n += rows.filter(function (r) { return r.y === e.y; }).length; } else groups.push({ team: e.team, to: e.y, from: e.y, tid: e.tid, n: rows.filter(function (r) { return r.y === e.y; }).length }); });
    var list = groups.slice(0, 8).map(function (g) {
      var yr = g.from === g.to ? g.from : g.from + ' – ' + g.to, ini = String(g.team || '?').replace(/[^A-Za-zÀ-ÿ0-9 ]/g, '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
      var inner = '<span class="apc-d">' + esc3(yr) + '</span><span class="apc-logo" data-tid="' + esc3(g.tid || '') + '">' + esc3(ini) + '</span><span class="apc-rn"><strong>' + esc3(g.team) + '</strong><small>' + (g.n ? g.n + (g.n === 1 ? ' gara' : ' gare') : '') + '</small></span>' + (g.tid ? CHEV3 : '');
      return g.tid ? '<a class="apc-row apc-team" href="#/team/' + encodeURIComponent(g.tid) + '">' + inner + '</a>' : '<div class="apc-row apc-team">' + inner + '</div>';
    }).join('');
    return '<section class="apc"><div class="apc-h"><h3>Squadre</h3></div><p class="apc-sub">Squadre stagione per stagione</p><div class="apc-list">' + list + '</div></section>';
  }

  function rankCard(pts) {
    if (!pts || pts.length < 2) return '';
    var W = 560, H = 230, pl = 34, pr = 26, pt = 26, pb = 32, maxP = Math.max.apply(null, pts.map(function (p) { return p.pos; })), top = Math.max(5, Math.ceil(maxP / 5) * 5);
    var X = function (i) { return pl + (pts.length === 1 ? (W - pl - pr) / 2 : i / (pts.length - 1) * (W - pl - pr)); };
    var Y = function (p) { return pt + (p - 1) / Math.max(1, top - 1) * (H - pt - pb); };
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p.pos).toFixed(1); }).join(' ');
    var area = line + ' L' + X(pts.length - 1).toFixed(1) + ',' + (H - pb) + ' L' + X(0).toFixed(1) + ',' + (H - pb) + ' Z';
    var grid = [1, Math.round(top / 3), Math.round(top * 2 / 3), top].filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) { return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="apc-gl"/><text x="' + (pl - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" class="apc-tx">' + v + '</text>'; }).join('');
    var dots = pts.map(function (p, i) { return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.pos).toFixed(1) + '" r="5" class="apc-dot"><title>' + p.y + ': ' + p.pos + '°</title></circle><text x="' + X(i).toFixed(1) + '" y="' + (Y(p.pos) - 11).toFixed(1) + '" text-anchor="middle" class="apc-lb">' + p.pos + '</text><text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="apc-tx">' + p.y + '</text>'; }).join('');
    return '<section class="apc"><div class="apc-h"><h3>Posizione in classifica</h3></div><p class="apc-sub">Classifica finale di categoria, anno per anno</p><svg class="apc-line" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Posizione in classifica">' + grid + '<path d="' + area + '" class="apc-area"/><path d="' + line + '" class="apc-ln"/>' + dots + '</svg></section>';
  }

  function rivalsCard(id) {
    var h = window._athH2H; if (!h || h.id !== id || !h.list || !h.list.length) return '';
    var sil = '<svg viewBox="0 0 100 120" fill="currentColor"><circle cx="50" cy="38" r="20"/><path d="M10 120c0-24 18-40 40-40s40 16 40 40z"/></svg>';
    var cards = h.list.slice(0, 6).map(function (v) {
      return '<div class="apc-rival"><a class="apc-rav" data-aid="' + esc3(v.atleta_id) + '" href="#/atleta/' + encodeURIComponent(v.atleta_id) + '">' + sil + '</a><a class="apc-rname" href="#/atleta/' + encodeURIComponent(v.atleta_id) + '">' + esc3((v.cognome || '') + ' ' + (v.nome || '')) + '</a><span class="apc-rsub">' + v.n + ' gare insieme nei primi 10</span><small>davanti ' + v.ahead + ' · dietro ' + v.behind + '</small><button type="button" class="apc-lnk" onclick="window.openComparatoreVs ? window.openComparatoreVs(\'' + String(id).replace(/'/g, "\\'") + '\',\'' + String(v.atleta_id).replace(/'/g, "\\'") + '\',\'atleta\') : window.openComparatore(\'' + String(id).replace(/'/g, "\\'") + '\')">Confronta ' + ARROW + '</button></div>';
    }).join('');
    return '<section class="apc apc-wide"><div class="apc-h"><h3>Rivali frequenti</h3></div><p class="apc-sub">Gli atleti più spesso nei primi dieci della stessa gara: confrontali testa a testa.</p><div class="apc-rivals">' + cards + '</div></section>';
  }

  function loadCarr() {
    if (carrCache || typeof loadJson !== 'function') return carrCache;
    carrCache = 'loading';
    loadJson('data/carriere.json').then(function (d) { carrCache = d; fillCards(); fillTeamCards(); document.dispatchEvent(new CustomEvent('ics-carr')); }).catch(function () { carrCache = 'err'; });
    return carrCache;
  }
  function rankPoints(id, year, livePos) {
    var cr = carrCache; if (!cr || cr === 'loading' || cr === 'err') return null;
    var key = cr.a[id] ? id : (window._athAlias && window._athAlias[id] && cr.a[window._athAlias[id]] ? window._athAlias[id] : null);
    if (!key) return null;
    var best = {};
    cr.a[key].s.forEach(function (s) { if (s[2] > 0 && (!best[s[0]] || s[2] < best[s[0]])) best[s[0]] = s[2]; });
    if (livePos && year && !best[year]) best[year] = livePos;
    return Object.keys(best).map(Number).sort(function (a, b) { return a - b; }).map(function (y) { return { y: y, pos: best[y] }; });
  }

  function fillCards() {
    var panel = document.getElementById('ath-panel-s'); if (!panel) return;
    var id = athId(), cx = isCx(), K = id + '|' + (cx ? 'cx' : 'road');
    var host = document.getElementById('ap-cards');
    if (!host) { host = document.createElement('div'); host.id = 'ap-cards'; var kr = document.getElementById('atleta-key-results'); if (kr && kr.parentNode === panel) kr.insertAdjacentElement('afterend', host); else panel.insertBefore(host, panel.firstChild); host.addEventListener('change', function (e) { if (e.target.classList.contains('apc-dsel')) { donutScope = e.target.value; fillCards(); } else if (e.target.classList.contains('apc-sel')) { byMode = e.target.value; fillCards(); } }); }
    var aside = document.querySelector('.ath-hero-standing') || document;
    var yrM = ((aside.querySelector('#atleta-stats-italia-label') || {}).textContent || '').match(/\d{4}/), year = yrM ? yrM[0] : '';
    var ptsTxt = ((aside.querySelector('#atleta-pts-value') || {}).textContent || '0').trim();
    var posEl = aside.querySelector('.ath-rank-block .athlete-pts-value'), livePos = posEl ? parseInt(posEl.textContent, 10) || 0 : 0;
    var c = (window._athCareer || {})[K];
    if (!cx) loadCarr();
    var parts = [seasonCard(K, year, ptsTxt), latestCard(K), careerCard(c, cx), donutCard((window._athRows || {})[K] || [], true, year), winsCard(c, cx), teamsCard(K, id), cx ? '' : rankCard(rankPoints(id, +year, livePos)), rivalsCard(id)];
    var html = parts.join('');
    if (host.dataset.sig !== html) {
      host.dataset.sig = html; host.innerHTML = html;
      // foto dei rivali (quelle caricate sulle loro schede), se ci sono
      host.querySelectorAll('.apc-rav[data-aid], .apc-rph[data-aid]').forEach(function (el) {
        var aid = el.getAttribute('data-aid'); if (!aid || typeof getEntityOverrides !== 'function') return;
        getEntityOverrides('atleta', aid).then(function (ov) { if (ov && ov.photo_url && el.isConnected && typeof mediaUrl === 'function') { el.innerHTML = '<img alt="" src="' + esc3(mediaUrl(ov.photo_url)) + '">'; el.classList.add('has-img'); } }).catch(function () {});
      });
      // loghi delle squadre (foto caricata sulla scheda team), se esistono
      host.querySelectorAll('.apc-logo[data-tid]').forEach(function (el) {
        var tid = el.getAttribute('data-tid'); if (!tid || typeof getEntityOverrides !== 'function') return;
        getEntityOverrides('team', tid).then(function (ov) { if (ov && ov.photo_url && el.isConnected && typeof mediaUrl === 'function') { el.innerHTML = '<img alt="" src="' + esc3(mediaUrl(ov.photo_url)) + '">'; el.classList.add('has-img'); } }).catch(function () {});
      });
    }
  }


  // ── Titoli e medaglie: stessa grafica delle schede (testi in "frase", non tutto maiuscolo) ──
  function sentence(s) { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function markTitles() {
    document.querySelectorAll('#atleta-titles .ath-block-h span, #atleta-titles .ttl-chip, #team-titles .ath-block-h span').forEach(function (el) {
      if (el.dataset.ap) return;
      el.dataset.ap = '1';
      if (el.classList.contains('ttl-chip')) {
        for (var n = el.lastChild; n; n = n.previousSibling) { if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = sentence(n.nodeValue.trim()); break; } }
      } else el.textContent = sentence(el.textContent);
    });
  }
  // ── Stagione: un filtro (menu a tendina) al posto della fila di pillole ──
  function markYears() {
    var row = document.getElementById('profile-year-row'); if (!row) return;
    var pills = [].slice.call(row.querySelectorAll('.year-pill')); if (!pills.length) return;
    var cur = pills.filter(function (b) { return /var\(--accent/.test(b.getAttribute('style') || '') && /#fff/.test(b.getAttribute('style') || ''); })[0] || pills[0];
    var wrap = document.querySelector('.ap-yrsel');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.className = 'ap-yrsel'; wrap.innerHTML = '<label>Stagione</label><select aria-label="Stagione"></select>';
      var teamTabs = document.querySelector('.ath-tabs[aria-label*="team"]');
      if (teamTabs) teamTabs.insertAdjacentElement('afterend', wrap);   // squadra: il filtro vale per Panoramica, Atleti, Risultati e Media
      else row.parentNode.insertBefore(wrap, row);
      wrap.querySelector('select').addEventListener('change', function (e) {
        var v = e.target.value, r = document.getElementById('profile-year-row'); if (!r) return;
        var p = [].slice.call(r.querySelectorAll('.year-pill')).filter(function (b) { return (b.getAttribute('data-year') || b.textContent.trim()) === v; })[0]; if (p) p.click();
      });
    }
    row.style.display = 'none';
    // le pillole degli anni storici arrivano dopo (caricamento asincrono): il filtro si riallinea ogni volta
    var sel = wrap.querySelector('select');
    var html = pills.map(function (b) { var y = b.getAttribute('data-year') || b.textContent.trim(); return '<option value="' + esc3(y) + '"' + (b === cur ? ' selected' : '') + '>' + esc3(b.textContent.trim()) + '</option>'; }).join('');
    if (sel.dataset.sig !== html) { sel.dataset.sig = html; sel.innerHTML = html; }
    sel.disabled = pills.length < 2;
  }


  // ════════════════════════════════════════════════════════════════
  // SCHEDA TEAM: stessa testata (riquadro numeri) e stesse schede della scheda atleta
  // ════════════════════════════════════════════════════════════════
  function teamId() { var m = location.pathname.match(/\/team\/([^/?#]+)/) || location.hash.match(/#\/team\/([^/?#]+)/); return m ? decodeURIComponent(m[1]) : ''; }
  function normT(s) { return String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function decorateTeam(hero) {
    if (hero.dataset.ap) return;
    hero.dataset.ap = '1'; hero.classList.add('ap', 'ap-team');
    var grid = hero.querySelector('.ath-hero-grid'), aside = hero.querySelector('.ath-hero-standing'); if (!grid || !aside) return;
    var box = document.createElement('div'); box.className = 'ap-kpis-wrap'; grid.appendChild(box);
    function refresh() {
      var id = teamId(), cx = isCx();
      var vals = aside.querySelectorAll('.team-stat-val'), g = function (i) { return num(vals[i]); };
      var w = g(0), s = g(1), b = g(2), o = g(3), at = g(4);
      var pts = String((aside.querySelector('.ath-pts-block .athlete-pts-value') || {}).textContent || '0').trim();
      var posEl = aside.querySelector('.ath-rank-block .athlete-pts-value'), pos = posEl ? posEl.textContent.trim() : '—';
      var gap = aside.querySelector('.ath-gap-line');
      var showDisc = typeof window.cxSetMode === 'function' && window.CX && window.CX.hasCxTeam(id) === true && window.CX.hasRoadTeam(id) === true;
      var sc = scope(), code = activeCatCode(), catTxt = ((aside.querySelector('.ath-stand-lbl') || {}).textContent || '').replace(/^CLASSIFICA\s*/i, '');
      var seasonTxt = (cx && window.CX && window.CX.season) ? window.CX.season() : ((typeof _loadedSeasonYear === 'function') ? _loadedSeasonYear() : '');
      var ctl = '<div class="ap-ctl">' + (showDisc ? seg('disc', [['strada', 'Strada'], ['ciclocross', 'Ciclocross']], cx ? 'ciclocross' : 'strada') : '') + seg('scope', [['carriera', 'Carriera'], ['stagione', 'Stagione ' + seasonTxt]], sc) + '</div>';
      var cells, foot;
      if (sc === 'carriera') {
        var ss = cx ? [] : teamSeasons(carrCache, (typeof globalData !== 'undefined' && globalData && globalData.teams) ? globalData.teams[id] : null, code);
        if (!cx) loadCarr();
        if (ss.length) {
          var yy = {}, bestP = 999, tit = 0, pp = 0; ss.forEach(function (x) { yy[x[0]] = 1; if (x[2] > 0 && x[2] < bestP) bestP = x[2]; if (x[2] === 1) tit++; pp += x[3] || 0; });
          var ny = Object.keys(yy).length;
          cells = '<div class="ap-k"><b>' + ny + '</b><span>Stagioni</span></div><div class="ap-k ap-gold"><b>' + tit + '</b><span>Titoli di classifica</span></div><div class="ap-k"><b>' + (bestP === 999 ? '—' : bestP + '°') + '</b><span>Miglior posizione</span></div><div class="ap-k"><b>' + pp + '</b><span>Punti in archivio</span></div><div class="ap-k"><b>' + at + '</b><span>Atleti oggi</span></div><div class="ap-k ap-pos"><b>x</b><span>Posizione</span></div>';
          foot = '<span class="ap-klbl">Carriera · ' + esc3(catTxt) + ' · ' + Math.min.apply(null, Object.keys(yy)) + '–' + Math.max.apply(null, Object.keys(yy)) + '</span><span class="ap-note">Dai dati dell\'archivio (classifiche finali). Il ranking assoluto arriverà.</span>';
        } else {
          cells = '<div class="ap-k"><b>' + (cx ? '1' : '…') + '</b><span>Stagioni</span></div><div class="ap-k ap-gold"><b>' + (cx ? w : '…') + '</b><span>Vittorie</span></div><div class="ap-k"><b>' + (cx ? (w + s + b) : '…') + '</b><span>Podi</span></div><div class="ap-k"><b>' + (cx ? pts : '…') + '</b><span>Punti</span></div><div class="ap-k"><b>' + at + '</b><span>Atleti oggi</span></div><div class="ap-k ap-pos"><b>x</b><span>Posizione</span></div>';
          foot = '<span class="ap-klbl">Carriera · ' + esc3(catTxt) + (cx ? ' · ciclocross' : ' · in caricamento…') + '</span>';
        }
      } else {
        cells = '<div class="ap-k ap-gold"><b>' + w + '</b><span>Vittorie</span></div><div class="ap-k"><b>' + (w + s + b) + '</b><span>Podi</span><i>' + s + ' × 2° · ' + b + ' × 3°</i></div><div class="ap-k"><b>' + o + '</b><span>4°–10°</span></div><div class="ap-k"><b>' + at + '</b><span>Atleti</span></div><div class="ap-k"><b>' + pts + '</b><span>Punti</span></div><div class="ap-k ap-pos"><b>' + pos + '</b><span>Posizione</span></div>';
        foot = '<span class="ap-klbl">Classifica ' + esc3(catTxt) + '</span>' + (gap ? gap.outerHTML : '');
      }
      var html = ctl + '<div class="ap-kpis ap-k6">' + cells + '</div><div class="ap-kfoot">' + foot + '</div>';
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    }
    box.addEventListener('click', function (e) {
      var bt = e.target.closest('.ap-seg button'); if (!bt) return;
      var kk = bt.parentNode.getAttribute('data-k');
      if (kk === 'scope') { setScope(bt.getAttribute('data-v')); refresh(); }
      else if (kk === 'disc' && typeof window.cxSetMode === 'function' && (bt.getAttribute('data-v') === 'ciclocross') !== isCx()) window.cxSetMode(bt.getAttribute('data-v'), { force: true });
    });
    document.addEventListener('ics-cx-ready', refresh); document.addEventListener('ics-carr', refresh);
    refresh();
    new MutationObserver(function () { refresh(); }).observe(aside, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-base'] });
  }

  function teamRows(id) { return teamRowsFrom((typeof globalData !== 'undefined' && globalData && globalData.teams) ? globalData.teams[id] : null); }
  function teamRowsFrom(t) {
    if (!t) return [];
    return (t.risultati || []).filter(function (r) { return r.data && r.posizione; }).map(function (r) {
      var who = ((r.atleta_cognome || '') + ' ' + (r.atleta_nome || '')).trim();
      var cc = ''; try { cc = (typeof getRankingFileCode === 'function' ? (getRankingFileCode({ gara_id: r.gara_id, atleta_id: r.atleta_id, genere: r.genere }) || '') : ''); } catch (e) {}
      return { d: r.data, y: String(r.data).slice(0, 4), p: r.posizione, n: String(r.nome_gara || '') + (who ? ' · ' + who : ''), h: '#/gara/' + r.gara_id, m: r.moltiplicatore || 0, a: r.atleta_id || '', who: who, pts: r.punti_effettivi || 0, c: cc };
    }).sort(function (a, b) { return b.d.localeCompare(a.d); });
  }
  function squadCard(rows) {
    var by = {};
    rows.forEach(function (r) { if (!r.a) return; var x = by[r.a] || (by[r.a] = { a: r.a, who: r.who, w: 0, p: 0, n: 0, pts: 0 }); x.n++; x.pts += r.pts; if (r.p === 1) x.w++; if (r.p <= 3) x.p++; });
    var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.pts - a.pts || b.w - a.w || b.p - a.p; }).slice(0, 8);
    if (!list.length) return '';
    var sil = '<svg viewBox="0 0 100 120" fill="currentColor"><circle cx="50" cy="38" r="20"/><path d="M10 120c0-24 18-40 40-40s40 16 40 40z"/></svg>';
    return '<section class="apc apc-wide"><div class="apc-h"><h3>Atleti</h3></div><p class="apc-sub">I più incisivi della stagione, per punti</p><div class="apc-list">' + list.map(function (x) {
      return '<a class="apc-row" href="#/atleta/' + encodeURIComponent(x.a) + '"><span class="apc-rav apc-rav-s" data-aid="' + esc3(x.a) + '">' + sil + '</span><span class="apc-rn"><strong>' + esc3(x.who) + '</strong><small>' + x.w + (x.w === 1 ? ' vittoria' : ' vittorie') + ' · ' + x.p + (x.p === 1 ? ' podio' : ' podi') + ' · ' + x.n + (x.n === 1 ? ' piazzamento' : ' piazzamenti') + '</small></span>' + (x.pts ? '<b class="apc-val">' + x.pts + ' pt</b>' : '') + CHEV3 + '</a>';
    }).join('') + '</div></section>';
  }
  var NATCAT = { ES1_M: 0, ES2_M: 1, AL_M: 2, JUN_M: 3, ELI_M: 4, ES1_F: 5, ES2_F: 5, AL_F: 6, JUN_F: 7, ELI_F: 7 };
  function teamSeasons(cr, team, code) {
    var rec = cr && cr !== 'loading' && cr !== 'err' && team ? cr.t[normT(team.nome)] : null; if (!rec) return [];
    var idx = (code && NATCAT[code] != null) ? NATCAT[code] : null;
    return rec.s.filter(function (s) { return idx === null || s[1] === idx; });
  }
  function teamCareerCard(cr, team, code) {
    var seasons = teamSeasons(cr, team, code); if (!seasons.length) return '';
    var rec = { s: seasons };
    var ys = {}, best = 999, titoli = 0, pts = 0;
    rec.s.forEach(function (s) { ys[s[0]] = 1; if (s[2] > 0 && s[2] < best) best = s[2]; if (s[2] === 1) titoli++; pts += s[3] || 0; });
    var n = Object.keys(ys).length, rows = [['sta', 'Stagioni', n, Math.min(1, n / 19)], ['win', 'Titoli di classifica', titoli, Math.min(1, titoli / Math.max(1, n))], ['top', 'Miglior posizione', best === 999 ? '—' : best + '°', best === 999 ? 0 : Math.max(.04, 1 - (best - 1) / 100)]];
    return '<section class="apc"><div class="apc-h"><h3>Statistiche della squadra</h3></div><div class="apc-tabs"><span class="on">Riepilogo</span></div><div class="apc-list">' +
      rows.map(function (r) { return '<div class="apc-row apc-bar-row">' + ico(r[0]) + '<span class="apc-rn">' + r[1] + '</span><i class="apc-bar"><b style="width:' + Math.max(3, Math.round(r[3] * 100)) + '%"></b></i><b class="apc-val">' + r[2] + '</b></div>'; }).join('') +
      '</div><p class="apc-note">Archivio ' + Math.min.apply(null, Object.keys(ys)) + '–' + Math.max.apply(null, Object.keys(ys)) + ' · punti totali in archivio: ' + pts + '.</p></section>';
  }
  function teamRank(cr, team, year, livePos, code) {
    var ss = teamSeasons(cr, team, code); if (!ss.length) return null;
    var best = {}; ss.forEach(function (s) { if (s[2] > 0 && (!best[s[0]] || s[2] < best[s[0]])) best[s[0]] = s[2]; });
    if (livePos && year && !best[year]) best[year] = livePos;
    return Object.keys(best).map(Number).sort(function (a, b) { return a - b; }).map(function (y) { return { y: y, pos: best[y] }; });
  }

  function fillTeamCards() {
    var panel = document.getElementById('tm-panel-s'); if (!panel) return;
    var id = teamId(), cx = isCx();
    var host = document.getElementById('ap-cards');
    if (!host) { host = document.createElement('div'); host.id = 'ap-cards'; var anchor = document.getElementById('team-native-content'); if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor); else panel.appendChild(host); }
    var sel = document.querySelector('.ap-yrsel select'), loaded = (typeof _loadedSeasonYear === 'function') ? String(_loadedSeasonYear()) : '';
    var selYear = sel ? sel.value : loaded, isCur = cx || !selYear || selYear === loaded;
    var team = (typeof globalData !== 'undefined' && globalData && globalData.teams) ? globalData.teams[id] : null;
    if (!cx) loadCarr();
    var aside = document.querySelector('.tm-hero .ath-hero-standing') || document;
    var ptsTxt = String((aside.querySelector('.ath-pts-block .athlete-pts-value') || {}).textContent || '0').trim();
    var posEl = aside.querySelector('.ath-rank-block .athlete-pts-value'), livePos = posEl ? parseInt(posEl.textContent, 10) || 0 : 0;
    var K = '__team__' + id + (cx ? '|cx' : '|road');
    window._athRows = window._athRows || {};
    var rowsNow = [];
    if (isCur) rowsNow = teamRows(id);
    else {
      // stagione passata: prima i dati nativi di quella stagione (stesso formato di quella in corso), poi l'archivio storico
      var pk = id + '|' + selYear; window._tmPast = window._tmPast || {};
      if (window._tmPast[pk] === undefined && typeof loadSeasonTeams === 'function') {
        window._tmPast[pk] = null;
        // la squadra di quell'anno puo' avere un altro nome/id (storia della squadra): prima la storia, poi la stagione nativa
        var prH = (typeof _histSeason === 'function') ? _histSeason(id, selYear).then(function (h) { return h && h.t ? h.t : null; }).catch(function () { return null; }) : Promise.resolve(null);
        prH.then(function (t0) { return t0 || loadSeasonTeams(selYear).then(function (m) { return m && m[id]; }); })
          .then(function (t) { window._tmPast[pk] = { rows: teamRowsFrom(t), pts: t ? (t.punti_totali || 0) : 0 }; fillTeamCards(); })
          .catch(function () { window._tmPast[pk] = { rows: [], pts: 0 }; fillTeamCards(); });
      }
      var pastN = window._tmPast[pk];
      if (pastN && pastN.rows.length) { rowsNow = pastN.rows; ptsTxt = String(pastN.pts); isCur = true; }
    }
    if (!isCur) {
      // nessun dato nativo: archivio storico della squadra (anche con i nomi precedenti), per la categoria scelta
      var arc = (window._ciclismoTeamStoricoCache || {})[id], arr = (arc && arc[selYear]) || [];
      var cats = arr.map(function (r) { return r.categoria; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      var cc = (window._teamCiclismoCurCat || {})[id + '_' + selYear] || cats[0];
      rowsNow = arr.filter(function (r) { return !cc || cats.length < 2 || r.categoria === cc; }).filter(function (r) { return r.posizione; }).map(function (r) {
        var who = r.nome_completo || ''; return { d: r.data || (selYear + '-01-01'), y: String(selYear), p: r.posizione, n: String(r.nome_gara || '') + (who ? ' · ' + who : ''), h: '', m: 0, a: r.atleta_id || '', who: who, pts: 0 };
      }).sort(function (a, b) { return b.d.localeCompare(a.d); });
    }
    var catCode = activeCatCode();
    if (catCode) rowsNow = rowsNow.filter(function (r) { return !r.c || r.c === catCode; });
    window._athRows[K] = rowsNow;
    if (rowsNow.length && rowsNow.some(function (r) { return r.pts; })) ptsTxt = String(rowsNow.reduce(function (s, r) { return s + (r.pts || 0); }, 0));
    var year = cx ? (window.CX && window.CX.season ? window.CX.season() : selYear) : selYear;
    var rows = window._athRows[K];
    var seasonKey = cx ? K : K;
    // Stagione/Ultimi usano il formato degli atleti: l'anno delle righe e' quello della data
    var yearForRows = cx ? (rows[0] ? rows[0].y : '') : selYear;
    var parts = [];
    if (rows.length) {
      parts.push(seasonCard(K, yearForRows, isCur ? ptsTxt : '—').replace('Stagione ' + yearForRows, 'Stagione ' + year));
      parts.push(latestCard(K));
      parts.push(donutCard(rows, false, yearForRows));
      parts.push(squadCard(rows));
      var cr = cx ? null : carrCache;
      if (cr) { parts.push(teamCareerCard(cr, team, catCode)); parts.push(rankCard(teamRank(cr, team, +yearForRows, livePos, catCode))); }
    } else if (isCur && !cx) {
      // stagione in corso senza risultati (squadra nuova o atleti appena inseriti): si mostra comunque la rosa
      var cxCards = cxTeamCards(id, catCode);
      if (cxCards) parts.push(cxCards);
      parts.push(rosterCard(id, catCode, !!cxCards));
    }
    var html = parts.join('').split("window._athTab('r')").join("window._tmTab('r')");
    if (host.dataset.sig !== html) {
      host.dataset.sig = html; host.innerHTML = html;
      host.querySelectorAll('.apc-rav[data-aid]').forEach(function (el) {
        var aid = el.getAttribute('data-aid'); if (!aid || typeof getEntityOverrides !== 'function') return;
        getEntityOverrides('atleta', aid).then(function (ov) { if (ov && ov.photo_url && el.isConnected && typeof mediaUrl === 'function') { el.innerHTML = '<img alt="" src="' + esc3(mediaUrl(ov.photo_url)) + '">'; el.classList.add('has-img'); } }).catch(function () {});
      });
    }
  }


  // ── Storia della squadra: le "vecchie squadre" (nomi precedenti) stanno nella scheda Storia, non sopra le schede ──
  function markTeamHistory() {
    var bar = document.getElementById('team-lineage-bar'), panel = document.getElementById('tm-panel-c'), tab = document.getElementById('tm-tab-c');
    if (tab && tab.textContent.trim() !== 'Storia') tab.textContent = 'Storia';
    var st = document.getElementById('tm-tab-s'); if (st && st.textContent.trim() === 'Stagione') st.textContent = 'Panoramica';
    if (bar && panel && bar.parentNode !== panel) panel.insertBefore(bar, panel.firstChild);
  }


  // ════════════════════════════════════════════════════════════════
  // SCHEDA TEAM: categoria in alto + scheda "Atleti" a griglia (foto, nome, categoria)
  // ════════════════════════════════════════════════════════════════
  function markTeamCats() {
    var hero = document.querySelector('.team-header.tm-hero'); if (!hero) return;
    var tg = [].slice.call(document.querySelectorAll('#team-native-content .tab-group')).filter(function (g) { return g.querySelector('button[onclick*="setTeamDetailCat"]'); })[0];
    var host = document.getElementById('ap-teamcats');
    if (!tg) return;
    if (!host) { host = document.createElement('div'); host.id = 'ap-teamcats'; host.className = 'ap-segbar'; hero.insertAdjacentElement('afterend', host); }
    host.appendChild(tg); tg.style.margin = '0';
  }
  var ridersSort = 'pts';
  // statistiche del ciclocross mostrate nella Panoramica di una squadra che su strada non ha ancora risultati
  function cxTeamCards(id, code) {
    var gd = window.CX && window.CX.otherGd ? window.CX.otherGd() : null, t = gd && gd.teams ? gd.teams[id] : null;
    if (!t) return '';
    var season = window.CX.season(), K = '__team__' + id + '|cxsum';
    var rows = teamRowsFrom(t).filter(function (r) { return !code || !r.c || r.c === code; });
    if (!rows.length) return '';
    rows.forEach(function (r) { r.y = season; });
    window._athRows = window._athRows || {}; window._athRows[K] = rows;
    var pts = rows.reduce(function (s, r) { return s + (r.pts || 0); }, 0);
    var go = "window.cxSetMode('ciclocross',{force:true})";
    return [seasonCard(K, season, String(pts)).replace('Stagione ' + season, 'Ciclocross ' + season), latestCard(K), donutCard(rows, false, season), squadCard(rows)]
      .join('').split("window._athTab('r')").join(go);
  }
  function rosterCard(id, code, hasCx) {
    var t = (typeof globalData !== 'undefined' && globalData && globalData.teams) ? globalData.teams[id] : null; if (!t) return '';
    var list = (t.atleti || []).map(function (aid) { return globalData.athletes[aid]; }).filter(Boolean).filter(function (a) {
      if (!code) return true; var c = (typeof getRankingFileCode === 'function' ? getRankingFileCode(a.categoria) : a.categoria) || a.categoria; return c === code || a.categoria === code;
    });
    if (!list.length) return '';
    list.sort(function (a, b) { return String(a.cognome + a.nome).localeCompare(String(b.cognome + b.nome)); });
    var sil = '<svg viewBox="0 0 100 120" fill="currentColor"><circle cx="50" cy="38" r="20"/><path d="M10 120c0-24 18-40 40-40s40 16 40 40z"/></svg>';
    return '<section class="apc apc-wide"><div class="apc-h"><h3>Atleti (' + list.length + ')</h3></div><p class="apc-sub">' + (hasCx ? 'La rosa della squadra.' : 'Nessun risultato in questa stagione per ora: ecco la rosa.') + '</p><div class="apc-riders">' + list.map(function (a) {
      var aid = a.id || a.atleta_id;
      return '<a class="apc-rider" href="#/atleta/' + encodeURIComponent(aid) + '"><span class="apc-rph" data-aid="' + esc3(aid) + '">' + sil + '</span><b>' + esc3((a.cognome || '') + ' ' + (a.nome || '')) + '</b><small>' + esc3(typeof catLabel === 'function' ? catLabel(a.categoria) : a.categoria) + '</small></a>';
    }).join('') + '</div></section>';
  }
  function activeCatCode() {
    var b = document.querySelector('#ap-teamcats .active-cat, #ap-teamcats button.active-cat');
    var m = b && (b.getAttribute('onclick') || '').match(/setTeamDetailCat\('([^']+)'\)/); return m ? m[1] : '';
  }
  function ridersHtml(id) {
    var t = (typeof globalData !== 'undefined' && globalData && globalData.teams) ? globalData.teams[id] : null; if (!t) return '';
    var code = activeCatCode(), cx = isCx();
    var list = (t.atleti || []).map(function (aid) { return globalData.athletes[aid]; }).filter(Boolean).filter(function (a) {
      if (!code) return true; var c = (typeof getRankingFileCode === 'function' ? getRankingFileCode(a.categoria) : a.categoria) || a.categoria; return c === code || a.categoria === code;
    });
    var n = list.length;
    list.sort(function (a, b) { return ridersSort === 'name' ? String(a.cognome + a.nome).localeCompare(String(b.cognome + b.nome)) : (b.punti_totali || 0) - (a.punti_totali || 0); });
    var sil = '<svg viewBox="0 0 100 120" fill="currentColor"><circle cx="50" cy="38" r="20"/><path d="M10 120c0-24 18-40 40-40s40 16 40 40z"/></svg>';
    var cards = list.map(function (a) {
      var aid = a.id || a.atleta_id, res = (a.risultati || []), w = res.filter(function (r) { return r.posizione === 1; }).length;
      return '<a class="apc-rider" href="#/atleta/' + encodeURIComponent(aid) + '"><span class="apc-rph" data-aid="' + esc3(aid) + '">' + sil + '</span><b>' + esc3((a.cognome || '') + ' ' + (a.nome || '')) + '</b><small>' + esc3(typeof catLabel === 'function' ? catLabel(a.categoria) : a.categoria) + '</small><em>' + (a.punti_totali || 0) + ' pt' + (w ? ' · ' + w + (w === 1 ? ' vittoria' : ' vittorie') : '') + '</em></a>';
    }).join('');
    return '<section class="apc apc-wide"><div class="apc-h"><h3>Atleti (' + n + ')</h3><div class="ap-seg ap-seg-blue" data-k="rsort"><button type="button" data-v="pts" aria-pressed="' + (ridersSort === 'pts') + '">Per punti</button><button type="button" data-v="name" aria-pressed="' + (ridersSort === 'name') + '">Per nome</button></div></div>' +
      (n ? '<div class="apc-riders">' + cards + '</div>' : '<p class="apc-sub">Nessun atleta in questa categoria.</p>') + '</section>';
  }
  function fillRiders() {
    var panel = document.getElementById('tm-panel-a'); if (!panel) return;
    var html = ridersHtml(teamId());
    if (panel.dataset.sig === html) return;
    panel.dataset.sig = html; panel.innerHTML = html;
    panel.querySelectorAll('.apc-rph[data-aid]').forEach(function (el) {
      var aid = el.getAttribute('data-aid'); if (!aid || typeof getEntityOverrides !== 'function') return;
      getEntityOverrides('atleta', aid).then(function (ov) { if (ov && ov.photo_url && el.isConnected && typeof mediaUrl === 'function') { el.innerHTML = '<img alt="" src="' + esc3(mediaUrl(ov.photo_url)) + '">'; el.classList.add('has-img'); } }).catch(function () {});
    });
    var sg = panel.querySelector('.ap-seg[data-k="rsort"]');
    if (sg) sg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; ridersSort = b.getAttribute('data-v'); fillRiders(); });
  }
  function yrVis(k) { var w = document.querySelector('.ap-yrsel'); if (w) w.style.display = (k === 'c') ? 'none' : ''; }
  function markTeamTabs() {
    var tabs = document.querySelector('.ath-tabs[aria-label*="team"]'), sP = document.getElementById('tm-panel-s'); if (!tabs || !sP || document.getElementById('tm-tab-a')) return;
    // vecchi elenchi (corridori chiave / roster): ora c'e' la scheda Atleti
    var oldRid = document.getElementById('team-riders-tab-chiave'); if (oldRid && oldRid.closest('.section-header')) oldRid.closest('.section-header').style.display = 'none';
    ['team-riders-chiave', 'team-riders-roster'].forEach(function (i) { var e = document.getElementById(i); if (e) e.style.display = 'none'; });
    // tabella dei risultati: scheda a parte
    var tbody = document.getElementById('team-results-tbody'), tbl = tbody && tbody.closest('table'), pr = document.createElement('div');
    pr.id = 'tm-panel-r'; pr.setAttribute('role', 'tabpanel'); pr.hidden = true;
    if (tbl) { var hd = tbl.previousElementSibling; while (hd && !hd.classList.contains('section-header')) hd = hd.previousElementSibling; if (hd) pr.appendChild(hd); pr.appendChild(tbl); }
    // media (foto/video) della squadra: scheda a parte, visibile solo se c'e' qualcosa
    var pm = document.createElement('div'); pm.id = 'tm-panel-m'; pm.setAttribute('role', 'tabpanel'); pm.hidden = true;
    [].slice.call(document.querySelectorAll('#team-native-content .profile-media-section')).forEach(function (e) { pm.appendChild(e); });
    var btnM = document.createElement('button'); btnM.className = 'ath-tab'; btnM.setAttribute('role', 'tab'); btnM.id = 'tm-tab-m'; btnM.setAttribute('aria-selected', 'false'); btnM.textContent = 'Media';
    btnM.addEventListener('click', function () { window._tmTab('m'); });
    var btnR = document.createElement('button'); btnR.className = 'ath-tab'; btnR.setAttribute('role', 'tab'); btnR.id = 'tm-tab-r'; btnR.setAttribute('aria-selected', 'false'); btnR.textContent = 'Risultati';
    btnR.addEventListener('click', function () { window._tmTab('r'); });
    var btn = document.createElement('button'); btn.className = 'ath-tab'; btn.setAttribute('role', 'tab'); btn.id = 'tm-tab-a'; btn.setAttribute('aria-selected', 'false'); btn.textContent = 'Atleti';
    btn.addEventListener('click', function () { window._tmTab('a'); });
    var cTab = document.getElementById('tm-tab-c'); tabs.insertBefore(btn, cTab); tabs.insertBefore(btnR, cTab); tabs.insertBefore(btnM, cTab);
    var pa = document.createElement('div'); pa.id = 'tm-panel-a'; pa.setAttribute('role', 'tabpanel'); pa.hidden = true; sP.insertAdjacentElement('afterend', pa); pa.insertAdjacentElement('afterend', pr); pr.insertAdjacentElement('afterend', pm);
    var syncM = function () { var has = [].some.call(pm.children, function (c) { return c.textContent.trim() !== '' || c.querySelector('img,video'); }); btnM.hidden = !has; if (!has && !pm.hidden && typeof window._tmTab === 'function') window._tmTab('s'); };
    new MutationObserver(syncM).observe(pm, { childList: true, subtree: true }); syncM();
    var orig = window._tmTab;
    if (typeof orig === 'function' && !orig.__ap) {
      var w = function (k) {
        var s = document.getElementById('tm-panel-s'), c = document.getElementById('tm-panel-c'), a = document.getElementById('tm-panel-a');
        var ts = document.getElementById('tm-tab-s'), tc = document.getElementById('tm-tab-c'), ta = document.getElementById('tm-tab-a');
        var r = document.getElementById('tm-panel-r'), tr = document.getElementById('tm-tab-r'), m = document.getElementById('tm-panel-m'), tm = document.getElementById('tm-tab-m');
        if (k === 'a' || k === 'r' || k === 'm') {
          if (s) s.hidden = true; if (c) c.hidden = true; if (a) a.hidden = k !== 'a'; if (r) r.hidden = k !== 'r'; if (m) m.hidden = k !== 'm'; if (tm) tm.setAttribute('aria-selected', k === 'm' ? 'true' : 'false');
          if (ts) ts.setAttribute('aria-selected', 'false'); if (tc) tc.setAttribute('aria-selected', 'false'); if (ta) ta.setAttribute('aria-selected', k === 'a' ? 'true' : 'false'); if (tr) tr.setAttribute('aria-selected', k === 'r' ? 'true' : 'false');
          if (k === 'a') fillRiders(); yrVis(k); return;
        }
        if (a) a.hidden = true; if (r) r.hidden = true; if (m) m.hidden = true; if (ta) ta.setAttribute('aria-selected', 'false'); if (tr) tr.setAttribute('aria-selected', 'false'); if (tm) tm.setAttribute('aria-selected', 'false');
        var res = orig.apply(this, arguments); yrVis(k); return res;
      };
      w.__ap = true; window._tmTab = w;
    }
    fillRiders();
  }


  // ── Logo/maglia della squadra: la cornice si adatta alla forma (tondo, quadrato, orizzontale) ──
  function fitLogos() {
    document.querySelectorAll('.team-header.ap .photo-area--portrait img:not([data-fit]), .athlete-header.ap #atleta-team-photo-wrap img:not([data-fit])').forEach(function (img) {
      img.setAttribute('data-fit', '1');
      var apply = function () {
        var w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return;
        var r = w / h, box = img.closest('.photo-area') || img.parentElement, shape = r > 1.45 ? 'wide' : (r < 0.8 ? 'tall' : (Math.abs(r - 1) < 0.12 ? 'round' : 'sq'));
        box.classList.remove('lg-wide', 'lg-tall', 'lg-round', 'lg-sq'); box.classList.add('lg-' + shape, 'lg-fit');
      };
      if (img.complete) apply(); else img.addEventListener('load', apply);
    });
  }

  // Selettori categoria (Classifica, Calendario, Albo, Statistiche): menu a tendina come in Risultati. I pulsanti originali restano (nascosti) e ricevono il clic.
  function catSelects() {
    document.querySelectorAll('.cls-cats:not([data-cs]), .am-filter:not([data-cs])').forEach(function (box) {
      var btns = [].slice.call(box.querySelectorAll('button')); if (!btns.length || !box.parentNode) return;
      box.setAttribute('data-cs', '1');
      var isCal = box.id === 'cal-cats';
      var lab = document.createElement('label'); lab.className = 'hx-sel cs-sel';
      var sel = document.createElement('select'); sel.setAttribute('aria-label', 'Categoria');
      if (isCal) { var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Tutte le categorie'; sel.appendChild(o0); }
      btns.forEach(function (b, i) { var o = document.createElement('option'); o.value = String(i); o.textContent = b.textContent.trim(); sel.appendChild(o); });
      sel.addEventListener('change', function () {
        if (sel.value === '') { var p = btns.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })[0]; if (p) p.click(); }
        else btns[+sel.value].click();
      });
      lab.appendChild(sel); box.parentNode.insertBefore(lab, box);
      box._csSel = sel; box._csBtns = btns; box._csCal = isCal;
    });
    document.querySelectorAll('.cls-cats[data-cs], .am-filter[data-cs]').forEach(function (box) {
      if (!box._csSel) return;
      var i = box._csBtns.findIndex(function (b) { return b.getAttribute('aria-pressed') === 'true'; });
      var v = i < 0 ? (box._csCal ? '' : '0') : String(i);
      if (box._csSel.value !== v) box._csSel.value = v;
    });
  }
  document.addEventListener('ics-cx-ready', function () { setTimeout(function () { scan(); }, 0); });
  function scan() { T = null; document.querySelectorAll('.athlete-header.ath-hero:not([data-ap])').forEach(decorate); fillCareer(); fillKey(); fillCards(); markNil(); markTitles(); markYears(); document.querySelectorAll('.team-header.tm-hero:not([data-ap])').forEach(decorateTeam); fitLogos(); markTeamHistory(); markTeamCats(); markTeamTabs(); fillRiders(); fillTeamCards(); catSelects(); }
  function init() {
    new MutationObserver(function () { if (T) return; T = setTimeout(scan, 60); }).observe(document.body, { childList: true, subtree: true });
    scan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
