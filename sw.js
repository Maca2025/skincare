// Service worker — cachea el "shell" de la app para que abra al instante y
// funcione sin conexión (los datos siguen viniendo de Supabase; los registros
// hechos sin señal se encolan en localStorage desde app.js y se reenvían solos).
// Estrategia: network-first con fallback a cache — así los deploys nuevos en
// GitHub Pages se ven de inmediato, pero sin red la app sigue abriendo.
// IMPORTANTE: nunca intercepta peticiones a otros orígenes (Supabase, CDN).
const CACHE = 'skincare-shell-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './pure.js',
  './activos-matriz.js',
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
// ── WEB PUSH: el servidor (Edge Function spf-push) manda el push aunque la
// app esté cerrada; aquí solo se muestra y se maneja el tap.
self.addEventListener('push', e => {
  let data = { title: '✦ Skincare Tracker', body: '' };
  try { data = e.data.json(); }
  catch (err) { if (e.data) data.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'spf-reminder'
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return clients.openWindow('./');
  }));
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
