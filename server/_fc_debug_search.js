'use strict';
// Script usa-e-getta: apre la pagina di ricerca di FirstCycling per un nome
// noto e salva l'HTML grezzo + tutti i link della pagina, per capire il
// vero pattern URL/DOM (il primo tentativo in firstcycling-photo-import.js
// era una supposizione mai verificata dal vivo — 0/6 risultati nel test).
const fs = require('fs');
const path = require('path');

(async () => {
  const { launchBrowser, gotoPcsPage } = require('./pcs-browser');
  const { browser, page } = await launchBrowser(null);

  const queries = ['https://it.firstcycling.com/rider.php?r=261661', 'Fedrizzi Brandon Davide'];
  const out = {};
  for (const q of queries) {
    const url = q.startsWith('http') ? q : `https://it.firstcycling.com/search.php?search=${encodeURIComponent(q)}`;
    console.log('Navigo:', url);
    const nav = await gotoPcsPage(page, url, { readySelector: 'body', onLog: m => console.log(m) });
    console.log('nav result:', JSON.stringify(nav));
    if (nav.ok) {
      const html = await page.content();
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')].map(a => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() })).filter(l => l.text || l.href)
      );
      out[q] = { url: page.url(), htmlLen: html.length, links: links.slice(0, 60) };
      const safeName = q.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      fs.writeFileSync(path.join(__dirname, `_fc_debug_${safeName}.html`), html, 'utf8');
    } else {
      out[q] = { error: nav };
    }
  }
  fs.writeFileSync(path.join(__dirname, '_fc_debug_out.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('=== FATTO ===');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
