'use strict';
/**
 * Scraper PCS risultati gara (dalla pagina risultati, non dal profilo atleta)
 *
 * Per ogni gara del calendario che ha uno slug PCS configurato in entity_overrides:
 *  - visita procyclingstats.com/race/{slug}/result
 *  - estrae TUTTI i finisher con posizione, nome, team, distacco
 *  - tenta di matchare ogni corridore al nostro sistema (per nome)
 *  - salva in pcs_gara_results
 *
 * Lo slug PCS per ogni gara si imposta dall'admin: ✏ Modifica → campo "Slug PCS"
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node pcs-race-scraper.js [--force] [--gara-id=ID] [--season=YYYY]
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const args      = process.argv.slice(2);
const FORCE     = args.includes('--force');
const SINGLE_ID = (args.find(a => a.startsWith('--gara-id=')) || '').split('=')[1] || null;
const SEASON    = parseInt((args.find(a => a.startsWith('--season=')) || '').split('=')[1] || '') || new Date().getFullYear();

const DATA_DIR  = path.join(__dirname, '..', 'data');
const CAL_FILES = [
  path.join(DATA_DIR, 'calendar.json'),
  path.join(DATA_DIR, 'seasons', String(SEASON), 'calendar.json'),
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

async function getGaraSlugs(sb) {
  // Legge i pcs_race_slug configurati dall'admin per le gare del circuito
  const { data } = await sb.from('entity_overrides')
    .select('entity_id, new_value')
    .eq('entity_type', 'gara')
    .eq('field', 'pcs_race_slug')
    .not('new_value', 'is', null)
    .limit(2000);
  return new Map((data || []).map(r => [r.entity_id, r.new_value]));
}

async function getAlreadyScraped(sb, garaId) {
  const { count } = await sb.from('pcs_gara_results')
    .select('id', { count: 'exact', head: true })
    .eq('gara_id', garaId);
  return (count || 0) > 0;
}

async function upsertResults(sb, rows) {
  if (!rows.length) return;
  // Cancella e reinserisci per aggiornare i dati (upsert su posizione)
  const { error } = await sb.from('pcs_gara_results')
    .upsert(rows, { onConflict: 'gara_id,posizione' });
  if (error) throw error;
}

// ─── PCS scraping pagina gara ──────────────────────────────────────────────────

async function scrapeRaceResults(page, pcsSlug) {
  // Prova URL risultati diretti, poi GC, poi la pagina base
  const urls = [
    `https://www.procyclingstats.com/race/${pcsSlug}/result`,
    `https://www.procyclingstats.com/race/${pcsSlug}`,
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch(e) {
      continue;
    }

    if (page.url().includes('pagenotfound') || page.url().includes('404')) continue;

    await sleep(1000);

    const results = await page.evaluate(() => {
      const rows = [];

      // PCS race result pages: tabella con colonne Rnk, Rider, Team, Time/Gap
      const tables = [...document.querySelectorAll('table')];
      for (const table of tables) {
        const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
        const hasRnk  = headers.some(h => /rnk|pos|#/.test(h));
        const hasRider = headers.some(h => /rider|name|cyclist|coureur/.test(h));
        if (!hasRnk && !hasRider) continue;

        let iPos = -1, iRider = -1, iTeam = -1, iTime = -1;
        headers.forEach((h, i) => {
          if (iPos   < 0 && /rnk|pos|#/.test(h))                 iPos   = i;
          if (iRider < 0 && /rider|name|cyclist|coureur/.test(h)) iRider = i;
          if (iTeam  < 0 && /team/.test(h))                       iTeam  = i;
          if (iTime  < 0 && /time|gap|\/|h:/.test(h))             iTime  = i;
        });

        // Euristica posizione fissa se header non riconosciuto
        if (iPos < 0 || iRider < 0) {
          const trs = table.querySelectorAll('tbody tr');
          if (!trs.length) continue;
          const cells = [...trs[0].querySelectorAll('td')];
          if (cells.length < 3) continue;
          const first = cells[0]?.textContent?.trim();
          if (/^\d+$/.test(first)) {
            iPos = 0; iRider = 1; iTeam = 2; iTime = 3;
          } else continue;
        }

        for (const tr of table.querySelectorAll('tbody tr')) {
          const cells = [...tr.querySelectorAll('td')];
          if (cells.length < 2) continue;

          const posRaw  = cells[iPos]?.textContent?.trim() || '';
          const pos     = parseInt(posRaw);
          if (!pos || pos < 1 || pos > 500) continue;

          const riderCell = cells[iRider];
          const riderName = riderCell?.textContent?.trim() || '';
          if (!riderName || riderName.length < 2) continue;

          const teamName = iTeam >= 0 ? (cells[iTeam]?.textContent?.trim() || '') : '';
          let   gap      = iTime >= 0 ? (cells[iTime]?.textContent?.trim() || '') : '';

          // Normalizza distacco
          if (pos === 1) gap = null;
          else if (gap && gap !== '-' && gap !== '0:00:00' && !gap.startsWith('+')) gap = '+' + gap;
          else if (gap === '-' || gap === '0:00:00') gap = null;

          rows.push({ posizione: pos, rider_name: riderName, team_name: teamName, distacco: gap || null });
        }

        if (rows.length > 0) break;
      }

      return rows;
    }).catch(() => []);

    if (results.length > 0) return { results, url: page.url() };
  }

  return { results: [], notFound: true };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  console.log(`=== PCS Race Scraper [stagione ${SEASON}] ===\n`);

  // Slug PCS configurati dall'admin per le gare del circuito
  const garaSlugMap = await getGaraSlugs(sb);
  if (!garaSlugMap.size) {
    console.log('Nessuna gara ha ancora uno slug PCS configurato.');
    console.log('Vai su una pagina gara → ✏ Modifica → campo "Slug PCS" e inserisci lo slug da PCS.');
    console.log('Esempio: giro-ciclistico-d-italia/2026/stage-6\n');
    process.exit(0);
  }

  // Carica mappa nome → atleta_id dagli athletes.json per il matching
  const athletesFile = path.join(DATA_DIR, 'athletes.json');
  const athletesByNorm = new Map();
  if (fs.existsSync(athletesFile)) {
    const aths = JSON.parse(fs.readFileSync(athletesFile, 'utf8'));
    for (const [id, a] of Object.entries(aths)) {
      const norm = normalizeStr((a.cognome || '') + ' ' + (a.nome || ''));
      athletesByNorm.set(norm, id);
      // Anche nome cognome (per PCS che mette nome prima)
      const norm2 = normalizeStr((a.nome || '') + ' ' + (a.cognome || ''));
      if (!athletesByNorm.has(norm2)) athletesByNorm.set(norm2, id);
    }
  }
  console.log(`${athletesByNorm.size / 2 | 0} atleti nel sistema per il matching\n`);

  // Filtra gare da processare
  let garaIds = [...garaSlugMap.keys()];
  if (SINGLE_ID) garaIds = garaIds.filter(id => id === SINGLE_ID);

  console.log(`${garaIds.length} gare con slug PCS da processare\n`);

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
    .catch(e => console.log(`Avviso: ${e.message}`));
  await sleep(2000);
  console.log('Pronto.\n');

  let done = 0, noData = 0, errors = 0, totalRows = 0;

  for (let i = 0; i < garaIds.length; i++) {
    const garaId  = garaIds[i];
    const pcsSlug = garaSlugMap.get(garaId);
    process.stdout.write(`(${i+1}/${garaIds.length}) ${garaId}\n  → PCS: ${pcsSlug} … `);

    // Salta se già scraped (a meno di --force)
    if (!FORCE && await getAlreadyScraped(sb, garaId)) {
      process.stdout.write('già fatto\n');
      done++;
      continue;
    }

    const { results, notFound } = await scrapeRaceResults(page, pcsSlug);

    if (notFound || !results.length) {
      process.stdout.write('nessun risultato trovato su PCS\n');
      noData++;
      continue;
    }

    // Matcha corridori al nostro sistema per nome
    const rows = results.map(r => {
      const norm = normalizeStr(r.rider_name);
      const atletaId = athletesByNorm.get(norm) || null;
      return {
        gara_id:       garaId,
        season:        SEASON,
        posizione:     r.posizione,
        rider_name:    r.rider_name,
        atleta_id:     atletaId,
        team_name:     r.team_name,
        distacco:      r.distacco,
        pcs_race_slug: pcsSlug,
      };
    });

    const matched   = rows.filter(r => r.atleta_id).length;
    const unmatched = rows.length - matched;

    try {
      await upsertResults(sb, rows);
      process.stdout.write(`✓ ${rows.length} finisher (${matched} nel sistema, ${unmatched} solo PCS)\n`);
      totalRows += rows.length;
      done++;
    } catch(e) {
      process.stdout.write(`ERRORE DB: ${e.message}\n`);
      errors++;
    }

    await sleep(500);
  }

  await browser.close();
  console.log(`\n=== Completato — ✅ ${done}  ❓ ${noData}  ❌ ${errors}  righe totali: ${totalRows} ===`);
  console.log('\nSe alcune gare non hanno slug: vai su admin → gara → ✏ Modifica → Slug PCS');
})();
