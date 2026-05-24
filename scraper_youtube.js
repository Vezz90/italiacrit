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
const DAYS_BEFORE = 1;   // al massimo 1 giorno prima (dirette live)
const DAYS_AFTER  = 14;  // highlights e rassegne possono uscire anche 2 settimane dopo

// Soglia minima di similarity per accettare un match
// Due soglie: se sia Jaccard SIA coverage superano MIN_SCORE_SOFT → ok
//             altrimenti serve MIN_SCORE_HARD (più selettivo)
const MIN_SCORE_SOFT = 0.38;
const MIN_SCORE_HARD = 0.52;

// Soglia di auto-pubblicazione: score >= AUTO_APPROVE → va in videos.json
//                               score <  AUTO_APPROVE → va in pending_videos.json (revisione admin)
const SCORE_AUTO_APPROVE = 0.55;

// Base semantica minima prima di applicare il bonus categoria.
// Evita che "memorial X" si abbini a "memorial Y" solo perché entrambi sono Esordienti.
const MIN_BASE_FOR_CAT_BONUS = 0.30;

// Parole da ignorare nel matching.
// IMPORTANTE: parole troppo comuni nei nomi gara (es. "memorial") DEVONO stare qui,
// altrimenti diventano l'unico token condiviso tra gare diverse e causano falsi positivi.
const STOPWORDS = new Set([
  'di','del','della','dello','dei','delle','degli',
  'il','la','lo','i','le','gli','un','una','uno',
  'e','ed','o','in','a','da','su','per','con','tra','fra',
  'al','ai','alla','alle','agli',
  'gara','corsa','ciclismo','ciclistica','ciclistico',
  'campionato','trofeo','coppa','gran','premio','gp',
  // Prefissi generici dei nomi gara — non discriminano tra gare diverse
  'memorial','mem','circuito','cronometro','cro',
  'highlights','highlight','video','live','diretta','streaming',
  'italia','italiano','italiana','italiani','italiane',
  'uomini','donne','maschile','femminile',
  // Categorie — gestite separatamente con CAT_KEYWORDS
  'esordienti','esordiente','allievi','allievo','juniores','junior',
  'elite','under23','u23',
  '2023','2024','2025','2026','2027',
  'stage','tappa','giro','tour','race',
  // Parole generiche nei titoli YouTube
  'risultati','classifica','ordine','arrivo','partenza',
  'anno','edizione','ediz',
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

// Coverage INVERSA: quanti token del titolo video compaiono nel nome gara.
// Utile per nomi gara compositi lunghi (es. "15° MEM. CAVORSO - 23° TR. CROCE AZZURRA"):
// il Jaccard si diluisce con i token extra, ma i token del video ci sono tutti.
function videoTokenCoverage(videoTitle, raceName) {
  const videoWords = tokenize(videoTitle);
  if (videoWords.length === 0) return 0;
  const normRace = normalize(raceName);
  let found = 0;
  for (const w of videoWords) {
    if (normRace.includes(w)) found++;
  }
  return found / videoWords.length;
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

/**
 * Mappa keyword → categorie del calendario.
 * ORDINE IMPORTANTE: le voci più specifiche (1°/2° anno) devono venire PRIMA
 * di quella generica "esordienti", così "esordienti 1° anno" viene riconosciuto
 * come categoria specifica e non solo come generica.
 */
const CAT_KEYWORDS = [
  // Esordienti con anno — più specifici, prima
  { kw: ['esordienti 1', 'esordiente 1', 'primo anno', '1 anno'],
    cats: ['Esordienti 1° anno'] },
  { kw: ['esordienti 2', 'esordiente 2', 'secondo anno', '2 anno'],
    cats: ['Esordienti 2° anno'] },
  // Esordienti generici (nessun anno specificato → entrambi possibili)
  { kw: ['esordienti', 'esordiente'],
    cats: ['Esordienti 1° anno', 'Esordienti 2° anno', 'Esordienti'] },
  { kw: ['juniores', 'junior'],   cats: ['Juniores'] },
  { kw: ['allievi', 'allievo'],   cats: ['Allievi'] },
  { kw: ['under23', 'u23'],       cats: ['Under 23', 'Elite e Under 23'] },
  { kw: ['elite'],                 cats: ['Elite', 'Elite e Under 23'] },
  { kw: ['donne', 'femmin'],      cats: ['Donne'] },
];

/**
 * Estrae le categorie menzionate nel testo del video (titolo + descrizione).
 * Legge ENTRAMBI perché spesso la categoria è scritta solo nella descrizione.
 * Restituisce array di nomi categoria (formato calendario), deduplicato.
 */
function extractVideoCategories(title, description) {
  // Cerca prima nel titolo (più affidabile), poi nella descrizione
  const normTitle = normalize(title || '');
  const normDesc  = normalize((description || '').slice(0, 400)); // primi 400 chars
  const found = [];
  for (const { kw, cats } of CAT_KEYWORDS) {
    const inTitle = kw.some(k => normTitle.includes(normalize(k)));
    const inDesc  = !inTitle && kw.some(k => normDesc.includes(normalize(k)));
    if (inTitle || inDesc) found.push(...cats);
  }
  return [...new Set(found)];
}

/**
 * Compatibilità categoria video ↔ voce calendario.
 *  1 = match (anche parziale/bidirezionale)
 *  0 = neutro — nessun segnale nel video, oppure la gara non ha categoria
 * -1 = mismatch esplicito
 *
 * Usa inclusione bidirezionale per gestire casi come:
 *   race.categoria = "Esordienti 1° anno", videoCat = "Esordienti" → match
 *   race.categoria = "Elite e Under 23",   videoCat = "Elite"       → match
 */
function categoryCompat(race, videoCats) {
  if (videoCats.length === 0) return 0;
  const rc = normalize(race.categoria || '');
  if (!rc) return 0; // gara senza categoria → neutro (non penalizzare)
  for (const vc of videoCats) {
    const vcn = normalize(vc);
    // match se l'uno contiene l'altro (es. "esordienti 1 anno" ⊃ "esordienti")
    if (rc.includes(vcn) || vcn.includes(rc)) return 1;
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

  // Coverage INVERSA: token del titolo video che appaiono nel nome gara.
  // Gestisce nomi gara compositi lunghi dove il Jaccard si diluisce:
  // "Esordienti - Memorial Cavorso" vs "15° MEM. CAVORSO - 23° TR. CROCE AZZURRA..."
  // Jaccard basso (2/9), ma coverage inversa = 100% (entrambi i token del video ci sono)
  const cVideo = videoTokenCoverage(video.title, race.nome);

  // Base semantica (senza bonus).
  // cVideo ha peso 0.78 — leggermente inferiore a cTitle perché un video con
  // titolo breve trova facilmente match parziali in nomi gara lunghi.
  const base = Math.max(j, cTitle * 0.88, cFull * 0.65, cVideo * 0.78);

  // Bonus edizione: se entrambi citano lo stesso numero (50°, 76^, ecc.)
  let edBonus = 0;
  const raceEd  = extractEdition(race.nome);
  const videoEd = extractEdition(video.title);
  if (raceEd && videoEd) {
    edBonus = raceEd === videoEd ? 0.15 : -0.10;
  }

  // Bonus città/località
  let cityBonus = 0;
  const city = race.citta || race.localita || race.luogo || '';
  if (city && city.length > 3) {
    const cityNorm  = normalize(city).replace(/\s+/g, '');
    const titleNorm = normalize(video.title).replace(/\s+/g, '');
    if (titleNorm.includes(cityNorm) || coverageScore(city, video.title) >= 0.7) cityBonus = 0.10;
  }

  // Bonus/penalità categoria.
  // REGOLA CHIAVE: il bonus positivo si applica SOLO se la base semantica è
  // già sufficiente (>= MIN_BASE_FOR_CAT_BONUS). Questo evita che due gare con
  // lo stesso nome generico (es. "Memorial X" e "Memorial Y") si abbinino
  // solo perché hanno la stessa categoria.
  const compat = categoryCompat(race, videoCats);
  let catBonus = 0;
  if (compat === 1 && base >= MIN_BASE_FOR_CAT_BONUS) {
    catBonus = 0.18;   // categoria giusta + base semantica sufficiente
  } else if (compat === -1 && base >= MIN_BASE_FOR_CAT_BONUS) {
    catBonus = -0.22;  // categoria sbagliata (es. video Juniores su gara Allievi)
  }
  // Se base < MIN_BASE_FOR_CAT_BONUS: catBonus rimane 0 (match troppo debole per i bonus)

  const score = Math.min(1, base + edBonus + cityBonus + catBonus);

  return { score, base, j, cTitle, cFull, compat };
}

/**
 * Trova le voci del calendario che corrispondono al video.
 * Restituisce un ARRAY (vuoto se nessun match).
 *
 * Logica:
 *  - il match semantico (nome gara) deve essere sufficientemente buono da solo
 *  - la categoria è un tie-breaker tra match ugualmente buoni, NON un salvatore
 *  - multi-match solo se il video cita esplicitamente categorie DIVERSE
 *    (es. "Allievi e Juniores" → 2 race_id)
 *  - se il video cita solo "Esordienti" generici → best match singolo
 */
function matchVideoToRaces(video, calendar) {
  const pubDate = video.published_at;
  if (!pubDate) return [];

  // Legge categorie da titolo E descrizione
  const videoCats = extractVideoCategories(video.title, video.description);
  const candidates = [];

  for (const race of calendar) {
    if (!race.data) continue;
    const diff = dateDiffDays(pubDate, race.data);
    if (diff < -DAYS_BEFORE || diff > DAYS_AFTER) continue;

    const { score, base, j, cTitle, cFull, compat } = scoreVideoRace(video, race, videoCats);

    // Accetta solo se:
    // 1. La base semantica mostra un minimo di somiglianza reale
    // 2. Lo score finale supera le soglie
    const baseOk   = base >= 0.15; // almeno qualche token in comune
    const scoreOk  = score >= MIN_SCORE_HARD ||
                    (score >= MIN_SCORE_SOFT && j >= 0.18 && cTitle >= 0.28);

    if (baseOk && scoreOk) {
      candidates.push({
        race,
        score: Math.round(score * 100) / 100,
        base:  Math.round(base  * 100) / 100,
        compat,
        debug: { j: j.toFixed(2), cT: cTitle.toFixed(2), cF: cFull.toFixed(2), cV: cVideo.toFixed(2), base: base.toFixed(2) },
      });
    }
  }

  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.score - a.score);

  // Nessun segnale categoria → best match singolo
  if (videoCats.length === 0) return [candidates[0]];

  // Segnale categoria: preferisci voci con categoria compatibile
  const catMatches = candidates.filter(c => c.compat === 1);
  if (catMatches.length > 0) {
    // Multi-match SOLO se il video cita esplicitamente categorie DIVERSE
    // che corrispondono a race_id con categorie diverse.
    // Es: "Allievi e Juniores" → 2 voci distinte
    // Es: "Esordienti" (generico) → solo il best match (non moltiplichiamo le gare)
    if (videoCats.length > 1) {
      const matchedRaceCats = new Set(catMatches.map(c => normalize(c.race.categoria || '')));
      if (matchedRaceCats.size > 1) {
        // Genuino multi-categoria: prendi il miglior match per ogni categoria distinta
        const bestPerCat = {};
        for (const m of catMatches) {
          const rcat = normalize(m.race.categoria || '');
          if (!bestPerCat[rcat] || m.score > bestPerCat[rcat].score) bestPerCat[rcat] = m;
        }
        return Object.values(bestPerCat);
      }
    }
    // Altrimenti (stessa categoria o una sola categoria) → solo il best
    return [catMatches[0]];
  }

  // Nessuna voce con categoria compatibile → best neutro (gara senza categoria)
  const neutrals = candidates.filter(c => c.compat === 0);
  if (neutrals.length > 0) return [neutrals[0]];

  // Tutto in mismatch categoria esplicito → nessun match
  return [];
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const calendarPath  = path.join(__dirname, 'data', 'calendar.json');
  const outputPath    = path.join(__dirname, 'data', 'videos.json');
  const pendingPath   = path.join(__dirname, 'data', 'pending_videos.json');

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

  // Carica pending esistenti — evitiamo di ri-aggiungere URL già in attesa
  let pendingExisting = [];
  if (fs.existsSync(pendingPath)) {
    try { pendingExisting = JSON.parse(fs.readFileSync(pendingPath)); } catch { pendingExisting = []; }
  }
  const pendingUrls = new Set(pendingExisting.map(v => v.url));

  const result      = { ...existing };
  const newPending  = []; // video con score basso da aggiungere al pending

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
      const url = video.url;

      // Salta se già in pending (attesa revisione admin)
      if (pendingUrls.has(url)) { skipped++; continue; }

      const matches = matchVideoToRaces(video, calendar);

      if (matches.length === 0) {
        // Salta velocemente se l'URL è già noto ovunque
        const alreadyKnown = Object.values(raceVideoUrls).some(s => s.has(url));
        if (!alreadyKnown) {
          console.log(`  ✗ nessuna gara per: "${video.title.slice(0,60)}" (${video.published_at})`);
        } else {
          skipped++;
        }
        continue;
      }

      let addedAny = false;
      for (const { race, score, debug } of matches) {

        // 1. Dedup per gara: stesso video non va due volte nella stessa gara
        if (!raceVideoUrls[race.id]) raceVideoUrls[race.id] = new Set();
        if (raceVideoUrls[race.id].has(url)) continue;

        // 2. Dedup cross-evento: stesso URL già assegnato a una gara in data DIVERSA
        //    → significa che è già stato messo in un evento distinto → salta
        if (urlDates[url] && urlDates[url].size > 0 && !urlDates[url].has(race.data)) {
          skipped++;
          continue;
        }

        // 3. Score basso → pending (revisione admin), score alto → auto-pubblica
        if (score < SCORE_AUTO_APPROVE) {
          console.log(`  ⏳ [${score}] "${video.title.slice(0,60)}" → PENDING (${race.id})`);
          if (debug) console.log(`    j=${debug.j} cT=${debug.cT} cF=${debug.cF}`);
          const today = new Date().toISOString().slice(0, 10);
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          newPending.push({
            id,
            gara_id:      race.id,
            cal_id:       race.id,
            type:         'scraper',
            url,
            title:        video.title,
            description:  video.description,
            channel:      video.channel,
            published_at: video.published_at,
            score,
            submitted_by: 'scraper-auto',
            submitted_at: today,
          });
          pendingUrls.add(url);
          // Registra la data per non duplicare cross-evento
          if (!urlDates[url]) urlDates[url] = new Set();
          urlDates[url].add(race.data);
          addedAny = true;
          continue;
        }

        console.log(`  ✔ [${score}] "${video.title.slice(0,60)}" → ${race.id}`);
        if (debug) console.log(`    j=${debug.j} cT=${debug.cT} cF=${debug.cF}`);

        if (!result[race.id]) result[race.id] = [];
        result[race.id].push({
          url,
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

  // Aggiorna pending_videos.json: aggiungi i nuovi video a basso score
  if (newPending.length > 0) {
    const pendingAll = [...pendingExisting, ...newPending];
    fs.writeFileSync(pendingPath, JSON.stringify(pendingAll, null, 2));
    console.log(`\n⏳ ${newPending.length} video a basso score aggiunti a pending_videos.json`);
  }

  // Salva i metadati in un file separato (non interferisce con la struttura di videos.json)
  const metaPath = path.join(__dirname, 'data', 'videos_meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    last_run: today,
    total_races: totalRaces,
    new_matches: newMatches,
    new_pending: newPending.length,
  }, null, 2));

  console.log(`\n✅ Completato [${today}]: ${totalVideos} video analizzati, ${newMatches} auto-pubblicati, ${newPending.length} in attesa revisione, ${skipped} già presenti`);
  console.log(`   → data/videos.json aggiornato (${totalRaces} gare con video)`);

  // Exit code 0 anche se non ci sono nuovi match (GitHub Actions non fallisce)
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
