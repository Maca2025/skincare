// ============================================================================
// harness.mjs — ARNÉS DE VERIFICACIÓN. NO ES PARTE DE LA APP.
//
// No se despliega, no lo carga index.html, no lo cachea el service worker. Es
// una herramienta de desarrollo: levanta index.html + app.js REALES en Chromium
// con Supabase falseado y 84 días de datos sintéticos, y comprueba qué se pinta
// y qué se le pide a la base. Existe porque `tests.html` solo puede probar
// `pure.js` — todo lo que vive en `app.js` (Progreso, el reporte, el borrado de
// pasos, las notas del día) no tenía forma de verificarse sin tocar producción.
//
// CÓMO CORRERLO
//   npm i playwright        (una sola vez; instala también Chromium)
//   node harness.mjs
//
// QUÉ COMPRUEBA (37 aserciones)
//   · Que Progreso se pinta sin errores de JavaScript.
//   · Que el reporte de la dermatóloga trae los ejes de DOSIS y ya no la
//     adherencia por rol.
//   · Que el estado de piel y la exposición solar NO mandan `notes` (no pueden
//     pisar la nota del día) y que respetan el backdate.
//   · Que desmarcar un paso borra con el filtro espejo de la hidratación
//     (`source.is.null,source.neq.reaplicacion`) y pide de vuelta las filas.
//   · Que un SPF europeo con sello UVA cuenta igual que un PA++++.
//   · Que al editar un producto se apaga `clinical_role` y al crearlo se
//     escribe `sort_order`.
//
// EL TRUCO QUE LO HACE POSIBLE: el stub de Supabase REGISTRA cada llamada
// (tabla + cadena de métodos + argumentos) en `window.__OPS`, así que se puede
// afirmar sobre lo que la app le PIDE a la base sin tener una base. Y como los
// `let` de nivel superior de un script clásico viven en el ámbito léxico global,
// un <script> añadido al final puede leerlos y escribirlos sin tocar app.js.
// ============================================================================
import pw from 'playwright';
const { chromium } = pw;
import fs from 'fs';
import path from 'path';

const dir = process.cwd();

// ── CATÁLOGO SINTÉTICO (ids reales, para que PRODUCT_DOSE los reconozca) ─────
const P = [
  { id: '70f8c5ee-c241-41d4-bfe4-2cf4d52a7577', name: 'Retin-A Tretinoína 0.025%', emoji: '🔬', brand: 'Janssen', category: '💊 Activos', tags: [], tier: 'best', status: 'ok', clinical_roles: ['regeneracion_celular'], schedule_days: null, started_at: null, sort_order: 1 },
  { id: '57ff2048-f0d3-42a6-a9e5-8e56fb8a564e', name: 'Anthelios UVMune 400 SPF50', emoji: '🌞', brand: 'La Roche-Posay', category: '🌞 SPF Facial', tags: [{ cls: 'pa4' }, { cls: 'uva400' }], tier: 'best', status: 'ok', clinical_roles: ['spf_facial'], schedule_days: null, started_at: null, sort_order: 2 },
  { id: 'ecef5283-7bdd-460b-a9a8-ccb917942c4c', name: 'Finacea Ácido Azelaico 15%', emoji: '💊', brand: 'Galderma', category: '💊 Activos', tags: [], tier: 'best', status: 'ok', clinical_roles: ['despigmentacion'], schedule_days: null, started_at: null, sort_order: 3 },
  { id: 'd6f17e28-ccb7-4267-a588-5812bdfa2fde', name: 'Toleriane Double Repair', emoji: '💧', brand: 'La Roche-Posay', category: '💧 Hidratantes', tags: [], tier: 'best', status: 'ok', clinical_roles: ['barrera'], schedule_days: null, started_at: null, sort_order: 4 },
  { id: '786a92d8-a357-4053-9b4b-d5c96ae9e821', name: 'Crema Urea 80%', emoji: '🦶', brand: 'Genérico', category: '🦶 Pies', tags: [], tier: 'best', status: 'ok', clinical_roles: [], schedule_days: null, started_at: null, sort_order: 5 },
  { id: '2b41c15a-bbab-4a44-b583-476d0f11f3f9', name: 'Dove Ceramidas Body Lotion', emoji: '🧴', brand: 'Dove', category: '🧴 Cuerpo', tags: [], tier: 'good', status: 'ok', clinical_roles: [], schedule_days: null, started_at: null, sort_order: 6 },
  // Europeo con sello UVA y SIN etiqueta PA — el caso que la tabla comparativa
  // marcaba con ✗ aunque protege igual. No se le registran aplicaciones, así que
  // no mueve ningún eje de dosis.
  { id: '4c775124-b388-45d0-941f-77cf67c48148', name: "L'Oréal UV Defender SPF50", emoji: '🌞', brand: "L'Oréal", category: '🌞 SPF Facial', tags: [{ cls: 'euuva' }], tier: 'good', status: 'ok', clinical_roles: ['spf_facial'], schedule_days: null, started_at: null, sort_order: 7 },
];

