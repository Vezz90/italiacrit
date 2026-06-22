'use strict';
/**
 * pcs-race-discovery.js — v4
 *
 * Approccio ibrido in 4 fasi:
 *
 * FASE 1 — DB: interroga pcs_results (atleti già scraped) →
 *           ricava tutti i (pcs_race_slug, data, gara_name) della stagione
 *
 * FASE 2 — Atleti: visita le pagine profilo PCS degli atleti in athletes.json
 *           cercando per nome; raccoglie i loro risultati 2026 (altri slug)
 *           [solo se --with-athletes, richiede tempo]
 *
 * FASE 3 — Matching: gare ICS ↔ mappa PCS per data + similarità nome
 *
 * FASE 4 — Fallback: slug generato dal nome ICS + verifica diretta su PCS
 *           (con warm-up browser corretto)
 *
 * Uso:
 *   node pcs-race-discovery.js [--season=YYYY] [--dry-run] [--force]
 *                               [--min-score=0.3] [--with-athletes]
 *                               [--max-athletes=50]
 *
 * SEQUENZA CONSIGLIATA:
 *   1. node pcs-race-scraper.js           ← popola pcs_results (Firenze-Empoli)
 *   2. node pcs-race-discovery.js         ← usa pcs_results per trovare altre gare
 *   3. node pcs-race-scraper.js           ← importa tutte le nuove gare trovate
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
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const args         = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const FORCE        = args.includes('--force');
const WITH_ATHLETES = args.includes('--with-athletes');
const SEASON       = parseInt((args.find(a => a.startsWith('--season='))       || '').split('=')[1] || '') || new Date().getFullYear();
const MIN_SCORE    = parseFloat((args.find(a => a.startsWith('--min-score='))  || '').split('=')[1] || '') || 0.30;
const MAX_ATHLETES = parseInt((args.find(a => a.startsWith('--max-athletes=')) || '').split('=')[1] || '') || 60;

const DATA_DIR = path.join(__dirname, '..', 'data');
const PCS      = 'https://www.procyclingstats.com';
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// ─── Utilità ───────────────────────────────────────────────────────────────────

function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\d+[°^`']\s*/u, '')
    .toLowerCase().replace(/['''`]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
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

function nameToSlug(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\d+[°^`']\s*/u, '')
    .toLowerCase().replace(/['''`]/g, '')
    .replace(/[\s\-–—\/\\]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

// Slug speciali: pattern ICS → override slug PCS
const SLUG_OVERRIDES = {
  'campionato-italiano-strada-elite-e-under-23': 'italian-national-championship-road-elite-men',
  'campionato-italiano-strada-under-23':         'italian-national-championship-road-under-23-men',
  'campionato-italiano-strada-donne-elite-under-23': 'italian-national-championship-road-elite-women',
  'campionato-italiano-strada-donne-juniores':   'italian-national-championship-road-junior-women',
  'campionato-italiano-strada-juniores':         'italian-national-championship-road-junior-men',
  'campionato-italiano-strada-allievi':          'italian-national-championship-road-u17-men',
  'campionato-italiano-strada-donne-allieve':    'italian-national-championship-road-u17-women',
  'giro-dell-appennino':                         'giro-dell-appennino',
  'giro-della-toscana-femminile':                'giro-della-toscana',
};

function genCandidates(nome, season) {
  const base = nameToSlug(nome);
  if (!base) return [];
  const c = new Set();

  // Slug speciali
  for (const [pat, override] of Object.entries(SLUG_OVERRIDES)) {
    if (base.includes(pat.split('-')[0]) && base.includes(pat.split('-').slice(-1)[0])) {
      c.add(`${override}/${season}`);
    }
  }

  c.add(`${base}/${season}`);

  // Rimuovi prefissi comuni
  for (const p of ['trofeo-','gran-premio-','gp-','memorial-','coppa-','circuito-','corsa-','giro-di-','giro-del-','giro-della-','giro-dell-']) {
    if (base.startsWith(p)) c.add(`${base.slice(p.length)}/${season}`);
  }

  // Versioni abbreviate
  const parts = base.split('-').filter(Boolean);
  if (parts.length > 3) c.add(`${parts.slice(0,3).join('-')}/${season}`);
  if (parts.length > 4) c.add(`${parts.slice(0,4).join('-')}/${season}`);
  if (parts.length > 5) c.add(`${parts.slice(0,5).join('-')}/${season}`);

  // Variante senza apostrofo: "dell'" → "dell" e "d'" → "d"
  const noApos = base.replace(/-d-/g, '-d-').replace(/([a-z])-([a-z])/g, '$1$2');
  if (noApos !== base) c.add(`${noApos}/${season}`);

  return [...c];
}

// ─── Supabase ──────────────────────────────────────────────────────────────────

async function getAlreadyConfigured(sb) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id, new_value').eq('entity_type','gara').eq('field','pcs_race_slug').limit(5000);
  return new Map((data||[]).map(r => [r.entity_id, r.new_value]));
}

async function getPcsRacesFromDB(sb) {
  const batchSize = 1000;
  let offset = 0;
  const bySlug = new Map();
  while (true) {
    const { data, error } = await sb.from('pcs_results')
      .select('pcs_race_slug,data,gara_name')
      .eq('season', SEASON).not('pcs_race_slug','is',null).not('data','is',null)
      .range(offset, offset + batchSize - 1);
    if (error || !data?.length) break;
    for (const r of data) {
      if (!bySlug.has(r.pcs_race_slug))
        bySlug.set(r.pcs_race_slug, { slug:r.pcs_race_slug, date:r.data, name:r.gara_name||'' });
    }
    if (data.length < batchSize) break;
    offset += batchSize;
  }
  const byDate = new Map();
  for (const r of bySlug.values()) {
    if (!r.date) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  return { bySlug, byDate };
}

async function saveSlug(sb, garaId, slug) {
  const { error } = await sb.from('entity_overrides').upsert(
    { entity_type:'gara', entity_id:garaId, field:'pcs_race_slug', new_value:slug, edited_by:null },
    { onConflict:'entity_type,entity_id,field' }
  );
  if (error) throw error;
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
  const map = new Map();
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

// ─── Browser utils ────────────────────────────────────────────────────────────

async function launchBrowser(chromium) {
  const bravePaths = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env.LOCALAPPDATA||'')+'\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  const bravePath = bravePaths.find(p => fs.existsSync(p));
  let browser;
  if (bravePath) {
    try { browser = await chromium.launch({ executablePath:bravePath, headless:false, args:['--no-sandbox'] }); }
    catch { /* fallback */ }
  }
  if (!browser) {
    try { browser = await chromium.launch({ channel:'chrome', headless:false }); }
    catch { browser = await chromium.launch({ headless:false }); }
  }
  return browser;
}

async function warmupBrowser(page) {
  console.log('  Warm-up browser su PCS …');
  try {
    await page.goto(PCS, { waitUntil:'load', timeout:25000 });
    await sleep(2000);
    // Scorri un po' (simula comportamento umano)
    await page.evaluate(() => window.scrollTo(0, 300)).catch(()=>{});
    await sleep(800);
    console.log('  Browser pronto.\n');
  } catch(e) {
    console.log(`  (warm-up avviso: ${e.message.split('\n')[0]})\n`);
  }
}

// ─── PCS scraping atleta ──────────────────────────────────────────────────────

async function scrapeAthleteRaces(page, pcsSlug) {
  const url = `${PCS}/rider/${pcsSlug}`;
  try { await page.goto(url, { waitUntil:'load', timeout:18000 }); }
  catch { return []; }
  if (/pagenotfound|404/.test(page.url())) return [];
  await sleep(1000);

  const debug = await page.evaluate((season) => {
    const raceLinks = [...document.querySelectorAll('a[href*="/race/"]')];
    const dateRe = /\b(\d{1,2})\.(\d{2})\b/;
    const first5hrefs = raceLinks.slice(0, 5).map(a => a.getAttribute('href'));
    // Conta quanti hanno anno in href
    const withYear = raceLinks.filter(a => /\/race\/[^/]+\/\d{4}/.test(a.getAttribute('href')||'')).length;
    // Cerca una data vicina al primo link
    let firstDate = null;
    if (raceLinks[0]) {
      let el = raceLinks[0].parentElement;
      for (let d = 0; d < 8 && el && !firstDate; d++, el = el.parentElement) {
        for (const s of el.querySelectorAll('td,span,li,div')) {
          const t = s.textContent.trim();
          const dm = t.match(dateRe);
          if (dm && t.length <= 15) { firstDate = t; break; }
        }
      }
    }
    return { total: raceLinks.length, withYear, first5hrefs, firstDate };
  }, SEASON).catch(e => ({ error: e.message }));
  console.log(`    [DBG] url=${page.url().replace('https://www.procyclingstats.com','')}`);
  console.log(`    [DBG] raceLinks=${debug.total} withYear=${debug.withYear} firstDate=${debug.firstDate}`);
  if (debug.first5hrefs) console.log(`    [DBG] hrefs: ${debug.first5hrefs.join(' | ')}`);

  return page.evaluate((season) => {
    const rows = [];
    const seen = new Set();
    const dateRe = /\b(\d{1,2})\.(\d{2})\b/;

    for (const link of document.querySelectorAll('a[href*="/race/"]')) {
      const href = link.getAttribute('href') || '';
      let slug;
      const mYear = href.match(/\/race\/([^/?#]+\/(\d{4}))/);
      if (mYear) {
        if (parseInt(mYear[2]) !== season) continue;
        slug = mYear[1];
      } else {
        const mNoYear = href.match(/\/race\/([^/?#]+)/);
        if (!mNoYear) continue;
        slug = `${mNoYear[1]}/${season}`;
      }
      if (seen.has(slug)) continue;

      let dateStr = null;
      let el = link.parentElement;
      for (let depth = 0; depth < 6 && el && !dateStr; depth++, el = el.parentElement) {
        for (const child of el.childNodes) {
          const t = (child.textContent || '').trim();
          const dm = t.match(dateRe);
          if (dm && t.length <= 10) {
            dateStr = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
            break;
          }
        }
        if (!dateStr) {
          for (const s of el.querySelectorAll('td,span,li')) {
            const t = s.textContent.trim();
            const dm = t.match(dateRe);
            if (dm && t.length <= 10) {
              dateStr = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
              break;
            }
          }
        }
      }
      if (!dateStr) continue;
      seen.add(slug);
      rows.push({ slug, date: dateStr, name: link.textContent.trim() });
    }
    return rows;
  }, SEASON).catch(()=>[]);
}

/**
 * Costruisce lo slug PCS direttamente dal nome/cognome ICS.
 * PCS usa "nome-cognome" (tutto lowercase, trattini).
 * Es: "LONGO BORGHINI" + "Elisa" → "elisa-longo-borghini"
 */
function makeRiderSlug(cognome, nome) {
  const norm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'')
    .toLowerCase().replace(/[^a-z0-9\s]/g,' ').trim().replace(/\s+/g,'-');
  return `${norm(nome)}-${norm(cognome)}`;
}

/**
 * Verifica se lo slug atleta esiste su PCS e ha risultati nella stagione corrente.
 * Usa la pagina principale (senza anno) che mostra la stagione corrente.
 * Ritorna lo slug confermato o null.
 */
async function findAthleteOnPcs(page, cognome, nome) {
  const slug = makeRiderSlug(cognome, nome);
  const url  = `${PCS}/rider/${slug}`;
  try { await page.goto(url, { waitUntil:'load', timeout:18000 }); }
  catch { return null; }
  const fu = page.url();
  if (!fu || fu===`${PCS}/` || fu===PCS || /pagenotfound|404/.test(fu)) return null;
  await sleep(700);
  // Cerca celle con data DD.MM (indica risultati stagionali presenti)
  // e almeno un link a una gara → profilo valido con dati stagione
  const hasRaceResults = await page.evaluate(() => {
    const hasDate = [...document.querySelectorAll('td,span')].some(
      el => /^\d{1,2}\.\d{2}$/.test(el.textContent.trim())
    );
    const hasRaceLink = !!document.querySelector('a[href*="/race/"]');
    return hasDate && hasRaceLink;
  }).catch(()=>false);
  return hasRaceResults ? slug : null;
}

// ─── Verifica singolo slug ─────────────────────────────────────────────────────

async function verifySlug(page, slug) {
  // Per gare a tappe (stage races) prova anche /gc e /gc/result
  const urls = [
    `${PCS}/race/${slug}/result`,
    `${PCS}/race/${slug}/gc/result`,
    `${PCS}/race/${slug}/gc`,
    `${PCS}/race/${slug}`,
    `${PCS}/national-race/${slug}/result`,
    `${PCS}/national-race/${slug}`,
  ];
  for (const url of urls) {
    try { await page.goto(url, { waitUntil:'domcontentloaded', timeout:18000 }); }
    catch(e) {
      await page.goto('about:blank').catch(()=>{});
      continue;
    }
    const fu = page.url();
    if (!fu || fu===`${PCS}/` || fu===PCS || /pagenotfound|404/.test(fu)) continue;
    await sleep(600);
    const count = await page.evaluate(() => {
      for (const table of document.querySelectorAll('table')) {
        const ths = [...table.querySelectorAll('th')].map(t=>t.textContent.toLowerCase());
        // Accetta intestazioni tipiche sia per gare in linea sia per classifiche a tappe
        if (!ths.some(h => /rnk|pos|#|rider|name|cyclist/.test(h))) continue;
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

// ─── Matching ─────────────────────────────────────────────────────────────────

function findBestPcsMatch(icsNome, icsDate, pcsByDate) {
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
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime:{transport:ws} });

  console.log(`=== PCS Race Discovery v4 [stagione ${SEASON}] ===`);
  if (DRY_RUN)       console.log('  [DRY-RUN: nessun dato verrà salvato]');
  if (WITH_ATHLETES) console.log('  [WITH-ATHLETES: cerca atleti ICS su PCS]');
  console.log(`  Min-score similarità: ${MIN_SCORE}\n`);

  const alreadyDone   = await getAlreadyConfigured(sb);
  const calIdx        = buildCalendarIndex();
  const garaIdsByCalId = getRelevantGaraIds(alreadyDone, calIdx);
  console.log(`Già configurate: ${alreadyDone.size} | Da trovare: ${garaIdsByCalId.size}\n`);

  // ── FASE 1: DB pcs_results ─────────────────────────────────────────────────
  console.log('=== FASE 1: Gare PCS da pcs_results (DB) ===');
  const { bySlug: pcsSlugMap, byDate: pcsByDate } = await getPcsRacesFromDB(sb);
  const dbRaceCount = pcsSlugMap.size;
  console.log(`  ${dbRaceCount} gare uniche in pcs_results, ${pcsByDate.size} date\n`);

  if (dbRaceCount === 0) {
    console.log('  ⚠️  pcs_results è vuoto.');
    console.log('  → Esegui prima: node pcs-race-scraper.js');
    console.log('    (importa atleti dalla gara già configurata e salva i loro risultati stagionali)\n');
  }

  // ── FASE 2: Atleti ICS → profili PCS (opzionale) ──────────────────────────
  let browser, page;

  if (WITH_ATHLETES || dbRaceCount === 0) {
    console.log('=== FASE 2: Cerca atleti ICS su PCS per raccogliere più gare ===');

    // Carica athletes.json — prendi i più attivi (hanno risultati nel sistema)
    const athletesFile = path.join(DATA_DIR, 'seasons', String(SEASON), 'athletes.json');
    const athletesAll  = fs.existsSync(athletesFile)
      ? JSON.parse(fs.readFileSync(athletesFile, 'utf8'))
      : {};

    // Conta risultati per atleta in results_raw per prioritizzare quelli attivi
    const resultsFile = path.join(DATA_DIR,'seasons',String(SEASON),'results_raw.json');
    const resultCount = {};
    if (fs.existsSync(resultsFile)) {
      for (const r of JSON.parse(fs.readFileSync(resultsFile,'utf8'))) {
        if (r.atleta_id) resultCount[r.atleta_id] = (resultCount[r.atleta_id]||0)+1;
      }
    }

    // Prendi atleti ELI_M e ELI_F con più risultati — più probabilmente su PCS
    const candidates = Object.entries(athletesAll)
      .filter(([id, a]) => {
        const cat = a.categoria || '';
        return cat === 'ELI_M' || cat === 'ELI_F';
      })
      .sort((a, b) => (resultCount[b[0]]||0) - (resultCount[a[0]]||0))
      .slice(0, MAX_ATHLETES);

    console.log(`  Selezionati ${candidates.length} atleti ELI da cercare su PCS`);

    if (candidates.length > 0) {
      browser = await launchBrowser(chromium);
      const ctx = await browser.newContext({
        userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale:'it-IT', viewport:{ width:1280, height:800 },
      });
      await ctx.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>undefined}));
      page = await ctx.newPage();
      await warmupBrowser(page);

      let foundAthletes = 0, newRaces = 0;
      for (let i=0; i<candidates.length; i++) {
        const [id, a] = candidates[i];
        const cognome = a.cognome || '';
        const nome    = a.nome    || '';
        if (!cognome) continue;

        process.stdout.write(`  [${i+1}/${candidates.length}] ${cognome} ${nome} … `);
        const pcsSlug = await findAthleteOnPcs(page, cognome, nome);
        if (!pcsSlug) { process.stdout.write('non trovato su PCS\n'); await sleep(400); continue; }

        const races = await scrapeAthleteRaces(page, pcsSlug);
        foundAthletes++;
        let added = 0;
        for (const r of races) {
          if (!pcsByDate.has(r.date)) pcsByDate.set(r.date, []);
          if (!pcsByDate.get(r.date).find(x => x.slug===r.slug)) {
            pcsByDate.get(r.date).push(r);
            added++; newRaces++;
          }
        }
        process.stdout.write(`${pcsSlug} → ${races.length} gare (+${added} nuove)\n`);
        await sleep(600);
      }
      console.log(`\n  Atleti trovati: ${foundAthletes} | Nuove gare aggiunte: ${newRaces}\n`);
    }
  }

  // ── FASE 3: Matching ICS ↔ PCS ────────────────────────────────────────────
  console.log('=== FASE 3: Matching per data + nome ===\n');

  const matched   = [];
  const uncertain = [];
  const noMatch   = [];

  for (const [calId, garaIds] of garaIdsByCalId) {
    const cal  = calIdx.byId.get(calId);
    if (!cal) continue;
    const best = findBestPcsMatch(cal.nome, cal.data, pcsByDate);
    if (!best) {
      noMatch.push({ calId, nome:cal.nome, date:cal.data, garaIds:[...garaIds] });
    } else if (best.score >= 0.5) {
      matched.push({ calId, nome:cal.nome, icsDate:cal.data, slug:best.slug, pcsName:best.name, score:best.score, garaIds:[...garaIds] });
    } else {
      uncertain.push({ calId, nome:cal.nome, icsDate:cal.data, slug:best.slug, pcsName:best.name, score:best.score, garaIds:[...garaIds] });
    }
  }

  console.log(`Match automatici (≥0.5):  ${matched.length}`);
  console.log(`Match incerti (0.3-0.5):  ${uncertain.length}`);
  console.log(`Nessun candidato:         ${noMatch.length}\n`);

  if (uncertain.length) {
    console.log('─── Match incerti (verifica manuale) ───');
    for (const m of uncertain)
      console.log(`  [${(m.score*100).toFixed(0)}%] "${m.nome}" → "${m.pcsName}" (${m.slug})`);
    console.log('');
  }

  // Salva match automatici
  let saved = 0;
  for (const m of matched) {
    process.stdout.write(`  [${(m.score*100).toFixed(0)}%] ${m.nome.slice(0,50).padEnd(50)} → ${m.slug} `);
    if (!DRY_RUN) {
      try {
        for (const gid of m.garaIds) await saveSlug(sb, gid, m.slug);
        if (!m.garaIds.includes(m.calId)) await saveSlug(sb, m.calId, m.slug).catch(()=>{});
        process.stdout.write('✓\n'); saved++;
      } catch(e) { process.stdout.write(`ERR: ${e.message}\n`); }
    } else { process.stdout.write('(dry-run)\n'); saved++; }
  }

  // ── FASE 4: Fallback slug-guessing ────────────────────────────────────────
  if (noMatch.length > 0) {
    console.log(`\n=== FASE 4: Fallback slug-guessing (${noMatch.length} gare) ===\n`);

    // Apri browser se non già aperto
    if (!browser) {
      browser = await launchBrowser(chromium);
      const ctx = await browser.newContext({
        userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale:'it-IT', viewport:{ width:1280, height:800 },
      });
      await ctx.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>undefined}));
      page = await ctx.newPage();
      await warmupBrowser(page);
    }

    let fallbackFound = 0;
    for (let i=0; i<noMatch.length; i++) {
      const m = noMatch[i];
      const cands = genCandidates(m.nome, SEASON);
      process.stdout.write(`[${i+1}/${noMatch.length}] ${m.nome.slice(0,55)} … `);
      if (!cands.length) { process.stdout.write('skip\n'); continue; }

      let found = false;
      for (const slug of cands) {
        const ok = await verifySlug(page, slug);
        if (ok) {
          process.stdout.write(`✓ ${slug}\n`);
          if (!DRY_RUN) {
            try { for (const gid of m.garaIds) await saveSlug(sb, gid, slug); saved++; }
            catch(e) { process.stdout.write(`  ERR: ${e.message}\n`); }
          } else { saved++; }
          // Aggiungi alla mappa per matching futuri nella stessa run
          const entry = { slug, date:m.date, name:m.nome };
          if (!pcsByDate.has(m.date)) pcsByDate.set(m.date, []);
          pcsByDate.get(m.date).push(entry);
          found = true; fallbackFound++;
          break;
        }
        await sleep(350);
      }
      if (!found) process.stdout.write('— non trovata\n');
      await sleep(400);
    }
    console.log(`\nFallback trovate: ${fallbackFound}`);
  }

  if (browser) await browser.close().catch(()=>{});

  // ── Riepilogo ─────────────────────────────────────────────────────────────
  const totalFound = saved;
  console.log('\n═══════════════════════════════════════════');
  console.log(`=== RIEPILOGO [${DRY_RUN?'DRY-RUN':'SALVATO'}] ===`);
  console.log(`Trovate e ${DRY_RUN?'simulate':'salvate'}: ${totalFound}`);
  console.log(`Match incerti da revisionare: ${uncertain.length}`);

  if (uncertain.length) {
    console.log('\nPer salvare i match incerti:');
    for (const m of uncertain)
      console.log(`  ICS: "${m.nome}" [${m.icsDate}] PCS: "${m.pcsName}" → ${m.slug}`);
  }

  if (dbRaceCount === 0 && !WITH_ATHLETES) {
    console.log('\n💡 SUGGERIMENTO: pcs_results è vuoto.');
    console.log('   Esegui prima pcs-race-scraper.js, poi rilancia questo script.');
    console.log('   Oppure: node pcs-race-discovery.js --with-athletes');
    console.log('   (cerca gli atleti ICS direttamente su PCS — più lento ma non richiede il scraper)');
  }

  if (DRY_RUN) console.log('\nRiesegui senza --dry-run per salvare.');
  else if (totalFound > 0) console.log(`\n${totalFound} slug salvati → esegui pcs-race-scraper.js.`);
})();
