#!/usr/bin/env node
/**
 * Re-entry patch:
 * - Remove forced entry gate from route()
 * - Replace cinematic hero with unified homepage hero + inline contextual selector
 * - Repurpose openContextSwitcher to navigate home
 * - Add _softRestoreContext (restores localStorage context without blocking)
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

// ── 1. Remove entry gate from route(), add soft restore ───────────
replace('route-soft-restore',
`  // Entry gate: show cinematic selector if no context stored
  if (_routeEntryGate()) return;`,
`  // Restore saved context (no gate — users land directly on homepage)
  _softRestoreContext();`
);

// ── 2. Add _softRestoreContext near clearHubFilter ────────────────
replace('soft-restore-fn',
`window.clearHubFilter = function() {`,
`function _softRestoreContext() {
  if (activeHub) return;
  var _s;
  try { _s = localStorage.getItem('itcContext'); } catch(e) { return; }
  if (_s && _s !== 'skip' && HUB_CONFIG[_s]) {
    activeHub = Object.assign({}, HUB_CONFIG[_s]);
    activeHub._code = _s;
    applyHubFilters(activeHub);
  }
}

window.clearHubFilter = function() {`
);

// ── 3. Repurpose openContextSwitcher → navigate home ─────────────
replace('ctx-switcher-home',
`window.openContextSwitcher = function() {
  window._entryReturnHash = window.location.hash || '#/';
  renderEntry();
};`,
`window.openContextSwitcher = function() {
  window.location.hash = '#/';
  route();
};`
);

// ── 4. Replace hero section with cinematic hero + inline selector ─
// Uses anchor-based slice: from HERO_START to HERO_END
const HERO_START = '  // ── 1. HERO ──────────────────────────────────────────────────\n';
const HERO_END   = '\n\n  // ── 2. UOMO DEL MOMENTO ───────────────────────────────────────';
const si = src.indexOf(HERO_START);
const ei = src.indexOf(HERO_END);
if (si >= 0 && ei >= 0) {
  const NEW_HERO = `  // ── 1. HERO — cinematic with inline contextual selector ────────
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

  // Hero context selector helpers
  window._heroSwitchGender = function(gender) {
    var mC = document.getElementById('hcs-m'); var fC = document.getElementById('hcs-f');
    var mT = document.getElementById('hcs-tm'); var fT = document.getElementById('hcs-tf');
    if (!mC || !fC) return;
    if (gender === 'M') {
      mC.style.display = ''; fC.style.display = 'none';
      if (mT) { mT.classList.add('hcs-tab-on'); fT.classList.remove('hcs-tab-on'); }
    } else {
      fC.style.display = ''; mC.style.display = 'none';
      if (fT) { fT.classList.add('hcs-tab-on'); mT.classList.remove('hcs-tab-on'); }
    }
  };
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

  // Build inline selector
  var _curCode   = activeHub ? activeHub._code : null;
  var _curGender = (_curCode && _curCode.endsWith('-f')) ? 'F' : 'M';
  var _buildPills = function(cats) {
    return cats.map(function(c) {
      var on = _curCode === c.code;
      return '<button class="hcs-pill' + (on ? ' hcs-pill-on' : '') + '" style="--pill-c:' + c.color + '" onclick="window._heroSetContext(\\'' + c.code + '\\')">' + c.label + '</button>';
    }).join('');
  };
  var _selectorHtml =
    '<div class="home-hero-ctx">' +
      '<div class="hcs-gender-row">' +
        '<button id="hcs-tm" class="hcs-tab' + (_curGender==='M'?' hcs-tab-on':'') + '" onclick="window._heroSwitchGender(\'M\')">UOMINI</button>' +
        '<button id="hcs-tf" class="hcs-tab' + (_curGender==='F'?' hcs-tab-on':'') + '" onclick="window._heroSwitchGender(\'F\')">DONNE</button>' +
        (_curCode ? '<button class="hcs-reset" onclick="window.clearHubFilter()">&#10005; tutto</button>' : '') +
      '</div>' +
      '<div id="hcs-m" class="hcs-pills"' + (_curGender==='F' ? ' style="display:none"' : '') + '>' + _buildPills(ENTRY_CATS.M) + '</div>' +
      '<div id="hcs-f" class="hcs-pills"' + (_curGender==='M' ? ' style="display:none"' : '') + '>' + _buildPills(ENTRY_CATS.F) + '</div>' +
    '</div>';

  const heroHtml = \`<section class="home-hero">
    <div class="home-hero-bg"><div class="home-hero-glow"></div></div>
    <div class="home-hero-body">
      <div class="home-hero-left">
        <div class="hero-eyebrow">IL CICLISMO ITALIANO AGONISTICO</div>
        <h1 class="hero-headline">Italian Cycling<br><span class="hero-hl-accent">Lives Here.</span></h1>
        <p class="hero-subline">Every Category. Every Rivalry. Every Race.</p>
        \${_selectorHtml}
        <div class="hero-ctas">
          <a href="#/classifica" class="em-btn-primary">Classifiche</a>
          <a href="#/risultati" class="em-btn-ghost">Risultati</a>
        </div>
      </div>
      <div class="home-hero-right">
        <div class="em-right-label">ULTIMI RISULTATI</div>
        <div class="em-race-feed">\${recentRacesHtml}</div>
        <a href="#/risultati" class="em-all-link">Tutti i risultati &#8594;</a>
      </div>
    </div>
    \${tickerItems.length ? \`<div class="em-ticker-bar"><div class="em-ticker-inner"><span class="em-ticker-track">\${[...tickerItems,...tickerItems].join(' &nbsp;&#183;&nbsp; ')}</span></div></div>\` : ''}
  </section>\`;`;

  src = src.slice(0, si + HERO_START.length) + NEW_HERO + src.slice(ei);
  console.log('✓ hero-replace (anchor-based)'); ok++;
} else {
  console.error('✗ hero-replace — HERO_START or HERO_END not found:', si, ei); fail++;
}

fs.writeFileSync(appFile, src, 'utf8');
console.log('\n' + (fail ? '⚠' : '✅') + ' ' + ok + ' ok, ' + fail + ' failed — app.js updated');
