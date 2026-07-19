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

// Puntuación de calidad de un SPF facial según sus tags (PA++++, profundidad
// UVA, tinte — el tinte también bloquea luz visible, otro detonante de
// melasma). 100 = protector "ideal".
function spfScoreOf(p) {
  let score = 20; // base por estar registrado como SPF facial
  tagsOf(p).forEach(t => {
    if (t.cls === 'pa4') score += 25;
    if (t.cls === 'uva400') score += 35;
    else if (t.cls === 'uvalong') score += 20;
    if (t.cls === 'tinted') score += 20;
  });
  return Math.min(100, score);
}
