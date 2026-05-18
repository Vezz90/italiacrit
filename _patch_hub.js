#!/usr/bin/env node
/**
 * Multi-Hub System patch — inserts hub routing, hub functions, subnav injection,
 * and network section on global homepage.
 */
const fs = require('fs');
const path = require('path');

const appFile   = path.join(__dirname, 'app.js');
const hubFuncs  = fs.readFileSync(path.join(__dirname, '_hub_functions.js'), 'utf8');
let src = fs.readFileSync(appFile, 'utf8');

// Normalize CRLF → LF
src = src.replace(/\r\n/g, '\n');

let ok = 0, fail = 0;
function replace(tag, oldStr, newStr) {
  if (src.includes(oldStr)) {
    src = src.replace(oldStr, newStr);
    console.log('✓', tag);
    ok++;
  } else {
    console.error('✗', tag, '— marker not found');
    fail++;
  }
}

// ── 1. Insert hub functions before the HOME render function ────────────
const HOME_RENDER_MARKER = '// ── SPORT INTELLIGENCE ENGINE ──────────────────────────────';
replace('hub-functions', HOME_RENDER_MARKER, hubFuncs + '\n' + HOME_RENDER_MARKER);

// ── 2. Add hub routing inside route() — after updateNavActive call ─────
replace('route-hub',
`function route() {
  const hash = window.location.hash || '#/';
  updateNavActive(hash);

  const match = (pattern) => {`,
`function route() {
  const hash = window.location.hash || '#/';
  updateNavActive(hash);

  // Hub contextual routes
  if (hash.startsWith('#/hub/')) {
    const hubParts = hash.slice(6).split('/');
    const hubCode = hubParts[0];
    const hubSub  = hubParts[1] || '';
    if (HUB_CONFIG[hubCode]) {
      if (!hubSub || hubSub === 'home') return renderHubHome(hubCode);
      return renderHubSubpage(hubCode, hubSub);
    }
  }
  // Clear hub context for all non-hub routes
  activeHub = null;

  const match = (pattern) => {`
);

// ── 3. Inject hub subnav into setPage ─────────────────────────────────
replace('setpage-subnav',
`function setPage(html) {
  if (window.homeHeroInterval) {
    clearInterval(window.homeHeroInterval);
    window.homeHeroInterval = null;
  }
  app.innerHTML = \`<main class="page page-enter">\${html}</main>\`;
}`,
`function setPage(html) {
  if (window.homeHeroInterval) {
    clearInterval(window.homeHeroInterval);
    window.homeHeroInterval = null;
  }
  const _hubNav = (typeof activeHub !== 'undefined' && activeHub) ? buildHubSubnav(activeHub) : '';
  app.innerHTML = \`<main class="page page-enter">\${_hubNav}\${html}</main>\`;
}`
);

// ── 4. Add network section at the end of renderHome ASSEMBLE ──────────
replace('home-network',
`    versusHtml +
    volandoHtml +
    upcomingHtml
  );
}`,
`    versusHtml +
    volandoHtml +
    upcomingHtml +
    buildNetworkSection(resultsRaw, calendar)
  );
}`
);

fs.writeFileSync(appFile, src, 'utf8');
console.log('\n' + (fail ? '⚠' : '✅') + ' ' + ok + ' ok, ' + fail + ' failed — app.js updated');
