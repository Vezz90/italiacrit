'use strict';
// Scraper automatico giornaliero per la PISTA VERA (velodromo, sectorId=2
// su members.federciclismo.it) — tipo:'pista', classifica separata dalla
// strada (vedi app.js updateRankTable/computeTeamRanking, che escludono
// esplicitamente tipo==='pista').
//
// Diversa dalla "Tipo Pista su strada" (server/pista-auto-import.js):
// una riunione ha PIÙ prove separate per categoria (Corsa a Punti, Scratch,
// Eliminazione, Tempo Race, Velocità, Km, Madison, Inseguimento, Keirin,
// Omnium...) — ognuna diventa una gara a sé (gara_id include l'evento).
// Ogni riga ha già il codice categoria nel nome ("COGNOME NOME - CODICE"),
// quindi la categoria/genere si risolve per riga, non dal tab (a differenza
// della strada dove serviva un fallback sull'etichetta).
//
// Decisioni utente (25/08):
//  - TUTTE le prove vengono importate (non solo Corsa a Punti/Scratch/
//    Eliminazione/Tempo Race).
//  - Giovanissimi (G1-G6) e Master/Amatori esclusi (non tracciati dal sito).
//  - Punteggio STANDARD (BASEPTS 15/12/10/8/6/5/4/3/2/1), non dimezzato:
//    chi fa più prove bene accumula più punti nella classifica pista, di
//    proposito (fa più sforzo). Nessun punti_override: si manda solo
//    punti_base, il server calcola punti_effettivi = punti_base*mult (mult=1).
//
// Come pista-auto-import.js: scrive in automatico SOLO le righe sicure
// (profilo esistente + team che combacia + categoria certa); il resto va
// in pista-vera-auto-review.json per revisione manuale. Stato persistito
// in pista-vera-auto-state.json per non ricontrollare riunioni già fatte.
//
// Uso: node pista-vera-auto-import.js [--dry-run] [--window-days N]

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
const DELAY_MS = 500;
const SECTOR_ID = 2; // Pista
const STATE_PATH = path.join(__dirname, 'pista-vera-auto-state.json');
const REVIEW_PATH = path.join(__dirname, 'pista-vera-auto-review.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const windowIdx = args.indexOf('--window-days');
const WINDOW_DAYS = windowIdx !== -1 ? parseInt(args[windowIdx + 1], 10) : 400; // riunioni pista sono poche/anno, finestra ampia

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!DRY_RUN && (!ADMIN_EMAIL || !ADMIN_PASSWORD)) {
  console.error('Imposta ADMIN_EMAIL e ADMIN_PASSWORD in server/.env.local (oppure usa --dry-run)');
  process.exit(1);
}

