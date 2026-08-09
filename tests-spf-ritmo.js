// ============================================================================
// tests-spf-ritmo.js — ritmo de reaplicación por UV y ocaso
//
//   node tests-spf-ritmo.js
//
// Por qué existe: la regla vivía escrita a mano dentro de `checkSpfReminder`,
// donde probarla significaba esperar dos horas reales o mover el reloj del
// sistema. Un recordatorio que no suena no da error: simplemente no pasa nada,
// y eso es indistinguible de "todavía no toca".
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NOMBRES = ['uvBand', 'spfGapHours', 'spfReminderCheck', 'spfNudgeText',
                 'lastSpfPorZona', 'SPF_MINUTOS_ANTES_DE_OCASO'];
const ctx = { console, __api: null };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'pure.js'), 'utf8')
  + `\n;__api = { ${NOMBRES.join(', ')} };`, ctx, { filename: 'pure.js' });
const { uvBand, spfGapHours, spfReminderCheck, spfNudgeText,
        lastSpfPorZona, SPF_MINUTOS_ANTES_DE_OCASO } = ctx.__api;

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++; console.log(`❌ ${name}\n   esperado: ${w}\n   obtenido: ${g}`);
}
// Reloj fijo: un día de julio en Guadalajara. Las pruebas de horario no pueden
// depender de cuándo se corran.
const H = h => new Date(2026, 6, 26, h, 0, 0).getTime();   // hora LOCAL
const OCASO = H(20) + 14 * 60000;                          // 20:14

// ── BANDAS OMS ──────────────────────────────────────────────────────────────
t('banda: 0 es bajo', uvBand(0), 'bajo');
t('banda: 2.9 sigue bajo', uvBand(2.9), 'bajo');
t('banda: 3 es moderado', uvBand(3), 'moderado');
t('banda: 6 es alto', uvBand(6), 'alto');
t('banda: 8 es muy alto', uvBand(8), 'muy_alto');
t('banda: 11 es extremo', uvBand(11), 'extremo');
t('banda: sin dato es null', uvBand(null), null);

// ── RITMO ELEGIDO POR LA USUARIA ────────────────────────────────────────────
t('ritmo: UV 9 → 2 h (muy alto NO aprieta más)', spfGapHours(9), 2);
t('ritmo: UV 12 → 2 h (extremo tampoco)', spfGapHours(12), 2);
t('ritmo: UV 6.5 → 2 h', spfGapHours(6.5), 2);
t('ritmo: UV 4 → 3 h', spfGapHours(4), 3);
t('ritmo: UV 1 → no avisa', spfGapHours(1), null);
// Sin dato NO se calla: quedarse mudo por no saber es peor que avisar de más.
t('ritmo: sin dato de UV usa la base de 2 h', spfGapHours(null), 2);

// ── EL CASO QUE MOTIVÓ EL CAMBIO ────────────────────────────────────────────
// 18:40 de diciembre: el sol ya se puso y el aviso viejo (10-19 h fijas) seguía
// sonando. Un aviso que no protege de nada solo enseña a ignorar los avisos.
t('ocaso: 30 min después del ocaso no avisa',
  spfReminderCheck({ nowMs: OCASO + 30 * 60000, lastMs: H(9), uv: 5, sunsetMs: OCASO, lastNudgeMs: 0 }).motivo,
  'ocaso');
t('ocaso: dentro de la última hora tampoco',
  spfReminderCheck({ nowMs: OCASO - 30 * 60000, lastMs: H(9), uv: 5, sunsetMs: OCASO, lastNudgeMs: 0 }).motivo,
  'ocaso');
t('ocaso: hora y media antes sí avisa',
  spfReminderCheck({ nowMs: OCASO - 90 * 60000, lastMs: H(9), uv: 5, sunsetMs: OCASO, lastNudgeMs: 0 }).avisar,
  true);
t('ocaso: el margen es de una hora', SPF_MINUTOS_ANTES_DE_OCASO, 60);
// Sin dato de ocaso se conserva el corte viejo por hora — nunca sin tope.
t('sin ocaso: a las 19 h se calla igual',
  spfReminderCheck({ nowMs: H(19), lastMs: H(9), uv: 5, sunsetMs: null, lastNudgeMs: 0 }).motivo,
  'noche');
