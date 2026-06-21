'use strict';
/**
 * pcs-race-discovery.js — v3
 *
 * Strategia: usa i dati già raccolti per gli atleti PCS come "reverse-lookup" delle gare.
 *
 *  FASE 1 — DB: interroga pcs_results (atleti già scraped) → raccoglie tutti i
 *            (pcs_race_slug, data, gara_name) della stagione → mappa date → slug
 *
 *  FASE 2 — Browser: per atleti con pcs_slug in entity_overrides non ancora
 *            presenti in pcs_results → visita il loro profilo PCS e aggiunge
 *            i loro risultati stagionali alla mappa
 *
 *  FASE 3 — Matching: per ogni gara ICS senza slug, cerca nella mappa PCS
 *            le gare nella stessa data e calcola similarità nome → salva match
 *
 *  FASE 4 — Fallback: per le rimanenti, prova slug generato dal nome ICS
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node pcs-race-discovery.js [--season=YYYY] [--dry-run] [--force] [--min-score=0.3] [--no-browser]
 *
 * --dry-run    : non salva nulla
 * --force      : riprocessa anche gare già configurate
 * --min-score  : soglia similarità (default 0.3)
 * --no-browser : salta fase 2 (solo DB + fallback slug)
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

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const FORCE     = args.includes('--force');
const NO_BROWSER = args.includes('--no-browser');
const SEASON    = parseInt((args.find(a => a.startsWith('--season='))    || '').split('=')[1] || '') || new Date().getFullYear();
const MIN_SCORE = parseFloat((args.find(a => a.startsWith('--min-score=')) || '').split('=')[1] || '') || 0.30;

const DATA_DIR = path.join(__dirname, '..', 'data');
const PCS      = 'https://www.procyclingstats.com';
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// ─── Normalizzazione / similarità ─────────────────────────────────────────────

function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\d+[°^`']\s*/u, '')
    .toLowerCase()
    .replace(/['''`]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function jaccard(a, b) {
  const wa = new Set(normName(a).split(' ').filter(w => w.length >= 3));
  const wb = new Set(normName(b).split(' ').filter(w => w.length >= 3));
  if (!wa.size && !wb.size) return 1;
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

// ─── Slug generato da nome (fallback) ─────────────────────────────────────────

function nameToSlug(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\d+[°^`']\s*/u, '')
    .toLowerCase().replace(/['''`]/g, '')
    .replace(/[\s\-–—\/\\]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

function genFallbackCandidates(nome, season) {
  const base = nameToSlug(nome);
  if (!base) return [];
  const c = [`${base}/${season}`];
  for (const p of ['trofeo-','gran-premio-','gp-','memorial-','coppa-','circuito-','corsa-','giro-di-']) {
    if (base.startsWith(p)) c.push(`${base.slice(p.length)}/${season}`);
  }
  const parts = base.split('-');
  if (parts.length > 4) c.push(`${parts.slice(0,3).join('-')}/${season}`);
  return [...new Set(c)];
}

// ─── Supabase ──────────────────────────────────────────────────────────────────

async function getAlreadyConfigured(sb) {
  const { data, error } = await sb.from('entity_overrides')
    .select('entity_id, new_value').eq('entity_type','gara').eq('field','pcs_race_slug').limit(5000);
  if (error) throw new Error(error.message);
  return new Map((data||[]).map(r => [r.entity_id, r.new_value]));
}

/**
 * Fase 1: Query pcs_results → raccoglie tutti i (pcs_race_slug, data, gara_name)
 * Ritorna: Map<date, Set<{slug, name}>>
 */
async function getPcsRacesFromDB(sb) {
  console.log('  Interrogo pcs_results …');
  const pageSize = 1000;
  let offset = 0;
  const raceBySlug = new Map(); // slug → { slug, date, name }

  while (true) {
    const { data, error } = await sb.from('pcs_results')
      .select('pcs_race_slug, data, gara_name')
      .eq('season', SEASON)
      .not('pcs_race_slug', 'is', null)
      .not('data', 'is', null)
      .range(offset, offset + pageSize - 1);
    if (error) { console.error('  Errore pcs_results:', error.message); break; }
    if (!data?.length) break;
    for (const r of data) {
      if (!raceBySlug.has(r.pcs_race_slug)) {
        raceBySlug.set(r.pcs_race_slug, { slug: r.pcs_race_slug, date: r.data, name: r.gara_name || '' });
      }
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  // Costruisci mappa per data
  const byDate = new Map();
  for (const r of raceBySlug.values()) {
    if (!r.date) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  console.log(`  → ${raceBySlug.size} gare uniche da pcs_results (${byDate.size} date)`);
  return byDate;
}

/**
 * Fase 2a: Cerca atleti con pcs_slug in entity_overrides non ancora processati
 */
async function getAthletesPcsSlug(sb) {
  const { data, error } = await sb.from('entity_overrides')
    .select('entity_id, new_value')
    .eq('entity_type','atleta').eq('field','pcs_slug').limit(2000);
  if (error) { console.error('  Errore entity_overrides:', error.message); return []; }
  return (data||[]).map(r => ({ atleta_id: r.entity_id, pcs_slug: r.new_value }));
}

/**
 * Fase 2b: Per un atleta, interroga pcs_results e controlla se ha già dati.
 */
async function athleteHasPcsResults(sb, atletaId) {
  const { count } = await sb.from('pcs_results')
    .select('id', { count:'exact', head:true })
    .eq('atleta_id', atletaId).eq('season', SEASON);
  return (count||0) > 0;
}

/**
 * Fase 2c: Scraper profilo stagionale atleta su PCS.
 * Ritorna array di { slug, date, name }
 */
async function scrapeAthleteSeasonRaces(page, pcsSlug) {
  const url = `${PCS}/rider/${pcsSlug}/${SEASON}`;
  try { await page.goto(url, { waitUntil:'domcontentloaded', timeout:18000 }); }
  catch { return []; }
  if (page.url().includes('pagenotfound') || page.url().includes('404')) return [];
  await sleep(700);

  return page.evaluate((season) => {
    const rows = [];
    for (const table of document.querySelectorAll('table')) {
      const headers = [...table.querySelectorAll('th')].map(t => t.textContent.trim().toLowerCase());
      const hasResult = headers.some(h => /result|ris\.|pos|place/.test(h));
      if (!hasResult) continue;
      let iDate=-1, iRace=-1, iResult=-1;
      headers.forEach((h,i) => {
        if (iDate<0 && /date|data/.test(h)) iDate=i;
        if (iRace<0 && /race|gara|corsa/.test(h)) iRace=i;
        if (iResult<0 && /result|ris\.|pos|place/.test(h)) iResult=i;
      });
      if (iDate<0 || iRace<0) {
        const trs = table.querySelectorAll('tbody tr');
        if (!trs.length) continue;
        const first = [...trs[0].querySelectorAll('td')];
        if (first.length < 3 && /^\d{1,2}\.\d{2}$/.test(first[0]?.textContent?.trim())) {
          iDate=0; iRace=1; iResult=first.length>=4?3:2;
        } else continue;
      }
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')];
        if (cells.length < 3) continue;
        const dateRaw = cells[iDate]?.textContent?.trim() || '';
        const dm = dateRaw.match(/^(\d{1,2})\.(\d{2})$/);
        if (!dm) continue;
        const date = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
        const raceLink = cells[iRace]?.querySelector('a[href*="/race/"]');
        if (!raceLink) continue;
        const m = (raceLink.getAttribute('href')||'').match(/\/race\/([^/?]+\/\d{4})/);
        if (!m) continue;
        const slug = m[1];
        const name = raceLink.textContent.trim();
        if (slug && name) rows.push({ slug, date, name });
      }
      if (rows.length) break;
    }
    return rows;
  }, SEASON).catch(() => []);
}

async function saveSlug(sb, garaId, slug) {
  const { error } = await sb.from('entity_overrides').upsert(
    { entity_type:'gara', entity_id:garaId, field:'pcs_race_slug', new_value:slug, edited_by:null },
    { onConflict:'entity_type,entity_id,field' }
  );
  if (error) throw error;
}

async function verifySlug(page, slug) {
  const urls = [
    `${PCS}/race/${slug}/result`, `${PCS}/race/${slug}`,
    `${PCS}/national-race/${slug}/result`, `${PCS}/national-race/${slug}`,
  ];
  for (const url of urls) {
    try { await page.goto(url, { waitUntil:'domcontentloaded', timeout:16000 }); }
    catch { await page.goto('about:blank').catch(()=>{}); continue; }
    const fu = page.url();
    if (!fu || fu===`${PCS}/` || fu===PCS || fu.includes('pagenotfound') || fu.includes('404')) continue;
    await sleep(600);
    const count = await page.evaluate(() => {
      for (const table of document.querySelectorAll('table')) {
        const ths = [...table.querySelectorAll('th')].map(t => t.textContent.toLowerCase());
        if (!ths.some(h => /rnk|pos|rider|name/.test(h))) continue;
        const n = [...table.querySelectorAll('tbody tr')]
          .filter(tr => /^\d+$/.test(tr.querySelector('td')?.textContent?.trim()||'')).length;
        if (n > 0) return n;
      }
      return 0;
    }).catch(()=>0);
    if (count > 0) return true;
  }
  return false;
}

// ─── Calendario ───────────────────────────────────────────────────────────────

function buildCalendarIndex() {
  const byId = new Map(), byDate = new Map();
  for (const f of [
    path.join(DATA_DIR,'calendar.json'),
    path.join(DATA_DIR,'seasons',String(SEASON),'calendar.json'),
  ]) {
    if (!fs.existsSync(f)) continue;
    for (const e of JSON.parse(fs.readFileSync(f,'utf8'))) {
      if (!e.id) continue;
      byId.set(e.id, e);
      if (e.data) { if (!byDate.has(e.data)) byDate.set(e.data,[]); byDate.get(e.data).push(e); }
    }
  }
  return { byId, byDate };
}

function getRelevantGaraIds(alreadyDone, calIdx) {
  const CAT = /_(ELI|JUN|AL|ES[12])_[MF]$/;
  const resultsFile = path.join(DATA_DIR,'seasons',String(SEASON),'results_raw.json');
  const map = new Map(); // calId → Set<garaId>

  if (fs.existsSync(resultsFile)) {
    for (const r of JSON.parse(fs.readFileSync(resultsFile,'utf8'))) {
      if (!r.gara_id) continue;
      if (!FORCE && alreadyDone.has(r.gara_id)) continue;
      const calId = r.gara_id.replace(CAT,'');
      const cal = calIdx.byId.get(calId);
      if (!cal || cal.tipo==='regionale' || (cal.moltiplicatore||1)<2) continue;
      if (!map.has(calId)) map.set(calId, new Set());
      map.get(calId).add(r.gara_id);
    }
  }
  for (const [calId, cal] of calIdx.byId) {
    if (cal.tipo==='regionale' || (cal.moltiplicatore||1)<2) continue;
    if (!map.has(calId) && (FORCE || !alreadyDone.has(calId)))
      map.set(calId, new Set([calId]));
  }
  return map;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

function matchGara(icsNome, icsDate, pcsByDate) {
  const candidates = pcsByDate.get(icsDate) || [];
  if (!candidates.length) return null;
  let best = null;
  for (const pcs of candidates) {
    const score = jaccard(icsNome, pcs.name);
    if (!best || score > best.score) best = { ...pcs, score };
  }
  return best?.score >= MIN_SCORE ? best : null;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime:{ transport:ws } });

  console.log(`=== PCS Race Discovery v3 [stagione ${SEASON}] ===`);
  if (DRY_RUN)   console.log('  [DRY-RUN]');
  if (NO_BROWSER) console.log('  [NO-BROWSER: solo DB + fallback]');
  console.log(`  Min-score: ${MIN_SCORE}`);
  console.log('');

  const alreadyDone   = await getAlreadyConfigured(sb);
  const calIdx        = buildCalendarIndex();
  const garaIdsByCalId = getRelevantGaraIds(alreadyDone, calIdx);
  console.log(`Già configurate: ${alreadyDone.size} | Da trovare: ${garaIdsByCalId.size}\n`);

  // ── FASE 1: mappa PCS da pcs_results DB ───────────────────────────────────
  console.log('=== FASE 1: Gare PCS da DB (pcs_results) ===');
  const pcsByDate = await getPcsRacesFromDB(sb);
  console.log('');

  // ── FASE 2: Atleti con pcs_slug → scraping profili mancanti ──────────────
  let browser, page;
  if (!NO_BROWSER) {
    const { chromium } = require('playwright');
    console.log('=== FASE 2: Scraping profili atleti PCS ===');

    const athletesSlugs = await getAthletesPcsSlug(sb);
    console.log(`  Atleti con pcs_slug in entity_overrides: ${athletesSlugs.length}`);

    // Filtra quelli già in pcs_results
    const toScrape = [];
    for (const a of athletesSlugs) {
      const has = await athleteHasPcsResults(sb, a.atleta_id);
      if (!has) toScrape.push(a);
    }
    console.log(`  Da raschiare (senza pcs_results): ${toScrape.length}`);

    if (toScrape.length > 0) {
      const bravePaths = [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        (process.env.LOCALAPPDATA||'')+'\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      ];
      const bravePath = bravePaths.find(p => fs.existsSync(p));
      if (bravePath) {
        try { browser = await chromium.launch({ executablePath:bravePath, headless:false, args:['--no-sandbox'] }); }
        catch { /* fallback */ }
      }
      if (!browser) browser = await chromium.launch({ headless:false }).catch(()=>chromium.launch({ headless:true }));
      const ctx = await browser.newContext({
        userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale:'it-IT', viewport:{ width:1280, height:800 },
      });
      await ctx.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>undefined}));
      page = await ctx.newPage();
      await page.goto(PCS,{ waitUntil:'load', timeout:20000 }).catch(()=>{});
      await sleep(2000);

      let newRaces = 0;
      for (let i=0; i<toScrape.length; i++) {
        const a = toScrape[i];
        process.stdout.write(`  [${i+1}/${toScrape.length}] ${a.pcs_slug} … `);
        const races = await scrapeAthleteSeasonRaces(page, a.pcs_slug);
        for (const r of races) {
          if (!pcsByDate.has(r.date)) pcsByDate.set(r.date,[]);
          const existing = pcsByDate.get(r.date).find(x=>x.slug===r.slug);
          if (!existing) { pcsByDate.get(r.date).push(r); newRaces++; }
        }
        process.stdout.write(`${races.length} gare\n`);
        await sleep(600);
      }
      console.log(`  → ${newRaces} nuove gare aggiunte alla mappa PCS`);
    }
    console.log('');
  }

  // ── FASE 3: Matching ICS ↔ PCS per data + nome ────────────────────────────
  console.log('=== FASE 3: Matching per data + nome ===\n');

  const matched   = []; // { calId, nome, icsDate, slug, pcsName, score, garaIds }
  const uncertain = []; // score < 0.5 ma ≥ min_score
  const noMatch   = []; // nessun candidato PCS trovato

  for (const [calId, garaIds] of garaIdsByCalId) {
    const cal = calIdx.byId.get(calId);
    if (!cal) continue;
    const best = matchGara(cal.nome, cal.data, pcsByDate);
    if (!best) {
      noMatch.push({ calId, nome:cal.nome, date:cal.data, garaIds:[...garaIds] });
    } else if (best.score >= 0.5) {
      matched.push({ calId, nome:cal.nome, icsDate:cal.data, slug:best.slug, pcsName:best.name, score:best.score, garaIds:[...garaIds] });
    } else {
      uncertain.push({ calId, nome:cal.nome, icsDate:cal.data, slug:best.slug, pcsName:best.name, score:best.score, garaIds:[...garaIds] });
    }
  }

  console.log(`Match automatici (score ≥ 0.5): ${matched.length}`);
  console.log(`Match incerti   (0.3-0.5):      ${uncertain.length}`);
  console.log(`Nessun candidato PCS:            ${noMatch.length}\n`);

  if (uncertain.length) {
    console.log('─── Match INCERTI — verifica manuale ───');
    for (const m of uncertain) {
      console.log(`  [${(m.score*100).toFixed(0)}%] ${m.nome}`);
      console.log(`       PCS: "${m.pcsName}"  → ${m.slug}`);
    }
    console.log('');
  }

  // ── FASE 3b: Salva match automatici ───────────────────────────────────────
  let saved = 0;
  for (const m of matched) {
    process.stdout.write(`  [${(m.score*100).toFixed(0)}%] ${m.nome.slice(0,52).padEnd(52)} → ${m.slug} `);
    if (!DRY_RUN) {
      try {
        for (const gid of m.garaIds) await saveSlug(sb, gid, m.slug);
        if (!m.garaIds.includes(m.calId)) await saveSlug(sb, m.calId, m.slug).catch(()=>{});
        process.stdout.write('✓\n'); saved++;
      } catch(e) { process.stdout.write(`ERRORE: ${e.message}\n`); }
    } else { process.stdout.write('(dry-run)\n'); saved++; }
  }

  // ── FASE 4: Fallback slug-guessing per gare senza match ──────────────────
  if (noMatch.length) {
    console.log(`\n=== FASE 4: Fallback slug-guessing (${noMatch.length} gare) ===\n`);

    // Assicurati che il browser sia aperto per il fallback
    if (!browser && !NO_BROWSER) {
      const { chromium } = require('playwright');
      const bravePaths = [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        (process.env.LOCALAPPDATA||'')+'\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      ];
      const bravePath = bravePaths.find(p => fs.existsSync(p));
      if (bravePath) {
        try { browser = await chromium.launch({ executablePath:bravePath, headless:false, args:['--no-sandbox'] }); }
        catch { /* fallback */ }
      }
      if (!browser) browser = await chromium.launch({ headless:false }).catch(()=>chromium.launch({ headless:true }));
      const ctx = await browser.newContext({ userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', locale:'it-IT' });
      page = await ctx.newPage();
      await page.goto(PCS,{ waitUntil:'load', timeout:20000 }).catch(()=>{});
      await sleep(1500);
    }

    let fallbackFound = 0;
    for (let i=0; i<noMatch.length; i++) {
      const m = noMatch[i];
      const cands = genFallbackCandidates(m.nome, SEASON);
      process.stdout.write(`[${i+1}/${noMatch.length}] ${m.nome.slice(0,55)} … `);
      if (!cands.length || NO_BROWSER || !page) { process.stdout.write('skip\n'); continue; }

      let found = false;
      for (const slug of cands) {
        const ok = await verifySlug(page, slug);
        if (ok) {
          process.stdout.write(`✓ ${slug}\n`);
          if (!DRY_RUN) {
            try { for (const gid of m.garaIds) await saveSlug(sb, gid, slug); saved++; }
            catch(e) { process.stdout.write(`  ERR: ${e.message}\n`); }
          } else { saved++; }
          found = true; fallbackFound++;
          break;
        }
        await sleep(300);
      }
      if (!found) process.stdout.write('— non trovata\n');
      await sleep(350);
    }
    console.log(`\nFallback trovate: ${fallbackFound}`);
  }

  if (browser) await browser.close().catch(()=>{});

  // ── Riepilogo ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('=== RIEPILOGO ===');
  console.log(`Slug salvati/trovati:     ${saved}`);
  console.log(`Match incerti da revisionare: ${uncertain.length}`);
  console.log(`Non trovate:              ${noMatch.length - (saved - matched.length - (NO_BROWSER?0:0))}`);

  if (uncertain.length) {
    console.log('\nMatch incerti — aggiungi manualmente se corretti:');
    for (const m of uncertain) {
      console.log(`  ICS: "${m.nome}" [${m.icsDate}]`);
      console.log(`  PCS: "${m.pcsName}" → ${m.slug} (${(m.score*100).toFixed(0)}%)`);
      console.log(`  → node -e "require('./pcs-race-discovery-save.js')('${m.calId}','${m.slug}')" `);
    }
  }

  if (DRY_RUN) console.log('\n[DRY-RUN] Riesegui senza --dry-run per salvare.');
  else if (saved > 0) console.log(`\n${saved} slug salvati → esegui pcs-race-scraper.js per importare i risultati.`);
})();
