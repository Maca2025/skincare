// ============================================================================
// Skincare Tracker — escritorio.js
// Interfaz de COMPUTADORA. Comparte con la del celular: config.js (conexión),
// pure.js (funciones puras) y activos-matriz.js (datos del motor de dosis).
// NO comparte app.js: ese archivo es la interfaz del celular y no se carga aquí.
//
// Regla de la casa: lo que las dos interfaces necesiten igual (cómo se escribe
// un registro, cómo se resuelve un producto a partir de su nombre guardado) va
// a pure.js y lo usan las dos. Nunca una copia aquí.
//
// Paso 1 (24-sep-2026): la base — sesión, menú, conexión verificada.
// Paso 2 (24-sep-2026): Registro en lote → escritorio-registro.js.
// ============================================================================
(function () {
'use strict';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);

// ── PANTALLAS ────────────────────────────────────────────────────────────────
// Cada una se irá reemplazando por la real, en este orden de construcción.
const PANTALLAS = {
  registro: { titulo: 'Registro en lote', paso: 2,
    texto: 'La cuadrícula de días por pasos de rutina: rellenar los días olvidados con lo de siempre, revisar el borrador y guardar todo junto.' },
  rutinas:  { titulo: 'Rutinas', paso: 3,
    texto: 'Todas las rutinas lado a lado, con cada paso editable en su lugar y el aviso de irritantes por noche.' },
  catalogo: { titulo: 'Catálogo', paso: 4,
    texto: 'Los productos en tabla, con filtros, cambios en lote y la ficha de cada uno a la derecha.' },
  fotos:    { titulo: 'Estudio de fotos', paso: 5,
    texto: 'Alinear las fotos de cada sesión contra su foto base, sin modificar el original, y compararlas.' },
  revisar:  { titulo: 'Revisar y corregir', paso: 6,
    texto: 'El historial como tabla editable, las barras de progreso por zona y el reporte para la dermatóloga.' }
};
const ORDEN = Object.keys(PANTALLAS);
const KEY_PANTALLA = 'escritorio-pantalla';

let actual = 'registro';
try { const g = localStorage.getItem(KEY_PANTALLA); if (PANTALLAS[g]) actual = g; } catch (e) {}

// Pantallas ya construidas: cada una es un módulo con montar(elemento, db).
const MODULOS = { registro: window.Registro };

function pintar() {
  const p = PANTALLAS[actual];
  const main = $('main');
  main.dataset.pantalla = actual;
  main.onclick = null; main.onchange = null;
  document.querySelectorAll('.navb').forEach(b => {
    if (b.dataset.go === actual) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (MODULOS[actual]) { MODULOS[actual].montar(main, db); return; }
  main.innerHTML =
    `<div class="hdr"><div class="grow"><div class="eyebrow">${esc(p.titulo)}</div><h1>${esc(p.titulo)}</h1></div></div>
     <section class="card pronto">
       <div class="eyebrow">En construcción · paso ${p.paso}</div>
       <p>${esc(p.texto)}</p>
     </section>`;
}
function ir(nombre) {
  if (!PANTALLAS[nombre]) return;
  actual = nombre;
  try { localStorage.setItem(KEY_PANTALLA, nombre); } catch (e) {}
  pintar();
}
document.querySelectorAll('.navb').forEach(b => b.addEventListener('click', () => ir(b.dataset.go)));
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const n = Number(e.key);
  if (n >= 1 && n <= ORDEN.length) ir(ORDEN[n - 1]);
});

// ── CONEXIÓN: prueba de lectura real contra la base ──────────────────────────
// Si cualquiera de estas consultas falla, el pie del menú lo dice en rojo: es
// preferible saberlo aquí que descubrirlo al guardar un lote.
async function verificarConexion() {
  const est = $('estado');
  const hoy = toDateStr(new Date());
  const desde = localDayBoundsUTC(shiftDateStr(hoy, -6)).startISO;
  const cuenta = (tabla, filtro) => {
    let q = db.from(tabla).select('*', { count: 'exact', head: true });
    if (filtro) q = filtro(q);
    return q;
  };
  const [prod, rut, apps, fotos] = await Promise.all([
    cuenta('products'),
    cuenta('routines', q => q.eq('active', true)),
    cuenta('product_applications', q => q.gte('applied_at', desde)),
    cuenta('progress_photos')
  ]);
  const err = [prod, rut, apps, fotos].find(r => r.error);
  if (err) {
    est.className = 'estado err';
    est.innerHTML = '<span class="dot"></span>Sin conexión con la base';
    $('conteos').textContent = err.error.message || '';
    return;
  }
  est.className = 'estado ok';
  est.innerHTML = '<span class="dot"></span>Conectado a tu base';
  $('conteos').textContent =
    `${prod.count} productos · ${rut.count} rutinas · ${apps.count} aplicaciones en 7 días · ${fotos.count} fotos`;
}

// ── SESIÓN (la misma cuenta y la misma sesión que la app del celular) ─────────
function mostrarLogin(msg) {
  $('app').hidden = true;
  $('login').hidden = false;
  const e = $('login-error');
  e.textContent = msg || '';
  e.hidden = !msg;
}
let arrancada = false;
function mostrarApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  if (arrancada) return;
  arrancada = true;
  pintar();
  verificarConexion();
}
$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'Entrando…';
  const { error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { mostrarLogin(error.message); return; }
  mostrarApp();
});
$('logout').addEventListener('click', async () => {
  await db.auth.signOut();
  location.reload();
});
(async function arranque() {
  const { data: { session } } = await db.auth.getSession();
  if (session) mostrarApp(); else mostrarLogin();
  db.auth.onAuthStateChange((_ev, s) => { if (s) mostrarApp(); else mostrarLogin(); });
})();

})();
