'use strict';
// Test di parsing per lo storico ciclismo.info — nessuna scrittura, solo
// stampa dati estratti per verifica. Copre entrambi i template HTML visti
// sul sito (tabelle "anni 2000" fino al 2015 circa, Bootstrap dal 2016+).
//
// Uso: node ciclismo-info-test.js <url-scheda-atleta>

const iconv = (() => { try { return require('iconv-lite'); } catch { return null; } })();

async function fetchDecoded(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(await res.arrayBuffer());
  // Pagine in ISO-8859-1/windows-1252 (dichiarato nel <meta charset>) — decodifica
  // esplicita, altrimenti lettere accentate italiane arrivano corrotte.
  if (iconv) return iconv.decode(buf, 'win1252');
  return buf.toString('latin1'); // fallback approssimato se iconv-lite non è installato
}

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&deg;/g, '°').replace(/&agrave;/g, 'à').replace(/&egrave;/g, 'è')
    .replace(/&eacute;/g, 'é').replace(/&igrave;/g, 'ì').replace(/&ograve;/g, 'ò')
    .replace(/&ugrave;/g, 'ù').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '').trim();
}

function parseAthletePage(html, sourceUrl) {
  const idMatch = sourceUrl.match(/scheda_corridore_risultati_gare_(?:tb_)?(\d+)_/);
  const ciclismoId = idMatch ? idMatch[1] : null;

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  // "NOME COGNOME - TEAM (può contenere " - ") - Categoria X - Stagione Y"
  // "Categoria"/"Stagione" sono ancore fisse in coda: il team va preso "greedy"
  // fino a quell'ancora, non con un semplice split(' - ') che spezza gli
  // sponsor multipli tipo "BIESSE - CARRERA - PREMAC" in pezzi separati.
  const titleFull = titleMatch ? decodeEntities(titleMatch[1]) : '';
  const titleRe = /^(.*?)\s-\s(.*)\s-\sCategoria\s(.*?)\s-\sStagione\s(\d{4})\s*$/i;
  const tm = titleFull.match(titleRe);
  const nomeCompleto = tm ? tm[1] : (titleFull.split(' - ')[0] || null);
  const team = tm ? tm[2] : null;
  const categoria = tm ? tm[3] : null;
  const stagione = tm ? tm[4] : null;

  const birthYearMatch = html.match(/<b>([A-ZÀ-Ý' ]+)<\/b>\s*\(( \d{4})\)/) || html.match(/\(\s*(\d{4})\s*\)/);
  const birthDateMatch = html.match(/Nato(?:\s+a\s+[^<]*?)?\s+[Ii]l\s+(\d{1,2}\s+\w+\s+\d{4})/);

  // Anni disponibili (SELEZIONA STAGIONE): utile per sapere fino a dove risalire
  // per questo atleta specifico, invece di tentare a caso ogni anno dal 2007.
  const yearLinks = [...html.matchAll(/scheda_corridore_risultati_gare_(?:tb_)?\d+_[^_]*(?:_[^_]*)*?_(\d{4})\.htm/g)]
    .map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort();

  // I piazzamenti sono raggruppati sotto intestazioni tipo "--- 9 Vittorie ---",
  // "--- 3 Secondi Posti ---" ecc. — la posizione non è nella riga della gara
  // ma va dedotta dall'intestazione del gruppo che la precede.
  const ORDINALI = [
    [/^Vittori/i, 1], [/^Second/i, 2], [/^Terz/i, 3], [/^Quart/i, 4], [/^Quint/i, 5],
    [/^Sest/i, 6], [/^Settim/i, 7], [/^Ottav/i, 8], [/^Non/i, 9], [/^Decim/i, 10],
  ];
  const headerRe = /---\s*\d+\s+([A-Za-zàèéìòù]+)(?:\s+Post[oi])?\s*---/gi;
  const headers = [];
  let hm;
  while ((hm = headerRe.exec(html))) {
    const label = hm[1];
    const found = ORDINALI.find(([re]) => re.test(label));
    headers.push({ index: hm.index, posizione: found ? found[1] : null });
  }
  function posizioneAt(idx) {
    let pos = null;
    for (const h of headers) { if (h.index <= idx) pos = h.posizione; else break; }
    return pos;
  }

  // Piazzamenti: ogni blocco "data - regione ... luogo ... <a href=race>nome gara</a>"
  const rows = [];
  const rowRe = /<b>(\d{4}-\d{2}-\d{2})\s*-\s*([^<]*?)<\/b><\/font>\s*<font[^>]*><b>\s*-?\s*([^<]*?)<\/b><\/font><br>\s*<font[^>]*><b>(?:<a href="([^"]+)"[^>]*>)?\s*([^<]*?)(?:<\/a>)?\s*-\s*gara\s*(?:Linea\s*)?di\s*Km\.\s*([\d,]*)/g;
  let m;
  while ((m = rowRe.exec(html))) {
    rows.push({
      posizione: posizioneAt(m.index),
      data: m[1],
      regione: decodeEntities(m[2]).trim(),
      luogo: decodeEntities(m[3]).trim(),
      garaUrl: m[4] || null,
      nomeGara: decodeEntities(m[5]).trim(),
      km: m[6] || null,
    });
  }

  return {
    ciclismoId, nomeCompleto, team, categoria, stagione,
    natoIl: birthDateMatch ? birthDateMatch[1] : null,
    anniDisponibili: yearLinks,
    piazzamenti: rows,
  };
}

// Pagina CLASSIFICA (categoria+anno): elenco di TUTTI gli atleti che hanno
// segnato punti quella stagione — molto più efficiente della singola gara
// per l'enumerazione: 1 pagina per categoria+anno invece di migliaia di gare.
function parseClassificaPage(html) {
  const rowRe = /<td width="6%" align="right">\s*<font[^>]*><b>(\d+)&nbsp;&nbsp;<\/b><\/font><br>\s*<\/td>\s*<td width="29%">\s*<font[^>]*>\s*<a href="([^"]+)"[\s\S]*?<b>([^<]*?)<\/b><\/font><\/a>\s*<\/font><br>\s*<\/td>\s*<td width="32%">\s*<font[^>]*><b>([^<]*?)<\/b><\/font><br>\s*<\/td>\s*<td width="8%">\s*<font[^>]*><b>P\.\s*(\d+)<\/b><\/font><br>/g;
  const classifica = [];
  let m;
  while ((m = rowRe.exec(html))) {
    const idMatch = m[2].match(/scheda_corridore_risultati_gare_(?:tb_)?(\d+)_/);
    classifica.push({
      posizione: parseInt(m[1], 10),
      ciclismoId: idMatch ? idMatch[1] : null,
      nome: decodeEntities(m[3]).trim(),
      team: decodeEntities(m[4]).trim(),
      punti: parseInt(m[5], 10),
      schedaUrl: m[2],
    });
  }
  return { classifica };
}

