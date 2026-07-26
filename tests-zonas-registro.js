// ============================================================================
// tests-zonas-registro.js — qué se ESCRIBE en product_applications.zones
//
//   node tests-zonas-registro.js
//
// Por qué existe: `resolveZonas` no falla ruidosamente cuando se equivoca. Una
// zona mal resuelta escribe una fila perfectamente válida que alimenta el eje
// equivocado de Progreso, y el error solo se nota semanas después como un
// porcentaje que no cuadra. Es exactamente el tipo de regla que la sesión del
// "espejo" de cuello perdió en silencio por no tener prueba propia.
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// pure.js y activos-matriz.js son scripts clásicos sin exports (no hay build en
// este repo, a propósito). Se cargan en UN solo script de vm y se cosechan los
// nombres al final: en scripts separados, un `const` de nivel superior no queda
// en el contexto y se leería como undefined.
const dir = __dirname;
const NOMBRES = ['resolveZonas', 'unionZonas', 'ordenarZonas', 'buildHydration',
                 'ZONAS', 'PRODUCT_ZONAS', 'zonasAptasDe', 'ZONAS_APTAS_OVERRIDE'];
const fuente = ['pure.js', 'activos-matriz.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n')
  + `\n;__api = { ${NOMBRES.join(', ')} };`;
const ctx = { console, __api: null };
vm.createContext(ctx);
vm.runInContext(fuente, ctx, { filename: 'pure+matriz' });
const { resolveZonas, unionZonas, ordenarZonas, buildHydration,
        ZONAS, PRODUCT_ZONAS, zonasAptasDe, ZONAS_APTAS_OVERRIDE } = ctx.__api;

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`❌ ${name}\n   esperado: ${w}\n   obtenido: ${g}`);
}

const ORDEN = Object.keys(ZONAS).sort((a, b) => (ZONAS[a].orden || 99) - (ZONAS[b].orden || 99));

// ── ORDEN CANÓNICO ──────────────────────────────────────────────────────────
// El array guardado tiene que ser comparable entre filas: mismo contenido,
// mismo orden. Si no, dos registros idénticos se ven distintos en la base.
t('orden: sigue el orden de ZONAS',
  ordenarZonas(['manos', 'cara', 'cuello'], ORDEN), ['cara', 'cuello', 'manos']);
t('orden: una zona desconocida va al final',
  ordenarZonas(['ombligo', 'cara'], ORDEN), ['cara', 'ombligo']);

// ── UNIÓN (preselección del multipicker) ────────────────────────────────────
t('unión: sin duplicados y ordenada',
  unionZonas([['cuello', 'cara'], ['cara', 'manos']], ORDEN), ['cara', 'cuello', 'manos']);
t('unión: aguanta basura', unionZonas([null, undefined, ['cara'], []], ORDEN), ['cara']);
t('unión: nada da vacío', unionZonas([], ORDEN), []);

// ── LO ELEGIDO GANA, PERO LA APTITUD MANDA ──────────────────────────────────
t('elección respetada cuando es apta',
  resolveZonas(['cara', 'cuello'], ['cara', 'cuello', 'manos'], ['cara'], ORDEN),
  ['cara', 'cuello']);
t('lo no apto se recorta',
  resolveZonas(['cara', 'manos'], ['cara', 'cuello'], ['cara'], ORDEN), ['cara']);

// EL CASO REAL: tanda con una crema de manos y un limpiador facial, marcando
// cara + manos. Cada uno se queda con lo suyo — nadie se pone el limpiador
// facial en las manos porque compartieran el picker.
t('tanda mixta: el limpiador facial NO cae en manos',
  resolveZonas(['cara', 'manos'], ['cara', 'cuello'], ['cara'], ORDEN), ['cara']);
t('tanda mixta: la crema de manos NO cae en cara',
  resolveZonas(['cara', 'manos'], ['manos'], ['manos'], ORDEN), ['manos']);

// ── RESPALDO A LA ZONA HABITUAL ─────────────────────────────────────────────
// Nada de lo elegido le sirve → su zona de siempre, no una inventada.
t('nada apto: cae a PRODUCT_ZONAS',
  resolveZonas(['pies'], ['cara', 'cuello'], ['cara'], ORDEN), ['cara']);
// Sin elección (paso fijo, reaplicación rápida, notificación) → zonas por
// defecto, que es lo mismo que ya calculaba el motor, pero como DATO.
t('sin elección: escribe las zonas por defecto',
  resolveZonas(null, ['cara', 'cuello', 'manos'], ['cara', 'cuello'], ORDEN),
  ['cara', 'cuello']);
