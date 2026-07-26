// Casos a agregar en tests.html — zonas de un registro (multipicker de zona).
// Regla 6 de ARQUITECTURA: todo cambio en pure.js actualiza tests.html.
// La batería completa, con el catálogo real, corre aparte:
//   node tests-zonas-registro.js

const ORDEN_Z = ['cara', 'cuello', 'cuerpo', 'manos', 'pies', 'labios', 'cabello'];

// ── ORDEN CANÓNICO ──────────────────────────────────────────────────────────
// El array guardado debe ser comparable entre filas: mismo contenido → mismo
// orden. Sin esto, dos registros idénticos se ven distintos en la base.
t('zonas: se ordenan como ZONAS',
  ordenarZonas(['manos', 'cara', 'cuello'], ORDEN_Z), ['cara', 'cuello', 'manos']);
t('zonas: unión sin duplicados',
  unionZonas([['cuello', 'cara'], ['cara', 'manos']], ORDEN_Z), ['cara', 'cuello', 'manos']);

// ── LO ELEGIDO GANA, LA APTITUD MANDA ───────────────────────────────────────
t('zonas: se respeta lo elegido si es apto',
  resolveZonas(['cara', 'cuello'], ['cara', 'cuello', 'manos'], ['cara'], ORDEN_Z),
  ['cara', 'cuello']);
// Tanda mixta en un mismo picker: cada producto se queda con lo suyo.
t('zonas: la crema de manos no se registra en cara',
  resolveZonas(['cara', 'manos'], ['manos'], ['manos'], ORDEN_Z), ['manos']);
t('zonas: el limpiador facial no se registra en manos',
  resolveZonas(['cara', 'manos'], ['cara', 'cuello'], ['cara'], ORDEN_Z), ['cara']);

// ── RESPALDOS ───────────────────────────────────────────────────────────────
// Sin elección (paso fijo, reaplicación rápida): las zonas por defecto.
t('zonas: sin elección escribe las de PRODUCT_ZONAS',
  resolveZonas(null, ['cara', 'cuello', 'manos'], ['cara', 'cuello'], ORDEN_Z),
  ['cara', 'cuello']);
// Nada de lo elegido le sirve → su zona habitual, nunca una inventada.
t('zonas: nada apto cae a la zona habitual',
  resolveZonas(['pies'], ['cara', 'cuello'], ['cara'], ORDEN_Z), ['cara']);
// Ni elección ni default aptos → VACÍO: el caller escribe null y el motor cae a
// PRODUCT_ZONAS, igual que todos los registros previos a la columna.
t('zonas: sin nada defendible devuelve vacío',
  resolveZonas(['pies'], ['cara'], ['cuerpo'], ORDEN_Z), []);
t('zonas: producto sin aptitud conocida respeta lo elegido',
  resolveZonas(['cuerpo'], [], [], ORDEN_Z), ['cuerpo']);

// ── HIDRATACIÓN: FILAS DEL PASO (byStepIdApps, aditivo) ─────────────────────
// Es lo que permite volver a pintar y editar las zonas al recargar el día.
const _hz = buildHydration([
  { id: 'a1', routine_step_id: 's1', product_id: 'p1', product_name: '💦 Toner', zones: ['cara'] },
  { id: 'a2', routine_step_id: 's1', product_id: 'p2', product_name: '✨ Serum', zones: null }
], {}, 15);
t('zonas: la etiqueta del paso no cambió', _hz.byStepId.get('s1'), '💦 Toner · ✨ Serum');
t('zonas: dos filas guardadas para el paso', _hz.byStepIdApps.get('s1').length, 2);
t('zonas: guarda el id de la fila', _hz.byStepIdApps.get('s1')[0].id, 'a1');
t('zonas: zones null se conserva', _hz.byStepIdApps.get('s1')[1].zones, null);
