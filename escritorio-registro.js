// ============================================================================
// Skincare Tracker — escritorio-registro.js
// Pantalla "Registro en lote" de la interfaz de computadora.
//
// Qué hace: una cuadrícula semana × pasos de rutina. Marcas celdas (sueltas o
// "rellenar con lo de siempre" sobre días elegidos), revisas el borrador y se
// guarda todo en un solo insert. Cada lote lleva una marca en `notes` para
// poder deshacerlo completo.
//
// Lo que NO decide aquí (vive en pure.js, compartido con el celular):
//   · qué rutina tocaba cada día ............ rutinasDelDia
//   · si un paso ya está hecho ese día ...... buildHydration + resolveStepHydration
//   · qué string / producto / zonas escribir . nombreRegistroPaso, nombreRegistroProducto,
//                                               productoDeNombre, filaAplicacionLote
// ============================================================================
window.Registro = (function () {
'use strict';

const SECCIONES = [
  { key: 'am',   nombre: 'Mañana', hora: 'am' },
  { key: 'pm',   nombre: 'Noche',  hora: 'pm' },
  { key: 'body', nombre: 'Cuerpo', hora: 'pm' },
  { key: 'feet', nombre: 'Pies',   hora: 'pm' }
];
const DOW_CORTO = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const DOW_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
               'septiembre', 'octubre', 'noviembre', 'diciembre'];
const AM_PM_CUTOFF = 15;   // mismo corte que AM_PM_CUTOFF_HOUR del celular
const K_HORAS = 'escritorio-lote-horas';
const K_ULTIMO = 'escritorio-lote-ultimo';

const I = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  izq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>',
  der: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>'
};

let db, raiz;
const S = {
  cargado: false, error: null, guardando: false,
  productos: [], porId: {}, rutinas: [], pasos: [],
  lunes: null,            // YYYY-MM-DD del lunes de la semana visible
  apps: [],               // aplicaciones de la semana visible
  ultimo: {},             // stepId → { fecha, nombres[] } de su registro más reciente
  borrador: {},           // `${fecha}|${stepId}` → true
  sel: {},                // fecha → true (días elegidos)
  elegidos: {},           // clave de renglón → [productId] (pasos de categoría)
  abierto: null,          // clave de renglón con el selector de producto abierto
  horas: { am: '08:00', pm: '22:00' },
  hecho: null             // { n, lote } tras guardar
};
try { const h = JSON.parse(localStorage.getItem(K_HORAS) || 'null'); if (h && h.am && h.pm) S.horas = h; } catch (e) {}

// ── FECHAS ───────────────────────────────────────────────────────────────────
const hoy = () => toDateStr(new Date());
const dowDe = ds => new Date(ds + 'T12:00:00').getDay();
function lunesDe(ds) { const d = dowDe(ds); return shiftDateStr(ds, d === 0 ? -6 : 1 - d); }
function diasSemana() { return [0, 1, 2, 3, 4, 5, 6].map(i => shiftDateStr(S.lunes, i)); }
function tituloSemana() {
  const a = S.lunes, b = shiftDateStr(S.lunes, 6);
  const [, ma, da] = a.split('-').map(Number), [yb, mb, db_] = b.split('-').map(Number);
  return ma === mb ? `${da} – ${db_} de ${MESES[mb - 1]} ${yb}`
                   : `${da} de ${MESES[ma - 1]} – ${db_} de ${MESES[mb - 1]} ${yb}`;
}
const nombreDia = ds => `${DOW_LARGO[dowDe(ds)]} ${Number(ds.slice(8))}`;

