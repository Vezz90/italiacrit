const CACHE_NAME = 'italiacrit-cache-v677';

// File statici: messi in cache e serviti velocemente
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './home.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // ── API DINAMICHE: sempre dalla rete, MAI dalla cache del service worker ──
  // Foto gara, video, code di approvazione, classifiche live ecc. cambiano in
  // continuazione: se il SW le servisse dalla cache (strategia cache-first di
  // default), i nuovi caricamenti non apparirebbero finché non si svuota la
  // cache. Lasciamo gestire la richiesta al browser (rete), senza cache SW.
  if (url.includes('/api/') || url.includes('.onrender.com')) {
    return; // niente respondWith → fetch di rete normale
  }

  // ── STRATEGIA NETWORK-FIRST per le immagini/foto profilo ──
  // Le foto vengono sovrascritte mantenendo lo stesso URL: senza questa
  // regola la cache servirebbe sempre la vecchia immagine.
  if (url.includes('/storage/v1/object/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) {
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
        .then(networkResponse => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── STRATEGIA NETWORK-FIRST per i file JSON (dati dinamici) ──
  // Garantisce che gli aggiornamenti dal server siano sempre visibili, ma
  // 'no-cache' (non 'reload'): invia comunque una richiesta condizionale
  // (If-None-Match) ad ogni caricamento — mai dati stantii — però quando il
  // contenuto non è cambiato (il caso più comune: lo scraper aggiorna questi
  // file ogni 30 min, non ad ogni visita) il server risponde 304 Not
  // Modified invece di rimandare tutto il body: per i file grandi di questo
  // sito (results_raw.json/teams.json/athletes.json/race_details.json,
  // insieme ~29MB non compressi, ~2,8MB gzip) questo evita di riscaricare
  // megabyte identici ad ogni apertura del sito — causa principale della
  // pagina bianca prolungata segnalata dal vivo ("ci mette tanto a
  // caricare"). 'reload' ignorava completamente Cache-Control/ETag,
  // forzando SEMPRE il download integro anche a dati identici.
  if (url.includes('/data/') && url.endsWith('.json')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(networkResponse => {
          // Aggiorna la cache con la versione fresca
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return networkResponse;
        })
        .catch(() => {
          // Se offline, serve dalla cache come fallback
          return caches.match(event.request);
        })
    );
    return;
  }

  // ── STRATEGIA NETWORK-FIRST per i file di ranking (JSON nelle sottocartelle) ──
  // Stesso motivo di 'no-cache' spiegato sopra per i file JSON principali.
  if (url.includes('/rankings/') || url.includes('/team_rankings/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(networkResponse => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── NETWORK-FIRST per app.js / index.html / *.css (codice dell'app) ──
  // Evita di servire versioni vecchie dell'app dopo un deploy. cache:'reload'
  // è essenziale: senza, questo fetch può comunque essere soddisfatto dalla
  // cache HTTP del browser (Cloudflare manda Cache-Control: max-age=14400 su
  // questi file statici) invece di andare davvero in rete, vanificando lo
  // scopo della strategia "network-first" — un deploy poteva restare invisibile
  // fino a 4 ore anche dopo aver svuotato la cache del service worker.
  // event.request.mode === 'navigate' copre QUALUNQUE apertura diretta di una
  // pagina con URL pulito (es. /risultati, /atleta/XYZ da bookmark/link
  // condiviso/refresh) — senza questo, quelle richieste non matchavano
  // nessuna delle regex sopra (non finiscono per "/" né si chiamano
  // index.html) e cadevano nella strategia cache-first generica più sotto:
  // un utente che riapriva una pagina già visitata poteva restare bloccato
  // sulla shell HTML vecchia (col vecchio app.js referenziato dentro)
  // indefinitamente, anche con service worker e cache già aggiornati —
  // causa più probabile del bug "vedo le novità solo su un browser mai
  // usato prima, mai sul mio" osservato dal vivo.
  if (event.request.mode === 'navigate' || /\/(app\.js|index\.html|style\.css|design\.css)(\?|$)/.test(url) || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
        .then(networkResponse => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── STRATEGIA CACHE-FIRST per tutti gli altri asset ──
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(networkResponse => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return networkResponse;
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ──────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Italia Cycling Stats', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Italia Cycling Stats';
  const options = {
    body: data.body || '',
    icon: './assets/logo.png?v=3',
    badge: './assets/logo.png?v=3',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Se c'è già una finestra aperta, focus + naviga
      for (const c of list) {
        if ('focus' in c) { c.focus(); if (c.navigate && target !== '/') c.navigate(target); return; }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
