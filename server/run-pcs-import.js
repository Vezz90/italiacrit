'use strict';
/**
 * Importazione locale foto profilo da PCS
 * Usa Supabase direttamente — non serve JWT né backend.
 * Usa Playwright (Chrome reale) per bypassare Cloudflare.
 *
 * Uso:
 *   node run-pcs-import.js
 *
 * Variabili d'ambiente richieste:
 *   SUPABASE_SECRET = <service role key>
 *
 * Prima esecuzione: npm install playwright
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = process.env.SUPABASE_URL    || 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) {
  console.error('Errore: imposta $env:SUPABASE_SECRET');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data', 'rankings');
const CATS     = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F'];

function pcsSlug(nome, cognome) {
  const full = `${nome || ''} ${cognome || ''}`.trim();
  return full
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, {
    realtime: { transport: ws },
  });

  console.log('=== PCS Import locale (Playwright) ===\n');

  // 1. Atleti dai JSON (dedup)
  const athleteMap = new Map();
  for (const cat of CATS) {
    const file = path.join(DATA_DIR, `${cat}.json`);
    if (!fs.existsSync(file)) { console.log(`File non trovato: ${cat}.json`); continue; }
    const ranking = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of ranking) {
      if (a.atleta_id && a.nome && a.cognome && !athleteMap.has(a.atleta_id))
        athleteMap.set(a.atleta_id, a);
    }
  }
  const athletes = [...athleteMap.values()];
  console.log(`${athletes.length} atleti unici trovati\n`);

  // 2. Salta chi ha già la foto
  console.log('Controllo override esistenti…');
  const { data: existingOv, error: ovErr } = await sb
    .from('entity_overrides')
    .select('entity_id')
    .eq('entity_type', 'atleta')
    .eq('field', 'photo_url')
    .not('new_value', 'is', null);

  if (ovErr) { console.error('Errore Supabase:', ovErr.message); process.exit(1); }

  const withPhoto = new Set((existingOv || []).map(r => r.entity_id));
  const toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));
  console.log(`${withPhoto.size} già con foto — ${toProcess.length} da processare\n`);

  // 3. Avvia Chrome visibile (headless: false bypassa il rilevamento bot di Cloudflare)
  console.log('Avvio Chrome (visibile, per bypassare Cloudflare)…');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false });
  } catch {
    console.log('Chrome non trovato, uso Chromium di Playwright…');
    browser = await chromium.launch({ headless: false });
  }
  const context = await browser.newContext({ locale: 'it-IT' });
  const page = await context.newPage();

  // Visita PCS homepage e aspetta che Cloudflare completi l'eventuale challenge
  console.log('Visita PCS per superare Cloudflare (attendi ~5 sec)…');
  try {
    await page.goto('https://www.procyclingstats.com/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await sleep(3000);
  } catch (e) {
    console.log(`Avviso homepage PCS: ${e.message}`);
    await sleep(3000);
  }

  let done = 0, notFound = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const ath = toProcess[i];
    const slug = pcsSlug(ath.nome, ath.cognome);
    process.stdout.write(`(${i + 1}/${toProcess.length}) ${ath.nome} ${ath.cognome} → ${slug} … `);

    await sleep(250);

    // Naviga direttamente sull'URL immagine — usa il browser reale con cookie Cloudflare
    const url = `https://www.procyclingstats.com/images/riders/lg/${slug}.jpeg`;
    let buf = null;
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      if (response && response.ok()) {
        const body = await response.body();
        if (body.length >= 1000 && body[0] === 0xFF && body[1] === 0xD8) {
          buf = body;
        }
      }
    } catch (e) {
      console.log(`ERRORE nav: ${e.message}`);
      errors++;
      continue;
    }

    if (!buf) { console.log('non trovato'); notFound++; continue; }

    // Upload su Supabase Storage
    const storagePath = `pcs/${slug}.jpeg`;
    const { error: upErr } = await sb.storage.from('photos').upload(storagePath, buf, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) { console.log(`ERRORE upload: ${upErr.message}`); errors++; continue; }

    // Salva override nella tabella entity_overrides
    const { error: dbErr } = await sb.from('entity_overrides').upsert({
      entity_type: 'atleta',
      entity_id:   ath.atleta_id,
      field:       'photo_url',
      new_value:   `/pcs/${slug}.jpeg`,
      edited_by:   null,
    }, { onConflict: 'entity_type,entity_id,field' });

    if (dbErr) { console.log(`ERRORE DB: ${dbErr.message}`); errors++; continue; }

    console.log('✓ salvato');
    done++;

    // Ogni 30 atleti torna alla homepage per rinnovare i cookie
    if ((i + 1) % 30 === 0) {
      try {
        await page.goto('https://www.procyclingstats.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(2000);
      } catch {}
    }
  }

  await browser.close();

  console.log(`\n=== Completato ===`);
  console.log(`✅ Salvati:        ${done}`);
  console.log(`⏭  Già esistenti:  ${withPhoto.size}`);
  console.log(`❓ Non su PCS:     ${notFound}`);
  console.log(`❌ Errori:         ${errors}`);
})();
