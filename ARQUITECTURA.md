# HANDOFF — Arquitectura de Skincare Tracker

**Para el asistente que haga ajustes futuros:** este documento describe la arquitectura actual y las reglas que NO se deben romper. Léelo completo antes de tocar código.

## Qué es

PWA de skincare tracking de una sola usuaria (Macarena, Guadalajara, UTC-6). Foco clínico: **manchas solares / lentigos (sunspots)** — NO melasma (hubo cambio de diagnóstico; los textos y la puntuación SPF ya están calibrados a sunspots). Hosting: GitHub Pages (repo público). Backend: Supabase (Postgres + Auth + Storage + Edge Functions).

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Markup: tabs, secciones, TODOS los modales. Sin lógica. |
| `styles.css` | Todo el CSS. |
| `pure.js` | **Solo funciones puras** (fechas, escaping, adherencia, `spfScoreOf`, `doseWeekPct`, `overExposureDays`, `buildHydration`, `resolveStepHydration`, `shiftDateStr`, `reactionSignal`). Sin DOM, sin Supabase. Compartido con `tests.html`. |
| `activos-matriz.js` | Config de Fase B: `DOSE_AXES`, `PRODUCT_DOSE` (93 productos por id), `IRRITANTES`. Solo datos, sin lógica. Se carga ENTRE `pure.js` y `app.js`. |
| `app.js` | Toda la lógica. Script clásico (no módulos), funciones globales llamadas desde `onclick` en HTML. Se carga DESPUÉS de pure.js y activos-matriz.js. |
| `sw.js` | Service worker: cache network-first del shell + handlers de Web Push. |
| `manifest.webmanifest`, `icon-192/512.png` | PWA instalable. |
| `tests.html` | Tests de pure.js — abrir en navegador. |
| `spf-push-function.ts` | Edge Function `spf_push` (deployada vía dashboard). |
| SQL sueltos (`supabase-hardening.sql`, `migracion-*.sql`, `reparacion-*.sql`, `push-setup.sql`, `plantilla-alta-productos.sql`) | Se corren UNA vez en el SQL Editor; deben ser idempotentes (`if not exists`). |

**Sin build, sin frameworks, sin npm.** No introducir bundlers, módulos ES ni dependencias — la única lib externa es supabase-js por CDN.

## Datos (Supabase)

- `products` — catálogo maestro. Campos clave: `category` (texto EXACTO con emoji, ver lista abajo), `clinical_roles` (array), `schedule_days` (0=Dom..6=Sáb, null=diario), `tags` (jsonb, chips + puntuación SPF), `tier`, `status` (ok/low/out), `opened_at`+`pao_months` (caducidad), `logged_as` (nombre con que se registra), `started_at` (fecha LOCAL de introducción — `date`, no timestamptz).
- `routines` + `routine_steps` — rutinas por sección (am/pm/body/feet) con `schedule_days`; pasos con `product_id` fijo O `picker_category` (rotar) O informativos.
- `product_applications` — **fuente única de verdad.** Todo lo demás (Progreso, Historial, rachas, checkmarks) se CALCULA de aquí. Campos: `product_name`, `product_id`, `applied_at` (UTC), `source` ('rutina'/'reaplicacion'), `routine_step_id`.
- `daily_notes` — nota + `skin_state` (1–5) + `sun_exposure` (interior/normal/alta/playa), key `note_date`.
- `progress_photos` — `photo_url` guarda SOLO el nombre de archivo; bucket `progress-photos` es PRIVADO → URLs firmadas con `createSignedUrls` (batch, nunca una por una).
- `push_subscriptions` — suscripciones Web Push (+`last_notified_at` para no duplicar avisos).
- `treatment_events` — hitos de tratamiento que NO son un producto: consultas, procedimientos, cambios de diagnóstico, exposición solar fuera de lo normal. `event_type` va con CHECK. La vista `treatment_timeline` la une con `products.started_at` y lleva `security_invoker = on` (sin eso, la vista saltaría el RLS de las tablas de abajo).
- **RLS activo en todo** (políticas `authenticated`). La key publishable es pública en el repo — sin RLS los datos quedan expuestos. Cualquier tabla nueva DEBE nacer con RLS.

## Reglas de oro (romperlas causa bugs ya vividos)

