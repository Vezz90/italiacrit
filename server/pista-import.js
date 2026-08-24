'use strict';
// Estrae (SOLA LETTURA — nessuna scrittura, né sul portale FCI né sul sito)
// i risultati delle gare "Tipo Pista su strada" da members.federciclismo.it,
// nelle categorie che il sito già tratta (Esordienti 1°/2°, Allievi,
// Juniores, Elite/Under23), escludendo Giovanissimi e vera pista/velodromo.
//
// Produce un report JSON di revisione (server/pista-import-report.json) con,
// per ogni riga, il tentativo di abbinamento a un atleta_id GIA' esistente
// in results_raw.json (stesso cognome+nome) — per non creare un doppione
// del profilo di un atleta che ha già gareggiato quest'anno nel circuito
// che scrapiamo normalmente. Non scrive nulla su Supabase: è il passo
// "guarda cosa troveremmo" prima di un vero import.

const fs = require('fs');
const path = require('path');

const START = process.argv[2] || '01-01-2026'; // DD-MM-YYYY
const END   = process.argv[3] || '24-08-2026';
const DELAY_MS = 400;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Decoder generico invece di una lista fissa di entità: una lista fissa
// perde qualunque carattere accentato non previsto (es. &#192; = À, non
// coperto prima) — capitato con un nome team ("Uà Cycling Team") scambiato
// per un team diverso solo perché l'accento non veniva decodificato,
// facendo fallire il confronto nome+team in pista-write-esordienti.js.
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function pageUrl(page) {
  const [sd, sm, sy] = START.split('-');
  const [ed, em, ey] = END.split('-');
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

// ── Mappatura tab risultati → categoria/genere del sito ────────────────────
// Tab da SCARTARE: Giovanissimi (g4/g5/g6, "dispari"/"pari", "giovanissimi")
// — categoria non tracciata dal sito.
const SKIP_TAB_RE = /\bg[456]\b|giovaniss|dispari|pari\b/i;

// Solo la CATEGORIA (senza genere) dall'etichetta del tab: "1°/primo" e
// "2°/secondo" sono entrambi usati sul portale per esordienti (non solo la
// cifra), vanno riconosciuti entrambi — la versione precedente cercava solo
// la cifra e mappava "Esordienti secondo anno" su ES1 per errore.
function categoriaFromLabel(label) {
  const l = label.toLowerCase();
  if (SKIP_TAB_RE.test(l)) return null;
  if (/esordienti|esordiente/.test(l)) {
    if (/\b2\b|second/.test(l)) return { cat: 'ES2', uncertainYear: false };
    if (/\b1\b|prim/.test(l)) return { cat: 'ES1', uncertainYear: false };
    return { cat: 'ES1', uncertainYear: true }; // anno non specificato nel tab: verificare a mano
  }
  if (/allie/.test(l)) return { cat: 'AL', uncertainYear: false };
  if (/junior/.test(l)) return { cat: 'JUN', uncertainYear: false };
  if (/elite|under\s*23|under23/.test(l)) return { cat: 'ELI', uncertainYear: false };
  return null;
}

// Il genere NON è affidabile dalla sola etichetta del tab: alcune gare
// mettono maschi e femmine nello STESSO tab categoria (visto nel report:
// "Esordienti primo anno" con righe sia codice ES che codice ED insieme).
// Il codice dopo il trattino nel nome è il segnale giusto — tutti i codici
// femminili osservati contengono una 'D' (DA, DE, DJ, DU, ED), nessuno di
// quelli maschili (AL, ES, JU, EL, UN) — eccetto REG, che è un livello di
// licenza e non indica il genere: in quel caso ripiega sull'etichetta tab.
function genereFromCode(code, tabLabel) {
  if (code && code !== 'REG' && /D/.test(code)) return 'F';
  if (/donne|femmin|allieve\b/i.test(tabLabel)) return 'F';
  return 'M';
}

// Codice dopo il trattino nel nome ("NOME COGNOME - EL") non è affidabile per
// il genere (es. "ES", "AL", "UN" non lo indicano) — la categoria/genere
// viene SEMPRE dall'etichetta del tab, il codice è solo informativo nel report.
function splitNomeCognome(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { cognome: full.trim(), nome: '' };
  // Euristica: l'ultima parola è il nome, il resto è cognome (coerente con
  // le altre parti del sito che assumono "COGNOME [COGNOME...] NOME").
  // Impreciso per cognomi composti dove il nome è nella posizione sbagliata
  // (es. "SIMS OLIVER EDWARD ANTHONY" — qui "ANTHONY" verrebbe preso come
  // nome): segnaliamo questi casi nel report (need_review) invece di
  // indovinare silenziosamente.
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

  // Marcatori di tab: <a href="#" class="btnRisultati"><b>{label}</b></a>
  const tabMarkers = [];
  const tabRe = /<a href="#" class="btnRisultati"><b>([^<]*)<\/b><\/a>/g;
  let tm;
  while ((tm = tabRe.exec(section))) tabMarkers.push({ label: decodeEntities(tm[1]), idx: tm.index });

  // Righe risultato: gruppi di 3 span consecutivi (posizione, "NOME - CODE", team).
  // Lo span di posizione ha lo style distintivo color:#29abe2, gli altri due no.
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

async function fetchAllListItems() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(pageUrl(page), { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

// Stesso algoritmo di _normForId/_makeAtletaId in server.js: normalizza
// accenti, minuscolo, ogni run di caratteri non alfanumerici (SPAZI INCLUSI)
// diventa un solo underscore, poi maiuscolo. Il punto chiave: applicato
// all'intero nome per esteso (senza prima spezzarlo in cognome/nome), il
// risultato è IDENTICO indipendentemente da dove cade il confine
// cognome/nome — "RODRIGUES" + "DOS SANTOS VICENTE JUNIOR" e "RODRIGUES DOS
// SANTOS VICENTE" + "JUNIOR" producono la STESSA stringa unendo con "_".
// Il vecchio confronto per {cognome,nome} separati falliva proprio per
// questo: lo scraper FCI e questo script possono spezzare lo stesso nome
// in punti diversi (in un caso il cognome era una sola parola, "RODRIGUES",
// col resto nel campo nome) — confrontando l'ID intero il problema sparisce.
function normForId(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

// L'universo delle gare che il sito conosce NON vive solo in
// results_raw.json (i soli risultati già scrapati dalla FCI): un atleta ha
// una pagina profilo anche se è solo nel roster squadra (extra_roster.json),
// nel roster PCS live (Supabase), o aggiunto a mano (manual-athletes) — pur
// senza ancora un risultato contato. Il primo giro di questo script
// guardava solo results_raw.json e per questo segnava come "nuovi" atleti
// che in realtà hanno già una pagina sul sito.
async function loadKnownAthleteIds() {
  const ids = new Set();
  const addFromRoster = (rosterObj) => {
    for (const bucket of Object.values(rosterObj || {})) {
      for (const a of (bucket.atleti || [])) if (a.atleta_id) ids.add(a.atleta_id);
    }
  };

  const resultsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8'));
  for (const r of resultsRaw) if (r.atleta_id) ids.add(r.atleta_id);

  const athletes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'athletes.json'), 'utf8'));
  for (const id of Object.keys(athletes)) ids.add(id);

  const extraRoster = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'extra_roster.json'), 'utf8'));
  addFromRoster(extraRoster);

  // Fonti live (Supabase, non nei file statici del checkout locale) — dal
  // backend deployato, stesso posto da cui il sito stesso le legge.
  for (const url of [
    'https://italiacrit.onrender.com/api/data/pcs-extra-roster',
    'https://italiacrit.onrender.com/api/data/manual-athletes',
  ]) {
    try {
      const res = await fetch(url);
      if (res.ok) addFromRoster(await res.json());
    } catch (e) { console.warn(`Avviso: impossibile leggere ${url}: ${e.message}`); }
  }

  return ids;
}

