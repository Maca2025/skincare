// Service worker — cachea el "shell" de la app para que abra al instante y
// funcione sin conexión (los datos siguen viniendo de Supabase; los registros
// hechos sin señal se encolan en localStorage desde app.js y se reenvían solos).
// Estrategia: network-first con fallback a cache — así los deploys nuevos en
// GitHub Pages se ven de inmediato, pero sin red la app sigue abriendo.
// IMPORTANTE: nunca intercepta peticiones a otros orígenes (Supabase, CDN).
const CACHE = 'skincare-shell-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './pure.js',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      })
      .catch(() =>
        caches.match(e.request).then(m => m || caches.match('./index.html'))
      )
  );
});
