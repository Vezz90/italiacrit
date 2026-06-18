'use strict';
/**
 * Import completo: foto + social per atleti e team
 * Fonti: ProCyclingStats (primaria) → First Cycling (fallback)
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "la-tua-service-role-key"
 *   node run-import.js [--athletes] [--teams] [--force]
 *
 *   --athletes  solo atleti  (default: entrambi)
 *   --teams     solo team    (default: entrambi)
 *   --force     reimporta anche chi ha già dati
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const args       = process.argv.slice(2);
const DO_ATH     = !args.includes('--teams');
const DO_TEAM    = !args.includes('--athletes');
const FORCE      = args.includes('--force');
const YEAR       = new Date().getFullYear();

const DATA_DIR   = path.join(__dirname, '..', 'data');
const RANK_DIR   = path.join(DATA_DIR, 'rankings');
const ATH_CATS   = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F'];

// ─── Helpers ───────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function pcsAthleteSlug(ath) {
  return `${normalizeStr(ath.nome)}-${normalizeStr(ath.cognome)}`;
}

function pcsTeamSlug(team) {
  // PCS usa "nome-team-anno" come URL, es. bardiani-csf-faizane-2026
  return `${normalizeStr(team.nome)}-${YEAR}`;
}

// Estrai tutti i link social da una pagina già caricata
async function extractSocialsFromPage(page) {
  return page.evaluate(() => {
    const result = {};
    for (const a of document.querySelectorAll('a[href]')) {
      const h = a.href || '';
      if (!result.instagram && /instagram\.com\/[^/?"]+/.test(h)) result.instagram = h;
      if (!result.twitter   && /(twitter\.com|x\.com)\/[^/?"]+/.test(h)) result.twitter = h;
      if (!result.strava    && /strava\.com\/[^?"]+/.test(h)) result.strava = h;
      if (!result.facebook  && /facebook\.com\/[^/?"]+/.test(h)) result.facebook = h;
      if (!result.youtube   && /youtube\.com\/[^?"]+/.test(h)) result.youtube = h;
    }
    // Cerca anche sito personale (link esterno non social)
    const ext = [...document.querySelectorAll('a[href^="http"]')]
      .map(a => a.href)
      .find(h =>
        !/(procyclingstats|firstcycling|instagram|twitter|x\.com|strava|facebook|youtube)\.com/i.test(h)
      );
    if (ext) result.website = ext;
    return result;
  }).catch(() => ({}));
}

// ─── PCS helpers ───────────────────────────────────────────────────────────

/**
 * Naviga una pagina PCS rider, estrae foto e social in un colpo solo.
 * Ritorna { notFound, photo: Buffer|null, socials: {} }
 */
async function fetchFromPcsRider(page, slug) {
  try {
    await page.goto(`https://www.procyclingstats.com/rider/${slug}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    return { notFound: false };
  }

  if (page.url().includes('pagenotfound') || page.url().includes('404'))
    return { notFound: true };

  // Scroll leggero per lazy-load
  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(800);

  // Foto dal DOM
  const imgSrc = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')]
      .find(i => i.src && i.src.includes('/images/riders/'));
    if (img) return img.src || img.dataset.src || null;
    const lazy = document.querySelector('[data-src*="/images/riders/"]');
    return lazy ? lazy.dataset.src : null;
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
    if (bytes && bytes.length >= 1000) {
      const buf = Buffer.from(bytes);
      if (buf[0] === 0xFF && buf[1] === 0xD8) photo = buf;
    }
  }

  const socials = await extractSocialsFromPage(page);
  return { notFound: false, photo, socials };
}

/**
 * Naviga una pagina PCS team, estrae logo e social.
 * Prova prima /team/SLUG-YEAR poi /team/SLUG/YEAR
 */
async function fetchFromPcsTeam(page, slug) {
  const urls = [
    `https://www.procyclingstats.com/team/${slug}`,
    `https://www.procyclingstats.com/team/${slug.replace(`-${YEAR}`, '')}/${YEAR}`,
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch { continue; }
    if (page.url().includes('pagenotfound') || page.url().includes('404')) continue;

    await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
    await sleep(800);

    // Logo/immagine team: cerca img con "kit" o "jersey" o /images/teams/
    const imgSrc = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('img')];
      const byPath = candidates.find(i => i.src && /\/(teams|kits)\//.test(i.src));
      if (byPath) return byPath.src;
      // Fallback: prima img significativa nella pagina
      const big = candidates.find(i => i.naturalWidth > 50 && i.src.startsWith('http'));
      return big ? big.src : null;
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
      if (bytes && bytes.length >= 500) photo = Buffer.from(bytes);
    }

    const socials = await extractSocialsFromPage(page);
    return { notFound: false, photo, socials };
  }
  return { notFound: true };
}

// ─── First Cycling helpers ─────────────────────────────────────────────────

