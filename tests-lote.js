// ============================================================================
// tests-lote.js — lo que comparten las dos interfaces al ESCRIBIR registros
//
//   node tests-lote.js
//
// Por qué existe: el registro en lote de escritorio.js escribe filas en
// product_applications sin pasar por app.js. Si su fila no es idéntica a la
// del celular, la hidratación (palomitas) y el motor de dosis la leen distinto
// y el error solo se nota semanas después. Estas pruebas fijan esa paridad.
// Sin conteos escritos a mano: todo son invariantes (regla de tests del núcleo).
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const NOMBRES = ['productoDeNombre', 'zonasRegistroDe', 'rutinasDelDia', 'productoDePaso',
  'nombreRegistroPaso', 'nombreRegistroProducto', 'clavePaso', 'isoLocal',
  'filaAplicacionLote', 'LOTE_PREFIJO', 'buildHydration', 'resolveStepHydration',
  'localDateOfISO', 'ZONAS', 'PRODUCT_ZONAS'];
const archivos = ['pure.js', 'activos-matriz.js'];
archivos.forEach(f => { if (!fs.existsSync(path.join(dir, f))) { console.log('❌ falta ' + f); process.exit(1); } });
const fuente = archivos.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n')
  + `\n;__api = { ${NOMBRES.join(', ')} };`;
const ctx = { console, __api: null };
vm.createContext(ctx);
vm.runInContext(fuente, ctx, { filename: 'pure+matriz' });
const A = ctx.__api;

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`❌ ${name}\n   esperado: ${w}\n   obtenido: ${g}`);
}
const ORDEN = Object.keys(A.ZONAS).sort((a, b) => (A.ZONAS[a].orden || 99) - (A.ZONAS[b].orden || 99));

// ── productoDeNombre: las tres formas históricas ────────────────────────────
const P = [
  { id: 'p1', emoji: '💊', name: 'Retin-A', logged_as: '💊 Tretinoína' },
  { id: 'p2', emoji: '🌞', name: 'UVMune' },
  { id: 'p3', emoji: '🧼', name: 'Limpiador' }
];
t('nombre: por logged_as', A.productoDeNombre(P, '💊 Tretinoína').id, 'p1');
t('nombre: por "emoji nombre"', A.productoDeNombre(P, '💊 Retin-A').id, 'p1');
t('nombre: por nombre pelón', A.productoDeNombre(P, 'UVMune').id, 'p2');
t('nombre: recorta espacios', A.productoDeNombre(P, '  🌞 UVMune ').id, 'p2');
t('nombre: desconocido → null', A.productoDeNombre(P, 'otro'), null);
t('nombre: vacío → null', A.productoDeNombre(P, ''), null);

// ── rutinasDelDia: la regla del celular ─────────────────────────────────────
const R = [
  { id: 'amA', section_key: 'am', sort_order: 1, schedule_days: null },
  { id: 'pmT', section_key: 'pm', sort_order: 2, schedule_days: [1, 3, 5, 0] },
  { id: 'pmZ', section_key: 'pm', sort_order: 3, schedule_days: [2, 4, 6] },
  { id: 'b1',  section_key: 'body', sort_order: 5, schedule_days: null },
  { id: 'b2',  section_key: 'body', sort_order: 4, schedule_days: [1] },
  { id: 'f0',  section_key: 'feet', sort_order: 6, schedule_days: [] },
  { id: 'off', section_key: 'am', sort_order: 0, schedule_days: null, active: false }
];
const lun = A.rutinasDelDia(R, 1), mar = A.rutinasDelDia(R, 2);
t('día: am sin calendario toca siempre', [lun.am.id, mar.am.id], ['amA', 'amA']);
t('día: pm según calendario (lunes)', lun.pm.id, 'pmT');
t('día: pm según calendario (martes)', mar.pm.id, 'pmZ');
t('día: body trae TODAS, en orden', lun.body.map(r => r.id), ['b2', 'b1']);
t('día: body sin la de otro día', mar.body.map(r => r.id), ['b1']);
t('día: calendario vacío no toca nunca', lun.feet.length, 0);
t('día: una inactiva no toca', lun.am.id !== 'off', true);
t('día: sin rutinas → vacío', A.rutinasDelDia([], 3), { am: null, pm: null, body: [], feet: [] });