1. **Fechas:** día calendario = fecha LOCAL. Usar `toDateStr()` / `localDateOfISO()` / `localDayBoundsUTC()` de pure.js. **NUNCA** `toISOString().split('T')[0]` (corre el día a UTC). Iteración de rangos con `eachDateStr()` (mediodía UTC). Métricas de Progreso cortan al **cierre de ayer** (`ENDS`).
2. **Escaping:** TODO texto de la base o de la usuaria pasa por `esc()` (o `fmtRich()` para multilínea, `jsAttrEsc()` en argumentos dentro de onclick, `cssSafe()` en clases CSS) antes de entrar a innerHTML. Sin excepciones — un producto llamado `<img onerror=...>` es XSS.
3. **UI optimista con rollback:** marcar/desmarcar pasos, chips de stock, pickers — el visual cambia primero, pero si Supabase falla se REVIERTE. Desmarcar un paso **BORRA** sus filas de `product_applications` de ese día (si no, el % de adherencia se infla).
4. **Hidratación de checkmarks** (qué paso ya se hizo hoy): prioridad `routine_step_id` exacto → `product_id` → categoría → nombre. Los últimos tres son fallbacks para datos viejos — no quitarlos, no promoverlos. **Vive en `pure.js`** (`buildHydration` / `resolveStepHydration`) con 14 casos en `tests.html`: era la parte más frágil del código y la única sin pruebas. Si la tocas, corre los tests.
5. **Nada de listas duplicadas:** los selects de categoría, botones de reaplicación y la tabla comparativa SPF se **generan** de `PRODUCT_CATEGORIES` / `allProducts` / `products.tags`. Nunca hardcodear una lista que duplique lo que ya está en la base (ese patrón causó los bugs de "categoría faltante").
6. **pure.js se mantiene puro** y cada cambio ahí actualiza `tests.html`. La matemática de adherencia y `spfScoreOf` viven ahí. Pesos SPF actuales (sunspots): base 25, pa4 +30, uva400 +35, uvalong +20 (excluyente con uva400), tinted +10.
7. **Config en constantes, no regada:** `PRODUCT_CATEGORIES` (lista maestra de categorías — coincidencia EXACTA con emoji), `PM_ROTATION` (rotación de noches), `MULTI_PICK_CATEGORIES` (hoy: Toners y Serums AM — pasos que admiten varios productos a la vez), `ROLE_CONFIG`/`clinical_roles` (roles: despigmentacion, regeneracion_celular, barrera, spf_facial, textura_poros).
8. **PWA:** sw.js es network-first y SOLO intercepta same-origin GET (jamás Supabase/CDN). Al cambiar sw.js, subir versión de `CACHE` (hoy `skincare-shell-v4`). localStorage es solo para cola y preferencias — **nunca** para datos.
   **Cola offline:** cada entrada es `{ row, attempts, queuedAt, lastError }`. `row` es lo ÚNICO que se inserta — si los metadatos se colaran al `insert`, cada reenvío fallaría. Se distingue fallo TRANSITORIO (sin señal: se reintenta callado, no cuenta intento) de PERMANENTE (RLS, producto borrado: cuenta intento y a los 3 se marca atorado). El banner `#sync-banner` se ve en todas las pestañas mientras haya algo pendiente, con Reintentar y Descartar. Antes una fila que fallaba en serio se quedaba encolada para siempre y en silencio.
9. **Notificaciones:** en iOS solo funcionan vía `registration.showNotification` con la PWA instalada — `new Notification()` NO existe en iOS. El push real lo manda la Edge Function `spf_push` (cron cada 15 min; la función misma filtra horario 10am–7pm GDL y gap de 2 h). Con push activo, el aviso local se desactiva (`PUSH_ENABLED_KEY`) para no duplicar. La llave VAPID pública vive en app.js (correcto); la privada SOLO en secrets de Supabase — **jamás en el repo**.
   **iOS ignora el arreglo `actions`** de `showNotification`: el botón "Ya lo apliqué" NO se renderiza en iPhone. Por eso el registro cuelga del tap en la notificación completa, que sí dispara `notificationclick`. El SW hace `postMessage({type:'LOG_SPF'})` si la app está abierta, o abre `./?log=spf` si está cerrada; `app.js` registra y limpia la URL para que un refresh no duplique. No agregar `actions` esperando que funcionen en iOS.
10. **Renombrar productos:** el vínculo robusto es `product_id`; los registros viejos por nombre dependen de los fallbacks. Si se renombra masivamente, correr de nuevo el backfill de `supabase-hardening.sql`.

## Flujos no obvios

