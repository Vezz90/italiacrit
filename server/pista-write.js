'use strict';
// Scrive nel sito (tabella manual_results, via l'endpoint admin già esistente
// POST /api/admin/gara/:garaId/manual-result — stesso usato dal pannello per
// correggere/aggiungere risultati a mano) i risultati "Tipo Pista su strada"
// estratti da pista-import.js, SOLO per le categorie non-Esordienti
// (Allievi/Juniores/Elite — l'utente ha chiesto di tenere fuori gli
// Esordienti per ora, in attesa di ulteriori verifiche sui nomi).
//
// Gira contro il backend deployato (serve ADMIN_EMAIL/ADMIN_PASSWORD in
// server/.env.local), stesso pattern di backfill-gara-narratives.js.
//
// Uso:
//   node pista-write.js                 → scrive tutte le gare non-Esordienti
//   node pista-write.js --race 181396    → solo una gara (test mirato)
//   node pista-write.js --dry-run        → stampa cosa scriverebbe, non scrive nulla

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

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const raceFilterIdx = args.indexOf('--race');
const RACE_FILTER = raceFilterIdx !== -1 ? args[raceFilterIdx + 1] : null;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!DRY_RUN && (!ADMIN_EMAIL || !ADMIN_PASSWORD)) {
  console.error('Imposta ADMIN_EMAIL e ADMIN_PASSWORD in server/.env.local (oppure usa --dry-run)');
  process.exit(1);
}

// Solo queste categorie in questo giro — niente Esordienti (ES1_*/ES2_*).
const ALLOWED_CATS = new Set(['AL_M', 'AL_F', 'JUN_M', 'JUN_F', 'ELI_M', 'ELI_F']);

// "Tipo Pista" ha poca partecipazione e non è rappresentativa come una gara
// normale (gli scalatori/specialisti di solito non ci sono, corrono quasi
// solo velocisti) — su richiesta dell'utente: solo i primi 5, a punteggio
// dimezzato rispetto alla tabella standard (15/12/10/8/6), arrotondato per
// difetto dove serve (7,5 → 7) per non avere punteggi con la virgola.
const TOP5_POINTS = { 1: 7, 2: 6, 3: 5, 4: 4, 5: 3 };

const CAT_LABELS = {
  AL_M: 'Allievi', AL_F: 'Allieve',
  JUN_M: 'Juniores', JUN_F: 'Juniores',
  ELI_M: 'Elite-Under23', ELI_F: 'Elite-Under23',
};

const MESI = { gennaio:1, febbraio:2, marzo:3, aprile:4, maggio:5, giugno:6, luglio:7, agosto:8, settembre:9, ottobre:10, novembre:11, dicembre:12 };
function parseItalianDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})$/i);
  if (!m) return null;
  const mese = MESI[m[2].toLowerCase()];
  if (!mese) return null;
  return `${m[3]}-${String(mese).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

function slugifyGaraName(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('Login fallito: ' + (data.error || res.status));
  if (data.user?.role !== 'admin') throw new Error("L'account non ha ruolo admin");
  return data.token;
}

(async () => {
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'pista-import-report.json'), 'utf8'));
  const token = DRY_RUN ? null : await login();

  let planned = 0, written = 0, skippedEsordienti = 0, errors = 0;

  for (const race of report) {
    if (RACE_FILTER && race.garaFciId !== RACE_FILTER) continue;
    const dataISO = parseItalianDate(race.data);
    if (!dataISO) { console.warn(`Salto ${race.nome}: data non riconosciuta "${race.data}"`); continue; }
    const nomeSlug = slugifyGaraName(race.nome);
    const campionato_regionale = /CAMPIONATO REGIONALE/i.test(race.nome);
    const campionato_italiano  = /CAMPIONATO ITALIANO/i.test(race.nome);

    for (const tab of race.tabs) {
      // Tutte le righe di un tab condividono la categoria SALVO quando il tab
      // mescola generi (vedi pista-import.js) — raggruppa per categoria reale
      // per gara_id: una gara_id per (gara, categoria, genere).
      const byCat = new Map();
      for (const row of tab.rows) {
        if (!ALLOWED_CATS.has(row.categoria)) { skippedEsordienti++; continue; }
        if (!byCat.has(row.categoria)) byCat.set(row.categoria, []);
        byCat.get(row.categoria).push(row);
      }

      for (const [cat, rows] of byCat) {
        const genere = cat.endsWith('_F') ? 'F' : 'M';
        const garaId = `${nomeSlug}_${dataISO}_${cat}`;

        for (const row of rows) {
          if (row.posizione > 5) continue; // solo i primi 5 (vedi TOP5_POINTS sopra)
          planned++;
          const body = {
            posizione: row.posizione,
            cognome: row.cognome,
            nome: row.nome,
            team: row.team,
            nome_gara: race.nome,
            data: dataISO,
            categoria: CAT_LABELS[cat] || cat,
            genere,
            tipo: 'tipo_pista',
            campionato_regionale,
            campionato_italiano,
            regione: race.regione || '',
            punti_override: TOP5_POINTS[row.posizione],
          };
          if (DRY_RUN) {
            console.log(`[DRY] ${garaId} — #${row.posizione} ${row.cognome} ${row.nome} (${row.team}) [${body.punti_override}pt]${row.existingAtletaId ? ' → ' + row.existingAtletaId : ' → NUOVO'}`);
            continue;
          }
          try {
            const res = await fetch(`${BASE}/api/admin/gara/${encodeURIComponent(garaId)}/manual-result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            written++;
            process.stdout.write(`✓ ${garaId} #${row.posizione} ${row.cognome} ${row.nome}\n`);
          } catch (e) {
            errors++;
            console.error(`✗ ${garaId} #${row.posizione} ${row.cognome} ${row.nome}: ${e.message}`);
          }
          await sleep(DELAY_MS);
        }
      }
    }
  }

  console.log(`\n=== ${DRY_RUN ? 'Simulazione' : 'Completato'} ===`);
  console.log(`Righe pianificate: ${planned}`);
  if (!DRY_RUN) { console.log(`Scritte: ${written}`); console.log(`Errori: ${errors}`); }
  console.log(`Esordienti saltati (tenuti fuori da questo giro): ${skippedEsordienti}`);
})();
