// Service Worker: App-Dateien und Erkennungsmodell werden gecacht, danach läuft alles offline.
const VERSION = 'v1';
const APP_CACHE = `app-${VERSION}`;
const LIB_CACHE = 'libs-mediapipe-0.10.21';

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/app.js',
  './js/audio.js',
  './js/calibration.js',
  './js/chart.js',
  './js/command-engine.js',
  './js/pose.js',
  './js/settings.js',
  './js/shuffle-engine.js',
  './js/sim-tracker.js',
  './js/sim-trajectory.js',
  './js/storage.js',
  './js/util.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== LIB_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isLib = (url) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com' || url.pathname.endsWith('.task');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Bibliothek und Modell: einmal laden, danach aus dem Cache (Versionen sind festgepinnt)
  if (isLib(url)) {
    e.respondWith(
      caches.open(LIB_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Eigene Dateien: Netz zuerst (Updates kommen an), sonst Cache
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(APP_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
    );
  }
});
