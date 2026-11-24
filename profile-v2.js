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
    document.addEventListener('ics-career', function () { refresh(); fillCareer(); });
    document.addEventListener('ics-cx-ready', refresh);
    refresh();
    new MutationObserver(function () { refresh(); }).observe(aside, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-base'] });
  }


  // ── Scheda "Carriera": totali, grafico per anno (1° · 2° · 3° · 4°–10°) e tabella stagione per stagione ──
  function fillCareer() {
    var host = document.getElementById('atleta-career-stats'); if (!host) return;
    var put = function (h) { if (host.dataset.sig !== h) { host.dataset.sig = h; host.innerHTML = h; } };
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
    put(
      '<div class="ap-cs-head"><h3>Statistiche di carriera · ' + (cx ? 'ciclocross' : 'strada') + '</h3><span>' + y0 + (y1 > y0 ? '–' + y1 : '') + '</span></div>' +
      '<div class="ap-cs-tot"><div><b>' + c.n + '</b><span>Gare</span></div><div><b>' + c.p1 + '</b><span>1°</span></div><div><b>' + c.p2 + '</b><span>2°</span></div><div><b>' + c.p3 + '</b><span>3°</span></div><div><b>' + c.pout + '</b><span>4°–10°</span></div></div>' +
      '<div class="ap-cs-chart"><div class="ap-cs-leg">' + legend + '</div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Piazzamenti per anno">' + grid + bars + '</svg></div>' +
      '<div class="ap-cs-table"><table><thead><tr><th>Stagione</th><th>Gare</th><th>1°</th><th>2°</th><th>3°</th><th>4°–10°</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="ap-note2">Piazzamenti dalle fonti disponibili (FCI, ciclismo.info, PCS), senza doppioni. Dove una gara non ha la classifica completa, i piazzamenti oltre il 3° possono mancare.</p>');
  }

  function scan() { T = null; document.querySelectorAll('.athlete-header.ath-hero:not([data-ap])').forEach(decorate); fillCareer(); }
  function init() {
    new MutationObserver(function () { if (T) return; T = setTimeout(scan, 60); }).observe(document.body, { childList: true, subtree: true });
    scan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
