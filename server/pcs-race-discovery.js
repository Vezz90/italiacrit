'use strict';
/**
 * pcs-race-discovery.js
 * Trova automaticamente gli slug PCS per tutte le gare del circuito ICS.
 *
 * Per ogni gara_id nei risultati stagionali (o nel calendario):
 *  1. Genera slug PCS candidati dal nome gara
 *  2. Verifica su PCS con Playwright se la pagina risultati esiste
 *  3. Salva lo slug confermato in entity_overrides
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node pcs-race-discovery.js [--season=YYYY] [--dry-run] [--force]
 *
 * --dry-run  : verifica su PCS ma non salva nulla
 * --force    : riprocessa anche gare già configurate
 */

const fs   = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.join(__dirname, '.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  });
})();

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET o crea server/.env.local'); process.exit(1); }

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE   = args.includes('--force');
const SEASON  = parseInt((args.find(a => a.startsWith('--season=')) || '').split('=')[1] || '') || new Date().getFullYear();

const DATA_DIR = path.join(__dirname, '..', 'data');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Generazione slug ──────────────────────────────────────────────────────────

/**
 * Converte un nome gara in uno slug PCS (senza prefisso race/ o anno).
 * Es: "39^ FIRENZE - EMPOLI" → "firenze-empoli"
 */
function nameToSlug(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // rimuovi accenti
    .replace(/^\d+[°^`']\s*/u, '')                       // rimuovi numero edizione (39^, 63°, 107°)
    .toLowerCase()
    .replace(/['''`]/g, '')                              // apostrofi
    .replace(/[\s\-–—\/\\]+/g, '-')                     // spazi e trattini → -
    .replace(/[^a-z0-9\-]/g, '')                        // rimuovi altri char speciali
    .replace(/-+/g, '-')                                 // collassa doppie trattino
    .replace(/^-+|-+$/g, '');                            // trim
}

/**
 * Genera slug candidati da un nome gara.
 * Restituisce array di slug nella forma "nome-slug/anno".
 */
function genCandidates(nome, season) {
  const base = nameToSlug(nome);
  if (!base) return [];

  const candidates = [];

  // Slug base
  candidates.push(`${base}/${season}`);

  // Senza prefissi comuni
  for (const prefix of ['trofeo-', 'gran-premio-', 'gp-', 'memorial-', 'coppa-', 'circuito-', 'corsa-']) {
    if (base.startsWith(prefix)) {
      candidates.push(`${base.slice(prefix.length)}/${season}`);
    }
  }

  // Versione abbreviata (prime 3 parole se slug è lungo)
  const parts = base.split('-');
  if (parts.length > 4) {
    candidates.push(`${parts.slice(0, 3).join('-')}/${season}`);
  }

  return [...new Set(candidates)];
}

// ─── Supabase ──────────────────────────────────────────────────────────────────

async function getAlreadyConfigured(sb) {
  const { data, error } = await sb.from('entity_overrides')
    .select('entity_id, new_value')
    .eq('entity_type', 'gara')
    .eq('field', 'pcs_race_slug')
    .limit(5000);
  if (error) { console.error('Errore entity_overrides:', error.message); return new Map(); }
  return new Map((data || []).map(r => [r.entity_id, r.new_value]));
}

async function saveSlug(sb, garaId, slug) {
  const { error } = await sb.from('entity_overrides').upsert({
    entity_type: 'gara', entity_id: garaId, field: 'pcs_race_slug', new_value: slug, edited_by: null
  }, { onConflict: 'entity_type,entity_id,field' });
  if (error) throw error;
}

// ─── PCS verifica ──────────────────────────────────────────────────────────────

const PCS = 'https://www.procyclingstats.com';

/**
 * Verifica se uno slug PCS ha risultati disponibili.
 * Restituisce { confirmed: bool, finalSlug: string, riderCount: number }.
 */
