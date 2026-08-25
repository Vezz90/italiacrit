'use strict';
// Estrae (SOLA LETTURA — nessuna scrittura) i risultati delle gare di PISTA
// VERA (velodromo, sectorId=2 su members.federciclismo.it) — diversa dalle
// "Tipo Pista su strada" già importate (sectorId=0, tipo='tipo_pista'). Una
// riunione su pista ha PIÙ prove separate per categoria (Tempo Race, Corsa
// a Punti, Eliminazione, Scratch...) invece di un'unica classifica come nei
// criterium — ognuna diventa una gara a sé nel sito, con tipo:'pista'.
//
// A differenza della pista su strada, ogni riga ha già il codice categoria
// nel nome ("COGNOME NOME - CODICE": ES=Esordienti, AL=Allievi, JU=Juniores,
// UN=Under23/Elite, DA/ED=femminile) — non serve dedurre il genere dal tab,
// anche quando il tab unisce più categorie insieme ("DONNE ESO/ALL").
//
// Uso: node pista-vera-scan.js [DD-MM-YYYY] [DD-MM-YYYY]
// Produce: pista-vera-report.json (report) — NESSUNA scrittura sul sito.

const fs = require('fs');
const path = require('path');

const START = process.argv[2] || '01-01-2026';
const END   = process.argv[3] || '31-12-2026';
const DELAY_MS = 400;
const SECTOR_ID = 2; // Pista

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function listUrl(page) {
  const [sd, sm, sy] = START.split('-');
  const [ed, em, ey] = END.split('-');
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
      luogo: decodeEntities(spans[0] || ''),
      livelloTipo: decodeEntities(spans[1] || ''),
    });
  }
  return items;
}

async function fetchAllListItems() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(listUrl(page), { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

// ── Codice dopo il trattino nel nome → categoria+genere del sito ──────────
// Stessa famiglia di codici osservata sulla pista su strada, qui però è
// SEMPRE presente su ogni riga (a differenza della strada dove serviva
// come controllo secondario): niente da dedurre dal tab.
const CODE_MAP = {
  ES: { cat: 'ES', genere: 'M', uncertainYear: true },   // Esordienti M — anno non specificato
  AL: { cat: 'AL', genere: 'M', uncertainYear: false },
  JU: { cat: 'JUN', genere: 'M', uncertainYear: false },
  UN: { cat: 'ELI', genere: 'M', uncertainYear: false },
  EL: { cat: 'ELI', genere: 'M', uncertainYear: false },
  DA: { cat: 'AL', genere: 'F', uncertainYear: false },  // "Donne Allieve"
  ED: { cat: 'ES', genere: 'F', uncertainYear: true },   // "Esordienti Donne" — anno non specificato
  DJ: { cat: 'JUN', genere: 'F', uncertainYear: false },
  DU: { cat: 'ELI', genere: 'F', uncertainYear: false },
  DE: { cat: 'ELI', genere: 'F', uncertainYear: false },
};
// Giovanissimi (G1-G6, M/F): categoria non tracciata dal sito, come nella
// pista su strada — esclusa esplicitamente, non "sconosciuta".
const GIOVANISSIMI_RE = /^G[1-6][MF]$/;

function categoriaFromCode(code) {
  if (GIOVANISSIMI_RE.test(code)) return 'GIOVANISSIMI';
  return CODE_MAP[code] || null;
}

// ── Tipo di prova dall'etichetta del tab (troncata in modo incoerente) ────
function eventoFromLabel(label) {
  const l = label.toLowerCase();
  if (/tempo\s*r/.test(l)) return 'TEMPO_RACE';
  if (/corsa\s*(a\s*)?pun/.test(l)) return 'CORSA_A_PUNTI';
  if (/eliminazion|elimianzion/.test(l)) return 'ELIMINAZIONE';
  if (/scratch/.test(l)) return 'SCRATCH';
  if (/velocit/.test(l)) return 'VELOCITA';
  if (/^ins|inseguiment/.test(l)) return 'INSEGUIMENTO';
  if (/keirin/.test(l)) return 'KEIRIN';
  if (/omnium/.test(l)) return 'OMNIUM';
  if (/madison|americana/.test(l)) return 'MADISON';
  if (/\bkm\b/.test(l)) return 'KM';
  // Tab che è SOLO l'etichetta della categoria (es. "ESORDIENTI 1° ANNO",
  // "DONNE ALLIEVE") senza indicare la prova: probabile classifica
  // combinata/omnium della riunione — da rivedere caso per caso, non è lo
  // stesso caso di un tipo prova davvero irriconoscibile.
  if (/^(donne\s+)?(esordienti|allievi|allieve|juniores|elite)(\s+\d\s*°?\s*anno)?$/.test(l.trim())) return 'CLASSIFICA_CATEGORIA';
  return null; // sconosciuto — segnalato nel report, non scartato silenziosamente
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

async function loadKnownAthleteIds() {
  const ids = new Set();
  const addFromRoster = (obj) => {
    for (const bucket of Object.values(obj || {})) for (const a of (bucket.atleti || [])) if (a.atleta_id) ids.add(a.atleta_id);
  };
  const resultsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8'));
  for (const r of resultsRaw) if (r.atleta_id) ids.add(r.atleta_id);
  const athletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  for (const id of Object.keys(athletes)) ids.add(id);
  const extraRoster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'extra_roster.json'), 'utf8'));
  addFromRoster(extraRoster);
  for (const url of ['https://italiacrit.onrender.com/api/data/pcs-extra-roster', 'https://italiacrit.onrender.com/api/data/manual-athletes']) {
    try { const r = await fetch(url); if (r.ok) addFromRoster(await r.json()); } catch {}
  }
  return ids;
}

