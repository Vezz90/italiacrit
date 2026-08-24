'use strict';
// Le "Donne Esordienti" del portale FCI Members non hanno mai un tab
// separato per anno (a differenza dei maschi, che hanno "Esordienti 1
// anno"/"2 anno" distinti) — un'unica lista "Donne Esordienti"/"ARRIVO
// DONNE ESORDIENTI"/ecc. senza indicare se 1° o 2° anno (uncertainYear
// nel report). Per chi ha già un profilo sul sito, la categoria è già
// nota (registrata quando il profilo è stato creato/aggiornato la prima
// volta) — usiamo QUELLA invece di lasciare la riga fuori. Chi non ha
// ancora un profilo resta "nuovo, da rivedere": non c'è modo di sapere
// il suo anno senza un profilo o un documento ufficiale (es. un PDF con
// le date di nascita, come fatto a mano per Trofeo Grafica 78).
//
// Uso:
//   node pista-write-donne-esordienti.js --dry-run
//   node pista-write-donne-esordienti.js

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const BASE = 'https://italiacrit.onrender.com';
const DELAY_MS = 600;
const DRY_RUN = process.argv.includes('--dry-run');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!DRY_RUN && (!ADMIN_EMAIL || !ADMIN_PASSWORD)) {
  console.error('Imposta ADMIN_EMAIL e ADMIN_PASSWORD in server/.env.local (oppure usa --dry-run)');
  process.exit(1);
}

const TOP5_POINTS = { 1: 7, 2: 6, 3: 5, 4: 4, 5: 3 };
const CAT_LABELS = { ES1_F: 'Esordienti 1° Anno', ES2_F: 'Esordienti 2° Anno' };

