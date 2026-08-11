// Casos a agregar en tests.html para el motor de dosis (Fase B + motor de cadencia).
// Regla 6 de ARQUITECTURA: todo cambio en pure.js actualiza tests.html.
//
// OJO: este archivo DUPLICA lo que ya vive en tests.html (regla 5). Se mantiene
// sincronizado por ahora, pero conviene retirarlo: la fuente de verdad es
// tests.html.

// ── TECHO DIARIO: rendimientos decrecientes ────────────────────────────────
// Exfoliar dos veces el mismo día no vale el doble.
t('dosis: el techo diario recorta el exceso',
  doseWeekPct([170, 0, 0, 0, 0, 0, 0], 85, 6),
  doseWeekPct([85, 0, 0, 0, 0, 0, 0], 85, 6));

// ── EL DENOMINADOR ES EL TECHO, NO LA META ─────────────────────────────────
// `textura`: techoDiario 265 · piso 3 · techo 6. Seis noches de tretinoína son
// el 100% real. Con el viejo diasIdeales=4 la barra se topaba desde la cuarta
// noche y no quedaba forma de ver el margen que faltaba antes del exceso.
t('dosis: 6 noches con techo 6 = 100%',
  doseWeekPct([95, 95, 95, 95, 95, 95, 0], 95, 6), 100);
t('dosis: 3 noches con techo 6 = 50% — el piso NO es el 100%',
  doseWeekPct([95, 0, 95, 0, 95, 0, 0], 95, 6), 50);
t('dosis: pasarse del techo no baja el puntaje',
  doseWeekPct([95, 95, 95, 95, 95, 95, 95], 95, 6), 100);

// ── EL CASO QUE MOTIVÓ LA FASE B ───────────────────────────────────────────
// Aplicación libre, fuera de rutina: antes daba 0% por no marcar pasos.
t('dosis: aplicación libre diaria de barrera (el caso que motivó Fase B)',
  doseWeekPct([80, 80, 80, 80, 80, 80, 80], 100, 7), 80);

// ── PROPORCIONALIDAD ───────────────────────────────────────────────────────
t('dosis: media semana = ~50%',
  doseWeekPct([90, 90, 90, 90, 0, 0, 0], 90, 7), 57);
t('dosis: sin aplicaciones = 0%',
  doseWeekPct([0, 0, 0, 0, 0, 0, 0], 90, 7), 0);

// ── AVISO DE SOBRE-EXPOSICIÓN: ya SIN la tolerancia de +1 ───────────────────
// El margen vive dentro del techo. `textura` tiene techo 6 justamente para que
// seis noches sean válidas y la séptima avise. Dejar el +1 encima haría que el
// techo real fuera 7 y el aviso no sonara nunca.
t('aviso: 6 noches con techo 6 no avisa',
  overExposureDays([1, 1, 1, 1, 1, 1, 0], 6), 0);
t('aviso: 7 noches con techo 6 avisa 1 día',
  overExposureDays([1, 1, 1, 1, 1, 1, 1], 6), 1);
t('aviso: cuerpo_textura (techo 3) avisa a la cuarta',
  overExposureDays([1, 1, 1, 1, 0, 0, 0], 3), 1);
t('aviso: sin el viejo +1, el techo es el techo',
  overExposureDays([1, 1, 1, 1, 1, 0, 0], 4), 1);
// Niacinamida/azelaico suben textura pero NO son irritantes: no deben avisar.
t('aviso: textura alta sin irritantes no avisa',
  overExposureDays([0, 0, 0, 0, 0, 0, 0], 6), 0);

// ── PISO: SE MIDE EN DÍAS ACTIVOS, NO EN DOSIS ─────────────────────────────
// Es la decisión que hace el motor cumplible. Si el piso se midiera como
// fracción de la barra, `aclarado` con piso 5 pediría 21 días de Finacea sola.
t('piso: 3 días activos cumplen un piso de 3',
  pisoShortfallDays([10, 0, 10, 0, 10, 0, 0], 3), 0);
t('piso: 1 día activo deja 2 pendientes de un piso de 3',
  pisoShortfallDays([10, 0, 0, 0, 0, 0, 0], 3), 2);
t('piso: la dosis no importa, sólo que el día cuente',
  pisoShortfallDays([1, 1, 1, 0, 0, 0, 0], 3),
  pisoShortfallDays([999, 999, 999, 0, 0, 0, 0], 3));
t('piso: pasarse del piso no da crédito negativo',
  pisoShortfallDays([10, 10, 10, 10, 10, 10, 10], 3), 0);
t('piso: un piso de 0 (cuerpo_aclarado) nunca reclama',
  pisoShortfallDays([0, 0, 0, 0, 0, 0, 0], 0), 0);

// ── GUARDAS ────────────────────────────────────────────────────────────────
t('dosis: entrada inválida devuelve null', doseWeekPct(null, 85, 6), null);
t('dosis: sin config devuelve null', doseWeekPct([10], 0, 6), null);
t('piso: entrada inválida no reclama', pisoShortfallDays(null, 3), 0);
