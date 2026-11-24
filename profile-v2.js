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
    document.addEventListener('ics-career', refresh);
    document.addEventListener('ics-cx-ready', refresh);
    refresh();
    new MutationObserver(function () { refresh(); }).observe(aside, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-base'] });
  }

  function scan() { T = null; document.querySelectorAll('.athlete-header.ath-hero:not([data-ap])').forEach(decorate); }
  function init() {
    new MutationObserver(function () { if (T) return; T = setTimeout(scan, 60); }).observe(document.body, { childList: true, subtree: true });
    scan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
