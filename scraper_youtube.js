#!/usr/bin/env node
/**
 * scraper_youtube.js
 * Recupera video dai canali YouTube di ciclismo italiano e li abbina
 * alle gare del calendario usando similarity testuale + finestra temporale.
 *
 * Uso:  node scraper_youtube.js
 * Output: data/videos.json
 */

'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs   = require('fs');
const path = require('path');

// ── CONFIGURAZIONE CANALI ────────────────────────────────────────────────────
const CHANNELS = [
  { name: 'CiclismoWeb',    handle: '@ciclismoweb' },
  { name: 'CiclismoLive',   handle: '@CiclismoLive' },
  { name: 'ToscanaSprint',  handle: '@ToscanasprintIt' },
  { name: 'BetaCycling',    handle: '@BetaCycling' },
  { name: 'Tuttobiciweb',   handle: '@tuttobiciweb' },
];

// Finestra temporale: il video può uscire da N giorni prima a M giorni dopo la gara
const DAYS_BEFORE = 2;   // dirette pre-gara o live
const DAYS_AFTER  = 14;  // highlights e rassegne possono uscire anche 2 settimane dopo

// Soglia minima di similarity per accettare un match
// Due soglie: se sia Jaccard SIA coverage superano MIN_SCORE_SOFT → ok
//             altrimenti serve MIN_SCORE_HARD (più selettivo)
const MIN_SCORE_SOFT = 0.38;
const MIN_SCORE_HARD = 0.52;

// Parole da ignorare nel matching
const STOPWORDS = new Set([
  'di','del','della','dello','dei','delle','degli',
  'il','la','lo','i','le','gli','un','una','uno',
  'e','ed','o','in','a','da','su','per','con','tra','fra',
  'al','ai','alla','alle','alle','agli',
  'gara','corsa','ciclismo','ciclistica','ciclistico',
  'campionato','trofeo','coppa','gran','premio','gp',
  'highlights','highlight','video','live','diretta','streaming',
  'italia','italiano','italiana','italiani','italiane',
  'uomini','donne','maschile','femminile',
  'esordienti','allievi','juniores','elite','under23','u23',
  '2024','2025','2026','2027',
  'stage','tappa','giro','tour','race',
]);

// ── UTILITY ─────────────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // rimuovi accenti
    .replace(/[°^ª]/g, '')                             // rimuovi simboli edizione
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str) {
  return normalize(str)
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function jaccardScore(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) { if (sb.has(w)) inter++; }
  return inter / (sa.size + sb.size - inter);
}

// Percentuale di token della gara trovati nel testo del video
function coverageScore(raceName, text) {
  const raceWords = tokenize(raceName);
  if (raceWords.length === 0) return 0;
  const normText = normalize(text);
  let found = 0;
  for (const w of raceWords) {
    if (normText.includes(w)) found++;
  }
  return found / raceWords.length;
}

// Estrai il numero di edizione dal testo (es. "50°", "76^", "32°", "109^")
function extractEdition(str) {
  const m = normalize(str).match(/\b(\d{1,3})\s*(?:esima|esimo|a|o)?\b/);
  return m ? parseInt(m[1]) : null;
}

function dateDiffDays(dateStr1, dateStr2) {
  return Math.round((new Date(dateStr1) - new Date(dateStr2)) / 86400000);
}

// ── YOUTUBE ─────────────────────────────────────────────────────────────────

async function resolveChannelId(handle) {
  const url = `https://www.youtube.com/${handle}`;
  const res  = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'it-IT,it;q=0.9',
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
  const html = await res.text();

  let m = html.match(/"channelId"\s*:\s*"(UC[^"]+)"/);
  if (m) return m[1];
  m = html.match(/youtube\.com\/channel\/(UC[^"&\s]+)/);
  if (m) return m[1];
  throw new Error(`channel_id non trovato per ${handle}`);
}

function parseRSS(xml) {
  const videos = [];
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  for (const entry of entries) {
    const videoId   = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)  || [])[1];
    const title     = (entry.match(/<title>([^<]+)<\/title>/)             || [])[1];
    const published = (entry.match(/<published>([^<]+)<\/published>/)     || [])[1];
    const descRaw   = (entry.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1];
    if (!videoId || !title) continue;
    videos.push({
      url:          `https://www.youtube.com/watch?v=${videoId}`,
      title:        decodeXML(title),
      description:  decodeXML(descRaw || '').slice(0, 600),
      published_at: published ? published.split('T')[0] : '',
    });
  }
  return videos;
}