- **Backdate** ("Registrar para"): re-renderiza Today con los datos de ESE día; logs y borrados respetan la fecha elegida. El resumen de hoy se oculta durante backdate.
- **Multi-picker** (Toners/Serums): registra UNA fila por producto seleccionado, todas con el mismo `routine_step_id`; la hidratación concatena nombres con " · ".
- **Adherencia por producto:** contra su propio calendario — prioridad `schedule_days` manual → calendario de la rutina donde es paso fijo → diario. **Es vista SECUNDARIA** desde Fase B (ver regla 11).
- **Protección solar en Progreso:** sistema de puntos por calidad × aplicaciones, no promedio simple — la rotación de protectores no castiga. El ideal diario **se modula por `sun_exposure`** (ver regla 12).
- **Reporte dermatóloga:** `openDermReport()` usa `lastReportData` (seteado por `loadHistory`) — requiere que Progreso haya cargado.
- **Hitos:** `loadHitos()` vive en su propio contenedor (`#hitos-content`), aparte
  de `loadHistory` — que tiene el orden de declaración de la regla 17 y no
  conviene tocar. Une `treatment_events` con los `started_at` de `allProducts`.
  Los días con hito marcan su celda en el heatmap y salen en el detalle del día.
- **Foto fantasma:** al elegir área se precarga la última foto de ESA área con
  URL firmada y se superpone translúcida (`mix-blend-mode: difference`: lo que
  coincide se ve negro, así que alinear es "apagar" la imagen). Si no hay foto
  previa cae a la silueta genérica. `updateGuideBtn()` debe llamarse en TODOS los
  caminos de `loadGhostPhoto`, o el botón ofrece superponer algo que no existe.
- **Buscador en pickers:** aparece solo con ≥6 productos (`PICKER_SEARCH_MIN`).
  Filtra sobre `data-search` (nombre + marca + categoría + etiquetas).
- **UV en vivo:** Open-Meteo sin key, coordenadas GDL hardcodeadas en `fetchUV()`. Además del UV actual trae el **pico del día** (`hourly=uv_index`), que solo se anuncia si todavía está por delante. El parseo es defensivo: si `hourly` falta o cambia de forma, el UV actual sigue funcionando.
- **Reaplicación en un toque:** `quickLogSpf()` registra el último protector usado y la usan tanto el FAB (`#spf-fab`, fijo en todas las pestañas) como el tap en la notificación. Tres protecciones que no hay que quitar: no adivina si no hay historial (abre el picker), no duplica dentro de 15 min (`PUSH_LOG_MIN_GAP_MIN`), y ofrece deshacer por id.
- **Cuenta regresiva:** `spfStatus()` es la ÚNICA fuente del estado de reaplicación — la usan el chip del resumen y el FAB, así que no pueden desincronizarse. Se expresa como hora objetivo ("Próxima 1:40 pm"), no como tiempo transcurrido. Se refresca cada minuto o la hora se queda pegada.

## Reglas de oro — Fase B (dosis por resultado)

> Detalle completo, rúbricas y razonamiento en **`FASE-B-matriz-activos.md`**. Léelo antes de tocar el motor de dosis.

11. **El progreso mide DOSIS, no obediencia.** "Estímulo entregado" es la vista primaria; la adherencia a rutinas vive colapsada abajo. Una aplicación cuenta completa **aunque no venga de un paso de rutina** — ese era justo el problema que Fase B resolvió (33 de 74 productos eran invisibles). No volver a hacer que el progreso dependa de `routine_step_id`.

12. **`spfScoreOf` NO suma etiquetas.** Son 3 componentes independientes: magnitud UVA (0–60), espectro (0–30), luz visible (0–10). **`pa4` y `euuva` son EQUIVALENTES** — PA++++ (PPD≥16) y el sello UVA europeo (UVA-PF ≥ SPF/3 = 16.7 en SPF50) miden lo mismo con métodos distintos. Nunca sumarlos. La falta de etiqueta PA **no** significa falta de protección: es otra normativa. Los pesos están calibrados a **lentigos**; si el diagnóstico cambia a melasma, subir luz visible a ~20 y bajar magnitud.

13. **Los ideales de SPF se modulan por `sun_exposure`.** Cara: interior 2 · normal 3 · alta 4 · playa 5 (default 3). Cuerpo: interior 1 · normal 1 · alta 2 · playa 4 — **ideal propio**, porque la piel corporal va cubierta y nadie reaplica 5 veces al día. Con el ideal de la cara, ese eje marcaba 4% y medía una expectativa irreal.

