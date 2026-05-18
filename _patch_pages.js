// _patch_pages.js — Visual unification: add pg-header to Classifica, Statistiche, Calendario, Comparatore
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'app.js');
let src = fs.readFileSync(filePath, 'utf8');

let changes = 0;

// ── 1. renderClassifica — replace old h1 with pg-header ──────────────────────
const classOld = `    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:28px">Classifiche</h1>`;
const classNew = `    <div class="pg-header">
      <div class="pg-eyebrow">🏆 CLASSIFICA UFFICIALE</div>
      <h1 class="pg-title">CLASSIFICHE</h1>
    </div>`;
if (src.includes(classOld)) {
  src = src.replace(classOld, classNew);
  changes++;
  console.log('✓ renderClassifica: replaced old h1 with pg-header');
} else {
  console.error('✗ renderClassifica anchor NOT FOUND');
}

// ── 2. renderCalendario — replace old h1 with pg-header ──────────────────────
const calOld = `    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:28px">Calendario</h1>`;
const calNew = `    <div class="pg-header">
      <div class="pg-eyebrow">📅 STAGIONE 2025-2026</div>
      <h1 class="pg-title">CALENDARIO</h1>
    </div>`;
if (src.includes(calOld)) {
  src = src.replace(calOld, calNew);
  changes++;
  console.log('✓ renderCalendario: replaced old h1 with pg-header');
} else {
  console.error('✗ renderCalendario anchor NOT FOUND');
}

// ── 3. renderStatistiche — replace old h1 + p with pg-header ──────────────────
const statOld = `    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:8px">Statistiche</h1>
    <p style="color:var(--text-muted);margin-bottom:28px">Stagione 2026</p>`;
const statNew = `    <div class="pg-header">
      <div class="pg-eyebrow">📊 ANALISI & DATI</div>
      <h1 class="pg-title">STATISTICHE</h1>
    </div>`;
if (src.includes(statOld)) {
  src = src.replace(statOld, statNew);
  changes++;
  console.log('✓ renderStatistiche: replaced old h1 with pg-header');
} else {
  console.error('✗ renderStatistiche anchor NOT FOUND');
}

// ── 4. renderComparatore — replace old h1 + p with pg-header ──────────────────
const compOld = `    <h1 style="font-family:var(--font-display);font-size:var(--size-h1);margin-bottom:8px">Comparatore</h1>
    <p style="color:var(--text-muted);margin-bottom:24px">Confronta atleti o team della stessa categoria e genere</p>`;
const compNew = `    <div class="pg-header">
      <div class="pg-eyebrow">⚡ CONFRONTO ATLETI & TEAM</div>
      <h1 class="pg-title">COMPARATORE</h1>
    </div>
    <p style="color:var(--text-muted);margin-bottom:24px">Confronta atleti o team della stessa categoria e genere</p>`;
if (src.includes(compOld)) {
  src = src.replace(compOld, compNew);
  changes++;
  console.log('✓ renderComparatore: replaced old h1 with pg-header');
} else {
  console.error('✗ renderComparatore anchor NOT FOUND');
}

fs.writeFileSync(filePath, src, 'utf8');
console.log(`\nDone. ${changes}/4 replacements applied.`);