// ── CARGA ────────────────────────────────────────────────────────────────────
async function cargarBase() {
  const [p, r] = await Promise.all([
    db.from('products').select('*').order('sort_order'),
    db.from('routines').select('*').eq('active', true).order('sort_order')
  ]);
  if (p.error || r.error) throw (p.error || r.error);
  S.productos = p.data || [];
  S.porId = {}; S.productos.forEach(x => { S.porId[x.id] = x; });
  S.rutinas = r.data || [];
  const ids = S.rutinas.map(x => x.id);
  const st = ids.length
    ? await db.from('routine_steps').select('*').in('routine_id', ids).order('sort_order')
    : { data: [] };
  if (st.error) throw st.error;
  S.pasos = st.data || [];
  // El último producto usado en cada paso de CATEGORÍA (opción A: se propone
  // ese mismo al rellenar; se puede cambiar antes de guardar).
  const pick = S.pasos.filter(x => x.picker_category).map(x => x.id);
  S.ultimo = {};
  if (pick.length) {
    const u = await db.from('product_applications')
      .select('routine_step_id, product_name, applied_at')
      .in('routine_step_id', pick).order('applied_at', { ascending: false }).limit(1000);
    if (u.error) throw u.error;
    (u.data || []).forEach(a => {
      const f = localDateOfISO(a.applied_at), cur = S.ultimo[a.routine_step_id];
      if (!cur) S.ultimo[a.routine_step_id] = { fecha: f, nombres: [a.product_name] };
      else if (cur.fecha === f && cur.nombres.indexOf(a.product_name) === -1) cur.nombres.push(a.product_name);
    });
  }
}
async function cargarSemana() {
  const desde = localDayBoundsUTC(S.lunes).startISO;
  const hasta = localDayBoundsUTC(shiftDateStr(S.lunes, 6)).endISO;
  const a = await db.from('product_applications').select('*')
    .gte('applied_at', desde).lt('applied_at', hasta).order('applied_at');
  if (a.error) throw a.error;
  S.apps = a.data || [];
}

// ── MODELO DE LA CUADRÍCULA ──────────────────────────────────────────────────
// Renglón = el mismo paso a través de las rutinas de una sección (clavePaso).
// Celda = el paso concreto de la rutina que tocaba ESE día, o nada.
function hidratacionPorDia() {
  const por = {};
  diasSemana().forEach(d => { por[d] = []; });
  S.apps.forEach(a => { const d = localDateOfISO(a.applied_at); if (por[d]) por[d].push(a); });
  const h = {};
  Object.keys(por).forEach(d => { h[d] = buildHydration(por[d], S.porId, AM_PM_CUTOFF); });
  return { h, conteo: Object.fromEntries(Object.keys(por).map(d => [d, por[d].length])) };
}
function modelo() {
  const dias = diasSemana(), { h, conteo } = hidratacionPorDia(), t = hoy();
  const pasosDe = rid => S.pasos.filter(p => p.routine_id === rid);
  const secciones = SECCIONES.map(sec => {
    const filas = new Map();
    dias.forEach((d, di) => {
      const rd = rutinasDelDia(S.rutinas, dowDe(d));
      const rs = sec.key === 'am' || sec.key === 'pm' ? (rd[sec.key] ? [rd[sec.key]] : []) : rd[sec.key];
      const vistos = {};
      rs.forEach(r => pasosDe(r.id).forEach(p => {
        const base = clavePaso(p);
        vistos[base] = (vistos[base] || 0) + 1;
        const clave = sec.key + '|' + base + (vistos[base] > 1 ? '#' + vistos[base] : '');
        if (!filas.has(clave)) filas.set(clave, { clave, paso: p, celdas: new Array(7).fill(null) });
        filas.get(clave).celdas[di] = p;
      }));
    });
    const lista = [...filas.values()].map(f => {
      const prod = f.paso.picker_category ? null : productoDePaso(f.paso, S.productos);
      return Object.assign(f, {
        prod, cat: f.paso.picker_category || null,
        celdas: f.celdas.map((p, di) => {
          const d = dias[di];
          if (!p) return { d, p: null, estado: 'off' };
          if (d > t) return { d, p, estado: 'futuro' };
          const pr = p.picker_category ? null : productoDePaso(p, S.productos);
          const ya = resolveStepHydration(p, h[d], sec.key, nombreRegistroPaso(p, pr));
          if (ya) return { d, p, estado: 'hecho', ya };
          return { d, p, estado: S.borrador[d + '|' + p.id] ? 'borrador' : 'toca' };
        })
      });
    });
    return Object.assign({}, sec, { filas: lista });
  }).filter(s => s.filas.length);
  return { dias, secciones, conteo, t };
}
// Productos propuestos para un renglón de categoría: lo elegido a mano, o lo
// último registrado en cualquiera de sus pasos (el más reciente gana).
function elegidosDe(fila) {
  if (S.elegidos[fila.clave]) return S.elegidos[fila.clave];
  let mejor = null;
  fila.celdas.forEach(c => { const u = c.p && S.ultimo[c.p.id]; if (u && (!mejor || u.fecha > mejor.fecha)) mejor = u; });
  const ids = mejor ? mejor.nombres.map(n => productoDeNombre(S.productos, n))
    .filter(p => p && p.status !== 'out').map(p => p.id) : [];
  return [...new Set(ids)];
}

