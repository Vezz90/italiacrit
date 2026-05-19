#!/usr/bin/env node
/**
 * Entry Experience patch — cinematic gender/category gateway,
 * context chip in navbar, localStorage persistence, route gate.
 */
const fs = require('fs');
const path = require('path');

const appFile    = path.join(__dirname, 'app.js');
const entryFuncs = fs.readFileSync(path.join(__dirname, '_entry_functions.js'), 'utf8');
let src = fs.readFileSync(appFile, 'utf8');
src = src.replace(/\r\n/g, '\n');

let ok = 0, fail = 0;
function replace(tag, oldStr, newStr) {
  if (src.includes(oldStr)) { src = src.replace(oldStr, newStr); console.log('✓', tag); ok++; }
  else { console.error('✗', tag, '— marker not found'); fail++; }
}

// ── 1. Inject entry functions before SI ENGINE marker ─────────────
const SI_MARKER = '// ── SPORT INTELLIGENCE ENGINE ──────────────────────────────';
replace('entry-functions', SI_MARKER, entryFuncs + '\n' + SI_MARKER);

// ── 2. Entry gate in route() — after hub routing block ────────────
replace('route-entry-gate',
`  // activeHub persists as global filter — cleared only by clearHubFilter()

  const match = (pattern) => {`,
`  // activeHub persists as global filter — cleared only by clearHubFilter()

  // Entry gate: show cinematic selector if no context stored
  if (_routeEntryGate()) return;

  const match = (pattern) => {`
);

// ── 3. Context chip update at end of setPage ──────────────────────
replace('setpage-chip',
`  app.innerHTML = \`<main class="page page-enter">\${_fb}\${html}</main>\`;
}`,
`  app.innerHTML = \`<main class="page page-enter">\${_fb}\${html}</main>\`;
  updateNavContextChip();
}`
);

// ── 4. clearHubFilter: set 'skip' so gate doesn't re-trigger ──────
replace('clearfilter-localstorage',
`window.clearHubFilter = function() {
  activeHub = null;`,
`window.clearHubFilter = function() {
  activeHub = null;
  try { localStorage.setItem('itcContext', 'skip'); } catch(e) {}`
);

fs.writeFileSync(appFile, src, 'utf8');
console.log('\n' + (fail ? '⚠' : '✅') + ' ' + ok + ' ok, ' + fail + ' failed — app.js updated');