t('sin ocaso: a las 18 h avisa',
  spfReminderCheck({ nowMs: H(18), lastMs: H(9), uv: 5, sunsetMs: null, lastNudgeMs: 0 }).avisar,
  true);

// ── EL RITMO SE APRIETA CON EL UV ───────────────────────────────────────────
// Mismo momento, mismo último SPF: con UV 9 ya toca, con UV 4 todavía no.
const base = { nowMs: H(13), lastMs: H(11), sunsetMs: OCASO, lastNudgeMs: 0 };
t('uv alto: a las 2 h con UV 9 ya toca',
  spfReminderCheck({ ...base, uv: 9 }).avisar, true);
t('uv moderado: a las 2 h con UV 4 todavía no',
  spfReminderCheck({ ...base, uv: 4 }), { avisar: false, gapH: 3, motivo: 'todavia_protegida', minutosParaSiguiente: 60 });
t('uv bajo: no avisa aunque lleves horas',
  spfReminderCheck({ nowMs: H(13), lastMs: H(7), uv: 1, sunsetMs: OCASO, lastNudgeMs: 0 }).motivo,
  'uv_bajo');

// ── ANTIRREBOTE Y SIN SPF ───────────────────────────────────────────────────
t('sin SPF hoy: avisa',
  spfReminderCheck({ nowMs: H(12), lastMs: null, uv: 7, sunsetMs: OCASO, lastNudgeMs: 0 }).motivo,
  'sin_spf_hoy');
t('antirrebote: no repite dentro del mismo ciclo',
  spfReminderCheck({ nowMs: H(12), lastMs: null, uv: 7, sunsetMs: OCASO, lastNudgeMs: H(11) }).motivo,
  'ya_avise');
t('madrugada: no avisa a las 6 am',
  spfReminderCheck({ nowMs: H(6), lastMs: null, uv: 7, sunsetMs: OCASO, lastNudgeMs: 0 }).motivo,
  'muy_temprano');

// ── EL MENSAJE CAMBIA CON LA BANDA ──────────────────────────────────────────
// El título es lo único que se lee en la pantalla de bloqueo.
t('mensaje: UV muy alto lo dice en el título',
  spfNudgeText(9, 2).titulo, '🔴 UV muy alto — reaplica ya');
t('mensaje: UV alto va en naranja',
  spfNudgeText(6.5, 2).titulo, '🟠 Toca reaplicar SPF');
t('mensaje: UV moderado dice que 3 h basta',
  spfNudgeText(4, 3).cuerpo.includes('cada 3 h basta'), true);
t('mensaje: sin SPF hoy no inventa horas',
  spfNudgeText(7, null).cuerpo.startsWith('Hoy aún no registras SPF facial'), true);
t('mensaje: lleva el UV como dato',
  spfNudgeText(9, 2).cuerpo.includes('UV 9'), true);
t('mensaje: sin dato de UV lo admite',
  spfNudgeText(null, 2).cuerpo.includes('Sin dato de UV'), true);

// ── ÚLTIMA PROTECCIÓN POR ZONA ──────────────────────────────────────────────
// Una sola cifra para todo el cuerpo era una media mentirosa: la cara se
// reaplica varias veces al día y las manos casi nunca.
const apps = [
  { applied_at: '2026-07-26T15:00:00Z', zones: ['cara', 'cuello'] },
  { applied_at: '2026-07-26T19:30:00Z', zones: ['cara'] },
  { applied_at: '2026-07-26T13:00:00Z', zones: ['cara', 'cuello', 'manos'] }
];
t('por zona: cara toma la más reciente',
  lastSpfPorZona(apps, ['cara', 'cuello', 'manos']),
  { cara: '2026-07-26T19:30:00Z', cuello: '2026-07-26T15:00:00Z', manos: '2026-07-26T13:00:00Z' });
t('por zona: una zona sin registro queda en null',
  lastSpfPorZona(apps, ['cara', 'pies']).pies, null);
t('por zona: aguanta filas sin zonas',
  lastSpfPorZona([{ applied_at: '2026-07-26T10:00:00Z' }], ['cara']).cara, null);
t('por zona: sin datos no revienta', lastSpfPorZona(null, ['cara']), { cara: null });

console.log(`\n${fail ? '❌' : '✅'} ritmo de SPF: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