// ── nombres que se escriben ─────────────────────────────────────────────────
t('paso fijo: "emoji nombre" del producto, NO logged_as',
  A.nombreRegistroPaso({ name: 'x' }, P[0]), '💊 Retin-A');
t('paso informativo: el texto del paso',
  A.nombreRegistroPaso({ emoji: '💧', name: 'Agua tibia' }, null), '💧 Agua tibia');
t('paso sin emoji: sin espacio al frente', A.nombreRegistroPaso({ name: 'Agua tibia' }, null), 'Agua tibia');
t('picker: logged_as si existe', A.nombreRegistroProducto(P[0]), '💊 Tretinoína');
t('picker: si no, "emoji nombre"', A.nombreRegistroProducto(P[1]), '🌞 UVMune');
t('producto de paso: por id', A.productoDePaso({ product_id: 'p2', name: 'z' }, P).id, 'p2');
t('producto de paso: respaldo por nombre', A.productoDePaso({ name: 'Limpiador' }, P).id, 'p3');

// ── clave de renglón ────────────────────────────────────────────────────────
t('clave: categoría gana', A.clavePaso({ picker_category: '🌞 SPF Facial', product_id: 'p2' }), 'cat:🌞 SPF Facial');
t('clave: producto', A.clavePaso({ product_id: 'p2' }), 'prod:p2');
t('clave: nombre', A.clavePaso({ name: ' Agua tibia ' }), 'nom:Agua tibia');

// ── fecha local → applied_at, ida y vuelta ──────────────────────────────────
['2026-01-15', '2026-03-08', '2026-07-01', '2026-11-01', '2026-12-31'].forEach(d => {
  ['08:00', '22:00', '00:30', '23:59'].forEach(h => {
    t(`fecha: ${d} ${h} vuelve al mismo día local`, A.localDateOfISO(A.isoLocal(d, h)), d);
  });
});

// ── la fila de lote es la fila del celular + la marca ───────────────────────
const prodReal = Object.keys(A.PRODUCT_ZONAS).length
  ? { id: Object.keys(A.PRODUCT_ZONAS)[0], emoji: '•', name: 'x', category: '' } : null;
const fila = A.filaAplicacionLote({ nombre: '• x', prod: prodReal, fecha: '2026-09-21',
  hora: '22:00', stepId: 's9', lote: 'L1', orden: ORDEN });
t('fila: columnas exactas', Object.keys(fila).sort(),
  ['applied_at', 'notes', 'product_id', 'product_name', 'routine_step_id', 'source', 'zones']);
t('fila: source rutina (hidrata y se puede desmarcar desde el celular)', fila.source, 'rutina');
t('fila: marca de lote', fila.notes, A.LOTE_PREFIJO + 'L1');
t('fila: día correcto', A.localDateOfISO(fila.applied_at), '2026-09-21');
t('fila: zonas = las mismas que escribiría el celular',
  fila.zones, (z => z.length ? z : null)(A.zonasRegistroDe(prodReal, null, ORDEN)));
const sinProd = A.filaAplicacionLote({ nombre: 'Agua tibia', prod: null, fecha: '2026-09-21',
  hora: '08:00', stepId: 's1', lote: 'L1', orden: ORDEN });
t('fila: paso informativo sin producto', [sinProd.product_id, sinProd.zones], [null, null]);

// ── lo que escribe el lote, lo palomea la hidratación ───────────────────────
const h = A.buildHydration([Object.assign({ id: 'n1' }, fila)], {}, 15);
t('hidratación: la fila del lote marca SU paso',
  A.resolveStepHydration({ id: 's9' }, h, 'pm', 'x'), '• x');
t('hidratación: y no otro', A.resolveStepHydration({ id: 's8' }, h, 'pm', 'x'), null);

console.log(`\n${fail ? '❌' : '✅'} registro en lote: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