// ── PINTAR ───────────────────────────────────────────────────────────────────
function etiquetaProd(p) { return (p.brand ? `<span class="brand">${esc(p.brand)}</span> ` : '') + esc(p.name); }
function pintar() {
  if (!raiz || raiz.dataset.pantalla !== 'registro') return;
  if (!S.cargado) {
    raiz.innerHTML = S.error
      ? `<div class="hdr"><div class="grow"><div class="eyebrow">Registro en lote</div><h1>No se pudo cargar</h1></div></div><div class="cargando">${esc(S.error)}</div>`
      : `<div class="cargando">Cargando tus rutinas…</div>`;
    return;
  }
  const M = modelo();
  const esActual = S.lunes === lunesDe(M.t);
  const selN = Object.keys(S.sel).filter(k => S.sel[k]).length;
  const faltan = M.dias.filter(d => d <= M.t && !M.conteo[d]);
  let html = `<div class="hdr"><div class="grow"><div class="eyebrow">Registro en lote</div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:4px">
      <button class="btn iconb" data-a="sem" data-v="-1" aria-label="Semana anterior">${I.izq}</button>
      <h1 style="margin:0">${tituloSemana()}</h1>
      <button class="btn iconb" data-a="sem" data-v="1" aria-label="Semana siguiente" ${esActual ? 'disabled' : ''}>${I.der}</button>
      ${esActual ? '' : '<button class="btn sm" data-a="semhoy">Ir a esta semana</button>'}
    </div></div>
    <button class="btn pri" data-a="rellenar" ${selN ? '' : 'disabled'}>${I.check}Rellenar con lo de siempre<kbd class="mono" style="opacity:.7;font-size:11px">F</kbd></button></div>`;
  html += `<div class="reg"><section class="reg-main">`;
  if (faltan.length) {
    html += `<div class="alert"><span class="grow"><b>${faltan.length === 1 ? '1 día' : faltan.length + ' días'} sin ningún registro:</b> ${faltan.map(nombreDia).join(', ')}.</span>
      <button class="btn sm" data-a="selfaltan">Elegir ${faltan.length === 1 ? 'ese día' : 'esos ' + faltan.length}</button></div>`;
  }
  html += `<div class="card grid"><div class="g-row g-head"><div class="hint">Clic en un día para elegirlo · clic en una celda para marcarla</div>`;
  M.dias.forEach(d => {
    const fut = d > M.t, n = M.conteo[d];
    const s = fut ? '' : (n ? n + (n === 1 ? ' registro' : ' registros') : 'vacío');
    html += `<button class="dayb${!fut && !n ? ' miss' : ''}${d === M.t ? ' hoy' : ''}" data-a="dia" data-d="${d}" aria-pressed="${!!S.sel[d]}" ${fut ? 'disabled' : ''}>
      <span class="d">${DOW_CORTO[dowDe(d)]}</span><span class="n">${Number(d.slice(8))}</span><span class="s">${s}</span></button>`;
  });
  html += `</div>`;
  M.secciones.forEach(sec => {
    html += `<div class="g-grp">${sec.nombre}<span>${esc(sec.hora === 'am' ? S.horas.am : S.horas.pm)}</span></div>`;
    sec.filas.forEach(f => {
      let izq;
      if (f.cat) {
        const ids = elegidosDe(f), ps = ids.map(id => S.porId[id]).filter(Boolean);
        const txt = ps.length ? ps.map(p => p.name).join(' · ') : 'Elige producto';
        izq = `<b>${esc(f.paso.name || f.cat)}</b><i>${esc(f.cat)}</i>
          <button class="pickb${ps.length ? '' : ' falta'}" data-a="pick" data-k="${esc(f.clave)}" aria-expanded="${S.abierto === f.clave}">${esc(txt)} ▾</button>`;
      } else if (f.prod) {
        izq = `<b>${etiquetaProd(f.prod)}</b><i>${esc(f.prod.category || '')}</i>`;
      } else {
        izq = `<b>${esc(((f.paso.emoji || '') + ' ' + (f.paso.name || '')).trim())}</b><i>paso sin producto</i>`;
      }
      if (sec.key === 'body' || sec.key === 'feet') {
        const r = S.rutinas.find(x => x.id === f.paso.routine_id);
        if (r) izq = izq.replace('</i>', ` · ${esc(r.name)}</i>`);
      }
      html += `<div class="g-row"><div class="g-prod">${izq}</div>`;
      f.celdas.forEach(c => {
        const sel = S.sel[c.d] ? ' sel' : '';
        let b;
        if (c.d > M.t) b = `<span class="cb off" aria-hidden="true"></span>`;
        else if (c.estado === 'off') b = `<span class="cb off" aria-hidden="true">—</span>`;
        else if (c.estado === 'futuro') b = `<span class="cb off" aria-hidden="true"></span>`;
        else if (c.estado === 'hecho') b = `<span class="cb done" title="${esc(c.ya)}" aria-label="${esc(nombreDia(c.d) + ': registrado, ' + c.ya)}">${I.check}</span>`;
        else b = `<button class="cb ${c.estado === 'borrador' ? 'draft' : 'due'}" data-a="celda" data-k="${c.d}|${c.p.id}" aria-label="${esc(nombreDia(c.d) + ': ' + (c.estado === 'borrador' ? 'en borrador' : 'tocaba y falta'))}">${c.estado === 'borrador' ? I.check : ''}</button>`;
        html += `<div class="g-cell${sel}">${b}</div>`;
      });
      html += `</div>`;
      if (f.cat && S.abierto === f.clave) {
        const ids = elegidosDe(f);
        const ops = S.productos.filter(p => p.category === f.cat && p.status !== 'out')
          .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
        html += `<div class="g-row"><div class="pickrow"><div class="small">Producto para <b>${esc(f.paso.name || f.cat)}</b> en este lote (puedes elegir varios si los aplicas en capas):</div><div class="chips">`;
        ops.forEach(p => { html += `<button class="chip" data-a="pickp" data-k="${esc(f.clave)}" data-p="${p.id}" aria-pressed="${ids.indexOf(p.id) !== -1}">${etiquetaProd(p)}</button>`; });
        html += `</div><div><button class="btn sm" data-a="pick" data-k="${esc(f.clave)}">Listo</button></div></div></div>`;
      }
    });
  });
  html += `</div><div class="legend"><span><i class="sw done"></i>Ya registrado</span><span><i class="sw draft"></i>Se va a registrar al guardar</span><span><i class="sw due"></i>Tocaba y no está</span><span><i class="sw off"></i>No tocaba ese día</span></div></section>`;
  html += panelDerecho(M);
  html += `</div>`;
  // Repintar reemplaza el HTML: sin esto la cuadrícula volvía a la primera
  // fila con cada clic y se perdía el lugar.
  const g0 = raiz.querySelector('.grid'), a0 = raiz.querySelector('aside.rp');
  const pos = { g: g0 ? g0.scrollTop : 0, gl: g0 ? g0.scrollLeft : 0, a: a0 ? a0.scrollTop : 0, m: raiz.scrollTop };
  raiz.innerHTML = html;
  const g1 = raiz.querySelector('.grid'), a1 = raiz.querySelector('aside.rp');
  if (g1) { g1.scrollTop = pos.g; g1.scrollLeft = pos.gl; }
  if (a1) a1.scrollTop = pos.a;
  raiz.scrollTop = pos.m;
}
function borradorValido(M) {
  // Solo cuenta lo que sigue pendiente en la cuadrícula visible.
  const out = [];
  M.secciones.forEach(sec => sec.filas.forEach(f => f.celdas.forEach(c => {
    if (c.estado === 'borrador') out.push({ sec, f, c });
  })));
  return out;
}
function panelDerecho(M) {
  if (S.hecho) {
    return `<aside class="rp"><div class="eyebrow" style="color:var(--done)">Guardado</div>
      <div class="disp" style="font-size:26px;font-weight:600;line-height:1.2">${S.hecho.n} ${S.hecho.n === 1 ? 'aplicación registrada' : 'aplicaciones registradas'}.</div>
      <div class="muted">Ya cuentan en tus barras de Progreso y aparecen en el celular.</div>
      <button class="btn" data-a="deshacer" ${S.guardando ? 'disabled' : ''}>${I.undo}Deshacer este lote</button>
      <button class="btn" data-a="otro">Seguir registrando</button></aside>`;
  }
  const items = borradorValido(M);
  const porDia = {};
  items.forEach(x => { porDia[x.c.d] = (porDia[x.c.d] || 0) + 1; });
  const sinProd = items.filter(x => x.f.cat && !elegidosDe(x.f).length);
  const n = items.length, dias = Object.keys(porDia).sort();
  let h = `<aside class="rp"><div class="eyebrow">Borrador</div>
    <div style="display:flex;align-items:baseline;gap:10px"><span class="big">${n}</span><span>${n === 1 ? 'paso' : 'pasos'}<br>en ${dias.length} ${dias.length === 1 ? 'día' : 'días'}</span></div>
    <div style="border-top:1px solid var(--line2)">`;
  if (!n) h += `<p class="muted" style="font-size:13.5px;margin:12px 0">Nada en borrador. Elige días arriba y pulsa <b>Rellenar con lo de siempre</b>, o marca celdas sueltas.</p>`;
  dias.forEach(d => { h += `<div class="sumrow"><span>${nombreDia(d)}</span><span class="mono">${porDia[d]}</span></div>`; });
  h += `</div>`;
  if (sinProd.length) h += `<div class="alert bad small"><span class="grow">${sinProd.length} ${sinProd.length === 1 ? 'celda necesita' : 'celdas necesitan'} que elijas producto (botón amarillo del renglón).</span></div>`;
  h += `<div class="horas"><label class="lbl" for="hora-am">Hora mañana<input class="field" type="time" id="hora-am" value="${S.horas.am}"></label>
    <label class="lbl" for="hora-pm">Hora noche, cuerpo y pies<input class="field" type="time" id="hora-pm" value="${S.horas.pm}"></label></div>
    <div class="note"><b>Zonas:</b> las de siempre de cada producto.<br><b>Registra solo lo que recuerdes:</b> un hueco es un dato verdadero; un día inventado cambia tus barras y el reporte de la dermatóloga.</div>
    <div style="flex:1"></div>
    <button class="btn pri" style="height:46px" data-a="guardar" ${n && !sinProd.length && !S.guardando ? '' : 'disabled'}>${S.guardando ? 'Guardando…' : 'Guardar ' + n + (n === 1 ? ' paso' : ' pasos')}</button>
    <button class="btn" data-a="descartar" ${n ? '' : 'disabled'}>Descartar borrador</button></aside>`;
  return h;
}

