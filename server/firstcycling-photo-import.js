'use strict';
/**
 * Import foto atleti + team Juniores da FirstCycling.com.
 *
 * Richiesta esplicita dell'utente (2026-09-03): molti Juniores non hanno
 * ancora una foto profilo (troppo giovani per avere una pagina PCS/
 * risultati internazionali), ma FirstCycling copre anche le categorie
 * giovanili molto meglio di PCS. Riempie SOLO i buchi (chi non ha già una
 * foto da nessun'altra fonte) — non sostituisce mai una foto già presente.
 *
 * ATTENZIONE — selettori DOM non ancora validati dal vivo: FirstCycling
 * è protetto da una sfida Cloudflare Turnstile identica a quella di PCS
 * (verificato dal vivo: il browser automatizzato di Claude non riesce a
 * superarla, richiede un click umano reale — stesso motivo per cui questo
 * script, come pcs-athlete-import.js, va lanciato in un browser Brave
 * VISIBILE dove l'utente può cliccare la verifica). Non è stato quindi
 * possibile ispezionare la struttura reale della pagina prima di scrivere
 * questo script: gli estrattori foto sotto (fetchFromFcRider/
 * fetchFromFcTeam) usano PIÙ strategie di fallback (classi/percorsi
 * immagine plausibili, poi "immagine più grande della pagina" come ultima
 * spiaggia) proprio perché il selettore esatto non è verificato — vanno
 * quasi certamente corretti al primo giro reale in base a cosa NON viene
 * trovato (il log stampa chiaramente quando una pagina esiste ma non si
 * trova nessuna immagine plausibile, per poter aggiustare il selettore).
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node firstcycling-photo-import.js [--force] [--limit=N] [--atleta-id=X] [--teams-only] [--athletes-only]
 *
 *   --force          re-importa anche chi ha già una foto (sovrascrive)
 *   --teams-only     salta gli atleti, fa solo i team
 *   --athletes-only  salta i team, fa solo gli atleti
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

const args          = process.argv.slice(2);
const FORCE         = args.includes('--force');
const TEAMS_ONLY    = args.includes('--teams-only');
const ATHLETES_ONLY = args.includes('--athletes-only');
const LIMIT         = parseInt((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '') || null;
const SINGLE_ID      = (args.find(a => a.startsWith('--atleta-id=')) || '').split('=')[1] || null;

const DATA_DIR = path.join(__dirname, '..', 'data');
const RANK_DIR = path.join(DATA_DIR, 'rankings');
// Solo Juniores, richiesta esplicita dell'utente — non Elite/Allievi/Esordienti.
const ATH_CATS = ['JUN_M', 'JUN_F'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ─── FirstCycling ────────────────────────────────────────────────────────

// Estrae la prima immagine "plausibile" da una pagina profilo, provando
// più strategie in ordine di affidabilità decrescente. Ritorna anche QUALE
// strategia ha funzionato (utile nel log per capire cosa aggiustare se
// trova sempre l'immagine sbagliata, es. il logo del sito invece del volto).
async function extractProfileImage(page, kind /* 'rider' | 'team' */) {
  return page.evaluate((kind) => {
    const imgs = [...document.querySelectorAll('img')];
    const abs = (src) => { try { return new URL(src, location.href).href; } catch { return null; } };

    // 1. Percorso immagine tipico per corridori/team (pattern osservato su
    //    siti di ciclismo simili: /images/riders/, /images/teams/, /riders/,
    //    /teams/, o un id numerico nel nome file tipo "12345.png").
    const pathRe = kind === 'rider'
      ? /\/(images\/)?riders?\//i
      : /\/(images\/)?teams?\//i;
    let found = imgs.find(i => i.src && pathRe.test(i.src));
    if (found) return { src: abs(found.src), strategy: 'path-match' };

    // 2. Immagine dentro un contenitore con classe/id che richiama il profilo
    //    (riderinfo, rider-photo, team-logo, profile-img, ecc.)
    const containerRe = /(rider|team|profile|player)[-_]?(info|photo|img|pic|logo|avatar)/i;
    const container = [...document.querySelectorAll('[class],[id]')]
      .find(el => containerRe.test(el.className || '') || containerRe.test(el.id || ''));
    if (container) {
      const img = container.querySelector('img');
      if (img && img.src) return { src: abs(img.src), strategy: 'container-match' };
    }

    // 3. Ultima spiaggia: l'immagine più grande della pagina (esclude icone
    //    piccole/sprite/loghi generici del sito, tipicamente <100px).
    const withSize = imgs
      .filter(i => i.src && i.src.startsWith('http') && !/logo|sprite|icon|flag/i.test(i.src))
      .map(i => ({ img: i, area: (i.naturalWidth || i.width || 0) * (i.naturalHeight || i.height || 0) }))
      .filter(x => x.area > 100 * 100)
      .sort((a, b) => b.area - a.area);
    if (withSize.length) return { src: abs(withSize[0].img.src), strategy: 'largest-image' };

    return null;
  }, kind).catch(() => null);
}

