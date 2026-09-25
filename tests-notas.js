// ============================================================================
// tests-notas.js — cómo se lee y se guarda una nota (sección Notas)
//
//   node tests-notas.js
//
// Por qué existe: una nota guarda productos por su id y se muestra con el
// nombre actual. Si la ida (editor → guardado) y la vuelta (guardado →
// editor) no son simétricas, una etiqueta se pierde en silencio al editar.
// Sin conteos escritos a mano (regla de tests del núcleo).
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const NOMBRES = ['renderNota', 'notaInline', 'productosDeNota', 'notaAEdicion',
  'notaDeEdicion', 'buscarProductosNota', 'notaNorm'];
if (!fs.existsSync(path.join(dir, 'pure.js'))) { console.log('❌ falta pure.js'); process.exit(1); }
const ctx = { console, __api: null };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'pure.js'), 'utf8') + `\n;__api = { ${NOMBRES.join(', ')} };`, ctx);
const A = ctx.__api;
NOMBRES.forEach(n => { if (typeof A[n] !== 'function') { console.log('❌ pure.js no define ' + n); process.exit(1); } });

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`❌ ${name}\n   esperado: ${w}\n   obtenido: ${g}`);
}
const ok = (name, cond) => t(name, !!cond, true);

const ID1 = 'ecef5283-7bdd-460b-a9a8-ccb917942c4c';
const ID2 = '70f8c5ee-c241-41d4-bfe4-2cf4d52a7577';
const ID3 = '77523cc9-38dd-4016-9148-51343d36ccf7';
const ID_BORRADO = '00000000-0000-4000-8000-000000000000';
const PROD = [
  { id: ID1, name: 'Finacea Ácido Azelaico 15%', brand: 'Bayer', status: 'ok' },
  { id: ID2, name: 'Retin-A Tretinoína', brand: 'Janssen', status: 'out' },
  { id: ID3, name: 'Retin-A Tretinoína', brand: 'Janssen', status: 'ok' }
];
const porId = {}; PROD.forEach(p => { porId[p.id] = p; });

// ── etiquetas ───────────────────────────────────────────────────────────────
const h1 = A.renderNota(`Aplica @[${ID1}] encima`, porId);
ok('etiqueta: muestra el nombre actual', h1.includes('>Finacea Ácido Azelaico 15%</span>'));
ok('etiqueta: lleva el id para abrir la ficha', h1.includes(`data-prod="${ID1}"`));
ok('etiqueta: el id no se ve como texto', !h1.replace(/data-prod="[^"]*"/g, '').includes(ID1));
const renombrado = Object.assign({}, porId, { [ID1]: Object.assign({}, PROD[0], { name: 'Finacea 15% gel' }) });
ok('etiqueta: si se renombra en el catálogo, la nota lo sigue', A.renderNota(`@[${ID1}]`, renombrado).includes('>Finacea 15% gel<'));
ok('etiqueta: agotado sale en gris', A.renderNota(`@[${ID2}]`, porId).includes('class="nt-pr out"'));
ok('etiqueta: id inexistente dice "producto borrado"', A.renderNota(`@[${ID_BORRADO}]`, porId).includes('producto borrado'));
ok('etiqueta: nombre sin resolver se marca, no desaparece', A.renderNota('@[Numbuzin No.3]', porId).includes('¿Numbuzin No.3?'));

// ── seguridad: nada del texto se vuelve HTML ────────────────────────────────
const xss = A.renderNota('<img src=x onerror=alert(1)> **<b>ok</b>**', porId);
ok('escape: una etiqueta HTML escrita se muestra como texto', !xss.includes('<img') && xss.includes('&lt;img'));
const pMalo = { [ID1]: Object.assign({}, PROD[0], { name: '<script>x</script>' }) };
ok('escape: un nombre de producto raro no inyecta HTML', !A.renderNota(`@[${ID1}]`, pMalo).includes('<script>'));

// ── estructura ──────────────────────────────────────────────────────────────
const doc = A.renderNota([
  '# Parte 1', 'Intro', 'segunda línea', '', '## Esquema A',
  '1. Limpieza', '2. **Tretinoína** {{⏱ 15 min}}', '   - Capa A', '   - Capa B', '3. Crema',
  '', '> Regla de oro', '- suelto'
].join('\n'), porId);
ok('estructura: # es título', doc.includes('<h2>Parte 1</h2>'));
ok('estructura: ## es subtítulo', doc.includes('<h3>Esquema A</h3>'));
ok('estructura: renglones seguidos son un párrafo', doc.includes('<p>Intro<br>segunda línea</p>'));
ok('estructura: negrita', doc.includes('<b>Tretinoína</b>'));
ok('estructura: espera', doc.includes('<span class="nt-espera">⏱ 15 min</span>'));
ok('estructura: viñetas con sangría van DENTRO del paso', /<li>.*Tretinoína.*<ul><li>Capa A<\/li><li>Capa B<\/li><\/ul><\/li><li>Crema<\/li>/.test(doc));
t('estructura: los pasos no se parten en dos listas', (doc.match(/<ol/g) || []).length, 1);
ok('estructura: > es aviso', doc.includes('<div class="nt-aviso">Regla de oro</div>'));
ok('estructura: lista que empieza en 4 conserva su número', A.renderNota('4. Tretinoína', porId).includes('<ol start="4">'));
t('estructura: texto vacío no truena', A.renderNota('', porId), '');
t('estructura: CRLF no deja \\r', A.renderNota('a\r\nb', porId), '<p>a<br>b</p>');

// ── ida y vuelta del editor ─────────────────────────────────────────────────
const guardado = `Usa @[${ID1}] y luego @[${ID3}].`;
const enEditor = A.notaAEdicion(guardado, porId);
t('editor: muestra nombres, no ids', enEditor, 'Usa @[Finacea Ácido Azelaico 15%] y luego @[Retin-A Tretinoína].');
const vuelta = A.notaDeEdicion(enEditor, PROD, { [A.notaNorm('Retin-A Tretinoína')]: ID3 });
t('editor: vuelta exacta con el producto elegido en el menú', vuelta, { cuerpo: guardado, faltan: [] });
const ambiguo = A.notaDeEdicion('@[Retin-A Tretinoína]', PROD, {});
t('editor: nombre repetido sin elección NO se adivina', ambiguo.faltan, ['Retin-A Tretinoína']);
t('editor: nombre sin acentos ni mayúsculas se reconoce', A.notaDeEdicion('@[finacea acido azelaico 15%]', PROD).cuerpo, `@[${ID1}]`);
t('editor: nombre inexistente se reporta', A.notaDeEdicion('@[Round Lab Tone-Up]', PROD).faltan, ['Round Lab Tone-Up']);
t('editor: un id ya guardado pasa intacto', A.notaDeEdicion(`@[${ID2}]`, PROD).cuerpo, `@[${ID2}]`);
t('productosDeNota: ids sin repetir', A.productosDeNota(`@[${ID1}] @[${ID3}] @[${ID1}] @[texto]`), [ID1, ID3]);

// ── buscador del @ ──────────────────────────────────────────────────────────
t('buscador: sin acentos encuentra', A.buscarProductosNota(PROD, 'azelaico').map(p => p.id), [ID1]);
t('buscador: por marca', A.buscarProductosNota(PROD, 'bayer').map(p => p.id), [ID1]);
t('buscador: agotados al final', A.buscarProductosNota(PROD, 'retin').map(p => p.id), [ID3, ID2]);

console.log(`\n${fail ? '❌' : '✅'} notas: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
