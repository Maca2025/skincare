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
| `activos-matriz.js` | Config de Fase B: `DOSE_AXES` (19 ejes), `PRODUCT_DOSE` (104 productos por id), `IRRITANTES`. Solo datos, sin lógica. Se carga ENTRE `pure.js` y `app.js`. **Archivo único — ver regla 28.** |
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
- `skin_spots` + `spot_observations` — seguimiento de manchas INDIVIDUALES (las fotos rastrean áreas, esto rastrea lesiones). `zone` usa las mismas claves que `PHOTO_TYPES`; `pos_x`/`pos_y` son PORCENTAJES **de la foto apuntada por `reference_photo_id`**, no de la zona en abstracto. `spot_observations` tiene `unique (spot_id, observed_at)`: corregir el mismo día actualiza en vez de duplicar.
- `treatment_events` — hitos de tratamiento que NO son un producto: consultas, procedimientos, cambios de diagnóstico, exposición solar fuera de lo normal. `event_type` va con CHECK. La vista `treatment_timeline` la une con `products.started_at` y lleva `security_invoker = on` (sin eso, la vista saltaría el RLS de las tablas de abajo).
- **RLS activo en todo** (políticas `authenticated`). La key publishable es pública en el repo — sin RLS los datos quedan expuestos. Cualquier tabla nueva DEBE nacer con RLS.

## Reglas de oro (romperlas causa bugs ya vividos)

1. **Fechas:** día calendario = fecha LOCAL. Usar `toDateStr()` / `localDateOfISO()` / `localDayBoundsUTC()` de pure.js. **NUNCA** `toISOString().split('T')[0]` (corre el día a UTC). Iteración de rangos con `eachDateStr()` (mediodía UTC). Métricas de Progreso cortan al **cierre de ayer** (`ENDS`).
2. **Escaping:** TODO texto de la base o de la usuaria pasa por `esc()` (o `fmtRich()` para multilínea, `jsAttrEsc()` en argumentos dentro de onclick, `cssSafe()` en clases CSS) antes de entrar a innerHTML. Sin excepciones — un producto llamado `<img onerror=...>` es XSS.
3. **UI optimista con rollback:** marcar/desmarcar pasos, chips de stock, pickers — el visual cambia primero, pero si Supabase falla se REVIERTE. Desmarcar un paso **BORRA** sus filas de `product_applications` de ese día (si no, el % de adherencia se infla).
4. **Hidratación de checkmarks** (qué paso ya se hizo hoy): prioridad `routine_step_id` exacto → `product_id` → categoría → nombre. Los últimos tres son fallbacks para datos viejos — no quitarlos, no promoverlos. **Vive en `pure.js`** (`buildHydration` / `resolveStepHydration`) con 21 casos en `tests.html`: era la parte más frágil del código y la única sin pruebas. Si la tocas, corre los tests.
   **Los fallbacks NO aplican a `source='reaplicacion'`.** Se respeta el origen: una reaplicación no es un paso de rutina y no debe palomear ninguno, aunque el producto sí sea paso fijo de la rutina de ese día. Antes, reaplicar protector a media tarde marcaba solo el paso de SPF de la rutina AM — y al desmarcarlo volvía, porque `unlogRoutineStep` solo borra filas con `source='rutina'`. El corte compara contra `'reaplicacion'` EXACTO, no contra `!== 'rutina'`: los registros antiguos traen `source` null o vacío y sí deben seguir hidratando.
5. **Nada de listas duplicadas:** los selects de categoría, botones de reaplicación y la tabla comparativa SPF se **generan** de `PRODUCT_CATEGORIES` / `allProducts` / `products.tags`. Nunca hardcodear una lista que duplique lo que ya está en la base (ese patrón causó los bugs de "categoría faltante").
6. **pure.js se mantiene puro** y cada cambio ahí actualiza `tests.html`. La matemática de adherencia y `spfScoreOf` viven ahí. Pesos SPF actuales (sunspots): base 25, pa4 +30, uva400 +35, uvalong +20 (excluyente con uva400), tinted +10.
7. **Config en constantes, no regada:** `PRODUCT_CATEGORIES` (lista maestra de categorías — coincidencia EXACTA con emoji), `PM_ROTATION` (rotación de noches), `PICKER_MODALS` (qué modal y qué aviso usa cada categoría en el picker; **todas** son multi-selección — ya no existe lista blanca), `ROLE_CONFIG`/`clinical_roles` (roles: despigmentacion, regeneracion_celular, barrera, spf_facial, textura_poros).
8. **PWA:** sw.js es network-first y SOLO intercepta same-origin GET (jamás Supabase/CDN). Al cambiar sw.js, subir versión de `CACHE` (hoy `skincare-shell-v4`). localStorage es solo para cola y preferencias — **nunca** para datos.
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
- **Reporte dermatóloga:** `openDermReport()` usa `lastReportData` (seteado por `loadHistory`) — requiere que Progreso haya cargado.
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

