'use strict';
// Scraper automatico giornaliero per le gare "Tipo Pista su strada" da
// members.federciclismo.it. I risultati non sono garantiti disponibili
// subito dopo la gara (di solito 1-2 giorni di ritardo): ogni esecuzione
// scansiona una finestra mobile di date passate (WINDOW_DAYS) e, per ogni
// gara "Tipo Pista" ancora senza classifiche pubblicate, riprova al giro
// successivo — senza bisogno di nessun intervento manuale.
//
// Quando i risultati compaiono, scrive in automatico SOLO le righe
// "sicure":
//   - atleta con un profilo GIA' esistente sul sito (stesso confronto
//     sull'ID normalizzato dell'intero nome usato da pista-import.js,
//     indipendente da dove cade il confine cognome/nome)
//   - team dichiarato in gara che combacia (fuzzy) col team noto dal
//     profilo
//   - categoria certa, oppure anno Esordienti non specificato nel tab MA
//     risolvibile dalla categoria già registrata sul profilo esistente —
//     regola valida sia per i tab maschili "Esordienti"/"Arrivo
//     Esordienti" senza anno sia per "Donne Esordienti" (che non lo
//     specifica mai), resa qui permanente per entrambi i generi invece
//     che solo per le donne come nel primo giro manuale
//   - generi misti in un unico tab: ogni genere prende la propria
//     sequenza di posizioni rinumerata dall'ordine relativo di arrivo
//     (stessa regola degli scraper FCI ufficiali)
//
// Tutto il resto (atleti nuovi/non abbinati, team che non combaciano,
// nome ambiguo, anno esordienti ancora irrisolvibile) NON viene scritto:
// resta elencato in pista-auto-review.json per una conferma manuale, come
// fatto finora a mano gara per gara.
//
// Stato persistito in pista-auto-state.json: una gara con classifiche già
// completamente processate non viene ricontrollata ai giri successivi.
//
// Pensato per girare da Task Scheduler una volta al giorno (vedi
// run-pista-auto.ps1). Uso manuale:
//   node pista-auto-import.js [--dry-run] [--window-days N]

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
const STATE_PATH = path.join(__dirname, 'pista-auto-state.json');
const REVIEW_PATH = path.join(__dirname, 'pista-auto-review.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const windowIdx = args.indexOf('--window-days');
const WINDOW_DAYS = windowIdx !== -1 ? parseInt(args[windowIdx + 1], 10) : 60;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!DRY_RUN && (!ADMIN_EMAIL || !ADMIN_PASSWORD)) {
  console.error('Imposta ADMIN_EMAIL e ADMIN_PASSWORD in server/.env.local (oppure usa --dry-run)');
  process.exit(1);
}

const TOP5_POINTS = { 1: 7, 2: 6, 3: 5, 4: 4, 5: 3 };
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
  return `https://members.federciclismo.it/race?sectorId=0&StartDt=${sd}%2F${sm}%2F${sy}&EndDt=${ed}%2F${em}%2F${ey}&page=${page}`;
}

