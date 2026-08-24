'use strict';
// Rimuove le righe oltre il 5° posto dai risultati "Tipo Pista" appena
// scritti (pista-write.js): l'utente ha chiesto di premiare solo i primi 5,
// non tutta la classifica come per una gara normale — queste gare hanno
// poca partecipazione e punteggiare fino al 10° posto rischiava di
// destabilizzare le classifiche generali. I primi 5 restano invariati: i
// punti già assegnati (15/12/10/8/6) coincidono esattamente con la tabella
// richiesta, quindi non serve toccarli.

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
const DELAY_MS = 300;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Imposta ADMIN_EMAIL e ADMIN_PASSWORD in server/.env.local');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normForId(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}
function slugifyGaraName(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
const MESI = { gennaio:1, febbraio:2, marzo:3, aprile:4, maggio:5, giugno:6, luglio:7, agosto:8, settembre:9, ottobre:10, novembre:11, dicembre:12 };
function parseItalianDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})$/i);
  if (!m) return null;
  const mese = MESI[m[2].toLowerCase()];
  if (!mese) return null;
  return `${m[3]}-${String(mese).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}
const ALLOWED_CATS = new Set(['AL_M', 'AL_F', 'JUN_M', 'JUN_F', 'ELI_M', 'ELI_F']);

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('Login fallito: ' + (data.error || res.status));
  return data.token;
}

(async () => {
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'pista-import-report.json'), 'utf8'));

  // Stesso identico gara_id di pista-write.js, per sapere quali righe toccano
  // il nostro batch "Tipo Pista" e non altri risultati manuali del sito.
  const ourGaraIds = new Set();
  for (const race of report) {
    const dataISO = parseItalianDate(race.data);
    const slug = slugifyGaraName(race.nome);
    for (const tab of race.tabs) for (const row of tab.rows) {
      if (!ALLOWED_CATS.has(row.categoria)) continue;
      ourGaraIds.add(`${slug}_${dataISO}_${row.categoria}`);
    }
  }

  const res = await fetch(`${BASE}/api/data/manual-results`);
  const allManual = await res.json();
  const toDelete = allManual.filter(r => ourGaraIds.has(r.gara_id) && r.posizione > 5);

  console.log(`${toDelete.length} righe oltre il 5° posto da eliminare.\n`);
  if (!toDelete.length) { console.log('Niente da fare.'); return; }

  const token = await login();
  let done = 0, errors = 0;
  for (const row of toDelete) {
    try {
      const del = await fetch(`${BASE}/api/admin/manual-result/${row.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!del.ok) { const d = await del.json().catch(() => ({})); throw new Error(d.error || `HTTP ${del.status}`); }
      done++;
      console.log(`✓ eliminato #${row.posizione} ${row.cognome} ${row.nome} — ${row.gara_id}`);
    } catch (e) {
      errors++;
      console.error(`✗ errore id=${row.id} (${row.gara_id} #${row.posizione}): ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n=== Completato: ${done} eliminate, ${errors} errori ===`);
})();