(async () => {
  console.log(`Elenco gare PISTA (sectorId=2) dal ${START} al ${END}…`);
  const list = await fetchAllListItems();
  console.log(`${list.length} riunioni pista nella finestra.\n`);

  const knownIds = await loadKnownAthleteIds();
  console.log(`${knownIds.size} atleta_id noti al sito.\n`);

  const report = [];
  let totalRows = 0, matched = 0, unknownEventTabs = 0, unknownCodes = 0;

  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    process.stdout.write(`(${i + 1}/${list.length}) [${c.id}] ${c.nome} … `);
    const res = await fetch(`https://members.federciclismo.it/race/detail/${c.id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const { header, tabs } = parseDetailPage(html);

    if (!tabs.length) { console.log('nessuna classifica pubblicata'); await sleep(DELAY_MS); continue; }

    const mappedTabs = [];
    for (const tab of tabs) {
      const evento = eventoFromLabel(tab.label);
      if (!evento) unknownEventTabs++;
      const rows = tab.rows.map(r => {
        const codeSuffix = (r.nomeCode.match(/-\s*([A-Z0-9]+)$/) || [])[1] || '';
        const fullName = r.nomeCode.replace(/\s*-\s*[A-Z0-9]+$/, '');
        const { cognome, nome, ambiguous } = splitNomeCognome(fullName);
        const mapped = categoriaFromCode(codeSuffix);
        const isGiovanissimi = mapped === 'GIOVANISSIMI';
        if (!mapped) unknownCodes++;
        const candidateId = normForId(fullName);
        const existingId = knownIds.has(candidateId) ? candidateId : null;
        if (existingId) matched++;
        totalRows++;
        return {
          posizione: r.posizione, cognome, nome, codeSuffix, team: r.team,
          categoria: (mapped && !isGiovanissimi) ? `${mapped.cat}_${mapped.genere}` : null,
          giovanissimi: isGiovanissimi,
          uncertainYear: (mapped && !isGiovanissimi) ? mapped.uncertainYear : false,
          ambiguousNameSplit: !!ambiguous,
          existingAtletaId: existingId,
        };
      });
      mappedTabs.push({ tabLabel: tab.label, evento, rows });
    }

    report.push({ garaFciId: c.id, data: c.data, ...header, tabs: mappedTabs });
    console.log(`${mappedTabs.length} tab, ${mappedTabs.reduce((s, t) => s + t.rows.length, 0)} righe`);
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(path.join(__dirname, 'pista-vera-report.json'), JSON.stringify(report, null, 2));

  console.log(`\n=== Riepilogo ===`);
  console.log(`Riunioni con classifiche pubblicate: ${report.length}/${list.length}`);
  console.log(`Righe risultato totali: ${totalRows}`);
  console.log(`Già abbinati a un profilo esistente: ${matched}`);
  console.log(`Nuovi/non abbinati: ${totalRows - matched}`);
  console.log(`Tab con tipo di prova non riconosciuto (da rivedere): ${unknownEventTabs}`);
  console.log(`Righe con codice categoria non riconosciuto (da rivedere): ${unknownCodes}`);
  console.log(`\nReport: pista-vera-report.json`);
})();
