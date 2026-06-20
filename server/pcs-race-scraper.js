'use strict';
/**
 * Scraper PCS — pagine gara completo
 *
 * Per ogni gara del calendario con "Slug PCS" configurato (admin ✏ Modifica → Slug PCS):
 *  1. Scarica la pagina risultati PCS → tutti i finisher con posizione, nome, team, distacco
 *  2. Mappa i corridori già nel sistema (per nome normalizzato)
 *  3. Per i corridori NON nel sistema (slug estratto dal link PCS):
 *       a. visita il loro profilo PCS → foto + anno nascita
 *       b. crea un profilo in extra_roster.json + salva foto in Supabase
 *       c. scraper tutti i loro risultati stagionali → salva in pcs_results
 *          (con gara_id dove matchano il calendario, senza dove no → "altri risultati")
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

function makeAtletaId(cognome, nome) {
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${norm(cognome)}_${norm(nome)}`;
}

// Categoria dalla gara_id (es. ..._ELI_M → ELI_M) + eventuale anno nascita
function inferCategoriaFromGara(garaId, birthYear, overrideGender) {
  const m = garaId?.match(/_(ELI|JUN|AL|ES[12])_([MF])$/);
  if (m) {
    const cat = m[1] === 'ES1' || m[1] === 'ES2' ? 'ES' : m[1];
    return `${cat}_${m[2]}`;
  }
  // Fallback da anno nascita
  const suffix = overrideGender === 'F' ? '_F' : '_M';
  if (!birthYear) return `ELI${suffix}`;
  const age = SEASON - birthYear;
  if (age <= 18) return `JUN${suffix}`;
  return `ELI${suffix}`;
}

// ─── Calendario ────────────────────────────────────────────────────────────────

function buildCalendarMap() {
  const map = new Map();
  for (const f of CAL_FILES) {
    if (!fs.existsSync(f)) continue;
    for (const e of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (!e.data || !e.id) continue;
      if (!map.has(e.data)) map.set(e.data, []);
      map.get(e.data).push({ id: e.id, nome: e.nome || '', categoria: e.categoria || '' });
    }
  }
  return map;
}

function matchGaraId(calMap, dateStr, pcsCat, pcsName) {
  const entries = calMap.get(dateStr);
  if (!entries?.length) return null;
  if (entries.length === 1) return entries[0].id;
  const catStr = (pcsCat || '').toLowerCase();
  const nameStr = normalizeStr(pcsName || '');
  let priority = null;
  if (/jun|u19/.test(catStr))                          priority = 'JUN';
  else if (/ali|u17|cadets/.test(catStr))              priority = 'AL';
  else if (/u23|elite|1\.[12]|2\.pro|wt/.test(catStr)) priority = 'ELI';
  if (priority) { const m = entries.find(e => e.id.includes(priority)); if (m) return m.id; }
  if (nameStr.length > 4) {
    const words = nameStr.split(' ').filter(w => w.length > 4);
    const byName = entries.find(e => words.some(w => normalizeStr(e.nome).includes(w)));
    if (byName) return byName.id;
  }
  return entries[0].id;
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

async function getGaraSlugs(sb) {
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

async function upsertGaraResults(sb, rows) {
  if (!rows.length) return;
  const { error } = await sb.from('pcs_gara_results')
    .upsert(rows, { onConflict: 'gara_id,posizione' });
  if (error) throw error;
}

async function upsertAtletaResults(sb, rows) {
  if (!rows.length) return;
  const { error } = await sb.from('pcs_results')
    .upsert(rows, { onConflict: 'atleta_id,season,pcs_race_slug' });
  if (error) throw error;
}

async function upsertOverrides(sb, atletaId, fields) {
  const rows = Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([field, new_value]) => ({
      entity_type: 'atleta', entity_id: atletaId, field, new_value, edited_by: null
    }));
  if (!rows.length) return;
  const { error } = await sb.from('entity_overrides')
    .upsert(rows, { onConflict: 'entity_type,entity_id,field' });
  if (error) throw error;
}

async function uploadPhoto(sb, slug, buf) {
  const ext = (buf[0] === 0x89 && buf[1] === 0x50) ? 'png' : 'jpeg';
  const storagePath = `atletas/pcs/${slug}.${ext}`;
  const { error } = await sb.storage.from('photos')
    .upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
  if (error) throw error;
  return `/photos/${storagePath}`;
}

// ─── PCS scraping ──────────────────────────────────────────────────────────────

async function scrapeRaceResults(page, pcsSlug) {
  const urls = [
    `https://www.procyclingstats.com/race/${pcsSlug}/result`,
    `https://www.procyclingstats.com/race/${pcsSlug}`,
  ];
  for (const url of urls) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch { continue; }
    if (page.url().includes('pagenotfound') || page.url().includes('404')) continue;
    await sleep(1200);

    const results = await page.evaluate(() => {
      const rows = [];
      for (const table of document.querySelectorAll('table')) {
        const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
        const hasRnk   = headers.some(h => /rnk|pos|#/.test(h));
        const hasRider = headers.some(h => /rider|name|cyclist/.test(h));
        if (!hasRnk && !hasRider) continue;

        let iPos = -1, iRider = -1, iTeam = -1, iTime = -1;
        headers.forEach((h, i) => {
          if (iPos   < 0 && /rnk|pos|#/.test(h))                 iPos   = i;
          if (iRider < 0 && /rider|name|cyclist/.test(h))        iRider = i;
          if (iTeam  < 0 && /team/.test(h))                       iTeam  = i;
          if (iTime  < 0 && /time|gap|\//.test(h))               iTime  = i;
        });
        if (iPos < 0 || iRider < 0) {
          const trs = table.querySelectorAll('tbody tr');
          if (!trs.length) continue;
          const cells = [...trs[0].querySelectorAll('td')];
          if (cells.length < 3) continue;
          if (/^\d+$/.test(cells[0]?.textContent?.trim())) {
            iPos = 0; iRider = 1; iTeam = 2; iTime = 3;
          } else continue;
        }

        for (const tr of table.querySelectorAll('tbody tr')) {
          const cells = [...tr.querySelectorAll('td')];
          if (cells.length < 2) continue;
          const pos = parseInt(cells[iPos]?.textContent?.trim());
          if (!pos || pos < 1 || pos > 500) continue;
          const riderCell = cells[iRider];
          const riderName = riderCell?.textContent?.trim() || '';
          if (!riderName || riderName.length < 2) continue;

          // Slug corridore dal link nella cella
          const riderLink = riderCell?.querySelector('a');
          let pcs_rider_slug = null;
          if (riderLink) {
            const m = (riderLink.getAttribute('href') || '').match(/\/rider\/([a-z0-9-]+)/);
            if (m) pcs_rider_slug = m[1];
          }

          const teamName = iTeam >= 0 ? (cells[iTeam]?.textContent?.trim() || '') : '';
          let gap = iTime >= 0 ? (cells[iTime]?.textContent?.trim() || '') : '';
          if (pos === 1) gap = null;
          else if (gap && gap !== '-' && !gap.startsWith('+')) gap = '+' + gap;
          else if (!gap || gap === '-') gap = null;

          rows.push({ posizione: pos, rider_name: riderName, team_name: teamName, distacco: gap || null, pcs_rider_slug });
        }
        if (rows.length) break;
      }
      return rows;
    }).catch(() => []);

    if (results.length) return { results, notFound: false };
  }
  return { results: [], notFound: true };
}

async function scrapeRiderProfile(page, slug) {
  try { await page.goto(`https://www.procyclingstats.com/rider/${slug}`, { waitUntil: 'domcontentloaded', timeout: 15000 }); }
  catch { return { notFound: true }; }
  if (page.url().includes('pagenotfound') || page.url().includes('404')) return { notFound: true };
  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(800);

  const info = await page.evaluate(() => {
    const h1Text = document.querySelector('h1')?.textContent?.trim() || null;
    const bodyText = document.body?.innerText || '';
    const bornMatch = bodyText.match(/\b(19|20)\d{2}\b/);
    const birthYear = bornMatch ? parseInt(bornMatch[0]) : null;
    const isFemale  = location.pathname.includes('women');
    return { fullName: h1Text, birthYear, isFemale };
  }).catch(() => ({}));

  const imgSrc = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find(i => i.src?.includes('/images/riders/'));
    return img ? (img.src || img.dataset?.src || null) : document.querySelector('[data-src*="/images/riders/"]')?.dataset?.src || null;
  }).catch(() => null);

  let photo = null;
  if (imgSrc) {
    const bytes = await page.evaluate(async url => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return null;
        return Array.from(new Uint8Array(await r.arrayBuffer()));
      } catch { return null; }
    }, imgSrc).catch(() => null);
    if (bytes?.length >= 1000) {
      const buf = Buffer.from(bytes);
      if (buf[0] === 0xFF && buf[1] === 0xD8) photo = buf;
    }
  }
  return { ...info, photo, notFound: false };
}

async function scrapeRiderSeasonResults(page, slug) {
  const url = `https://www.procyclingstats.com/rider/${slug}/${SEASON}`;
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
  catch(e) { return []; }
  if (page.url().includes('pagenotfound') || page.url().includes('404')) return [];
  await sleep(800);

  return page.evaluate((season) => {
    const rows = [];
    for (const table of document.querySelectorAll('table')) {
      const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
      const hasResult = headers.some(h => /result|ris\.|pos|place/.test(h));
      if (!hasResult) continue;

      let iDate = -1, iRace = -1, iCat = -1, iResult = -1, iTime = -1;
      headers.forEach((h, i) => {
        if (iDate   < 0 && /date|data/.test(h))                  iDate   = i;
        if (iRace   < 0 && /race|gara|corsa/.test(h))            iRace   = i;
        if (iCat    < 0 && /cat|class/.test(h))                  iCat    = i;
        if (iResult < 0 && /result|ris\.|pos|place/.test(h))     iResult = i;
        if (iTime   < 0 && /time|gap|distacco/.test(h))          iTime   = i;
      });
      if (iDate < 0 || iRace < 0 || iResult < 0) {
        const trs = table.querySelectorAll('tbody tr');
        if (!trs.length) continue;
        const first = [...trs[0].querySelectorAll('td')];
        if (first.length < 3) continue;
        if (/^\d{1,2}\.\d{2}$/.test(first[0]?.textContent?.trim())) {
          iDate = 0; iRace = 1;
          iResult = first.length >= 5 ? 3 : 2;
          iTime   = first.length >= 6 ? 4 : -1;
          iCat    = first.length >= 4 ? 2 : -1;
        } else continue;
      }

      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll('td')];
        if (cells.length < 3) continue;
        const dateRaw = cells[iDate]?.textContent?.trim() || '';
        const dm = dateRaw.match(/^(\d{1,2})\.(\d{2})$/);
        if (!dm) continue;
        const data = `${season}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
        const raceCell   = cells[iRace];
        const gara_name  = raceCell?.textContent?.trim() || '';
        const raceLink   = raceCell?.querySelector('a');
        let pcs_race_slug = null;
        if (raceLink) {
          const m = (raceLink.getAttribute('href') || '').match(/\/race\/([^/]+)/);
          if (m) pcs_race_slug = m[1];
        }
        if (!gara_name || !pcs_race_slug) continue;
        const posStr   = (cells[iResult]?.textContent?.trim() || '').replace(/[^0-9]/g, '');
        const posizione = posStr ? parseInt(posStr) : null;
        if (!posizione || posizione < 1 || posizione > 999) continue;
        let distacco = null;
        const timeRaw = iTime >= 0 ? (cells[iTime]?.textContent?.trim() || '') : '';
        if (posizione > 1 && timeRaw && timeRaw !== '-') {
          distacco = timeRaw.startsWith('+') ? timeRaw : '+' + timeRaw;
        }
        const catRaw = iCat >= 0 ? (cells[iCat]?.textContent?.trim() || '') : '';
        rows.push({ data, gara_name, pcs_race_slug, posizione, distacco, cat: catRaw });
      }
      if (rows.length) break;
    }
    return rows;
  }, SEASON).catch(() => []);
}

// Cerca team nel sistema per nome (match parziale normalizzato)
function findTeamId(teamsMap, teamNamePcs) {
  if (!teamNamePcs) return null;
  const norm = normalizeStr(teamNamePcs);
  for (const [tid, t] of Object.entries(teamsMap)) {
    if (normalizeStr(t.nome || '').includes(norm) || norm.includes(normalizeStr(t.nome || ''))) return tid;
  }
  // Prova parole chiave (minimo 5 caratteri)
  const words = norm.split(' ').filter(w => w.length >= 5);
  for (const [tid, t] of Object.entries(teamsMap)) {
    const tn = normalizeStr(t.nome || '');
    if (words.some(w => tn.includes(w))) return tid;
  }
  return null;
}

// PCS: "COGNOME Nome" → { nome, cognome }
function splitPcsName(fullName) {
  if (!fullName) return { nome: '', cognome: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { nome: parts[0], cognome: '' };
  const upper = parts.filter(p => p === p.toUpperCase() && /[A-Z]{2,}/.test(p));
  if (upper.length) {
    const cognome = upper.join(' ');
    const nome    = parts.filter(p => !upper.includes(p)).join(' ') || parts[0];
    return { nome, cognome };
  }
  return { nome: parts.slice(0, -1).join(' '), cognome: parts[parts.length - 1] };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  console.log(`=== PCS Race Scraper [stagione ${SEASON}] ===\n`);

  // Slug PCS configurati per le gare del circuito
  const garaSlugMap = await getGaraSlugs(sb);
  if (!garaSlugMap.size) {
    console.log('Nessuna gara ha uno slug PCS configurato.');
    console.log('→ Apri una pagina gara su ICS → ✏ Modifica → Slug PCS');
    console.log('  Es: giro-ciclistico-d-italia/2026/stage-6\n');
    process.exit(0);
  }

  // Calendario per matching gara_id
  const calMap = buildCalendarMap();

  // Atleti già nel sistema (per matching per nome)
  const athletesFile = path.join(DATA_DIR, 'athletes.json');
  const athletesByNorm = new Map();
  const athletesObj = fs.existsSync(athletesFile)
    ? JSON.parse(fs.readFileSync(athletesFile, 'utf8'))
    : {};
  for (const [id, a] of Object.entries(athletesObj)) {
    athletesByNorm.set(normalizeStr((a.cognome||'') + ' ' + (a.nome||'')), id);
    athletesByNorm.set(normalizeStr((a.nome||'') + ' ' + (a.cognome||'')), id);
  }

  // Teams nel sistema (per matching team PCS)
  const teamsObj = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'teams.json'), 'utf8'));

  // extra_roster.json (per aggiungere nuovi atleti)
  const rosterFile = path.join(DATA_DIR, 'extra_roster.json');
  const extraRoster = fs.existsSync(rosterFile)
    ? JSON.parse(fs.readFileSync(rosterFile, 'utf8'))
    : {};
  const existingRosterIds = new Set();
  for (const entry of Object.values(extraRoster)) {
    for (const a of (entry.atleti || [])) if (a.atleta_id) existingRosterIds.add(a.atleta_id);
  }

  // Atleti già presenti in extra_roster per nome
  const rosterByNorm = new Map();
  for (const entry of Object.values(extraRoster)) {
    for (const a of (entry.atleti || [])) {
      if (a.atleta_id) {
        rosterByNorm.set(normalizeStr((a.cognome||'') + ' ' + (a.nome||'')), a.atleta_id);
        rosterByNorm.set(normalizeStr((a.nome||'') + ' ' + (a.cognome||'')), a.atleta_id);
      }
    }
  }

  // ID già scraped per stagione (per non riprocessare)
  const alreadyScrapedAtleti = new Set(); // atleta_id già processati in questa run

  let garaIds = [...garaSlugMap.keys()];
  if (SINGLE_ID) garaIds = garaIds.filter(id => id === SINGLE_ID);
  console.log(`${garaIds.length} gare con slug PCS — ${calMap.size} date in calendario\n`);

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
  await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 })
    .catch(e => console.log(`Avviso: ${e.message}`));
  await sleep(2500);
  console.log('Pronto.\n');

  let doneGare = 0, errGare = 0, newAtleti = 0, newPhotos = 0;

  for (let gi = 0; gi < garaIds.length; gi++) {
    const garaId  = garaIds[gi];
    const pcsSlug = garaSlugMap.get(garaId);
    console.log(`\n[${gi+1}/${garaIds.length}] ${garaId}`);
    console.log(`  PCS: ${pcsSlug}`);

    if (!FORCE && await getAlreadyScraped(sb, garaId)) {
      console.log('  → già fatto');
      doneGare++;
      continue;
    }

    const { results, notFound } = await scrapeRaceResults(page, pcsSlug);
    if (notFound || !results.length) {
      console.log('  → nessun risultato trovato su PCS');
      errGare++;
      continue;
    }
    console.log(`  → ${results.length} finisher estratti`);

    // Per ogni corridore: matcha o crea profilo
    const garaRows = [];

    for (const r of results) {
      const norm = normalizeStr(r.rider_name);

      // 1. Cerca nei nostri atleti
      let atletaId = athletesByNorm.get(norm) || rosterByNorm.get(norm) || null;

      // 2. Nuovo atleta — crea profilo
      if (!atletaId && r.pcs_rider_slug) {
        process.stdout.write(`  [${r.posizione}] ${r.rider_name} → NUOVO … `);

        // Visita profilo PCS
        const profile = await scrapeRiderProfile(page, r.pcs_rider_slug);

        if (profile.notFound) {
          process.stdout.write('profilo non trovato\n');
        } else {
          const { nome: parsedNome, cognome: parsedCognome } = splitPcsName(profile.fullName || r.rider_name);
          atletaId = makeAtletaId(parsedCognome || r.pcs_rider_slug, parsedNome);

          if (!existingRosterIds.has(atletaId)) {
            // Team matching
            const teamId = findTeamId(teamsObj, r.team_name);
            const categoria = inferCategoriaFromGara(garaId, profile.birthYear, profile.isFemale ? 'F' : 'M');
            const genere    = profile.isFemale ? 'F' : 'M';

            // Aggiungi a extra_roster
            const rKey = teamId || '_pcs_import';
            if (!extraRoster[rKey]) {
              extraRoster[rKey] = { nome: r.team_name || rKey, atleti: [] };
            }
            extraRoster[rKey].atleti.push({
              atleta_id: atletaId, nome: parsedNome, cognome: parsedCognome,
              categoria, genere, pcs_slug: r.pcs_rider_slug,
            });
            existingRosterIds.add(atletaId);
            rosterByNorm.set(norm, atletaId);
            athletesByNorm.set(norm, atletaId);
            newAtleti++;
          }

          // Salva foto + slug
          const overrideFields = { pcs_slug: r.pcs_rider_slug };
          if (profile.photo) {
            try {
              overrideFields.photo_url = await uploadPhoto(sb, r.pcs_rider_slug, profile.photo);
              newPhotos++;
            } catch(e) { process.stdout.write(`[foto err: ${e.message}] `); }
          }
          await upsertOverrides(sb, atletaId, overrideFields).catch(() => {});

          // Scraper risultati stagionali (solo se non già fatto in questa run)
          if (!alreadyScrapedAtleti.has(atletaId)) {
            alreadyScrapedAtleti.add(atletaId);
            const seasonResults = await scrapeRiderSeasonResults(page, r.pcs_rider_slug);
            if (seasonResults.length) {
              const sRows = seasonResults.map(sr => ({
                atleta_id: atletaId, pcs_slug: r.pcs_rider_slug, season: SEASON,
                gara_name: sr.gara_name, data: sr.data, posizione: sr.posizione,
                distacco: sr.distacco, pcs_race_slug: sr.pcs_race_slug,
                gara_id: matchGaraId(calMap, sr.data, sr.cat, sr.gara_name),
              }));
              await upsertAtletaResults(sb, sRows).catch(e => process.stdout.write(`[res err: ${e.message}] `));
              process.stdout.write(`✓ profilo+${seasonResults.length}ris\n`);
            } else {
              process.stdout.write(`✓ profilo\n`);
            }
          } else {
            process.stdout.write(`✓ (risultati già scraped)\n`);
          }
        }
      }

      garaRows.push({
        gara_id:       garaId,
        season:        SEASON,
        posizione:     r.posizione,
        rider_name:    r.rider_name,
        atleta_id:     atletaId || null,
        team_name:     r.team_name,
        distacco:      r.distacco,
        pcs_race_slug: pcsSlug,
      });

      await sleep(100);
    }

    // Salva risultati gara
    try {
      await upsertGaraResults(sb, garaRows);
      const linked   = garaRows.filter(r => r.atleta_id).length;
      const unlinked = garaRows.length - linked;
      console.log(`  ✓ ${garaRows.length} salvati (${linked} con profilo, ${unlinked} solo nome)`);
      doneGare++;
    } catch(e) {
      console.log(`  ERRORE DB: ${e.message}`);
      errGare++;
    }

    await sleep(500);
  }

  // Salva extra_roster.json aggiornato
  fs.writeFileSync(rosterFile, JSON.stringify(extraRoster, null, 2), 'utf8');

  await browser.close();
  console.log(`\n=== Completato ===`);
  console.log(`Gare: ✅ ${doneGare}  ❌ ${errGare}`);
  console.log(`Nuovi atleti: ${newAtleti}  Foto importate: ${newPhotos}`);
  console.log(`\nextra_roster.json aggiornato — i nuovi atleti compariranno nel sito dopo il prossimo deploy.`);
})();