// ── ACCIONES ─────────────────────────────────────────────────────────────────
function rellenar() {
  const M = modelo();
  M.secciones.forEach(sec => sec.filas.forEach(f => f.celdas.forEach(c => {
    if (c.estado === 'toca' && S.sel[c.d]) S.borrador[c.d + '|' + c.p.id] = true;
  })));
  S.hecho = null;
  pintar();
}
function nuevoLote() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
}
async function guardar() {
  if (S.guardando) return;
  S.guardando = true; pintar();
  try {
    // Se vuelve a leer la semana justo antes de escribir: si algo se registró
    // desde el celular mientras tanto, esa celda ya sale "hecha" y no se duplica.
    await cargarSemana();
    const M = modelo();
    const items = borradorValido(M);
    const lote = nuevoLote();
    const filas = [];
    items.forEach(({ sec, f, c }) => {
      const hora = sec.hora === 'am' ? S.horas.am : S.horas.pm;
      if (f.cat) {
        elegidosDe(f).forEach(pid => {
          const nombre = nombreRegistroProducto(S.porId[pid]);
          filas.push(filaAplicacionLote({ nombre, prod: productoDeNombre(S.productos, nombre),
            fecha: c.d, hora, stepId: c.p.id, lote, orden: ORDEN_ZONAS }));
        });
      } else {
        const nombre = nombreRegistroPaso(c.p, productoDePaso(c.p, S.productos));
        filas.push(filaAplicacionLote({ nombre, prod: productoDeNombre(S.productos, nombre),
          fecha: c.d, hora, stepId: c.p.id, lote, orden: ORDEN_ZONAS }));
      }
    });
    if (!filas.length) { S.borrador = {}; S.guardando = false; pintar(); return; }
    const { error } = await db.from('product_applications').insert(filas);
    if (error) throw error;
    try { localStorage.setItem(K_ULTIMO, lote); } catch (e) {}
    S.hecho = { n: filas.length, lote };
    S.borrador = {}; S.sel = {};
    await cargarSemana();
  } catch (e) {
    alertar('No se guardó nada: ' + (e.message || e));
  }
  S.guardando = false; pintar();
}
async function deshacer() {
  if (!S.hecho || S.guardando) return;
  S.guardando = true; pintar();
  const { error } = await db.from('product_applications').delete().eq('notes', LOTE_PREFIJO + S.hecho.lote);
  if (error) alertar('No se pudo deshacer: ' + error.message);
  else { S.hecho = null; await cargarSemana(); }
  S.guardando = false; pintar();
}
function alertar(msg) {
  const d = document.createElement('div');
  d.className = 'alert bad'; d.setAttribute('role', 'alert');
  d.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9;max-width:560px';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 7000);
}
async function irSemana(lunes) {
  S.lunes = lunes; S.sel = {}; S.abierto = null;
  raiz.querySelector('.grid') && (raiz.querySelector('.grid').style.opacity = '.5');
  try { await cargarSemana(); } catch (e) { alertar(e.message || String(e)); }
  pintar();
}

