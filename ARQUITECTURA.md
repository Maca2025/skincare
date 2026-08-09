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
| `activos-matriz.js` | Config de Fase B: `DOSE_AXES` (**23 ejes**), `PRODUCT_DOSE` (**87 productos**, uno por cada producto del catálogo), `PRODUCT_ZONAS` (87), `IRRITANTES` (**12**), `ZONAS_APTAS_*` y la función `zonasAptasDe` — o sea que **no es "solo datos"**, como decía este renglón. Se carga ENTRE `pure.js` y `app.js`. **Archivo único — ver regla 28.** Verificado 2026-08-09: los 87 ids cuadran exactamente con el catálogo de Supabase, sin huérfanos en ninguna dirección. |
| `app.js` | Toda la lógica. Script clásico (no módulos), funciones globales llamadas desde `onclick` en HTML. Se carga DESPUÉS de pure.js y activos-matriz.js. |
| `sw.js` | Service worker: cache network-first del shell + handlers de Web Push. |
| `manifest.webmanifest`, `icon-192/512.png` | PWA instalable. |
| `tests.html` | Tests de pure.js — abrir en navegador. **94 casos** (no 77). |
| `spf-push-function.ts` | Edge Function `spf_push`. ⚠️ **No está en el repositorio** — vive solo en el dashboard de Supabase. Consecuencia: `tests-spf-push-paridad.js` nunca ha podido comparar nada y **sale en verde sin ejecutar una sola aserción**. Justo la prueba que existe para evitar que la app y el push se separen en silencio es la que está callada. Para que sirva, hay que traer una copia del `.ts` al repo. |
| SQL sueltos (`supabase-hardening.sql`, `migracion-*.sql`, `reparacion-*.sql`, `push-setup.sql`, `plantilla-alta-productos.sql`) | Se corren UNA vez en el SQL Editor; deben ser idempotentes (`if not exists`). ⚠️ **Ninguno está hoy en el repositorio.** Si se necesita repetir una migración, no hay de dónde. |

**Sin build, sin frameworks, sin npm.** No introducir bundlers, módulos ES ni dependencias — la única lib externa es supabase-js por CDN.

## Datos (Supabase)

- `products` — catálogo maestro. Campos clave: `category` (texto EXACTO con emoji, ver lista abajo), `clinical_roles` (array), `schedule_days` (0=Dom..6=Sáb, null=diario), `tags` (jsonb, chips + puntuación SPF), `tier`, `status` (ok/low/out), `opened_at`+`pao_months` (caducidad), `logged_as` (nombre con que se registra), `started_at` (fecha LOCAL de introducción — `date`, no timestamptz).
- `routines` + `routine_steps` — rutinas por sección (am/pm/body/feet) con `schedule_days`; pasos con `product_id` fijo O `picker_category` (rotar) O informativos.
- `product_applications` — **fuente única de verdad.** Todo lo demás (Progreso, Historial, rachas, checkmarks) se CALCULA de aquí. Campos: `product_name`, `product_id`, `applied_at` (UTC), `source` ('rutina'/'reaplicacion'), `routine_step_id`.
- `daily_notes` — nota + `skin_state` (1–5) + `sun_exposure` (interior/normal/alta/playa), key `note_date`.
- `progress_photos` — `photo_url` guarda SOLO el nombre de archivo; bucket `progress-photos` es PRIVADO → URLs firmadas con `createSignedUrls` (batch, nunca una por una).
- `push_subscriptions` — suscripciones Web Push (+`last_notified_at` para no duplicar avisos).
- `skin_spots` + `spot_observations` — seguimiento de manchas INDIVIDUALES (las fotos rastrean áreas, esto rastrea lesiones). `zone` usa las mismas claves que `PHOTO_TYPES`; `pos_x`/`pos_y` son PORCENTAJES **de la foto apuntada por `reference_photo_id`**, no de la zona en abstracto. `spot_observations` tiene `unique (spot_id, observed_at)`: corregir el mismo día actualiza en vez de duplicar.
- `treatment_events` — hitos de tratamiento que NO son un producto: consultas, procedimientos, cambios de diagnóstico, exposición solar fuera de lo normal. `event_type` va con CHECK. La vista `treatment_timeline` la une con `products.started_at` y lleva `security_invoker = on` (sin eso, la vista saltaría el RLS de las tablas de abajo).
- **RLS activo en todo** (políticas `authenticated`). La key publishable es pública en el repo — sin RLS los datos quedan expuestos. Cualquier tabla nueva DEBE nacer con RLS.
- ⚠️ **TABLAS MUERTAS — no escribir en ellas, no "reconectarlas"** (verificado el 2026-08-09 contra `app.js`: cero referencias a cada una).
  - `inventory` (`product_id text` PK, `status`, `updated_at`) — el stock vive en `products.status` y lo escribe la pestaña Stock. `inventory` guarda 5 filas con claves propias (`cleanser`, `toner-aha`…) que ni siquiera son uuid y no existen en `products`. Es anterior al catálogo actual. **No copiar sus valores a `products.status`**: son datos viejos, y `products.status` es lo que se mantiene al día.
  - `daily_logs` (contadores `am_done`/`pm_done`/`body_done`/`feet_done`) — medía "pasos hechos entre pasos totales", el modelo que la v20 del service worker retiró explícitamente. La constancia diaria se calcula del motor de dosis sobre `product_applications`. La única cosa que escribía aquí era `skincare-routine-fix.html`, ya borrado.

