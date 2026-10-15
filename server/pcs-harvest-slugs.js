'use strict';
// Raccoglie in blocco gli slug PCS di TUTTI gli italiani in classifica, anno per anno (2007-oggi), uomini e donne:
// la classifica individuale per nazione di PCS ha 100 corridori a pagina con lo slug esatto del profilo, quindi circa 150-250 pagine
// bastano per sapere chi esiste su PCS e in quali anni ha punti (= ha risultati). Nessuna scrittura sul database: produce
// server/pcs-nation-riders.json, poi pcs-match-slugs.js confronta con i nostri atleti.
//   node pcs-harvest-slugs.js [--from=2007] [--to=2026] [--nation=it]
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { launchPcsBrowser, gotoPcsPage, humanDelay } = require('./pcs-browser');
const args = process.argv.slice(2);
const arg = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const FROM = parseInt(arg('from') || '2007', 10), TO = parseInt(arg('to') || String(new Date().getFullYear()), 10), NATION = arg('nation') || 'it';
const OUT = path.join(__dirname, 'pcs-nation-riders.json');
const STATE = path.join(__dirname, 'pcs-harvest-state.json');
let riders = {}, done = {};
try { riders = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) {}
try { done = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}
const save = () => { fs.writeFileSync(OUT, JSON.stringify(riders)); fs.writeFileSync(STATE, JSON.stringify(done)); };

function parse(html) {
  const $ = cheerio.load(html), out = [];
  $('table tbody tr').each((_, tr) => {
    const a = $(tr).find('a[href^="rider/"]').first();
    if (!a.length) return;
    const slug = (a.attr('href') || '').replace(/^rider\//, '').trim();
    const name = a.text().replace(/\s+/g, ' ').trim();
    const team = $(tr).find('a[href^="team/"]').first().text().replace(/\s+/g, ' ').trim();
    const rank = parseInt($(tr).find('td').first().text().trim(), 10) || 0;
    const nums = $(tr).find('td').map((_, td) => $(td).text().trim()).get().filter(t => /^\d[\d.,]*$/.test(t));
    const pts = parseFloat(String(nums[nums.length - 1] || '0').replace(/\./g, '').replace(',', '.')) || 0;
    if (slug) out.push({ slug, name, team, pts, rank });
  });
  return out;
}

(async () => {
  let { browser, context, page } = await launchPcsBrowser();
  async function go(url) {
    for (let k = 0; k < 4; k++) {
      if (page.isClosed()) { try { page = await context.newPage(); } catch { try { await browser.close(); } catch {} ({ browser, context, page } = await launchPcsBrowser()); } }
      const n = await gotoPcsPage(page, url, { readySelector: 'table' });
      if (n.ok || n.notFound) return n;
      await humanDelay(k);
    }
    return { ok: false };
  }
  let pages = 0, newRiders = 0;
  for (let y = TO; y >= FROM; y--) {
    for (const gender of ['me', 'we']) {
      // l'offset di PCS conta le posizioni nella classifica MONDIALE (il filtro per nazione si applica dopo): le pagine si sovrappongono
      // se si avanza di 100 in 100, quindi si riparte dall'ultima posizione letta.
      for (let offset = 0, guard = 0; guard < 60; guard++) {
        const key = `${y}|${gender}|${offset}`;
        if (done[key] === 'ok') continue;
        const url = `https://www.procyclingstats.com/rankings.php?date=${y}-12-31&nation=${NATION}&age=&zage=&page=smallerorequal&team=&offset=${offset}&teamlevel=&filter=Filter&p=${gender}&s=individual`;
        const n = await go(url);
        if (!n.ok) { console.log(`${key}: non letta`); break; }
        const rows = parse(await page.content());
        pages++;
        for (const r of rows) {
          const e = riders[r.slug] || (riders[r.slug] = { name: r.name, gender, team: r.team, years: {} });
          if (!e.years[y]) newRiders += Object.keys(e.years).length === 0 ? 1 : 0;
          e.years[y] = r.pts; e.team = r.team || e.team;
        }
        done[key] = 'ok';
        console.log(`${y} ${gender} offset ${offset}: ${rows.length} corridori, primo ${rows[0] && rows[0].slug} (totale slug ${Object.keys(riders).length})`);
        save();
        await humanDelay(pages);
        const lastRank = Math.max(0, ...rows.map(r => r.rank));
        if (rows.length < 100 || rows.every(r => r.pts <= 0) || lastRank <= offset) break;
        offset = lastRank;
      }
    }
  }
  save();
  await browser.close().catch(() => {});
  console.log(`\n=== Completato === slug raccolti: ${Object.keys(riders).length} · pagine lette: ${pages}`);
})().catch(e => { console.error('ERRORE FATALE', e); process.exit(1); });