const ORDEN_ZONAS = (typeof ZONAS !== 'undefined')
  ? Object.keys(ZONAS).sort((a, b) => (ZONAS[a].orden || 99) - (ZONAS[b].orden || 99)) : [];

function alClic(e) {
  const t = e.target.closest('[data-a]'); if (!t || !raiz.contains(t)) return;
  const a = t.dataset.a;
  if (a === 'dia') { S.sel[t.dataset.d] = !S.sel[t.dataset.d]; pintar(); }
  else if (a === 'selfaltan') { const M = modelo(); S.sel = {}; M.dias.filter(d => d <= M.t && !M.conteo[d]).forEach(d => { S.sel[d] = true; }); pintar(); }
  else if (a === 'celda') { const k = t.dataset.k; S.borrador[k] = !S.borrador[k]; S.hecho = null; pintar(); }
  else if (a === 'rellenar') rellenar();
  else if (a === 'pick') { S.abierto = S.abierto === t.dataset.k ? null : t.dataset.k; pintar(); }
  else if (a === 'pickp') {
    const k = t.dataset.k, M = modelo();
    let fila = null; M.secciones.forEach(s => s.filas.forEach(f => { if (f.clave === k) fila = f; }));
    const cur = new Set(fila ? elegidosDe(fila) : []);
    cur.has(t.dataset.p) ? cur.delete(t.dataset.p) : cur.add(t.dataset.p);
    S.elegidos[k] = [...cur]; pintar();
  }
  else if (a === 'guardar') guardar();
  else if (a === 'descartar') { S.borrador = {}; pintar(); }
  else if (a === 'deshacer') deshacer();
  else if (a === 'otro') { S.hecho = null; pintar(); }
  else if (a === 'sem') irSemana(shiftDateStr(S.lunes, 7 * Number(t.dataset.v)));
  else if (a === 'semhoy') irSemana(lunesDe(hoy()));
}
function alCambiar(e) {
  if (e.target.id === 'hora-am' || e.target.id === 'hora-pm') {
    const k = e.target.id === 'hora-am' ? 'am' : 'pm';
    if (/^\d\d:\d\d$/.test(e.target.value)) S.horas[k] = e.target.value;
    try { localStorage.setItem(K_HORAS, JSON.stringify(S.horas)); } catch (er) {}
    pintar();
  }
}
function alTecla(e) {
  if (!raiz || !raiz.isConnected || !raiz.querySelector('.reg')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if ((e.key === 'f' || e.key === 'F') && Object.keys(S.sel).some(k => S.sel[k])) rellenar();
}

// ── MONTAJE ──────────────────────────────────────────────────────────────────
let escuchando = false;
async function montar(el, cliente) {
  raiz = el; db = cliente;
  if (!escuchando) {
    document.addEventListener('keydown', alTecla);
    escuchando = true;
  }
  raiz.onclick = alClic;
  raiz.onchange = alCambiar;
  if (!S.lunes) S.lunes = lunesDe(hoy());
  pintar();
  if (S.cargado) return;
  try {
    await cargarBase();
    await cargarSemana();
    S.cargado = true; S.error = null;
  } catch (e) {
    S.error = e.message || String(e);
  }
  if (raiz === el && el.dataset.pantalla === 'registro') pintar();
}
return { montar };
})();
