// ============================================================================
// pure.js — helpers puros (sin DOM, sin Supabase, sin estado global).
// Compartidos entre app.js y tests.html — así la matemática de adherencia
// tiene pruebas sin necesitar levantar la app.
// ============================================================================

// OJO: usa la fecha LOCAL del navegador (getFullYear/getMonth/getDate), NO
// toISOString().split('T')[0] — eso convierte a UTC, y en Guadalajara (UTC-6)
// a partir de las ~6pm UTC ya es "mañana", así que todo lo aplicado en la
// noche terminaba registrado/agrupado bajo el día siguiente.
function toDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Convierte un timestamp guardado en UTC (ej. product_applications.applied_at)
// a la fecha del calendario LOCAL a la que corresponde.
function localDateOfISO(iso) { return toDateStr(new Date(iso)); }
// Rango [inicio, fin) en UTC que corresponde al día LOCAL "dateStr" completo.
function localDayBoundsUTC(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(dateStr + 'T00:00:00'); end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// ── SANITIZACIÓN ─────────────────────────────────────────────────────────────
// Escapa TODO texto que venga de la base o del usuario antes de meterlo a
// innerHTML — sin esto, un producto llamado "<img onerror=...>" ejecutaría
// código dentro de la app (XSS).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Texto multilínea escrito en un textarea → HTML seguro con saltos de línea.
function fmtRich(s) { return esc(s).replace(/\n/g, '<br>'); }
// Para clases CSS derivadas de datos (ej. tag.cls) — solo caracteres seguros.
function cssSafe(s) { return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_-]/g, ''); }
// Para pasar un string de datos como argumento JS dentro de un atributo onclick:
// primero se escapa para JS ( \ y ' ) y luego para el atributo HTML.
function jsAttrEsc(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }

// products.tags debería ser jsonb (arreglo real), pero algunos productos
// cargados por CSV/Excel quedaron con el texto crudo "[{...}]" como string —
// esto lo normaliza siempre a un arreglo real.
function tagsOf(p) {
  let t = p && p.tags;
  if (typeof t === 'string') {
    try { t = JSON.parse(t); } catch (e) { t = []; }
  }
  return Array.isArray(t) ? t : [];
}