async function searchFirstCycling(page, name, type = 'riders') {
  const url = `https://firstcycling.com/search.php?s=${encodeURIComponent(name)}&searchtype=${type}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { return null; }

  const href = await page.evaluate((t) => {
    const pat = t === 'riders' ? 'rider.php?r=' : 'team.php?l=';
    const a = document.querySelector(`a[href*="${pat}"]`);
    return a ? a.href : null;
  }, type).catch(() => null);
  return href || null;
}

async function fetchFromFirstCyclingPage(page, url, isTeam = false) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { return { notFound: false }; }
  if (page.url().includes('search') || page.url().includes('404'))
    return { notFound: true };

  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(600);

  // Foto: First Cycling usa img con URL contenente /photos/ o /img/riders/ o /img/teams/
  const imgSrc = await page.evaluate((team) => {
    const pattern = team ? /\/(teams|img\/team)\//.test : /\/riders\//.test;
    const all = [...document.querySelectorAll('img[src]')];
    const match = all.find(i => team
      ? /\/(teams|img\/team)\//.test(i.src)
      : /\/(riders|img\/rider)\//.test(i.src));
    if (match) return match.src;
    // Fallback: cerca img con classe "profile" o simile
    const prof = document.querySelector('img.img-responsive, img.profile, .rider-photo img');
    return prof ? prof.src : null;
  }, isTeam).catch(() => null);

  let photo = null;
  if (imgSrc && imgSrc.startsWith('http')) {
    const bytes = await page.evaluate(async url => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return null;
        return Array.from(new Uint8Array(await r.arrayBuffer()));
      } catch { return null; }
    }, imgSrc).catch(() => null);
    if (bytes && bytes.length >= 500) photo = Buffer.from(bytes);
  }

  const socials = await extractSocialsFromPage(page);
  return { notFound: false, photo, socials };
}

// ─── Supabase helpers ──────────────────────────────────────────────────────

async function uploadPhoto(sb, entityType, slug, buf, ext = 'jpeg') {
  const storagePath = `${entityType}s/pcs/${slug}.${ext}`;
  const { error } = await sb.storage.from('photos')
    .upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
  if (error) throw error;
  return `/photos/${storagePath}`;
}

async function upsertOverrides(sb, entityType, entityId, fields) {
  // fields = { photo_url, instagram_url, twitter_url, ... }
  const rows = Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([field, new_value]) => ({ entity_type: entityType, entity_id: entityId, field, new_value, edited_by: null }));
  if (!rows.length) return;
  const { error } = await sb.from('entity_overrides')
    .upsert(rows, { onConflict: 'entity_type,entity_id,field' });
  if (error) throw error;
}

// ─── Existing overrides query ──────────────────────────────────────────────

async function getExistingIds(sb, entityType, field) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id')
    .eq('entity_type', entityType)
    .eq('field', field)
    .not('new_value', 'is', null)
    .limit(5000);
  return new Set((data || []).map(r => r.entity_id));
}

// ─── PCS search fallback (rider) ───────────────────────────────────────────

async function searchPcsRider(page, ath) {
  const name = `${ath.nome} ${ath.cognome}`;
  try {
    await page.goto(
      `https://www.procyclingstats.com/search.php?search=${encodeURIComponent(name)}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
  } catch { return null; }

  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h && /\/rider\/[a-z0-9-]+/.test(h))
  ).catch(() => []);

  if (!hrefs.length) return null;

  const gn = normalizeStr(ath.nome);
  const sn = normalizeStr(ath.cognome);
  const scored = hrefs.map(h => {
    const m = h.match(/\/rider\/([a-z0-9-]+)/);
    if (!m) return null;
    const s = m[1];
    let score = 0;
    for (const p of gn.split('-')) if (s.includes(p)) score++;
    for (const p of sn.split('-')) if (s.includes(p)) score++;
    return { slug: s, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].slug : null;
}

// ─── Main ──────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('=== Import foto + social (PCS → First Cycling) ===\n');

  // Avvia Chrome
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: false }); }
  catch { browser = await chromium.launch({ headless: false }); }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'it-IT',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Sessione PCS
  console.log('Avvio sessione PCS…');
  try {
    await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2500);
  } catch(e) {
    console.log(`Avviso PCS: ${e.message}`);
    await sleep(2000);
  }

  // Sessione First Cycling (apri così i cookie sono già presenti)
  console.log('Avvio sessione First Cycling…');
  try {
    await page.goto('https://firstcycling.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);
  } catch(e) {
    console.log(`Avviso FC: ${e.message}`);
  }

  console.log('Pronto.\n');

  // ── ATLETI ────────────────────────────────────────────────────────────────
  if (DO_ATH) {
    console.log('── ATLETI ──────────────────────────────────────');

    // Leggi ranking
    const athMap = new Map();
    for (const cat of ATH_CATS) {
      const file = path.join(RANK_DIR, `${cat}.json`);
      if (!fs.existsSync(file)) continue;
      for (const a of JSON.parse(fs.readFileSync(file, 'utf8')))
        if (a.atleta_id && !athMap.has(a.atleta_id)) athMap.set(a.atleta_id, a);
    }
    const athletes = [...athMap.values()];

    // Chi ha già foto (non rielaborare a meno di --force)
    const withPhoto = FORCE ? new Set() : await getExistingIds(sb, 'atleta', 'photo_url');
    const toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));

    console.log(`${athletes.length} atleti — ${withPhoto.size} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const ath  = toProcess[i];
      let   slug = pcsAthleteSlug(ath);
      process.stdout.write(`(${i+1}/${toProcess.length}) ${ath.cognome} ${ath.nome} [${slug}] … `);

      // 1) PCS diretto
      let result = await fetchFromPcsRider(page, slug);

      // 2) PCS search fallback
      if (result.notFound) {
        process.stdout.write('pcs-search… ');
        const found = await searchPcsRider(page, ath);
        if (found && found !== slug) {
          slug   = found;
          result = await fetchFromPcsRider(page, slug);
        }
      }

      // 3) First Cycling fallback
      if (result.notFound || (!result.photo && !Object.keys(result.socials || {}).length)) {
        process.stdout.write('fc… ');
        const fcUrl = await searchFirstCycling(page, `${ath.nome} ${ath.cognome}`, 'riders');
        if (fcUrl) result = await fetchFromFirstCyclingPage(page, fcUrl, false);
      }

      if (result.notFound || (!result.photo && !Object.keys(result.socials || {}).length)) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      // Salva foto
      const fields = {};
      if (result.photo) {
        try {
          fields.photo_url = await uploadPhoto(sb, 'atleta', slug, result.photo);
        } catch(e) {
          process.stdout.write(`ERRORE foto: ${e.message}\n`);
          errors++;
          continue;
        }
      }

      // Salva social
      const s = result.socials || {};
      if (s.instagram) fields.instagram_url = s.instagram;
      if (s.twitter)   fields.twitter_url   = s.twitter;
      if (s.strava)    fields.strava_url     = s.strava;
      if (s.website)   fields.website_url    = s.website;

      try {
        await upsertOverrides(sb, 'atleta', ath.atleta_id, fields);
      } catch(e) {
        process.stdout.write(`ERRORE DB: ${e.message}\n`);
        errors++;
        continue;
      }

      const tags = [
        result.photo           ? '📷' : '',
        fields.instagram_url   ? 'IG' : '',
        fields.twitter_url     ? 'TW' : '',
        fields.strava_url      ? 'ST' : '',
        fields.website_url     ? '🌐' : '',
      ].filter(Boolean).join(' ');
      process.stdout.write(`✓ ${tags}\n`);
      done++;
      await sleep(150);
    }

    console.log(`\nAtleti — ✅ ${done}  ❓ ${noData}  ❌ ${errors}\n`);
  }

  // ── TEAM ──────────────────────────────────────────────────────────────────
  if (DO_TEAM) {
    console.log('── TEAM ────────────────────────────────────────');

    const teamsRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'teams.json'), 'utf8'));
    const teams = Object.values(teamsRaw).filter(t => t.id && t.nome);

    const withPhoto = FORCE ? new Set() : await getExistingIds(sb, 'team', 'photo_url');
    const toProcess = teams.filter(t => !withPhoto.has(t.id));

    console.log(`${teams.length} team — ${withPhoto.size} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const team = toProcess[i];
      const slug = pcsTeamSlug(team);
      process.stdout.write(`(${i+1}/${toProcess.length}) ${team.nome} [${slug}] … `);

      // 1) PCS
      let result = await fetchFromPcsTeam(page, slug);

      // 2) First Cycling fallback
      if (result.notFound || (!result.photo && !Object.keys(result.socials || {}).length)) {
        process.stdout.write('fc… ');
        const fcUrl = await searchFirstCycling(page, team.nome, 'teams');
        if (fcUrl) result = await fetchFromFirstCyclingPage(page, fcUrl, true);
      }

      if (result.notFound || (!result.photo && !Object.keys(result.socials || {}).length)) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      const fields = {};
      if (result.photo) {
        try {
          fields.photo_url = await uploadPhoto(sb, 'team', slug, result.photo);
        } catch(e) {
          process.stdout.write(`ERRORE foto: ${e.message}\n`);
          errors++;
          continue;
        }
      }

      const s = result.socials || {};
      if (s.instagram) fields.instagram_url = s.instagram;
      if (s.twitter)   fields.twitter_url   = s.twitter;
      if (s.facebook)  fields.facebook_url  = s.facebook;
      if (s.website)   fields.website_url   = s.website;

      try {
        await upsertOverrides(sb, 'team', team.id, fields);
      } catch(e) {
        process.stdout.write(`ERRORE DB: ${e.message}\n`);
        errors++;
        continue;
      }

      const tags = [
        result.photo          ? '📷' : '',
        fields.instagram_url  ? 'IG' : '',
        fields.twitter_url    ? 'TW' : '',
        fields.facebook_url   ? 'FB' : '',
        fields.website_url    ? '🌐' : '',
      ].filter(Boolean).join(' ');
      process.stdout.write(`✓ ${tags}\n`);
      done++;
      await sleep(150);
    }

    console.log(`\nTeam — ✅ ${done}  ❓ ${noData}  ❌ ${errors}\n`);
  }

  await browser.close();
  console.log('=== Completato ===');
})();
