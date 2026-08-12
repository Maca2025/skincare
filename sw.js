// Service worker — cachea el "shell" de la app para que abra al instante y
// funcione sin conexión (los datos siguen viniendo de Supabase; los registros
// hechos sin señal se encolan en localStorage desde app.js y se reenvían solos).
// Estrategia: network-first con fallback a cache — así los deploys nuevos en
// GitHub Pages se ven de inmediato, pero sin red la app sigue abriendo.
// IMPORTANTE: nunca intercepta peticiones a otros orígenes (Supabase, CDN).
// v29 — la barra de pestañas se parte en dos: arriba lo que ESCRIBE en la base
//   (Today · Photos · Stock), abajo lo que la MIRA (Progreso · Historial ·
//   Rutinas · Capas), con un fondo distinto cada una. Y entra la pestaña
//   Capas: cómo superponer dos protectores y por qué. Ver
//   claude/auditoria-protectores-solares.md.
// v28 — la fila del piso en Progreso: siete puntos de días activos + el conteo
//       contra diasPiso. Toca app.js y styles.css, y baja los pisos de cuerpo,
//       manos, pies, cabello y labios en activos-matriz.js.
// v27 — motor de cadencia, primera pieza: `diasIdeales` se parte en `diasPiso` y
//       `diasTecho`. OBLIGATORIO subir la caché aquí: activos-matriz.js, pure.js
//       y app.js cambian JUNTOS y no se pueden servir mezclados. Un app.js nuevo
//       leyendo un activos-matriz.js viejo recibe `cfg.diasTecho === undefined`,
//       doseWeekPct devuelve null y las barras de Progreso desaparecen.
// v21 — filtro por ZONA en "Historial de aplicaciones", en cascada con los
// filtros de tipo de producto y producto específico ya existentes. Resuelve
// zona con el mismo respaldo (r.zones → PRODUCT_ZONAS) que usa el motor de
// dosis, para no mostrar un conteo distinto al de Progreso para el mismo
// registro.
// v20 — la constancia diaria (heatmap + racha) deja de medir "% de pasos de
// rutina hechos" y pasa a medir lo mismo que las barras de Progreso: cuánto
// llenaste el techo diario de cada eje de dosis, promediado solo entre los
// ejes con actividad ese día (los sin actividad no cuentan en contra — un
// descanso de textura/firmeza no es una falla). Se retiró por completo la
// tarjeta "Rutina completa" (General/Mañana/Noche/Cuerpo/Pies): no hay
// equivalente de mañana/noche en el motor de dosis, y Cuerpo/Pies ya se veían
// en "Estímulo entregado". Motivo: los multipickers dejan aplicar 1 o 6
// productos bajo el mismo paso y contaban igual — el % de pasos ya no
// reflejaba el estímulo real entregado.
// v19 — reaplicación de SPF recalibrada por TIPO DE EXPOSICIÓN (no solo UV):
// interior con luz natural 4h, aire libre normal/mucho sol/playa 2h, actividad
// física o agua 60-80min (nuevo 5to botón "Actividad"). Vale tanto para el
// ideal de Progreso (pasado y hoy) como para el aviso en vivo dentro de la app.
// UV bajo sigue vetando el aviso sin importar la actividad. v18 corrigió el
// gap fijo por banda de UV de 1.5h a 2h para muy_alto/extremo (guía derm real).
// v10 — barra superior por zona (última hora de SPF en cara/cuello/manos, fuera
// los contadores de pasos), ritmo de reaplicación según UV y ocaso, y estado
// rojo con UV 8+.
// v9 — la preselección de zona cae a la APTITUD del producto cuando no tiene
// entrada en la matriz, y apagar todos los chips ya no bloquea el registro.
// v8 — un solo picker vivo a la vez: los tres modales de picker repetían los
// ids `zone-pick-chips` y `multi-pick-btn`, y getElementById devuelve el primero
// del documento. Con el picker de SPF facial ya abierto, el de SPF corporal
// salía sin chips de zona y con "Aplicar" muerto.
// v7 — `no_reapp` deja de ESCONDER y pasa a DEGRADAR: en un paso de rutina el
// producto aparece normal, y fuera de rutina baja al final con una nota. La
// tretinoína no salía en el picker de Activos.
// v6 — multipicker de zona: `product_applications.zones` ya se ESCRIBE
// (2026-07-25). Subir esta versión es lo que
// obliga al service worker a descartar el shell viejo: sin ello la app puede
// seguir sirviendo el app.js anterior desde caché y los cambios "no aparecen"
// aunque los archivos ya estén subidos (pasó con los filtros de Stock).
const CACHE = 'skincare-shell-v29';
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
// Tocar la notificación REGISTRA el protector, no solo abre la app.
//
// OJO: iOS Safari ignora el arreglo `actions` de showNotification — el botón
// "Ya lo apliqué" no se renderiza en iPhone. Por eso el registro cuelga del
// tap en la notificación completa, que sí dispara notificationclick en iOS.
// Así el flujo pasa de 5 interacciones (abrir → bajar → categoría → producto)
// a 1 sola. Ver mejora #1: la frecuencia de reaplicación tiene ~6x más palanca
// sobre el eje Protección que la calidad del protector.
//
// Si la app ya está abierta se le avisa por postMessage; si está cerrada se
// abre con ?log=spf y app.js registra al arrancar.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.postMessage({ type: 'LOG_SPF' }); return c.focus(); }
    }
    return clients.openWindow('./?log=spf');
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
