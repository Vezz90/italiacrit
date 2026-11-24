/* Scheda atleta v2 — i numeri in evidenza (Vittorie · Podi · 4°–10° · Punti · Posizione) in un riquadro a destra della testata.
   Non riscrive la pagina: legge i valori già calcolati dalla testata esistente (che l'app continua ad aggiornare) e li ripresenta. */
(function () {
  'use strict';
  var T = null;

  function num(el) { var n = parseInt(String(el && el.textContent || '').replace(/[^\d-]/g, ''), 10); return isNaN(n) ? 0 : n; }

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
      var vals = aside.querySelectorAll('#atleta-stats-italia-bar .athlete-stat-val');
      var w = num(vals[0]), s = num(vals[1]), b = num(vals[2]), o = num(vals[3]);
      var pts = (aside.querySelector('#atleta-pts-value') || {}).textContent || '0';
      var posEl = aside.querySelector('.ath-rank-block .athlete-pts-value');
      var pos = posEl ? posEl.textContent.trim() : '—';
      var lbl = (aside.querySelector('.ath-stand-lbl') || {}).textContent || '';
      var gap = aside.querySelector('.ath-gap-line');
      var html =
        '<div class="ap-kpis">' +
        '<div class="ap-k ap-gold"><b>' + w + '</b><span>Vittorie</span></div>' +
        '<div class="ap-k"><b>' + (w + s + b) + '</b><span>Podi</span><i>' + s + ' × 2° · ' + b + ' × 3°</i></div>' +
        '<div class="ap-k"><b>' + o + '</b><span>4°–10°</span></div>' +
        '<div class="ap-k"><b>' + String(pts).trim() + '</b><span>Punti</span></div>' +
        '<div class="ap-k ap-pos"><b>' + pos + '</b><span>Posizione</span></div>' +
        '</div>' +
        '<div class="ap-kfoot"><span class="ap-klbl">' + lbl.replace(/</g, '&lt;') + '</span>' + (gap ? gap.outerHTML : '') + '</div>';
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    }
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