const BASEPTS = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };
const CAT_LABELS = {
  ES1_M: 'Esordienti 1° Anno', ES2_M: 'Esordienti 2° Anno',
  ES1_F: 'Esordienti 1° Anno', ES2_F: 'Esordienti 2° Anno',
  AL_M: 'Allievi', AL_F: 'Allieve',
  JUN_M: 'Juniores', JUN_F: 'Juniores',
  ELI_M: 'Elite-Under23', ELI_F: 'Elite-Under23',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDDMMYYYY(d) { return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`; }

function listUrl(startStr, endStr, page) {
  const [sd, sm, sy] = startStr.split('-');
  const [ed, em, ey] = endStr.split('-');
  return `https://members.federciclismo.it/race?sectorId=${SECTOR_ID}&StartDt=${sd}%2F${sm}%2F${sy}&EndDt=${ed}%2F${em}%2F${ey}&page=${page}`;
}

function parseListPage(html) {
  const items = [];
  const liRe = /<li>\s*<a href="\/race\/detail\/(\d+)\/">([\s\S]*?)<\/a>\s*<div class="btnGare/g;
  let m;
  while ((m = liRe.exec(html))) {
    const id = m[1];
    const inner = m[2];
    const h3 = (inner.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '';
    const spans = [...inner.matchAll(/<span>([\s\S]*?)<\/span>/g)].map(x => x[1]);
    items.push({
      id,
      data: (inner.match(/<span class="calData">([^<]*)<\/span>/) || [])[1] || '',
      nome: decodeEntities(h3.replace(/^[^-]+-\s*/, '')),
      livelloTipo: decodeEntities(spans[1] || ''),
    });
  }
  return items;
}

async function fetchAllListItems(startStr, endStr) {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(listUrl(startStr, endStr, page), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) break;
    const items = parseListPage(await res.text());
    if (!items.length) break;
    all.push(...items);
    page++;
    await sleep(DELAY_MS);
    if (page > 100) break;
  }
  return all;
}

function parseDetailPage(html) {
  const h1 = (html.match(/<a href="#" class="btnRisultati"><h1>([\s\S]*?)<\/h1>/) || [])[1] || '';
  const field = label => decodeEntities((html.match(new RegExp(`<span class="lblBlock">${label}:\\s*<b>([\\s\\S]*?)<\\/b>`)) || [])[1] || '');
  const header = { nome: decodeEntities(h1), regione: field('Regione'), luogo: field('Luogo') };

  const classIdx = html.indexOf('<h2>Classifiche</h2>');
  if (classIdx === -1) return { header, tabs: [] };
  const section = html.slice(classIdx);

  const tabMarkers = [];
  const tabRe = /<a href="#" class="btnRisultati"><b>([^<]*)<\/b><\/a>/g;
  let tm;
  while ((tm = tabRe.exec(section))) tabMarkers.push({ label: decodeEntities(tm[1]), idx: tm.index });

  const rowRe = /<span class="lblBlock" style="color:#29abe2!important"># (\d+)<\/span>\s*<span class="lblBlock">([^<]*)<\/span>\s*<span class="lblBlock">([^<]*)<\/span>/g;
  const rows = [];
  let rm;
  while ((rm = rowRe.exec(section))) {
    rows.push({ idx: rm.index, posizione: parseInt(rm[1], 10), nomeCode: decodeEntities(rm[2]), team: decodeEntities(rm[3]) });
  }

  const tabs = tabMarkers.map((t, i) => {
    const endIdx = i + 1 < tabMarkers.length ? tabMarkers[i + 1].idx : Infinity;
    const myRows = rows.filter(r => r.idx > t.idx && r.idx < endIdx);
    return { label: t.label, rows: myRows };
  });
  return { header, tabs };
}

// ── Codice dopo il trattino nel nome → categoria+genere (ogni riga ce l'ha) ─
const CODE_MAP = {
  ES: { cat: 'ES', genere: 'M', uncertainYear: true },
  AL: { cat: 'AL', genere: 'M', uncertainYear: false },
  JU: { cat: 'JUN', genere: 'M', uncertainYear: false },
  UN: { cat: 'ELI', genere: 'M', uncertainYear: false },
  EL: { cat: 'ELI', genere: 'M', uncertainYear: false },
  DA: { cat: 'AL', genere: 'F', uncertainYear: false },
  ED: { cat: 'ES', genere: 'F', uncertainYear: true },
  DJ: { cat: 'JUN', genere: 'F', uncertainYear: false },
  DU: { cat: 'ELI', genere: 'F', uncertainYear: false },
  DE: { cat: 'ELI', genere: 'F', uncertainYear: false },
};
const GIOVANISSIMI_RE = /^G[1-6][MF]$/;

// REG è un livello di licenza, non indica genere/categoria: come sulla
// strada, ripiega sull'etichetta del tab quando possibile.
function categoriaFromCodeOrLabel(code, tabLabel) {
  if (GIOVANISSIMI_RE.test(code)) return 'GIOVANISSIMI';
  if (CODE_MAP[code]) return CODE_MAP[code];
  const l = tabLabel.toLowerCase();
  const genere = /donne|femmin|allieve\b/.test(l) ? 'F' : 'M';
  if (/esordienti/.test(l)) return { cat: 'ES', genere, uncertainYear: true };
  if (/allie/.test(l)) return { cat: 'AL', genere, uncertainYear: false };
  if (/junior/.test(l)) return { cat: 'JUN', genere, uncertainYear: false };
  if (/elite|under\s*23/.test(l)) return { cat: 'ELI', genere, uncertainYear: false };
  return null;
}

// Prove a SQUADRE (Vel./Ins. Squadre, Team Sprint/Pursuit): verificato
// sull'HTML grezzo di Members che il dato sorgente ripete lo stesso nome
// 3-4 volte invece di elencare i reali componenti della squadra — non
// affidabile né per punteggio individuale né per squadra. Sentinel diverso
// da "sconosciuto" (null): va escluso SILENZIOSAMENTE, non in revisione.
const ESCLUSA_SQUADRE = 'ESCLUSA_SQUADRE';

function eventoFromLabel(label) {
  const raw = label.trim();
  const l = raw.toLowerCase();

  if (/squadr/.test(l)) return ESCLUSA_SQUADRE;

  // Sigle UCI a 2 lettere (Campionati Italiani/internazionali): genere+età
  // (ME/MJ/WE/WJ) + evento (PR/SP/EL/OM/K/SC/TS/TT/TP/IP/MD).
  const uciM = raw.match(/^(ME|MJ|WE|WJ)\s+(PR|SP|EL|OM|K|SC|TS|TT|TP|IP|MD)$/i);
  if (uciM) {
    const ev = uciM[2].toUpperCase();
    if (ev === 'TS' || ev === 'TP') return ESCLUSA_SQUADRE;
    return { PR: 'CORSA_A_PUNTI', SP: 'VELOCITA', EL: 'ELIMINAZIONE', OM: 'OMNIUM', K: 'KEIRIN', SC: 'SCRATCH', TT: 'KM', IP: 'INSEGUIMENTO', MD: 'MADISON' }[ev] || null;
  }
  // Stessa cosa in inglese esteso ("MEN ELITE ELIMINATION", "WOMEN U23 POINTS RACE"...)
  if (/^(men|women)\b/.test(l)) {
    if (/elimination/.test(l)) return 'ELIMINAZIONE';
    if (/points\s*race/.test(l)) return 'CORSA_A_PUNTI';
    if (/sprint/.test(l)) return 'VELOCITA';
    if (/scratch/.test(l)) return 'SCRATCH';
    if (/omnium/.test(l)) return 'OMNIUM';
    if (/keirin/.test(l)) return 'KEIRIN';
    if (/madison/.test(l)) return 'MADISON';
    if (/pursuit/.test(l)) return 'INSEGUIMENTO';
  }

  if (/tempo\s*r/.test(l)) return 'TEMPO_RACE';
  if (/corsa\s*p/.test(l)) return 'CORSA_A_PUNTI';
  if (/\bcp\b/.test(l)) return 'CORSA_A_PUNTI';
  if (/c\.\s*punti/.test(l)) return 'CORSA_A_PUNTI';
  if (/eliminazion|elimianzion|^elimina/.test(l)) return 'ELIMINAZIONE';
  if (/scratch/.test(l)) return 'SCRATCH';
  if (/veloc/.test(l)) return 'VELOCITA';
  if (/^ins|inseguiment/.test(l)) return 'INSEGUIMENTO';
  if (/keirin/.test(l)) return 'KEIRIN';
  if (/o[nm]nium/.test(l)) return 'OMNIUM'; // tollera il refuso "onmium"
  if (/madison|americana/.test(l)) return 'MADISON';
  if (/\bkm\b/.test(l)) return 'KM';

  const t = l.trim();
  // Etichetta che è SOLO la categoria (con "donne" prima o dopo, anche con
  // qualche refuso), senza indicare la prova — probabile classifica
  // combinata/finale della riunione (es. Omnium): non è la stessa cosa di
  // un tipo prova davvero irriconoscibile, va segnalata a parte.
  const hasEsor = /eso+rdient/.test(t), hasAllievi = /allie/.test(t), hasJun = /junior/.test(t), hasElite = /elite/.test(t);
  const catWordCount = [hasEsor, hasAllievi, hasJun, hasElite].filter(Boolean).length;
  if (catWordCount === 1 && t.split(/\s+/).length <= 5 && !/tappa|serata/.test(t)) return 'CLASSIFICA_CATEGORIA';

  const tappaM = t.match(/^(\d+)\s*tappa\b/);
  if (tappaM) return `TAPPA_${tappaM[1]}`;
  if (/tappa\s*final/.test(t)) return 'TAPPA_FINALE';

  const serataM = t.match(/(\d+)\s*[°ˆ^]?\s*serata/);
  if (serataM) return `SERATA_${serataM[1]}`;

  return null;
}

function splitNomeCognome(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { cognome: full.trim(), nome: '' };
  const nome = parts[parts.length - 1];
  const cognome = parts.slice(0, -1).join(' ');
  return { cognome, nome, ambiguous: parts.length > 3 };
}

function normForId(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
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

const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };
function parseItalianDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})$/i);
  if (!m) return null;
  const mese = MESI[m[2].toLowerCase()];
  return mese ? `${m[3]}-${pad2(mese)}-${pad2(m[1])}` : null;
}