async function downloadImage(page, url) {
  if (!url) return null;
  const bytes = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { credentials: 'include' });
      if (!r.ok) return null;
      return Array.from(new Uint8Array(await r.arrayBuffer()));
    } catch { return null; }
  }, url).catch(() => null);
  if (!bytes || bytes.length < 500) return null;
  const buf = Buffer.from(bytes);
  // Scarta placeholder/1x1 troppo piccoli per essere una foto vera.
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPng  = buf[0] === 0x89 && buf[1] === 0x50;
  if (!isJpeg && !isPng) return null;
  return buf;
}

async function fetchFromFcSearch(page, query, onLog) {
  const nav = await gotoPcsPage(page, `https://firstcycling.com/search.php?search=${encodeURIComponent(query)}`, {
    readySelector: 'body', onLog,
  });
  if (!nav.ok) return null;
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(Boolean)
  ).catch(() => []);
  return hrefs;
}

async function fetchRiderPhotoByProfileUrl(page, url, onLog) {
  const nav = await gotoPcsPage(page, url, { readySelector: 'body', onLog });
  if (!nav.ok) return { notFound: nav.notFound, photo: null };
  await sleep(600);
  const found = await extractProfileImage(page, 'rider');
  if (!found) return { notFound: false, photo: null, noImageFound: true };
  const photo = await downloadImage(page, found.src);
  return { notFound: false, photo, strategy: found.strategy, imgSrc: found.src };
}

async function fetchTeamPhotoByProfileUrl(page, url, onLog) {
  const nav = await gotoPcsPage(page, url, { readySelector: 'body', onLog });
  if (!nav.ok) return { notFound: nav.notFound, photo: null };
  await sleep(600);
  const found = await extractProfileImage(page, 'team');
  if (!found) return { notFound: false, photo: null, noImageFound: true };
  const photo = await downloadImage(page, found.src);
  return { notFound: false, photo, strategy: found.strategy, imgSrc: found.src };
}

// Cerca per nome+cognome e sceglie il link /rider.php?riderid=N più
// plausibile in base al testo del link (non abbiamo un pattern di slug
// affidabile come per PCS — FirstCycling usa id numerici, non slug testuali
// — quindi il match è sul TESTO visibile del risultato di ricerca, non sull'URL).
async function searchFcRider(page, ath, onLog) {
  const hrefs = await fetchFromFcSearch(page, `${ath.nome} ${ath.cognome}`, onLog);
  if (!hrefs) return null;
  const riderLinks = hrefs.filter(h => /rider\.php\?riderid=\d+/i.test(h));
  if (!riderLinks.length) return null;
  // Senza testo del link a disposizione qui (solo href), prendi il primo —
  // FirstCycling di norma ordina i risultati per rilevanza. Se in pratica
  // risultasse impreciso, va rivisto per leggere anche il testo/contesto
  // del link (nome mostrato accanto) e fare scoring come pcsAthleteSlug.
  const m = riderLinks[0].match(/riderid=(\d+)/i);
  return m ? m[1] : null;
}

