'use strict';
/**
 * Import foto profilo PCS — Playwright headless:false
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "la-tua-service-role-key"
 *   node run-pcs-import.js
 *
 * Prima esecuzione: npm install playwright
 * Richiede Chrome installato sul PC.
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const DATA_DIR = path.join(__dirname, '..', 'data', 'rankings');
const CATS     = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F'];

function normalizeStr(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Usa nome e cognome reali dall'oggetto atleta (più accurato del solo ID)
function pcsSlugFromAth(ath) {
  return `${normalizeStr(ath.nome)}-${normalizeStr(ath.cognome)}`;
}

// Fallback da ID solo (per retrocompatibilità)
function pcsSlugFromId(atleta_id) {
  const parts = atleta_id.split('_');
  const givenName = parts[parts.length - 1];
  const surname   = parts.slice(0, -1).join(' ');
  return normalizeStr(`${givenName} ${surname}`);
}

function namesFromAth(ath) {
  const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return { givenName: normalize(ath.nome), surname: normalize(ath.cognome) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Naviga a una pagina corridore PCS e scarica la sua foto.
 * Ritorna { buf: Buffer|null, notFound: boolean }
 *   buf      = dati JPEG, o null se la pagina esiste ma non ha foto
 *   notFound = true se la pagina ha restituito pagenotfound/404
 *
 * Approccio: legge il src dell'<img> direttamente dal DOM (funziona
 * anche con lazy-loading) poi fetcha l'immagine con le credenziali
 * della sessione corrente.
 */
async function tryFetchRiderImage(page, riderUrl) {
  try {
    await page.goto(riderUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    return { buf: null, notFound: false };
  }

  if (page.url().includes('pagenotfound') || page.url().includes('404')) {
    return { buf: null, notFound: true };
  }

  // Piccolo scroll per triggerare eventuale lazy-load
  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(800);

  // Estrai l'URL dell'immagine corridore direttamente dal DOM
  const imgSrc = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')]
      .find(i => i.src && i.src.includes('/images/riders/'));
    // Alcuni rider hanno solo data-src (lazy) ma non ancora src popolato
    if (img) return img.src || img.dataset.src || null;
    // Fallback: cerca negli attributi data-src
    const lazy = [...document.querySelectorAll('[data-src*="/images/riders/"]')];
    return lazy.length ? lazy[0].dataset.src : null;
  }).catch(() => null);

  if (!imgSrc) return { buf: null, notFound: false };

  // Fetch immagine usando il contesto browser (credenziali Cloudflare incluse)
  const bytes = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    } catch { return null; }
  }, imgSrc).catch(() => null);

  if (!bytes || bytes.length < 1000) return { buf: null, notFound: false };
  const buf = Buffer.from(bytes);
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return { buf: null, notFound: false };
  return { buf, notFound: false };
}

/**
 * Cerca il corridore su PCS tramite la pagina di ricerca.
 * Ritorna la slug corretta (es. "simone-buda-2006") o null se non trovata.
 */
