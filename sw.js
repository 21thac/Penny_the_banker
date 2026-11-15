// Service worker: lets the app open and work with no connection.
//
// App files: try the network first so updates arrive straight away, and fall
// back to the saved copy when offline. Fonts: use the saved copy first, since
// they never change. Requests to other services (AI, sync) are left alone.

const CACHE = 'ledger-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/ai.js',
  './js/app.js',
  './js/art.js',
  './js/backup.js',
  './js/buddy.js',
  './js/budget.js',
  './js/charts.js',
  './js/fonts.js',
  './js/health.js',
  './js/insights.js',
  './js/month.js',
  './js/photos.js',
  './js/store.js',
  './js/sync-script.js',
  './js/sync.js',
  './js/ui.js',
  './js/util.js',
  './js/views/add.js',
  './js/views/assistant.js',
  './js/views/budget.js',
  './js/views/goals.js',
  './js/views/home.js',
  './js/views/insights.js',
  './js/views/settings.js',
  './js/views/summary.js',
  './js/wealth.js',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const saved = await cache.match(request);
        if (saved) return saved;
        const fresh = await fetch(request);
        cache.put(request, fresh.clone());
        return fresh;
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((fresh) => {
        if (fresh.ok) caches.open(CACHE).then((cache) => cache.put(request, fresh.clone()));
        return fresh;
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: true })) || (await caches.match('./index.html'))),
  );
});
