'use strict';
/**
 * Import foto + social per atleti e team (solo ProCyclingStats)
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node run-import.js [--athletes] [--teams] [--social] [--force]
 *
 *   --athletes   solo atleti  (default: entrambi)
 *   --teams      solo team    (default: entrambi)
 *   --social     solo social (no foto) — aggiorna TUTTI anche chi ha già la foto
 *   --force      re-importa anche chi ha già tutti i dati
 *
 * Salta chi ha già una foto (a meno di --social o --force).
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

const args        = process.argv.slice(2);
const DO_ATH      = !args.includes('--teams');
const DO_TEAM     = !args.includes('--athletes');
const FORCE       = args.includes('--force');
const SOCIAL_ONLY = args.includes('--social');
const SINGLE_ID   = (args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;
const SINGLE_NOME = (args.find(a => a.startsWith('--nome=')) || '').split('=')[1] || null;
const SINGLE_COG  = (args.find(a => a.startsWith('--cognome=')) || '').split('=')[1] || null;
const YEAR        = new Date().getFullYear();

const DATA_DIR = path.join(__dirname, '..', 'data');
const RANK_DIR = path.join(DATA_DIR, 'rankings');
const ATH_CATS = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F', 'AL_M', 'AL_F'];

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
    const curHost = location.hostname;
    const BLOCKLIST = /(procyclingstats|firstcycling|instagram|twitter|x\.com|strava|facebook|youtube|google|cloudflare|cdn-cgi|challenges\.|doubleclick|analytics|googletag|adservice|scorecard|omtrdc|bing\.com|amazon|aliexpress|paypal|awin|affiliat|tracking|redirect|banner|sponsor|kit\.fontawesome|jquery|bootstrapcdn|unpkg\.com|cdnjs)/i;
    const candidates = [...document.querySelectorAll('a[href^="http"]')];
    const ext = candidates.find(a => {
      try {
        const u = new URL(a.href);
        if (u.hostname === curHost) return false;
        if (BLOCKLIST.test(u.hostname) || BLOCKLIST.test(a.href)) return false;
        if (!/\.[a-z]{2,}$/i.test(u.hostname)) return false;
        const txt = (a.textContent || '').trim().toLowerCase();
        const href = a.href.toLowerCase();
        const looksLikeSite = txt.includes('www') || href.includes('www.') ||
          /\.(it|com|eu|net|org|sport|cc|cycling|bike|ciclismo)/.test(href);
        return looksLikeSite;
      } catch { return false; }
    });
    if (ext) result.website = ext.href;
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

// ─── Supabase ──────────────────────────────────────────────────────────────

async function uploadPhoto(sb, entityType, slug, buf) {
  const ext = (buf[0] === 0x89 && buf[1] === 0x50) ? 'png' : 'jpeg';
  const storagePath = `${entityType}s/pcs/${slug}.${ext}`;
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
  const _mode = SOCIAL_ONLY ? 'solo social' : 'PCS';
  console.log(`=== Import foto+social [${_mode}] ===\n`);

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
  console.log('Avvio sessione PCS…');
  await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 })
    .then(() => sleep(2500))
    .catch(e => { console.log(`Avviso PCS: ${e.message}`); return sleep(2000); });
  console.log('Pronto.\n');

  // ── ATLETI ────────────────────────────────────────────────────────────────
  if (DO_ATH) {
    console.log('── ATLETI ──────────────────────────────────────');

    const athMap = new Map();
    if (SINGLE_ID && SINGLE_NOME && SINGLE_COG) {
      athMap.set(SINGLE_ID, { atleta_id: SINGLE_ID, nome: SINGLE_NOME, cognome: SINGLE_COG });
    } else {
      for (const cat of ATH_CATS) {
        const file = path.join(RANK_DIR, `${cat}.json`);
        if (!fs.existsSync(file)) continue;
        for (const a of JSON.parse(fs.readFileSync(file, 'utf8')))
          if (a.atleta_id && !athMap.has(a.atleta_id)) athMap.set(a.atleta_id, a);
      }
    }
    const athletes = [...athMap.values()];

    const withPhoto = (FORCE || SOCIAL_ONLY) ? new Set() : await getExistingIds(sb, 'atleta', 'photo_url');
    const toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));

    console.log(`${athletes.length} atleti — ${athletes.length - toProcess.length} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const ath = toProcess[i];
      process.stdout.write(`(${i+1}/${toProcess.length}) ${ath.cognome} ${ath.nome} … `);

      let slug = pcsAthleteSlug(ath);
      let result = await fetchFromPcsRider(page, slug);
      if (result.notFound) {
        process.stdout.write('pcs-search… ');
        const found = await searchPcsRider(page, ath);
        if (found) { slug = found; result = await fetchFromPcsRider(page, found); }
      }

      const { photo, socials } = result;

      if (!photo && !Object.keys(socials || {}).length) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      const fields = {};
      fields.pcs_slug = slug; // salva sempre lo slug PCS trovato
      if (photo && !SOCIAL_ONLY) {
        try {
          fields.photo_url = await uploadPhoto(sb, 'atleta', slug, photo);
        } catch(e) {
          process.stdout.write(`ERRORE foto: ${e.message} `);
        }
      }

      if (socials?.instagram) fields.instagram_url = socials.instagram;
      if (socials?.twitter)   fields.twitter_url   = socials.twitter;
      if (socials?.strava)    fields.strava_url     = socials.strava;
      if (socials?.facebook)  fields.facebook_url   = socials.facebook;
      if (socials?.website)   fields.website_url    = socials.website;

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

    const withPhoto = (FORCE || SOCIAL_ONLY) ? new Set() : await getExistingIds(sb, 'team', 'photo_url');
    const toProcess = teams.filter(t => !withPhoto.has(t.id));

    console.log(`${teams.length} team — ${teams.length - toProcess.length} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const team = toProcess[i];
      const slug = pcsTeamSlug(team);
      process.stdout.write(`(${i+1}/${toProcess.length}) ${team.nome} … `);

      const result = await fetchFromPcsTeam(page, slug);

      if (!result.photo && !Object.keys(result.socials || {}).length) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      const fields = {};
      if (result.photo && !SOCIAL_ONLY) {
        try {
          fields.photo_url = await uploadPhoto(sb, 'team', slug, result.photo);
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
