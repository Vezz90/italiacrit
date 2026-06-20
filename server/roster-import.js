'use strict';
/**
 * Roster import da ProCyclingStats
 *
 * Per ogni team nel sistema che ha già uno slug PCS:
 *  - visita la pagina team su PCS per l'anno corrente
 *  - estrae tutti i corridori elencati (ELI/U23/JUN — PCS non include Allievi/Esordienti)
 *  - i corridori già nel sistema vengono saltati (run-import.js li gestisce)
 *  - i corridori nuovi vengono aggiunti a data/extra_roster.json e la loro foto viene importata
 *
 * Uso:
 *   $env:SUPABASE_SECRET = "..."
 *   node roster-import.js [--force] [--team-id=ID]
 *
 *   --force        reimporta anche chi ha già la foto
 *   --team-id=X   processa solo quel team
 */

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL    = 'https://aqqsstsbgpapzoxllosh.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
if (!SUPABASE_SECRET) { console.error('Imposta $env:SUPABASE_SECRET'); process.exit(1); }

const args       = process.argv.slice(2);
const FORCE      = args.includes('--force');
const SINGLE_TID = (args.find(a => a.startsWith('--team-id=')) || '').split('=')[1] || null;
const YEAR       = new Date().getFullYear();

const DATA_DIR  = path.join(__dirname, '..', 'data');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function makeAtletaId(cognome, nome) {
  return (normalizeStr(cognome) + '_' + normalizeStr(nome)).toUpperCase().replace(/-/g, '_');
}

// ─── PCS ──────────────────────────────────────────────────────────────────────

