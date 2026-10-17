// Офлайн-служба. При любом изменении файлов приложения увеличьте VERSION.
const VERSION = 'hm-field-v0.5.0';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/model.js', 'js/db.js', 'js/zip.js', 'js/util.js', 'js/ui.js', 'js/camera.js', 'js/nav.js', 'js/registry.js', 'js/geo.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'js/export.js', 'js/screens-a.js', 'js/screens-b.js',
  'data/protocol.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('hm-field-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === 'navigate') {
          const idx = await c.match('index.html');
          if (idx) return idx;
        }
        throw err;
      }
    }),
  );
});
