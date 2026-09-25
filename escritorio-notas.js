// ============================================================================
// Skincare Tracker — escritorio-notas.js
// Pantalla "Notas" de la interfaz de computadora: información suelta sobre
// productos, rutinas y técnicas, con productos del stock insertados con @.
//
// Tabla `notas` (id, titulo, emoji, cuerpo, sort_order, created_at, updated_at).
// Aquí se escribe y se lee; el celular solo lee.
//
// Lo que NO decide aquí (vive en pure.js, compartido con el celular):
//   · cómo se ve una nota ................... renderNota
//   · @[Nombre] ↔ @[id] al editar/guardar .... notaAEdicion, notaDeEdicion
//   · qué productos sugiere el @ ............. buscarProductosNota
// ============================================================================
window.Notas = (function () {
'use strict';

const K_SEL = 'escritorio-notas-sel';
let db, raiz;
const S = {
  cargado: false, error: null, guardando: false,
  notas: [], productos: [], porId: {},
  sel: null,              // id de la nota abierta, o 'nueva'
  modo: 'leer',           // 'leer' | 'editar'
  ed: null,               // { titulo, emoji, texto } mientras se edita
  sucio: false,
  preferidos: {},         // nombre normalizado → id elegido en el menú del @
  faltan: [],             // nombres que no se pudieron enlazar al guardar
  menu: null              // { desde, q, ops[], i } menú del @ abierto
};
try { S.sel = localStorage.getItem(K_SEL) || null; } catch (e) {}

const nota = () => S.notas.find(n => n.id === S.sel) || null;

// ── CARGA ────────────────────────────────────────────────────────────────────
async function cargar() {
  const [n, p] = await Promise.all([
    db.from('notas').select('*').order('sort_order').order('created_at'),
    db.from('products').select('id, name, brand, emoji, category, status').order('name')
  ]);
  if (n.error || p.error) throw (n.error || p.error);
  S.notas = n.data || [];
  S.productos = p.data || [];
  S.porId = {}; S.productos.forEach(x => { S.porId[x.id] = x; });
  if (!nota()) S.sel = S.notas.length ? S.notas[0].id : null;
}

// ── PINTAR ───────────────────────────────────────────────────────────────────
function pintar() {
  if (!S.cargado) {
    raiz.innerHTML = S.error
      ? `<div class="hdr"><div class="grow"><h1>Notas</h1></div></div><div class="cargando">No se pudieron cargar las notas: ${esc(S.error)}</div>`
      : `<div class="hdr"><div class="grow"><h1>Notas</h1></div></div><div class="cargando">Cargando…</div>`;
    return;
  }
  const scroll = raiz.querySelector('.nt-body') ? raiz.querySelector('.nt-body').scrollTop : 0;
  const n = nota();
  const editando = S.modo === 'editar';
  const lista = S.notas.map(x => {
    const nProd = productosDeNota(x.cuerpo).length;
    return `<button class="nt-item" data-a="abrir" data-id="${esc(x.id)}"${x.id === S.sel ? ' aria-current="true"' : ''}>
      <span class="t">${esc((x.emoji ? x.emoji + ' ' : '') + x.titulo)}</span>
      <span class="m">${nProd} producto${nProd === 1 ? '' : 's'} · ${esc(fechaCorta(x.updated_at))}</span></button>`;
  }).join('') + (S.sel === 'nueva' ? `<button class="nt-item" aria-current="true"><span class="t">Nota nueva</span><span class="m">sin guardar</span></button>` : '');

  let cuerpo;
  if (!n && S.sel !== 'nueva') {
    cuerpo = `<div class="nt-vacio"><p>Todavía no tienes notas.</p><p class="muted small">Aquí van técnicas de aplicación, lo que aprendas de un producto, dudas para la dermatóloga… Con <b>@</b> insertas productos de tu stock.</p><button class="btn pri" data-a="nueva">＋ Primera nota</button></div>`;
  } else if (!editando) {
    cuerpo = `<article class="nt-doc">${renderNota(n.cuerpo, S.porId) || '<p class="muted">Nota vacía. Dale <b>Editar</b>.</p>'}</article>`;
  } else {
    const vista = notaDeEdicion(S.ed.texto, S.productos, S.preferidos);
    cuerpo = `
      <div class="nt-campos">
        <input class="field nt-emoji" id="nt-emoji" value="${esc(S.ed.emoji)}" maxlength="8" aria-label="Emoji">
        <input class="field nt-tit" id="nt-titulo" value="${esc(S.ed.titulo)}" placeholder="Título de la nota" aria-label="Título">
      </div>
      <div class="nt-barra" role="toolbar" aria-label="Formato">
        <button class="btn sm" data-a="fmt" data-f="h2" title="Renglón de título">Título</button>
        <button class="btn sm" data-a="fmt" data-f="h3" title="Renglón de subtítulo">Subtítulo</button>
        <button class="btn sm" data-a="fmt" data-f="b" title="Negrita (⌘B)" style="font-weight:700">Negrita</button>
        <button class="btn sm" data-a="fmt" data-f="ol">1. Pasos</button>
        <button class="btn sm" data-a="fmt" data-f="ul">• Lista</button>
        <button class="btn sm" data-a="fmt" data-f="espera">⏱ Espera</button>
        <button class="btn sm" data-a="fmt" data-f="aviso">⚠️ Aviso</button>
        <span class="sep"></span>
        <button class="btn sm at" data-a="fmt" data-f="at" title="Insertar un producto de tu stock">@ Producto</button>
      </div>
      <div class="nt-split">
        <div class="nt-edwrap">
          <textarea id="nt-texto" class="nt-texto" spellcheck="true">${esc(S.ed.texto)}</textarea>
          ${menuHTML()}
        </div>
        <div class="nt-prev"><div class="nt-prev-h">Así se ve</div><article class="nt-doc">${renderNota(vista.cuerpo, S.porId)}</article></div>
      </div>
      <div class="nt-ayuda">Espacios delante de <b>- </b> = viñeta dentro del paso de arriba · <b>⌘S</b> guarda · <b>Esc</b> cierra el menú del @</div>
      ${S.faltan.length ? `<div class="alert"><span class="grow">No pude enlazar: <b>${S.faltan.map(esc).join('</b>, <b>')}</b>. Bórralo y vuelve a insertarlo con <b>@</b> eligiendo del menú.</span></div>` : ''}`;
  }

  const acciones = !n && S.sel !== 'nueva' ? '' : editando
    ? `${S.sel !== 'nueva' ? '<button class="btn sm peligro" data-a="borrar">Borrar nota</button>' : ''}
       <button class="btn sm" data-a="cancelar">Cancelar</button>
       <button class="btn sm pri" data-a="guardar"${S.guardando ? ' disabled' : ''}>${S.guardando ? 'Guardando…' : (S.sucio ? 'Guardar' : 'Guardado')}</button>`
    : `<button class="btn sm" data-a="editar">Editar</button>`;

  raiz.innerHTML = `
  <div class="hdr"><div class="grow"><h1>${esc(editando ? (S.sel === 'nueva' ? 'Nota nueva' : 'Editando nota') : (n ? (n.emoji ? n.emoji + ' ' : '') + n.titulo : 'Notas'))}</h1></div>${acciones}</div>
  <div class="nt">
    <nav class="nt-lista" aria-label="Notas">
      <div class="nt-lista-h"><span>Notas</span><button class="btn sm pri" data-a="nueva">＋ Nueva</button></div>
      ${lista}
    </nav>
    <div class="nt-body">${cuerpo}</div>
  </div>`;
  const b = raiz.querySelector('.nt-body'); if (b) b.scrollTop = scroll;
}
function fechaCorta(iso) {
  if (!iso) return '';
  const d = localDateOfISO(iso), [y, m, dd] = d.split('-').map(Number);
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${dd} ${MES[m - 1]} ${y}`;
}

// ── MENÚ DEL @ ───────────────────────────────────────────────────────────────
function menuHTML() {
  const M = S.menu; if (!M) return '';
  const ops = M.ops.length
    ? M.ops.map((p, i) => `<div class="nt-op" role="option" data-a="elegir" data-i="${i}" aria-selected="${i === M.i}">
        <span>${esc(p.name)}${p.status === 'out' ? ' <i>agotado</i>' : ''}</span><small>${esc(p.brand || p.category || '')}</small></div>`).join('')
    : `<div class="nt-op vacio">Nada en tu stock con “${esc(M.q)}”</div>`;
  return `<div class="nt-menu" role="listbox" style="left:${M.x}px;top:${M.y}px">
    <div class="nt-menu-q">${M.q ? `Productos con “${esc(M.q)}”` : 'Escribe para buscar en tu stock'}</div>${ops}
    <div class="nt-menu-q">↑↓ moverte · Enter insertar · Esc cerrar</div></div>`;
}
// Posición del cursor dentro del textarea (réplica invisible con el mismo estilo).
function posCursor(ta, pos) {
  const cs = getComputedStyle(ta), d = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight',
   'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'width', 'tabSize']
    .forEach(k => { d.style[k] = cs[k]; });
  d.style.position = 'absolute'; d.style.visibility = 'hidden'; d.style.whiteSpace = 'pre-wrap';
  d.style.overflowWrap = 'break-word'; d.style.top = '0'; d.style.left = '-9999px';
  d.textContent = ta.value.slice(0, pos);
  const s = document.createElement('span'); s.textContent = '​'; d.appendChild(s);
  document.body.appendChild(d);
  const lh = parseFloat(cs.lineHeight) || 20;
  const r = { x: Math.min(s.offsetLeft, ta.clientWidth - 320), y: s.offsetTop - ta.scrollTop + lh + 4 };
  d.remove();
  r.x = Math.max(8, r.x);
  return r;
}
function revisarMenu(ta) {
  const pos = ta.selectionStart, antes = ta.value.slice(0, pos);
  const m = antes.match(/(^|[\s(¿¡"'])@([^@\[\]\n]{0,40})$/);
  if (!m || (m[2].match(/\s/g) || []).length > 4) { cerrarMenu(); return; }
  const q = m[2], ops = buscarProductosNota(S.productos, q, 8);
  if (q.length > 3 && !ops.length && /\s$/.test(q)) { cerrarMenu(); return; }
  const c = posCursor(ta, pos - q.length - 1);
  S.menu = { desde: pos - q.length - 1, q, ops, i: 0, x: c.x, y: c.y };
  pintarMenu();
}
function cerrarMenu() { if (!S.menu) return; S.menu = null; pintarMenu(); }
function pintarMenu() {
  const w = raiz.querySelector('.nt-edwrap'); if (!w) return;
  const viejo = w.querySelector('.nt-menu'); if (viejo) viejo.remove();
  if (S.menu) w.insertAdjacentHTML('beforeend', menuHTML());
}
function elegir(i) {
  const M = S.menu, ta = document.getElementById('nt-texto');
  if (!M || !ta || !M.ops[i]) return;
  const p = M.ops[i];
  if (/\]/.test(p.name)) { alertar('Ese producto tiene "]" en el nombre y no se puede insertar; corrígelo en el catálogo.'); return; }
  const fin = ta.selectionStart;
  const ins = `@[${p.name}] `;
  ta.value = ta.value.slice(0, M.desde) + ins + ta.value.slice(fin);
  const cur = M.desde + ins.length;
  S.preferidos[notaNorm(p.name)] = p.id;
  S.menu = null; pintarMenu();
  alEscribir(ta);
  const nuevo = document.getElementById('nt-texto');
  nuevo.focus(); nuevo.setSelectionRange(cur, cur);
}

// ── EDICIÓN ──────────────────────────────────────────────────────────────────
function alEscribir(ta) {
  S.ed.texto = ta.value; S.sucio = true;
  // Repinta solo la vista previa y el botón: repintar el textarea perdería el cursor.
  const vista = notaDeEdicion(S.ed.texto, S.productos, S.preferidos);
  const pv = raiz.querySelector('.nt-prev .nt-doc'); if (pv) pv.innerHTML = renderNota(vista.cuerpo, S.porId);
  const g = raiz.querySelector('[data-a="guardar"]'); if (g && !S.guardando) g.textContent = 'Guardar';
  if (!raiz.querySelector('#nt-texto')) pintar();
}
function formato(f) {
  const ta = document.getElementById('nt-texto'); if (!ta) return;
  let a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  if (f === 'b' || f === 'espera' || f === 'at') {
    const sel = v.slice(a, b);
    const ins = f === 'b' ? `**${sel || 'texto'}**` : f === 'espera' ? `{{⏱ ${sel || 'Espera 5 min'}}}` : '@';
    ta.value = v.slice(0, a) + ins + v.slice(b);
    const c0 = f === 'at' ? a + 1 : a + ins.length, c1 = c0;
    ta.focus(); ta.setSelectionRange(c0, c1);
    alEscribir(ta);
    if (f === 'at') revisarMenu(ta);
    return;
  }
  const PRE = { h2: '# ', h3: '## ', ol: '1. ', ul: '- ', aviso: '> ' };
  const ini = v.lastIndexOf('\n', a - 1) + 1;
  let fin = v.indexOf('\n', b); if (fin === -1) fin = v.length;
  const lineas = v.slice(ini, fin).split('\n');
  const limpia = l => l.replace(/^\s*(#{1,2}\s+|\d+[.)]\s+|[-•*]\s+|>\s?)/, '');
  const yaTiene = lineas.every(l => l.startsWith(PRE[f]) || (f === 'ol' && /^\d+[.)]\s/.test(l)));
  let n = 0;
  const nuevas = lineas.map(l => {
    if (yaTiene) return limpia(l);
    if (!l.trim() && lineas.length > 1) return l;
    n++;
    return (f === 'ol' ? `${n}. ` : PRE[f]) + limpia(l);
  });
  const txt = nuevas.join('\n');
  ta.value = v.slice(0, ini) + txt + v.slice(fin);
  ta.focus(); ta.setSelectionRange(ini + txt.length, ini + txt.length);
  alEscribir(ta);
}
function empezarEdicion(nueva) {
  const n = nota();
  S.ed = nueva ? { titulo: '', emoji: '📝', texto: '' }
               : { titulo: n.titulo, emoji: n.emoji || '', texto: notaAEdicion(n.cuerpo, S.porId) };
  S.preferidos = {};
  // Los productos que ya estaban enlazados se quedan con su id aunque su nombre se repita.
  if (!nueva) productosDeNota(n.cuerpo).forEach(id => { if (S.porId[id]) S.preferidos[notaNorm(S.porId[id].name)] = id; });
  S.modo = 'editar'; S.sucio = !!nueva; S.faltan = []; S.menu = null;
  if (nueva) S.sel = 'nueva';
  pintar();
  const el = document.getElementById(nueva ? 'nt-titulo' : 'nt-texto'); if (el) el.focus();
}
function salirSinGuardar() {
  if (S.modo === 'editar' && S.sucio && !confirm('Tienes cambios sin guardar en esta nota. ¿Descartarlos?')) return false;
  S.modo = 'leer'; S.ed = null; S.sucio = false; S.faltan = []; S.menu = null;
  if (S.sel === 'nueva') S.sel = S.notas.length ? S.notas[0].id : null;
  return true;
}
async function guardar() {
  if (S.guardando || S.modo !== 'editar') return;
  const titulo = S.ed.titulo.trim();
  if (!titulo) { alertar('Ponle un título a la nota.'); const t = document.getElementById('nt-titulo'); if (t) t.focus(); return; }
  const r = notaDeEdicion(S.ed.texto, S.productos, S.preferidos);
  S.faltan = r.faltan;
  if (r.faltan.length) { pintar(); return; }
  S.guardando = true; pintar();
  const fila = { titulo, emoji: S.ed.emoji.trim() || '📝', cuerpo: r.cuerpo, updated_at: new Date().toISOString() };
  let res;
  if (S.sel === 'nueva') {
    fila.sort_order = S.notas.length ? Math.max(...S.notas.map(x => x.sort_order || 0)) + 1 : 0;
    res = await db.from('notas').insert(fila).select().single();
  } else {
    res = await db.from('notas').update(fila).eq('id', S.sel).select().single();
  }
  S.guardando = false;
  if (res.error) { alertar('No se guardó: ' + res.error.message); pintar(); return; }
  const i = S.notas.findIndex(x => x.id === res.data.id);
  if (i === -1) S.notas.push(res.data); else S.notas[i] = res.data;
  S.sel = res.data.id; recordarSel();
  S.modo = 'leer'; S.ed = null; S.sucio = false; S.menu = null;
  pintar();
}
async function borrar() {
  const n = nota(); if (!n) return;
  if (!confirm(`¿Borrar la nota "${n.titulo}"? No se puede deshacer.`)) return;
  const { error } = await db.from('notas').delete().eq('id', n.id);
  if (error) { alertar('No se borró: ' + error.message); return; }
  S.notas = S.notas.filter(x => x.id !== n.id);
  S.modo = 'leer'; S.ed = null; S.sucio = false;
  S.sel = S.notas.length ? S.notas[0].id : null; recordarSel();
  pintar();
}
function recordarSel() { try { if (S.sel && S.sel !== 'nueva') localStorage.setItem(K_SEL, S.sel); } catch (e) {} }
function alertar(msg) {
  const d = document.createElement('div');
  d.className = 'alert bad'; d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9;max-width:560px';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 7000);
}

// ── EVENTOS ──────────────────────────────────────────────────────────────────
function alClic(e) {
  const t = e.target.closest('[data-a]'); if (!t || !raiz.contains(t)) {
    if (S.menu && !e.target.closest('.nt-menu') && e.target.id !== 'nt-texto') cerrarMenu();
    return;
  }
  const a = t.dataset.a;
  if (a === 'abrir') { if (t.dataset.id === S.sel && S.modo === 'leer') return; if (!salirSinGuardar()) return; S.sel = t.dataset.id; recordarSel(); pintar(); }
  else if (a === 'nueva') { if (!salirSinGuardar()) return; empezarEdicion(true); }
  else if (a === 'editar') empezarEdicion(false);
  else if (a === 'cancelar') { if (salirSinGuardar()) pintar(); }
  else if (a === 'guardar') guardar();
  else if (a === 'borrar') borrar();
  else if (a === 'fmt') formato(t.dataset.f);
  else if (a === 'elegir') elegir(Number(t.dataset.i));
}
function alMouseDown(e) { if (e.target.closest('.nt-menu')) e.preventDefault(); }   // no robar el foco al textarea
function alEntrada(e) {
  if (S.modo !== 'editar') return;
  if (e.target.id === 'nt-texto') { alEscribir(e.target); revisarMenu(e.target); }
  else if (e.target.id === 'nt-titulo') { S.ed.titulo = e.target.value; S.sucio = true; const g = raiz.querySelector('[data-a="guardar"]'); if (g) g.textContent = 'Guardar'; }
  else if (e.target.id === 'nt-emoji') { S.ed.emoji = e.target.value; S.sucio = true; const g = raiz.querySelector('[data-a="guardar"]'); if (g) g.textContent = 'Guardar'; }
}
function alTecla(e) {
  if (!raiz || !raiz.isConnected || !raiz.querySelector('.nt')) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S') && S.modo === 'editar') { e.preventDefault(); guardar(); return; }
  if (e.target.id !== 'nt-texto') return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); formato('b'); return; }
  const M = S.menu; if (!M) return;
  if (e.key === 'Escape') { e.preventDefault(); cerrarMenu(); }
  else if (e.key === 'ArrowDown' && M.ops.length) { e.preventDefault(); M.i = (M.i + 1) % M.ops.length; pintarMenu(); }
  else if (e.key === 'ArrowUp' && M.ops.length) { e.preventDefault(); M.i = (M.i - 1 + M.ops.length) % M.ops.length; pintarMenu(); }
  else if ((e.key === 'Enter' || e.key === 'Tab') && M.ops.length) { e.preventDefault(); elegir(M.i); }
}
function alSalirDePagina(e) { if (S.modo === 'editar' && S.sucio) { e.preventDefault(); e.returnValue = ''; } }

// ── MONTAJE ──────────────────────────────────────────────────────────────────
let escuchando = false;
async function montar(el, cliente) {
  raiz = el; db = cliente;
  if (!escuchando) {
    document.addEventListener('keydown', alTecla);
    window.addEventListener('beforeunload', alSalirDePagina);
    escuchando = true;
  }
  raiz.onclick = alClic;
  raiz.oninput = alEntrada;
  raiz.onmousedown = alMouseDown;
  pintar();
  if (S.cargado) return;
  try { await cargar(); S.cargado = true; S.error = null; }
  catch (e) { S.error = e.message || String(e); }
  if (raiz === el && el.dataset.pantalla === 'notas') pintar();
}
// Al cambiar de pestaña con una edición a medias: se pregunta antes.
function puedeSalir() { return salirSinGuardar(); }
return { montar, puedeSalir };
})();
