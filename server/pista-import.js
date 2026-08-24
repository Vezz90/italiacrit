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

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#176;/g, '°').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#224;/g, 'à').replace(/&#232;/g, 'è').replace(/&#233;/g, 'é')
    .replace(/&#242;/g, 'ò').replace(/&#249;/g, 'ù').replace(/&#236;/g, 'ì')
    .replace(/&#200;/g, 'È').replace(/&amp;/g, '&').trim();
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
    const spans = [...inner.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(x => x[1]);
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

function mapTab(label) {
  const l = label.toLowerCase();
  if (SKIP_TAB_RE.test(l)) return null;
  const isF = /donne|femmin|allieve\b/.test(l);
  let cat = null;
  if (/esordienti.*1|1.*anno.*esordi/.test(l)) cat = 'ES1';
  else if (/esordienti.*2|2.*anno.*esordi/.test(l)) cat = 'ES2';
  else if (/esordienti/.test(l)) cat = 'ES1'; // non specificato: nel dubbio 1° anno, verificare a mano
  else if (/allie/.test(l)) cat = 'AL';
  else if (/junior/.test(l)) cat = 'JUN';
  else if (/elite|under\s*23|under23/.test(l)) cat = 'ELI';
  if (!cat) return null;
  return { categoria: `${cat}_${isF ? 'F' : 'M'}`, tabLabel: label };
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

function loadExistingAthleteIndex() {
  const resultsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'results_raw.json'), 'utf8'));
  const byName = new Map(); // "COGNOME|NOME" -> atleta_id (prende l'ultimo incontrato)
  for (const r of resultsRaw) {
    if (!r.cognome || !r.atleta_id) continue;
    byName.set(`${r.cognome.toUpperCase()}|${(r.nome || '').toUpperCase()}`, r.atleta_id);
  }
  return byName;
}

(async () => {
  console.log(`Elenco gare dal ${START} al ${END}…`);
  const list = await fetchAllListItems();
  const candidates = list.filter(g => /^Tipo: Tipo Pista/.test(g.livelloTipo) || /Tipo: Tipo Pista/.test(g.livelloTipo));
  console.log(`${candidates.length} gare "Tipo Pista" su strada da esaminare in dettaglio.\n`);

  const athleteIndex = loadExistingAthleteIndex();
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
      const mapped = mapTab(tab.label);
      if (!mapped) continue; // Giovanissimi o tab non riconosciuto
      const rows = tab.rows.map(r => {
        const { cognome, nome, ambiguous } = splitNomeCognome(r.nomeCode.replace(/\s*-\s*[A-Z0-9]+$/, ''));
        const codeSuffix = (r.nomeCode.match(/-\s*([A-Z0-9]+)$/) || [])[1] || '';
        const existingId = athleteIndex.get(`${cognome.toUpperCase()}|${nome.toUpperCase()}`) || null;
        totalRows++;
        if (existingId) matched++;
        if (ambiguous) ambiguousNames++;
        return { posizione: r.posizione, cognome, nome, codeSuffix, team: r.team, ambiguousNameSplit: !!ambiguous, existingAtletaId: existingId };
      });
      mappedTabs.push({ tabLabel: tab.label, categoria: mapped.categoria, rows });
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

  console.log(`\n=== Riepilogo ===`);
  console.log(`Gare con almeno una categoria rilevante: ${report.length}/${candidates.length}`);
  console.log(`Righe risultato totali: ${totalRows}`);
  console.log(`Già trovato un atleta_id esistente (stesso nome in results_raw.json): ${matched}`);
  console.log(`Nomi non ancora nel sito (nuovi, o da creare): ${totalRows - matched}`);
  console.log(`Split cognome/nome ambiguo (4+ parole, da rivedere a mano): ${ambiguousNames}`);
  console.log(`\nReport completo: ${outPath}`);
})();
