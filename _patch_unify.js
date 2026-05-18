#!/usr/bin/env node
/**
 * Re-unification patch — removes hub fragmentation, adds global filter bar,
 * compact category strip on homepage, persistent filter with explicit clear.
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

// ── 1. Hub routes: no more separate hub home — set filter, go to classifica ──
replace('route-hub-home',
`  // Hub contextual routes
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
  activeHub = null;`,
`  // Hub filter routes — apply context filter then render the target page
  if (hash.startsWith('#/hub/')) {
    const hubParts = hash.slice(6).split('/');
    const hubCode = hubParts[0];
    const hubSub  = hubParts[1] || '';
    if (HUB_CONFIG[hubCode]) {
      activeHub = HUB_CONFIG[hubCode];
      activeHub._code = hubCode;
      applyHubFilters(HUB_CONFIG[hubCode]);
      // No hub homepage — go directly to filtered classifica
      if (!hubSub || hubSub === 'home') return renderClassifica();
      return renderHubSubpage(hubCode, hubSub);
    }
  }
  // activeHub persists as global filter — cleared only by clearHubFilter()`
);

// ── 2. setPage: replace subnav with slim global filter bar ─────────────
replace('setpage-filterbar',
`  const _hubNav = (typeof activeHub !== 'undefined' && activeHub) ? buildHubSubnav(activeHub) : '';
  app.innerHTML = \`<main class="page page-enter">\${_hubNav}\${html}</main>\`;`,
`  const _fb = (typeof activeHub !== 'undefined' && activeHub)
    ? '<div class="global-filter-bar" style="--hub-color:' + activeHub.color + '">' +
        '<span class="gfb-dot"></span>' +
        '<span class="gfb-label">' + activeHub.icon + ' ' + activeHub.label + '</span>' +
        '<button class="gfb-clear" onclick="window.clearHubFilter()">✕ Tutto</button>' +
      '</div>'
    : '';
  app.innerHTML = \`<main class="page page-enter">\${_fb}\${html}</main>\`;`
);

// ── 3. Homepage: replace large network section with compact category strip ──
replace('home-catstrip',
`    buildNetworkSection(resultsRaw, calendar)`,
`    buildCategoryStrip()`
);

// ── 4. Inject clearHubFilter + buildCategoryStrip before SI ENGINE marker ─
const SI_MARKER = '// ── SPORT INTELLIGENCE ENGINE ──────────────────────────────';
replace('helpers-inject', SI_MARKER,
`// ── GLOBAL FILTER HELPERS ─────────────────────────────────────────
window.clearHubFilter = function() {
  activeHub = null;
  rankGender = 'M'; rankCat = 'ES1_M'; rankFilter = ''; rankRegion = ''; rankMonth = '';
  atlGender = 'M'; atlCat = 'JUN_M'; atlSearch = '';
  teamGender = 'M'; teamCat = 'JUN_M'; teamSearch = '';
  risQueryGenere = ''; risQueryCat = ''; risQueryMonth = ''; risQueryRegion = ''; risSearchQuery = '';
  calQGenere = ''; calQCat = ''; calQMonth = ''; calQSearch = ''; calQTipo = ''; calQRegione = '';
  route();
};

function buildCategoryStrip() {
  const cats = [
    { code:'elite-m',      label:'Elite/U23 ♂', color:'#F59E0B' },
    { code:'juniores-m',   label:'Juniores ♂',  color:'#E11D48' },
    { code:'allievi-m',    label:'Allievi ♂',   color:'#10B981' },
    { code:'esordienti-m', label:'Esord. ♂',    color:'#6366F1' },
    { code:'elite-f',      label:'Elite/U23 ♀', color:'#F472B6' },
    { code:'juniores-f',   label:'Juniores ♀',  color:'#F43F5E' },
    { code:'allievi-f',    label:'Allieve ♀',   color:'#8B5CF6' },
    { code:'esordienti-f', label:'Esord. ♀',    color:'#A78BFA' },
  ];
  return '<div class="cat-filter-strip">' +
    '<span class="cat-filter-label">ESPLORA</span>' +
    '<div class="cat-filter-chips">' +
      cats.map(function(c) {
        return '<a href="#/hub/' + c.code + '/classifica" class="cat-chip" style="--chip-color:' + c.color + '">' + c.label + '</a>';
      }).join('') +
    '</div>' +
  '</div>';
}

` + SI_MARKER
);

fs.writeFileSync(appFile, src, 'utf8');
console.log('\n' + (fail ? '⚠' : '✅') + ' ' + ok + ' ok, ' + fail + ' failed — app.js updated');
