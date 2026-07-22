// Casos a agregar en tests.html para el motor de dosis (Fase B).
// Regla 6 de ARQUITECTURA: todo cambio en pure.js actualiza tests.html.

// ── TECHO DIARIO: rendimientos decrecientes ────────────────────────────────
// Exfoliar dos veces el mismo día no vale el doble.
t('dosis: el techo diario recorta el exceso',
  doseWeekPct([170, 0, 0, 0, 0, 0, 0], 85, 4),
  doseWeekPct([85, 0, 0, 0, 0, 0, 0], 85, 4));

// ── VENTANA SEMANAL: las noches de descanso no son falla ───────────────────
// 4 noches de tretinoína = 100%. Es el caso que rompía el modelo viejo.
t('dosis: 4 noches de retinoide = 100%',
  doseWeekPct([95, 0, 95, 0, 95, 0, 95], 85, 4), 100);

// Pasarse NO penaliza: se topa en 100, el aviso va por separado.
t('dosis: 7 noches no bajan el puntaje',
  doseWeekPct([95, 95, 95, 95, 95, 95, 95], 85, 4), 100);

// ── EL CASO QUE MOTIVÓ LA FASE B ───────────────────────────────────────────
// Aplicación libre, fuera de rutina: antes daba 0% por no marcar pasos.
// Ahora entrega dosis real y se refleja.
t('dosis: aplicación libre diaria de barrera',
  doseWeekPct([80, 80, 80, 80, 80, 80, 80], 100, 7), 80);

// ── PROPORCIONALIDAD ───────────────────────────────────────────────────────
t('dosis: media semana = ~50%',
  doseWeekPct([90, 90, 90, 90, 0, 0, 0], 90, 7), 57);
t('dosis: sin aplicaciones = 0%',
  doseWeekPct([0, 0, 0, 0, 0, 0, 0], 90, 7), 0);

// ── AVISO DE SOBRE-EXPOSICIÓN (no penaliza, avisa) ─────────────────────────
// Recibe DÍAS CON IRRITANTE (retinoide/ácido), no puntos del eje textura.
t('aviso: 4 noches de retinoide no avisa',
  overExposureDays([1, 0, 1, 0, 1, 0, 1], 4), 0);
t('aviso: 5 noches tolera 1 de margen',
  overExposureDays([1, 1, 1, 0, 1, 0, 1], 4), 0);
t('aviso: 7 noches dispara el aviso',
  overExposureDays([1, 1, 1, 1, 1, 1, 1], 4), 2);
// Niacinamida/azelaico suben textura pero NO son irritantes: no deben avisar.
t('aviso: textura alta sin irritantes no avisa',
  overExposureDays([0, 0, 0, 0, 0, 0, 0], 4), 0);

// ── GUARDAS ────────────────────────────────────────────────────────────────
t('dosis: entrada inválida devuelve null', doseWeekPct(null, 85, 4), null);
t('dosis: sin config devuelve null', doseWeekPct([10], 0, 4), null);
