'use strict';
/**
 * pcs-race-discovery.js — v2
 * Strategia:
 *  1. Raschia da PCS la lista completa delle gare italiane 2026
 *     (più pagine: elite uomini, donne, under 23, juniores, nazionali)
 *  2. Costruisce un indice PCS indicizzato per data (YYYY-MM-DD)
 *  3. Confronta con il calendario ICS: per ogni gara ICS cerca candidati PCS
 *     nella stessa data e calcola similarità del nome
 *  4. Match sicuri (score ≥ soglia) → salva automaticamente in entity_overrides
 *  5. Match incerti → stampa per revisione manuale
 *  6. Fallback: per gare senza match tenta lo slug generato dal nome ICS
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node pcs-race-discovery.js [--season=YYYY] [--dry-run] [--force] [--min-score=0.3]
 *
 * --dry-run      : verifica senza salvare
 * --force        : riprocessa anche gare già configurate
 * --min-score=N  : soglia similarità 0-1 (default 0.3)
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

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const FORCE    = args.includes('--force');
const SEASON   = parseInt((args.find(a => a.startsWith('--season='))   || '').split('=')[1] || '') || new Date().getFullYear();
const MIN_SCORE = parseFloat((args.find(a => a.startsWith('--min-score=')) || '').split('=')[1] || '') || 0.3;

const DATA_DIR = path.join(__dirname, '..', 'data');
const PCS      = 'https://www.procyclingstats.com';
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// ─── Normalizzazione nomi ───────────────────────────────────────────────────────

function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\d+[°^`']\s*/u, '')           // rimuovi numero edizione
    .toLowerCase()
    .replace(/['''`]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Similarità Jaccard tra due stringhe normalizzate (su parole ≥ 3 char).
 * Restituisce 0-1.
 */
function jaccard(a, b) {
  const wa = new Set(normName(a).split(' ').filter(w => w.length >= 3));
  const wb = new Set(normName(b).split(' ').filter(w => w.length >= 3));
  if (!wa.size && !wb.size) return 1;
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

// ─── Slug da nome (fallback) ────────────────────────────────────────────────────

function nameToSlug(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^\d+[°^`']\s*/u, '')
    .toLowerCase()
    .replace(/['''`]/g, '')
    .replace(/[\s\-–—\/\\]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function genFallbackCandidates(nome, season) {
  const base = nameToSlug(nome);
  if (!base) return [];
  const cands = [`${base}/${season}`];
  for (const prefix of ['trofeo-', 'gran-premio-', 'gp-', 'memorial-', 'coppa-', 'circuito-', 'corsa-', 'giro-di-']) {
    if (base.startsWith(prefix)) cands.push(`${base.slice(prefix.length)}/${season}`);
  }
  const parts = base.split('-');
  if (parts.length > 4) cands.push(`${parts.slice(0, 3).join('-')}/${season}`);
  return [...new Set(cands)];
}

// ─── PCS: raschia lista gare ────────────────────────────────────────────────────

/**
 * Visita le pagine di listing PCS e ritorna tutte le gare trovate:
 * [{ date: 'YYYY-MM-DD', name: string, slug: string }]
 *
 * Pagine da visitare:
 *   /races.php?year=YYYY&circuit=1&filter=Filter   (World Tour)
 *   /races.php?year=YYYY&circuit=&country=ITA&filter=Filter  (gare in Italia)
 *   /races.php?year=YYYY&circuit=&category=1.1&country=ITA  (cat 1.1)
 *   + stessa cosa per donne, juniores, under 23
 */
async function scrapePcsRaceList(page, season) {
  const raceMap = new Map(); // slug → { date, name, slug }

  const listingUrls = [
    // Gare in Italia (tutte le categorie)
    `${PCS}/races.php?year=${season}&circuit=&s=race-date&continent=&country=ITA&type=&category=&profile=&filter=Filter&p=me&limit=100`,
    // Gare women in Italia
    `${PCS}/races.php?year=${season}&circuit=&s=race-date&continent=&country=ITA&type=women&category=&profile=&filter=Filter&p=me&limit=100`,
    // Internazionali genere maschile con partenza/arrivo in Italia (circuit = UCI Europe Tour e simili)
    `${PCS}/races.php?year=${season}&circuit=4&s=race-date&continent=&country=ITA&filter=Filter&p=me&limit=100`,
    // National races Italia
    `${PCS}/races.php?year=${season}&circuit=national&s=race-date&continent=&country=ITA&filter=Filter&p=me&limit=100`,
  ];

  for (const url of listingUrls) {
    console.log(`  → lista: ${url}`);
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
    catch (e) { console.log(`    (skip: ${e.message.split('\n')[0]})`); continue; }

    if (page.url().includes('pagenotfound') || page.url().includes('404')) continue;
    await sleep(1000);

    // Scorri tutte le pagine di questo listing
    let pageNum = 0;
    while (true) {
      pageNum++;
      const found = await page.evaluate((pcsBase, yr) => {
        const rows = [];
        // PCS usa tabelle con link /race/ o /national-race/
        for (const a of document.querySelectorAll('a[href*="/race/"], a[href*="/national-race/"]')) {
          const href = a.getAttribute('href') || '';
          // Estrai slug (tutto tra /race/ o /national-race/ e il prossimo /)
          const m = href.match(/\/((?:national-)?race)\/([^/?\s]+\/\d{4}(?:\/[^/?\s]*)?)/);
          if (!m) continue;
          const slug = m[2];
          // Salta i profili rider e altri link
          if (slug.includes('/stage') && !slug.endsWith('/result')) continue;
          // Data: cerca nell'elemento padre / riga tabella
          let dateStr = null;
          const row = a.closest('tr');
          if (row) {
            const cells = [...row.querySelectorAll('td, th')];
            for (const cell of cells) {
              const t = cell.textContent.trim();
              // Formato PCS: "21.02" oppure "21.02.2026" oppure "2026-02-21"
              const dm = t.match(/^(\d{1,2})\.(\d{2})(?:\.(\d{4}))?$/);
              if (dm) {
                const y = dm[3] || String(yr);
                dateStr = `${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
                break;
              }
              const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (iso) { dateStr = t; break; }
            }
          }
          const name = a.textContent.trim();
          if (!slug || !name) continue;
          rows.push({ slug, name, date: dateStr });
        }
        return rows;
      }, PCS, season).catch(() => []);

      for (const r of found) {
        if (!raceMap.has(r.slug)) raceMap.set(r.slug, r);
      }

      // Cerca paginazione ("next")
      const hasNext = await page.evaluate(() => {
        const next = document.querySelector('a[rel="next"], .pagination a:last-child, a.next');
        if (next && next.href && !next.href.includes('pagenotfound')) {
          next.click(); return true;
        }
        return false;
      }).catch(() => false);

      if (!hasNext || pageNum > 10) break;
      await sleep(1200);
    }
    await sleep(600);
  }

  // Rimuovi gare senza data (non utili per il matching)
  const list = [...raceMap.values()].filter(r => r.date);
  console.log(`  PCS: ${list.length} gare trovate con data`);
  return list;
}