// 84 días de registros, con patrones distintos por producto para que los ejes
// no salgan todos iguales.
const apps = [], notes = [];
const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
let nId = 0;
const iso = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
for (let back = 84; back >= 1; back--) {
  const d = new Date(hoy); d.setDate(d.getDate() - back);
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dow = d.getDay();
  const add = (p, h, zones) => apps.push({
    id: 'a' + (++nId), product_name: p.emoji + ' ' + p.name, product_id: p.id,
    applied_at: iso(d, h), source: 'rutina', routine_step_id: null, zones
  });
  add(P[1], 8, ['cara', 'cuello', 'manos']);                    // SPF diario
  if (back % 3 !== 0) add(P[1], 13, ['cara', 'cuello']);        // reaplicación casi diaria
  add(P[3], 9, ['cara']);                                       // hidratante diario
  if ([1, 3, 5].includes(dow)) add(P[0], 21, ['cara', 'cuello']); // tretinoína 3 noches
  if ([0, 2, 4, 6].includes(dow)) add(P[2], 21, ['cara', 'cuello']); // azelaico las otras
  if (dow === 0 || dow === 3) add(P[4], 22, ['pies']);
  if (back % 2 === 0) add(P[5], 20, ['cuerpo']);
  notes.push({ note_date: ds, skin_state: 3 + (back % 3 === 0 ? 1 : 0), sun_exposure: 'normal', wake_time: '07:30' });
}

const DATA = {
  products: P,
  product_applications: apps,
  daily_notes: notes,
  routines: [{ id: 'r1', section_key: 'am', schedule_days: null, sort_order: 1 }],
  routine_steps: [],
  treatment_events: [],
  // Dos fotos del MISMO encuadre: es lo mínimo para que la tira de recortes
  // exista (con una sola, la app muestra el aviso en vez de la tira).
  progress_photos: [
    { id: 'ph1', photo_type: 'escote', photo_url: 'escote-1.jpg', photo_date: '2026-06-01', caption: '' },
    { id: 'ph2', photo_type: 'escote', photo_url: 'escote-2.jpg', photo_date: '2026-08-01', caption: '' },
  ],
  // Una mancha en el vocabulario NUEVO: vive en el territorio `cuello` (que es
  // donde se mide la dosis) y se fotografía en el encuadre `escote`.
  skin_spots: [
    { id: 'sp1', name: 'La del escote', territorio: 'cuello', encuadre: 'escote',
      lateralidad: 'centro', zone: 'escote', status: 'activa', first_noticed: '2026-05-01',
      notes: null, pos_x: 40, pos_y: 55, reference_photo_id: 'ph1' },
  ],
  spot_observations: [
    { id: 'ob1', spot_id: 'sp1', observed_at: '2026-06-01', shade: 4, notes: null, photo_id: 'ph1' },
    { id: 'ob2', spot_id: 'sp1', observed_at: '2026-08-01', shade: 3, notes: null, photo_id: 'ph2' },
  ],
};