async function verifySlug(page, slug) {
  const urls = [
    `${PCS}/race/${slug}/result`,
    `${PCS}/race/${slug}`,
    `${PCS}/national-race/${slug}/result`,
    `${PCS}/national-race/${slug}`,
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      await page.goto('about:blank').catch(() => {});
      continue;
    }

    const finalUrl = page.url();
    if (!finalUrl || finalUrl === 'about:blank' || finalUrl.startsWith('chrome-error://')) continue;
    if (finalUrl === `${PCS}/` || finalUrl === PCS) continue;
    if (finalUrl.includes('pagenotfound') || finalUrl.includes('404')) continue;

    await sleep(800);

    // Conta i risultati (righe con posizione numerica)
    const riderCount = await page.evaluate(() => {
      for (const table of document.querySelectorAll('table')) {
        const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
        const hasPos   = headers.some(h => /rnk|pos|#/.test(h));
        const hasRider = headers.some(h => /rider|name|cyclist/.test(h));
        if (!hasPos && !hasRider) continue;
        const rows = [...table.querySelectorAll('tbody tr')]
          .filter(tr => {
            const cells = tr.querySelectorAll('td');
            return cells[0] && /^\d+$/.test(cells[0].textContent.trim());
          });
        if (rows.length > 0) return rows.length;
      }
      return 0;
    }).catch(() => 0);

    if (riderCount > 0) {
      // Estrai lo slug pulito dall'URL finale (rimuovi /result e dominio)
      const cleanUrl = finalUrl
        .replace(`${PCS}/race/`, '')
        .replace(`${PCS}/national-race/`, '')
        .replace('/result', '')
        .replace(/\/$/, '');
      return { confirmed: true, finalSlug: cleanUrl, riderCount };
    }
  }
  return { confirmed: false, finalSlug: slug, riderCount: 0 };
}

// ─── Estrazione gara_id dai risultati ─────────────────────────────────────────

/**
 * Legge results_raw.json e restituisce:
 * - garaIds: Set di gara_id unici (con suffisso categoria _ELI_M etc.)
 * - calIdFromGara: Map gara_id → calendar_id (senza suffisso categoria)
 */
function extractGaraIds() {
  const resultsFile = path.join(DATA_DIR, 'seasons', String(SEASON), 'results_raw.json');
  if (!fs.existsSync(resultsFile)) return { garaIds: new Set(), calIdFromGara: new Map() };
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));

  const garaIds      = new Set();
  const calIdFromGara = new Map();

  const CAT_SUFFIX = /_(ELI|JUN|AL|ES[12])_[MF]$/;

  for (const r of results) {
    if (!r.gara_id) continue;
    garaIds.add(r.gara_id);
    // Ricava il calendar_id rimuovendo il suffisso categoria
    if (!calIdFromGara.has(r.gara_id)) {
      calIdFromGara.set(r.gara_id, r.gara_id.replace(CAT_SUFFIX, ''));
    }
  }
  return { garaIds, calIdFromGara };
}

/**
 * Costruisce mappa calendar_id → entry del calendario.
 */
