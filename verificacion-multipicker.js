// Verificación de UI del multipicker de zona con jsdom (NO va al repo — es un
// arnés de esta sesión: index.html + app.js completos, con Supabase falseado,
// para ver qué se ESCRIBIRÍA en la base al tocar los mismos botones).
//   node verificacion-multipicker.js   (requiere: npm i jsdom)
const fs = require('fs'), path = require('path');
const { JSDOM } = require(process.env.JSDOM_PATH || '/tmp/node_modules/jsdom');

const dir = __dirname;
const inserts = [], updates = [], deletes = [];
function fakeQuery(table) {
  const q = {
    _table: table,
    insert(row) { inserts.push({ table, row }); return q; },
    update(row) { updates.push({ table, row, ids: null }); return q; },
    delete() { deletes.push({ table }); return q; },
    select() { return q; },
    single() { return Promise.resolve({ data: { id: 'app-' + inserts.length }, error: null }); },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    eq() { return q; }, in(col, vals) { if (updates.length) updates[updates.length - 1].ids = vals; return q; },
    gte() { return q; }, lt() { return q; }, order() { return q; }, limit() { return q; },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); }
  };
  return q;
}
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.org/' });
const w = dom.window;
w.supabase = { createClient: () => ({ from: fakeQuery, auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => {} }, storage: { from: () => ({}) } }) };
w.fetch = () => Promise.reject(new Error('sin red en el arnés'));
w.navigator.serviceWorker = undefined;
// Las `function` de app.js sí quedan en window al evaluarse, pero `let`/`const`
// no: viven en el ámbito léxico global. El epílogo abre una ventanita a ese
// estado para poder inspeccionarlo desde fuera sin tocar app.js.
w.eval(['pure.js', 'activos-matriz.js', 'app.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + `
;window.__T = {
  setProducts(v) { allProducts = v; },
  get zonePickSel() { return zonePickSel; }, set zonePickSel(v) { zonePickSel = v; },
  get zonePickDirty() { return zonePickDirty; }, set zonePickDirty(v) { zonePickDirty = v; },
  get multiPickSelected() { return multiPickSelected; },
  get zonaEdit() { return _zonaEdit; }
};`);
const T = w.__T;

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), x = JSON.stringify(want);
  if (g === x) { pass++; return; }
  fail++; console.log(`❌ ${name}\n   esperado: ${x}\n   obtenido: ${g}`);
}

// Catálogo mínimo: un SPF facial (cara+cuello+manos), un limpiador facial y una
// crema de manos — la tanda mixta que puede resolverse mal.
T.setProducts([
  { id: '57ff2048-f0d3-42a6-a9e5-8e56fb8a564e', name: 'Anthelios UVMune 400 SPF50', emoji: '🌞',
    brand: 'La Roche-Posay', category: '🌞 SPF Facial', tier: 'a', status: 'ok', tags: {} },
  { id: '4c775124-b388-45d0-941f-77cf67c48148', name: "L'Oréal UV Defender", emoji: '🌞',
    brand: "L'Oréal", category: '🌞 SPF Facial', tier: 'a', status: 'ok', tags: {} },
  { id: '106e6207-662c-451d-ac3c-5c8c1db73883', name: 'Sadoer Kojic Acid Hand Cream', emoji: '✋',
    brand: 'Sadoer', category: '✋ Manos', tier: 'b', status: 'ok', tags: {} }
]);

// ── 1. PRESELECCIÓN: elegir producto marca sus zonas de siempre ─────────────
w.openMultiPickerByCat(null, '🌞 SPF Facial');
t('chips: se pintan las zonas candidatas de la categoría',
  [...w.document.querySelectorAll('#zone-pick-chips .zone-chip')].length, 3);
t('preselección: sin producto elegido no adivina zonas', T.zonePickSel.size, 0);
t('botón: bloqueado sin producto', w.document.getElementById('multi-pick-btn').disabled, true);

const items = [...w.document.querySelectorAll('#spf-picker-body .multi-pick')];
w.toggleMultiPick(items[0]);          // Anthelios
t('preselección: hereda cara+cuello+manos del producto',
  [...T.zonePickSel], ['cara', 'cuello', 'manos']);
t('botón: se habilita solo', w.document.getElementById('multi-pick-btn').disabled, false);

// ── 2. EDITAR NO SE PISA AL SEGUIR ELIGIENDO ────────────────────────────────
w.toggleZonePick('manos');            // la quito a mano
t('edición: quitar manos queda', [...T.zonePickSel], ['cara', 'cuello']);
w.toggleMultiPick(items[1]);          // elijo un segundo protector
t('edición: elegir otro producto NO revierte mi elección',
  [...T.zonePickSel], ['cara', 'cuello']);

// ── 3. LO QUE SE ESCRIBE ────────────────────────────────────────────────────
(async () => {
  await w.confirmMultiPick();
  t('registro: una fila por producto', inserts.length, 2);
  t('registro: zones escritas tal cual', inserts.map(i => i.row.zones),
    [['cara', 'cuello'], ['cara', 'cuello']]);
  t('registro: source reaplicación sin paso', inserts[0].row.source, 'reaplicacion');

  // ── 4. TANDA MIXTA: cada producto se queda con lo suyo ────────────────────
  inserts.length = 0;
  w.openMultiPickerByCat(null, '🌞 SPF Facial');
  const it2 = [...w.document.querySelectorAll('#spf-picker-body .multi-pick')];
  w.toggleMultiPick(it2[0]);
  T.multiPickSelected.add('✋ Sadoer Kojic Acid Hand Cream');  // crema de manos en la misma tanda
  T.zonePickDirty = true;
  T.zonePickSel = new Set(['cara', 'manos']);
  await w.confirmMultiPick();
  t('tanda mixta: el SPF facial va a cara+manos (ambas aptas)',
    inserts.find(i => /Anthelios/.test(i.row.product_name)).row.zones, ['cara', 'manos']);
  t('tanda mixta: la crema de manos NO se registra en cara',
    inserts.find(i => /Sadoer/.test(i.row.product_name)).row.zones, ['manos']);

  // ── 5. EL RENGLÓN DE ZONAS DEL PASO ──────────────────────────────────────
  const step = w.document.createElement('div');
  step.id = 'step_x1';
  step.innerHTML = '<div class="sc"><div class="sc-top"><span class="sc-name">🌞 Anthelios UVMune 400 SPF50</span></div></div>';
  w.document.body.appendChild(step);
  w.setStepZonas('step_x1', ['app-1'], ['cara', 'cuello'], ['cara', 'cuello', 'manos']);
  const row = step.querySelector('.sc-zonas');
  t('paso: se pinta el renglón de zonas', !!row, true);
  t('paso: muestra las zonas legibles', row.textContent.replace(/\s+/g, ' ').trim(),
    '📍 😊 Cara · 🦢 Cuello y escote✎');
  t('paso: el renglón es tocable', row.className.includes('sc-zonas-editable'), true);

  // Editor: abre con lo actual, ofrece la aptitud completa y guarda.
  w.openZonasEditorFromStep('step_x1');
  t('editor: abre con las zonas actuales', [...T.zonaEdit.sel], ['cara', 'cuello']);
  t('editor: ofrece las 3 zonas aptas',
    [...w.document.querySelectorAll('#zonas-modal-chips .zone-chip')].length, 3);
  w.toggleZonaEdit('manos');
  await w.saveZonasEditor();
  t('editor: guarda el array ordenado', updates[0].row.zones, ['cara', 'cuello', 'manos']);
  t('editor: actualiza SOLO las filas de ese paso', updates[0].ids, ['app-1']);
  t('paso: el renglón refleja el cambio',
    step.querySelector('.sc-zonas').textContent.includes('Manos'), true);

  // Sin id de fila (registro encolado offline) no se ofrece un editor que no
  // podría guardar.
  w.setStepZonas('step_x1', [], ['cara'], ['cara', 'cuello']);
  t('paso: sin id de fila no es editable',
    step.querySelector('.sc-zonas').className.includes('sc-zonas-editable'), false);

  // ── 6. DESMARCAR SE LLEVA EL RENGLÓN ─────────────────────────────────────
  w.clearStepZonas('step_x1');
  t('paso: desmarcar quita el renglón', !!step.querySelector('.sc-zonas'), false);

  // ── 7. PASO FIJO: el ✓ sigue siendo UN toque y ya escribe zonas ───────────
  // Es el camino diario más usado: si aquí se colara un picker, la app se
  // volvería más lenta de usar que antes del cambio.
  inserts.length = 0;
  const fijo = w.document.createElement('div');
  fijo.id = 'step_y1';
  fijo.className = 'step';
  fijo.dataset.routineStepId = 'rs-9';
  fijo.innerHTML = '<div class="sn"></div><div class="sc"><div class="sc-top">' +
    '<span class="sc-name">🌞 Anthelios UVMune 400 SPF50</span></div></div>';
  w.document.body.appendChild(fijo);
  await w.checkStep('step_y1', { stopPropagation() {} });
  t('paso fijo: registra una sola fila', inserts.length, 1);
  t('paso fijo: escribe las zonas por defecto del producto',
    inserts[0].row.zones, ['cara', 'cuello', 'manos']);
  t('paso fijo: queda palomeado', fijo.classList.contains('done'), true);
  t('paso fijo: muestra el renglón de zonas', !!fijo.querySelector('.sc-zonas'), true);
  t('paso fijo: ningún modal se abrió',
    [...w.document.querySelectorAll('.modal-overlay.open')].length, 0);

  console.log(`\n${fail ? '❌' : '✅'} multipicker (jsdom): ${pass} pasaron, ${fail} fallaron`);
  process.exit(fail ? 1 : 0);
})();