function parseListPage(html) {
  const items = [];
  const liRe = /<li>\s*<a href="\/race\/detail\/(\d+)\/">([\s\S]*?)<\/a>\s*<div class="btnGare/g;
  let m;
  while ((m = liRe.exec(html))) {
    const id = m[1];
    const inner = m[2];
    const h3 = (inner.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '';
    const h4 = (inner.match(/<h4>([\s\S]*?)<\/h4>/) || [])[1] || '';
    const spans = [...inner.matchAll(/<span>([\s\S]*?)<\/span>/g)].map(x => x[1]);
    items.push({
      id,
      data: (inner.match(/<span class="calData">([^<]*)<\/span>/) || [])[1] || '',
      nome: decodeEntities(h3.replace(/^[^-]+-\s*/, '')),
      classe: decodeEntities((h4.match(/Classe:\s*(.*)$/) || [])[1] || ''),
      luogo: decodeEntities(spans[0] || ''),
      livelloTipo: decodeEntities(spans[1] || ''),
    });
  }
  return items;
}

const SKIP_TAB_RE = /\bg[456]\b|giovaniss|dispari|pari\b/i;

function categoriaFromLabel(label) {
  const l = label.toLowerCase();
  if (SKIP_TAB_RE.test(l)) return null;
  if (/esordienti|esordiente/.test(l)) {
    if (/\b2\b|second/.test(l)) return { cat: 'ES2', uncertainYear: false };
    if (/\b1\b|prim/.test(l)) return { cat: 'ES1', uncertainYear: false };
    return { cat: 'ES1', uncertainYear: true };
  }
  if (/allie/.test(l)) return { cat: 'AL', uncertainYear: false };
  if (/junior/.test(l)) return { cat: 'JUN', uncertainYear: false };
  if (/elite|under\s*23|under23/.test(l)) return { cat: 'ELI', uncertainYear: false };
  return null;
}

// Fallback quando la label del tab non rivela la categoria (visto dal vivo:
// tab "classifica OMNIUM DJ/DA/ED1/ED2" — la riunione è organizzata a
// heat/omnium invece che un tab per categoria, e "OMNIUM" da solo non dice
// nulla su chi corre). La categoria è comunque scritta nel codice di ogni
// riga ("COGNOME NOME - DJ" ecc.), stesso schema già usato da
// pista-vera-scan.js per la pista vera — qui applicato anche alla pista su
// strada, dato che senza questo fallback l'intero tab veniva scartato come
// "categoria non riconosciuta" e la gara risultava "importata" con 0 righe
// scritte pur avendo categorie normalissime (non Giovanissimi). Le righe di
// un tab OMNIUM condividono sempre lo stesso codice, quindi basta guardare
// la prima riga per l'intero tab.
function categoriaFromRiderCode(code) {
  const m = String(code || '').toUpperCase().match(/^(ES|ED|AL|DA|JU|DJ|UN|EL|DU|DE)(\d)?$/);
  if (!m) return null;
  const [, base, yr] = m;
  if (base === 'ES' || base === 'ED') {
    if (yr === '1') return { cat: 'ES1', uncertainYear: false };
    if (yr === '2') return { cat: 'ES2', uncertainYear: false };
    return { cat: 'ES1', uncertainYear: true };
  }
  if (base === 'AL' || base === 'DA') return { cat: 'AL', uncertainYear: false };
  if (base === 'JU' || base === 'DJ') return { cat: 'JUN', uncertainYear: false };
  if (base === 'UN' || base === 'EL' || base === 'DU' || base === 'DE') return { cat: 'ELI', uncertainYear: false };
  return null;
}

function genereFromCode(code, tabLabel) {
  if (code && code !== 'REG' && /D/.test(code)) return 'F';
  if (/donne|femmin|allieve\b/i.test(tabLabel)) return 'F';
  return 'M';
}

function splitNomeCognome(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { cognome: full.trim(), nome: '' };
  const nome = parts[parts.length - 1];
  const cognome = parts.slice(0, -1).join(' ');
  return { cognome, nome, ambiguous: parts.length > 3 };
}

function parseDetailPage(html) {
  const h1 = (html.match(/<a href="#" class="btnRisultati"><h1>([\s\S]*?)<\/h1>/) || [])[1] || '';
  const field = label => decodeEntities((html.match(new RegExp(`<span class="lblBlock">${label}:\\s*<b>([\\s\\S]*?)<\\/b>`)) || [])[1] || '');
  const km = decodeEntities((html.match(/<p><label>KM:<\/label>\s*([^<]*)<\/p>/) || [])[1] || '');

  const header = {
    nome: decodeEntities(h1),
    regione: field('Regione'),
    luogo: field('Luogo'),
    categorieAmmesse: field('Categorie ammesse'),
    km,
  };

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
    if (page > 300) break;
  }
  return all;
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
  console.log('Carico anagrafica atleti conosciuti (results + roster + PCS + manuali)…');
  const knownInfo = await loadKnownAthleteInfo();
  console.log(`${knownInfo.knownIds.size} atleta_id noti.\n`);

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86400000);
  const startStr = fmtDDMMYYYY(start), endStr = fmtDDMMYYYY(end);

  console.log(`Scansione Members ${startStr} → ${endStr} …`);
  const list = await fetchAllListItems(startStr, endStr);
  const candidates = list.filter(g => /Tipo: Tipo Pista/.test(g.livelloTipo));
  console.log(`${candidates.length} gare "Tipo Pista" nella finestra.\n`);

  const token = DRY_RUN ? null : await login();

  let written = 0, errors = 0;
  const reviewAll = [];

  for (const c of candidates) {
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

    // Il nome della pagina elenco (c.nome) e quello della pagina dettaglio
    // (header.nome, l'h1) possono differire — visto concretamente su "4°
    // Trofeo Tecam": l'elenco lo riportava con un suffisso extra
    // ("TIPO PISTA FEMMINILE") assente dall'h1, producendo uno slug diverso
    // da quello già usato da tutti gli script precedenti e creando una gara
    // duplicata. header.nome è quello storicamente usato per lo slug (vedi
    // pista-import.js: report.push({...header}) sovrascrive nome con
    // quello dell'h1) — va usato SEMPRE per coerenza, con c.nome solo come
    // ripiego se l'h1 non si trova.
    const nomeCanonico = header.nome || c.nome;
    const nomeSlug = slugifyGaraName(nomeCanonico);
    const campionato_regionale = /CAMPIONATO REGIONALE/i.test(nomeCanonico);
    const campionato_italiano = /CAMPIONATO ITALIANO/i.test(nomeCanonico);
    const regione = header.regione || '';

    let raceWritten = 0;
    const raceReview = [];

    for (const tab of tabs) {
      let mapped = categoriaFromLabel(tab.label);
      if (!mapped && tab.rows.length) {
        const codeSuffix0 = (tab.rows[0].nomeCode.match(/-\s*([A-Z0-9]+)$/) || [])[1] || '';
        mapped = categoriaFromRiderCode(codeSuffix0);
      }
      if (!mapped) continue;
      const rows = tab.rows.map(r => {
        const codeSuffix = (r.nomeCode.match(/-\s*([A-Z0-9]+)$/) || [])[1] || '';
        const fullName = r.nomeCode.replace(/\s*-\s*[A-Z0-9]+$/, '');
        const { cognome, nome, ambiguous } = splitNomeCognome(fullName);
        const genere = genereFromCode(codeSuffix, tab.label);
        const candidateId = normForId(fullName);
        const existingId = knownInfo.knownIds.has(candidateId) ? candidateId : null;
        return {
          posizioneOriginale: r.posizione, cognome, nome, team: r.team,
          categoria: `${mapped.cat}_${genere}`, genere,
          ambiguousNameSplit: !!ambiguous,
          uncertainYear: mapped.uncertainYear,
          existingAtletaId: existingId,
        };
      });
      if (!rows.length) continue;

      // Anno esordienti non specificato nel tab, ma risolvibile dal profilo
      // esistente — regola generale (maschi E femmine), non solo donne.
      for (const row of rows) {
        if (row.uncertainYear && row.existingAtletaId) {
          const resolved = knownInfo.catOf.get(row.existingAtletaId);
          if (resolved && CAT_LABELS[resolved] && resolved.endsWith('_' + row.genere)) {
            row.categoria = resolved;
            row.uncertainYear = false;
          }
        }
      }

      // Raggruppa per categoria finale (dopo risoluzione anno) e rinumera
      // dall'ordine relativo di arrivo — copre sia il caso "tab con generi
      // misti" sia "riga risolta su un anno diverso dal default del tab".
      const byCat = new Map();
      for (const row of rows) { if (!byCat.has(row.categoria)) byCat.set(row.categoria, []); byCat.get(row.categoria).push(row); }

      for (const [cat, catRows] of byCat) {
        catRows.sort((a, b) => a.posizioneOriginale - b.posizioneOriginale);
        catRows.forEach((row, i) => { row.posizione = i + 1; });

        const garaId = `${nomeSlug}_${dataISO}_${cat}`;
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
            raceReview.push({ garaId, posizione: row.posizione, cognome: row.cognome, nome: row.nome, team: row.team, categoria: cat, reason, ...(knownTeam ? { teamNoto: knownTeam } : {}) });
            continue;
          }

          const body = {
            posizione: row.posizione, cognome: row.cognome, nome: row.nome, team: row.team,
            nome_gara: nomeCanonico, data: dataISO, categoria: CAT_LABELS[cat] || cat, genere: row.genere,
            tipo: 'tipo_pista', campionato_regionale, campionato_italiano, regione,
            punti_override: TOP5_POINTS[row.posizione] || 0,
          };
          if (DRY_RUN) {
            console.log(`\n  [DRY] ${garaId} #${row.posizione} ${row.cognome} ${row.nome}`);
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
  console.log(`Gare "Tipo Pista" nella finestra: ${candidates.length}`);
  console.log(`Righe scritte in automatico: ${written}`);
  console.log(`Errori: ${errors}`);
  console.log(`Righe in attesa di revisione manuale (cumulativo): ${reviewAll.length}`);
  if (reviewAll.length) console.log(`Dettaglio: ${REVIEW_PATH}`);
})();