function buildCalendarIndex() {
  const calIdx = new Map();
  for (const f of [
    path.join(DATA_DIR, 'calendar.json'),
    path.join(DATA_DIR, 'seasons', String(SEASON), 'calendar.json'),
  ]) {
    if (!fs.existsSync(f)) continue;
    for (const e of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (e.id) calIdx.set(e.id, e);
    }
  }
  return calIdx;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log(`=== PCS Race Discovery [stagione ${SEASON}] ===`);
  if (DRY_RUN) console.log('  [DRY-RUN: nessun dato verrà salvato]');
  console.log('');

  // Slugs già configurati
  const alreadyDone = await getAlreadyConfigured(sb);
  console.log(`Gare già con slug PCS: ${alreadyDone.size}`);

  // Risultati ICS
  const { garaIds, calIdFromGara } = extractGaraIds();
  const calIdx = buildCalendarIndex();

  // Filtra: solo gare ELI (Elite/U23) e, per gare donne, ELI_F e JUN_F
  // Raggruppa per calendar_id per evitare di verificare due volte la stessa gara fisica
  const todoByCalId = new Map(); // calId → Set di gara_ids
  const CAT_SUFFIX  = /_(ELI|JUN|AL|ES[12])_[MF]$/;

  for (const garaId of garaIds) {
    if (!FORCE && alreadyDone.has(garaId)) continue;

    const calId = calIdFromGara.get(garaId) || garaId;
    const cal   = calIdx.get(calId);
    if (!cal) continue;

    // Solo nazionali e internazionali (moltiplicatore >= 2)
    if (cal.tipo === 'regionale') continue;
    if ((cal.moltiplicatore || 1) < 2) continue;

    // Raggruppa per calId (stessa gara fisica con categorie diverse)
    if (!todoByCalId.has(calId)) todoByCalId.set(calId, new Set());
    todoByCalId.get(calId).add(garaId);
  }

  // Aggiungi anche le gare del calendario non ancora in results_raw
  // (future o da scraper) che siano nazionali/internazionali
  for (const [calId, cal] of calIdx) {
    if (cal.tipo === 'regionale' || (cal.moltiplicatore || 1) < 2) continue;
    if (!todoByCalId.has(calId) && !alreadyDone.has(calId)) {
      // Gara nel calendario ma senza risultati ICS ancora — aggiungi il calId diretto
      todoByCalId.set(calId, new Set([calId]));
    }
  }

  const todoList = [...todoByCalId.entries()];
  const alreadyCount = [...garaIds].filter(id => alreadyDone.has(id)).length +
    (FORCE ? 0 : [...todoByCalId.keys()].filter(id => alreadyDone.has(id)).length);

  console.log(`Gare ICS nel sistema (questa stagione): ${garaIds.size}`);
  console.log(`Da verificare su PCS: ${todoList.length}`);
  console.log('');

  if (!todoList.length) {
    console.log('Niente da fare — tutte le gare rilevanti hanno già uno slug PCS.');
    process.exit(0);
  }

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
    locale: 'it-IT', viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  await page.goto(PCS, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log(`Avviso: ${e.message}`));
  await sleep(2000);
  console.log('Browser pronto.\n');

  let found = 0, notFound = 0, skipped = 0;
  const results = []; // { calId, nome, slug, garaIds, riderCount }

  for (let i = 0; i < todoList.length; i++) {
    const [calId, garaIdSet] = todoList[i];
    const cal  = calIdx.get(calId);
    const nome = cal?.nome || calId;

    process.stdout.write(`[${i+1}/${todoList.length}] ${nome} (${cal?.data || '?'}) … `);

    const candidates = genCandidates(nome, SEASON);
    if (!candidates.length) { process.stdout.write('SKIP (slug vuoto)\n'); skipped++; continue; }

    let confirmed = false;
    let finalSlug = '';
    let riderCount = 0;

    for (const candidate of candidates) {
      const res = await verifySlug(page, candidate);
      if (res.confirmed) {
        confirmed = true;
        finalSlug = res.finalSlug;
        riderCount = res.riderCount;
        break;
      }
      await sleep(300);
    }

    if (confirmed) {
      process.stdout.write(`✓ ${finalSlug} (${riderCount} finisher)\n`);
      results.push({ calId, nome, slug: finalSlug, garaIds: [...garaIdSet], riderCount });

      if (!DRY_RUN) {
        // Salva per tutti i gara_id varianti di questa gara (ELI_M, ELI_F etc.)
        for (const gid of garaIdSet) {
          await saveSlug(sb, gid, finalSlug).catch(e => console.error(`  ERRORE salvataggio ${gid}: ${e.message}`));
        }
        // Salva anche per il calId base se diverso dai gara_ids
        if (!garaIdSet.has(calId)) {
          await saveSlug(sb, calId, finalSlug).catch(() => {});
        }
      }
      found++;
    } else {
      process.stdout.write(`— non trovata su PCS\n`);
      notFound++;
    }

    await sleep(400);
  }

  await browser.close();

  console.log('\n=== Riepilogo ===');
  console.log(`✅ Trovate su PCS: ${found}`);
  console.log(`❌ Non trovate:   ${notFound}`);
  console.log(`⏭  Saltate:       ${skipped}`);

  if (results.length) {
    console.log('\nGare trovate:');
    for (const r of results) {
      console.log(`  ${r.nome.padEnd(60)} → ${r.slug}`);
    }
  }

  if (DRY_RUN && found > 0) {
    console.log('\n[DRY-RUN] Riesegui senza --dry-run per salvare.');
  } else if (found > 0) {
    console.log(`\n${found} slug salvati in entity_overrides.`);
    console.log('Ora esegui pcs-race-scraper.js per importare i risultati.');
  }
})();
