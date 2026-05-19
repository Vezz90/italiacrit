#!/usr/bin/env node
/**
 * Restore old hero + add split category banners below it.
 * The banners use data-hub attribute to avoid onclick quoting issues.
 */
const fs = require('fs');
const path = require('path');

const appFile = path.join(__dirname, 'app.js');
let src = fs.readFileSync(appFile, 'utf8');
src = src.replace(/\r\n/g, '\n');

let ok = 0, fail = 0;
function replace(tag, oldStr, newStr) {
  if (src.includes(oldStr)) { src = src.replace(oldStr, newStr); console.log('✓', tag); ok++; }
  else { console.error('✗', tag, '— marker not found'); fail++; }
}

// ── 1. Replace hero section (anchor-based) ────────────────────────
const HERO_START = '  // ── 1. HERO — cinematic with inline contextual selector ────────\n';
const HERO_END   = '\n\n  // ── 2. UOMO DEL MOMENTO ───────────────────────────────────────';
const si = src.indexOf(HERO_START);
const ei = src.indexOf(HERO_END);
if (si >= 0 && ei >= 0) {
  const NEW_HERO = `  // ── 1. HERO ──────────────────────────────────────────────────
  const latestRace = heroRaces[0];
  const latestWinner = latestRace?.results?.find(r => r.posizione === 1);

  const recentRacesHtml = heroRaces.slice(0, 6).map((r, i) => {
    const w = r.results?.find(x => x.posizione === 1);
    const d = r.data ? new Date(r.data) : null;
    const dateStr = d ? \`\${d.getDate()} \${MONTHS_SHORT[d.getMonth()]}\` : '';
    const rcCode = getRankingFileCode({categoria:r.categoria, genere:r.genere, tipo:r.tipo});
    return \`<div class="em-race-row\${i===0?' em-race-row--latest':''}" onclick="location.hash='#/risultati/\${encodeURIComponent(r.id)}'">
      <span class="em-race-date">\${dateStr}</span>
      <div class="em-race-info">
        <span class="em-race-name">\${esc(r.nome)}</span>
        <span class="em-race-cat">\${catLabel(rcCode||'')}</span>
      </div>
      \${w ? \`<span class="em-race-winner">&#127945; \${esc(w.cognome)}</span>\` : ''}
    </div>\`;
  }).join('');

  // Context setter used by category banners
  window._heroSetContext = function(hubCode) {
    var appEl = document.getElementById('app');
    if (appEl) { appEl.style.transition = 'opacity .18s'; appEl.style.opacity = '0'; }
    setTimeout(function() {
      if (appEl) { appEl.style.transition = ''; appEl.style.opacity = ''; }
      activeHub = Object.assign({}, HUB_CONFIG[hubCode]);
      activeHub._code = hubCode;
      applyHubFilters(activeHub);
      try { localStorage.setItem('itcContext', hubCode); } catch(e) {}
      route();
    }, 190);
  };

  // Category banners builder
  var _catBannerDefs = [
    { label: 'ESORDIENTI', m: 'esordienti-m', f: 'esordienti-f',
      mG: 'linear-gradient(135deg,#1e1b4b,#4f46e5)', fG: 'linear-gradient(135deg,#3b0764,#7c3aed)' },
    { label: 'ALLIEVI',    m: 'allievi-m',    f: 'allievi-f',
      mG: 'linear-gradient(135deg,#052e16,#16a34a)', fG: 'linear-gradient(135deg,#3b0764,#7c3aed)' },
    { label: 'JUNIORES',   m: 'juniores-m',   f: 'juniores-f',
      mG: 'linear-gradient(135deg,#450a0a,#dc2626)', fG: 'linear-gradient(135deg,#500724,#be185d)' },
    { label: 'ELITE / U23', m: 'elite-m',     f: 'elite-f',
      mG: 'linear-gradient(135deg,#451a03,#b45309)', fG: 'linear-gradient(135deg,#500724,#e11d48)' }
  ];
  const catBannersHtml = '<section class="cat-banners">' +
    _catBannerDefs.map(function(d) {
      var mOn = activeHub && activeHub._code === d.m ? ' cat-banner-on' : '';
      var fOn = activeHub && activeHub._code === d.f ? ' cat-banner-on' : '';
      return '<div class="cat-banner">' +
        '<div class="cat-banner-half cat-banner-m' + mOn + '" style="background:' + d.mG + '" data-hub="' + d.m + '" onclick="window._heroSetContext(this.dataset.hub)">' +
          '<div class="cbi">' +
            '<div class="cbi-text">' +
              '<span class="cbi-name">' + d.label + '</span>' +
              '<span class="cbi-gender">&#9794; Maschile</span>' +
            '</div>' +
            '<span class="cbi-arrow">&#8594;</span>' +
          '</div>' +
        '</div>' +
        '<div class="cat-banner-slash">/</div>' +
        '<div class="cat-banner-half cat-banner-f' + fOn + '" style="background:' + d.fG + '" data-hub="' + d.f + '" onclick="window._heroSetContext(this.dataset.hub)">' +
          '<div class="cbi cbi-r">' +
            '<span class="cbi-arrow">&#8592;</span>' +
            '<div class="cbi-text cbi-text-r">' +
              '<span class="cbi-name">' + d.label + '</span>' +
              '<span class="cbi-gender">&#9792; Femminile</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</section>';

  const heroHtml = \`<section class="em-hero">
    <div class="em-hero-content">
      <div class="em-hero-left">
        <div class="em-eyebrow">IL CICLISMO AGONISTICO ITALIANO</div>
        <h1 class="em-title">ITALIA<span class="em-title-red">CRIT</span></h1>
        <p class="em-subtitle">Classifiche &middot; Risultati &middot; Storie &middot; Statistiche</p>
        \${latestWinner ? \`<div class="em-hero-winner">
          <span class="em-winner-label">ULTIMA VITTORIA</span>
          <span class="em-winner-name">\${esc(latestWinner.cognome)} \${esc(latestWinner.nome)}</span>
          <span class="em-winner-race">\${esc(latestRace.nome)}</span>
        </div>\` : ''}
        <div class="em-hero-ctas">
          <a href="#/classifica" class="em-btn-primary">Classifiche</a>
          <a href="#/risultati" class="em-btn-ghost">Risultati</a>
        </div>
      </div>
      <div class="em-hero-right">
        <div class="em-right-label">ULTIMI RISULTATI</div>
        <div class="em-race-feed">\${recentRacesHtml}</div>
        <a href="#/risultati" class="em-all-link">Tutti i risultati &rarr;</a>
      </div>
    </div>
    \${tickerItems.length ? \`<div class="em-ticker-bar"><div class="em-ticker-inner"><span class="em-ticker-track">\${[...tickerItems,...tickerItems].join(' &nbsp;&middot;&nbsp; ')}</span></div></div>\` : ''}
  </section>\`;`;

  src = src.slice(0, si + HERO_START.length) + NEW_HERO + src.slice(ei);
  console.log('✓ hero-restore (anchor-based)'); ok++;
} else {
  console.error('✗ hero-restore — anchors not found:', si, ei); fail++;
}

// ── 2. Add catBannersHtml after heroHtml in setPage ───────────────
replace('home-assemble-banners',
`  setPage(
    heroHtml +
    spotlightHtml +`,
`  setPage(
    heroHtml +
    catBannersHtml +
    spotlightHtml +`
);

fs.writeFileSync(appFile, src, 'utf8');
console.log('\n' + (fail ? '⚠' : '✅') + ' ' + ok + ' ok, ' + fail + ' failed — app.js updated');