// Itera cada fecha (YYYY-MM-DD) entre a y b inclusive. Trabaja en "espacio
// UTC" a propósito (mediodía UTC evita problemas de DST).
function eachDateStr(a, b, cb) {
  if (a > b) return;
  let d = new Date(a + 'T12:00:00Z');
  const end = new Date(b + 'T12:00:00Z');
  while (d <= end) {
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    cb(ds, d.getUTCDay());
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// % de cumplimiento contra un calendario dado (scheduleDays null/vacío =
// todos los días), en la ventana [wstart, ends]. done = Set de fechas
// YYYY-MM-DD en que sí se aplicó. La ventana empieza en el primer registro
// del producto (no se castiga lo anterior a empezar a usarlo).
function adherenceFromDoneDates(done, scheduleDays, wstart, ends) {
  if (!done.size) return null;
  const first = [...done].sort()[0];
  const start = first > wstart ? first : wstart;
  if (start > ends) return null;
  const days = (scheduleDays && scheduleDays.length) ? new Set(scheduleDays) : null;
  let elig = 0, hit = 0;
  eachDateStr(start, ends, (ds, dow) => {
    if (days && !days.has(dow)) return;
    elig++; if (done.has(ds)) hit++;
  });
  if (elig <= 0) return null;
  return { pct: Math.min(100, Math.round(hit / elig * 100)), hit, elig, start };
}

// Puntuación de calidad de un SPF facial según sus tags. 100 = "ideal".
// Pesos calibrados para MANCHAS SOLARES (lentigos): los sunspots son daño UV
// directo, así que la cobertura UVA profunda y el PA++++ pesan más, y el
// tinte (luz visible) pesa menos que cuando el objetivo era melasma.
// ── PROTECCIÓN UVA ───────────────────────────────────────────────────────────
// NO es una suma de etiquetas: tener más tags no significa proteger más. La
// puntuación se arma de tres componentes FÍSICAMENTE INDEPENDIENTES.
//
// 1) MAGNITUD — cuánta UVA se bloquea. Los sistemas asiático y europeo miden lo
//    mismo con métodos distintos, así que son EQUIVALENTES y jamás se suman:
//      · PA++++  (ISO 24442, PPD in vivo)  = PPD ≥ 16
//      · Sello UVA europeo (ISO 24443)     = UVA-PF ≥ SPF/3 → en SPF50 ≥ 16.7
//    Por eso un SPF50 europeo con el sello UVA protege igual que un PA++++
//    aunque no lleve etiqueta PA: la etiqueta refleja el mercado, no la fórmula.
//    Antes, un SPF50 europeo sin tag PA sacaba 25/100 — se subestimaba solo por
//    venderse bajo otra normativa.
//
// 2) ESPECTRO — hasta qué longitud de onda llega. El mínimo de amplio espectro
//    es una longitud de onda crítica ≥370 nm. Ir más allá SÍ es un beneficio
//    extra: UVA-400 / Mexoryl 400 (MCE, pico 385 nm) cierra el hueco 380–400 nm
//    que los demás filtros dejan abierto y reduce la pigmentación por UVA-1.
//
// 3) LUZ VISIBLE — los óxidos de hierro de los tintados. Superan a un SPF50+ sin
//    tinte para prevenir pigmentación por luz visible.
//
// Tags de MAGNITUD (excluyentes): pa4 | pa3 | pa2 | euuva (sello UVA en SPF50).
// Tags de ESPECTRO (excluyentes):  uva400 | uvalong.
// Tag de VISIBLE: tinted.
// PESOS CALIBRADOS A MANCHAS SOLARES (lentigos), no a melasma. En lentigos la
// causa es casi puramente UV, así que la magnitud y el espectro mandan; la luz
// visible es un extra real pero menor. En melasma habría que subir `vis` a ~20
// y bajar `mag`, porque ahí la luz visible sí es detonante de primer orden.
function spfScoreOf(p) {
  const tags = tagsOf(p);
  const has = cls => tags.some(t => t.cls === cls);
  // 1) Magnitud UVA (0–60): se toma el MEJOR dato disponible, nunca se acumula.
  let mag;
  if (has('pa4') || has('euuva')) mag = 60;
  else if (has('pa3')) mag = 43;
  else if (has('pa2')) mag = 27;
  else mag = 21; // SPF sin dato UVA: se asume solo el mínimo de amplio espectro
  // 2) Espectro más allá del mínimo de 370 nm (0–30). La UVA larga es la que
  //    más pigmenta, así que pesa igual que en melasma.
  const esp = has('uva400') ? 30 : (has('uvalong') ? 15 : 0);
  // 3) Luz visible por óxidos de hierro (0–10).
  const vis = has('tinted') ? 10 : 0;
  return Math.min(100, mag + esp + vis);
}

// ── DOSIS POR EJE DE RESULTADO (Fase B) ──────────────────────────────────────
// Mide ESTÍMULO ENTREGADO, no obediencia a un plan. Una aplicación cuenta
// completa aunque no venga de un paso de rutina.
//
// Dos correcciones hacen que el modelo se parezca a la biología real:
//
//   · TECHO DIARIO — exfoliar dos veces el mismo día no vale el doble. Los
//     puntos de cada día se topan antes de sumar la semana.
//   · VENTANA SEMANAL — el retinoide rinde ~4 noches/semana y se aplana. Si se
//     midiera día por día, las noches de descanso contarían como falla y
//     volveríamos a castigar la desviación, que es justo lo que queremos evitar.
//
// Pasarse del techo NO baja el puntaje (se topa en 100): sobre-aplicar se avisa
// aparte con `overExposureDays`, no se castiga con el número.
//
// El denominador es `diasTecho`, el LÍMITE del eje — no su meta. Así el 100% de
// la barra significa "llegué al máximo útil de la semana", y la meta (el piso)
// se dibuja como una marca en el camino. Antes el denominador era el viejo
// `diasIdeales`, que era meta y límite a la vez: la barra se llenaba al llegar
// a la meta y ya no había forma de ver el margen que quedaba antes del exceso.
//
// dailyPoints: array de puntos crudos por día (7 posiciones = una semana).
function doseWeekPct(dailyPoints, techoDiario, diasTecho) {
  if (!Array.isArray(dailyPoints) || !techoDiario || !diasTecho) return null;
  const total = dailyPoints.reduce((a, p) => a + Math.min(p || 0, techoDiario), 0);
  return Math.min(100, Math.round(total / (techoDiario * diasTecho) * 100));
}

// Días de la semana con IRRITANTES por encima del TECHO del eje. Es un AVISO
// (riesgo de irritación), no una penalización del puntaje.
//
// YA NO tolera +1 día de margen. Ese margen existía porque `diasIdeales` era la
// meta, y avisar en cuanto se pasaba de la meta era demasiado pronto. Con un
// techo explícito el margen ya está dentro del número: `textura` tiene techo 6
// justamente para que seis noches de tretinoína sean válidas y la séptima avise.
// Dejar el +1 encima haría que el techo real fuera 7 y el aviso nunca sonara.
//
// OJO: recibe días con retinoide o ácido exfoliante (ver IRRITANTES), NO los
// puntos del eje `textura`. La niacinamida, el azelaico y el NAG suben textura
// sin irritar; contarlos aquí disparaba avisos falsos.
function overExposureDays(irritantDays, diasTecho) {
  if (!Array.isArray(irritantDays) || !diasTecho) return 0;
  const activos = irritantDays.filter(p => (p || 0) > 0).length;
  return Math.max(0, activos - diasTecho);
}

// Días que faltan para cumplir el PISO semanal del eje. Es la contraparte de
// `overExposureDays`: uno mira hacia arriba (me pasé del techo), este hacia
// abajo (no llegué a la meta).
//
// SE MIDE EN DÍAS ACTIVOS, NO EN DOSIS ACUMULADA. Decisión del 11-ago-2026, y
// es la que hace que el motor sea cumplible. Si el piso se midiera como
// fracción de la barra —o sea `diasPiso × techoDiario` de dosis— haría falta
// llegar al techo diario CADA día del piso, y eso exige amontonar productos:
// `aclarado` con piso 5 pediría 21 días de Finacea sola, u 11 con los dos más
// potentes. Imposible dentro de una semana. Contando días activos, un solo
// producto basta para cumplir cualquier piso, que es como se decidieron los 23
// números: pensando en días de calendario.
//
// Un piso de 0 (hoy sólo `cuerpo_aclarado`) nunca reclama: el eje sigue
// midiendo lo que llegue, pero no puede generar una alarma inapagable.
function pisoShortfallDays(dailyPoints, diasPiso) {
  if (!Array.isArray(dailyPoints) || !diasPiso) return 0;
  const activos = dailyPoints.filter(p => (p || 0) > 0).length;
  return Math.max(0, diasPiso - activos);
}
// ============================================================================
// AGREGAR AL FINAL DE pure.js
// ============================================================================
// Extracción de la lógica de hidratación de palomitas, que hasta ahora vivía
// dentro de loadTodayRoutines() (mezclada con Supabase) y de dbStepHTML()
// (mezclada con DOM). No cambia comportamiento: es el mismo código, movido.
//
// POR QUÉ SE EXTRAE: las reglas de oro 4 y 18 de ARQUITECTURA.md documentan dos
// bugs ya vividos que viven exactamente aquí — la cadena de fallbacks y la
// segmentación por sección. Eran la parte más frágil del código y la única sin
// una sola prueba, porque no se podía ejecutar sin levantar la app entera.
// ============================================================================

// Construye el índice de "qué se aplicó ese día", que decide qué pasos
// aparecen palomeados.
//
// Los fallbacks (producto / categoría / nombre) se guardan SEGMENTADOS POR
// SECCIÓN con el prefijo "am|", "pm|", "body|" o "feet|". Sin eso, un toner
// aplicado en la mañana sin routine_step_id marcaba también el paso "Toners"
// de la rutina de NOCHE, porque ambos comparten picker_category (regla 19).
//
// Cara: solo la sección que corresponde a la hora del registro.
// Cuerpo y pies: siempre, porque sus categorías no chocan con las de cara.
//
//   apps          — filas de product_applications de ese día
//   productsById  — objeto { [product_id]: producto } para leer la categoría
//   cutoffHour    — hora local que separa AM de PM (AM_PM_CUTOFF_HOUR)
// `byStepIdApps` es ADITIVO (2026-07-25, multipicker de zona): guarda las FILAS
// crudas de cada paso, no solo su etiqueta, para que al recargar el día se
// puedan volver a pintar y editar las zonas registradas. Sin él, el renglón de
// zonas desaparecía al refrescar y parecía que no se había guardado. Se llena
// solo por `routine_step_id` — el único vínculo confiable (regla 4); editar
// zonas a partir de un fallback por nombre podría tocar la fila equivocada.
function buildHydration(apps, productsById, cutoffHour) {
  const h = {
    byStepId: new Map(), byProductId: new Map(),
    byCategory: new Map(), byName: new Map(),
    byStepIdApps: new Map()
  };
  const prods = productsById || {};
  (apps || []).forEach(r => {
    const label = r.product_name;
    if (r.routine_step_id) {
      // Un paso multi (ej. Toners) puede tener VARIAS aplicaciones el mismo
      // día — se concatenan para mostrarlas todas en el paso.
      const prev = h.byStepId.get(r.routine_step_id);
      h.byStepId.set(r.routine_step_id, prev ? prev + ' · ' + label : label);
      const rows = h.byStepIdApps.get(r.routine_step_id) || [];
      rows.push({ id: r.id, product_id: r.product_id, product_name: r.product_name, zones: r.zones || null });
      h.byStepIdApps.set(r.routine_step_id, rows);
      return;
    }
    // Una REAPLICACIÓN no es un paso de rutina, y no debe marcar ninguno.
    // Los fallbacks de abajo existen para hidratar registros VIEJOS que nacieron
    // sin routine_step_id (regla 4), no para que un registro nuevo invada la
    // rutina. Sin este corte, reaplicar protector a media tarde palomeaba solo
    // el paso de SPF de la rutina AM — y al desmarcarlo volvía, porque
    // unlogRoutineStep solo borra filas con source='rutina'.
    // Se compara contra 'reaplicacion' EXACTO y no contra !== 'rutina': los
    // registros antiguos traen source null o vacío y sí deben seguir hidratando.
    if (r.source === 'reaplicacion') return;
    const hour = new Date(r.applied_at).getHours();
    const sections = [hour < cutoffHour ? 'am' : 'pm', 'body', 'feet'];
    const prod = r.product_id ? prods[r.product_id] : null;
    sections.forEach(sec => {
      if (r.product_id) h.byProductId.set(sec + '|' + r.product_id, label);
      if (prod && prod.category) h.byCategory.set(sec + '|' + prod.category, label);
      h.byName.set(sec + '|' + label, label);
    });
  });
  return h;
}

// ¿Este paso exacto ya se aplicó ese día? Devuelve el nombre registrado, o null.
//
// PRIORIDAD (regla 4 — no quitar los fallbacks, no promoverlos):
//   1. routine_step_id exacto  ← el vínculo confiable
//   2. product_id              ← histórico previo a routine_step_id
//   3. picker_category         ← histórico
//   4. nombre visible          ← solo para pasos informativos, que no tienen
//                                ni product_id ni picker_category (Agua Tibia,
//                                Cotton Socks). Es lo que hace que su palomita
//                                sobreviva a un recargar.
//
//   step         — fila de routine_steps (usa id, product_id, picker_category)
//   hydration    — lo que devuelve buildHydration()
//   sectionKey   — 'am' | 'pm' | 'body' | 'feet'
//   displayLabel — el texto visible del paso ("emoji nombre"), para el caso 4
function resolveStepHydration(step, hydration, sectionKey, displayLabel) {
  if (!step || !hydration) return null;
  const sec = (sectionKey || 'am') + '|';
  if (hydration.byStepId && hydration.byStepId.has(step.id)) {
    return hydration.byStepId.get(step.id);
  }
  if (step.product_id && hydration.byProductId.has(sec + step.product_id)) {
    return hydration.byProductId.get(sec + step.product_id);
  }
  if (step.picker_category && hydration.byCategory.has(sec + step.picker_category)) {
    return hydration.byCategory.get(sec + step.picker_category);
  }
  if (!step.picker_category && !step.product_id) {
    const expected = String(displayLabel == null ? '' : displayLabel).trim();
    if (hydration.byName.has(sec + expected)) return hydration.byName.get(sec + expected);
  }
  return null;
}

// ── DETECCIÓN DE REACCIÓN A PRODUCTO NUEVO ───────────────────────────────────
// Compara el estado de piel ANTES y DESPUÉS de introducir un producto
// (products.started_at vs daily_notes.skin_state).
//
// ESTO ES UNA COINCIDENCIA TEMPORAL, NO UNA CAUSA. Un solo caso, sin control y
// con la piel cambiando por mil razones (clima, hormonas, sueño, otros
// productos) no demuestra nada. Sirve para NOTAR algo que se te pasó y llevarlo
// a consulta — no para decidir sola que un producto te hace daño.
//
// Por eso el modelo es deliberadamente conservador:
//   · exige un mínimo de días CON registro en cada ventana (sin eso, dos días
//     malos sueltos "detectan" una reacción que no existe);
//   · exige una diferencia mínima, para no reportar ruido;
//   · devuelve null en cuanto falte cualquiera de las dos cosas.
//
// Desplaza una fecha YYYY-MM-DD n días. Trabaja a mediodía UTC, igual que
// eachDateStr, para que el horario de verano no corra el día.
function shiftDateStr(ds, n) {
  const d = new Date(ds + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// startDate  — products.started_at (YYYY-MM-DD)
// skinByDate — { 'YYYY-MM-DD': 1..5 }
// opts       — { windowDays=14, minDays=4, minDelta=0.7 }
// Devuelve null si no hay evidencia suficiente, o { direction, before, after,
// delta, nBefore, nAfter }. `direction` es 'peor' o 'mejor': se reportan las
// dos, porque enseñar solo lo malo sesga la lectura.
function reactionSignal(startDate, skinByDate, opts) {
  const o = opts || {};
  const win      = o.windowDays != null ? o.windowDays : 14;
  const minDays  = o.minDays    != null ? o.minDays    : 4;
  const minDelta = o.minDelta   != null ? o.minDelta   : 0.7;
  if (!startDate || !skinByDate) return null;
  const collect = (a, b) => {
    const v = [];
    eachDateStr(a, b, ds => { const s = skinByDate[ds]; if (s != null) v.push(Number(s)); });
    return v;
  };
  const before = collect(shiftDateStr(startDate, -win), shiftDateStr(startDate, -1));
  const after  = collect(startDate, shiftDateStr(startDate, win - 1));
  if (before.length < minDays || after.length < minDays) return null;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const mb = mean(before), ma = mean(after);
  const delta = ma - mb;
  if (Math.abs(delta) < minDelta) return null;
  const r1 = x => Math.round(x * 10) / 10;
  return {
    direction: delta < 0 ? 'peor' : 'mejor',
    before: r1(mb), after: r1(ma), delta: r1(delta),
    nBefore: before.length, nAfter: after.length
  };
}

// ── TENDENCIA DE UNA MANCHA ──────────────────────────────────────────────────
// `shade` es una APRECIACIÓN VISUAL de la usuaria (1 = casi no se ve, 5 = muy
// marcada), no una medición. La tendencia se calcula sobre ese dato declarado y
// así debe presentarse siempre: sirve para ver una dirección a lo largo de
// meses, no para afirmar cuánto aclaró.
//
// Conservador a propósito: con menos de 2 observaciones no dice nada, y compara
// la PRIMERA contra la ÚLTIMA en vez de ajustar una recta — con 3 o 4 puntos
// subjetivos, una regresión da una falsa sensación de precisión.
//
// obs: [{ observed_at, shade }] en cualquier orden.
// Devuelve null, o { direction, first, last, delta, n, days }.
function spotTrend(obs) {
  const v = (obs || [])
    .filter(o => o && o.shade != null && o.observed_at)
    .sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));
  if (v.length < 2) return null;
  const a = v[0], b = v[v.length - 1];
  const delta = Number(b.shade) - Number(a.shade);
  const days = Math.round(
    (new Date(b.observed_at + 'T12:00:00Z') - new Date(a.observed_at + 'T12:00:00Z')) / 86400000);
  return {
    direction: delta < 0 ? 'aclarando' : (delta > 0 ? 'oscureciendo' : 'igual'),
    first: Number(a.shade), last: Number(b.shade), delta,
    n: v.length, days
  };
}

// ── RITMO DE REAPLICACIÓN: UV + OCASO ───────────────────────────────────────
// Antes el aviso era fijo cada 2 h entre las 10 y las 19, hora local. Dos cosas
// mal: a las 18:30 de diciembre en Guadalajara el sol ya se puso y el UV es 0
// —el aviso solo enseña a ignorar los avisos—, y a las 13:00 de mayo con UV 11
// dos horas es demasiado.
//
// Bandas de la OMS (las mismas que usa cualquier app del clima):
//   0-2 bajo · 3-5 moderado · 6-7 alto · 8-10 muy alto · 11+ extremo
//
// Ritmo (corregido 2026-08-01 contra criterio dermatológico real, verificado
// por la usuaria): 2 h desde alto en adelante (6+) · 3 h en moderado (3-5) ·
// <3 no avisa. 2 h es la recomendación derma estándar con exposición real y
// NO se aprieta más aunque el UV sea máximo — la versión anterior apretaba a
// 1.5 h en muy_alto/extremo por un supuesto nuestro, no por indicación
// clínica, y quedó mal.
function uvBand(uv) {
  if (uv == null || isNaN(uv)) return null;
  if (uv < 3) return 'bajo';
  if (uv < 6) return 'moderado';
  if (uv < 8) return 'alto';
  if (uv < 11) return 'muy_alto';
  return 'extremo';
}
// Corregido 2026-08-01: el criterio dermatológico real es reaplicar cada 2h
// aunque el UV sea máximo — 1.5h en muy_alto/extremo era un supuesto nuestro,
// no una indicación clínica, y se verificó que estaba mal. Por debajo de UV 6
// no hace falta ir más seguido que cada 2h tampoco; moderado se queda en 3h.
const SPF_GAP_POR_BANDA = { bajo: null, moderado: 3, alto: 2, muy_alto: 2, extremo: 2 };
// Cadencia por TIPO DE EXPOSICIÓN (2026-08-01, pauta dermatológica real que
// trajo la usuaria, verificada por ella con UV 9 de referencia):
//   interior (con luz natural, cerca de ventanas) → 4 h
//   normal / alta / playa (aire libre directo)    → 2 h, sin excepción
//   actividad (actividad física o agua)           → 60-80 min: el sudor o el
//     agua quitan el protector antes de que el tiempo por sí solo lo agote.
//     70 min es el PUNTO MEDIO del rango — no es un cálculo, es una elección
//     razonable dentro de "60 u 80"; ajustable si se prefiere el extremo
//     conservador (60) o el permisivo (80).
// Esto SUSTITUYE la banda de UV cuando se conoce la exposición del día — el
// UV solo decide si hace falta protegerse EN ABSOLUTO ('bajo' = no), no la
// frecuencia: sudar o nadar quita el protector sin importar qué tan fuerte
// pegue el sol ese momento.
const SPF_GAP_POR_EXPOSICION = { interior: 4, normal: 2, alta: 2, playa: 2, actividad: 70 / 60 };
// Horas entre avisos. `null` = no avisar (UV por debajo de 3).
//   uv        — índice UV actual (o pico del día, para cálculos históricos)
//   exposure  — 'interior' | 'normal' | 'alta' | 'playa' | 'actividad', o
//               null/undefined si no se conoce — en ese caso se cae a la
//               banda de UV sola, como antes de esta sesión.
// Sin dato de UV se usa la base de 2 h: quedarse callado por no saber es peor
// que avisar de más en la zona que de verdad importa.
function spfGapHours(uv, exposure) {
  const b = uvBand(uv);
  if (b === 'bajo') return null;   // UV bajo: no hace falta protegerse, sin importar la actividad
  if (exposure && SPF_GAP_POR_EXPOSICION[exposure] != null) return SPF_GAP_POR_EXPOSICION[exposure];
  if (b === null) return 2;
  return SPF_GAP_POR_BANDA[b];
}
// Los últimos minutos antes del ocaso no valen un aviso: el UV cae a 0 y
// reaplicar entonces no protege de nada. Se corta con margen.
const SPF_MINUTOS_ANTES_DE_OCASO = 60;
// ¿Toca avisar? Una sola función para el aviso local y (cuando se adapte) el
// push del servidor, con toda la aritmética en un lugar con pruebas.
//
//   nowMs, lastMs   — ahora y último SPF facial (ms). `lastMs` null = ninguno hoy
//   uv              — índice UV actual, o null si no se pudo consultar
//   sunsetMs        — ocaso local en ms, o null si no se pudo consultar
//   lastNudgeMs     — cuándo se avisó por última vez (antirrebote)
//   exposure        — exposición del día ya registrada ('interior' · 'normal'
//                     · 'alta' · 'playa' · 'actividad'), o null/undefined si
//                     todavía no la marcaste (2026-08-01: antes el aviso en
//                     vivo solo miraba el UV; ahora, si ya declaraste que es
//                     un día de actividad física/agua, avisa cada 70 min en
//                     vez de por banda de UV).
//
// Devuelve { avisar, gapH, motivo, minutosParaSiguiente }. `motivo` existe para
// poder EXPLICAR el silencio: un recordatorio que no suena y no se sabe por qué
// es indistinguible de uno roto.
function spfReminderCheck({ nowMs, lastMs, uv, sunsetMs, lastNudgeMs, horaInicio = 8, exposure }) {
  const gapH = spfGapHours(uv, exposure);
  const now = new Date(nowMs);
  const out = (avisar, motivo) => {
    const base = lastMs != null ? lastMs : null;
    const minutos = (base != null && gapH != null)
      ? Math.round((base + gapH * 3600000 - nowMs) / 60000) : null;
    return { avisar, gapH, motivo, minutosParaSiguiente: minutos };
  };
  if (gapH == null) return out(false, 'uv_bajo');
  if (now.getHours() < horaInicio) return out(false, 'muy_temprano');
  if (sunsetMs != null && nowMs > sunsetMs - SPF_MINUTOS_ANTES_DE_OCASO * 60000) {
    return out(false, 'ocaso');
  }
  // Sin dato de ocaso se conserva el corte viejo por hora, que es el respaldo
  // que ya existía. Nunca dejar el aviso sin ningún límite superior.
  if (sunsetMs == null && now.getHours() >= 19) return out(false, 'noche');
  if (lastNudgeMs && nowMs - lastNudgeMs < gapH * 3600000) return out(false, 'ya_avise');
  if (lastMs == null) return out(true, 'sin_spf_hoy');
  if (nowMs - lastMs < gapH * 3600000) return out(false, 'todavia_protegida');
  return out(true, 'toca_reaplicar');
}
// Cuántas aplicaciones de SPF caben en UNA FECHA entre que te levantas y que
// se pone el sol, espaciadas por el mismo gap que ya usa el recordatorio
// (`spfGapHours` sobre un UV — el actual si es hoy, el pico registrado ese día
// si es pasado — un solo valor para todo el día, igual que el resto de la
// app: nunca hubo pronóstico hora por hora para el gap, solo para el pico).
// Sirve para DOS casos con la misma matemática: el resumen de HOY en vivo
// (`ds` = hoy, `sunsetMs`/`uv` de Open-Meteo en vivo) y el ideal de Progreso
// para un día PASADO (`ds` = esa fecha, `sunsetMs`/`uv` del Historical
// Forecast API — ver `fetchHistUvSunset` en app.js). Antes el "ideal del día"
// era fijo (`IDEAL_SPF_BY_SUN`) y no sabía a qué hora empezó tu día: si te
// levantas a mediodía, NO se cuentan aplicaciones de las 8 ni las 10 como
// "debidas" — el conteo arranca en `wakeTimeStr`, no antes.
//
//   ds           — fecha LOCAL "YYYY-MM-DD" a la que corresponde el cálculo
//                  (hoy o un día pasado). Solo se usa para anclar `wakeTimeStr`
//                  a un timestamp real, nunca para decidir "ahora".
//   sunsetMs     — ocaso local en ms de ESA fecha, o null si no se pudo
//                  consultar: sin esto no hay tope superior confiable, se
//                  devuelve null y el caller decide su propio respaldo (el
//                  ideal fijo).
//   uv           — índice UV representativo de esa fecha (actual si es hoy,
//                  pico del día si es histórico), o null
//   wakeTimeStr  — hora local en que empezó el día, como "HH:MM" (input nativo
//                  type=time, o `daily_notes.wake_time`). Default '08:00'. Un
//                  valor con formato inválido cae también a '08:00' — mejor
//                  asumir el default de siempre que tronar el cálculo.
//   exposure     — exposición del día ('interior' · 'normal' · 'alta' ·
//                  'playa' · 'actividad'), si ya la registraste. Determina la
//                  cadencia (ver `SPF_GAP_POR_EXPOSICION`) por encima de la
//                  banda de UV — 2026-08-01, pauta dermatológica real.
//
// Se resta el mismo margen de `SPF_MINUTOS_ANTES_DE_OCASO` que ya usa el
// recordatorio: los últimos 60 min antes del ocaso no cuentan como una
// aplicación posible más, por la misma razón (el UV ya cayó a 0).
function spfPosiblesEnFecha({ ds, sunsetMs, uv, wakeTimeStr = '08:00', exposure }) {
  if (sunsetMs == null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(wakeTimeStr || '').trim());
  const hhmm = m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : '08:00';
  const wakeMs = new Date(`${ds}T${hhmm}:00`).getTime();
  const finMs = sunsetMs - SPF_MINUTOS_ANTES_DE_OCASO * 60000;
  // El sol se pone antes de que despiertes (o casi): al menos cuenta la
  // aplicación de la mañana, nunca cero — salir de casa sin nada no es una
  // opción válida aunque el día sea corto.
  if (finMs <= wakeMs) return 1;
  const gapH = spfGapHours(uv, exposure);
  // UV bajo todo el día ('bajo' → gapH null): el recordatorio no exige
  // reaplicar, pero la aplicación base de la mañana sigue contando como el
  // 100% de hoy.
  if (gapH == null) return 1;
  const horas = (finMs - wakeMs) / 3600000;
  return Math.max(1, Math.floor(horas / gapH) + 1);
}
// El mensaje cambia con la banda de UV: "reaplica" a secas no dice si hoy da
// igual esperar media hora o no. El texto lleva el dato que justifica la prisa.
function spfNudgeText(uv, horasDesdeUltimo) {
  const b = uvBand(uv);
  const desde = (horasDesdeUltimo == null || !isFinite(horasDesdeUltimo))
    ? 'Hoy aún no registras SPF facial'
    : `Han pasado ${horasDesdeUltimo.toFixed(1)} h desde tu último SPF`;
  const uvTxt = (uv == null || isNaN(uv)) ? '' : ` · UV ${Math.round(uv)}`;
  const porBanda = {
    extremo:  { titulo: '🔴 UV extremo — reaplica ya', cola: 'Con este UV la sombra no es opcional: reaplica cada 2 h y busca techo entre 11 y 16 h.' },
    muy_alto: { titulo: '🔴 UV muy alto — reaplica ya', cola: 'Es el rango que más pigmenta tus manchas. Reaplica cada 2 h mientras estés fuera.' },
    alto:     { titulo: '🟠 Toca reaplicar SPF', cola: 'UV alto: cada 2 h si te da el sol, aunque estés tras una ventana.' },
    moderado: { titulo: '🟡 Toca reaplicar SPF', cola: 'UV moderado: cada 3 h basta hoy.' },
    bajo:     { titulo: '🟢 SPF al día', cola: 'UV bajo: no hace falta reaplicar por ahora.' }
  };
  const p = porBanda[b] || { titulo: '☀️ Toca reaplicar SPF', cola: 'Sin dato de UV — se asume el ritmo normal de 2 h.' };
  return { titulo: p.titulo, cuerpo: `${desde}${uvTxt}. ${p.cola}` };
}
// Última aplicación de protector POR ZONA. Ahora que cada registro guarda dónde
// te lo pusiste, "hace cuánto que no te proteges" deja de ser una sola cifra:
// la cara se reaplica sola varias veces al día y las manos casi nunca.
//   apps  — [{ applied_at, zones }] ya filtradas a productos con protección
//   zonas — zonas a reportar, en orden
function lastSpfPorZona(apps, zonas) {
  const out = {};
  (zonas || []).forEach(z => { out[z] = null; });
  (apps || []).forEach(r => {
    if (!r || !r.applied_at) return;
    const zs = Array.isArray(r.zones) ? r.zones : [];
    zs.forEach(z => {
      if (!(z in out)) return;
      if (out[z] == null || String(r.applied_at) > String(out[z])) out[z] = r.applied_at;
    });
  });
  return out;
}

// ── ZONAS DE UN REGISTRO (multipicker de zona) ───────────────────────────────
// Qué se escribe en `product_applications.zones`. Vive aquí, puro y con tests,
// porque es la pieza que decide QUÉ EJES DE PROGRESO recibe cada aplicación:
// una resolución mal hecha no da error, solo mueve porcentajes en silencio.
//
// Tres entradas, tres preguntas distintas (confundirlas fue lo que motivó el
// refactor función × zona):
//   elegidas   — lo que ella marcó en el picker
//   aptas      — dónde PUEDE ir ese producto (zonasAptasDe)
//   porDefecto — PRODUCT_ZONAS del producto: dónde suele ponérselo
//
// La aptitud MANDA sobre lo elegido: el picker es de sesión (varios productos a
// la vez), así que marcar "cara + manos" con un limpiador y una crema de manos
// en la misma tanda es normal. Cada producto se queda con la parte que le toca
// en vez de recibir una zona donde nadie se lo pondría.
//
// Devuelve [] cuando no hay nada defendible que escribir. El caller escribe
// null en ese caso y el motor cae al respaldo de PRODUCT_ZONAS, que es
// exactamente lo que hacía antes de existir la columna — nunca inventa zonas.
function ordenarZonas(zonas, orden) {
  const ord = Array.isArray(orden) ? orden : [];
  const rank = z => { const i = ord.indexOf(z); return i === -1 ? 99 : i; };
  return (Array.isArray(zonas) ? zonas.slice() : []).sort((a, b) => rank(a) - rank(b));
}
function unionZonas(listas, orden) {
  const set = new Set();
  (Array.isArray(listas) ? listas : []).forEach(l =>
    (Array.isArray(l) ? l : []).forEach(z => { if (z) set.add(z); }));
  return ordenarZonas([...set], orden);
}
function resolveZonas(elegidas, aptas, porDefecto, orden) {
  const el  = [...new Set((Array.isArray(elegidas) ? elegidas : []).filter(Boolean))];
  const ap  = [...new Set((Array.isArray(aptas) ? aptas : []).filter(Boolean))];
  const def = [...new Set((Array.isArray(porDefecto) ? porDefecto : []).filter(Boolean))];
  // Producto sin aptitud conocida (categoría nueva y sin entrada en la matriz):
  // no hay con qué filtrar, así que se respeta lo elegido tal cual.
  if (!ap.length) return ordenarZonas(el.length ? el : def, orden);
  const inter = ap.filter(z => el.indexOf(z) !== -1);
  if (inter.length) return ordenarZonas(inter, orden);
  // Nada de lo elegido le sirve a este producto → su zona habitual, si es apta.
  const interDef = ap.filter(z => def.indexOf(z) !== -1);
  if (interDef.length) return ordenarZonas(interDef, orden);
  return [];
}
