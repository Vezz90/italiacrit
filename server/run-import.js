'use strict';
/**
 * Import foto + social per atleti e team
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node run-import.js [--athletes] [--teams] [--social] [--force] [--pcs] [--fc]
 *
 *   --athletes   solo atleti  (default: entrambi)
 *   --teams      solo team    (default: entrambi)
 *   --social     solo social (no foto) — aggiorna TUTTI anche chi ha già la foto
 *   --pcs        usa solo ProCyclingStats
 *   --fc         usa solo First Cycling
 *   --force      re-importa anche chi ha già tutti i dati
 *
 * Comportamento default: PCS + FC in parallelo, PCS ha priorità.
 * Salta chi ha già una foto (a meno di --social o --force).
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const args        = process.argv.slice(2);
const DO_ATH      = !args.includes('--teams');
const DO_TEAM     = !args.includes('--athletes');
const FORCE       = args.includes('--force');
const PCS_ONLY    = args.includes('--pcs');
const FC_ONLY     = args.includes('--fc');
const SOCIAL_ONLY = args.includes('--social');  // solo social, niente foto
const SINGLE_ID   = (args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;
const SINGLE_NOME = (args.find(a => a.startsWith('--nome=')) || '').split('=')[1] || null;
const SINGLE_COG  = (args.find(a => a.startsWith('--cognome=')) || '').split('=')[1] || null;
const YEAR        = new Date().getFullYear();

const DATA_DIR = path.join(__dirname, '..', 'data');
const RANK_DIR = path.join(DATA_DIR, 'rankings');
// Elite, Junior e Allievi (M e F)
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
    // Sito personale: link esterno che sembra un vero sito web dell'atleta/team.
    // Criteri: non è un social/stats noto, non è Cloudflare/CDN/analytics/sponsor generico,
    // il testo del link o l'href contiene "www" oppure l'anchor text è significativo.
    const curHost = location.hostname;
    const BLOCKLIST = /(procyclingstats|firstcycling|instagram|twitter|x\.com|strava|facebook|youtube|google|cloudflare|cdn-cgi|challenges\.|doubleclick|analytics|googletag|adservice|scorecard|omtrdc|bing\.com|amazon|aliexpress|paypal|awin|affiliat|tracking|redirect|banner|sponsor|kit\.fontawesome|jquery|bootstrapcdn|unpkg\.com|cdnjs)/i;
    const candidates = [...document.querySelectorAll('a[href^="http"]')];
    const ext = candidates.find(a => {
      try {
        const u = new URL(a.href);
        if (u.hostname === curHost) return false;
        if (BLOCKLIST.test(u.hostname) || BLOCKLIST.test(a.href)) return false;
        // Deve avere almeno un dominio di secondo livello reale (es. esempio.it, non solo IP)
        if (!/\.[a-z]{2,}$/i.test(u.hostname)) return false;
        // Il testo visibile del link o l'href deve suggerire che è un sito personale/team
        const txt = (a.textContent || '').trim().toLowerCase();
        const href = a.href.toLowerCase();
        // Accetta se: testo ha "www", o href ha "www.", o testo sembra un dominio
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

// ─── First Cycling ─────────────────────────────────────────────────────────

// Aspetta che Cloudflare finisca la verifica automatica e carichi la pagina vera.
// CF inietta il challenge via JS, quindi aspettiamo prima che il DOM sia stabile.
async function waitPassCF(page, timeout = 25000) {
  // Pausa iniziale: lascia tempo a CF di iniettare il challenge nel DOM
  await sleep(1200);

  const isCF = () => page.evaluate(() => {
    const title = (document.title || '').toLowerCase();
    const body  = (document.body?.innerText || '').toLowerCase();
    return title.includes('just a moment') ||
           title.includes('ci siamo quasi') ||
           title.includes('checking your') ||
           title.includes('un momento') ||
           body.includes('verifica di sicurezza') ||
           body.includes('checking your browser') ||
           !!document.querySelector('#challenge-running, #cf-spinner, .cf-browser-verification, #challenge-form, #turnstile-wrapper');
  }).catch(() => false);

  if (!(await isCF())) return; // nessuna challenge, pagina già caricata

  process.stdout.write('\n       [CF challenge — attendo');
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(700);
    process.stdout.write('.');
    if (!(await isCF())) {
      process.stdout.write(' ✓]\n       ');
      await sleep(1500); // pausa extra dopo risoluzione per sicurezza
      return;
    }
  }
  process.stdout.write(' TIMEOUT]\n       ');
}

async function searchFirstCycling(page, name, type = 'riders') {
  const pat = type === 'riders' ? 'rider.php?r=' : 'team.php?l=';
  // Prova prima nome+cognome, poi cognome+nome
  const queries = [name, name.split(' ').reverse().join(' ')];
  for (const q of queries) {
    try {
      await page.goto(
        `https://firstcycling.com/search.php?s=${encodeURIComponent(q)}&searchtype=${type}`,
        { waitUntil: 'domcontentloaded', timeout: 15000 }
      );
    } catch { continue; }
    await waitPassCF(page);

    // FC a volte redirige direttamente al profilo quando c'è un solo risultato
    const currentUrl = page.url();
    if (currentUrl.includes(pat)) return currentUrl;

    // Aspetta che i risultati di ricerca appaiano nel DOM (possono essere JS-rendered)
    await page.waitForSelector(`a[href*="${pat}"]`, { timeout: 6000 }).catch(() => null);

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
  await waitPassCF(page);
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
  await waitPassCF(page);
  if (page.url().includes('search.php') || page.url().includes('404'))
    return { notFound: true };

  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(800);

  const imgSrc = await page.evaluate(() => {
    // Accetta SOLO il logo ufficiale FC nella directory /photos/teams/
    // Non usiamo fallback generici che raccolgono avatar Twitter/Instagram
    const byTeams = [...document.querySelectorAll('img[src]')].find(i => /\/photos\/teams\//i.test(i.src));
    return byTeams ? byTeams.src : null;
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

  const _mode = SOCIAL_ONLY ? 'solo social' : FC_ONLY ? 'First Cycling' : PCS_ONLY ? 'PCS only' : 'PCS + FC parallelo';
  console.log(`=== Import [${_mode}] ===\n`);

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
  // Due pagine separate: una per PCS, una per FC — girano in parallelo
  const pcsPage = !FC_ONLY  ? await context.newPage() : null;
  const fcPage  = !PCS_ONLY ? await context.newPage() : null;

  // Sessioni iniziali in parallelo (passaggio Cloudflare)
  console.log('Avvio sessioni…');
  await Promise.all([
    pcsPage ? pcsPage.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 })
                .then(() => sleep(2500))
                .catch(e => { console.log(`Avviso PCS: ${e.message}`); return sleep(2000); })
            : Promise.resolve(),
    fcPage  ? fcPage.goto('https://firstcycling.com/', { waitUntil: 'domcontentloaded', timeout: 20000 })
                .then(() => waitPassCF(fcPage))
                .then(() => sleep(3000))
                .catch(e => { console.log(`Avviso FC: ${e.message}`); })
            : Promise.resolve(),
  ]);
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

    // --social: processa tutti (solo per aggiornare social, non tocca le foto)
    // default: salta chi ha già la foto
    const withPhoto = (FORCE || SOCIAL_ONLY) ? new Set() : await getExistingIds(sb, 'atleta', 'photo_url');
    const toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));

    console.log(`${athletes.length} atleti — ${athletes.length - toProcess.length} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const ath = toProcess[i];
      process.stdout.write(`(${i+1}/${toProcess.length}) ${ath.cognome} ${ath.nome} … `);

      // PCS e FC in parallelo — PCS ha priorità sul risultato finale
      const [pcsResult, fcResult] = await Promise.all([
        pcsPage ? (async () => {
          let slug = pcsAthleteSlug(ath);
          let res  = await fetchFromPcsRider(pcsPage, slug);
          if (res.notFound) {
            process.stdout.write('pcs-search… ');
            const found = await searchPcsRider(pcsPage, ath);
            if (found) { slug = found; res = await fetchFromPcsRider(pcsPage, found); }
          }
          return { ...res, slug };
        })() : Promise.resolve({ photo: null, socials: {}, slug: pcsAthleteSlug(ath) }),

        fcPage ? (async () => {
          const fcUrl = await searchFirstCycling(fcPage, `${ath.nome} ${ath.cognome}`, 'riders');
          if (!fcUrl) return { photo: null, socials: {} };
          process.stdout.write('fc… ');
          return fetchFromFcRider(fcPage, fcUrl);
        })() : Promise.resolve({ photo: null, socials: {} }),
      ]);

      // Merge: PCS vince sempre su foto e social; FC riempie i campi mancanti
      const photo   = pcsResult.photo || fcResult.photo;
      const socials = { ...(fcResult.socials || {}), ...(pcsResult.socials || {}) };
      const slug    = pcsResult.slug || pcsAthleteSlug(ath);
      const photoSrc = pcsResult.photo ? 'pcs' : 'fc';

      if (!photo && !Object.keys(socials).length) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      const fields = {};
      if (photo && !SOCIAL_ONLY) {
        try {
          fields.photo_url = await uploadPhoto(sb, 'atleta', slug, photo, photoSrc);
        } catch(e) {
          process.stdout.write(`ERRORE foto: ${e.message} `);
        }
      }

      if (socials.instagram) fields.instagram_url = socials.instagram;
      if (socials.twitter)   fields.twitter_url   = socials.twitter;
      if (socials.strava)    fields.strava_url     = socials.strava;
      if (socials.facebook)  fields.facebook_url   = socials.facebook;
      if (socials.website)   fields.website_url    = socials.website;

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
        fields.photo_url     ? `📷(${photoSrc})` : '',
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

    // --social: processa tutti per aggiornare social, non tocca le foto
    const withPhoto = (FORCE || SOCIAL_ONLY) ? new Set() : await getExistingIds(sb, 'team', 'photo_url');
    const toProcess = teams.filter(t => !withPhoto.has(t.id));

    console.log(`${teams.length} team — ${teams.length - toProcess.length} già con foto — ${toProcess.length} da processare\n`);

    let done = 0, noData = 0, errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const team = toProcess[i];
      const slug = pcsTeamSlug(team);
      process.stdout.write(`(${i+1}/${toProcess.length}) ${team.nome} … `);

      // PCS e FC in parallelo — PCS ha priorità
      const [pcsResult, fcResult] = await Promise.all([
        pcsPage ? fetchFromPcsTeam(pcsPage, slug)
                : Promise.resolve({ photo: null, socials: {} }),

        fcPage ? (async () => {
          const fcUrl = await searchFirstCycling(fcPage, team.nome, 'teams');
          if (!fcUrl) return { photo: null, socials: {} };
          process.stdout.write('fc… ');
          return fetchFromFcTeam(fcPage, fcUrl);
        })() : Promise.resolve({ photo: null, socials: {} }),
      ]);

      const photo   = pcsResult.photo || fcResult.photo;
      const socials = { ...(fcResult.socials || {}), ...(pcsResult.socials || {}) };
      const photoSrc = pcsResult.photo ? 'pcs' : 'fc';

      if (!photo && !Object.keys(socials).length) {
        process.stdout.write('non trovato\n');
        noData++;
        continue;
      }

      const fields = {};
      if (photo && !SOCIAL_ONLY) {
        try {
          fields.photo_url = await uploadPhoto(sb, 'team', slug, photo, photoSrc);
        } catch(e) {
          process.stdout.write(`ERRORE foto: ${e.message} `);
        }
      }

      const s = socials;
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
        fields.photo_url     ? `📷(${photoSrc})` : '',
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