14. **Los ideales de SPF se modulan por `sun_exposure`.** Cara: interior 2 · normal 3 · alta 4 · playa 5 (default 3). Cuerpo: interior 1 · normal 1 · alta 2 · playa 4 — **ideal propio**, porque la piel corporal va cubierta y nadie reaplica 5 veces al día. Con el ideal de la cara, ese eje marcaba 4% y medía una expectativa irreal.

15. **La matemática de dosis vive en `pure.js`** (`doseWeekPct`, `overExposureDays`) con sus tests. Dos invariantes que no se pueden quitar: **techo diario** (aplicar dos veces no vale el doble) y **ventana semanal** (las noches de descanso del retinoide NO son falla). Sin ellos el modelo premia sobre-aplicar y vuelve a castigar la desviación.

15b. **El aviso de sobre-exposición se rastrea POR ZONA, no global.** Los días
    con irritante se marcan en la zona donde se aplicó (`cara` / `cuerpo`,
    deducida del `grupo` de los ejes que toca el producto en `PRODUCT_DOSE`), y
    **solo el eje de renovación de esa zona avisa** — `EJE_IRRITANTE_POR_GRUPO`
    = `{cara: 'textura', cuerpo: 'cuerpo_textura'}`. Antes era un solo mapa
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
    `EJE_IRRITANTE_POR_GRUPO`, así que no dispara avisos de sobre-exposición:
    correcto, ningún labial es irritante. Techo 110 y 7 días ideales son
    **provisionales** (no hay datos reales todavía), igual que lo fueron los de
    `manos` — recalibrar en ~1 mes.

31. **Los filtros de Stock son estado de VISTA, no preferencia.** Viven en
    variables de módulo (`invFilterCat`/`invFilterBrand`/`invFilterAxis`), nunca
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

33. **`cuello_proteccion` se DERIVA, no se lista.** La usuaria extiende siempre
    el protector facial al cuello, así que pedirle registrarlo dos veces sería
    trabajo por un dato que ya existe. Toda aplicación con eje `proteccion`
    entrega también `cuello_proteccion`, con el mismo `spfScoreOf` y el **ideal
    de la cara** (no el de cuerpo: es la misma aplicación y la misma exposición).
    Se deriva en `loadHistory` vía `ESPEJO_SPF_CUELLO` en vez de duplicar
    productos "(Cuello)" en la base como se hizo con Manos — regla 5: un SPF
    facial nuevo queda cubierto solo. **Los duplicados "(Manos)" y los SPF
    corporales NO espejan**, o habría doble conteo.
    ⚠️ Mientras se extiendan todos los protectores, esta barra marcará lo mismo
    que Protección facial. No es un bug; se separa cuando aparezca un SPF que no
    se extienda. Para medir solo la primera aplicación del día, poner
    `ESPEJO_SPF_CUELLO` en false y dar a los SPF su entrada propia.

34. **Un producto extendido a otra zona puntúa en AMBAS, con factor.** La
    tretinoína en "cara, cuello y escote" es una sola aplicación que sí entrega
    estímulo a las dos zonas — no es doble conteo. Pero reparte la misma
    cantidad de producto sobre ~3x de superficie, así que los ejes de cuello van
    a **~0.85** del valor facial. No es castigo por desviarse (eso es lo que
    Fase B eliminó): es que la dosis por cm² baja de verdad. Los productos
    **exclusivos** de una zona conservan su valor íntegro.

35. **Los techos se calibran contra el día REAL, no contra la suma del
    catálogo.** `cuello_textura` nació en 130 copiando la proporción de la cara y
    el eje no llegaba a 100% ni haciéndolo todo bien: en el cuello no se apilan
    tantos activos (noche de tretinoína = 80, de ácidos ≈ 115). Bajó a 110.
    Corolario: **"4 noches de tretinoína = 100%" ya no es invariante** — dejó de
    serlo en la cara al recalibrar al p90 real el 2026-07-23. Lo que sí debe
    seguir cumpliéndose es el mecanismo: llegar al techo 4 días vale lo mismo que
    llegar 7 (las noches de descanso no son falla).

## Al terminar cualquier cambio

1. `node --check app.js pure.js sw.js` (sintaxis).
2. Abrir `tests.html` → todo ✅.
3. Si tocaste sw.js → subir versión de CACHE.
4. Si agregaste columnas → entregar migración SQL idempotente aparte.
5. Los archivos que se deployan siempre juntos: `index.html`, `styles.css`, `app.js` (+ `sw.js`/`pure.js`/`activos-matriz.js` si cambiaron).
6. `tests.html` tiene **77 casos** e incluye ya los de `tests-spf-agregar.js`, `tests-dosis-agregar.js` y `tests-hidratacion-agregar.js` — esos tres archivos son el historial de lo que se fue agregando, no una lista pendiente.