const stub = `
window.__DATA = ${JSON.stringify(DATA)};
window.fetch = () => Promise.reject(new Error('sin red en el arnés'));
window.__OPS = [];
(function () {
  function q(table) {
    const rows = (window.__DATA[table] || []).slice();
    const log = { table, chain: [] };
    window.__OPS.push(log);
    const rec = (m) => (...a) => { log.chain.push({ m, a }); return o; };
    const o = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), delete: rec('delete'),
      upsert: rec('upsert'), eq: rec('eq'), in: rec('in'), gte: rec('gte'), lt: rec('lt'),
      lte: rec('lte'), not: rec('not'), or: rec('or'), order: rec('order'), limit: rec('limit'),
      maybeSingle() { log.chain.push({ m: 'maybeSingle', a: [] }); return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { log.chain.push({ m: 'single', a: [] }); return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); }
    };
    return o;
  }
  window.supabase = { createClient: () => ({
    from: q,
    auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange() {}, signInWithPassword() {}, signOut() {} },
    storage: { from: () => ({ createSignedUrls: (paths) => Promise.resolve({ data: (paths || []).map(p => ({ signedUrl: 'https://arnes.local/' + p, error: null })) }), upload: () => Promise.resolve({}), remove: () => Promise.resolve({}) }) },
    rpc: () => Promise.resolve({ error: new Error('sin rpc') })
  }) };
})();
`;

// index.html sin el CDN de Supabase, con el stub inyectado antes de los scripts.
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/, `<script>${stub}</script>`);
// Epílogo: los `let` de nivel superior de un script clásico viven en el ámbito
// léxico global, así que otro <script> posterior sí puede tocarlos.
html = html.replace('</body>', `<script>
window.__T = {
  setProducts(v) { allProducts = v; },
  get lastReportData() { return lastReportData; },
  loadHistory: () => loadHistory(),
  openDermReport: () => openDermReport(),
  setSkinState: v => setSkinState(v),
  setSunExposure: v => setSunExposure(v),
  saveNote: () => saveNote(),
  notesDateStr: () => notesDateStr(),
  unlog: (id, step) => unlogRoutineStep(id, step),
  TODAY_STR: () => TODAY_STR,
  compareRows: () => compareRowsFromProducts(),
  setEditing: id => { editingProductId = id; },
  saveProduct: () => saveCustomProduct(),
  loadSpots: () => loadSpots(),
  openSpot: id => openSpotModal(id),
  saveSpot: () => saveSpot(),
  doseByZona: () => doseByZona,
  encuadresDe: t => encuadresDeTerritorio(t).map(e => e.key)
};
</script></body>`);
fs.writeFileSync(path.join(dir, '__harness.html'), html);

const browser = await chromium.launch();
const page = await browser.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|favicon|icon-|manifest/.test(x)) errores.push('console: ' + x); });

await page.goto('file://' + path.join(dir, '__harness.html'));
await page.waitForTimeout(400);

// Reporte: capturamos lo que se escribiría en la ventana emergente.
await page.evaluate(() => {
  window.__reportHTML = '';
  window.open = () => ({ document: { write(h) { window.__reportHTML += h; }, close() {} } });
});

await page.evaluate(d => { window.__T.setProducts(d); }, P);
await page.evaluate(() => window.__T.loadHistory());
await page.waitForTimeout(300);

const progreso = await page.evaluate(() => document.getElementById('history-content').innerHTML);
const rep = await page.evaluate(async () => { await window.__T.openDermReport(); return window.__reportHTML; });
const lrd = await page.evaluate(() => JSON.parse(JSON.stringify(window.__T.lastReportData || null)));

fs.writeFileSync(path.join(dir, '__progreso.html'), progreso);
fs.writeFileSync(path.join(dir, '__reporte.html'), rep);

// ── ASERCIONES ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log('❌ ' + name); } };

t('sin errores de JavaScript en la página', errores.length === 0);
if (errores.length) console.log('   ' + errores.join('\n   '));

t('Progreso ya no pinta la tarjeta del camino de 16 semanas', !/pj-card|Semana \d+ de 16|Aclaran/.test(progreso));
t('Progreso sigue pintando las barras de estímulo', /Estímulo entregado/.test(progreso));
t('Progreso conserva la adherencia como vista secundaria', /Adherencia a rutinas/.test(progreso));

t('lastReportData trae los ejes de cara', !!(lrd && lrd.cara && lrd.cara.length));
t('lastReportData trae cuello', !!(lrd && lrd.cuello && lrd.cuello.length));
t('lastReportData trae otras zonas', !!(lrd && lrd.otros && lrd.otros.length));
t('lastReportData ya no trae los roles viejos', !!(lrd && lrd.despig === undefined && lrd.rege === undefined));
t('estímulo promedio calculado', !!(lrd && typeof lrd.constancia === 'number'));

