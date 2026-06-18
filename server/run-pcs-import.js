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

// atleta_id = COGNOME_PARTI_NOME  (es. LONGO_BORGHINI_ELISA → elisa-longo-borghini)
function pcsSlugFromId(atleta_id) {
  const parts = atleta_id.split('_');
  const givenName = parts[parts.length - 1];
  const surname   = parts.slice(0, -1).join(' ');
  return `${givenName} ${surname}`.trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    const slug = pcsSlugFromId(ath.atleta_id);
    process.stdout.write(`(${i+1}/${toProcess.length}) ${slug} … `);

    // Intercetta l'immagine corridore mentre la pagina carica
    let buf = null;
    const imageCapture = new Promise(resolve => {
      const handler = async response => {
        const url = response.url();
        if (url.includes('/images/riders/') && response.ok()) {
          page.off('response', handler);
          try {
            const b = await response.body();
            if (b.length >= 1000 && b[0] === 0xFF && b[1] === 0xD8) resolve(b);
            else resolve(null);
          } catch { resolve(null); }
        }
      };
      page.on('response', handler);
      setTimeout(() => { page.off('response', handler); resolve(null); }, 8000);
    });

    try {
      await page.goto(`https://www.procyclingstats.com/rider/${slug}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      // Se redirect a pagenotfound, corridore non su PCS
      if (page.url().includes('pagenotfound') || page.url().includes('404')) {
        console.log('non su PCS');
        notFound++;
        continue;
      }
    } catch {
      console.log('timeout');
      notFound++;
      continue;
    }

    buf = await imageCapture;
    if (!buf) { console.log('no foto'); notFound++; continue; }

    // Upload Supabase Storage
    const { error: upErr } = await sb.storage.from('photos')
      .upload(`pcs/${slug}.jpeg`, buf, { contentType: 'image/jpeg', upsert: true });
    if (upErr) { console.log(`ERRORE upload: ${upErr.message}`); errors++; continue; }

    // Override DB
    const { error: dbErr } = await sb.from('entity_overrides').upsert({
      entity_type: 'atleta',
      entity_id:   ath.atleta_id,
      field:       'photo_url',
      new_value:   `/pcs/${slug}.jpeg`,
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
