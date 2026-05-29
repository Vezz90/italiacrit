const CACHE_NAME = 'italiacrit-cache-v49';

// File statici: messi in cache e serviti velocemente
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
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

  // ── STRATEGIA NETWORK-FIRST per i file JSON (dati dinamici) ──
  // Garantisce che gli aggiornamenti dal server siano sempre visibili.
  if (url.includes('/data/') && url.endsWith('.json')) {
    event.respondWith(
      fetch(event.request)
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
  if (url.includes('/rankings/') || url.includes('/team_rankings/')) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── STRATEGIA CACHE-FIRST per tutti gli altri asset (HTML, CSS, JS) ──
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