// Ni elección ni default aptos → VACÍO, para que el caller escriba null y el
// motor caiga a PRODUCT_ZONAS. Nunca inventa una zona con tal de no ir vacío.
t('sin nada defendible: vacío (el caller escribe null)',
  resolveZonas(['pies'], ['cara'], ['cuerpo'], ORDEN), []);
// Producto sin aptitud conocida (categoría nueva, sin entrada en la matriz):
// no hay con qué filtrar, se respeta lo elegido.
t('sin aptitud conocida: respeta lo elegido',
  resolveZonas(['cuerpo'], [], [], ORDEN), ['cuerpo']);

// ── EL HISTÓRICO NO SE MUEVE ────────────────────────────────────────────────
// La invariante que más importa: para todo producto del catálogo, registrar sin
// elegir zona escribe EXACTAMENTE sus PRODUCT_ZONAS. Si esto falla, los ejes de
// cara —meses de histórico con techos calibrados— dejan de cuadrar.
let desviados = [];
Object.keys(PRODUCT_ZONAS).forEach(id => {
  const def = PRODUCT_ZONAS[id];
  const aptas = zonasAptasDe({ id, category: '__desconocida__' });  // aptitud = override ∪ dosis
  const got = resolveZonas(null, aptas, def, ORDEN);
  const want = ordenarZonas(def, ORDEN);
  if (JSON.stringify(got) !== JSON.stringify(want)) desviados.push({ id, want, got });
});
t('histórico: ningún producto cambia sus zonas por defecto', desviados, []);
t('histórico: el catálogo con zonas sigue siendo 90', Object.keys(PRODUCT_ZONAS).length, 90);

// Un override que CONTRADICE las zonas por defecto es el fallo silencioso más
// probable de este diseño: la aptitud recorta el default y el producto empieza
// a registrarse en menos zonas de las que alimentaba, sin que nada avise.
const contradicen = Object.keys(ZONAS_APTAS_OVERRIDE).filter(id => {
  const def = PRODUCT_ZONAS[id] || [];
  const ap = ZONAS_APTAS_OVERRIDE[id];
  return def.some(z => ap.indexOf(z) === -1);
});
t('aptitud: ningún override contradice las zonas por defecto', contradicen, []);

// Los 12 SPF faciales llevan cuello a propósito (el "espejo" que se perdió al
// refactorizar y ahora es dato). Si alguien lo quita, esto avisa.
const spfConCuello = Object.keys(PRODUCT_ZONAS)
  .filter(id => PRODUCT_ZONAS[id].indexOf('cara') !== -1 && PRODUCT_ZONAS[id].indexOf('cuello') !== -1
             && PRODUCT_ZONAS[id].indexOf('manos') !== -1).length;
t('espejo de cuello: los SPF faciales siguen llevando cuello y manos', spfConCuello, 12);

// ── HIDRATACIÓN: LAS FILAS DEL PASO ─────────────────────────────────────────
// byStepIdApps es lo que permite volver a pintar y EDITAR las zonas al recargar
// el día. Es aditivo: byStepId (la etiqueta) no cambia de forma.
const h = buildHydration([
  { id: 'a1', routine_step_id: 's1', product_id: 'p1', product_name: '💦 Toner', zones: ['cara'] },
  { id: 'a2', routine_step_id: 's1', product_id: 'p2', product_name: '✨ Serum', zones: null },
  { id: 'a3', routine_step_id: null, product_id: 'p3', product_name: '🌞 SPF',
    source: 'reaplicacion', applied_at: '2026-07-25T18:00:00Z' }
], {}, 15);
t('hidratación: la etiqueta del paso no cambió', h.byStepId.get('s1'), '💦 Toner · ✨ Serum');
t('hidratación: dos filas para el paso', h.byStepIdApps.get('s1').length, 2);
t('hidratación: guarda id y zonas', h.byStepIdApps.get('s1')[0],
  { id: 'a1', product_id: 'p1', product_name: '💦 Toner', zones: ['cara'] });
t('hidratación: zones null se conserva como null', h.byStepIdApps.get('s1')[1].zones, null);
// Una reaplicación no es un paso: no debe aparecer aquí ni ofrecer editor.
t('hidratación: la reaplicación no entra en byStepIdApps', h.byStepIdApps.size, 1);

console.log(`\n${fail ? '❌' : '✅'} zonas de registro: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
