# HANDOFF — Arquitectura de Skincare Tracker

**Para el asistente que haga ajustes futuros:** este documento describe la arquitectura actual y las reglas que NO se deben romper. Léelo completo antes de tocar código.

## Qué es

PWA de skincare tracking de una sola usuaria (Macarena, Guadalajara, UTC-6). Foco clínico: **manchas solares / lentigos (sunspots)** — NO melasma (hubo cambio de diagnóstico; los textos y la puntuación SPF ya están calibrados a sunspots). Hosting: GitHub Pages (repo público). Backend: Supabase (Postgres + Auth + Storage + Edge Functions).

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Markup: tabs, secciones, TODOS los modales. Sin lógica. |
| `styles.css` | Todo el CSS. |
| `pure.js` | **Solo funciones puras** (fechas, escaping, adherencia, spfScoreOf). Sin DOM, sin Supabase. Compartido con `tests.html`. |
| `app.js` | Toda la lógica. Script clásico (no módulos), funciones globales llamadas desde `onclick` en HTML. Se carga DESPUÉS de pure.js. |
| `sw.js` | Service worker: cache network-first del shell + handlers de Web Push. |
| `manifest.webmanifest`, `icon-192/512.png` | PWA instalable. |
| `tests.html` | Tests de pure.js — abrir en navegador. |
| `spf-push-function.ts` | Edge Function `spf_push` (deployada vía dashboard). |
| SQL sueltos (`supabase-hardening.sql`, `migracion-*.sql`, `push-setup.sql`, `plantilla-alta-productos.sql`) | Se corren UNA vez en el SQL Editor; deben ser idempotentes (`if not exists`). |

**Sin build, sin frameworks, sin npm.** No introducir bundlers, módulos ES ni dependencias — la única lib externa es supabase-js por CDN.

## Datos (Supabase)

- `products` — catálogo maestro. Campos clave: `category` (texto EXACTO con emoji, ver lista abajo), `clinical_roles` (array), `schedule_days` (0=Dom..6=Sáb, null=diario), `tags` (jsonb, chips + puntuación SPF), `tier`, `status` (ok/low/out), `opened_at`+`pao_months` (caducidad), `logged_as` (nombre con que se registra).
- `routines` + `routine_steps` — rutinas por sección (am/pm/body/feet) con `schedule_days`; pasos con `product_id` fijo O `picker_category` (rotar) O informativos.
- `product_applications` — **fuente única de verdad.** Todo lo demás (Progreso, Historial, rachas, checkmarks) se CALCULA de aquí. Campos: `product_name`, `product_id`, `applied_at` (UTC), `source` ('rutina'/'reaplicacion'), `routine_step_id`.
- `daily_notes` — nota + `skin_state` (1–5) + `sun_exposure` (interior/normal/alta/playa), key `note_date`.
- `progress_photos` — `photo_url` guarda SOLO el nombre de archivo; bucket `progress-photos` es PRIVADO → URLs firmadas con `createSignedUrls` (batch, nunca una por una).
- `push_subscriptions` — suscripciones Web Push (+`last_notified_at` para no duplicar avisos).
- **RLS activo en todo** (políticas `authenticated`). La key publishable es pública en el repo — sin RLS los datos quedan expuestos. Cualquier tabla nueva DEBE nacer con RLS.

## Reglas de oro (romperlas causa bugs ya vividos)