## Reglas de oro (romperlas causa bugs ya vividos)

1. **Fechas:** día calendario = fecha LOCAL. Usar `toDateStr()` / `localDateOfISO()` / `localDayBoundsUTC()` de pure.js. **NUNCA** `toISOString().split('T')[0]` (corre el día a UTC). Iteración de rangos con `eachDateStr()` (mediodía UTC). Métricas de Progreso cortan al **cierre de ayer** (`ENDS`).
2. **Escaping:** TODO texto de la base o de la usuaria pasa por `esc()` (o `fmtRich()` para multilínea, `jsAttrEsc()` en argumentos dentro de onclick, `cssSafe()` en clases CSS) antes de entrar a innerHTML. Sin excepciones — un producto llamado `<img onerror=...>` es XSS.
3. **UI optimista con rollback:** marcar/desmarcar pasos, chips de stock, pickers — el visual cambia primero, pero si Supabase falla se REVIERTE. Desmarcar un paso **BORRA** sus filas de `product_applications` de ese día (si no, el % de adherencia se infla).
4. **Hidratación de checkmarks** (qué paso ya se hizo hoy): prioridad `routine_step_id` exacto → `product_id` → categoría → nombre. Los últimos tres son fallbacks para datos viejos — no quitarlos, no promoverlos. **Vive en `pure.js`** (`buildHydration` / `resolveStepHydration`) con 21 casos en `tests.html`: era la parte más frágil del código y la única sin pruebas. Si la tocas, corre los tests.
   **Los fallbacks NO aplican a `source='reaplicacion'`.** Se respeta el origen: una reaplicación no es un paso de rutina y no debe palomear ninguno, aunque el producto sí sea paso fijo de la rutina de ese día. Antes, reaplicar protector a media tarde marcaba solo el paso de SPF de la rutina AM — y al desmarcarlo volvía, porque `unlogRoutineStep` solo borra filas con `source='rutina'`. El corte compara contra `'reaplicacion'` EXACTO, no contra `!== 'rutina'`: los registros antiguos traen `source` null o vacío y sí deben seguir hidratando.