14. **La matemática de dosis vive en `pure.js`** (`doseWeekPct`, `overExposureDays`) con sus tests. Dos invariantes que no se pueden quitar: **techo diario** (aplicar dos veces no vale el doble) y **ventana semanal** (las noches de descanso del retinoide NO son falla). Sin ellos el modelo premia sobre-aplicar y vuelve a castigar la desviación.

15. **Pasarse del ideal avisa, no penaliza.** `overExposureDays` recibe **días con irritante** (lista `IRRITANTES`: solo retinoides y ácidos exfoliantes), nunca los puntos del eje `textura` — la niacinamida y el azelaico suben textura sin irritar y disparaban avisos falsos.

16. **`proteccion` no lleva número en `PRODUCT_DOSE`** (va `null`): se toma `spfScoreOf`. Una sola fuente de verdad para la calibración UVA — no duplicarla en la matriz.

17. **Orden de declaración en `loadHistory` — no reordenar.** `doseDiag` se declara junto a `dosisCara` porque `buildFocusHTML` lo usa antes (siendo `const`, moverlo abajo revienta el render por zona muerta temporal). `skinByDate`/`sunByDate` se construyen arriba, junto al cálculo de SPF que los necesita.

18. **Hidratación de checkmarks: los fallbacks van SEGMENTADOS POR SECCIÓN.** Un registro sin `routine_step_id` se asigna a AM o PM según la hora (`AM_PM_CUTOFF_HOUR`). Sin esto, un toner de la mañana marcaba también el paso "Toners" de la rutina de noche, porque ambos comparten `picker_category`. Cuerpo y pies matchean siempre (sus categorías no chocan con las de cara). Cubierto por tests desde que la lógica se movió a `pure.js`.

19. **El ✓ de un paso con picker NO registra: abre el picker.** El texto visible de esos pasos es la CATEGORÍA ("SPF Facial", "Hidratantes"), no un producto. Cuando el ✓ registraba ese texto, creaba filas sin `product_id` que además caían en `ROLE_CONFIG.spf_facial.legacyRegex` y recibían un **score asumido de 60** — protección inventada en el eje con menos margen. `checkStep` detecta `data-picker` y llama a `openPickerForCat`. Los pasos informativos (Agua Tibia, Cotton Socks) SÍ siguen registrando: su palomita se hidrata desde `product_applications` y sin fila se desmarcarían al recargar.

20. **`logApplication` devuelve el id insertado** (o `'queued'` sin conexión, o `false` si falló). Sirve para deshacer ESA fila exacta en vez de "la última con ese nombre". Sigue siendo truthy en éxito, así que los callers que solo hacen `if (!ok)` no cambian.

21. **Todo paso de rutina debería tener `product_id` o `picker_category`.** Un paso de texto libre que sí es un producto genera registros huérfanos para siempre (pasó con "Salicylic Acid Gel 2%" en Pies). Los únicos pasos que legítimamente no llevan ninguno de los dos son los informativos.

22. **La detección de reacción NO afirma causalidad.** `reactionSignal` compara
    `skin_state` 14 días antes vs 14 después de `products.started_at`. Exige
    mínimo 4 días CON registro en cada ventana y una diferencia de 0.7 puntos;
    si falta cualquiera de las dos, devuelve `null` y no se muestra nada. Detecta
    **co-introducción** (otro producto en ±7 días) y lo dice, porque ahí no se
    puede atribuir a uno solo. Reporta mejorías además de empeoramientos: enseñar
    solo lo malo sesga la lectura. **El disclaimer del render no es adorno** — un
    número junto al nombre de un producto se lee como causa aunque no lo sea.

23. **El heatmap tiene columnas propias**, semanas calendario lunes→domingo, para que la primera fila sea siempre lunes. **No usa `weekBuckets`** — esas son ventanas móviles de 7 días que alimentan las sparklines de tendencia; cambiarlas alteraría esa métrica. La semana en curso se prorratea por días transcurridos, o el lunes parece un desplome.

## Al terminar cualquier cambio

1. `node --check app.js pure.js sw.js` (sintaxis).
2. Abrir `tests.html` → todo ✅.
3. Si tocaste sw.js → subir versión de CACHE.
4. Si agregaste columnas → entregar migración SQL idempotente aparte.
5. Los archivos que se deployan siempre juntos: `index.html`, `styles.css`, `app.js` (+ `sw.js`/`pure.js`/`activos-matriz.js` si cambiaron).
6. `tests.html` tiene **77 casos** e incluye ya los de `tests-spf-agregar.js`, `tests-dosis-agregar.js` y `tests-hidratacion-agregar.js` — esos tres archivos son el historial de lo que se fue agregando, no una lista pendiente.