1. **Fechas:** día calendario = fecha LOCAL. Usar `toDateStr()` / `localDateOfISO()` / `localDayBoundsUTC()` de pure.js. **NUNCA** `toISOString().split('T')[0]` (corre el día a UTC). Iteración de rangos con `eachDateStr()` (mediodía UTC). Métricas de Progreso cortan al **cierre de ayer** (`ENDS`).
2. **Escaping:** TODO texto de la base o de la usuaria pasa por `esc()` (o `fmtRich()` para multilínea, `jsAttrEsc()` en argumentos dentro de onclick, `cssSafe()` en clases CSS) antes de entrar a innerHTML. Sin excepciones — un producto llamado `<img onerror=...>` es XSS.
3. **UI optimista con rollback:** marcar/desmarcar pasos, chips de stock, pickers — el visual cambia primero, pero si Supabase falla se REVIERTE. Desmarcar un paso **BORRA** sus filas de `product_applications` de ese día (si no, el % de adherencia se infla).
4. **Hidratación de checkmarks** (qué paso ya se hizo hoy): prioridad `routine_step_id` exacto → `product_id` → categoría → nombre. Los últimos tres son fallbacks para datos viejos — no quitarlos, no promoverlos.
5. **Nada de listas duplicadas:** los selects de categoría, botones de reaplicación y la tabla comparativa SPF se **generan** de `PRODUCT_CATEGORIES` / `allProducts` / `products.tags`. Nunca hardcodear una lista que duplique lo que ya está en la base (ese patrón causó los bugs de "categoría faltante").
6. **pure.js se mantiene puro** y cada cambio ahí actualiza `tests.html`. La matemática de adherencia y `spfScoreOf` viven ahí. Pesos SPF actuales (sunspots): base 25, pa4 +30, uva400 +35, uvalong +20 (excluyente con uva400), tinted +10.
7. **Config en constantes, no regada:** `PRODUCT_CATEGORIES` (lista maestra de categorías — coincidencia EXACTA con emoji), `PM_ROTATION` (rotación de noches), `MULTI_PICK_CATEGORIES` (hoy: Toners y Serums AM — pasos que admiten varios productos a la vez), `ROLE_CONFIG`/`clinical_roles` (roles: despigmentacion, regeneracion_celular, barrera, spf_facial, textura_poros).
8. **PWA:** sw.js es network-first y SOLO intercepta same-origin GET (jamás Supabase/CDN). Al cambiar sw.js, subir versión de `CACHE`. Registros sin conexión van a una cola en localStorage (`flushPending` al reconectar). localStorage es solo para cola y preferencias — **nunca** para datos.
9. **Notificaciones:** en iOS solo funcionan vía `registration.showNotification` con la PWA instalada — `new Notification()` NO existe en iOS. El push real lo manda la Edge Function `spf_push` (cron cada 15 min; la función misma filtra horario 10am–7pm GDL y gap de 2 h). Con push activo, el aviso local se desactiva (`PUSH_ENABLED_KEY`) para no duplicar. La llave VAPID pública vive en app.js (correcto); la privada SOLO en secrets de Supabase — **jamás en el repo**.
10. **Renombrar productos:** el vínculo robusto es `product_id`; los registros viejos por nombre dependen de los fallbacks. Si se renombra masivamente, correr de nuevo el backfill de `supabase-hardening.sql`.

## Flujos no obvios

- **Backdate** ("Registrar para"): re-renderiza Today con los datos de ESE día; logs y borrados respetan la fecha elegida. El resumen de hoy se oculta durante backdate.
- **Multi-picker** (Toners/Serums): registra UNA fila por producto seleccionado, todas con el mismo `routine_step_id`; la hidratación concatena nombres con " · ".
- **Adherencia por producto:** contra su propio calendario — prioridad `schedule_days` manual → calendario de la rutina donde es paso fijo → diario.
- **Protección solar en Progreso:** sistema de puntos por calidad × aplicaciones (ideal 5/día), no promedio simple — la rotación de protectores no castiga.
- **Reporte dermatóloga:** `openDermReport()` usa `lastReportData` (seteado por `loadHistory`) — requiere que Progreso haya cargado.
- **UV en vivo:** Open-Meteo sin key, coordenadas GDL hardcodeadas en `fetchUV()`.

## Al terminar cualquier cambio

1. `node --check app.js pure.js sw.js` (sintaxis).
2. Abrir `tests.html` → todo ✅.
3. Si tocaste sw.js → subir versión de CACHE.
4. Si agregaste columnas → entregar migración SQL idempotente aparte.
5. Los 3 archivos que se deployan siempre juntos: `index.html`, `styles.css`, `app.js` (+ `sw.js`/`pure.js` si cambiaron).
