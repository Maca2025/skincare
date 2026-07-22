// ============================================================================
// pure.js — helpers puros (sin DOM, sin Supabase, sin estado global).
// Compartidos entre app.js y tests.html — así la matemática de adherencia
// tiene pruebas sin necesitar levantar la app.
// ============================================================================

// OJO: usa la fecha LOCAL del navegador (getFullYear/getMonth/getDate), NO
// toISOString().split('T')[0] — eso convierte a UTC, y en Guadalajara (UTC-6)
// a partir de las ~6pm UTC ya es "mañana", así que todo lo aplicado en la
// noche terminaba registrado/agrupado bajo el día siguiente.
function toDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Convierte un timestamp guardado en UTC (ej. product_applications.applied_at)
// a la fecha del calendario LOCAL a la que corresponde.
function localDateOfISO(iso) { return toDateStr(new Date(iso)); }
// Rango [inicio, fin) en UTC que corresponde al día LOCAL "dateStr" completo.
function localDayBoundsUTC(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(dateStr + 'T00:00:00'); end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// ── SANITIZACIÓN ─────────────────────────────────────────────────────────────
// Escapa TODO texto que venga de la base o del usuario antes de meterlo a
// innerHTML — sin esto, un producto llamado "<img onerror=...>" ejecutaría
// código dentro de la app (XSS).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Texto multilínea escrito en un textarea → HTML seguro con saltos de línea.
function fmtRich(s) { return esc(s).replace(/\n/g, '<br>'); }
// Para clases CSS derivadas de datos (ej. tag.cls) — solo caracteres seguros.
function cssSafe(s) { return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_-]/g, ''); }
// Para pasar un string de datos como argumento JS dentro de un atributo onclick:
// primero se escapa para JS ( \ y ' ) y luego para el atributo HTML.
function jsAttrEsc(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }

// products.tags debería ser jsonb (arreglo real), pero algunos productos
// cargados por CSV/Excel quedaron con el texto crudo "[{...}]" como string —
// esto lo normaliza siempre a un arreglo real.
function tagsOf(p) {
  let t = p && p.tags;
  if (typeof t === 'string') {
    try { t = JSON.parse(t); } catch (e) { t = []; }
  }
  return Array.isArray(t) ? t : [];
}

// Itera cada fecha (YYYY-MM-DD) entre a y b inclusive. Trabaja en "espacio
// UTC" a propósito (mediodía UTC evita problemas de DST).
function eachDateStr(a, b, cb) {
  if (a > b) return;
  let d = new Date(a + 'T12:00:00Z');
  const end = new Date(b + 'T12:00:00Z');
  while (d <= end) {
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    cb(ds, d.getUTCDay());
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// % de cumplimiento contra un calendario dado (scheduleDays null/vacío =
// todos los días), en la ventana [wstart, ends]. done = Set de fechas
// YYYY-MM-DD en que sí se aplicó. La ventana empieza en el primer registro
// del producto (no se castiga lo anterior a empezar a usarlo).
function adherenceFromDoneDates(done, scheduleDays, wstart, ends) {
  if (!done.size) return null;
  const first = [...done].sort()[0];
  const start = first > wstart ? first : wstart;
  if (start > ends) return null;
  const days = (scheduleDays && scheduleDays.length) ? new Set(scheduleDays) : null;
  let elig = 0, hit = 0;
  eachDateStr(start, ends, (ds, dow) => {
    if (days && !days.has(dow)) return;
    elig++; if (done.has(ds)) hit++;
  });
  if (elig <= 0) return null;
  return { pct: Math.min(100, Math.round(hit / elig * 100)), hit, elig, start };
}

// Puntuación de calidad de un SPF facial según sus tags. 100 = "ideal".
// Pesos calibrados para MANCHAS SOLARES (lentigos): los sunspots son daño UV
// directo, así que la cobertura UVA profunda y el PA++++ pesan más, y el
// tinte (luz visible) pesa menos que cuando el objetivo era melasma.
// ── PROTECCIÓN UVA ───────────────────────────────────────────────────────────
// NO es una suma de etiquetas: tener más tags no significa proteger más. La
// puntuación se arma de tres componentes FÍSICAMENTE INDEPENDIENTES.
//
// 1) MAGNITUD — cuánta UVA se bloquea. Los sistemas asiático y europeo miden lo
//    mismo con métodos distintos, así que son EQUIVALENTES y jamás se suman:
//      · PA++++  (ISO 24442, PPD in vivo)  = PPD ≥ 16
//      · Sello UVA europeo (ISO 24443)     = UVA-PF ≥ SPF/3 → en SPF50 ≥ 16.7
//    Por eso un SPF50 europeo con el sello UVA protege igual que un PA++++
//    aunque no lleve etiqueta PA: la etiqueta refleja el mercado, no la fórmula.
//    Antes, un SPF50 europeo sin tag PA sacaba 25/100 — se subestimaba solo por
//    venderse bajo otra normativa.
//
// 2) ESPECTRO — hasta qué longitud de onda llega. El mínimo de amplio espectro
//    es una longitud de onda crítica ≥370 nm. Ir más allá SÍ es un beneficio
//    extra: UVA-400 / Mexoryl 400 (MCE, pico 385 nm) cierra el hueco 380–400 nm
//    que los demás filtros dejan abierto y reduce la pigmentación por UVA-1.
//
// 3) LUZ VISIBLE — los óxidos de hierro de los tintados. Superan a un SPF50+ sin
//    tinte para prevenir pigmentación por luz visible.
//
// Tags de MAGNITUD (excluyentes): pa4 | pa3 | pa2 | euuva (sello UVA en SPF50).
// Tags de ESPECTRO (excluyentes):  uva400 | uvalong.
// Tag de VISIBLE: tinted.
function spfScoreOf(p) {
  const tags = tagsOf(p);
  const has = cls => tags.some(t => t.cls === cls);
  // 1) Magnitud UVA (0–55): se toma el MEJOR dato disponible, nunca se acumula.
  let mag;
  if (has('pa4') || has('euuva')) mag = 55;
  else if (has('pa3')) mag = 40;
  else if (has('pa2')) mag = 25;
  else mag = 20; // SPF sin dato UVA: se asume solo el mínimo de amplio espectro
  // 2) Espectro más allá del mínimo de 370 nm (0–30).
  const esp = has('uva400') ? 30 : (has('uvalong') ? 15 : 0);
  // 3) Luz visible por óxidos de hierro (0–15).
  const vis = has('tinted') ? 15 : 0;
  return Math.min(100, mag + esp + vis);
}