async function loadKnownAthleteInfo() {
  const teamOf = new Map();
  const catOf = new Map();
  const knownIds = new Set();
  const addRoster = (obj) => {
    for (const [tid, b] of Object.entries(obj || {})) {
      for (const a of (b.atleti || [])) {
        if (!a.atleta_id) continue;
        knownIds.add(a.atleta_id);
        teamOf.set(a.atleta_id, b.nome || tid);
        if (a.categoria) catOf.set(a.atleta_id, a.categoria);
      }
    }
  };
  const resultsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8'));
  const byDate = new Map();
  for (const r of resultsRaw) {
    if (!r.atleta_id) continue;
    knownIds.add(r.atleta_id);
    if (!r.team) continue;
    const p = byDate.get(r.atleta_id);
    if (!p || (r.data || '') >= p.data) byDate.set(r.atleta_id, { data: r.data, team: r.team });
  }
  for (const [id, v] of byDate) teamOf.set(id, v.team);

  const athletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  for (const [id, a] of Object.entries(athletes)) {
    knownIds.add(id);
    if (a.team_attuale) teamOf.set(id, a.team_attuale);
    if (a.categoria) catOf.set(id, a.categoria);
  }
  const extraRoster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'extra_roster.json'), 'utf8'));
  addRoster(extraRoster);

  for (const url of ['https://italiacrit.onrender.com/api/data/pcs-extra-roster', 'https://italiacrit.onrender.com/api/data/manual-athletes']) {
    try { const r = await fetch(url); if (r.ok) addRoster(await r.json()); } catch {}
  }
  return { teamOf, catOf, knownIds };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('Login fallito: ' + (data.error || res.status));
  if (data.user?.role !== 'admin') throw new Error("L'account non ha ruolo admin");
  return data.token;
}