async function extractSocialsFromPage(page) {
  return page.evaluate(() => {
    const result = {};
    for (const a of document.querySelectorAll('a[href]')) {
      const h = (a.href || '').replace(/\/$/, '');
      if (!result.instagram && /instagram\.com\/(?!p\/|reel\/)[^/?"#]+/.test(h)) result.instagram = h;
      if (!result.twitter   && /(twitter\.com|x\.com)\/(?!i\/)[^/?"#]+/.test(h)) result.twitter = h;
      if (!result.strava    && /strava\.com\/(athletes|clubs)\/[^?"#]+/.test(h)) result.strava = h;
      if (!result.facebook  && /facebook\.com\/(?!sharer)[^/?"#]+/.test(h)) result.facebook = h;
    }
    return result;
  }).catch(() => ({}));
}

// Visita la pagina team PCS e restituisce la lista corridori
async function extractTeamRiders(page, teamId, teamNome) {
  const urls = [
    `https://www.procyclingstats.com/team/${normalizeStr(teamNome)}-${YEAR}`,
    `https://www.procyclingstats.com/team/${normalizeStr(teamNome)}/${YEAR}`,
    `https://www.procyclingstats.com/team/${normalizeStr(teamId)}-${YEAR}`,
  ];

  for (const url of urls) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); }
    catch { continue; }
    if (page.url().includes('pagenotfound') || page.url().includes('404')) continue;

    await sleep(900);

    const riders = await page.evaluate(() => {
      const found = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/^\/rider\/([a-z0-9-]+)$/);
        if (!m) continue;
        const slug = m[1];
        const name = (a.textContent || '').trim();
        if (!name || found.some(r => r.slug === slug)) continue;
        found.push({ slug, name });
      }
      return found;
    }).catch(() => []);

    if (riders.length) return { riders, url: page.url() };
  }

  return { riders: [] };
}

// Visita il profilo PCS di un corridore
async function fetchRiderProfile(page, slug) {
  try {
    await page.goto(`https://www.procyclingstats.com/rider/${slug}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { return { notFound: true }; }

  if (page.url().includes('pagenotfound') || page.url().includes('404'))
    return { notFound: true };

  await page.evaluate(() => window.scrollTo(0, 200)).catch(() => {});
  await sleep(800);

  // Estrai nome, cognome, anno nascita, nazionalità dalla pagina
  const info = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const fullName = h1 ? h1.textContent.trim() : null;

    // Anno di nascita (es. "Born on 15 March 2004")
    const born = [...document.querySelectorAll('li, p, span, div')]
      .map(el => el.textContent.trim())
      .find(t => /born on/i.test(t) || /\b(19|20)\d{2}\b/.test(t) && /born|nac|nat/i.test(t));
    const yearMatch = born ? born.match(/\b(19|20)\d{2}\b/) : null;
    const birthYear = yearMatch ? parseInt(yearMatch[0]) : null;

    // Genere: PCS ha pagine /rider/ per maschi, /rider-women/ per donne
    // ma molte donne sono su /rider/ — proviamo a capire dall'URL
    const isFemale = location.pathname.includes('women') ||
      document.querySelector('meta[content*="women"]') != null;

    return { fullName, birthYear, isFemale };
  }).catch(() => ({ fullName: null, birthYear: null, isFemale: false }));

  // Foto
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
  return { ...info, photo, socials };
}

// Inferisce la categoria da anno di nascita
function inferCategoria(birthYear, isFemale) {
  if (!birthYear) return isFemale ? 'ELI_F' : 'ELI_M';
  const age = YEAR - birthYear;
  const suffix = isFemale ? '_F' : '_M';
  if (age <= 18) return `JUN${suffix}`;
  if (age <= 22) return `ELI${suffix}`; // U23 = ELI nel nostro sistema
  return `ELI${suffix}`;
}

// Dividi nome PCS "Firstname Lastname" → { nome, cognome }
function splitPcsName(fullName) {
  if (!fullName) return { nome: '', cognome: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { nome: parts[0], cognome: '' };
  // PCS: "COGNOME Nome" o "Nome COGNOME" — le parole all-caps sono il cognome
  const upper = parts.filter(p => p === p.toUpperCase() && /[A-Z]{2,}/.test(p));
  if (upper.length) {
    const cognome = upper.join(' ');
    const nome = parts.filter(p => !upper.includes(p)).join(' ') || parts[0];
    return { nome, cognome };
  }
  // Fallback: ultimo pezzo = cognome
  return { nome: parts.slice(0, -1).join(' '), cognome: parts[parts.length - 1] };
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

async function uploadPhoto(sb, slug, buf) {
  const ext = (buf[0] === 0x89 && buf[1] === 0x50) ? 'png' : 'jpeg';
  const storagePath = `atletas/pcs/${slug}.${ext}`;
  const { error } = await sb.storage.from('photos')
    .upload(storagePath, buf, { contentType: `image/${ext}`, upsert: true });
  if (error) throw error;
  return `/photos/${storagePath}`;
}

async function upsertOverrides(sb, entityId, fields) {
  const rows = Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([field, new_value]) => ({
      entity_type: 'atleta', entity_id: entityId, field, new_value, edited_by: null
    }));
  if (!rows.length) return;
  const { error } = await sb.from('entity_overrides')
    .upsert(rows, { onConflict: 'entity_type,entity_id,field' });
  if (error) throw error;
}

async function getTeamSlugs(sb) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id, new_value')
    .eq('entity_type', 'team')
    .eq('field', 'pcs_slug')
    .not('new_value', 'is', null)
    .limit(2000);
  return new Map((data || []).map(r => [r.entity_id, r.new_value]));
}

async function getExistingPhotoIds(sb) {
  const { data } = await sb.from('entity_overrides')
    .select('entity_id')
    .eq('entity_type', 'atleta')
    .eq('field', 'photo_url')
    .not('new_value', 'is', null)
    .limit(5000);
  return new Set((data || []).map(r => r.entity_id));
}

// ─── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  const { chromium } = require('playwright');

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET, { realtime: { transport: ws } });
  console.log(`=== Roster Import da PCS [${YEAR}] ===\n`);

  // Carica atleti già nel sistema (da athletes.json)
  const athletesFile = path.join(DATA_DIR, 'athletes.json');
  const athletesExisting = fs.existsSync(athletesFile)
    ? JSON.parse(fs.readFileSync(athletesFile, 'utf8'))
    : {};

  // Nomi normalizzati degli atleti esistenti per matching
  const existingByNorm = new Map();
  for (const [id, ath] of Object.entries(athletesExisting)) {
    const norm = normalizeStr((ath.cognome || '') + ' ' + (ath.nome || ''));
    existingByNorm.set(norm, id);
  }

  // Carica extra_roster.json (atleti manuali/PCS già aggiunti)
  const rosterFile = path.join(DATA_DIR, 'extra_roster.json');
  const extraRoster = fs.existsSync(rosterFile)
    ? JSON.parse(fs.readFileSync(rosterFile, 'utf8'))
    : {};

  // ID già presenti in extra_roster
  const existingRosterIds = new Set();
  for (const entry of Object.values(extraRoster)) {
    for (const a of (entry.atleti || [])) {
      if (a.atleta_id) existingRosterIds.add(a.atleta_id);
    }
  }

  // Carica teams
  const teamsFile = path.join(DATA_DIR, 'teams.json');
  const allTeams = Object.values(JSON.parse(fs.readFileSync(teamsFile, 'utf8')));

  // Slug PCS per team (da entity_overrides)
  const teamPcsSlugs = await getTeamSlugs(sb);

  // Atleti già con foto in Supabase
  const withPhoto = FORCE ? new Set() : await getExistingPhotoIds(sb);

  // Filtra team
  let teams = allTeams.filter(t => t.id && t.nome);
  if (SINGLE_TID) teams = teams.filter(t => t.id === SINGLE_TID);

  console.log(`${teams.length} team da processare\n`);

  // Browser
  const bravePaths = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Users\\vezza\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env.LOCALAPPDATA || '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  const bravePath = bravePaths.find(p => fs.existsSync(p));
  let browser;
  if (bravePath) {
    try { browser = await chromium.launch({ executablePath: bravePath, headless: false, args: ['--no-sandbox'] }); }
    catch { /* fallback */ }
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
  await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 })
    .catch(e => console.log(`Avviso PCS: ${e.message}`));
  await sleep(2500);
  console.log('Pronto.\n');

  let totalNew = 0, totalPhotos = 0, totalErrors = 0;

  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];
    console.log(`\n[${ti+1}/${teams.length}] ${team.nome}`);

    // Trova slug PCS per questo team
    const pcsSlug = teamPcsSlugs.get(team.id)
      || `${normalizeStr(team.nome)}-${YEAR}`;

    const { riders } = await extractTeamRiders(page, team.id, team.nome);
    if (!riders.length) {
      console.log('  → nessun corridore trovato su PCS');
      continue;
    }
    console.log(`  → ${riders.length} corridori trovati su PCS`);

    // Prepara entry in extra_roster per questo team
    if (!extraRoster[team.id]) {
      extraRoster[team.id] = { nome: team.nome, atleti: [] };
    }

    let newInTeam = 0;

    for (const rider of riders) {
      // Controlla se già esiste in athletes.json (per slug PCS o per nome)
      const normName = normalizeStr(rider.name);
      const existingId = existingByNorm.get(normName);

      if (existingId) {
        // Già nel sistema: importa la foto se mancante (delegato a run-import.js di solito)
        if (!withPhoto.has(existingId)) {
          process.stdout.write(`  [esistente] ${rider.name} — foto mancante, importo… `);
          const profile = await fetchRiderProfile(page, rider.slug);
          if (profile.photo) {
            try {
              const photoUrl = await uploadPhoto(sb, rider.slug, profile.photo);
              const fields = { pcs_slug: rider.slug, photo_url: photoUrl };
              if (profile.socials?.instagram) fields.instagram_url = profile.socials.instagram;
              if (profile.socials?.twitter)   fields.twitter_url   = profile.socials.twitter;
              if (profile.socials?.strava)     fields.strava_url    = profile.socials.strava;
              await upsertOverrides(sb, existingId, fields);
              process.stdout.write('✓ 📷\n');
              withPhoto.add(existingId);
              totalPhotos++;
            } catch(e) {
              process.stdout.write(`ERRORE: ${e.message}\n`);
              totalErrors++;
            }
          } else {
            process.stdout.write('nessuna foto\n');
          }
          await sleep(300);
        }
        continue;
      }

      // Genera ID atleta
      const { nome: parsedNome, cognome: parsedCognome } = splitPcsName(rider.name);
      const atletaId = makeAtletaId(parsedCognome || rider.slug, parsedNome);

      // Controlla se già in extra_roster
      if (existingRosterIds.has(atletaId)) {
        if (!withPhoto.has(atletaId) && !FORCE) continue; // ha già la foto, salta
      }

      process.stdout.write(`  [NUOVO] ${rider.name} (${atletaId}) — `);

      // Scarica profilo PCS
      const profile = await fetchRiderProfile(page, rider.slug);
      if (profile.notFound) {
        process.stdout.write('profilo non trovato\n');
        continue;
      }

      const categoria = inferCategoria(profile.birthYear, profile.isFemale);
      const genere = profile.isFemale ? 'F' : 'M';

      // Aggiungi a extra_roster se non già presente
      if (!existingRosterIds.has(atletaId)) {
        extraRoster[team.id].atleti.push({
          atleta_id: atletaId,
          nome: parsedNome,
          cognome: parsedCognome,
          categoria,
          genere,
          pcs_slug: rider.slug,
        });
        existingRosterIds.add(atletaId);

        // Aggiorna mappa per evitare duplicati nel giro stesso
        existingByNorm.set(normalizeStr(rider.name), atletaId);
        newInTeam++;
        totalNew++;
      }

      // Importa foto + social
      const fields = { pcs_slug: rider.slug };
      if (profile.photo && (!withPhoto.has(atletaId) || FORCE)) {
        try {
          fields.photo_url = await uploadPhoto(sb, rider.slug, profile.photo);
          withPhoto.add(atletaId);
          totalPhotos++;
        } catch(e) {
          process.stdout.write(`ERRORE foto: ${e.message} `);
          totalErrors++;
        }
      }
      if (profile.socials?.instagram) fields.instagram_url = profile.socials.instagram;
      if (profile.socials?.twitter)   fields.twitter_url   = profile.socials.twitter;
      if (profile.socials?.strava)     fields.strava_url    = profile.socials.strava;

      try {
        await upsertOverrides(sb, atletaId, fields);
        const tags = [
          fields.photo_url    ? '📷' : '',
          fields.instagram_url? 'IG' : '',
          fields.twitter_url  ? 'TW' : '',
          fields.strava_url   ? 'ST' : '',
        ].filter(Boolean).join(' ') || '—';
        process.stdout.write(`✓ ${tags} cat:${categoria}\n`);
      } catch(e) {
        process.stdout.write(`ERRORE DB: ${e.message}\n`);
        totalErrors++;
      }

      await sleep(300);
    }

    if (newInTeam) {
      console.log(`  → ${newInTeam} nuovi aggiunti al roster`);
    }
  }

  await browser.close();

  // Salva extra_roster.json aggiornato
  fs.writeFileSync(rosterFile, JSON.stringify(extraRoster, null, 2), 'utf8');
  console.log(`\n✅ extra_roster.json aggiornato`);
  console.log(`=== Completato — ${totalNew} nuovi atleti, ${totalPhotos} foto, ${totalErrors} errori ===`);
})();
