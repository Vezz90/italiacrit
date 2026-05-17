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

// Necessario su alcune reti aziendali con catena SSL personalizzata
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs   = require('fs');
const path = require('path');

// ── CONFIGURAZIONE CANALI ────────────────────────────────────────────────────
// Per ogni canale: handle YouTube o URL diretto
const CHANNELS = [
  { name: 'CiclismoWeb',   handle: '@ciclismoweb' },
  { name: 'CiclismoLive',  handle: '@CiclismoLive' },
  { name: 'ToscanaSprint', handle: '@ToscanasprintIt' },
  // Pianeta Ciclismo — cerca il canale e aggiorna con il channel_id corretto
  // { name: 'PianetaCiclismo', channelId: 'UC...' },
];

// Finestra temporale: il video può uscire da N giorni prima a M giorni dopo la gara
const DAYS_BEFORE = 1;
const DAYS_AFTER  = 7;

// Soglia minima di similarity (0–1) per accettare un match
const MIN_SCORE = 0.42;

// Parole da ignorare nel matching
const STOPWORDS = new Set([
  'di','del','della','dello','dei','delle','degli',
  'il','la','lo','i','le','gli','un','una','uno',
  'e','ed','o','in','a','da','su','per','con','tra','fra',
  'gara','corsa','ciclismo','ciclistica','ciclistico',
  'campionato','trofeo','coppa','gran','premio','gp',
  'highlights','highlight','video','live','diretta',
  'italia','italiano','italiana','italiani','italiane',
  '2024','2025','2026','2027',
  'uomini','donne','maschile','femminile',
  'esordienti','allievi','juniores','elite','under23','u23',
]);

// ── UTILITY ─────────────────────────────────────────────────────────────────

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // rimuovi accenti
    .replace(/[^a-z0-9\s]/g, ' ')                       // solo lettere e numeri
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

// Percentuale di parole della gara che compaiono nel titolo video
function coverageScore(raceName, videoTitle) {
  const raceWords = tokenize(raceName);
  if (raceWords.length === 0) return 0;
  const videoNorm = normalize(videoTitle);
  let found = 0;
  for (const w of raceWords) {
    if (videoNorm.includes(w)) found++;
  }
  return found / raceWords.length;
}

function dateDiffDays(dateStr1, dateStr2) {
  return Math.round((new Date(dateStr1) - new Date(dateStr2)) / 86400000);
}

// ── YOUTUBE ─────────────────────────────────────────────────────────────────

async function resolveChannelId(handle) {
  // Risolve @handle → channel_id leggendo la pagina del canale
  const url = `https://www.youtube.com/${handle}`;
  const res  = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'it-IT,it;q=0.9',
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
  const html = await res.text();

  // Cerca channelId nel JSON embedded di YouTube
  let m = html.match(/"channelId"\s*:\s*"(UC[^"]+)"/);
  if (m) return m[1];

  // Fallback: cerca nella meta tag og:url
  m = html.match(/youtube\.com\/channel\/(UC[^"&\s]+)/);
  if (m) return m[1];

  throw new Error(`channel_id non trovato per ${handle}`);
}

function parseRSS(xml) {
  const videos = [];
  // Estrai ogni <entry> dal feed RSS di YouTube
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
      description:  decodeXML(descRaw || '').slice(0, 500),
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
  const res = await fetch(rssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml    = await res.text();
  const videos = parseRSS(xml);
  return videos.map(v => ({ ...v, channel: channel.name, channel_id: channelId }));
}

// ── MATCHING ─────────────────────────────────────────────────────────────────

function matchVideoToRaces(video, calendar) {
  const pubDate = video.published_at;
  if (!pubDate) return null;

  let bestScore = -1;
  let bestRace  = null;

  for (const race of calendar) {
    if (!race.data) continue;

    // Filtro temporale: il video deve uscire entro DAYS_BEFORE…DAYS_AFTER dalla gara
    const diff = dateDiffDays(pubDate, race.data);
    if (diff < -DAYS_BEFORE || diff > DAYS_AFTER) continue;

    // Score = combinazione Jaccard e coverage
    const j = jaccardScore(race.nome, video.title);
    const c = coverageScore(race.nome, video.title);
    const score = Math.max(j, c * 0.9); // coverage pesata leggermente meno

    if (score > bestScore) {
      bestScore = score;
      bestRace  = race;
    }
  }

  if (bestScore >= MIN_SCORE) {
    return { race: bestRace, score: Math.round(bestScore * 100) / 100 };
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

  // Carica video già salvati (per non perdere match manuali)
  let existing = {};
  if (fs.existsSync(outputPath)) {
    existing = JSON.parse(fs.readFileSync(outputPath));
  }

  const result = { ...existing };
  let newMatches = 0;
  let totalVideos = 0;

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
      console.log(`  "${video.title}" (${video.published_at})`);
      const match = matchVideoToRaces(video, calendar);

      if (match) {
        const { race, score } = match;
        console.log(`    → MATCH [${score}] ${race.id}`);

        if (!result[race.id]) result[race.id] = [];

        // Evita duplicati per URL
        const alreadyIn = result[race.id].some(v => v.url === video.url);
        if (!alreadyIn) {
          result[race.id].push({
            url:          video.url,
            title:        video.title,
            description:  video.description,
            channel:      video.channel,
            published_at: video.published_at,
            score,
          });
          newMatches++;
        }
      } else {
        console.log(`    → nessuna gara corrispondente`);
      }
    }
  }

  // Ordina i video di ogni gara per score decrescente
  for (const gid of Object.keys(result)) {
    result[gid].sort((a, b) => b.score - a.score);
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n✅ Completato: ${totalVideos} video analizzati, ${newMatches} nuovi match`);
  console.log(`   → data/videos.json aggiornato (${Object.keys(result).length} gare con video)`);
}

main().catch(e => { console.error(e); process.exit(1); });