5. **Nada de listas duplicadas:** los selects de categoría, botones de reaplicación y la tabla comparativa SPF se **generan** de `PRODUCT_CATEGORIES` / `allProducts` / `products.tags`. Nunca hardcodear una lista que duplique lo que ya está en la base (ese patrón causó los bugs de "categoría faltante").
6. **pure.js se mantiene puro** y cada cambio ahí actualiza `tests.html`. La matemática de adherencia y `spfScoreOf` viven ahí.
   ⚠️ **Corregido 2026-08-09:** esta regla citaba los pesos del **modelo aditivo VIEJO** ("base 25, pa4 +30, uva400 +35, uvalong +20, tinted +10") — el mismo que la regla 13 declara corregido más abajo. El documento se contradecía consigo mismo. Los pesos reales son los tres componentes NO acumulables de la regla 13: magnitud 60/43/27/**21** · espectro 30/15 · visible 10.
   ⚠️ **La segunda mitad tampoco se cumple hoy.** `tests.html` no cubre 13 símbolos de `pure.js`; cinco están cubiertos aparte en `tests-spf-ritmo.js`. **`localDayBoundsUTC` y `spfPosiblesEnFecha` no tienen prueba en ningún lado**, y la segunda decide el ideal dinámico de SPF, o sea que alimenta directamente los porcentajes de Progreso. Los casos de `tests-zonas-agregar.js` nunca se pegaron en `tests.html` aunque solo necesitan `pure.js` — el mismo patrón que denuncia la regla 28.
7. **Config en constantes, no regada:** `PRODUCT_CATEGORIES` (lista maestra de categorías — coincidencia EXACTA con emoji), `PM_ROTATION` (rotación de noches), `PICKER_MODALS` (qué modal y qué aviso usa cada categoría en el picker; **todas** son multi-selección — ya no existe lista blanca), `ROLE_CONFIG`/`clinical_roles` (roles: despigmentacion, regeneracion_celular, barrera, spf_facial, textura_poros).
8. **PWA:** sw.js es network-first y SOLO intercepta same-origin GET (jamás Supabase/CDN). Al cambiar sw.js, subir versión de `CACHE` (hoy `skincare-shell-v21`). localStorage es solo para cola y preferencias — **nunca** para datos.
   **Cola offline:** cada entrada es `{ row, attempts, queuedAt, lastError }`. `row` es lo ÚNICO que se inserta — si los metadatos se colaran al `insert`, cada reenvío fallaría. Se distingue fallo TRANSITORIO (sin señal: se reintenta callado, no cuenta intento) de PERMANENTE (RLS, producto borrado: cuenta intento y a los 3 se marca atorado). El banner `#sync-banner` se ve en todas las pestañas mientras haya algo pendiente, con Reintentar y Descartar. Antes una fila que fallaba en serio se quedaba encolada para siempre y en silencio.
9. **Notificaciones:** en iOS solo funcionan vía `registration.showNotification` con la PWA instalada — `new Notification()` NO existe en iOS. El push real lo manda la Edge Function `spf_push` (cron cada 15 min; la función misma filtra horario 10am–7pm GDL y gap de 2 h). Con push activo, el aviso local se desactiva (`PUSH_ENABLED_KEY`) para no duplicar. La llave VAPID pública vive en app.js (correcto); la privada SOLO en secrets de Supabase — **jamás en el repo**.
   **iOS ignora el arreglo `actions`** de `showNotification`: el botón "Ya lo apliqué" NO se renderiza en iPhone. Por eso el registro cuelga del tap en la notificación completa, que sí dispara `notificationclick`. El SW hace `postMessage({type:'LOG_SPF'})` si la app está abierta, o abre `./?log=spf` si está cerrada; `app.js` registra y limpia la URL para que un refresh no duplique. No agregar `actions` esperando que funcionen en iOS.
10. **Renombrar productos:** el vínculo robusto es `product_id`; los registros viejos por nombre dependen de los fallbacks. Si se renombra masivamente, correr de nuevo el backfill de `supabase-hardening.sql`.

11. **Nombre de producto en pantalla = marca + nombre.** Un producto SIEMPRE se pinta con `prodLabelHTML(p)` — o `prodLabelText(p)` donde solo cabe texto plano (`<option>`, toasts, `textContent`). La marca va delante, dentro de `<span class="p-brand">` (azul acero `#4A6FA5`, itálica, weight 300, hereda el tamaño del contenedor). Un registro ya guardado se pinta con `loggedLabelHTML(product_name)`, que resuelve string → producto con `productByLoggedName` y parte por `" · "` (un paso multi-picker guarda varios). **Es solo presentación:** lo que se ESCRIBE en `product_applications` sigue siendo `logged_as` o `"emoji nombre"` — meter la marca ahí rompería la hidratación de checkmarks y todo el histórico ya registrado. Si el producto ya no está en Stock, se muestra el texto guardado escapado en vez de perder el registro. Stock, el editor de rutinas y la línea del paso conservan su marca en su propia línea (`.inv-brand` / `.rout-step-brand` / `.sc-brand`), con el mismo azul.

## Flujos no obvios

- **Backdate** ("Registrar para"): re-renderiza Today con los datos de ESE día; logs y borrados respetan la fecha elegida. El resumen de hoy se oculta durante backdate.
- **Multi-picker (TODO paso con `picker_category`)**: un solo picker, `openMultiPickerByCat`, para cualquier categoría — incluidos SPF Facial y Corporal. Registra UNA fila por producto seleccionado, todas con el mismo `routine_step_id`; la hidratación concatena nombres con " · ". Reabrir el picker de un paso ya marcado **añade** registros (no reconcilia): así una reaplicación de SPF sigue sumando aplicaciones del día (reglas 13–14). Desmarcar el paso sí borra todas sus filas de ese día.
- **Adherencia por producto:** contra su propio calendario — prioridad `schedule_days` manual → calendario de la rutina donde es paso fijo → diario. **Es vista SECUNDARIA** desde Fase B (ver regla 12).
- **Protección solar en Progreso:** sistema de puntos por calidad × aplicaciones, no promedio simple — la rotación de protectores no castiga. El ideal diario **se modula por `sun_exposure`** (ver regla 13).
- **Reporte dermatóloga:** `openDermReport()` usa `lastReportData` (seteado por `loadHistory`) — requiere que Progreso haya cargado. **Desde el 2026-08-09 reporta ESTÍMULO ENTREGADO, no adherencia** (ver regla 36). `lastReportData` lleva los ejes ya aplanados (`{key, icon, label, pct, overDays}`) por zona, a propósito: el reporte no debe conocer la forma interna de `DOSE_AXES`.
- **Hitos:** `loadHitos()` vive en su propio contenedor (`#hitos-content`), aparte
  de `loadHistory` — que tiene el orden de declaración de la regla 18 y no
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

12. **El progreso mide DOSIS, no obediencia.** "Estímulo entregado" es la vista primaria; la adherencia a rutinas vive colapsada abajo. Una aplicación cuenta completa **aunque no venga de un paso de rutina** — ese era justo el problema que Fase B resolvió (33 de 74 productos eran invisibles). No volver a hacer que el progreso dependa de `routine_step_id`.

13. **`spfScoreOf` NO suma etiquetas.** Son 3 componentes independientes: magnitud UVA (0–60), espectro (0–30), luz visible (0–10). **`pa4` y `euuva` son EQUIVALENTES** — PA++++ (PPD≥16) y el sello UVA europeo (UVA-PF ≥ SPF/3 = 16.7 en SPF50) miden lo mismo con métodos distintos. Nunca sumarlos. La falta de etiqueta PA **no** significa falta de protección: es otra normativa. Los pesos están calibrados a **lentigos**; si el diagnóstico cambia a melasma, subir luz visible a ~20 y bajar magnitud.

14. **Los ideales de SPF se modulan por `sun_exposure`.**
    ⚠️ **Actualizado 2026-08-09:** el ideal FACIAL ya NO es una tabla fija. Desde el 2026-08-01 se calcula con `spfPosiblesEnFecha` (UV histórico + ocaso + hora de despertar): cuántas aplicaciones caben de verdad ese día. `IDEAL_SPF_BY_SUN` (interior 2 · normal 3 · alta 4 · playa 5 · **actividad 8**, default 3) quedó como **respaldo** para cuando falta el dato histórico.
    ⚠️ **Desincronización conocida:** `IDEAL_BODY_SPF_BY_SUN` tiene 4 claves y **le falta `actividad`** — un día marcado 🏃 Actividad cae al default corporal de 1 sin avisar. Son cuatro listas del mismo vocabulario que hay que tocar juntas: `SUN_EXPOSURES`, `IDEAL_SPF_BY_SUN`, `IDEAL_BODY_SPF_BY_SUN` y `SPF_GAP_POR_EXPOSICION` (pure.js).
    Cuerpo: interior 1 · normal 1 · alta 2 · playa 4 — **ideal propio**, porque la piel corporal va cubierta y nadie reaplica 5 veces al día. Con el ideal de la cara, ese eje marcaba 4% y medía una expectativa irreal.

15. **La matemática de dosis vive en `pure.js`** (`doseWeekPct`, `overExposureDays`) con sus tests. Dos invariantes que no se pueden quitar: **techo diario** (aplicar dos veces no vale el doble) y **ventana semanal** (las noches de descanso del retinoide NO son falla). Sin ellos el modelo premia sobre-aplicar y vuelve a castigar la desviación.

15b. **El aviso de sobre-exposición se rastrea POR ZONA, no global.** Los días
    con irritante se marcan en la zona donde se aplicó (`cara` / `cuerpo`,
    deducida del `grupo` de los ejes que toca el producto en `PRODUCT_DOSE`), y
    **solo el eje de renovación de esa zona avisa** — `EJE_IRRITANTE_POR_ZONA`
    = `{cara: 'textura', cuerpo: 'cuerpo_textura', cuello: 'cuello_textura', manos: 'manos_textura'}`
    (se llamaba `EJE_IRRITANTE_POR_GRUPO` y tenía 2 entradas; cuello y manos
    entraron al ganar eje de textura propio — el cuello sobre todo, porque ahí
    la tretinoína irrita ANTES que en la cara). Antes era un solo mapa
    global que cada eje comparaba contra su propio `diasIdeales`: 5 noches de
    tretinoína facial hacían que **`cabello`** (diasIdeales 3) avisara "1 día de
    más con retinoide", sin que exista un solo producto capilar irritante. Si se
    agregan ejes o zonas, actualizar ese mapa — un eje que no esté ahí
    simplemente nunca avisa, que es el comportamiento seguro.

16. **Pasarse del ideal avisa, no penaliza.** `overExposureDays` recibe **días con irritante** (lista `IRRITANTES`: solo retinoides y ácidos exfoliantes), nunca los puntos del eje `textura` — la niacinamida y el azelaico suben textura sin irritar y disparaban avisos falsos.

17. **`proteccion` no lleva número en `PRODUCT_DOSE`** (va `null`): se toma `spfScoreOf`. Una sola fuente de verdad para la calibración UVA — no duplicarla en la matriz.

18. **Orden de declaración en `loadHistory` — no reordenar.** `doseDiag` se declara junto a `dosisCara` porque `buildFocusHTML` lo usa antes (siendo `const`, moverlo abajo revienta el render por zona muerta temporal). `skinByDate`/`sunByDate` se construyen arriba, junto al cálculo de SPF que los necesita.

19. **Hidratación de checkmarks: los fallbacks van SEGMENTADOS POR SECCIÓN.** Un registro sin `routine_step_id` se asigna a AM o PM según la hora (`AM_PM_CUTOFF_HOUR`). Sin esto, un toner de la mañana marcaba también el paso "Toners" de la rutina de noche, porque ambos comparten `picker_category`. Cuerpo y pies matchean siempre (sus categorías no chocan con las de cara). Cubierto por tests desde que la lógica se movió a `pure.js`.

20. **El ✓ de un paso con picker NO registra: abre el picker.** El texto visible de esos pasos es la CATEGORÍA ("SPF Facial", "Hidratantes"), no un producto. Cuando el ✓ registraba ese texto, creaba filas sin `product_id` que además caían en `ROLE_CONFIG.spf_facial.legacyRegex` y recibían un **score asumido de 60** — protección inventada en el eje con menos margen. `checkStep` detecta `data-picker` y llama a `openPickerForCat`. Los pasos informativos (Agua Tibia, Cotton Socks) SÍ siguen registrando: su palomita se hidrata desde `product_applications` y sin fila se desmarcarían al recargar.

21. **`logApplication` devuelve el id insertado** (o `'queued'` sin conexión, o `false` si falló). Sirve para deshacer ESA fila exacta en vez de "la última con ese nombre". Sigue siendo truthy en éxito, así que los callers que solo hacen `if (!ok)` no cambian.

22. **Todo paso de rutina debería tener `product_id` o `picker_category`.** Un paso de texto libre que sí es un producto genera registros huérfanos para siempre (pasó con "Salicylic Acid Gel 2%" en Pies). Los únicos pasos que legítimamente no llevan ninguno de los dos son los informativos.

23. **La detección de reacción NO afirma causalidad.** `reactionSignal` compara
    `skin_state` 14 días antes vs 14 después de `products.started_at`. Exige
    mínimo 4 días CON registro en cada ventana y una diferencia de 0.7 puntos;
    si falta cualquiera de las dos, devuelve `null` y no se muestra nada. Detecta
    **co-introducción** (otro producto en ±7 días) y lo dice, porque ahí no se
    puede atribuir a uno solo. Reporta mejorías además de empeoramientos: enseñar
    solo lo malo sesga la lectura. **El disclaimer del render no es adorno** — un
    número junto al nombre de un producto se lee como causa aunque no lo sea.

24. **El mapa de manchas NO evalúa riesgo.** `shade` (1–5) es apreciación visual
    de la usuaria, no colorimetría, y `spotTrend` compara primera contra última
    observación —sin regresión: con 3 o 4 puntos subjetivos, ajustar una recta
    da falsa precisión—. Sirve para el seguimiento de un TRATAMIENTO. El estado
    `vigilancia` existe para no olvidar preguntarlo en consulta, **no para que la
    app dictamine**. No agregar aquí puntajes de riesgo, ABCDE automatizado ni
    nada que se lea como diagnóstico: una lesión que cambia, sangra o pica es de
    dermatoscopia.

25. **La posición de una mancha NO viaja sin su foto.** `pos_x`/`pos_y` son % de
    la foto en `reference_photo_id`, no de la zona. La primera versión mostraba
    siempre la foto más reciente del área: la referencia cambiaba sola con cada
    foto nueva y el marcador acababa señalando otro punto de la cara, porque los
    ángulos varían entre tomas. Reglas que se derivan y no hay que romper:
    cambiar de referencia **borra** la posición (unas coordenadas de otro
    encuadre no significan nada), re-anclar es una acción **explícita** de la
    usuaria (`remarkOnLatest`), cambiar de zona invalida la referencia, y
    `reference_photo_id` es `ON DELETE SET NULL` — borrar una foto no puede
    llevarse el historial de una lesión; la app detecta la posición huérfana y
    pide volver a marcar.

26. **La tira de recortes no mide, muestra.** `cropStripHTML` amplía la misma
    región (`pos_x`/`pos_y`) en cada foto del área y las alinea por fecha. El
    recorte es CSS puro (`background-size` + `background-position` en %): no hace
    falta conocer la relación de aspecto ni usar canvas. **No se calcula ningún
    número de "cuánto aclaró"** — con luz y encuadre variables sería precisión
    inventada; la usuaria compara con el ojo. La limitación es inherente y está
    dicha en la UI: usa las mismas coordenadas en todas las fotos, así que solo
    apunta al mismo sitio si el encuadre fue consistente (para eso está la foto
    fantasma). Las URL firmadas pasan por `cssUrlSafe` antes de entrar al
    atributo `style`: es un dato llegando a innerHTML y le aplica la regla 2.
    Las fotos se firman **en un solo lote**, nunca una por una.

27. **El heatmap tiene columnas propias**, semanas calendario lunes→domingo, para que la primera fila sea siempre lunes. **No usa `weekBuckets`** — esas son ventanas móviles de 7 días que alimentan las sparklines de tendencia; cambiarlas alteraría esa métrica. La semana en curso se prorratea por días transcurridos, o el lunes parece un desplome.

28. **La matriz de dosis vive en UN solo archivo.** Durante un tiempo hubo un
    `activos-matriz-agregar.js` con entradas "pendientes de pegar" en
    `activos-matriz.js`. Nunca se pegaron: 11 productos pasaron semanas
    invisibles para el motor de dosis mientras el aviso de deriva de Stock los
    marcaba. Partir la matriz en dos archivos convierte un dato en una tarea
    pendiente, y las tareas pendientes se olvidan. **Un producto nuevo se agrega
    directo a `PRODUCT_DOSE`, en la misma sesión en que se da de alta.** Si hace
    falta redactar el razonamiento, va en el comentario de la propia entrada.

29. **Ningún producto se queda sin eje.** El criterio viejo era que los labiales
    quedaran fuera de todo ("los labios no son piel facial"). La premisa es
    correcta pero la conclusión no: de ahí no se sigue que no haya nada que
    medir, se sigue que necesitan eje PROPIO — igual que `pies`, `cabello` y
    `manos`. Por eso existe `labios` (2026-07-25). Un producto sin eje no es
    neutral: es un producto que la usuaria compra, aplica y registra, y que el
    Progreso trata como si no existiera. **Si un producto no encaja en ningún
    eje, la respuesta es un eje nuevo, no una entrada vacía.**

30. **`labios` es zona propia y no toca la cara.** No entra en `proteccion`
    aunque el bálsamo lleve SPF50 (ese eje mide la cara y su ideal se modula por
    aplicaciones faciales: un bálsamo inflaría la métrica sin cubrir un cm² de
    mejilla), y **no usa `spfScoreOf`** porque su puntaje es mixto
    —hidratación + protección—, no protección pura. Su grupo no está en
    `EJE_IRRITANTE_POR_ZONA`, así que no dispara avisos de sobre-exposición:
    correcto, ningún labial es irritante. Techo 110 y 7 días ideales son
    **provisionales** (no hay datos reales todavía), igual que lo fueron los de
    `manos` — recalibrar en ~1 mes.

31. **Los filtros de Stock son estado de VISTA, no preferencia.** Viven en
    variables de módulo (`invFilterCat`/`invFilterBrand`/`invFilterZona`/`invFilterFuncion` — el filtro por eje se partió en zona y función con el refactor función × zona; `invFilterAxis` ya no existe), nunca
    en localStorage: si sobrevivieran a la recarga, abrir Stock con un filtro
    puesto de ayer se lee como "me faltan productos". Las opciones se **generan**
    del catálogo real (regla 5) — una lista escrita a mano se desincroniza en
    cuanto se da de alta una categoría o marca nueva. La marca se agrupa
    cortando en el `·` porque el campo trae descriptores pegados
    (`SKIN1004 · 30ml`). Un producto que toca varios ejes aparece al filtrar por
    **cada uno** de ellos. El resumen ✅/⚠️/❌ cuenta lo FILTRADO —con un filtro
    puesto, "3 sin stock" tiene que referirse a lo que estás viendo—, pero el
    **aviso de deriva se pinta siempre contra el catálogo completo**: es una
    alerta de mantenimiento y ocultarla por un filtro sería la forma de volver a
    olvidarla.

32. **El cuello es zona propia con los 5 ejes de la cara** (`cuello_*`, 2026-07-25).
    Antes estaba partido: dos productos de cuello puntuaban en ejes de CARA y uno
    en ejes de CUERPO, así que ninguna métrica decía nada real sobre la zona.
    Lleva los 5 ejes y no un subconjunto porque su piel se comporta como piel
    facial —es más fina, con menos densidad sebácea y menos soporte dérmico—. En
    particular **conserva `cuello_textura` aunque "poros" no sea un tema ahí**:
    es el eje que dispara el aviso de sobre-exposición a irritantes, y el cuello
    es donde la tretinoína irrita ANTES que en la cara.

33. **`cuello_proteccion` es DATO, no regla derivada.** La usuaria extiende
    siempre el protector facial al cuello, así que ese estímulo tiene que
    contarse — la pregunta es *cómo*.
    ⚠️ **REESCRITA 2026-08-09. La versión anterior de esta regla describía un
    mecanismo que ya no existe** y mandaba tocar una palanca inexistente. Decía
    que `cuello_proteccion` se derivaba en `loadHistory` de toda aplicación con
    eje `proteccion`, vía una constante `ESPEJO_SPF_CUELLO`. **Esa constante no
    existe en el proyecto** (cero coincidencias en todos los archivos): el
    espejo se retiró al pasar al modelo función × zona.
    Hoy funciona así: los 12 SPF faciales llevan `'cuello'` (y `'manos'`)
    explícito en `PRODUCT_ZONAS`, y el motor recorre zonas × funciones una sola
    vez. **Verificado: no hay doble conteo** — cada aplicación entrega
    `cuello_proteccion` exactamente una vez.
    Esto es deliberado y no hay que "arreglarlo": convertir una regla oculta en
    un dato explícito era el objetivo del refactor. Si se quitara `'cuello'` de
    esas listas, el histórico de protección de cuello se iría a cero de golpe;
    `tests-zonas-registro.js` tiene una prueba que lo impide.

34. **Un producto extendido a otra zona puntúa en AMBAS, con el valor íntegro.**
    La tretinoína en "cara, cuello y escote" es una sola aplicación que sí
    entrega estímulo a las dos zonas — no es doble conteo.
    ⚠️ **CORREGIDA 2026-08-09. La versión anterior mandaba aplicar un factor de
    ~0.85 a los ejes de la zona extendida. Ese factor NO existe en el código y
    fue retirado a propósito**, a petición de la usuaria: solo se justificaba en
    productos de dosis medida, y para una crema simplemente te sirves más. El
    único `0.85` que hay en `app.js` es una opacidad de color en el heatmap.
    **Un asistente que obedeciera la versión anterior de esta regla
    reintroduciría una dilución eliminada deliberadamente.** Ese fue el motivo
    de reescribirla.
    Nota: el texto de la tarjeta de cuello en Progreso todavía dice que los
    productos extendidos "puntúan algo menos". Es un resto del mismo cambio y
    conviene corregirlo.

35. **Los techos se calibran contra el día REAL, no contra la suma del
    catálogo.** `cuello_textura` nació en 130 copiando la proporción de la cara y
    el eje no llegaba a 100% ni haciéndolo todo bien: en el cuello no se apilan
    tantos activos (noche de tretinoína = 80, de ácidos ≈ 115). Bajó a 110.
    Corolario: **"4 noches de tretinoína = 100%" ya no es invariante** — dejó de
    serlo en la cara al recalibrar al p90 real el 2026-07-23. Lo que sí debe
    seguir cumpliéndose es el mecanismo: llegar al techo 4 días vale lo mismo que
    llegar 7 (las noches de descanso no son falla).

36. **El reporte para la dermatóloga mide DOSIS, igual que la app.** Hasta el
    2026-08-09 `openDermReport` imprimía "Adherencia por objetivo" con los cinco
    números del modelo de roles, mientras la app medía estímulo entregado. Ni
    una sola barra de la Fase B llegaba a la consulta — era la mayor divergencia
    del proyecto. Ahora el documento lleva los ejes de dosis agrupados por zona
    (cara · cuello y escote · resto), con los días de sobre-exposición marcados
    junto al eje que los produjo, porque es lo único del reporte que puede
    cambiar una indicación médica. **La adherencia por rol NO vuelve a este
    documento**: sigue viva dentro de la app, en su sección plegable, que es lo
    que autoriza la regla 12. Un médico no necesita saber si seguiste tu propio
    plan, sino qué recibió tu piel.

37. **La "constancia" no promedia escalas distintas.** Era
    `[prot, despig, barr, rege]`: el primero en puntos de dosis y los otros tres
    en porcentaje de días cumplidos del modelo de roles. Sumar dos unidades y
    dividir entre cuatro no produce una media, produce un número sin unidad — y
    ese número se enseñaba en Progreso y en el reporte médico. Desde el
    2026-08-09 es el promedio de los ejes de dosis de la CARA, todos en la misma
    escala. **Si alguna vez se le suman métricas nuevas, tienen que venir del
    mismo motor.**

38. **No reintroducir el "camino de 16 semanas".** La tarjeta
    `.pj-card` ("🗺️ Tu camino · Semana N de 16", con los hitos
    Barrera · Brillo · Aclaran · Visible) se retiró el 2026-08-09. Avanzaba por
    **tiempo transcurrido** (`weekNum / 16`), que es exactamente el modelo que
    la Fase B eliminó, y sus hitos eran la cronología del tratamiento
    anti-melasma leída como promesa de resultados por calendario. El dato que sí
    servía —desde cuándo llevas tratamiento— sobrevive en `treatStart`, que
    **se deriva del motor de dosis** (primer día con puntos en `aclarado` o
    `textura` de cara) y ya no de `hasRole(...)`. Se reporta en el documento de
    la dermatóloga. Las clases `.pj-*` siguen en `styles.css` y se pueden
    limpiar.

## Deuda conocida (auditoría del 2026-08-09)

Lo verificado y todavía sin arreglar, en orden de gravedad. Cada punto está
comprobado contra el código, no supuesto.

1. **`unlogRoutineStep` puede no borrar nada y decir que sí.** Borra con
   `.eq('source','rutina')`, pero los registros viejos traen `source` en null y
   **sí** palomean el paso (`pure.js` solo excluye `'reaplicacion'`). La función
   devuelve `true` igual, así que se ve "↩️ Paso desmarcado" y al recargar el
   paso vuelve a estar hecho. El respaldo por nombre además compara contra el
   texto del DOM, que difiere de lo guardado si el producto tiene `logged_as`.
2. **Cambiar el estado de piel puede pisar la nota del día.** Los upserts de
   `daily_notes` mandan `notes` leído del `<textarea>` en pantalla; si la nota se
   escribió en otro dispositivo y aún no se cargó, se sobrescribe.
3. **El backdate no aplica a las notas.** Los cuatro upserts a `daily_notes`
   usan siempre `TODAY_STR`, mientras que `product_applications` sí respeta la
   fecha elegida.
4. **Destildar todos los roles clínicos resucita el legado.** El formulario
   escribe `clinical_roles: []` y `hasRole` cae a `clinical_role` (singular)
   cuando el array está vacío. Esa columna nunca se escribe desde la app.
5. **`pa4 ≡ euuva` está implementado en un solo lado.** `pure.js` los trata como
   equivalentes (regla 13); la tabla comparativa solo mira `pa4`, así que un
   SPF50 europeo con sello UVA saca 60/60 de magnitud y una ✗ en la columna
   PA++++ de la misma pantalla.
6. **`products.sort_order` nunca se escribe** aunque el catálogo se ordene por
   él: los productos creados desde la app quedan sin orden definido.
7. **Dos vocabularios de zona sin una sola clave en común.** `PHOTO_TYPES`
   (`cara-derecha`, `pecho`, `brazo`, `mano`, `pie`, `pierna`) gobierna
   `progress_photos.photo_type` y `skin_spots.zone`; `ZONAS` (`cara`, `cuello`,
   `cuerpo`, `manos`, `pies`, `labios`, `cabello`) gobierna los ejes de dosis.
   No hay traducción. Consecuencia: **no se puede responder cuánto estímulo
   recibió la zona donde está una mancha**, que es el propósito del tracker; y
   es imposible marcar una mancha en cuello, labios o cabello. Ojo con
   `zonaLabel` (lee `ZONAS`) y `zoneLabel` (lee `PHOTO_TYPES`), que difieren en
   una letra. Esto es rediseño, no limpieza.
8. **Residuos sin llamar:** `ejesDeProducto`, `quickLog`,
   `REAPP_EXCLUDE_CATEGORIES` (lista vacía), la rama `focusRoles` de
   `buildFocusHTML` (solo corre si la matriz está vacía, o sea nunca) con textos
   obsoletos, `.spf-fab-none` en CSS (estado inexistente), y la categoría
   `"✋ Manos"` declarada sin ningún producto que la use.
9. **Constantes duplicadas** (contra la regla 5): `LEGACY_ROLE_MAP` escrito dos
   veces carácter por carácter; `ZONA_SOLO_FUNCION` y `FUNCION_EXCLUSIVA`
   duplicando `ZONAS[].soloFuncion`; los chips de rol clínico escritos a mano en
   `index.html` porque `ROLE_CONFIG` vive DENTRO de `loadHistory()`.
10. **Vestigios de melasma:** `manifest.webmanifest` todavía describe la app
    como "adherencia para melasma" — es el único texto de melasma que la usuaria
    ve, al instalar la PWA. La clave `melasma:` sigue nombrando las columnas de
    `COMPARE_COLS`. `matriz-activos-revision.csv` tiene 19 ids que ya no existen
    (5 fusionados + los 14 "(Manos)") y sus justificaciones siguen redactadas
    contra melasma.
11. **`activos-matriz-agregar.js` sigue en el repo.** Sus 11 entradas ya están
    pegadas, pero **2 tienen valores del vocabulario anterior** (`cuerpo_barrera`
    en vez de `barrera`, y el sérum labial vacío): pegarlas hoy haría que esos
    productos puntuaran 0 en silencio. La regla 28 avisa contra este archivo.

## Al terminar cualquier cambio

1. `node --check app.js pure.js sw.js` (sintaxis).
2. Abrir `tests.html` → todo ✅.
3. Si tocaste sw.js → subir versión de CACHE.
4. Si agregaste columnas → entregar migración SQL idempotente aparte.
5. Los archivos que se deployan siempre juntos: `index.html`, `styles.css`, `app.js` (+ `sw.js`/`pure.js`/`activos-matriz.js` si cambiaron).
6. `tests.html` tiene **94 casos** e incluye ya los de `tests-spf-agregar.js`, `tests-dosis-agregar.js` y `tests-hidratacion-agregar.js` — esos tres archivos son el historial de lo que se fue agregando, no una lista pendiente. **`tests-zonas-agregar.js` SÍ está pendiente**: sus 13 casos nunca se pegaron, aunque solo necesitan `pure.js`.
7. Las suites de node (`tests-spf-ritmo.js`, `tests-zonas-registro.js`) se corren con `node <archivo>` desde la carpeta del repo. **Nunca fijar conteos a mano en una prueba** ("siguen siendo 86 productos"): caduca sola al dar de alta un producto y enseña a ignorar el rojo. Se corrigieron dos así el 2026-08-09.
