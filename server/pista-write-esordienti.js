'use strict';
// Import Esordienti (ES1/ES2) dalle gare "Tipo Pista" — stessa logica di
// pista-write.js (top 5, punteggio dimezzato 7/6/5/4/3, tipo='tipo_pista')
// ma con due regole in più chieste dall'utente:
//
// 1. Tenute fuori SOLO le righe femminili con anno incerto (tab "Donne
//    Esordienti" non specifica 1°/2° anno) — le maschili con anno incerto
//    ("ESORDIENTI"/"ARRIVO ESORDIENTI" senza distinzione) procedono, come
//    le altre categorie già scritte.
// 2. Per i corridori già abbinati a un profilo esistente: verifica che il
//    TEAM combaci (non solo il nome) prima di scrivere — un nome uguale in
//    un team diverso è probabilmente un omonimo, non la stessa persona.
//    Solo i match con nome+team coerenti vengono scritti; il resto va in
//    un report per revisione manuale, mai scritto.
// 3. I corridori SENZA profilo esistente ("nuovi") non vengono scritti per
//    niente in questo giro: solo elencati in un report, per decidere a
//    mano chi sono davvero prima di creare un profilo.
//
// Uso:
//   node pista-write-esordienti.js --dry-run   → solo report, nessuna scrittura
//   node pista-write-esordienti.js              → scrive i match verificati

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
const CAT_LABELS = { ES1_M: 'Esordienti 1° Anno', ES1_F: 'Esordienti 1° Anno', ES2_M: 'Esordienti 2° Anno', ES2_F: 'Esordienti 2° Anno' };

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

// Team attuale conosciuto per ogni atleta_id, dalle stesse 5 fonti usate per
// verificare l'esistenza del profilo (vedi loadKnownAthleteIds in pista-import.js).
async function loadKnownTeams() {
  const teamOf = new Map();
  const addRoster = (obj) => {
    for (const [teamId, bucket] of Object.entries(obj || {})) {
      for (const a of (bucket.atleti || [])) if (a.atleta_id) teamOf.set(a.atleta_id, bucket.nome || teamId);
    }
  };
  const resultsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8'));
  // Più recente per data vince
  const byDate = new Map();
  for (const r of resultsRaw) {
    if (!r.atleta_id || !r.team) continue;
    const prev = byDate.get(r.atleta_id);
    if (!prev || (r.data || '') >= prev.data) byDate.set(r.atleta_id, { data: r.data, team: r.team });
  }
  for (const [id, v] of byDate) teamOf.set(id, v.team);

  const athletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  for (const [id, a] of Object.entries(athletes)) if (a.team_attuale) teamOf.set(id, a.team_attuale);

  const extraRoster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'extra_roster.json'), 'utf8'));
  addRoster(extraRoster);

  for (const url of ['https://italiacrit.onrender.com/api/data/pcs-extra-roster', 'https://italiacrit.onrender.com/api/data/manual-athletes']) {
    try { const r = await fetch(url); if (r.ok) addRoster(await r.json()); } catch {}
  }
  return teamOf;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'pista-import-report.json'), 'utf8'));
  const teamOf = await loadKnownTeams();

  const toWrite = [];       // match verificato nome+team → si scrive
  const teamMismatch = [];  // stesso atleta_id ma team diverso → NON si scrive, da rivedere
  const newAthletes = [];   // nessun profilo esistente → NON si scrive, solo elencato

  for (const race of report) {
    const dataISO = parseItalianDate(race.data);
    if (!dataISO) continue;
    const nomeSlug = slugifyGaraName(race.nome);
    const campionato_regionale = /CAMPIONATO REGIONALE/i.test(race.nome);
    const campionato_italiano  = /CAMPIONATO ITALIANO/i.test(race.nome);

    for (const tab of race.tabs) {
      const byCat = new Map();
      for (const row of tab.rows) {
        if (!row.categoria.startsWith('ES')) continue; // solo Esordienti in questo script
        if (row.categoria.endsWith('_F') && row.uncertainYear) continue; // donne esordienti anno incerto: fuori
        if (row.posizione > 5) continue;
        if (!byCat.has(row.categoria)) byCat.set(row.categoria, []);
        byCat.get(row.categoria).push(row);
      }
      for (const [cat, rows] of byCat) {
        const genere = cat.endsWith('_F') ? 'F' : 'M';
        const garaId = `${nomeSlug}_${dataISO}_${cat}`;
        for (const row of rows) {
          const item = { garaId, race: race.nome, regione: race.regione, dataISO, cat, genere, row, campionato_regionale, campionato_italiano };
          if (!row.existingAtletaId) { newAthletes.push(item); continue; }
          const knownTeam = teamOf.get(row.existingAtletaId);
          if (knownTeam && !teamsMatch(knownTeam, row.team)) {
            teamMismatch.push({ ...item, knownTeam });
            continue;
          }
          toWrite.push(item);
        }
      }
    }
  }

  console.log(`Da scrivere (nome+team verificati): ${toWrite.length}`);
  console.log(`Team non coincidente (NON scritti, da rivedere): ${teamMismatch.length}`);
  console.log(`Nuovi senza profilo (NON scritti, solo elencati): ${newAthletes.length}\n`);

  if (teamMismatch.length) {
    console.log('=== TEAM NON COINCIDENTE ===');
    for (const m of teamMismatch) {
      console.log(`  ${m.row.cognome} ${m.row.nome} [${m.row.existingAtletaId}] — team gara: "${m.row.team}" ≠ team noto: "${m.knownTeam}" (${m.race}, #${m.row.posizione})`);
    }
    console.log('');
  }

  if (newAthletes.length) {
    console.log('=== NUOVI (nessun profilo trovato) ===');
    for (const n of newAthletes) {
      console.log(`  ${n.row.cognome} ${n.row.nome} — ${n.row.team} — ${n.cat} — ${n.race} (#${n.row.posizione})`);
    }
    console.log('');
  }

  fs.writeFileSync(path.join(__dirname, 'pista-esordienti-review.json'), JSON.stringify({ toWrite, teamMismatch, newAthletes }, null, 2));

  if (DRY_RUN) { console.log('(--dry-run: nessuna scrittura)'); return; }

  const token = await login();
  let written = 0, errors = 0;
  for (const item of toWrite) {
    const { garaId, row, cat, genere, regione, campionato_regionale, campionato_italiano } = item;
    const body = {
      posizione: row.posizione, cognome: row.cognome, nome: row.nome, team: row.team,
      nome_gara: item.race, data: item.dataISO, categoria: CAT_LABELS[cat] || cat, genere,
      tipo: 'tipo_pista', campionato_regionale, campionato_italiano, regione: regione || '',
      punti_override: TOP5_POINTS[row.posizione],
    };
    try {
      const res = await fetch(`${BASE}/api/admin/gara/${encodeURIComponent(garaId)}/manual-result`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      written++;
      console.log(`✓ ${garaId} #${row.posizione} ${row.cognome} ${row.nome}`);
    } catch (e) {
      errors++;
      console.error(`✗ ${garaId} #${row.posizione} ${row.cognome} ${row.nome}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`\n=== Completato: ${written} scritte, ${errors} errori ===`);
})();