t('el reporte YA NO dice "Adherencia por objetivo"', !/Adherencia por objetivo/.test(rep));
t('el reporte YA NO dice "Constancia global"', !/Constancia global/.test(rep));
t('el reporte encabeza con Estímulo entregado', /<h2>Estímulo entregado<\/h2>/.test(rep));
t('el reporte trae el bloque de Cara', /<h3>Cara<\/h3>/.test(rep));
t('el reporte trae el bloque de Cuello y escote', /<h3>Cuello y escote<\/h3>/.test(rep));
t('el reporte trae el bloque de otras zonas', /Cuerpo, manos, pies/.test(rep));
t('el reporte dice estímulo promedio', /Estímulo promedio en cara/.test(rep));
t('el reporte conserva evolución fotográfica y notas', /Evolución fotográfica/.test(rep) && /Notas y estado de piel/.test(rep));
t('el reporte conserva las preguntas para la consulta', /Preguntas sugeridas/.test(rep));
t('el reporte ya no habla de "Semana N de 16"', !/de 16/.test(rep));


// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 2 — los tres bugs de comportamiento (arreglados el 2026-08-09)
// ════════════════════════════════════════════════════════════════════════════
const ops = async (fn) => page.evaluate(async (src) => {
  window.__OPS = [];
  // Envuelto en una función async: el fragmento puede llevar `return`.
  // eslint-disable-next-line no-eval
  await eval('(async () => {' + src + '})()');
  return JSON.parse(JSON.stringify(window.__OPS));
}, fn);

const HOY = await page.evaluate(() => window.__T.TODAY_STR());
const up = o => { const c = (o.chain || []).find(x => x.m === 'upsert'); return c ? c.a[0] : null; };
const notasOps = o => o.filter(x => x.table === 'daily_notes' && up(x));

// ── BUG 1: el estado de piel pisaba la nota del día ─────────────────────────
let o1 = await ops("window.__T.setSkinState(3)");
let pay1 = notasOps(o1).map(up)[0];
t('estado de piel: ya NO manda `notes` (no puede pisar la nota)', !!pay1 && !('notes' in pay1));
t('estado de piel: manda su columna y la fecha', !!pay1 && pay1.skin_state === 3 && pay1.note_date === HOY);

let o2 = await ops("window.__T.setSunExposure('playa')");
let pay2 = notasOps(o2).map(up)[0];
t('exposición solar: ya NO manda `notes` ni `skin_state`', !!pay2 && !('notes' in pay2) && !('skin_state' in pay2));
t('exposición solar: manda su columna', !!pay2 && pay2.sun_exposure === 'playa');

// ── BUG 2: el backdate no aplicaba a las notas ──────────────────────────────
const AYER = await page.evaluate(() => {
  const d = new Date(); d.setDate(d.getDate() - 3);
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  document.getElementById('backdate-input').value = s + 'T21:00';
  return s;
});
t('notesDateStr sigue el backdate', (await page.evaluate(() => window.__T.notesDateStr())) === AYER);
let o3 = await ops("window.__T.setSkinState(2)");
let pay3 = notasOps(o3).map(up)[0];
t('con backdate, el estado de piel se guarda en ESE día', !!pay3 && pay3.note_date === AYER);
let o4 = await ops("document.getElementById('daily-notes').value = 'probando'; return window.__T.saveNote()");
let pay4 = notasOps(o4).map(up)[0];
t('con backdate, la nota se guarda en ESE día', !!pay4 && pay4.note_date === AYER && pay4.notes === 'probando');
await page.evaluate(() => { document.getElementById('backdate-input').value = ''; });
t('sin backdate vuelve a hoy', (await page.evaluate(() => window.__T.notesDateStr())) === HOY);

