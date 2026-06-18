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

  // 3. Avvia Chrome (usa il Chrome installato sul PC)
  console.log('Avvio Chrome…');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    // Fallback: Chromium di Playwright (potrebbe essere bloccato da Cloudflare)
    console.log('Chrome non trovato, uso Chromium di Playwright…');
    browser = await chromium.launch({ headless: true });
  }
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'it-IT',
  });
  const page = await context.newPage();

  // Visita PCS una volta per ottenere cookie Cloudflare
  console.log('Visita PCS per cookie Cloudflare…');
  try {
    await page.goto('https://www.procyclingstats.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(2000); // aspetta eventuali challenge JS
  } catch (e) {
    console.log(`Avviso homepage PCS: ${e.message}`);
  }

  let done = 0, notFound = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const ath = toProcess[i];
    const slug = pcsSlug(ath.nome, ath.cognome);
    process.stdout.write(`(${i + 1}/${toProcess.length}) ${ath.nome} ${ath.cognome} → ${slug} … `);

    await sleep(300);

    // Scarica l'immagine tramite fetch() nel contesto browser (con cookie Cloudflare)
    const url = `https://www.procyclingstats.com/images/riders/lg/${slug}.jpeg`;
    let buf = null;
    try {
      const result = await page.evaluate(async (imgUrl) => {
        try {
          const res = await fetch(imgUrl, { credentials: 'include' });
          if (!res.ok) return null;
          const ab = await res.arrayBuffer();
          return Array.from(new Uint8Array(ab));
        } catch {
          return null;
        }
      }, url);

      if (result && result.length >= 1000) {
        buf = Buffer.from(result);
        if (buf[0] !== 0xFF || buf[1] !== 0xD8) buf = null; // non JPEG
      }
    } catch (e) {
      console.log(`ERRORE fetch: ${e.message}`);
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

    // Ogni 50 atleti, rivisita PCS per rinnovare i cookie
    if ((i + 1) % 50 === 0) {
      try {
        await page.goto('https://www.procyclingstats.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(1500);
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
