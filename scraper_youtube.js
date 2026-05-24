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

// ── MATCHING ─────────────────────────────────────────────────────────────────

function scoreVideoRace(video, race) {
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

  // Score finale: combina le metriche
  const base = Math.max(j, cTitle * 0.88, cFull * 0.65);
  const score = Math.min(1, base + edBonus + cityBonus);

  return { score, j, cTitle, cFull };
}

function matchVideoToRaces(video, calendar) {
  const pubDate = video.published_at;
  if (!pubDate) return null;

  let bestScore = -1;
  let bestRace  = null;
  let bestDebug = null;

  for (const race of calendar) {
    if (!race.data) continue;
    const diff = dateDiffDays(pubDate, race.data);
    if (diff < -DAYS_BEFORE || diff > DAYS_AFTER) continue;

    const { score, j, cTitle, cFull } = scoreVideoRace(video, race);

    // Accetta solo se supera la soglia
    // Logica: score ≥ HARD sempre ok; tra SOFT e HARD richiediamo sia j>0.2 che cTitle>0.3
    const accepted = score >= MIN_SCORE_HARD ||
      (score >= MIN_SCORE_SOFT && j >= 0.18 && cTitle >= 0.28);

    if (accepted && score > bestScore) {
      bestScore = score;
      bestRace  = race;
      bestDebug = { j: j.toFixed(2), cT: cTitle.toFixed(2), cF: cFull.toFixed(2) };
    }
  }

  if (bestRace) {
    return { race: bestRace, score: Math.round(bestScore * 100) / 100, debug: bestDebug };
  }
  return null;
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

  // Set globale di URL già presenti — ogni video va in una sola gara
  const globalUrls = new Set();
  for (const vids of Object.values(result)) {
    for (const v of vids) globalUrls.add(v.url);
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
      // Salta se già presente (in qualsiasi gara)
      if (globalUrls.has(video.url)) {
        skipped++;
        continue;
      }

      const match = matchVideoToRaces(video, calendar);
      if (match) {
        const { race, score, debug } = match;
        console.log(`  ✔ [${score}] "${video.title.slice(0,60)}" → ${race.id}`);
        if (debug) console.log(`    j=${debug.j} cT=${debug.cT} cF=${debug.cF}`);

        if (!result[race.id]) result[race.id] = [];
        result[race.id].push({
          url:          video.url,
          title:        video.title,
          description:  video.description,
          channel:      video.channel,
          published_at: video.published_at,
          score,
        });
        globalUrls.add(video.url);
        newMatches++;
      } else {
        console.log(`  ✗ nessuna gara per: "${video.title.slice(0,60)}" (${video.published_at})`);
      }
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