async function searchFcTeam(page, team, onLog) {
  const hrefs = await fetchFromFcSearch(page, team.team_nome, onLog);
  if (!hrefs) return null;
  const teamLinks = hrefs.filter(h => /team\.php\?team=/i.test(h));
  if (!teamLinks.length) return null;
  return teamLinks[0].startsWith('http') ? teamLinks[0] : `https://firstcycling.com/${teamLinks[0].replace(/^\//, '')}`;
}

// ─── Supabase ────────────────────────────────────────────────────────────

async function uploadPhoto(sb, entityType, slug, buf) {
  const ext = (buf[0] === 0x89 && buf[1] === 0x50) ? 'png' : 'jpeg';
  // Sottocartella dedicata (non "pcs/"): stessa convenzione di storage delle
  // foto PCS/ciclismo.info ma marcata per fonte, per non confondere origini
  // diverse quando si guarda lo storage a mano.
  const storagePath = `${entityType}s/firstcycling/${slug}.${ext}`;
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
  const ids = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('entity_overrides')
      .select('entity_id').eq('entity_type', entityType).eq('field', field)
      .not('new_value', 'is', null).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) ids.add(r.entity_id);
    if (data.length < PAGE) break;
  }
  return ids;
}

// ─── Main ────────────────────────────────────────────────────────────────

let gotoPcsPage, humanDelay, launchBrowser;