// ── BUG 3: desmarcar no borraba los registros viejos ────────────────────────
const o5 = await ops(`
  const st = document.createElement('div');
  st.innerHTML = '<div class="sc"><div class="sc-top"><span class="sc-name">🌞 Anthelios UVMune 400 SPF50</span></div></div>';
  document.body.appendChild(st);
  return window.__T.unlog('rs-1', st);
`);
const del = o5.find(x => x.table === 'product_applications' && (x.chain || []).some(c => c.m === 'delete'));
const cad = del ? del.chain.map(c => c.m + '(' + JSON.stringify(c.a) + ')').join(' · ') : '';
t('desmarcar: el filtro es el espejo de la hidratación, no `source = rutina`',
  /or\(\["source\.is\.null,source\.neq\.reaplicacion"\]\)/.test(cad));
t('desmarcar: ya NO filtra por `source = rutina`', !/eq\(\["source","rutina"\]\)/.test(cad));
t('desmarcar: pide de vuelta las filas borradas para saber si borró algo',
  /select\(\["id"\]\)/.test(cad));
t('desmarcar: sigue acotado al día y al paso',
  /gte\(\["applied_at/.test(cad) && /lt\(\["applied_at/.test(cad) && /eq\(\["routine_step_id","rs-1"\]\)/.test(cad));


// ── BLOQUE 3 — equivalencia UVA, rol legado y orden del catálogo ────────────
const filas = await page.evaluate(() => window.__T.compareRows());
const euro = filas.find(f => /UV Defender/.test(f.name));
const asia = filas.find(f => /Anthelios/.test(f.name));
t('comparativa: un SPF europeo con sello UVA ya cuenta como PA++++', !!euro && euro.pa4 === 1);
t('comparativa: el PA++++ asiático sigue contando', !!asia && asia.pa4 === 1);

const opsEdit = await ops(`
  window.__T.setEditing('70f8c5ee-c241-41d4-bfe4-2cf4d52a7577');
  document.getElementById('pf-name').value = 'Retin-A Tretinoína 0.025%';
  const sel = document.getElementById('pf-cat');
  if (![...sel.options].some(o => o.value === '💊 Activos')) { const o = document.createElement('option'); o.value = '💊 Activos'; sel.appendChild(o); }
  sel.value = '💊 Activos';
  return window.__T.saveProduct();
`);
const upd = opsEdit.find(o => o.table === 'products' && (o.chain || []).some(c => c.m === 'update'));
const payU = upd ? upd.chain.find(c => c.m === 'update').a[0] : null;
t('editar producto: apaga la columna legada clinical_role', !!payU && payU.clinical_role === null);
t('editar producto: ya no manda started_at dos veces', !!payU && Object.keys(payU).filter(k => k === 'started_at').length === 1);

const opsNew = await ops(`
  window.__T.setEditing(null);
  document.getElementById('pf-name').value = 'Producto de prueba';
  document.getElementById('pf-cat').value = '💊 Activos';
  return window.__T.saveProduct();
`);
const ins = opsNew.find(o => o.table === 'products' && (o.chain || []).some(c => c.m === 'insert'));
const payI = ins ? ins.chain.find(c => c.m === 'insert').a[0] : null;
t('crear producto: ahora escribe sort_order', !!payI && typeof payI.sort_order === 'number');
t('crear producto: lo coloca al final del catálogo', !!payI && payI.sort_order === 8);

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 4 — el rediseño de zonas (2026-08-10)
//
// Lo que se protege aquí es la separación de los tres ejes: TERRITORIO (dónde
// se aplica el producto y dónde se mide la dosis), ENCUADRE (desde qué ángulo
// se fotografía) y LATERALIDAD (de qué lado). Antes del rediseño, una mancha
// solo tenía `zone`, que guardaba un encuadre disfrazado de zona; por eso el
// mapa de manchas nunca podía cruzarse con el motor de dosis.
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => window.__T.loadSpots());
await page.waitForTimeout(200);
const manchas = await page.evaluate(() => document.getElementById('spots-content').innerHTML);
fs.writeFileSync(path.join(dir, '__manchas.html'), manchas);

t('manchas: se agrupan por TERRITORIO, no por encuadre',
  /spot-zone-hdr[^>]*>[^<]*Cuello y escote/.test(manchas) && !/spot-zone-hdr[^>]*>[^<]*Escote</.test(manchas));
t('manchas: la ficha muestra el estímulo entregado a esa zona',
  /spot-dose-chip/.test(manchas) && /Estímulo entregado a esta zona/.test(manchas));
t('manchas: la meta de la mancha dice su encuadre', /Escote/.test(manchas));
t('manchas: la tira de recortes se arma (une por encuadre, no por territorio)',
  /crop-strip/.test(manchas) && !/aparece a partir de la segunda foto/.test(manchas));

const dbz = await page.evaluate(() => JSON.parse(JSON.stringify(window.__T.doseByZona() || null)));
t('estímulo por territorio: existe un eje por cada zona de ZONAS',
  !!(dbz && dbz.cara && dbz.cara.length && dbz.cuello && dbz.cuello.length));
t('estímulo por territorio: cuello trae sus 5 funciones', !!(dbz && dbz.cuello && dbz.cuello.length === 5));

// El menú de zona de una mancha: antes se llenaba con encuadres y por eso era
// imposible registrar una mancha en cuello, labios o cabello.
const menus = await page.evaluate(() => {
  window.__T.openSpot('sp1');
  const val = id => [...document.getElementById(id).options].map(o => o.value);
  return { territorio: val('sp-territorio'), encuadre: val('sp-encuadre'),
           latVisible: document.getElementById('sp-lateralidad-field').style.display !== 'none' };
});
t('menú de zona: ya ofrece cuello, labios y cabello',
  ['cara','cuello','cuerpo','manos','pies','labios','cabello'].every(z => menus.territorio.indexOf(z) !== -1));
t('menú de zona: ya NO ofrece encuadres', menus.territorio.indexOf('cara-frente') === -1);
t('encuadre: se filtra por territorio (cuello ⇒ cuello y escote, nada de manos)',
  menus.encuadre.join(',') === 'cuello,escote');
t('lateralidad: se PREGUNTA cuando el encuadre abarca los dos lados', menus.latVisible === true);

const lat = await page.evaluate(() => {
  window.__T.openSpot('sp1');
  document.getElementById('sp-territorio').value = 'manos';
  onSpotTerritorioChange();
  return { enc: document.getElementById('sp-encuadre').value,
           visible: document.getElementById('sp-lateralidad-field').style.display !== 'none',
           valor: document.getElementById('sp-lateralidad').value };
});
t('lateralidad: se DEDUCE y se oculta cuando el encuadre ya dice el lado',
  lat.enc === 'mano-der' && lat.visible === false && lat.valor === 'der');

const opsSpot = await ops(`
  window.__T.openSpot(null);
  document.getElementById('sp-name').value = 'Mancha de prueba';
  document.getElementById('sp-territorio').value = 'cuello';
  onSpotTerritorioChange();
  document.getElementById('sp-encuadre').value = 'escote';
  onSpotEncuadreChange();
  return window.__T.saveSpot();
`);
const insSpot = opsSpot.find(o => o.table === 'skin_spots' && (o.chain || []).some(c => c.m === 'insert'));
const paySpot = insSpot ? insSpot.chain.find(c => c.m === 'insert').a[0] : null;
t('guardar mancha: escribe territorio', !!paySpot && paySpot.territorio === 'cuello');
t('guardar mancha: escribe encuadre', !!paySpot && paySpot.encuadre === 'escote');
t('guardar mancha: escribe lateralidad', !!paySpot && paySpot.lateralidad === 'centro');
t('guardar mancha: sigue llenando la columna legada `zone` (es NOT NULL hasta la contracción)',
  !!paySpot && paySpot.zone === 'escote');


console.log('\n── Ejes que llegan al reporte ──');
['cara', 'cuello', 'otros'].forEach(k => (lrd && lrd[k] || []).forEach(a =>
  console.log(`  ${k.padEnd(7)} ${a.icon} ${a.label.padEnd(30)} ${String(a.pct).padStart(3)}%${a.overDays ? '  ⚠️ ' + a.overDays + 'd' : ''}`)));
console.log(`  estímulo promedio en cara: ${lrd && lrd.constancia}%`);
console.log(`  semana ${lrd && lrd.weekNum} de tratamiento (desde ${lrd && lrd.treatStart})`);

console.log(`\n${fail ? '❌' : '✅'} arnés: ${pass} pasaron, ${fail} fallaron`);
await browser.close();
process.exit(fail ? 1 : 0);