(async () => {
  const state = loadState();
  console.log('Carico anagrafica atleti conosciuti…');
  const knownInfo = await loadKnownAthleteInfo();
  console.log(`${knownInfo.knownIds.size} atleta_id noti.\n`);

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86400000);
  const startStr = fmtDDMMYYYY(start), endStr = fmtDDMMYYYY(end);

  console.log(`Scansione Members PISTA (sectorId=2) ${startStr} → ${endStr} …`);
  const list = await fetchAllListItems(startStr, endStr);
  console.log(`${list.length} riunioni pista nella finestra.\n`);

  const token = DRY_RUN ? null : await login();

  let written = 0, errors = 0;
  const reviewAll = [];

  for (const c of list) {
    const prev = state[c.id];
    if (prev && prev.status === 'imported') {
      reviewAll.push(...(prev.review || []).map(r => ({ ...r, garaNome: c.nome })));
      continue;
    }

    process.stdout.write(`[${c.id}] ${c.nome} (${c.data}) … `);
    let html;
    try {
      const res = await fetch(`https://members.federciclismo.it/race/detail/${c.id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      html = await res.text();
    } catch (e) {
      console.log(`errore rete (${e.message}), riprovo domani`);
      state[c.id] = { nome: c.nome, data: c.data, status: 'pending', lastChecked: new Date().toISOString() };
      continue;
    }
    const { header, tabs } = parseDetailPage(html);

    if (!tabs.length) {
      console.log('classifiche non ancora pubblicate, riprovo domani');
      state[c.id] = { nome: c.nome, data: c.data, status: 'pending', lastChecked: new Date().toISOString() };
      await sleep(DELAY_MS);
      continue;
    }

    const dataISO = parseItalianDate(c.data);
    if (!dataISO) {
      console.log(`data non riconosciuta ("${c.data}"), salto (non riprovo)`);
      state[c.id] = { nome: c.nome, data: c.data, status: 'imported', lastChecked: new Date().toISOString(), written: 0, review: [] };
      continue;
    }

    const nomeSlug = slugifyGaraName(header.nome || c.nome);
    const regione = header.regione || '';

    let raceWritten = 0;
    const raceReview = [];

    for (const tab of tabs) {
      const evento = eventoFromLabel(tab.label);

      // Prove a squadre: escluse SEMPRE e SILENZIOSAMENTE (vedi nota sopra
      // ESCLUSA_SQUADRE) — mai in revisione, a prescindere dalle categorie.
      if (evento === ESCLUSA_SQUADRE) continue;

      // Categoria/genere si risolve per RIGA (codice dopo il trattino nel
      // nome, con fallback sull'etichetta tab per REG) indipendentemente dal
      // tipo di prova — così un tab con evento non riconosciuto ma SOLO
      // Giovanissimi non finisce comunque in revisione (nessuna riga utile).
      const rows = tab.rows.map(r => {
        const codeSuffix = (r.nomeCode.match(/-\s*([A-Z0-9]+)$/) || [])[1] || '';
        const fullName = r.nomeCode.replace(/\s*-\s*[A-Z0-9]+$/, '');
        const { cognome, nome, ambiguous } = splitNomeCognome(fullName);
        const mapped = categoriaFromCodeOrLabel(codeSuffix, tab.label);
        const candidateId = normForId(fullName);
        const existingId = knownInfo.knownIds.has(candidateId) ? candidateId : null;
        return {
          posizioneOriginale: r.posizione, cognome, nome, team: r.team,
          categoria: (mapped && mapped !== 'GIOVANISSIMI') ? `${mapped.cat}_${mapped.genere}` : null,
          giovanissimi: mapped === 'GIOVANISSIMI',
          genere: (mapped && mapped !== 'GIOVANISSIMI') ? mapped.genere : null,
          uncertainYear: (mapped && mapped !== 'GIOVANISSIMI') ? mapped.uncertainYear : false,
          ambiguousNameSplit: !!ambiguous,
          existingAtletaId: existingId,
        };
      }).filter(row => !row.giovanissimi); // Giovanissimi esclusi, mai in revisione

      if (!rows.length) continue; // tab era solo Giovanissimi: niente da fare

      if (!evento) {
        // Tipo di prova non riconosciuto: le righe rimaste (non Giovanissimi)
        // vanno in revisione, non possiamo costruire un gara_id sensato.
        for (const r of rows) {
          raceReview.push({ garaId: null, posizione: r.posizioneOriginale, cognome: r.cognome, nome: r.nome, team: r.team, categoria: r.categoria, reason: `tipo prova non riconosciuto: "${tab.label}"` });
        }
        continue;
      }

      // Anno esordienti non specificato (codice ES/ED) ma risolvibile dal
      // profilo esistente — stessa regola generale della pista su strada.
      for (const row of rows) {
        if (row.uncertainYear && row.existingAtletaId) {
          const resolved = knownInfo.catOf.get(row.existingAtletaId);
          if (resolved && CAT_LABELS[resolved] && resolved.endsWith('_' + row.genere)) {
            row.categoria = resolved;
            row.uncertainYear = false;
          }
        }
      }

      // Raggruppa per categoria finale e rinumera dall'ordine relativo di
      // arrivo (stessa regola della pista su strada — copre sia i tab con
      // generi/anni misti sia una riga risolta su un anno diverso dal resto).
      const byCat = new Map();
      for (const row of rows) {
        const key = row.categoria || '__IGNOTA__';
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key).push(row);
      }

      for (const [cat, catRows] of byCat) {
        catRows.sort((a, b) => a.posizioneOriginale - b.posizioneOriginale);
        catRows.forEach((row, i) => { row.posizione = i + 1; });

        if (cat === '__IGNOTA__') {
          for (const row of catRows) {
            raceReview.push({ garaId: null, posizione: row.posizione, cognome: row.cognome, nome: row.nome, team: row.team, categoria: null, reason: 'codice categoria non riconosciuto' });
          }
          continue;
        }

        const garaId = `${nomeSlug}_${dataISO}_${evento}_${cat}`;
        for (const row of catRows) {
          const knownTeam = row.existingAtletaId ? knownInfo.teamOf.get(row.existingAtletaId) : null;
          const safe = row.existingAtletaId && !row.uncertainYear && !row.ambiguousNameSplit &&
                       knownTeam && teamsMatch(knownTeam, row.team);

          if (!safe) {
            const reason = !row.existingAtletaId ? 'nuovo/non abbinato'
              : row.uncertainYear ? 'anno esordienti incerto'
              : row.ambiguousNameSplit ? 'nome ambiguo (split incerto)'
              : !knownTeam ? 'team non noto sul sito'
              : 'team non combacia';
            raceReview.push({ garaId, posizione: row.posizione, cognome: row.cognome, nome: row.nome, team: row.team, categoria: cat, evento, reason, ...(knownTeam ? { teamNoto: knownTeam } : {}) });
            continue;
          }

          const body = {
            posizione: row.posizione, cognome: row.cognome, nome: row.nome, team: row.team,
            nome_gara: `${header.nome || c.nome} — ${tab.label}`, data: dataISO,
            categoria: CAT_LABELS[cat] || cat, genere: row.genere,
            tipo: 'pista', campionato_regionale: false, campionato_italiano: false, regione,
          };
          if (DRY_RUN) {
            console.log(`\n  [DRY] ${garaId} #${row.posizione} ${row.cognome} ${row.nome} [${BASEPTS[row.posizione] || 0}pt]`);
            raceWritten++; written++;
            continue;
          }
          try {
            const r2 = await fetch(`${BASE}/api/admin/gara/${encodeURIComponent(garaId)}/manual-result`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(body),
            });
            const d = await r2.json();
            if (!r2.ok) throw new Error(d.error || `HTTP ${r2.status}`);
            raceWritten++; written++;
          } catch (e) {
            errors++;
            console.error(`\n  ✗ ${garaId} #${row.posizione} ${row.cognome} ${row.nome}: ${e.message}`);
          }
          await sleep(DELAY_MS);
        }
      }
    }

    console.log(`${raceWritten} scritte, ${raceReview.length} da rivedere`);
    state[c.id] = { nome: c.nome, data: c.data, status: 'imported', lastChecked: new Date().toISOString(), written: raceWritten, review: raceReview };
    reviewAll.push(...raceReview.map(r => ({ ...r, garaNome: c.nome })));
    await sleep(DELAY_MS);
  }

  if (!DRY_RUN) saveState(state);
  fs.writeFileSync(REVIEW_PATH, JSON.stringify(reviewAll, null, 2));

  console.log(`\n=== ${DRY_RUN ? 'Simulazione' : 'Completato'} ===`);
  console.log(`Riunioni pista nella finestra: ${list.length}`);
  console.log(`Righe scritte in automatico: ${written}`);
  console.log(`Errori: ${errors}`);
  console.log(`Righe in attesa di revisione manuale (cumulativo): ${reviewAll.length}`);
  if (reviewAll.length) console.log(`Dettaglio: ${REVIEW_PATH}`);
})();