// ─── Verifica singolo slug (fallback) ──────────────────────────────────────────

async function verifySlug(page, slug) {
  const urls = [
    `${PCS}/race/${slug}/result`,
    `${PCS}/race/${slug}`,
    `${PCS}/national-race/${slug}/result`,
    `${PCS}/national-race/${slug}`,
  ];
  for (const url of urls) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 18000 }); }
    catch { await page.goto('about:blank').catch(() => {}); continue; }
    const finalUrl = page.url();
    if (!finalUrl || finalUrl === 'about:blank' || finalUrl === `${PCS}/` || finalUrl === PCS) continue;
    if (finalUrl.includes('pagenotfound') || finalUrl.includes('404')) continue;
    await sleep(700);
    const count = await page.evaluate(() => {
      for (const table of document.querySelectorAll('table')) {
        const ths = [...table.querySelectorAll('th')].map(t => t.textContent.toLowerCase());
        if (!ths.some(h => /rnk|pos|rider|name/.test(h))) continue;
        const n = [...table.querySelectorAll('tbody tr')]
          .filter(tr => /^\d+$/.test(tr.querySelector('td')?.textContent?.trim() || '')).length;
        if (n > 0) return n;
      }
      return 0;
    }).catch(() => 0);
    if (count > 0) return { confirmed: true, riderCount: count };
  }
  return { confirmed: false, riderCount: 0 };
}

// ─── Supabase ──────────────────────────────────────────────────────────────────

async function getAlreadyConfigured(sb) {
  const { data, error } = await sb.from('entity_overrides')
    .select('entity_id, new_value').eq('entity_type', 'gara').eq('field', 'pcs_race_slug').limit(5000);
  if (error) { console.error('Errore:', error.message); return new Map(); }
  return new Map((data || []).map(r => [r.entity_id, r.new_value]));
}

async function saveSlug(sb, garaId, slug) {
  const { error } = await sb.from('entity_overrides').upsert(
    { entity_type: 'gara', entity_id: garaId, field: 'pcs_race_slug', new_value: slug, edited_by: null },
    { onConflict: 'entity_type,entity_id,field' }
  );
  if (error) throw error;
}

// ─── Calendario & risultati ────────────────────────────────────────────────────

