'use strict';
// Test rapido e monouso: verifica solo l'estrazione squadra aggiunta a
// pcs-athlete-import.js su una singola pagina nota, senza passare dalla
// risoluzione atleta (richiede un profilo in manual_athletes/roster che
// per Tadej Pogačar non esiste più dopo la pulizia dei doppioni).
//
// Uso: node test-pcs-team-extract.js <slug> <anno>

(async () => {
  const { launchPcsBrowser, gotoPcsPage, withTimeout } = require('./pcs-browser');
  const slug = process.argv[2] || 'tadej-pogacar';
  const season = process.argv[3] || '2019';

  const { browser, page } = await launchPcsBrowser();
  console.log(`Vado su rider/${slug}/${season} …`);
  const nav = await gotoPcsPage(page, `https://www.procyclingstats.com/rider/${slug}/${season}`, { onLog: m => console.log(m) });
  console.log('nav:', nav);

  if (nav.ok) {
    const team = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href]')]
        .find(el => /^team\/[a-z0-9-]+-\d{4}$/.test((el.getAttribute('href') || '').replace(/^\/+/, '')));
      if (!a) return null;
      return { name: a.textContent.trim(), href: a.getAttribute('href') };
    }).catch(e => ({ error: e.message }));
    console.log('TEAM:', JSON.stringify(team));

    // Debug: elenca TUTTI i link team/ trovati con il loro contesto (classe del genitore, testo)
    const allTeamLinks = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .filter(a => (a.getAttribute('href')||'').replace(/^\/+/, '').startsWith('team/'))
        .map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim(), parentClass: a.parentElement?.className, grandparentClass: a.parentElement?.parentElement?.className }))
    ).catch(() => []);
    console.log('Tutti i link team/ trovati:', JSON.stringify(allTeamLinks, null, 1));
  }

  await withTimeout(new Promise(r => setTimeout(r, 1000)), 2000, 'wait').catch(() => {});
  await browser.close();
})().catch(e => { console.error('ERRORE:', e); process.exit(1); });