const MESI = { gennaio:1, febbraio:2, marzo:3, aprile:4, maggio:5, giugno:6, luglio:7, agosto:8, settembre:9, ottobre:10, novembre:11, dicembre:12 };
function parseItalianDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})$/i);
  if (!m) return null;
  const mese = MESI[m[2].toLowerCase()];
  return mese ? `${m[3]}-${String(mese).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : null;
}
function slugifyGaraName(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function squashTeam(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function teamsMatch(a, b) {
  const sa = squashTeam(a), sb = squashTeam(b);
  if (!sa || !sb) return false;
  return sa === sb || sa.includes(sb) || sb.includes(sa);
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('Login fallito: ' + (data.error || res.status));
  return data.token;
}

async function loadAthleteInfo() {
  const teamOf = new Map();
  const catOf = new Map();
  const addRoster = (obj) => {
    for (const [tid, b] of Object.entries(obj || {})) {
      for (const a of (b.atleti || [])) {
        if (!a.atleta_id) continue;
        teamOf.set(a.atleta_id, b.nome || tid);
        if (a.categoria) catOf.set(a.atleta_id, a.categoria);
      }
    }
  };
  const resultsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8'));
  const byDate = new Map();
  for (const r of resultsRaw) {
    if (!r.atleta_id || !r.team) continue;
    const p = byDate.get(r.atleta_id);
    if (!p || (r.data || '') >= p.data) byDate.set(r.atleta_id, { data: r.data, team: r.team });
  }
  for (const [id, v] of byDate) teamOf.set(id, v.team);

  const athletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  for (const [id, a] of Object.entries(athletes)) {
    if (a.team_attuale) teamOf.set(id, a.team_attuale);
    if (a.categoria) catOf.set(id, a.categoria);
  }
  const extraRoster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'extra_roster.json'), 'utf8'));
  addRoster(extraRoster);

  for (const url of ['https://italiacrit.onrender.com/api/data/pcs-extra-roster', 'https://italiacrit.onrender.com/api/data/manual-athletes']) {
    try { const r = await fetch(url); if (r.ok) addRoster(await r.json()); } catch {}
  }
  return { teamOf, catOf };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'pista-import-report.json'), 'utf8'));
  const { teamOf, catOf } = await loadAthleteInfo();

  const toWrite = [];
  const teamMismatch = [];
  const stillNew = [];

  for (const race of report) {
    const dataISO = parseItalianDate(race.data);
    if (!dataISO) continue;
    const nomeSlug = slugifyGaraName(race.nome);
    const campionato_regionale = /CAMPIONATO REGIONALE/i.test(race.nome);
    const campionato_italiano  = /CAMPIONATO ITALIANO/i.test(race.nome);

    for (const tab of race.tabs) {
      // Solo i tab "Donne Esordienti" con anno incerto — tutte le righe del
      // tab condividono lo stesso uncertainYear (è una proprietà del tab).
      const rows = tab.rows.filter(r => r.categoria.endsWith('_F') && r.categoria.startsWith('ES') && r.uncertainYear);
      if (!rows.length) continue;

      // Risolve la categoria reale (ES1_F/ES2_F) per chi ha già un profilo;
      // poi raggruppa per categoria RISOLTA e rinumera dall'ordine relativo
      // di arrivo (stessa regola del fix generi misti: non riusare la
      // posizione grezza del tab combinato).
      const byResolvedCat = new Map();
      for (const row of rows) {
        const resolved = row.existingAtletaId ? catOf.get(row.existingAtletaId) : null;
        if (!resolved || !CAT_LABELS[resolved]) { stillNew.push({ race: race.nome, row }); continue; }
        if (!byResolvedCat.has(resolved)) byResolvedCat.set(resolved, []);
        byResolvedCat.get(resolved).push(row);
      }

      for (const [cat, catRows] of byResolvedCat) {
        catRows.sort((a, b) => a.posizione - b.posizione);
        const garaId = `${nomeSlug}_${dataISO}_${cat}`;
        catRows.forEach((row, i) => {
          const posizione = i + 1;
          const item = { garaId, race: race.nome, regione: race.regione, dataISO, cat, row, posizione, campionato_regionale, campionato_italiano };
          const knownTeam = teamOf.get(row.existingAtletaId);
          if (knownTeam && !teamsMatch(knownTeam, row.team)) { teamMismatch.push({ ...item, knownTeam }); return; }
          toWrite.push(item);
        });
      }
    }
  }

  console.log(`Da scrivere (categoria risolta dal profilo esistente, nome+team verificati): ${toWrite.length}`);
  console.log(`Team non coincidente (NON scritti): ${teamMismatch.length}`);
  console.log(`Ancora nuove/senza profilo (NON scritte, da rivedere): ${stillNew.length}\n`);

  if (teamMismatch.length) {
    console.log('=== TEAM NON COINCIDENTE ===');
    for (const m of teamMismatch) console.log(`  ${m.row.cognome} ${m.row.nome} [${m.row.existingAtletaId}] — team gara: "${m.row.team}" ≠ team noto: "${m.knownTeam}"`);
    console.log('');
  }
  if (stillNew.length) {
    console.log('=== ANCORA NUOVE (nessun profilo, anno non determinabile) ===');
    for (const n of stillNew) console.log(`  ${n.row.cognome} ${n.row.nome} — ${n.row.team} — ${n.race} (#${n.row.posizione})`);
    console.log('');
  }

  if (DRY_RUN) { console.log('(--dry-run: nessuna scrittura)'); return; }

  const token = await login();
  let written = 0, errors = 0;
  for (const item of toWrite) {
    const { garaId, row, cat, posizione, regione, campionato_regionale, campionato_italiano } = item;
    const body = {
      posizione, cognome: row.cognome, nome: row.nome, team: row.team,
      nome_gara: item.race, data: item.dataISO, categoria: CAT_LABELS[cat], genere: 'F',
      tipo: 'tipo_pista', campionato_regionale, campionato_italiano, regione: regione || '',
      punti_override: TOP5_POINTS[posizione] || 0,
    };
    try {
      const res = await fetch(`${BASE}/api/admin/gara/${encodeURIComponent(garaId)}/manual-result`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      written++;
      console.log(`✓ ${garaId} #${posizione} ${row.cognome} ${row.nome}`);
    } catch (e) {
      errors++;
      console.error(`✗ ${garaId} #${posizione} ${row.cognome} ${row.nome}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`\n=== Completato: ${written} scritte, ${errors} errori ===`);
})();
