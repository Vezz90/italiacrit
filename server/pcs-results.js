'use strict';
/**
 * Scraper PCS risultati atleti
 *
 * Per ogni atleta nel sistema (con pcs_slug salvato in entity_overrides):
 *  - visita procyclingstats.com/rider/{slug}/{year}
 *  - estrae tutti i risultati della stagione corrente
 *  - associa al gara_id del nostro circuito (se la data coincide)
 *  - salva nella tabella `pcs_results`
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node pcs-results.js [--force] [--atleta-id=XXX] [--season=2026]
 *
 *   --force        sovrascrive anche risultati già presenti
 *   --atleta-id=X  processa solo quell'atleta
 *   --season=YYYY  stagione (default: anno corrente)
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const args       = process.argv.slice(2);
const FORCE      = args.includes('--force');
const SINGLE_ID  = (args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;
const SEASON     = parseInt((args.find(a => a.startsWith('--season=')) || '').split('=')[1] || '') || new Date().getFullYear();

const DATA_DIR  = path.join(__dirname, '..', 'data');
const RANK_DIR  = path.join(DATA_DIR, 'rankings');
const ATH_CATS  = ['ELI_M','ELI_F','JUN_M','JUN_F','AL_M','AL_F'];
const CAL_FILES = [
  path.join(DATA_DIR, 'calendar.json'),
  path.join(DATA_DIR, 'seasons', String(SEASON), 'calendar.json'),
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ─── Calendario: mappa data → gara_id ────────────────────────────────────
function buildCalendarMap() {
  // data (YYYY-MM-DD) → array di { id, nome, categoria }
  const map = new Map();
  for (const f of CAL_FILES) {
    if (!fs.existsSync(f)) continue;
    const entries = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const e of entries) {
      if (!e.data || !e.id) continue;
      if (!map.has(e.data)) map.set(e.data, []);
      map.get(e.data).push({ id: e.id, nome: e.nome || '', categoria: e.categoria || '' });
    }
  }
  return map;
}

// Trova il gara_id migliore dato una data e una categoria PCS
function matchGaraId(calMap, dateStr, pcsCat, pcsName) {
  const entries = calMap.get(dateStr);
  if (!entries || !entries.length) return null;
  if (entries.length === 1) return entries[0].id;

  // Prova a matchare per categoria (PCS usa 'C1', 'C2', '1.2', 'NCE', ecc.)
  // Le nostre categorie: ELI_M, JUN_M, AL_M, ES1_M, ES2_M, ecc.
  const catStr = (pcsCat || '').toLowerCase();
  const nameStr = normalizeStr(pcsName || '');

  // Euristica: JUN = JUNIORES, ALI = ALLIEVI, ELI/U23 = ELITE
  let priority = null;
  if (/jun|u19/.test(catStr))                    priority = 'JUN';
  else if (/ali|u17|cadets/.test(catStr))         priority = 'AL';
  else if (/u23|elite|1\.[12]|2\.pro|wt/.test(catStr)) priority = 'ELI';

  if (priority) {
    const match = entries.find(e => e.id.includes(priority));
    if (match) return match.id;
  }

  // Fallback: prova a matchare per nome normalizzato della gara
  if (nameStr.length > 4) {
    const words = nameStr.split(' ').filter(w => w.length > 4);
    const byName = entries.find(e =>
      words.some(w => normalizeStr(e.nome).includes(w))
    );
    if (byName) return byName.id;
  }

  return entries[0].id; // fallback: prima gara del giorno
}

// ─── PCS scraping ─────────────────────────────────────────────────────────

async function scrapeAthleteResults(page, slug, season) {
  const url = `https://www.procyclingstats.com/rider/${slug}/${season}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch(e) {
    return { error: e.message, results: [] };
  }

  if (page.url().includes('pagenotfound') || page.url().includes('404'))
    return { notFound: true, results: [] };

  await sleep(800);

  const results = await page.evaluate((season) => {
    const rows = [];

    // PCS mostra i risultati in varie tabelle. La principale ha colonne:
    // Date | Race | Cat | Km | Result | GC | Points | UCI pts
    // oppure: Date | Race | Cat | Result | Time | Points
    const tables = [...document.querySelectorAll('table')];

    for (const table of tables) {
      const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
      // Deve avere almeno una colonna "result" o "ris." o "pos"
      const hasResult = headers.some(h => /result|ris\.|pos|place/.test(h));
      const hasRace   = headers.some(h => /race|gara|corsa/.test(h));
      if (!hasResult && !hasRace) continue;

      // Indici colonne (flessibili)
      let iDate = -1, iRace = -1, iCat = -1, iResult = -1, iTime = -1;
      headers.forEach((h, i) => {
        if (iDate   < 0 && /date|data/.test(h))           iDate   = i;
        if (iRace   < 0 && /race|gara|corsa/.test(h))     iRace   = i;
        if (iCat    < 0 && /cat|class/.test(h))           iCat    = i;
        if (iResult < 0 && /result|ris\.|pos|place/.test(h)) iResult = i;
        if (iTime   < 0 && /time|gap|distacco|\//.test(h)) iTime   = i;
      });

      // Se non riusciamo a trovare le colonne chiave, prova con posizione fissa
      if (iDate < 0 || iRace < 0 || iResult < 0) {
        // Euristica: prima colonna = data (dd.mm), seconda = gara, ultima-2 = result
        const trs = table.querySelectorAll('tbody tr');
        if (!trs.length) continue;
        const firstRow = [...trs[0].querySelectorAll('td')];
        if (firstRow.length < 3) continue;
        // Controlla se prima cella sembra una data dd.mm
        if (/^\d{1,2}\.\d{2}$/.test(firstRow[0]?.textContent?.trim())) {
          iDate = 0; iRace = 1;
          // Result è tipicamente in posizione 3 o 4
          iResult = firstRow.length >= 5 ? 3 : 2;
          iTime   = firstRow.length >= 6 ? 4 : -1;
          iCat    = firstRow.length >= 4 ? 2 : -1;
        } else {
          continue;
        }
      }

      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')];
        if (cells.length < 3) continue;

        const dateRaw   = cells[iDate]?.textContent?.trim() || '';
        const raceCell  = cells[iRace];
        const resultRaw = cells[iResult]?.textContent?.trim() || '';
        const timeRaw   = iTime >= 0 ? (cells[iTime]?.textContent?.trim() || '') : '';
        const catRaw    = iCat  >= 0 ? (cells[iCat]?.textContent?.trim()  || '') : '';

        // Parsa data dd.mm → YYYY-MM-DD
        const dm = dateRaw.match(/^(\d{1,2})\.(\d{2})$/);
        if (!dm) continue;
        const data = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;

        // Nome gara e slug PCS
        const raceLink = raceCell?.querySelector('a');
        const gara_name = raceCell?.textContent?.trim() || '';
        let pcs_race_slug = null;
        if (raceLink) {
          const href = raceLink.getAttribute('href') || '';
          // es. /race/coppa-valsenio-juniores/2026/result
          const m = href.match(/\/race\/([^/]+)/);
          if (m) pcs_race_slug = m[1];
        }
        if (!gara_name || !pcs_race_slug) continue;

        // Posizione: numero intero (salta DNF, DNS, OTL, DSQ, ecc.)
        const posStr = resultRaw.replace(/[^0-9]/g, '');
        const posizione = posStr ? parseInt(posStr) : null;
        if (!posizione || posizione < 1 || posizione > 999) continue;

        // Distacco: "+mm:ss" oppure "hh:mm:ss" oppure vuoto (vincitore)
        let distacco = null;
        if (posizione === 1) {
          distacco = null; // vincitore, nessun distacco
        } else if (timeRaw && timeRaw !== '-' && timeRaw !== '0:00:00') {
          distacco = timeRaw.startsWith('+') ? timeRaw : (timeRaw ? '+' + timeRaw : null);
        }

        rows.push({ data, gara_name, pcs_race_slug, posizione, distacco, cat: catRaw });
      }

      if (rows.length > 0) break; // trovata la tabella giusta
    }

    return rows;
  }, SEASON).catch(() => []);

  return { results };
}

// ─── Supabase ─────────────────────────────────────────────────────────────

async function getAthleteSlugs(sb) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id, new_value')
    .eq('entity_type', 'atleta')
    .eq('field', 'pcs_slug')
    .not('new_value', 'is', null)
    .limit(5000);
  return new Map((data || []).map(r => [r.entity_id, r.new_value]));
}

async function getAlreadyScraped(sb, atletaId, season) {
  const { data } = await sb.from('pcs_results')
    .select('pcs_race_slug')
    .eq('atleta_id', atletaId)
    .eq('season', season);
  return new Set((data || []).map(r => r.pcs_race_slug));
}

async function upsertResults(sb, rows) {
  if (!rows.length) return;
  const { error } = await sb.from('pcs_results')
    .upsert(rows, { onConflict: 'atleta_id,season,pcs_race_slug' });
  if (error) throw error;
}

// ─── Main ──────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log(`=== PCS Risultati [stagione ${SEASON}] ===\n`);

  // Carica slug PCS per tutti gli atleti
  const slugMap = await getAthleteSlugs(sb);

  // Filtra atleti da processare
  let atletiIds;
  if (SINGLE_ID) {
    atletiIds = [SINGLE_ID];
  } else {
    // Prendi tutti gli atleti dalle ranking files
    const ids = new Set();
    for (const cat of ATH_CATS) {
      const f = path.join(RANK_DIR, `${cat}.json`);
      if (!fs.existsSync(f)) continue;
      for (const a of JSON.parse(fs.readFileSync(f, 'utf8')))
        if (a.atleta_id) ids.add(a.atleta_id);
    }
    atletiIds = [...ids];
  }

  // Mantieni solo chi ha uno slug PCS
  const toProcess = atletiIds.filter(id => slugMap.has(id));
  console.log(`${atletiIds.length} atleti nel sistema — ${toProcess.length} con slug PCS\n`);

  // Mappa calendario: data → gare
  const calMap = buildCalendarMap();
  console.log(`Calendario: ${calMap.size} date di gara caricate\n`);

  // Browser
  const bravePaths = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Users\\vezza\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env.LOCALAPPDATA || '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  const bravePath = bravePaths.find(p => fs.existsSync(p));
  let browser;
  if (bravePath) {
    try { browser = await chromium.launch({ executablePath: bravePath, headless: false, args: ['--no-sandbox'] }); }
    catch { /* fallback */ }
  }
  if (!browser) {
    try { browser = await chromium.launch({ channel: 'chrome', headless: false }); }
    catch { browser = await chromium.launch({ headless: false }); }
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'it-IT',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 })
    .catch(e => console.log(`Avviso PCS: ${e.message}`));
  await sleep(2000);
  console.log('Pronto.\n');

  let done = 0, noData = 0, errors = 0, totalRows = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const atletaId = toProcess[i];
    const slug = slugMap.get(atletaId);
    process.stdout.write(`(${i+1}/${toProcess.length}) [${atletaId}] slug=${slug} … `);

    // Controlla se già scraped (a meno di --force)
    if (!FORCE) {
      const scraped = await getAlreadyScraped(sb, atletaId, SEASON);
      if (scraped.size > 0) {
        process.stdout.write(`già fatto (${scraped.size} risultati)\n`);
        done++;
        continue;
      }
    }

    const { results, error, notFound } = await scrapeAthleteResults(page, slug, SEASON);

    if (notFound) {
      process.stdout.write('profilo non trovato\n');
      noData++;
      continue;
    }
    if (error) {
      process.stdout.write(`ERRORE: ${error}\n`);
      errors++;
      continue;
    }
    if (!results.length) {
      process.stdout.write('nessun risultato\n');
      noData++;
      continue;
    }

    // Associa gara_id del circuito a ogni risultato
    const rows = results.map(r => ({
      atleta_id:     atletaId,
      pcs_slug:      slug,
      season:        SEASON,
      gara_name:     r.gara_name,
      data:          r.data,
      posizione:     r.posizione,
      distacco:      r.distacco,
      pcs_race_slug: r.pcs_race_slug,
      gara_id:       matchGaraId(calMap, r.data, r.cat, r.gara_name),
    }));

    const circuitRaces = rows.filter(r => r.gara_id).length;
    const extraRaces   = rows.filter(r => !r.gara_id).length;

    try {
      await upsertResults(sb, rows);
      process.stdout.write(`✓ ${rows.length} risultati (${circuitRaces} circuito, ${extraRaces} extra)\n`);
      totalRows += rows.length;
      done++;
    } catch(e) {
      process.stdout.write(`ERRORE DB: ${e.message}\n`);
      errors++;
    }

    await sleep(300);
  }

  await browser.close();
  console.log(`\n=== Completato — ✅ ${done}  ❓ ${noData}  ❌ ${errors}  righe totali: ${totalRows} ===`);
})();
