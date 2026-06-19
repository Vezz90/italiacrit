'use strict';
/**
 * Import foto + social per atleti e team
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node run-import.js [--athletes] [--teams] [--force] [--pcs] [--fc]
 *
 *   --athletes   solo atleti  (default: entrambi)
 *   --teams      solo team    (default: entrambi)
 *   --pcs        usa solo ProCyclingStats  (default: PCS → FC fallback)
 *   --fc         usa solo First Cycling    (processa TUTTI anche se già con foto PCS,
 *                                           per raccogliere social e foto mancanti)
 *   --force      re-importa anche chi ha già tutti i dati
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const args    = process.argv.slice(2);
const DO_ATH  = !args.includes('--teams');
const DO_TEAM = !args.includes('--athletes');
const FORCE   = args.includes('--force');
const PCS_ONLY = args.includes('--pcs');
const FC_ONLY  = args.includes('--fc');
const YEAR    = new Date().getFullYear();

const DATA_DIR = path.join(__dirname, '..', 'data');
const RANK_DIR = path.join(DATA_DIR, 'rankings');
const ATH_CATS = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F'];

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
  return `${normalizeStr(team.nome)}-${YEAR}`;
}

// Estrai tutti i link social da una pagina già caricata
async function extractSocialsFromPage(page) {
  return page.evaluate(() => {
    const result = {};
    for (const a of document.querySelectorAll('a[href]')) {
      const h = (a.href || '').replace(/\/$/, '');
      if (!result.instagram && /instagram\.com\/(?!p\/|reel\/)[^/?"#]+/.test(h)) result.instagram = h;
      if (!result.twitter   && /(twitter\.com|x\.com)\/(?!i\/)[^/?"#]+/.test(h)) result.twitter = h;
      if (!result.strava    && /strava\.com\/(athletes|clubs)\/[^?"#]+/.test(h)) result.strava = h;
      if (!result.facebook  && /facebook\.com\/(?!sharer)[^/?"#]+/.test(h)) result.facebook = h;
      if (!result.youtube   && /youtube\.com\/(c\/|channel\/|@)[^?"#]+/.test(h)) result.youtube = h;
    }
    // Sito personale: link esterno non social e non del sito corrente
    const curHost = location.hostname;
    const ext = [...document.querySelectorAll('a[href^="http"]')]
      .map(a => a.href)
      .find(h => {
        try {
          const u = new URL(h);
          return u.hostname !== curHost &&
            !/(procyclingstats|firstcycling|instagram|twitter|x\.com|strava|facebook|youtube|google)/.test(u.hostname);
        } catch { return false; }
      });
    if (ext) result.website = ext;
    return result;
  }).catch(() => ({}));
}

// ─── PCS ──────────────────────────────────────────────────────────────────

async function fetchFromPcsRider(page, slug) {
  try {
    await page.goto(`https://www.procyclingstats.com/rider/${slug}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { return { notFound: false }; }

  if (page.url().includes('pagenotfound') || page.url().includes('404'))
    return { notFound: true };

  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(800);

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

async function fetchFromPcsTeam(page, slug) {
  const urls = [
    `https://www.procyclingstats.com/team/${slug}`,
    `https://www.procyclingstats.com/team/${slug.replace(`-${YEAR}`, '')}/${YEAR}`,
  ];
  for (const url of urls) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); }
    catch { continue; }
    if (page.url().includes('pagenotfound') || page.url().includes('404')) continue;

    await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
    await sleep(800);

    const imgSrc = await page.evaluate(() => {
      const byPath = [...document.querySelectorAll('img')]
        .find(i => i.src && /\/(teams|kits)\//.test(i.src));
      if (byPath) return byPath.src;
      const big = [...document.querySelectorAll('img')]
        .find(i => i.naturalWidth > 50 && i.src.startsWith('http'));
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

async function searchPcsRider(page, ath) {
  try {
    await page.goto(
      `https://www.procyclingstats.com/search.php?search=${encodeURIComponent(`${ath.nome} ${ath.cognome}`)}`,
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

// ─── First Cycling ─────────────────────────────────────────────────────────

async function searchFirstCycling(page, name, type = 'riders') {
  // Prova prima nome+cognome, poi cognome+nome
  const queries = [name, name.split(' ').reverse().join(' ')];
  for (const q of queries) {
    try {
      await page.goto(
        `https://firstcycling.com/search.php?s=${encodeURIComponent(q)}&searchtype=${type}`,
        { waitUntil: 'domcontentloaded', timeout: 15000 }
      );
    } catch { continue; }

    const pat = type === 'riders' ? 'rider.php?r=' : 'team.php?l=';
    const href = await page.evaluate(pat => {
      const a = document.querySelector(`a[href*="${pat}"]`);
      return a ? a.href : null;
    }, pat).catch(() => null);

    if (href) return href;
  }
  return null;
}

async function fetchFromFcRider(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 18000 });
  } catch { return { notFound: false }; }
  if (page.url().includes('search.php') || page.url().includes('404'))
    return { notFound: true };

  await page.evaluate(() => window.scrollTo(0, 300)).catch(() => {});
  await sleep(1000);

  const imgSrc = await page.evaluate(() => {
    // First Cycling rider photo è tipicamente nel box profilo in alto a sinistra
    // URL pattern: firstcycling.com/photos/riders/YEAR/ID.png oppure /photos/riders/ID.png
    const candidates = [...document.querySelectorAll('img[src]')];

    // 1. Cerca img con "photos/riders" nell'URL (foto profilo FC)
    const byRiders = candidates.find(i => /\/photos\/riders\//i.test(i.src));
    if (byRiders) return byRiders.src;

    // 2. Cerca img con "photos/cyclists" o "photos/athletes"
    const byAthletes = candidates.find(i => /\/photos\/(cyclists|athletes)\//i.test(i.src));
    if (byAthletes) return byAthletes.src;

    // 3. Prima img significativa nella sezione profilo (sinistra pagina)
    const profileSection = document.querySelector('.rider-profile, .profile-photo, .info-left, aside');
    if (profileSection) {
      const img = profileSection.querySelector('img[src]');
      if (img && img.naturalWidth >= 40) return img.src;
    }

    // 4. Fallback: prima img con larghezza >= 80px che non sia una bandiera/logo
    const big = candidates.find(i =>
      i.naturalWidth >= 80 && i.src.startsWith('http') &&
      !i.src.includes('flag') && !i.src.includes('logo') &&
      !i.src.includes('sponsor') && !i.src.includes('kit')
    );
    return big ? big.src : null;
  }).catch(() => null);

  let photo = null;
  if (imgSrc && imgSrc.startsWith('http')) {
    const bytes = await page.evaluate(async url => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return null;
        return Array.from(new Uint8Array(await r.arrayBuffer()));
      } catch { return null; }
    }, imgSrc).catch(() => null);
    if (bytes && bytes.length >= 500) {
      const buf = Buffer.from(bytes);
      // Accetta JPEG, PNG e WebP
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
      const isPng  = buf[0] === 0x89 && buf[1] === 0x50;
      const isWebp = buf.slice(8, 12).toString() === 'WEBP';
      if (isJpeg || isPng || isWebp) photo = buf;
    }
  }

  const socials = await extractSocialsFromPage(page);
  return { notFound: false, photo, socials };
}

async function fetchFromFcTeam(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 18000 });
  } catch { return { notFound: false }; }
  if (page.url().includes('search.php') || page.url().includes('404'))
    return { notFound: true };

  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(800);

  const imgSrc = await page.evaluate(() => {
    // Team logo FC: /photos/teams/YEAR/ID.png
    const candidates = [...document.querySelectorAll('img[src]')];
    const byTeams = candidates.find(i => /\/photos\/teams\//i.test(i.src));
    if (byTeams) return byTeams.src;
    // Fallback: logo nella sezione profilo team
    const sec = document.querySelector('.team-profile, .team-logo, aside');
    if (sec) {
      const img = sec.querySelector('img[src]');
      if (img) return img.src;
    }
    // Prima img non-flag
    const big = candidates.find(i =>
      i.src.startsWith('http') && i.naturalWidth >= 40 &&
      !i.src.includes('flag') && !i.src.includes('kit') && !i.src.includes('sponsor')
    );
    return big ? big.src : null;
  }).catch(() => null);

  let photo = null;
  if (imgSrc && imgSrc.startsWith('http')) {
    const bytes = await page.evaluate(async url => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return null;
        return Array.from(new Uint8Array(await r.arrayBuffer()));
      } catch { return null; }
    }, imgSrc).catch(() => null);
    if (bytes && bytes.length >= 200) photo = Buffer.from(bytes);
  }

  const socials = await extractSocialsFromPage(page);
  return { notFound: false, photo, socials };
}

// ─── Supabase ──────────────────────────────────────────────────────────────

async function uploadPhoto(sb, entityType, slug, buf, source = 'pcs') {
  const ext = (() => {
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    return 'jpeg';
  })();
  const storagePath = `${entityType}s/${source}/${slug}.${ext}`;
  const { error } = await sb.storage.from('photos')
    .upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
  if (error) throw error;
  return `/photos/${storagePath}`;
}

async function upsertOverrides(sb, entityType, entityId, fields) {
  const rows = Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([field, new_value]) => ({ entity_type: entityType, entity_id: entityId, field, new_value, edited_by: null }));
  if (!rows.length) return;
  const { error } = await sb.from('entity_overrides')
    .upsert(rows, { onConflict: 'entity_type,entity_id,field' });
  if (error) throw error;
}

async function getExistingIds(sb, entityType, field) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id')
    .eq('entity_type', entityType)
    .eq('field', field)
    .not('new_value', 'is', null)
    .limit(5000);
  return new Set((data || []).map(r => r.entity_id));
}

// ─── Main ──────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  const source = FC_ONLY ? 'fc' : 'pcs';

  console.log(`=== Import foto + social [${FC_ONLY ? 'First Cycling' : PCS_ONLY ? 'PCS only' : 'PCS → FC'}] ===\n`);

  // Cerca Brave, poi Chrome, poi Chromium bundled
  const bravePaths = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Users\\vezza\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env.LOCALAPPDATA || '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  const bravePath = bravePaths.find(p => { const ok = fs.existsSync(p); console.log(`Brave check: ${p} → ${ok}`); return ok; });

  let browser;
  if (bravePath) {
    console.log(`>>> Lancio Brave: ${bravePath}`);
    try {
      browser = await chromium.launch({
        executablePath: bravePath,
        headless: false,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      });
      console.log('>>> Brave avviato OK');
    } catch(e) {
      console.log(`>>> Brave fallito (${e.message}), provo Chrome`);
    }
  } else {
    console.log('>>> Brave non trovato nei path noti, uso Chrome');
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

  // Sessioni iniziali (passaggio Cloudflare)
  if (!FC_ONLY) {
    console.log('Avvio sessione PCS…');
    try {
      await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(2500);
    } catch(e) { console.log(`Avviso PCS: ${e.message}`); await sleep(2000); }
  }
  if (!PCS_ONLY) {
    console.log('Avvio sessione First Cycling…');
    try {
      await page.goto('https://firstcycling.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2000);
    } catch(e) { console.log(`Avviso FC: ${e.message}`); }
  }
  console.log('Pronto.\n');

  // ── ATLETI ────────────────────────────────────────────────────────────────
  if (DO_ATH) {
    console.log('── ATLETI ──────────────────────────────────────');

    const athMap = new Map();
    for (const cat of ATH_CATS) {
      const file = path.join(RANK_DIR, `${cat}.json`);
      if (!fs.existsSync(file)) continue;
      for (const a of JSON.parse(fs.readFileSync(file, 'utf8')))
        if (a.atleta_id && !athMap.has(a.atleta_id)) athMap.set(a.atleta_id, a);
    }
    const athletes = [...athMap.values()];

    // In modalità FC: processa TUTTI (anche chi ha già la foto PCS) per aggiungere social
    // In modalità PCS: salta chi ha già la foto
    const withPhoto = (FORCE || FC_ONLY) ? new Set() : await getExistingIds(sb, 'atleta', 'photo_url');
    const toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));

    console.log(`${athletes.length} atleti — ${athletes.length - toProcess.length} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const ath  = toProcess[i];
      let   slug = pcsAthleteSlug(ath);
      process.stdout.write(`(${i+1}/${toProcess.length}) ${ath.cognome} ${ath.nome} … `);

      let result = { notFound: false };

      if (!FC_ONLY) {
        // PCS diretto
        result = await fetchFromPcsRider(page, slug);
        // PCS search fallback
        if (result.notFound) {
          process.stdout.write('pcs-search… ');
          const found = await searchPcsRider(page, ath);
          if (found && found !== slug) {
            slug = found;
            result = await fetchFromPcsRider(page, slug);
          }
        }
      }

      // First Cycling (sempre in FC_ONLY, altrimenti come fallback)
      const needFc = FC_ONLY || result.notFound || (!result.photo && !Object.keys(result.socials || {}).length);
      if (needFc && !PCS_ONLY) {
        process.stdout.write('fc… ');
        const fcUrl = await searchFirstCycling(page, `${ath.nome} ${ath.cognome}`, 'riders');
        if (fcUrl) {
          const fcRes = await fetchFromFcRider(page, fcUrl);
          // Se PCS non ha trovato niente, usa FC; se PCS ha trovato foto ma non social, integra
          if (!result.photo && fcRes.photo) result.photo = fcRes.photo;
          result.socials = { ...(fcRes.socials || {}), ...(result.socials || {}) };
          if (!result.photo && !fcRes.photo) result.notFound = fcRes.notFound;
        }
      }

      const hasSomething = result.photo || Object.keys(result.socials || {}).length > 0;
      if (!hasSomething) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      const fields = {};

      // Foto: salva solo se l'atleta non ha ancora una photo_url
      if (result.photo) {
        const alreadyHasPhoto = withPhoto.size === 0
          ? false
          : (await getExistingIds(sb, 'atleta', 'photo_url')).has(ath.atleta_id);

        if (!alreadyHasPhoto || FORCE) {
          try {
            fields.photo_url = await uploadPhoto(sb, 'atleta', slug, result.photo, source);
          } catch(e) {
            process.stdout.write(`ERRORE foto: ${e.message} `);
          }
        }
      }

      // Social: salva sempre quelli trovati
      const s = result.socials || {};
      if (s.instagram) fields.instagram_url = s.instagram;
      if (s.twitter)   fields.twitter_url   = s.twitter;
      if (s.strava)    fields.strava_url     = s.strava;
      if (s.facebook)  fields.facebook_url   = s.facebook;
      if (s.website)   fields.website_url    = s.website;

      if (!Object.keys(fields).length) {
        process.stdout.write('nessun dato nuovo\n');
        noData++;
        continue;
      }

      try {
        await upsertOverrides(sb, 'atleta', ath.atleta_id, fields);
      } catch(e) {
        process.stdout.write(`ERRORE DB: ${e.message}\n`);
        errors++;
        continue;
      }

      const tags = [
        fields.photo_url     ? '📷' : '',
        fields.instagram_url ? 'IG' : '',
        fields.twitter_url   ? 'TW' : '',
        fields.strava_url    ? 'ST' : '',
        fields.facebook_url  ? 'FB' : '',
        fields.website_url   ? '🌐' : '',
      ].filter(Boolean).join(' ');
      process.stdout.write(`✓ ${tags}\n`);
      done++;
      await sleep(200);
    }

    console.log(`\nAtleti — ✅ ${done}  ❓ ${noData}  ❌ ${errors}\n`);
  }

  // ── TEAM ──────────────────────────────────────────────────────────────────
  if (DO_TEAM) {
    console.log('── TEAM ────────────────────────────────────────');

    const teamsRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'teams.json'), 'utf8'));
    const teams = Object.values(teamsRaw).filter(t => t.id && t.nome);

    const withPhoto = (FORCE || FC_ONLY) ? new Set() : await getExistingIds(sb, 'team', 'photo_url');
    const toProcess = teams.filter(t => !withPhoto.has(t.id));

    console.log(`${teams.length} team — ${teams.length - toProcess.length} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const team = toProcess[i];
      const slug = pcsTeamSlug(team);
      process.stdout.write(`(${i+1}/${toProcess.length}) ${team.nome} … `);

      let result = { notFound: false };

      if (!FC_ONLY) {
        result = await fetchFromPcsTeam(page, slug);
      }

      const needFc = FC_ONLY || result.notFound || (!result.photo && !Object.keys(result.socials || {}).length);
      if (needFc && !PCS_ONLY) {
        process.stdout.write('fc… ');
        const fcUrl = await searchFirstCycling(page, team.nome, 'teams');
        if (fcUrl) {
          const fcRes = await fetchFromFcTeam(page, fcUrl);
          if (!result.photo && fcRes.photo) result.photo = fcRes.photo;
          result.socials = { ...(fcRes.socials || {}), ...(result.socials || {}) };
        }
      }

      const hasSomething = result.photo || Object.keys(result.socials || {}).length > 0;
      if (!hasSomething) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      const fields = {};
      if (result.photo) {
        try {
          fields.photo_url = await uploadPhoto(sb, 'team', slug, result.photo, source);
        } catch(e) {
          process.stdout.write(`ERRORE foto: ${e.message} `);
        }
      }

      const s = result.socials || {};
      if (s.instagram) fields.instagram_url = s.instagram;
      if (s.twitter)   fields.twitter_url   = s.twitter;
      if (s.facebook)  fields.facebook_url  = s.facebook;
      if (s.website)   fields.website_url   = s.website;

      if (!Object.keys(fields).length) {
        process.stdout.write('nessun dato nuovo\n');
        noData++;
        continue;
      }

      try {
        await upsertOverrides(sb, 'team', team.id, fields);
      } catch(e) {
        process.stdout.write(`ERRORE DB: ${e.message}\n`);
        errors++;
        continue;
      }

      const tags = [
        fields.photo_url     ? '📷' : '',
        fields.instagram_url ? 'IG' : '',
        fields.twitter_url   ? 'TW' : '',
        fields.facebook_url  ? 'FB' : '',
        fields.website_url   ? '🌐' : '',
      ].filter(Boolean).join(' ');
      process.stdout.write(`✓ ${tags}\n`);
      done++;
      await sleep(200);
    }

    console.log(`\nTeam — ✅ ${done}  ❓ ${noData}  ❌ ${errors}\n`);
  }

  await browser.close();
  console.log('=== Completato ===');
})();
