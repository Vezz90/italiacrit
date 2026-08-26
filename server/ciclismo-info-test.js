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
  // "NOME COGNOME - TEAM - Categoria X - Stagione Y"
  const titleParts = titleMatch ? decodeEntities(titleMatch[1]).split(' - ') : [];
  const nomeCompleto = titleParts[0] || null;
  const team = titleParts[1] || null;
  const categoria = (titleParts[2] || '').replace(/^Categoria\s*/i, '') || null;
  const stagione = (titleParts[3] || '').replace(/^Stagione\s*/i, '') || null;

  const birthYearMatch = html.match(/<b>([A-ZÀ-Ý' ]+)<\/b>\s*\(( \d{4})\)/) || html.match(/\(\s*(\d{4})\s*\)/);
  const birthDateMatch = html.match(/Nato(?:\s+a\s+[^<]*?)?\s+[Ii]l\s+(\d{1,2}\s+\w+\s+\d{4})/);

  // Anni disponibili (SELEZIONA STAGIONE): utile per sapere fino a dove risalire
  // per questo atleta specifico, invece di tentare a caso ogni anno dal 2007.
  const yearLinks = [...html.matchAll(/scheda_corridore_risultati_gare_(?:tb_)?\d+_[^_]*(?:_[^_]*)*?_(\d{4})\.htm/g)]
    .map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort();

  // Piazzamenti: ogni blocco "data - regione ... luogo ... <a href=race>nome gara</a>"
  const rows = [];
  const rowRe = /<b>(\d{4}-\d{2}-\d{2})\s*-\s*([^<]*?)<\/b><\/font>\s*<font[^>]*><b>\s*-?\s*([^<]*?)<\/b><\/font><br>\s*<font[^>]*><b>(?:<a href="([^"]+)"[^>]*>)?\s*([^<]*?)(?:<\/a>)?\s*-\s*gara\s*(?:Linea\s*)?di\s*Km\.\s*([\d,]*)/g;
  let m;
  while ((m = rowRe.exec(html))) {
    rows.push({
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

(async () => {
  const url = process.argv[2];
  if (!url) { console.error('Uso: node ciclismo-info-test.js <url-scheda-atleta|url-gara>'); process.exit(1); }
  const html = await fetchDecoded(url);
  if (/\/gara_/.test(url)) {
    const data = parseGaraPage(html, url);
    console.log(JSON.stringify(data, null, 2));
    console.log(`\n${data.ordineArrivo.length} piazzamenti in ordine di arrivo estratti.`);
  } else {
    const data = parseAthletePage(html, url);
    console.log(JSON.stringify(data, null, 2));
    console.log(`\n${data.piazzamenti.length} piazzamenti estratti.`);
  }
})();
