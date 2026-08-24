'use strict';
// Ricognizione (SOLA LETTURA, nessuna scrittura sul sito): conta/elenca le
// gare "Tipo Pista" sul portale members.federciclismo.it tra due date, per
// capire quante ce ne sono davvero e se rientrano nelle categorie già
// coperte dal sito (Elite/U23, Juniores, Allievi, Esordienti). Serve solo a
// validare la fattibilità prima di scrivere un vero importer.

const START = process.argv[2] || '01-01-2026'; // DD-MM-YYYY
const END   = process.argv[3] || '24-08-2026';
const DELAY_MS = 400;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pageUrl(page) {
  const [sd, sm, sy] = START.split('-');
  const [ed, em, ey] = END.split('-');
  const s = `${sd}%2F${sm}%2F${sy}`;
  const e = `${ed}%2F${em}%2F${ey}`;
  return `https://members.federciclismo.it/race?sectorId=0&StartDt=${s}&EndDt=${e}&page=${page}`;
}

function parseListPage(html) {
  const items = [];
  const liRe = /<li>\s*<a href="\/race\/detail\/(\d+)\/">([\s\S]*?)<\/a>\s*<div class="btnGare/g;
  let m;
  while ((m = liRe.exec(html))) {
    const id = m[1];
    const inner = m[2];
    const data  = (inner.match(/<span class="calData">([^<]*)<\/span>/) || [])[1] || '';
    const h3    = (inner.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '';
    const h4    = (inner.match(/<h4>([\s\S]*?)<\/h4>/) || [])[1] || '';
    const spans = [...inner.matchAll(/<span>([\s\S]*?)<\/span>/g)].map(x => x[1]);
    items.push({
      id,
      data,
      nome: h3.replace(/^[^-]+-\s*/, '').trim(), // toglie il prefisso settore ("Strada - ")
      settore: (h3.split('-')[0] || '').trim(),
      classe: (h4.match(/Classe:\s*(.*)$/) || [])[1] || '',
      luogo: spans[0] || '',
      livelloTipo: spans[1] || '',
    });
  }
  const lastPageMatch = html.match(/page=(\d+)">\d+<\/a><\/li><li class="disabled PagedList-ellipses/);
  const totalPages = lastPageMatch ? null : null; // vedi fetchAllPages: si ferma su pagina vuota
  return items;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#176;/g, '°').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#224;/g, 'à').replace(/&amp;/g, '&').replace(/&#232;/g, 'è')
    .replace(/&#242;/g, 'ò').replace(/&#249;/g, 'ù').replace(/&#236;/g, 'ì');
}

(async () => {
  console.log(`Scansione members.federciclismo.it dal ${START} al ${END}…\n`);
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(pageUrl(page), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) { console.error(`HTTP ${res.status} a pagina ${page}, mi fermo`); break; }
    const html = await res.text();
    const items = parseListPage(html);
    if (!items.length) break;
    all.push(...items);
    if (page % 10 === 0) process.stdout.write(`  pagina ${page}, ${all.length} gare finora…\n`);
    page++;
    await sleep(DELAY_MS);
    if (page > 300) { console.warn('Limite di sicurezza 300 pagine raggiunto'); break; }
  }
  console.log(`\nTotale gare esaminate: ${all.length} (${page - 1} pagine)\n`);

  const pista = all.filter(g => /tipo pista/i.test(g.livelloTipo) || /pista/i.test(g.classe));
  console.log(`Gare "Tipo Pista": ${pista.length}\n`);
  for (const g of pista) {
    console.log(`${g.data} — ${decodeEntities(g.nome)} [ID ${g.id}]`);
    console.log(`    Classe: ${decodeEntities(g.classe)} | ${decodeEntities(g.luogo)} | ${decodeEntities(g.livelloTipo)}`);
  }
})();