function buildCalendarIndex() {
  const byId   = new Map();
  const byDate = new Map();
  for (const f of [
    path.join(DATA_DIR, 'calendar.json'),
    path.join(DATA_DIR, 'seasons', String(SEASON), 'calendar.json'),
  ]) {
    if (!fs.existsSync(f)) continue;
    for (const e of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (!e.id) continue;
      byId.set(e.id, e);
      if (e.data) {
        if (!byDate.has(e.data)) byDate.set(e.data, []);
        byDate.get(e.data).push(e);
      }
    }
  }
  return { byId, byDate };
}

function getRelevantGaraIds(alreadyDone, calIdx) {
  const resultsFile = path.join(DATA_DIR, 'seasons', String(SEASON), 'results_raw.json');
  const CAT_SUFFIX  = /_(ELI|JUN|AL|ES[12])_[MF]$/;

  const garaIdsByCalId = new Map(); // calId → Set<garaId>

  if (fs.existsSync(resultsFile)) {
    for (const r of JSON.parse(fs.readFileSync(resultsFile, 'utf8'))) {
      if (!r.gara_id) continue;
      if (!FORCE && alreadyDone.has(r.gara_id)) continue;
      const calId = r.gara_id.replace(CAT_SUFFIX, '');
      const cal   = calIdx.byId.get(calId);
      if (!cal || cal.tipo === 'regionale' || (cal.moltiplicatore || 1) < 2) continue;
      if (!garaIdsByCalId.has(calId)) garaIdsByCalId.set(calId, new Set());
      garaIdsByCalId.get(calId).add(r.gara_id);
    }
  }

  // Aggiungi gare del calendario non ancora nei risultati
  for (const [calId, cal] of calIdx.byId) {
    if (cal.tipo === 'regionale' || (cal.moltiplicatore || 1) < 2) continue;
    if (!garaIdsByCalId.has(calId) && !alreadyDone.has(calId)) {
      garaIdsByCalId.set(calId, new Set([calId]));
    }
  }

  return garaIdsByCalId;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log(`=== PCS Race Discovery v2 [stagione ${SEASON}] ===`);
  if (DRY_RUN) console.log('  [DRY-RUN: nessun dato verrà salvato]');
  console.log(`  Soglia similarità nome: ${MIN_SCORE}`);
  console.log('');

  const alreadyDone = await getAlreadyConfigured(sb);
  console.log(`Gare già configurate: ${alreadyDone.size}\n`);

  const calIdx         = buildCalendarIndex();
  const garaIdsByCalId = getRelevantGaraIds(alreadyDone, calIdx);
  console.log(`Da cercare: ${garaIdsByCalId.size} gare ICS nazionali/internazionali\n`);

  // Browser
  const bravePaths = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env.LOCALAPPDATA || '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  const bravePath = bravePaths.find(p => fs.existsSync(p));
  let browser;
  if (bravePath) {
    try { browser = await chromium.launch({ executablePath: bravePath, headless: false, args: ['--no-sandbox'] }); }
    catch { /* fallback */ }
  }
  if (!browser) browser = await chromium.launch({ headless: false }).catch(() => chromium.launch({ headless: true }));

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'it-IT', viewport: { width: 1280, height: 800 },
  });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  const page = await ctx.newPage();

  // Visita homepage PCS prima (cookie / anti-bot)
  console.log('Connessione a PCS …');
  await page.goto(PCS, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log(`  Avviso: ${e.message}`));
  await sleep(2500);
  console.log('');

  // ── FASE 1: Raschia lista gare PCS ─────────────────────────────────────────
  console.log('=== FASE 1: Lista gare italiane da PCS ===');
  const pcsRaces = await scrapePcsRaceList(page, SEASON);

  // Indice PCS per data
  const pcsByDate = new Map();
  for (const r of pcsRaces) {
    if (!pcsByDate.has(r.date)) pcsByDate.set(r.date, []);
    pcsByDate.get(r.date).push(r);
  }
  console.log(`Indice PCS: ${pcsByDate.size} date con gare\n`);

  // ── FASE 2: Matching ICS ↔ PCS ─────────────────────────────────────────────
  console.log('=== FASE 2: Matching ICS ↔ PCS ===\n');

  const autoMatches     = []; // { calId, nome, icsDate, slug, score, garaIds }
  const uncertainMatches = []; // idem, ma score < threshold per sicurezza piena
  const noMatch         = []; // { calId, nome, icsDate, garaIds }

  for (const [calId, garaIds] of garaIdsByCalId) {
    const cal     = calIdx.byId.get(calId);
    if (!cal) continue;
    const icsDate = cal.data;
    const icsNome = cal.nome || calId;

    const pcsCandidates = pcsByDate.get(icsDate) || [];

    if (!pcsCandidates.length) {
      noMatch.push({ calId, nome: icsNome, icsDate, garaIds: [...garaIds] });
      continue;
    }

    // Calcola score per ogni candidato PCS nella stessa data
    let best = null;
    for (const pcs of pcsCandidates) {
      const score = jaccard(icsNome, pcs.name);
      if (!best || score > best.score) best = { ...pcs, score };
    }

    if (best.score >= MIN_SCORE) {
      // Match abbastanza sicuro
      if (best.score >= 0.5) {
        autoMatches.push({ calId, nome: icsNome, pcsName: best.name, icsDate, slug: best.slug, score: best.score, garaIds: [...garaIds] });
      } else {
        // Score basso — stampa come incerto
        uncertainMatches.push({ calId, nome: icsNome, pcsName: best.name, icsDate, slug: best.slug, score: best.score, garaIds: [...garaIds] });
      }
    } else {
      noMatch.push({ calId, nome: icsNome, icsDate, garaIds: [...garaIds], pcsCandidates: pcsCandidates.slice(0, 3) });
    }
  }

  console.log(`Match automatici (score ≥ 0.5):  ${autoMatches.length}`);
  console.log(`Match incerti   (score 0.3-0.5): ${uncertainMatches.length}`);
  console.log(`Senza match PCS nella stessa data: ${noMatch.length}\n`);

  // Stampa match incerti per revisione
  if (uncertainMatches.length) {
    console.log('─── Match INCERTI (confermare manualmente) ───');
    for (const m of uncertainMatches) {
      console.log(`  [${(m.score*100).toFixed(0)}%] ${m.nome}`);
      console.log(`       → ${m.pcsName}  (${m.slug})`);
    }
    console.log('');
  }

  // ── FASE 3: Salva match automatici ─────────────────────────────────────────
  console.log('=== FASE 3: Salvataggio match automatici ===\n');
  let saved = 0, errSave = 0;

  for (const m of autoMatches) {
    process.stdout.write(`  [${(m.score*100).toFixed(0)}%] ${m.nome.padEnd(55)} → ${m.slug} … `);
    if (!DRY_RUN) {
      try {
        for (const gid of m.garaIds) await saveSlug(sb, gid, m.slug);
        if (!m.garaIds.includes(m.calId)) await saveSlug(sb, m.calId, m.slug).catch(() => {});
        process.stdout.write('✓\n');
        saved++;
      } catch(e) {
        process.stdout.write(`ERRORE: ${e.message}\n`);
        errSave++;
      }
    } else {
      process.stdout.write('(dry-run)\n');
      saved++;
    }
  }

  // ── FASE 4: Fallback slug-guessing per gare senza match PCS ───────────────
  console.log(`\n=== FASE 4: Fallback slug-guessing (${noMatch.length} gare) ===\n`);
  let fallbackFound = 0;

  for (let i = 0; i < noMatch.length; i++) {
    const m = noMatch[i];
    const cands = genFallbackCandidates(m.nome, SEASON);
    if (!cands.length) continue;

    process.stdout.write(`[${i+1}/${noMatch.length}] ${m.nome.slice(0,55)} … `);

    let confirmed = false;
    for (const slug of cands) {
      const res = await verifySlug(page, slug);
      if (res.confirmed) {
        process.stdout.write(`✓ ${slug}\n`);
        if (!DRY_RUN) {
          try {
            for (const gid of m.garaIds) await saveSlug(sb, gid, slug);
            if (!m.garaIds.includes(m.calId)) await saveSlug(sb, m.calId, slug).catch(() => {});
            saved++;
          } catch(e) { process.stdout.write(`  ERRORE: ${e.message}\n`); }
        } else { saved++; }
        confirmed = true;
        fallbackFound++;
        break;
      }
      await sleep(300);
    }
    if (!confirmed) {
      process.stdout.write(`— non trovata\n`);
      if (m.pcsCandidates?.length) {
        process.stdout.write(`    Candidati PCS stessa data: ${m.pcsCandidates.map(p => `${p.name} (${p.slug})`).join(' | ')}\n`);
      }
    }
    await sleep(400);
  }

  await browser.close();

  // ─── Riepilogo ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log('=== RIEPILOGO ===');
  console.log(`Match automatici salvati: ${saved}`);
  console.log(`Match incerti da revisionare: ${uncertainMatches.length}`);
  console.log(`Fallback trovati: ${fallbackFound}`);
  console.log(`Non trovate: ${noMatch.length - fallbackFound}`);

  if (uncertainMatches.length) {
    console.log('\nMatch incerti — aggiungi manualmente se corretti:');
    for (const m of uncertainMatches) {
      console.log(`  ${m.calId}`);
      console.log(`    ICS: "${m.nome}" | PCS: "${m.pcsName}" | slug: ${m.slug}`);
    }
  }

  if (!DRY_RUN && saved > 0) {
    console.log(`\n${saved} slug salvati → esegui ora pcs-race-scraper.js per importare i risultati.`);
  } else if (DRY_RUN) {
    console.log('\n[DRY-RUN] Riesegui senza --dry-run per salvare.');
  }
})();