async function findPcsSlugViaSearch(page, ath) {
  const { givenName, surname } = namesFromAth(ath);
  const searchTerm = `${givenName} ${surname}`;

  try {
    await page.goto(
      `https://www.procyclingstats.com/search.php?search=${encodeURIComponent(searchTerm)}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
  } catch {
    return null;
  }

  // Estrai tutti gli href che puntano a /rider/SLUG
  const hrefs = await page.evaluate(() => {
    return [...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h && /\/rider\/[a-z0-9-]+/.test(h));
  }).catch(() => []);

  if (!hrefs.length) return null;

  // Filtra: prendi quello che contiene sia nome che cognome nel slug
  const { givenName: gn, surname: sn } = namesFromAth(ath);
  const gnParts = gn.split(' ');
  const snParts = sn.split(' ');

  const scored = hrefs.map(h => {
    const match = h.match(/\/rider\/([a-z0-9-]+)/);
    if (!match) return null;
    const slug = match[1];
    let score = 0;
    for (const p of gnParts) if (slug.includes(p)) score++;
    for (const p of snParts) if (slug.includes(p)) score++;
    return { slug, score };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return null;
  return best.slug;
}

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('=== PCS Import (Playwright pagine corridori) ===\n');

  // 1. Atleti dai JSON
  const athleteMap = new Map();
  for (const cat of CATS) {
    const file = path.join(DATA_DIR, `${cat}.json`);
    if (!fs.existsSync(file)) { console.log(`Mancante: ${cat}.json`); continue; }
    const ranking = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of ranking)
      if (a.atleta_id && !athleteMap.has(a.atleta_id)) athleteMap.set(a.atleta_id, a);
  }
  const athletes = [...athleteMap.values()];
  console.log(`${athletes.length} atleti unici\n`);

  // 2. Già con foto
  const { data: existingOv } = await sb.from('entity_overrides')
    .select('entity_id').eq('entity_type', 'atleta').eq('field', 'photo_url')
    .not('new_value', 'is', null).limit(5000);
  const withPhoto = new Set((existingOv || []).map(r => r.entity_id));
  const toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));
  console.log(`${withPhoto.size} già con foto — ${toProcess.length} da processare\n`);

  // 3. Avvia Chrome visibile (bypassa Cloudflare)
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false });
  } catch {
    browser = await chromium.launch({ headless: false });
  }
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'it-IT',
    viewport: { width: 1280, height: 800 },
  });
  // Rimuove navigator.webdriver per evitare il rilevamento bot
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Homepage PCS per ottenere cookie Cloudflare
  console.log('Visita homepage PCS (attendi ~5 sec)…');
  try {
    await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000);
    console.log('Pronto.\n');
  } catch(e) {
    console.log(`Avviso: ${e.message}`);
    await sleep(3000);
  }

  let done = 0, notFound = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const ath  = toProcess[i];
    let   slug = pcsSlugFromAth(ath);
    process.stdout.write(`(${i+1}/${toProcess.length}) ${slug} … `);

    // Primo tentativo: slug diretta (nome-cognome)
    let { buf, notFound: nf } = await tryFetchRiderImage(
      page, `https://www.procyclingstats.com/rider/${slug}`
    );

    // Fallback: se non trovato su PCS, cerca tramite search
    if (nf) {
      process.stdout.write('search… ');
      const foundSlug = await findPcsSlugViaSearch(page, ath);
      if (foundSlug && foundSlug !== slug) {
        process.stdout.write(`${foundSlug} … `);
        slug = foundSlug;
        const res2 = await tryFetchRiderImage(
          page, `https://www.procyclingstats.com/rider/${slug}`
        );
        buf = res2.buf;
        nf  = res2.notFound;
      }
    }

    if (nf || !buf) {
      console.log(nf ? 'non su PCS' : 'no foto');
      notFound++;
      continue;
    }

    // Upload Supabase Storage
    const { error: upErr } = await sb.storage.from('photos')
      .upload(`pcs/${slug}.jpeg`, buf, { contentType: 'image/jpeg', upsert: true });
    if (upErr) { console.log(`ERRORE upload: ${upErr.message}`); errors++; continue; }

    // Override DB
    const { error: dbErr } = await sb.from('entity_overrides').upsert({
      entity_type: 'atleta',
      entity_id:   ath.atleta_id,
      field:       'photo_url',
      new_value:   `/photos/pcs/${slug}.jpeg`,
      edited_by:   null,
    }, { onConflict: 'entity_type,entity_id,field' });
    if (dbErr) { console.log(`ERRORE DB: ${dbErr.message}`); errors++; continue; }

    console.log('✓');
    done++;

    await sleep(200);
  }

  await browser.close();
  console.log(`\n=== Completato ===`);
  console.log(`✅ Salvati:       ${done}`);
  console.log(`⏭  Già esistenti: ${withPhoto.size}`);
  console.log(`❓ Non su PCS:    ${notFound}`);
  console.log(`❌ Errori:        ${errors}`);
})();
