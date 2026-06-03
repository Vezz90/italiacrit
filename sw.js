const CACHE_NAME = 'italiacrit-cache-v160';

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

  // ── NETWORK-FIRST per app.js / index.html / *.css (codice dell'app) ──
  // Evita di servire versioni vecchie dell'app dopo un deploy.
  if (/\/(app\.js|index\.html|style\.css|design\.css)(\?|$)/.test(url) || url.endsWith('/')) {
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
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'ItaliacritResultati', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'ItaliacritResultati';
  const options = {
    body: data.body || '',
    icon: './assets/logo2.png',
    badge: './assets/logo2.png',
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
