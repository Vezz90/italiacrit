'use strict';
/**
 * Modulo condiviso per gli script di scraping ProCyclingStats (PCS).
 *
 * Centralizza l'avvio del browser Playwright e — soprattutto — il
 * rilevamento della sfida "verifica che non sei un robot" (Cloudflare
 * Turnstile) che PCS mostra quando riceve troppe richieste di pagine
 * corridore in sequenza troppo rapida. Gli script precedenti non la
 * rilevavano affatto: controllavano solo se l'URL conteneva
 * "pagenotfound"/"404", e in presenza della sfida (che NON cambia URL)
 * pensavano che la pagina fosse caricata correttamente, leggevano un DOM
 * che mostrava solo la sfida, non trovavano nulla, e passavano subito al
 * corridore successivo — troppo veloce perché la sfida potesse mai risolversi.
 */

const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Indicatori che la pagina sta mostrando una sfida anti-bot invece del
// contenuto reale.
async function isChallengePage(page) {
  return page.evaluate(() => {
    if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return true;
    if (document.querySelector('#challenge-running, .cf-turnstile, #cf-challenge-running')) return true;
    const bodyText = (document.body?.innerText || '').toLowerCase();
    if (/verify you are human|checking your browser|attendere\.\.\.|please wait while we/.test(bodyText)) return true;
    return false;
  }).catch(() => false);
}

/**
 * Naviga a `url` e attende che il contenuto reale sia visibile, gestendo
 * l'eventuale sfida anti-bot con un polling paziente invece di procedere
 * subito.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.readySelector — selettore CSS che indica pagina caricata (default 'h1')
 * @param {number} opts.challengeTimeoutMs — quanto attendere al massimo una sfida (default 120000)
 * @param {function} opts.onLog — callback(msg) per log
 * @returns {{ ok: boolean, notFound: boolean, timedOut: boolean }}
 */
async function gotoPcsPage(page, url, opts = {}) {
  const {
    readySelector = 'h1',
    challengeTimeoutMs = 600000, // 10 min — dà tempo a un utente non sempre presente di cliccare
    onLog = () => {},
  } = opts;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    return { ok: false, notFound: false, timedOut: false, error: e.message };
  }

  if (page.url().includes('pagenotfound') || page.url().includes('404')) {
    return { ok: false, notFound: true, timedOut: false };
  }

  await sleep(600);

  // PCS NON reindirizza a un URL diverso quando la pagina non esiste (es.
  // slug corridore indovinato male): resta sullo stesso URL ma il contenuto
  // è un semplice "Page not found" — il controllo sopra (solo sull'URL) non
  // lo rileva mai, quindi lo script pensava di aver trovato il profilo,
  // trovava foto/social/risultati vuoti e non tentava mai il fallback di
  // ricerca. Controlla anche il testo effettivo della pagina.
  const softNotFound = await page.evaluate(() => {
    const h1 = document.querySelector('h1')?.textContent?.trim().toLowerCase() || '';
    return h1 === 'page not found' || document.title.trim().toLowerCase() === 'page not found';
  }).catch(() => false);
  if (softNotFound) {
    return { ok: false, notFound: true, timedOut: false };
  }

  if (await isChallengePage(page)) {
    // Non tentiamo di risolverla in automatico (è una verifica anti-bot,
    // va completata da una persona): ci fermiamo ad aspettare che l'utente
    // clicchi la checkbox, poi la sessione riparte da sola.
    onLog(`  ⏳ verifica "non sono un robot" — clicca la checkbox nel browser (attendo fino a ${Math.round(challengeTimeoutMs / 60000)} min)…`);

    const start = Date.now();
    let cleared = false;
    while (Date.now() - start < challengeTimeoutMs) {
      await sleep(2000);
      const stillChallenge = await isChallengePage(page);
      if (!stillChallenge) { cleared = true; break; }
    }

    if (!cleared) {
      onLog('  ✗ sfida non superata entro il timeout — salto questo atleta (riproverà al prossimo giro)');
      return { ok: false, notFound: false, timedOut: true };
    }
    onLog('  ✓ verifica completata, continuo');
    await sleep(500);
  }

  // Attendi anche il contenuto reale (non solo l'assenza della sfida).
  try {
    await page.waitForSelector(readySelector, { timeout: 8000 });
  } catch {
    // Non fatale: alcune pagine (profili senza risultati) potrebbero non avere
    // esattamente il selettore atteso — lascia decidere al chiamante.
  }

  return { ok: true, notFound: false, timedOut: false };
}

// Pausa randomizzata "umana" tra un atleta e l'altro, con pausa più lunga
// periodica — pattern di richieste troppo regolare (200-800ms fissi, come
// negli script precedenti) è uno dei segnali più facili da riconoscere come bot.
async function humanDelay(index = 0) {
  const base = 5000 + Math.random() * 7000; // 5-12s
  await sleep(base);
  if (index > 0 && index % 20 === 0) {
    await sleep(60000 + Math.random() * 60000); // ~60-120s ogni 20 atleti
  }
}

function findBravePath() {
  const candidates = [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Users\\vezza\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env.LOCALAPPDATA || '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
}

/**
 * Avvia un browser Playwright visibile, con le stesse contromisure
 * anti-rilevamento già usate negli script esistenti (rimozione
 * navigator.webdriver, user-agent realistico).
 */
async function launchPcsBrowser() {
  const { chromium } = require('playwright');

  let browser;
  const bravePath = findBravePath();
  if (bravePath) {
    try {
      browser = await chromium.launch({
        executablePath: bravePath,
        headless: false,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      });
    } catch { /* fallback sotto */ }
  }
  if (!browser) {
    try { browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-blink-features=AutomationControlled'] }); }
    catch { browser = await chromium.launch({ headless: false }); }
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'it-IT',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Homepage per ottenere i cookie di sessione/Cloudflare prima del giro vero.
  await page.goto('https://www.procyclingstats.com/', { waitUntil: 'networkidle', timeout: 30000 })
    .then(() => sleep(2500))
    .catch(() => sleep(2000));

  return { browser, context, page };
}

module.exports = { launchPcsBrowser, gotoPcsPage, humanDelay, isChallengePage, sleep };