// Foto della gara (se presente): un thumbnail+originale con una didascalia
// libera che di solito nomina il vincitore/protagonista — testo grezzo non
// strutturato in modo uniforme tra le due epoche di template (nel 2026 il
// nome è avvolto in un <b> annidato, nel 2008 è prosa libera), quindi si
// estrae solo il TESTO della didascalia: l'attribuzione all'atleta si fa a
// valle confrontandolo con i partecipanti già noti di quella gara.
function parseGaraPhoto(html) {
  // Alcune gare hanno più di una foto pubblicata: match globale, non il primo
  // soltanto — stessa struttura ripetuta per ogni foto (verificato: 1 o più
  // blocchi identici "link originale + thumbnail + didascalia").
  const re = /<a href="(\/immagini\/[^"]+_original\.jpg)"[^>]*>\s*<img[^>]*src="(\/immagini\/[^"]+_thumbnail\.jpg)"[^>]*>\s*<\/a>([\s\S]{0,600}?)<br\s*\/?>\s*<br\s*\/?>/gi;
  const photos = [];
  let m;
  while ((m = re.exec(html))) {
    photos.push({ original: m[1], thumbnail: m[2], caption: decodeEntities(m[3]).trim() });
  }
  return photos;
}

// Pagina GARA: tabella "ORDINE DI ARRIVO" — stesso template su entrambe le
// epoche HTML viste finora (verificato 2008 e 2026), quindi un solo regex basta.
function parseGaraPage(html, sourceUrl) {
  const idMatch = sourceUrl.match(/\/gara_.+?_(\d+)_\d{4}_\d{2}_\d{2}_/);
  const garaId = idMatch ? idMatch[1] : null;

  const titleMatch = html.match(/<h3>([^<]*)<\/h3>/) || html.match(/<title>([^<]*)<\/title>/);
  const titleText = titleMatch ? decodeEntities(titleMatch[1]) : null;

  const rowRe = /(\d+)&deg;[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<b>([^<]*?)<\/b>[\s\S]*?<\/a>[\s\S]*?<\/td>\s*<td width="67%">\s*<font[^>]*>&nbsp;\(([^)]*)\)<\/font>/g;
  const ordineArrivo = [];
  let m;
  while ((m = rowRe.exec(html))) {
    const cIdMatch = m[2].match(/scheda_corridore_risultati_gare_(?:tb_)?(\d+)_/);
    ordineArrivo.push({
      posizione: parseInt(m[1], 10),
      ciclismoId: cIdMatch ? cIdMatch[1] : null,
      nome: decodeEntities(m[3]).trim(),
      team: decodeEntities(m[4]).trim(),
    });
  }

  return { garaId, titleText, ordineArrivo };
}

module.exports = { fetchDecoded, decodeEntities, parseAthletePage, parseClassificaPage, parseGaraPage, parseGaraPhoto };

if (require.main === module) {
  (async () => {
    const url = process.argv[2];
    if (!url) { console.error('Uso: node ciclismo-info-test.js <url-scheda-atleta|url-gara|url-classifica>'); process.exit(1); }
    const html = await fetchDecoded(url);
    if (/\/gara_/.test(url)) {
      const data = parseGaraPage(html, url);
      console.log(JSON.stringify(data, null, 2));
      console.log(`\n${data.ordineArrivo.length} piazzamenti in ordine di arrivo estratti.`);
    } else if (/\/classifica_/.test(url)) {
      const data = parseClassificaPage(html);
      console.log(JSON.stringify(data.classifica.slice(0, 5), null, 2));
      console.log(`... (${data.classifica.length} atleti totali)`);
    } else {
      const data = parseAthletePage(html, url);
      console.log(JSON.stringify(data, null, 2));
      console.log(`\n${data.piazzamenti.length} piazzamenti estratti.`);
    }
  })();
}