(async () => {
  ({ gotoPcsPage, humanDelay, launchBrowser } = require('./pcs-browser'));

  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });

  console.log('=== Import foto Juniores da FirstCycling.com ===\n');

  // 1. Atleti Juniores unici da tutte le categorie JUN_M/JUN_F
  const athMap = new Map();
  const teamMap = new Map(); // team_id -> {team_id, team_nome}
  for (const cat of ATH_CATS) {
    const file = path.join(RANK_DIR, `${cat}.json`);
    if (!fs.existsSync(file)) { console.log(`Mancante: ${cat}.json`); continue; }
    for (const a of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (a.atleta_id && !athMap.has(a.atleta_id)) athMap.set(a.atleta_id, a);
      if (a.team_id && !teamMap.has(a.team_id)) teamMap.set(a.team_id, { team_id: a.team_id, team_nome: a.team_nome });
    }
  }
  let athletes = SINGLE_ID
    ? [...athMap.values()].filter(a => a.atleta_id === SINGLE_ID)
    : [...athMap.values()];
  let teams = [...teamMap.values()];

  console.log(`${athletes.length} atleti Juniores unici, ${teams.length} team Juniores unici\n`);

  // 2. Riusa il browser/anti-bot già collaudato per PCS (stessa sfida
  //    Cloudflare Turnstile, stessa attesa paziente di un click umano nella
  //    finestra visibile — vedi commento in cima al file), ma puntato su
  //    FirstCycling fin dall'inizio per i cookie di sessione.
  console.log('Avvio sessione FirstCycling…');
  const { browser, page } = await launchBrowser('https://firstcycling.com/');
  try {
    await gotoPcsPage(page, 'https://firstcycling.com/', { readySelector: 'body', onLog: m => console.log(m) });
  } catch (e) { console.log(`Avviso FirstCycling: ${e.message}`); }
  console.log('Pronto.\n');

  let donePhoto = 0, notFound = 0, noImage = 0, errors = 0;

  // ── ATLETI ────────────────────────────────────────────────────────────
  if (!TEAMS_ONLY) {
    console.log('── ATLETI ──────────────────────────────────────');
    const withPhoto = FORCE ? new Set() : await getExistingIds(sb, 'atleta', 'photo_url');
    let toProcess = athletes.filter(a => !withPhoto.has(a.atleta_id));
    if (LIMIT) toProcess = toProcess.slice(0, LIMIT);
    console.log(`${athletes.length - toProcess.length} già con foto (da qualsiasi fonte) — ${toProcess.length} da cercare\n`);

    for (let i = 0; i < toProcess.length; i++) {
      const ath = toProcess[i];
      process.stdout.write(`(${i + 1}/${toProcess.length}) ${ath.cognome} ${ath.nome} … `);

      const riderId = await searchFcRider(page, ath, m => process.stdout.write('\n' + m));
      if (!riderId) { process.stdout.write('non trovato su FirstCycling\n'); notFound++; await humanDelay(i); continue; }

      const result = await fetchRiderPhotoByProfileUrl(page, `https://firstcycling.com/rider.php?riderid=${riderId}`,
        m => process.stdout.write('\n' + m));
      if (result.noImageFound) {
        process.stdout.write(`profilo trovato ma nessuna immagine plausibile (riderid=${riderId}) — selettore da rivedere\n`);
        noImage++; await humanDelay(i); continue;
      }
      if (!result.photo) { process.stdout.write('nessuna foto valida\n'); notFound++; await humanDelay(i); continue; }

      try {
        const photo_url = await uploadPhoto(sb, 'atleta', normalizeStr(`${ath.nome}-${ath.cognome}`), result.photo);
        await upsertOverrides(sb, 'atleta', ath.atleta_id, { photo_url });
        process.stdout.write(`✓ 📷 (${result.strategy})\n`);
        donePhoto++;
      } catch (e) { process.stdout.write(`ERRORE DB: ${e.message}\n`); errors++; }

      await humanDelay(i);
    }
    console.log(`\nAtleti — ✅ ${donePhoto}  ❓ non trovati ${notFound}  ⚠ senza immagine ${noImage}  ❌ ${errors}\n`);
  }

  // ── TEAM ──────────────────────────────────────────────────────────────
  if (!ATHLETES_ONLY) {
    console.log('── TEAM ────────────────────────────────────────');
    let teamDone = 0, teamNotFound = 0, teamNoImage = 0, teamErrors = 0;
    const withLogo = FORCE ? new Set() : await getExistingIds(sb, 'team', 'photo_url');
    let toProcessTeams = teams.filter(t => !withLogo.has(t.team_id));
    if (LIMIT) toProcessTeams = toProcessTeams.slice(0, LIMIT);
    console.log(`${teams.length - toProcessTeams.length} già con logo — ${toProcessTeams.length} da cercare\n`);

    for (let i = 0; i < toProcessTeams.length; i++) {
      const team = toProcessTeams[i];
      process.stdout.write(`(${i + 1}/${toProcessTeams.length}) ${team.team_nome} … `);

      const teamUrl = await searchFcTeam(page, team, m => process.stdout.write('\n' + m));
      if (!teamUrl) { process.stdout.write('non trovato su FirstCycling\n'); teamNotFound++; await humanDelay(i); continue; }

      const result = await fetchTeamPhotoByProfileUrl(page, teamUrl, m => process.stdout.write('\n' + m));
      if (result.noImageFound) {
        process.stdout.write(`pagina trovata ma nessuna immagine plausibile (${teamUrl}) — selettore da rivedere\n`);
        teamNoImage++; await humanDelay(i); continue;
      }
      if (!result.photo) { process.stdout.write('nessun logo valido\n'); teamNotFound++; await humanDelay(i); continue; }

      try {
        const photo_url = await uploadPhoto(sb, 'team', normalizeStr(team.team_nome), result.photo);
        await upsertOverrides(sb, 'team', team.team_id, { photo_url });
        process.stdout.write(`✓ 📷 (${result.strategy})\n`);
        teamDone++;
      } catch (e) { process.stdout.write(`ERRORE DB: ${e.message}\n`); teamErrors++; }

      await humanDelay(i);
    }
    console.log(`\nTeam — ✅ ${teamDone}  ❓ non trovati ${teamNotFound}  ⚠ senza immagine ${teamNoImage}  ❌ ${teamErrors}\n`);
  }

  await browser.close();
  console.log('=== Completato ===');
})().catch(e => { console.error(e); process.exit(1); });