function decodeXML(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchChannelVideos(channel) {
  let channelId = channel.channelId;
  if (!channelId && channel.handle) {
    console.log(`  Risolvo channel_id per ${channel.handle}...`);
    channelId = await resolveChannelId(channel.handle);
    console.log(`  → ${channelId}`);
  }
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml    = await res.text();
  const videos = parseRSS(xml);
  return videos.map(v => ({ ...v, channel: channel.name, channel_id: channelId }));
}

// ── CATEGORY DETECTION ───────────────────────────────────────────────────────

// Mappa keyword titolo video → nomi categoria del calendario
const CAT_KEYWORDS = [
  { kw: ['juniores', 'junior'],        cats: ['Juniores'] },
  { kw: ['allievi', 'allievo'],        cats: ['Allievi'] },
  { kw: ['esordienti', 'esordiente'],  cats: ['Esordienti'] },
  { kw: ['under23', 'u23'],            cats: ['Under 23', 'Elite e Under 23'] },
  { kw: ['elite'],                      cats: ['Elite', 'Elite e Under 23'] },
  { kw: ['donne', 'femmin'],           cats: ['Donne'] },
];

/**
 * Estrae le categorie menzionate nel titolo del video.
 * Restituisce un array di nomi categoria (formato calendario), può essere vuoto.
 */
function extractVideoCategories(title) {
  const norm = normalize(title);
  const found = [];
  for (const { kw, cats } of CAT_KEYWORDS) {
    if (kw.some(k => norm.includes(k))) found.push(...cats);
  }
  return [...new Set(found)];
}

/**
 * Compatibilità categoria video ↔ voce calendario.
 *  1 = match esplicito   → bonus score
 *  0 = neutro (nessun segnale nel video)
 * -1 = mismatch esplicito → penalità score
 */
function categoryCompat(race, videoCats) {
  if (videoCats.length === 0) return 0;
  const rc = normalize(race.categoria || '');
  for (const vc of videoCats) {
    if (rc.includes(normalize(vc))) return 1;
  }
  return -1;
}

// ── MATCHING ─────────────────────────────────────────────────────────────────

function scoreVideoRace(video, race, videoCats) {
  // Testo completo del video per il matching
  const videoText = `${video.title} ${video.description}`;

  // Score base: Jaccard sul titolo
  const j = jaccardScore(race.nome, video.title);

  // Coverage: quanti token del nome gara compaiono nel titolo video
  const cTitle = coverageScore(race.nome, video.title);

  // Coverage estesa: il testo completo (titolo + descrizione) copre la gara?
  const cFull = coverageScore(race.nome, videoText);

  // Bonus edizione: se entrambi citano lo stesso numero (50°, 76^, ecc.)
  let edBonus = 0;
  const raceEd  = extractEdition(race.nome);
  const videoEd = extractEdition(video.title);
  if (raceEd && videoEd) {
    edBonus = raceEd === videoEd ? 0.15 : -0.10; // penalizza edizioni diverse
  }

  // Bonus città/località: se il calendario ha campo 'citta' o 'localita'
  let cityBonus = 0;
  const city = race.citta || race.localita || race.luogo || '';
  if (city && city.length > 3) {
    const cityNorm = normalize(city).replace(/\s+/g, '');
    const titleNorm = normalize(video.title).replace(/\s+/g, '');
    if (titleNorm.includes(cityNorm) || coverageScore(city, video.title) >= 0.7) cityBonus = 0.10;
  }

  // Bonus/penalità categoria: +0.20 se il video cita la stessa categoria della gara,
  // -0.25 se cita una categoria diversa (es. titolo "Juniores" su voce Allievi)
  const compat   = categoryCompat(race, videoCats);
  const catBonus = compat === 1 ? 0.20 : compat === -1 ? -0.25 : 0;

  // Score finale: combina le metriche
  const base  = Math.max(j, cTitle * 0.88, cFull * 0.65);
  const score = Math.min(1, base + edBonus + cityBonus + catBonus);

  return { score, j, cTitle, cFull, compat };
}

/**
 * Trova le voci del calendario che corrispondono al video.
 * Restituisce un ARRAY (vuoto se nessun match).
 *
 * Logica multi-categoria:
 *  - video senza segnale categoria → singolo best match (comportamento classico)
 *  - video con categoria esplicita → solo le voci con categoria compatibile
 *  - video con più categorie (es. "Allievi e Juniores") → una voce per categoria
 *    → lo stesso video finirà in più race_id il giorno stesso
 */
function matchVideoToRaces(video, calendar) {
  const pubDate = video.published_at;
  if (!pubDate) return [];

  const videoCats = extractVideoCategories(video.title);
  const candidates = [];

  for (const race of calendar) {
    if (!race.data) continue;
    const diff = dateDiffDays(pubDate, race.data);
    if (diff < -DAYS_BEFORE || diff > DAYS_AFTER) continue;

    const { score, j, cTitle, cFull, compat } = scoreVideoRace(video, race, videoCats);

    // Accetta solo se supera la soglia
    const accepted = score >= MIN_SCORE_HARD ||
      (score >= MIN_SCORE_SOFT && j >= 0.18 && cTitle >= 0.28);

    if (accepted) {
      candidates.push({
        race,
        score: Math.round(score * 100) / 100,
        compat,
        debug: { j: j.toFixed(2), cT: cTitle.toFixed(2), cF: cFull.toFixed(2) },
      });
    }
  }

  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.score - a.score);

  // Nessun segnale categoria nel video → best match singolo (classico)
  if (videoCats.length === 0) return [candidates[0]];

  // Segnale categoria presente: preferisci voci con categoria compatibile
  const catMatches = candidates.filter(c => c.compat === 1);
  if (catMatches.length > 0) {
    // Può restituire più voci (es. video "Allievi e Juniores" → 2 race_id)
    return catMatches;
  }

  // Nessuna voce con categoria esplicita compatibile →
  // accetta voci "neutre" (race.categoria assente o non riconoscibile)
  const neutrals = candidates.filter(c => c.compat === 0);
  if (neutrals.length > 0) return [neutrals[0]];

  // Tutto in mismatch categoria → nessun match
  return [];
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const calendarPath = path.join(__dirname, 'data', 'calendar.json');
  const outputPath   = path.join(__dirname, 'data', 'videos.json');

  if (!fs.existsSync(calendarPath)) {
    console.error('ERRORE: data/calendar.json non trovato');
    process.exit(1);
  }
  const calendar = JSON.parse(fs.readFileSync(calendarPath));
  console.log(`Calendario: ${calendar.length} gare caricate`);

  // Carica video già salvati (preserva match manuali e approvazioni)
  let existing = {};
  if (fs.existsSync(outputPath)) {
    existing = JSON.parse(fs.readFileSync(outputPath));
  }

  const result = { ...existing };

  // Strutture per la deduplicazione intelligente:
  //   raceVideoUrls  → { raceId: Set<url> }   evita duplicati nella stessa gara
  //   urlDates       → { url: Set<data> }      traccia su quali DATE un URL è già assegnato
  //                    → stesso URL ammesso in più gare DELLA STESSA DATA (categorie diverse)
  //                    → bloccato se date diverse (eventi completamente distinti)
  const raceVideoUrls = {};
  const urlDates      = {};
  for (const [raceId, vids] of Object.entries(result)) {
    raceVideoUrls[raceId] = new Set(vids.map(v => v.url));
    for (const v of vids) {
      if (!urlDates[v.url]) urlDates[v.url] = new Set();
      // Recupera la data della gara dal calendario, fallback all'id
      const raceEntry = calendar.find(r => r.id === raceId);
      if (raceEntry?.data) urlDates[v.url].add(raceEntry.data);
    }
  }

  let newMatches = 0;
  let totalVideos = 0;
  let skipped = 0;

  for (const channel of CHANNELS) {
    console.log(`\n[${channel.name}] Recupero video...`);
    let videos;
    try {
      videos = await fetchChannelVideos(channel);
    } catch (e) {
      console.error(`  ERRORE: ${e.message}`);
      continue;
    }
    console.log(`  ${videos.length} video trovati`);
    totalVideos += videos.length;

    for (const video of videos) {
      const matches = matchVideoToRaces(video, calendar);

      if (matches.length === 0) {
        // Salta velocemente se l'URL è già noto ovunque
        const alreadyKnown = Object.values(raceVideoUrls).some(s => s.has(video.url));
        if (!alreadyKnown) {
          console.log(`  ✗ nessuna gara per: "${video.title.slice(0,60)}" (${video.published_at})`);
        } else {
          skipped++;
        }
        continue;
      }

      let addedAny = false;
      for (const { race, score, debug } of matches) {
        const url = video.url;

        // 1. Dedup per gara: stesso video non va due volte nella stessa gara
        if (!raceVideoUrls[race.id]) raceVideoUrls[race.id] = new Set();
        if (raceVideoUrls[race.id].has(url)) continue;

        // 2. Dedup cross-evento: stesso URL già assegnato a una gara in data DIVERSA
        //    → significa che è già stato messo in un evento distinto → salta
        if (urlDates[url] && urlDates[url].size > 0 && !urlDates[url].has(race.data)) {
          skipped++;
          continue;
        }

        console.log(`  ✔ [${score}] "${video.title.slice(0,60)}" → ${race.id}`);
        if (debug) console.log(`    j=${debug.j} cT=${debug.cT} cF=${debug.cF}`);

        if (!result[race.id]) result[race.id] = [];
        result[race.id].push({
          url:          url,
          title:        video.title,
          description:  video.description,
          channel:      video.channel,
          published_at: video.published_at,
          score,
        });

        raceVideoUrls[race.id].add(url);
        if (!urlDates[url]) urlDates[url] = new Set();
        urlDates[url].add(race.data);
        newMatches++;
        addedAny = true;
      }

      if (!addedAny) skipped++;
    }
  }

  // Ordina i video di ogni gara per score decrescente
  for (const gid of Object.keys(result)) {
    result[gid].sort((a, b) => (b.score||0) - (a.score||0));
  }

  const today = new Date().toISOString().slice(0, 10);
  const totalRaces = Object.keys(result).length;

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  // Salva i metadati in un file separato (non interferisce con la struttura di videos.json)
  const metaPath = path.join(__dirname, 'data', 'videos_meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({ last_run: today, total_races: totalRaces, new_matches: newMatches }, null, 2));

  console.log(`\n✅ Completato [${today}]: ${totalVideos} video analizzati, ${newMatches} nuovi match, ${skipped} già presenti`);
  console.log(`   → data/videos.json aggiornato (${totalRaces} gare con video)`);

  // Exit code 0 anche se non ci sono nuovi match (GitHub Actions non fallisce)
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