(async () => {
  console.log(`Elenco gare dal ${START} al ${END}…`);
  const list = await fetchAllListItems();
  const candidates = list.filter(g => /Tipo: Tipo Pista/.test(g.livelloTipo));
  console.log(`${candidates.length} gare "Tipo Pista" su strada da esaminare in dettaglio.\n`);

  const knownIds = await loadKnownAthleteIds();
  console.log(`${knownIds.size} atleta_id noti al sito (risultati + roster team + PCS + manuali).\n`);
  const report = [];
  let totalRows = 0, matched = 0, ambiguousNames = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stdout.write(`(${i + 1}/${candidates.length}) [${c.id}] ${c.nome} … `);
    const res = await fetch(`https://members.federciclismo.it/race/detail/${c.id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    const { header, tabs } = parseDetailPage(html);

    const mappedTabs = [];
    for (const tab of tabs) {
      const mapped = categoriaFromLabel(tab.label);
      if (!mapped) continue; // Giovanissimi o tab non riconosciuto
      let rows = tab.rows.map(r => {
        const codeSuffix = (r.nomeCode.match(/-\s*([A-Z0-9]+)$/) || [])[1] || '';
        const fullName = r.nomeCode.replace(/\s*-\s*[A-Z0-9]+$/, '');
        const { cognome, nome, ambiguous } = splitNomeCognome(fullName);
        const genere = genereFromCode(codeSuffix, tab.label);
        // Confronto sull'ID intero (vedi normForId sopra), non su {cognome,nome}
        // separati: split-order-independent, risolve i falsi "nuovo" per nomi
        // che lo scraper FCI e questo script spezzano in punti diversi.
        const candidateId = normForId(fullName);
        const existingId = knownIds.has(candidateId) ? candidateId : null;
        if (ambiguous) ambiguousNames++;
        return {
          posizioneOriginale: r.posizione, cognome, nome, codeSuffix, team: r.team,
          categoria: `${mapped.cat}_${genere}`,
          ambiguousNameSplit: !!ambiguous,
          uncertainYear: mapped.uncertainYear,
          existingAtletaId: existingId,
        };
      });
      // Alcuni tab NON separano i generi (nessun tab "Donne ___" distinto):
      // uomini e donne condividono UNA classifica combinata con un'unica
      // sequenza di posizioni (es. "Esordienti primo anno" con una sola
      // ragazza mescolata al 4° posto tra i ragazzi). Stessa regola degli
      // scraper FCI "ufficiali": ogni genere ha la propria classifica
      // separata, rinumerata dall'ordine relativo con cui sono arrivati —
      // non la posizione grezza nella lista mista. Senza questo, la ragazza
      // finiva con una posizione arbitraria e i ragazzi dopo di lei
      // restavano con "buchi" nella numerazione invece di scalare su.
      const byCatGenere = new Map();
      for (const row of rows) {
        if (!byCatGenere.has(row.categoria)) byCatGenere.set(row.categoria, []);
        byCatGenere.get(row.categoria).push(row);
      }
      rows = [];
      for (const group of byCatGenere.values()) {
        group.sort((a, b) => a.posizioneOriginale - b.posizioneOriginale);
        group.forEach((row, i) => {
          row.posizione = i + 1;
          rows.push(row);
        });
      }
      rows.sort((a, b) => a.posizioneOriginale - b.posizioneOriginale);
      for (const row of rows) {
        totalRows++;
        if (row.existingAtletaId) matched++;
      }
      mappedTabs.push({ tabLabel: tab.label, rows });
    }

    if (mappedTabs.length) {
      report.push({ garaFciId: c.id, data: c.data, ...header, tabs: mappedTabs });
      console.log(`${mappedTabs.reduce((s, t) => s + t.rows.length, 0)} righe in ${mappedTabs.length} categorie rilevanti`);
    } else {
      console.log('nessuna categoria rilevante (solo Giovanissimi/altro)');
    }
    await sleep(DELAY_MS);
  }

  const outPath = path.join(__dirname, 'pista-import-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const uncertainYearRows = report.reduce((s, race) => s + race.tabs.reduce((s2, t) => s2 + t.rows.filter(r => r.uncertainYear).length, 0), 0);

  console.log(`\n=== Riepilogo ===`);
  console.log(`Gare con almeno una categoria rilevante: ${report.length}/${candidates.length}`);
  console.log(`Righe risultato totali: ${totalRows}`);
  console.log(`Anno esordienti non specificato nel tab (da verificare a mano): ${uncertainYearRows}`);
  console.log(`Già trovato un atleta_id esistente (stesso nome in results_raw.json): ${matched}`);
  console.log(`Nomi non ancora nel sito (nuovi, o da creare): ${totalRows - matched}`);
  console.log(`Split cognome/nome ambiguo (4+ parole, da rivedere a mano): ${ambiguousNames}`);
  console.log(`\nReport completo: ${outPath}`);
})();
