'use strict';

/**
 * PCS Photo Importer
 *
 * Per ogni atleta nei file di classifica che non ha già una foto profilo:
 * 1. Costruisce lo slug PCS (nome-cognome lowercase, accenti rimossi)
 * 2. Scarica la foto da ProCyclingStats con Referer header corretto
 * 3. Carica su Supabase Storage in photos/pcs/{slug}.jpeg
 * 4. Salva l'override photo_url nell'entity_overrides — identico al caricamento manuale
 *
 * Categorie supportate: Elite/U23 (ELI_M, ELI_F) e Juniores (JUN_M, JUN_F)
 * Le categorie giovanili (Allievi, Esordienti) vengono saltate — raramente su PCS.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR     = path.join(__dirname, '..', 'data', 'rankings');
const SUPABASE_PUB = 'https://aqqsstsbgpapzoxllosh.supabase.co/storage/v1/object/public';

const CATS_TO_IMPORT = ['ELI_M', 'ELI_F', 'JUN_M', 'JUN_F'];

function pcsSlug(nome, cognome) {
  const full = `${nome || ''} ${cognome || ''}`.trim();
  return full
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchPcsPhoto(slug) {
  const url = `https://www.procyclingstats.com/images/riders/lg/${slug}.jpeg`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer':    'https://www.procyclingstats.com/',
        'Accept':     'image/jpeg,image/*,*/*',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Sanity: PCS restituisce un GIF "image not found" (43 byte) quando non trova il rider
    if (buf.length < 500) return null;
    return buf;
  } catch {
    return null;
  }
}

// Concurrency limiter — non bombardare PCS
async function mapConcurrent(arr, fn, limit = 2) {
  const results = new Array(arr.length);
  let idx = 0;
  async function worker() {
    while (idx < arr.length) {
      const i = idx++;
      results[i] = await fn(arr[i], i).catch(e => ({ error: e.message }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return results;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Esegue l'import batch.
 * @param {object} supabase  — istanza Supabase già inizializzata
 * @param {object} queries   — oggetto queries del db.js
 * @param {object} opts
 * @param {boolean} opts.skipExisting — se true (default), salta atleti con photo_url già impostata
 * @param {string[]} opts.cats — categorie da importare (default: CATS_TO_IMPORT)
 * @param {function} opts.onProgress — callback(msg) per log live
 * @returns {{ done, skipped, notFound, errors }}
 */
async function importPcsPhotos(supabase, queries, opts = {}) {
  const {
    skipExisting = true,
    cats         = CATS_TO_IMPORT,
    onProgress   = console.log,
  } = opts;

  // 1. Carica tutti gli atleti dalle categorie richieste (dedup per atleta_id)
  const athleteMap = new Map(); // atleta_id → { nome, cognome, atleta_id }
  for (const cat of cats) {
    const file = path.join(DATA_DIR, `${cat}.json`);
    if (!fs.existsSync(file)) { onProgress(`[pcs] File non trovato: ${cat}.json — saltato`); continue; }
    const ranking = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of ranking) {
      if (!a.atleta_id || !a.nome || !a.cognome) continue;
      if (!athleteMap.has(a.atleta_id)) {
        athleteMap.set(a.atleta_id, { atleta_id: a.atleta_id, nome: a.nome, cognome: a.cognome });
      }
    }
  }

  const athletes = [...athleteMap.values()];
  onProgress(`[pcs] ${athletes.length} atleti unici trovati in ${cats.join(', ')}`);

  // 2. Se skipExisting: filtra chi ha già un override photo_url
  let toProcess = athletes;
  if (skipExisting) {
    onProgress('[pcs] Controllo override esistenti…');
    const existing = await queries.getAllEntityOverrides();
    const withPhoto = new Set(
      existing
        .filter(o => o.entity_type === 'atleta' && o.field === 'photo_url' && o.new_value)
        .map(o => o.entity_id)
    );
    toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));
    onProgress(`[pcs] ${withPhoto.size} atleti già con foto — ${toProcess.length} da processare`);
  }

  if (!toProcess.length) {
    onProgress('[pcs] Nessun atleta da processare.');
    return { done: 0, skipped: athletes.length - toProcess.length, notFound: 0, errors: 0 };
  }

  // 3. Processa con concorrenza 2 (gentile con PCS)
  let done = 0, notFound = 0, errors = 0;
  const skipped = athletes.length - toProcess.length;

  await mapConcurrent(toProcess, async (ath, i) => {
    const slug = pcsSlug(ath.nome, ath.cognome);
    onProgress(`[pcs] (${i + 1}/${toProcess.length}) ${ath.nome} ${ath.cognome} → ${slug}`);

    // Controlla se già su Supabase Storage
    const storagePath = `pcs/${slug}.jpeg`;
    let alreadyOnStorage = false;
    try {
      const { data: listed } = await supabase.storage.from('photos').list('pcs', { search: `${slug}.jpeg`, limit: 1 });
      alreadyOnStorage = listed?.some(f => f.name === `${slug}.jpeg`) ?? false;
    } catch {}

    let publicUrl;
    if (alreadyOnStorage) {
      publicUrl = `${SUPABASE_PUB}/photos/${storagePath}`;
      onProgress(`  ↳ già in storage, riuso URL`);
    } else {
      // Fetch da PCS
      await sleep(300); // pausa cortesia
      const buf = await fetchPcsPhoto(slug);
      if (!buf) {
        onProgress(`  ↳ non trovato su PCS`);
        notFound++;
        return;
      }

      // Upload su Supabase Storage
      const { error: uploadErr } = await supabase.storage.from('photos').upload(storagePath, buf, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (uploadErr) {
        onProgress(`  ↳ ERRORE upload Supabase: ${uploadErr.message}`);
        errors++;
        return;
      }
      publicUrl = `${SUPABASE_PUB}/photos/${storagePath}`;
      onProgress(`  ↳ caricata su Supabase`);
    }

    // Salva entity_override — stesso schema del caricamento manuale
    try {
      await queries.setEntityOverride({
        entity_type: 'atleta',
        entity_id:   ath.atleta_id,
        field:       'photo_url',
        new_value:   `/pcs/${slug}.jpeg`,
        edited_by:   null, // importazione automatica
      });
      onProgress(`  ↳ override salvato ✓`);
      done++;
    } catch (e) {
      onProgress(`  ↳ ERRORE DB: ${e.message}`);
      errors++;
    }
  }, 2);

  onProgress(`[pcs] Import completato — ${done} salvati, ${skipped} già esistenti, ${notFound} non trovati su PCS, ${errors} errori`);
  return { done, skipped, notFound, errors };
}

module.exports = { importPcsPhotos, pcsSlug };
