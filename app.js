// ============================================================================
// Skincare Tracker — app.js
// Los helpers puros (fechas, escaping, adherencia) viven en pure.js.
// ============================================================================

// ── SUPABASE ─────────────────────────────────────────────────────────────────
// Esta key es "publishable" y es seguro exponerla SOLO si RLS está activado
// con políticas en todas las tablas y en el bucket. Ver supabase-hardening.sql
// (corre ese script en el SQL Editor de Supabase si no lo has hecho).
const SUPABASE_URL = 'https://psvphqieczrlbovwnxgi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_V4eBcTHlVl4JTj4EFszfTg_ReJU1Wy4';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── DATE STATE ───────────────────────────────────────────────────────────────
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// let (no const): si la pestaña queda abierta de un día para otro, se
// recalculan al volver a la app (ver refreshDateIfChanged).
let TODAY = new Date();
let TODAY_STR = toDateStr(TODAY);
function renderHeaderDate() {
  document.getElementById('hdr-date').textContent =
    `${DAYS[TODAY.getDay()]}, ${MONTHS[TODAY.getMonth()]} ${TODAY.getDate()}, ${TODAY.getFullYear()}`;
}
async function refreshDateIfChanged() {
  if (!appStarted) return;
  if (toDateStr(new Date()) === TODAY_STR) return;
  TODAY = new Date(); TODAY_STR = toDateStr(TODAY);
  renderHeaderDate();
  historyLoaded = false;
  await loadTodayRoutines(TODAY_STR);
  loadTodayApplications();
  loadTodayNote();
  showToast('📅 Nuevo día — Today actualizado', '');
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshDateIfChanged();
    // Al volver a la app, revisa de una vez si toca recordatorio de SPF.
    if (typeof checkSpfReminder === 'function' && appStarted) checkSpfReminder();
  }
});

// ── PM NIGHT ROTATION ────────────────────────────────────────────────────────
// Config editable en un solo lugar. 0=Dom ... 6=Sáb.
// (Si algún día quieres manejarla desde la base, muévela a una tabla settings.)
const PM_ROTATION = ['rest','aha','tret','aha','tret','rest','tret'];
function pmNightType(dow) { return PM_ROTATION[dow != null ? dow : TODAY.getDay()]; }
const PM_NIGHT_INFO = {
  tret: { label: '💊 Noche Tretinoína', color: '#F0EAFF', bg: '#6A40A8' },
  aha:  { label: '🫧 Noche Exfoliante', color: '#E8F4FF', bg: '#2060A0' },
  rest: { label: '😴 Noche Descanso',   color: '#EAFFF2', bg: '#287848' },
};

// ── PRODUCTS (from Supabase) ─────────────────────────────────────────────────
let allProducts = [];
async function loadProducts() {
  const { data, error } = await db.from('products')
    .select('*')
    .order('sort_order', { ascending: true });
  if (!error && data) allProducts = data;
}

// ── PRODUCT CATEGORIES (lista maestra — única fuente de verdad) ──────────────
// ── EJE = FUNCIÓN × ZONA ────────────────────────────────────────────────────
// Reproduce EXACTAMENTE el naming de DOSE_AXES en activos-matriz.js. No es
// decorativo: las claves se conservaron del modelo anterior para no invalidar
// los techos recalibrados con datos reales, así que cualquier cambio aquí tiene
// que ir acompañado del cambio allá.
//   · cara      → sin prefijo ('textura', 'firmeza'…)
//   · manos     → 'manos' para aclarado (clave histórica), 'manos_X' el resto
//   · monofunción (pies/labios/cabello) → su propio nombre, y SOLO con su
//     función: "firmeza de pies" no existe y devuelve null en vez de inventar
//     un eje que nadie calibró.
const ZONA_SOLO_FUNCION = { pies: 'queratolitico', labios: 'labial', cabello: 'capilar' };
const FUNCION_EXCLUSIVA = ['queratolitico', 'labial', 'capilar'];
function ejeKey(zona, funcion) {
  if (ZONA_SOLO_FUNCION[zona]) return ZONA_SOLO_FUNCION[zona] === funcion ? zona : null;
  if (FUNCION_EXCLUSIVA.indexOf(funcion) !== -1) return null;
  if (zona === 'cara') return funcion;
  if (zona === 'manos' && funcion === 'aclarado') return 'manos';
  return zona + '_' + funcion;
}
// Ejes que un producto puede alimentar = sus funciones × sus zonas por defecto.
function ejesDeProducto(p) {
  if (!p || typeof PRODUCT_DOSE === 'undefined') return [];
  const pot = PRODUCT_DOSE[p.id];
  if (!pot) return [];
  const zonas = (typeof PRODUCT_ZONAS !== 'undefined' && PRODUCT_ZONAS[p.id]) || [];
  const out = [];
  zonas.forEach(z => Object.keys(pot).forEach(f => {
    const k = ejeKey(z, f);
    if (k && typeof DOSE_AXES !== 'undefined' && DOSE_AXES[k] && out.indexOf(k) === -1) out.push(k);
  }));
  return out;
}

// Orden de presentación de las zonas: el de `ZONAS` en activos-matriz.js, en un
// solo lugar. Se usa tanto para los chips del picker como para lo que se
// escribe en `zones`, para que el array guardado sea siempre comparable.
const ZONAS_ORDEN = (typeof ZONAS !== 'undefined')
  ? Object.keys(ZONAS).sort((a, b) => (ZONAS[a].orden || 99) - (ZONAS[b].orden || 99))
  : [];
function zonaLabel(z) {
  const info = (typeof ZONAS !== 'undefined') ? ZONAS[z] : null;
  return info ? `${info.icon} ${info.label}` : z;
}
// Zonas que se escriben para UN producto. `elegidas` es lo marcado en el picker
// (o null cuando el registro no pasó por picker: paso fijo, reaplicación
// rápida, notificación). Sin elección explícita se escriben las zonas por
// defecto — el mismo resultado que el respaldo del motor, pero ya como DATO:
// si mañana PRODUCT_ZONAS cambia, los registros viejos conservan lo que pasó.
// El precio es que un default equivocado queda congelado en el histórico, así
// que el renglón de zonas del paso es tocable para corregirlo.
function zonasDeProducto(prod, elegidas) {
  if (!prod) return Array.isArray(elegidas) ? [...new Set(elegidas.filter(Boolean))] : [];
  const aptas = (typeof zonasAptasDe === 'function') ? zonasAptasDe(prod) : [];
  const def = (typeof PRODUCT_ZONAS !== 'undefined' && PRODUCT_ZONAS[prod.id]) || [];
  return resolveZonas(elegidas, aptas, def, ZONAS_ORDEN);
}
function zonasAptasDeNombre(name) {
  const p = productByLoggedName(name);
  return (p && typeof zonasAptasDe === 'function') ? zonasAptasDe(p) : [];
}
function zonasDeNombre(name, elegidas) {
  return zonasDeProducto(productByLoggedName(name), elegidas);
}

const PRODUCT_CATEGORIES = [
  '🧼 Limpieza',
  '💦 Toners',
  '✨ Serums AM',
  '💧 Hidratantes',
  '💊 Activos',
  '🫧 Exfoliantes',
  '👁️ Contorno Ojos',
  '🌞 SPF Facial',
  '☀️ SPF Corporal',
  '🧴 Cuerpo',
  '✋ Manos',
  '🦶 Pies',
  '💋 Labios',
];
function renderCategorySelects() {
  const catOptions = PRODUCT_CATEGORIES.map(c => `<option>${c}</option>`).join('');
  document.getElementById('pf-cat').innerHTML =
    '<option value="">— Elige categoría —</option>' + catOptions +
    '<option value="__new__">✏️ Nueva categoría...</option>';
  document.getElementById('sf-cat').innerHTML =
    '<option value="">— Elige un tipo —</option>' + catOptions +
    '<option value="__info__">📝 Sin producto (paso informativo)</option>';
}

// ── CHECKBOX LOGIC ───────────────────────────────────────────────────────────
// Marcar = registra la aplicación. DESMARCAR = BORRA el registro de ese paso
// para el día que se está viendo (antes solo cambiaba el visual y al recargar
// el paso volvía "hecho", inflando la adherencia). En ambos sentidos, si la
// base falla se revierte el visual (nada de UI optimista sin rollback).
async function checkStep(stepId, event) {
  event.stopPropagation();
  const step = document.getElementById(stepId);
  const wasDone = step.classList.contains('done');
  const routineStepId = step.dataset.routineStepId || null;
  const sb = step.closest('.sec-body');
  if (!wasDone) {
    // Paso con picker: el ✓ NO puede registrar solo, porque el texto visible
    // es la CATEGORÍA ("SPF Facial", "Hidratantes"), no un producto. Hacerlo
    // creaba filas sin product_id que además caían en el legacyRegex de SPF y
    // recibían un score asumido de 60 — protección inventada en el eje que
    // menos margen tiene. Se abre el picker y se registra al elegir.
    if (step.dataset.picker) { openPickerForCat(stepId, step.dataset.pickerCat || ''); return; }
    step.classList.add('done');
    if (sb) updateProgress(sb.id);
    const nameEl = step.querySelector('.sc-name');
    if (nameEl) {
      const nombre = nameEl.textContent.trim();
      selectedProduct = nombre;
      // Producto fijo: se registra con sus zonas por defecto y se muestran
      // debajo, tocables. Abrir un picker de zona en cada ✓ sería un toque
      // extra diario para confirmar lo mismo de siempre.
      const zonas = zonasDeNombre(nombre, null);
      const ok = await logApplication('rutina', routineStepId, null);
      if (!ok) { step.classList.remove('done'); if (sb) updateProgress(sb.id); }
      else if (zonas.length) {
        setStepZonas(stepId, (ok !== true && ok !== 'queued') ? [ok] : [],
          zonas, zonasAptasDeNombre(nombre));
      }
    }
  } else {
    step.classList.remove('done');
    if (sb) updateProgress(sb.id);
    const ok = await unlogRoutineStep(routineStepId, step);
    if (!ok) { step.classList.add('done'); if (sb) updateProgress(sb.id); }
    else {
      // Desmarcar BORRA las filas del día: el renglón de zonas ya no describe
      // ningún registro y tiene que irse con ellas.
      clearStepZonas(stepId);
      if (step.dataset.picker) {
        // Paso con picker: quitar el "✓ producto elegido" y regresar el hint.
        const picked = step.querySelector('.sc-picked');
        if (picked) picked.outerHTML = '<div class="sc-pick-hint" style="font-size:11px;color:#C4818A;margin-top:5px;font-style:italic;">Toca para elegir producto →</div>';
      }
    }
  }
}
async function unlogRoutineStep(routineStepId, step) {
  // Respeta el backdate: si estás viendo otro día, borra el registro de ESE día.
  const bd = document.getElementById('backdate-input');
  const dateStr = (bd && bd.value) ? bd.value.slice(0, 10) : TODAY_STR;
  const b = localDayBoundsUTC(dateStr);
  let q = db.from('product_applications').delete()
    .eq('source', 'rutina')
    .gte('applied_at', b.startISO)
    .lt('applied_at', b.endISO);
  if (routineStepId) {
    q = q.eq('routine_step_id', routineStepId);
  } else {
    const nameEl = step.querySelector('.sc-name');
    if (!nameEl) return true;
    q = q.eq('product_name', nameEl.textContent.trim());
  }
  const { error } = await q;
  if (error) { showToast('❌ ' + error.message, 'error'); return false; }
  historyLoaded = false;
  showToast('↩️ Paso desmarcado', '');
  return true;
}
function updateProgress(bodyId) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const total = body.querySelectorAll('.step').length;
  const count = body.querySelectorAll('.step.done').length;
  const prog  = document.getElementById('prog-' + bodyId);
  if (prog) {
    if (count === 0) {
      prog.textContent = ''; prog.className = 'sec-progress';
    } else if (count === total) {
      prog.textContent = '✓ All done!'; prog.className = 'sec-progress visible all-done';
    } else {
      prog.textContent = `${count}/${total}`; prog.className = 'sec-progress visible';
    }
  }
  updateTodaySummary();
}
// ── RESUMEN "¿QUÉ ME FALTA HOY?" ─────────────────────────────────────────────
// Franja compacta arriba de Today: avance por sección + hace cuánto fue tu
// último SPF + índice UV en vivo. Se oculta al backdatear (no aplica).
let _lastSpfTodayISO = null;
let _currentUV = null;
async function loadTodaySpfLast() {
  const spfIds = allProducts.filter(p => p.category === '🌞 SPF Facial').map(p => p.id);
  if (!spfIds.length) { _lastSpfTodayISO = null; updateTodaySummary(); return; }
  const b = localDayBoundsUTC(TODAY_STR);
  const { data } = await db.from('product_applications').select('applied_at')
    .in('product_id', spfIds)
    .gte('applied_at', b.startISO).lt('applied_at', b.endISO)
    .order('applied_at', { ascending: false }).limit(1);
  _lastSpfTodayISO = (data && data.length) ? data[0].applied_at : null;
  updateTodaySummary();
}
// Estado de la reaplicación, en un solo lugar: lo usan el resumen y el FAB.
// Se expresa como CUÁNDO TOCA, no como cuánto pasó — un plazo concreto mueve
// la conducta, un tiempo transcurrido solo informa (mejora #3).
function spfStatus() {
  if (!_lastSpfTodayISO) return { state: 'none', label: 'Sin SPF hoy' };
  const next = new Date(new Date(_lastSpfTodayISO).getTime() + SPF_REMINDER_GAP_H * 3600000);
  if (next.getTime() - Date.now() <= 0) return { state: 'due', label: 'Reaplicar ahora' };
  return {
    state: 'ok',
    label: 'Próxima ' + next.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  };
}
function updateTodaySummary() {
  const el = document.getElementById('today-summary');
  if (!el) return;
  renderSpfFab();
  const bd = document.getElementById('backdate-input');
  if (bd && bd.value) { el.innerHTML = ''; return; }
  const secs = [
    { icon: '☀️', id: 'am-body' }, { icon: '🌙', id: 'pm-body' },
    { icon: '🧴', id: 'body-body' }, { icon: '🦶', id: 'feet-body' },
  ];
  const parts = secs.map(s => {
    const body = document.getElementById(s.id);
    if (!body) return null;
    const total = body.querySelectorAll('.step').length;
    if (!total) return null;
    const done = body.querySelectorAll('.step.done').length;
    return `<span class="tsum-item${done === total ? ' tsum-ok' : ''}">${s.icon} ${done}/${total}</span>`;
  }).filter(Boolean);
  const st = spfStatus();
  const spf = `<span class="tsum-item ${st.state === 'ok' ? 'tsum-ok' : 'tsum-warn'}">🛡️ ${st.label}${st.state === 'ok' ? '' : ' ⚠️'}</span>`;
  let uv = '';
  if (_currentUV != null) {
    const cls = _currentUV >= 8 ? ' tsum-warn' : (_currentUV < 3 ? ' tsum-ok' : '');
    let txt = `☀️ UV ${Math.round(_currentUV)}`;
    // El pico solo se anuncia si TODAVÍA está por delante: planear la mañana
    // sirve, enterarte a las 6pm de que el pico fue a la 1pm no (mejora #4).
    if (_uvMax != null && _uvMaxHour != null &&
        _uvMaxHour > new Date().getHours() && Math.round(_uvMax) > Math.round(_currentUV)) {
      txt += ` → pico ${Math.round(_uvMax)} a las ${_uvMaxHour}h`;
    }
    uv = `<span class="tsum-item${cls}">${txt}</span>`;
  }
  el.innerHTML = `<div class="tsum-card">${parts.join('')}${spf}${uv}</div>`;
}
// ── ÍNDICE UV EN VIVO (Open-Meteo, gratis y sin key) ─────────────────────────
// Coordenadas de Guadalajara. Además de mostrarse en el resumen, hace el
// recordatorio SPF más exigente con UV alto y lo silencia con UV bajo.
let _uvMax = null, _uvMaxHour = null;
async function fetchUV() {
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=20.67&longitude=-103.35' +
      '&current=uv_index&hourly=uv_index&forecast_days=1&timezone=auto');
    const j = await r.json();
    _currentUV = (j && j.current && j.current.uv_index != null) ? j.current.uv_index : null;
    // Pico del día. DEFENSIVO a propósito: si `hourly` no viene o cambia de
    // forma, el UV actual sigue funcionando igual que antes y solo se pierde
    // el pronóstico.
    _uvMax = null; _uvMaxHour = null;
    const H = j && j.hourly;
    if (H && Array.isArray(H.uv_index) && Array.isArray(H.time)) {
      let best = -1, bestI = -1;
      H.uv_index.forEach((v, i) => { if (v != null && v > best) { best = v; bestI = i; } });
      if (bestI >= 0) {
        _uvMax = best;
        const m = String(H.time[bestI] || '').match(/T(\d{2}):/);
        _uvMaxHour = m ? Number(m[1]) : null;
      }
    }
  } catch (e) { _currentUV = null; _uvMax = null; _uvMaxHour = null; }
  updateTodaySummary();
}

// ── DAILY NOTES + ESTADO DE PIEL ─────────────────────────────────────────────
// Requiere la columna daily_notes.skin_state (ver migracion-mejoras.sql).
const SKIN_STATES = [
  { v: 1, e: '😖', l: 'Irritada' },
  { v: 2, e: '😕', l: 'Sensible' },
  { v: 3, e: '😐', l: 'Normal' },
  { v: 4, e: '🙂', l: 'Bien' },
  { v: 5, e: '✨', l: 'Radiante' },
];
let selectedSkinState = null;
function renderSkinStateRow() {
  const el = document.getElementById('skin-state-row');
  if (!el) return;
  el.innerHTML = SKIN_STATES.map(s =>
    `<button class="skin-btn${selectedSkinState === s.v ? ' on' : ''}" onclick="setSkinState(${s.v})">
  <div class="skin-btn-emoji">${s.e}</div><div class="skin-btn-lbl">${s.l}</div>
</button>`).join('');
}
async function setSkinState(v) {
  const prev = selectedSkinState;
  selectedSkinState = selectedSkinState === v ? null : v;
  renderSkinStateRow();
  // Se guarda al toque (sin esperar al botón de la nota), conservando el
  // texto que esté en el textarea.
  const { error } = await db.from('daily_notes').upsert(
    { note_date: TODAY_STR, notes: document.getElementById('daily-notes').value.trim(), skin_state: selectedSkinState, updated_at: new Date().toISOString() },
    { onConflict: 'note_date' }
  );
  if (error) {
    selectedSkinState = prev;
    renderSkinStateRow();
    showToast('❌ ' + error.message + ' (¿corriste migracion-mejoras.sql?)', 'error');
  } else if (selectedSkinState) {
    showToast('✅ Estado de piel guardado', 'success');
  }
}
// Exposición solar del día — LA variable causal de los sunspots. Requiere
// la columna daily_notes.sun_exposure (ver migracion-mejoras2.sql).
const SUN_EXPOSURES = [
  { v: 'interior', e: '🏠', l: 'Interior' },
  { v: 'normal',   e: '🚶', l: 'Normal' },
  { v: 'alta',     e: '☀️', l: 'Mucho sol' },
  { v: 'playa',    e: '🏖️', l: 'Playa' },
];
let selectedSunExposure = null;
function renderSunExposureRow() {
  const el = document.getElementById('sun-exposure-row');
  if (!el) return;
  el.innerHTML = SUN_EXPOSURES.map(s =>
    `<button class="skin-btn${selectedSunExposure === s.v ? ' on' : ''}" onclick="setSunExposure('${s.v}')">
  <div class="skin-btn-emoji">${s.e}</div><div class="skin-btn-lbl">${s.l}</div>
</button>`).join('');
}
async function setSunExposure(v) {
  const prev = selectedSunExposure;
  selectedSunExposure = selectedSunExposure === v ? null : v;
  renderSunExposureRow();
  const { error } = await db.from('daily_notes').upsert(
    { note_date: TODAY_STR, notes: document.getElementById('daily-notes').value.trim(), skin_state: selectedSkinState, sun_exposure: selectedSunExposure, updated_at: new Date().toISOString() },
    { onConflict: 'note_date' }
  );
  if (error) {
    selectedSunExposure = prev;
    renderSunExposureRow();
    showToast('❌ ' + error.message + ' (¿corriste migracion-mejoras2.sql?)', 'error');
  } else if (selectedSunExposure) {
    showToast('✅ Exposición registrada', 'success');
  }
}
async function loadTodayNote() {
  const { data } = await db.from('daily_notes').select('*').eq('note_date', TODAY_STR).maybeSingle();
  document.getElementById('daily-notes').value = (data && data.notes) ? data.notes : '';
  selectedSkinState = data ? (data.skin_state || null) : null;
  selectedSunExposure = data ? (data.sun_exposure || null) : null;
  renderSkinStateRow();
  renderSunExposureRow();
}
async function saveNote() {
  const btn = document.getElementById('save-btn');
  const notes = document.getElementById('daily-notes').value.trim();
  if (!notes) { showToast('⚠️ Escribe algo antes de guardar', 'error'); return; }
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  const { error } = await db.from('daily_notes').upsert(
    { note_date: TODAY_STR, notes, skin_state: selectedSkinState, sun_exposure: selectedSunExposure, updated_at: new Date().toISOString() },
    { onConflict: 'note_date' }
  );
  btn.disabled = false; btn.textContent = '💾 Guardar nota';
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  showToast('✅ Nota guardada', 'success');
}

// ── PHOTO TYPES ──────────────────────────────────────────────────────────────
const PHOTO_TYPES = [
  { key:'cara-derecha',   label:'👤 Cara derecha' },
  { key:'cara-izquierda', label:'👤 Cara izquierda' },
  { key:'cara-frente',    label:'👤 Cara frente' },
  { key:'pecho',          label:'💜 Pecho' },
  { key:'brazo',          label:'💪 Brazo' },
  { key:'mano',           label:'✋ Mano' },
  { key:'pie',            label:'🦶 Pie' },
  { key:'pierna',         label:'🦵 Pierna' },
];
let selectedPhotoType = null;
function renderPhotoTypeGrid() {
  document.getElementById('photo-type-grid').innerHTML = PHOTO_TYPES.map(t =>
    `<button class="photo-type-btn" onclick="selectPhotoType(this,'${t.key}')">${t.label}</button>`
  ).join('');
}
function selectPhotoType(btn, key) {
  document.querySelectorAll('.photo-type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedPhotoType = key;
  updateUploadBtn();
  loadGhostPhoto(key);
}

// ── FOTO FANTASMA ────────────────────────────────────────────────────────────
// Superpone la última foto de la MISMA área sobre el preview, translúcida.
// La silueta genérica que había antes no sirve para alinear: cada área tiene
// su propio encuadre. Sin esto, una comparación "antes/después" mide tanto el
// ángulo y la luz como el pigmento — y sobre eso se toman decisiones clínicas.
let _ghostUrl = null;
async function loadGhostPhoto(typeKey) {
  _ghostUrl = null;
  const g = document.getElementById('photo-ghost');
  if (g) { g.style.display = 'none'; g.src = ''; }
  updateGuideBtn();   // en TODOS los caminos: al cambiar a un área sin foto
                      // previa, el botón no puede seguir ofreciendo superponer
  if (!typeKey) return;
  const { data } = await db.from('progress_photos')
    .select('photo_url').eq('photo_type', typeKey)
    .order('photo_date', { ascending: false }).limit(1);
  if (!data || !data.length) return;
  const path = extractStoragePath(data[0].photo_url);
  const { data: signed } = await db.storage.from('progress-photos').createSignedUrls([path], 3600);
  if (signed && signed[0] && signed[0].signedUrl) _ghostUrl = signed[0].signedUrl;
  updateGuideBtn();
}
// El botón dice qué va a mostrar: la foto real si existe, o la silueta si es
// la primera vez que fotografías esa área.
function updateGuideBtn() {
  const btn = document.getElementById('photo-guide-btn');
  if (!btn) return;
  btn.textContent = _ghostUrl ? '👻 Superponer foto anterior' : '⊙ Mostrar guía de encuadre';
}
function updateUploadBtn() {
  const hasPhoto = document.getElementById('photo-input').files.length > 0;
  document.getElementById('upload-btn').disabled = !hasPhoto || !selectedPhotoType;
}

// ── PHOTO HANDLING ───────────────────────────────────────────────────────────
function previewPhoto(input) {
  if (!input.files[0]) return;
  const img = document.getElementById('photo-preview');
  img.src = URL.createObjectURL(input.files[0]);
  document.getElementById('photo-preview-wrap').style.display = 'block';
  const gb = document.getElementById('photo-guide-btn');
  if (gb) { gb.style.display = 'flex'; updateGuideBtn(); }
  updateUploadBtn();
}
// Overlay de silueta sobre el preview — para verificar que el ángulo/encuadre
// coincida con las fotos anteriores antes de subirla (si no coincide, retoma).
function togglePhotoGuide() {
  const ghost = document.getElementById('photo-ghost');
  const ov = document.getElementById('photo-guide-overlay');
  if (_ghostUrl && ghost) {          // hay foto previa: se superpone la real
    const on = ghost.style.display !== 'none';
    if (!on) ghost.src = _ghostUrl;
    ghost.style.display = on ? 'none' : 'block';
    if (ov) ov.style.display = 'none';
    return;
  }
  if (ov) ov.style.display = ov.style.display === 'none' ? 'block' : 'none';
}
// Aviso suave si ya pasó una semana sin foto de progreso (una vez por sesión).
async function checkPhotoReminder() {
  const { data } = await db.from('progress_photos').select('photo_date')
    .order('photo_date', { ascending: false }).limit(1);
  if (!data || !data.length) return;
  const days = Math.floor((new Date(TODAY_STR + 'T12:00:00') - new Date(data[0].photo_date + 'T12:00:00')) / 86400000);
  if (days >= 7) showToast(`📸 Ya pasaron ${days} días desde tu última foto de progreso`, '');
}
// createImageBitmap con imageOrientation:'from-image' respeta la orientación
// EXIF (fotos de celular que antes podían quedar giradas al comprimir);
// fallback al método viejo con <img> si el navegador no lo soporta.
async function decodeImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { /* fallback abajo */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}
async function compressImage(file, maxW = 900) {
  const img = await decodeImage(file);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale  = Math.min(1, maxW / w);
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75));
}
// Bucket "progress-photos" es privado: photo_url en la DB guarda solo el nombre
// del archivo (o una URL vieja de cuando el bucket era público).
function extractStoragePath(stored) {
  if (!stored) return stored;
  const marker = '/progress-photos/';
  const idx = stored.indexOf(marker);
  return idx === -1 ? stored : stored.slice(idx + marker.length).split('?')[0];
}
async function uploadPhoto() {
  const input = document.getElementById('photo-input');
  if (!input.files[0] || !selectedPhotoType) return;
  const btn = document.getElementById('upload-btn');
  btn.disabled = true; btn.textContent = '⏳ Subiendo...';
  showToast('Comprimiendo...', '');
  let blob;
  try { blob = await compressImage(input.files[0]); }
  catch (e) { showToast('❌ Error al comprimir', 'error'); btn.disabled = false; btn.textContent = 'Subir foto'; return; }
  const filename = `${TODAY_STR}-${Date.now()}.jpg`;
  const { error: upErr } = await db.storage.from('progress-photos').upload(filename, blob, { contentType: 'image/jpeg' });
  if (upErr) { showToast('❌ ' + upErr.message, 'error'); btn.disabled = false; btn.textContent = 'Subir foto'; return; }
  const caption = document.getElementById('photo-caption').value.trim();
  const { error: dbErr } = await db.from('progress_photos').insert({
    photo_date: TODAY_STR, photo_url: filename, caption, photo_type: selectedPhotoType
  });
  if (dbErr) { showToast('❌ ' + dbErr.message, 'error'); btn.disabled = false; btn.textContent = 'Subir foto'; return; }
  btn.disabled = false; btn.textContent = 'Subir foto';
  showToast('📸 ¡Foto guardada!', 'success');
  input.value = '';
  document.getElementById('photo-preview').src = '';
  document.getElementById('photo-preview-wrap').style.display = 'none';
  document.getElementById('photo-caption').value = '';
  selectedPhotoType = null;
  document.querySelectorAll('.photo-type-btn').forEach(b => b.classList.remove('selected'));
  updateUploadBtn();
  historyLoaded = false;
  renderWeekCalendar();
  galleryLoaded = false;
  loadPhotoGallery();
}

// ── WEEK CALENDAR ────────────────────────────────────────────────────────────
async function renderWeekCalendar() {
  const dow = TODAY.getDay();
  const mon = new Date(TODAY);
  mon.setDate(TODAY.getDate() - ((dow + 6) % 7));
  const weekDates = Array.from({length:7}, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return toDateStr(d);
  });
  const { data } = await db.from('progress_photos').select('photo_date').in('photo_date', weekDates);
  const photoDates = new Set((data || []).map(r => r.photo_date));
  document.getElementById('week-grid').innerHTML = weekDates.map((ds, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const cls = [ds === TODAY_STR && 'wk-today', photoDates.has(ds) && 'wk-photo'].filter(Boolean).join(' ');
    return `<div class="wk-cell ${cls}">
  <div class="wk-cell-day">${DAYS_S[d.getDay()]}</div>
  <div class="wk-cell-num">${d.getDate()}</div>
  <div class="wk-cell-dot">${photoDates.has(ds) ? '📸' : '·'}</div>
</div>`;
  }).join('');
}

// ── PHOTO GALLERY ────────────────────────────────────────────────────────────
let galleryLoaded = false;
async function loadPhotoGallery() {
  const el = document.getElementById('photo-gallery-content');
  const { data } = await db.from('progress_photos').select('*').order('created_at', { ascending: true });
  const photos = data || [];
  // Firmar TODAS las URLs en una sola llamada (antes era una petición por foto).
  const paths = photos.map(p => extractStoragePath(p.photo_url));
  if (paths.length) {
    const { data: signed } = await db.storage.from('progress-photos').createSignedUrls(paths, 3600);
    photos.forEach((p, i) => {
      p._path = paths[i]; // path original para poder borrar el archivo después
      const s = signed && signed[i];
      if (s && !s.error && s.signedUrl) p.photo_url = s.signedUrl;
    });
  }
  const byType = {};
  for (const p of photos) {
    const t = p.photo_type || 'general';
    if (!byType[t]) byType[t] = [];
    byType[t].push(p);
  }
  const typesWithPhotos = PHOTO_TYPES.filter(t => byType[t.key] && byType[t.key].length > 0);
  const compareHTML = typesWithPhotos.length === 0
    ? '<div class="empty-state">No hay fotos aún.<br>Sube la primera arriba.</div>'
    : typesWithPhotos.map(t => {
        const arr    = byType[t.key];
        const oldest = arr[0];
        const newest = arr[arr.length - 1];
        const canCmp = arr.length >= 2;
        return `<div style="margin-bottom:18px">
  <div style="font-size:12px;font-weight:700;color:#7A5A5A;margin-bottom:10px">${t.label} <span style="font-weight:400;color:#A09090">(${arr.length} foto${arr.length>1?'s':''})</span></div>
  <div class="compare-grid">
    <div class="compare-slot">
      <img class="compare-img" src="${esc(oldest.photo_url)}" onclick="window.open(this.src,'_blank')" loading="lazy">
      <div class="compare-lbl">ANTES</div>
      <div class="compare-dt">${fmtDate(oldest.photo_date)}</div>
    </div>
    <div class="compare-slot">
      ${canCmp
        ? `<img class="compare-img" src="${esc(newest.photo_url)}" onclick="window.open(this.src,'_blank')" loading="lazy">
           <div class="compare-lbl">AHORA</div>
           <div class="compare-dt">${fmtDate(newest.photo_date)}</div>`
        : `<div class="compare-empty">
             <div class="compare-empty-icon">📷</div>
             <div class="compare-empty-txt">Agrega más fotos para comparar</div>
           </div>
           <div class="compare-lbl">AHORA</div>`
      }
    </div>
  </div>
  ${canCmp ? `<button class="mini-action-btn" style="margin-top:8px" onclick="openSliderCompare('${t.key}')">🔀 Comparar con slider (elige fechas)</button>` : ''}
</div>`;
      }).join('');
  const galleryHTML = photos.length === 0
    ? '<div class="empty-state">No hay fotos aún.</div>'
    : typesWithPhotos.map(t => {
        const arr = [...byType[t.key]].reverse();
        return `<div style="margin-bottom:16px">
  <div style="font-size:11px;font-weight:700;color:#9A8888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">${t.label}</div>
  <div class="gallery-grid">${arr.map(p =>
    `<div class="gallery-thumb-wrap">
    <img class="gallery-thumb" src="${esc(p.photo_url)}" title="${esc(p.caption || fmtDate(p.photo_date))}"
     onclick="window.open(this.src,'_blank')" loading="lazy">
    <button class="gallery-thumb-edit" onclick="event.stopPropagation(); openReclassifyModal('${p.id}','${esc(p.photo_type||'')}')" title="Reclasificar área">✏️</button>
    <button class="gallery-thumb-del" onclick="event.stopPropagation(); deletePhoto('${p.id}','${jsAttrEsc(p._path||'')}')" title="Eliminar foto">🗑️</button>
  </div>`
  ).join('')}</div>
</div>`;
      }).join('');
  el.innerHTML = `
<div class="compare-card"><h3>📷 Comparativa por área</h3>${compareHTML}</div>
<div class="gallery-card"><h3>🖼️ Galería</h3>${galleryHTML}</div>`;
  _photosByType = byType;
  galleryLoaded = true;
}
// ── COMPARADOR CON SLIDER ────────────────────────────────────────────────────
// Elige DOS fechas cualquiera de una misma área y deslízalas superpuestas
// (la comparativa fija solo muestra primera vs. última).
let _photosByType = {};
let _sliderType = null;
function openSliderCompare(typeKey) {
  _sliderType = typeKey;
  const arr = _photosByType[typeKey] || [];
  if (arr.length < 2) return;
  const t = PHOTO_TYPES.find(x => x.key === typeKey);
  document.getElementById('slider-title').textContent = `🔀 ${t ? t.label : 'Comparar'}`;
  const opts = (sel) => arr.map((p, i) =>
    `<option value="${i}"${i === sel ? ' selected' : ''}>${p.photo_date}${p.caption ? ' · ' + esc(p.caption).slice(0, 25) : ''}</option>`).join('');
  document.getElementById('slider-body').innerHTML = `
<div class="slider-selects">
  <select class="prod-input prod-select" id="slider-a" onchange="renderSliderStage()" style="flex:1">${opts(0)}</select>
  <select class="prod-input prod-select" id="slider-b" onchange="renderSliderStage()" style="flex:1">${opts(arr.length - 1)}</select>
</div>
<div class="slider-stage" id="slider-stage"></div>
<input type="range" class="slider-range" min="0" max="100" value="50" oninput="sliderMove(this.value)">
<div style="display:flex;justify-content:space-between;font-size:11px;color:#9A8888;margin-top:2px"><span>← primera fecha</span><span>segunda fecha →</span></div>`;
  renderSliderStage();
  openModal('slider-modal');
}
function renderSliderStage() {
  const arr = _photosByType[_sliderType] || [];
  const selA = document.getElementById('slider-a'), selB = document.getElementById('slider-b');
  if (!selA || !selB) return;
  const a = arr[Number(selA.value)], b = arr[Number(selB.value)];
  if (!a || !b) return;
  document.getElementById('slider-stage').innerHTML = `
<img src="${esc(b.photo_url)}">
<div class="slider-top" id="slider-top" style="clip-path:inset(0 50% 0 0)"><img src="${esc(a.photo_url)}"></div>`;
}
function sliderMove(v) {
  const el = document.getElementById('slider-top');
  if (el) el.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
}
// Borra la foto: fila en la base + archivo en el bucket (antes no existía
// forma de borrar, y el archivo hubiera quedado huérfano en Storage).
async function deletePhoto(photoId, storagePath) {
  const ok = await confirmSheet('¿Eliminar esta foto? Se borra también el archivo original.');
  if (!ok) return;
  const { error } = await db.from('progress_photos').delete().eq('id', photoId);
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  if (storagePath) {
    // Best-effort: si falla, la fila ya no existe y el archivo queda huérfano
    // pero invisible — no bloquea a la usuaria.
    await db.storage.from('progress-photos').remove([storagePath]);
  }
  showToast('🗑️ Foto eliminada', '');
  galleryLoaded = false;
  loadPhotoGallery();
  renderWeekCalendar();
}

// ── RECLASSIFY PHOTO ─────────────────────────────────────────────────────────
let reclassifyPhotoId = null;
function openReclassifyModal(photoId, currentType) {
  reclassifyPhotoId = photoId;
  const body = document.getElementById('reclassify-body');
  body.innerHTML = `<div class="photo-type-grid">${PHOTO_TYPES.map(t =>
    `<button class="photo-type-btn${t.key === currentType ? ' selected' : ''}" onclick="reclassifyPhoto('${t.key}')">${t.label}</button>`
  ).join('')}</div>`;
  openModal('reclassify-modal');
}
async function reclassifyPhoto(newType) {
  if (!reclassifyPhotoId) return;
  const { error } = await db.from('progress_photos').update({ photo_type: newType }).eq('id', reclassifyPhotoId);
  closeModal('reclassify-modal');
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  showToast('✅ Foto reclasificada', 'success');
  reclassifyPhotoId = null;
  galleryLoaded = false;
  loadPhotoGallery();
}
// ── HISTORY / PROGRESO ───────────────────────────────────────────────────────
let historyLoaded = false;
async function loadHistory() {
  const el = document.getElementById('history-content');
  el.innerHTML = '<div class="loading-state"><span class="spinner">⟳</span><br><br>Loading...</div>';
  const since90 = new Date(TODAY); since90.setDate(since90.getDate() - 90);
  const [appsRes, stepsRes, routinesRes, allStepsRes, notesRes, hitosRes] = await Promise.all([
    // `zones` es indispensable: sin ella el motor de dosis nunca ve la zona
    // registrada y cae siempre al respaldo de PRODUCT_ZONAS, con lo que la
    // capacidad entera del refactor función × zona queda muerta y en silencio.
    // Este select lista columnas EXPLÍCITAS a propósito (no `*`) para no traer
    // payload de más en 90 días de registros — el precio es acordarse de
    // añadir aquí cada columna nueva que el cálculo necesite.
    db.from('product_applications').select('id, product_name, product_id, applied_at, source, routine_step_id, zones')
      .gte('applied_at', localDayBoundsUTC(toDateStr(since90)).startISO)
      .order('applied_at', { ascending: false }),
    db.from('routine_steps').select('product_id, routines(schedule_days)').not('product_id', 'is', null),
    db.from('routines').select('id, section_key, schedule_days, sort_order').eq('active', true),
    db.from('routine_steps').select('id, routine_id'),
    db.from('daily_notes').select('note_date, skin_state, sun_exposure').gte('note_date', toDateStr(since90)),
    // Hitos para marcar el heatmap. Si la tabla aún no existe (migración sin
    // correr) el error se ignora y el heatmap se pinta igual que siempre.
    db.from('treatment_events').select('event_date, event_type, title').gte('event_date', toDateStr(since90))
  ]);
  // ── HITOS POR FECHA ───────────────────────────────────────────────────────
  // Dos fuentes, igual que la línea de tiempo: eventos capturados a mano e
  // inicios de producto derivados de products.started_at (ya en memoria).
  // Es lo que permite leer el heatmap de forma causal: "esta racha mala empezó
  // la semana que entró la tretinoína".
  const hitosByDate = {};
  const pushHito = (ds, txt) => {
    if (!ds) return;
    (hitosByDate[ds] = hitosByDate[ds] || []).push(txt);
  };
  ((hitosRes && hitosRes.data) || []).forEach(h => {
    const ic = (typeof hitoType === 'function') ? hitoType(h.event_type).e : '📌';
    pushHito(h.event_date, `${ic} ${h.title}`);
  });
  allProducts.forEach(p => { if (p.started_at) pushHito(p.started_at, `🆕 Empecé ${p.name}`); });
  const apps = appsRes.data || [];
  // Si un producto es paso fijo de una rutina, esa rutina define cuándo "toca".
  const productRoutineInfo = {};
  ((stepsRes && stepsRes.data) || []).forEach(s => {
    if (!s.product_id) return;
    if (!productRoutineInfo[s.product_id]) productRoutineInfo[s.product_id] = { daily: false, days: new Set() };
    const info = productRoutineInfo[s.product_id];
    const days = s.routines && s.routines.schedule_days;
    if (!days || !days.length) info.daily = true; else days.forEach(d => info.days.add(d));
  });
  // ── MÉTRICAS DE CONSTANCIA — corte SIEMPRE al cierre de AYER ───────────────
  const _prodById = {};
  allProducts.forEach(p => { _prodById[p.id] = p; });
  const appProd = r => (r.product_id && _prodById[r.product_id]) || { id: null, name: r.product_name || '', emoji: '', category: '', clinical_roles: [], clinical_role: null, schedule_days: null };
  const allAppsWithProd = apps.map(r => ({ r, rp: appProd(r) }));
  const ROLE_CONFIG = {
    spf_facial:           { label: 'Protección solar', icon: '🛡️', color: '#C4818A', legacyRegex: x => x.category === '🌞 SPF Facial' || (x.category !== '💋 Labios' && /spf|solar/i.test(x.name || '') && !/corporal|cuerpo|body|labios|\blip\b/i.test(x.name || '')) },
    despigmentacion:      { label: 'Despigmentación',         icon: '🎯', color: '#C47A00', legacyRegex: x => /finacea|azela|melascreen|antipigment|despigmentante/i.test(x.name || '') },
    barrera:              { label: 'Barrera sana',            icon: '💧', color: '#3A8A7A', legacyRegex: x => x.category === '💧 Hidratantes' || /hydro boost|barrier|rice|niacinamide|ceramide/i.test(x.name || '') },
    regeneracion_celular: { label: 'Renovación celular',      icon: '🔬', color: '#7E6BB0', legacyRegex: x => /tretino|retin-a/i.test(x.name || '') && !/corporal|cuerpo|body/i.test(x.name || '') },
    textura_poros:        { label: 'Textura / Poros',          icon: '🔍', color: '#5B8FA8', legacyRegex: () => false }
  };
  const LEGACY_ROLE_MAP = { finacea: 'despigmentacion', tretinoina: 'regeneracion_celular', barrera: 'barrera', spf_facial: 'spf_facial' };
  const hasRole = (p, role) => {
    if (p.clinical_roles && p.clinical_roles.length) return p.clinical_roles.includes(role);
    if (p.clinical_role) return LEGACY_ROLE_MAP[p.clinical_role] === role;
    return ROLE_CONFIG[role].legacyRegex(p);
  };
  const _yst = new Date(TODAY); _yst.setDate(TODAY.getDate() - 1);
  const ENDS = toDateStr(_yst);
  const _ws = new Date(TODAY); _ws.setDate(TODAY.getDate() - 90);
  const WSTART = toDateStr(_ws);
  const productDoneDates = (p) => {
    const s = new Set();
    allAppsWithProd.forEach(({ r, rp }) => {
      const matches = (p.id && rp.id === p.id) || (!rp.id && rp.name === p.name);
      if (matches) s.add(localDateOfISO(r.applied_at));
    });
    return s;
  };
  const effectiveScheduleDays = (p) => {
    if (p.schedule_days && p.schedule_days.length) return p.schedule_days;
    const info = productRoutineInfo[p.id];
    if (info) return info.daily ? null : [...info.days];
    return null;
  };
  // adherenceFromDoneDates viene de pure.js (parametrizada — testeable).
  const productAdherence = (p) => adherenceFromDoneDates(productDoneDates(p), effectiveScheduleDays(p), WSTART, ENDS);
  const claimedNames = new Set(allProducts.map(p => p.name));
  const roleAdherence = (role) => {
    const products = allProducts.filter(p => hasRole(p, role));
    const results = products.map(p => ({ p, adh: productAdherence(p) })).filter(x => x.adh);
    const legacyDone = new Set();
    allAppsWithProd.forEach(({ r, rp }) => {
      if (rp.id || claimedNames.has(rp.name)) return;
      if (ROLE_CONFIG[role].legacyRegex(rp)) legacyDone.add(localDateOfISO(r.applied_at));
    });
    if (legacyDone.size) {
      const adh = adherenceFromDoneDates(legacyDone, null, WSTART, ENDS);
      if (adh) results.push({ p: { name: 'Registros antiguos', emoji: '🗂️' }, adh });
    }
    if (!results.length) return null;
    const pct = Math.round(results.reduce((a, x) => a + x.adh.pct, 0) / results.length);
    return { pct: Math.min(100, pct), detail: results };
  };
  // ── PROTECCIÓN SPF: puntuación por calidad (spfScoreOf vive en pure.js) ────
  // El ideal de aplicaciones se MODULA por la exposición solar registrada ese
  // día: exigir 5 reaplicaciones en un día de oficina no tiene sentido clínico
  // y castiga sin motivo. Reaplicar cada 2 h es el estándar para exposición
  // real, no para estar bajo techo.
  const IDEAL_SPF_APPS = 5;            // techo: día de playa / exposición máxima
  const IDEAL_SPF_BY_SUN = { interior: 2, normal: 3, alta: 4, playa: 5 };
  const IDEAL_SPF_DEFAULT = 3;         // sin nota ese día: se asume día normal
  // CUERPO: ideal mucho más bajo que cara. La piel corporal va cubierta por ropa
  // buena parte del tiempo y nadie reaplica protector corporal 5 veces al día.
  // `interior` vale 1 y no 0 porque traes brazos y escote descubiertos a diario
  // en Guadalajara (altitud + UV alto todo el año): incluso un día bajo techo
  // acumula UVA incidental, que es justo lo que pigmenta los brazos.
  // Si prefieres que los días de interior NO se evalúen, pon 0 aquí.
  const IDEAL_BODY_SPF_BY_SUN = { interior: 1, normal: 1, alta: 2, playa: 4 };
  const IDEAL_BODY_SPF_DEFAULT = 1;
  // Estado de piel y exposición solar por fecha (se usan más abajo también en
  // el heatmap y en la correlación).
  const skinByDate = {};
  const sunByDate = {};
  ((notesRes && notesRes.data) || []).forEach(r => {
    if (r.skin_state) skinByDate[r.note_date] = r.skin_state;
    if (r.sun_exposure) sunByDate[r.note_date] = r.sun_exposure;
  });
  const idealSpfAppsFor = ds => IDEAL_SPF_BY_SUN[sunByDate[ds]] || IDEAL_SPF_DEFAULT;
  const idealBodySpfAppsFor = ds => {
    const v = IDEAL_BODY_SPF_BY_SUN[sunByDate[ds]];
    return v == null ? IDEAL_BODY_SPF_DEFAULT : v;
  };
  const spfScoreById = {};
  allProducts.filter(p => p.category !== '💋 Labios' && hasRole(p, 'spf_facial'))
    .forEach(p => { spfScoreById[p.id] = spfScoreOf(p); });
  const spfPointsByDate = {};
  const spfAppsByDate = {};
  allAppsWithProd.forEach(({ r, rp }) => {
    let score = null;
    if (rp.id && spfScoreById[rp.id] != null) score = spfScoreById[rp.id];
    else if (!rp.id && !claimedNames.has(rp.name) && ROLE_CONFIG.spf_facial.legacyRegex(rp)) score = 60;
    if (score == null) return;
    const ds = localDateOfISO(r.applied_at);
    spfPointsByDate[ds] = (spfPointsByDate[ds] || 0) + score;
    spfAppsByDate[ds] = (spfAppsByDate[ds] || 0) + 1;
  });
  let prot = null;
  const spfDates = Object.keys(spfPointsByDate).sort();
  if (spfDates.length) {
    const start = spfDates[0] > WSTART ? spfDates[0] : WSTART;
    if (start <= ENDS) {
      let elig = 0, sumPct = 0, daysWithSpf = 0, totalPts = 0, totalApps = 0;
      eachDateStr(start, ENDS, (ds) => {
        elig++;
        const pts = spfPointsByDate[ds] || 0;
        if (pts > 0) daysWithSpf++;
        totalPts += pts;
        totalApps += spfAppsByDate[ds] || 0;
        sumPct += Math.min(100, Math.round(pts / (idealSpfAppsFor(ds) * 100) * 100));
      });
      if (elig > 0) {
        prot = {
          pct: Math.round(sumPct / elig),
          sub: `${daysWithSpf} de ${elig} días con SPF registrado · ideal: rutina AM + 4 reaplicaciones de máxima calidad`,
          elig, daysWithSpf,
          avgAppsPerDay: totalApps / elig,
          avgScorePerApp: totalApps > 0 ? totalPts / totalApps : 0
        };
      }
    }
  }
  const despig  = roleAdherence('despigmentacion');
  const barr    = roleAdherence('barrera');
  const rege    = roleAdherence('regeneracion_celular');
  const textura = roleAdherence('textura_poros');
  // ── DOSIS POR EJE DE RESULTADO (Fase B) ────────────────────────────────────
  // Mide ESTÍMULO ENTREGADO, no obediencia. Una aplicación cuenta completa
  // aunque no venga de un paso de rutina: es justo lo que la adherencia no veía.
  // La matemática (techo diario + ventana semanal) vive en pure.js.
  const dosePtsByDate = {};   // ds → { eje: puntos }
  // ── EJE = FUNCIÓN × ZONA ──────────────────────────────────────────────────
  // Reproduce EXACTAMENTE el naming de DOSE_AXES en activos-matriz.js. No es
  // decorativo: las claves se conservaron del modelo anterior para no invalidar
  // los techos recalibrados con datos reales, así que cualquier cambio aquí
  // tiene que ir acompañado del cambio allá.
  //   · cara      → sin prefijo ('textura', 'firmeza'…)
  //   · manos     → 'manos' para aclarado (histórico), 'manos_X' el resto
  //   · monofunción (pies/labios/cabello) → su propio nombre, y SOLO con su
  //     función: "firmeza de pies" no existe y devuelve null.
  // (ejeKey vive en el ámbito global — se usa también desde el filtro de Stock)
  // ── SOBRE-EXPOSICIÓN A IRRITANTES: SE RASTREA POR ZONA, NO GLOBAL ─────────
  // Antes era un solo mapa `ds → 1` que TODOS los ejes consultaban contra su
  // propio `diasIdeales`. Resultado: 5 noches de tretinoína facial hacían que
  // el eje `cabello` (diasIdeales 3) avisara "1 día de más con retinoide",
  // cuando ningún producto capilar es irritante. Aplicarte un retinoide en la
  // cara no dice nada sobre tu pelo.
  // Ahora el día se marca en la ZONA donde de verdad se aplicó, deducida de los
  // ejes que toca el producto, y solo el eje de renovación de esa zona avisa.
  // El cuello entra aquí porque su piel es MÁS fina que la de la cara: es donde
  // la tretinoína irrita primero. Dejarlo sin eje de aviso habría desprotegido
  // justo la zona más sensible.
  const EJE_IRRITANTE_POR_ZONA = { cara: 'textura', cuerpo: 'cuerpo_textura', cuello: 'cuello_textura', manos: 'manos_textura' };
  const irritantByDateZona = {};  // ds → { cara: 1, cuerpo: 1, cuello: 1 }
  allAppsWithProd.forEach(({ r, rp }) => {
    // MODELO FUNCIÓN × ZONA: el producto aporta la POTENCIA (qué hace) y el
    // registro aporta la ZONA (dónde se lo puso). El eje sale de combinarlos.
    const pot = rp.id ? PRODUCT_DOSE[rp.id] : null;
    if (!pot) return;
    const ds = localDateOfISO(r.applied_at);
    // ── DE DÓNDE SALE LA ZONA ────────────────────────────────────────────────
    // 1) `r.zones` — lo que marcaste al registrar. Dato real.
    // 2) PRODUCT_ZONAS — las zonas por defecto del producto.
    // El (2) NO es un parche: es lo que mantiene el HISTÓRICO intacto. Los
    // registros anteriores al refactor no traen zona, y con este fallback dan
    // exactamente los mismos puntos que daban antes — los porcentajes que ya
    // viste no se mueven.
    const zonas = (Array.isArray(r.zones) && r.zones.length)
      ? r.zones
      : (typeof PRODUCT_ZONAS !== 'undefined' ? (PRODUCT_ZONAS[rp.id] || []) : []);
    if (!zonas.length) return;
    if (!dosePtsByDate[ds]) dosePtsByDate[ds] = {};
    zonas.forEach(zona => {
      Object.keys(pot).forEach(funcion => {
        const ax = ejeKey(zona, funcion);
        // Combinación sin sentido (ej. "firmeza de pies"): ejeKey devuelve null
        // y se descarta en vez de inventar un eje.
        if (!ax || !DOSE_AXES[ax]) return;
        // null = protección: se toma spfScoreOf para no duplicar la calibración UVA.
        let v = pot[funcion] == null ? spfScoreOf(rp) : pot[funcion];
        if (funcion === 'proteccion') {
          // Los puntos se normalizan al ideal del día según exposición solar:
          // el techo diario sigue fijo (500 = 5 aplicaciones) pero cumplir 2 en
          // un día de interior ya vale el 100% de ese día.
          // Cara y CUELLO comparten el ideal facial: van igual de descubiertos.
          // Cuerpo y MANOS usan el ideal corporal, mucho más bajo — nadie
          // reaplica protector corporal 5 veces al día.
          const facial = (zona === 'cara' || zona === 'cuello' || zona === 'labios');
          const ideal = facial ? idealSpfAppsFor(ds) : idealBodySpfAppsFor(ds);
          if (ideal <= 0) return;  // día no evaluable (ej. interior en 0)
          v = v * (IDEAL_SPF_APPS / ideal);
        }
        dosePtsByDate[ds][ax] = (dosePtsByDate[ds][ax] || 0) + v;
      });
    });
    if (typeof IRRITANTES !== 'undefined' && IRRITANTES.has(rp.id)) {
      // El día irritante se marca en las zonas donde REALMENTE se aplicó, no en
      // todas las que el producto podría tocar. Aplicarte un ácido en el cuerpo
      // no debe disparar el aviso de la cara.
      zonas.forEach(zona => {
        if (!EJE_IRRITANTE_POR_ZONA[zona]) return;
        if (!irritantByDateZona[ds]) irritantByDateZona[ds] = {};
        irritantByDateZona[ds][zona] = 1;
      });
    }
  });
  // Semanas calendario lunes→domingo (mismas columnas que el heatmap).
  const doseWeeks = [];
  {
    const fw = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const e0 = new Date(ENDS + 'T12:00:00Z');
    const mon = new Date(e0); mon.setUTCDate(mon.getUTCDate() - ((e0.getUTCDay() + 6) % 7));
    for (let k = 11; k >= 0; k--) {
      const s = new Date(mon); s.setUTCDate(s.getUTCDate() - k * 7);
      const days = [];
      for (let i = 0; i < 7; i++) { const d = new Date(s); d.setUTCDate(d.getUTCDate() + i); days.push(fw(d)); }
      doseWeeks.push(days.filter(ds => ds <= ENDS));
    }
  }
  // Un eje solo se evalúa desde la primera semana con registro suyo: no se
  // castiga el tiempo anterior a empezar a usar ese tipo de producto.
  const doseAxis = (axKey) => {
    const cfg = DOSE_AXES[axKey];
    if (!cfg) return null;
    const weekly = doseWeeks.map(days => {
      if (!days.length) return null;
      const pts = days.map(ds => (dosePtsByDate[ds] || {})[axKey] || 0);
      if (!pts.some(p => p > 0)) return null;
      // La semana en curso está incompleta: se prorratea el ideal por los días
      // transcurridos. Si no, el lunes parecería un desplome del 90% al 10%.
      const idealDias = cfg.diasIdeales * (days.length / 7);
      return doseWeekPct(pts, cfg.techoDiario, idealDias);
    });
    const firstIdx = weekly.findIndex(w => w != null);
    if (firstIdx === -1) return null;
    const vivas = weekly.slice(firstIdx).map(w => w == null ? 0 : w);
    const pct = Math.round(vivas.reduce((a, b) => a + b, 0) / vivas.length);
    const ultimaSemana = doseWeeks[doseWeeks.length - 1] || [];
    // Solo el eje de renovación de cada zona puede avisar: es donde viven los
    // retinoides y los ácidos. Barrera, aclarado, firmeza, pies, manos y
    // cabello nunca avisan, porque ningún irritante actúa ahí.
    const esEjeDeAviso = EJE_IRRITANTE_POR_ZONA[cfg.zona] === axKey;
    const overDays = esEjeDeAviso
      ? overExposureDays(ultimaSemana.map(ds => (irritantByDateZona[ds] || {})[cfg.zona] || 0), cfg.diasIdeales)
      : 0;
    return { pct, weekly, overDays, cfg };
  };
  // Las listas de ejes se DERIVAN de DOSE_AXES por su `zona` — ya no se
  // escriben a mano (regla 5). Antes eran tres arrays literales y cada eje
  // nuevo había que acordarse de añadirlo al array correcto o quedaba
  // calculado pero invisible en Progreso, que es el fallo original de Fase B
  // reapareciendo en el render.
  // El orden dentro de cada zona sigue el de declaración en DOSE_AXES
  // (protección → aclarado → textura → barrera → firmeza), que es el mismo con
  // el que se leen las barras de la cara.
  const ejesDeZona = z => Object.keys(DOSE_AXES).filter(k => DOSE_AXES[k].zona === z);
  const dosisDe = zs => [].concat.apply([], zs.map(ejesDeZona))
    .map(k => ({ key: k, o: doseAxis(k) })).filter(x => x.o);
  const dosisCara = dosisDe(['cara']);
  // El cuello va en bloque propio y no mezclado con cuerpo: comparte las 5
  // funciones de la cara y se lee en paralelo con ella. Sepultado en una lista
  // de 14 barras no lo miraría nadie.
  const dosisCuello = dosisDe(['cuello']);
  // Labios va aquí y no con cara a propósito: el bermellón es tejido aparte y
  // sus productos no deben mover las métricas faciales.
  const dosisOtros = dosisDe(['cuerpo', 'manos', 'pies', 'labios', 'cabello']);
  // Se define aquí (y no junto al render) porque buildFocusHTML lo usa antes.
  const doseDiag = (key, o) => {
    if (o.overDays > 0) {
      return `Vas bien de dosis, pero tuviste ${o.overDays} día${o.overDays === 1 ? '' : 's'} de más con retinoide o ácido esta semana. Más no acelera resultados y sí irrita — espaciarlos rinde igual.`;
    }
    // Mensajes distintos por eje: si las 5 barras dicen lo mismo, se dejan de leer.
    if (o.pct >= 90) {
      const ALTO = {
        aclarado: 'Dosis despigmentante completa. Aquí el limitante ya no eres tú sino el tiempo: los resultados en manchas tardan 3–4 meses de uso sostenido en verse.',
        textura: 'Estás en el techo útil de renovación. Subir la frecuencia ya no acelera nada y sí arriesga irritación — mantener este ritmo es lo correcto.',
        barrera: 'Barrera bien sostenida. Esto no es cosmético: una barrera sana es lo que te permite tolerar la tretinoína y los ácidos sin descamarte.',
        firmeza: 'Buen estímulo de colágeno. La síntesis es lenta por biología — los cambios en firmeza se aprecian hacia los 4–6 meses.',
        cuerpo_textura: 'Dosis completa de exfoliación corporal. Más no mejora, y en cuerpo la piel también se irrita.',
        cuerpo_firmeza: 'Buen estímulo de firmeza corporal. Sostenerlo es lo que cuenta.',
        cuerpo_barrera: 'Hidratación corporal bien cubierta.',
        pies: 'Dosis queratolítica completa. Si ya no ves grietas, puedes bajar a mantenimiento.',
        cabello: 'Uso constante. El folículo responde lento: dale meses.',
        manos: 'Dosis despigmentante completa en manos y brazos. Igual que en cara, el ácido kójico y similares tardan meses en aclarar manchas ya formadas — lo importante es sostenerlo.',
        manos_proteccion: 'Reaplicación de SPF en manos completa. Las manos son de las zonas que más rápido muestran manchas nuevas por exposición incidental (manejar, caminar) — sostener esto protege el trabajo que hace tu crema despigmentante.',
        labios: 'Labios bien cubiertos. Es tejido sin apenas melanina y con la barrera más fina del cuerpo, así que el bálsamo con SPF hace aquí más trabajo del que parece.',
        cuello_proteccion: 'Cuello cubierto cada vez que te proteges la cara. Es la zona donde más se nota el descuido a largo plazo: la poiquilodermia de Civatte es exactamente eso, años de sol en cuello y escote.',
        cuello_aclarado: 'Buena dosis despigmentante en cuello. Aquí los resultados tardan más que en la cara — la piel es más fina pero también responde más lento a los aclarantes.',
        cuello_textura: 'Renovación de cuello en su techo útil. Ojo: es piel más delgada que la de la cara, así que si notas escozor o descamación, baja frecuencia aunque el número diga que vas bien.',
        cuello_barrera: 'Cuello bien hidratado. Importa más de lo que parece: tiene menos glándulas sebáceas que la cara y se reseca antes.',
        cuello_firmeza: 'Buen estímulo de colágeno en cuello. Es donde la flacidez se ve primero, así que sostener esto vale mucho.'
      };
      return ALTO[key] || 'Estás entregando prácticamente todo el estímulo útil. Más producto no suma: lo que queda es sostenerlo.';
    }
    if (key === 'proteccion') {
      return `El ideal se ajusta a tu exposición del día: ${IDEAL_SPF_BY_SUN.interior} aplicaciones en interior, ${IDEAL_SPF_BY_SUN.normal} en un día normal, ${IDEAL_SPF_BY_SUN.playa} en playa. Reaplicar es lo que más sube esta barra — mucho más que cambiar de producto: a tu ritmo actual, un protector 15 puntos mejor te daría +6, y dos aplicaciones extra te dan +34.`;
    }
    if (key === 'cuerpo_proteccion') {
      return `Brazos y escote acumulan UVA aunque no tomes sol. El ideal aquí es bajo (${IDEAL_BODY_SPF_BY_SUN.interior} aplicación en día normal, ${IDEAL_BODY_SPF_BY_SUN.playa} en playa): con ponerte protector corporal en la mañana casi cubres el día.`;
    }
    if (key === 'manos_proteccion') {
      return `Mismo ideal que cuerpo (${IDEAL_BODY_SPF_BY_SUN.interior} aplicación en día normal, ${IDEAL_BODY_SPF_BY_SUN.playa} en playa) — usa cualquiera de tus protectores registrados como "(Manos)" cuando reapliques en el dorso de las manos.`;
    }
    if (key === 'cuello_proteccion') {
      return `Se registra solo: cada protector que te aplicas en la cara cuenta también aquí, porque lo extiendes al cuello. Si esta barra está baja es por lo mismo que la de la cara — falta reaplicar, no falta producto.`;
    }
    if (key === 'cuello_firmeza') {
      return `El cuello pierde soporte antes que la cara y es lo primero que delata la edad. Tus péptidos y la tretinoína ya llegan aquí cuando los extiendes; sumar la crema de cuello en las noches que no toca retinoide es lo que más mueve esta barra.`;
    }
    if (key === 'cuello_textura') {
      return `Piel más fina que la de la cara: aquí los retinoides y ácidos irritan antes. Subir la frecuencia rinde, pero si aparece escozor o descamación conviene espaciar aunque el número lo permita.`;
    }
    if (key === 'labios') {
      return `Los labios casi no tienen melanina y su barrera es de 3–5 capas contra las 15–20 de la cara: es donde el sol pega más directo. Reaplicar el bálsamo con SPF cuenta igual que reaplicar en cara — es el mismo gesto de un segundo.`;
    }
    if (o.pct >= 60) return `Buen nivel. Para cerrar la brecha, subir la frecuencia rinde más que agregar productos nuevos.`;
    if (o.pct >= 30) return `Estímulo parcial: los productos que tienes alcanzan, falta constancia en los días.`;
    return `Casi sin estímulo en este eje. Revisa si tienes producto en Stock que lo cubra.`;
  };
  // ── TENDENCIA SEMANAL: 12 cubetas de 7 días terminando ayer ────────────────
  // Las barras grandes son el promedio de 90 días (una foto); estas mini
  // barras dicen si vas mejorando o empeorando semana a semana.
  const weekBuckets = [];
  {
    const f = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    for (let k = 11; k >= 0; k--) {
      const endD = new Date(ENDS + 'T12:00:00Z'); endD.setUTCDate(endD.getUTCDate() - k * 7);
      const startD = new Date(endD); startD.setUTCDate(startD.getUTCDate() - 6);
      weekBuckets.push({ start: f(startD), end: f(endD) });
    }
  }
  const roleWeekly = (role) => weekBuckets.map(b => {
    const pcts = allProducts.filter(p => hasRole(p, role))
      .map(p => adherenceFromDoneDates(productDoneDates(p), effectiveScheduleDays(p), b.start, b.end))
      .filter(Boolean).map(a => a.pct);
    return pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null;
  });
  const spfWeekly = () => weekBuckets.map(b => {
    if (!spfDates.length) return null;
    const first = spfDates[0];
    if (first > b.end) return null;
    let elig = 0, sum = 0;
    eachDateStr(first > b.start ? first : b.start, b.end, ds => {
      elig++;
      sum += Math.min(100, Math.round((spfPointsByDate[ds] || 0) / (idealSpfAppsFor(ds) * 100) * 100));
    });
    return elig ? Math.round(sum / elig) : null;
  });
  const sparkHTML = (weeks, color) => {
    if (!weeks.some(w => w != null)) return '';
    return `<div class="spark">${weeks.map(w =>
      w == null ? '<span class="spark-empty"></span>'
        : `<span class="spark-bar" style="height:${Math.max(8, w)}%;background:${color}" title="${w}%"></span>`
    ).join('')}</div><div class="spark-lbl">tendencia · últimas 12 semanas</div>`;
  };
  const melasmaProducts = allProducts.filter(p => hasRole(p, 'despigmentacion') || hasRole(p, 'regeneracion_celular'));
  let melStart = null;
  melasmaProducts.forEach(p => {
    const done = productDoneDates(p);
    if (done.size) { const first = [...done].sort()[0]; if (!melStart || first < melStart) melStart = first; }
  });
  let weekNum = 1;
  if (melStart && melStart <= ENDS) { let n = 0; eachDateStr(melStart, ENDS, () => n++); weekNum = Math.floor(n / 7) + 1; }
  const journeyPct = Math.min(100, Math.round(weekNum / 16 * 100));
  const constVals = [prot, despig, barr, rege].map(x => x ? x.pct : null).filter(x => x != null);
  const constancia = constVals.length ? Math.round(constVals.reduce((a, b) => a + b, 0) / constVals.length) : null;
  // ── RUTINA COMPLETA ────────────────────────────────────────────────────────
  const stepsByRoutineId = {};
  ((allStepsRes && allStepsRes.data) || []).forEach(s => {
    if (!stepsByRoutineId[s.routine_id]) stepsByRoutineId[s.routine_id] = [];
    stepsByRoutineId[s.routine_id].push(s.id);
  });
  const routinesForSection = key => ((routinesRes && routinesRes.data) || [])
    .filter(r => r.section_key === key)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const amRoutinesAll = routinesForSection('am');
  const pmRoutinesAll = routinesForSection('pm');
  const bodyRoutinesAll = routinesForSection('body');
  const feetRoutinesAll = routinesForSection('feet');
  const routineAppliesOnDow = (r, dow) => !r.schedule_days || !r.schedule_days.length || r.schedule_days.includes(dow);
  const doneStepsByDate = {};
  apps.forEach(r => {
    if (r.source !== 'rutina' || !r.routine_step_id) return;
    const ds = localDateOfISO(r.applied_at);
    if (!doneStepsByDate[ds]) doneStepsByDate[ds] = new Set();
    doneStepsByDate[ds].add(r.routine_step_id);
  });
  const bySectionSum = { am: { hit: 0, total: 0 }, pm: { hit: 0, total: 0 }, body: { hit: 0, total: 0 }, feet: { hit: 0, total: 0 } };
  const dailyRoutinePct = {}; // ds → fracción 0..1 de pasos hechos ese día (para el heatmap)
  let routineSumPct = 0, routineElig = 0;
  const haveAnyRoutineData = ((routinesRes && routinesRes.data) || []).length > 0;
  if (haveAnyRoutineData && WSTART <= ENDS) {
    eachDateStr(WSTART, ENDS, (ds, dow) => {
      const amR = amRoutinesAll.find(r => routineAppliesOnDow(r, dow));
      const pmR = pmRoutinesAll.find(r => routineAppliesOnDow(r, dow));
      const bodyRs = bodyRoutinesAll.filter(r => routineAppliesOnDow(r, dow));
      const feetRs = feetRoutinesAll.filter(r => routineAppliesOnDow(r, dow));
      const done = doneStepsByDate[ds] || new Set();
      let dayTotal = 0, dayHit = 0;
      const tally = (sectionKey, routinesForDay) => {
        let total = 0, hit = 0;
        routinesForDay.forEach(r => {
          (stepsByRoutineId[r.id] || []).forEach(stepId => {
            total++;
            if (done.has(stepId)) hit++;
          });
        });
        if (total > 0) { bySectionSum[sectionKey].total += total; bySectionSum[sectionKey].hit += hit; }
        dayTotal += total; dayHit += hit;
      };
      tally('am', amR ? [amR] : []);
      tally('pm', pmR ? [pmR] : []);
      tally('body', bodyRs);
      tally('feet', feetRs);
      if (dayTotal > 0) {
        routineElig++;
        routineSumPct += Math.round(dayHit / dayTotal * 100);
        dailyRoutinePct[ds] = dayHit / dayTotal;
      }
    });
  }
  const routineCompletePct = routineElig > 0 ? Math.round(routineSumPct / routineElig) : null;
  const sectionPct = key => bySectionSum[key].total > 0 ? Math.round(bySectionSum[key].hit / bySectionSum[key].total * 100) : null;
  const routineBreakdown = { am: sectionPct('am'), pm: sectionPct('pm'), body: sectionPct('body'), feet: sectionPct('feet') };
  const diagnosisText = (key, label, o) => {
    if (o.pct >= 90) return `Vas muy bien aquí — arriba de 90%. Sigue así.`;
    if (key === 'spf_facial') {
      if (o.elig > 0 && o.daysWithSpf / o.elig < 0.8) {
        return `Te faltó protector solar por completo en ${o.elig - o.daysWithSpf} de los últimos ${o.elig} días — asegurar que SIEMPRE te pongas algo, aunque sea el más sencillo, es lo que más va a subir esta barra.`;
      } else if (o.avgAppsPerDay < 2.5) {
        return `Te pones protector casi todos los días, pero en promedio solo ${o.avgAppsPerDay.toFixed(1)} veces al día (el ideal son 5: rutina AM + 4 reaplicaciones). Reforzar las reaplicaciones durante el día es tu mayor oportunidad.`;
      } else if (o.avgScorePerApp < 70) {
        return `Aplicas seguido, pero con protectores de menor puntuación en promedio. Usa más seguido los que tienen PA++++, UVA 400/Mexoryl o tinte para subir el %.`;
      }
      return `Cerca del 100% — sigue reforzando la constancia diaria.`;
    }
    const detail = (o.detail || []).filter(x => x.p.name !== 'Registros antiguos');
    if (detail.length) {
      const worstProduct = detail.reduce((a, b) => (b.adh.pct < a.adh.pct ? b : a));
      return `El que más se te dificulta es ${prodLabelHTML(worstProduct.p)} (${worstProduct.adh.pct}%) — reforzarlo es tu mayor oportunidad aquí.`;
    }
    return `Estás en ${o.pct}% — sigue registrando para ver más detalle.`;
  };
  const adhRow = (o, color, icon, label, key, spark) => {
    if (!o) return `<div class="adh-row"><div class="adh-top"><span class="adh-name"><span class="adh-ic">${icon}</span>${label}</span><span class="adh-val" style="color:#A09090">—</span></div><div class="adh-sub">Aún sin registros hasta ayer</div></div>`;
    const sub = diagnosisText(key, label, o);
    return `<div class="adh-row">
  <div class="adh-top"><span class="adh-name"><span class="adh-ic">${icon}</span>${label}</span><span class="adh-val" style="color:${color}">${o.pct}%</span></div>
  <div class="adh-track"><div class="adh-fill" style="width:${o.pct}%;background:${color}"></div></div>
  <div class="adh-sub">${sub}</div>
  ${spark || ''}
</div>`;
  };
  const mileDots = [25, 50, 75, 100].map(p => `<span class="pj-dot${journeyPct >= p ? ' on' : ''}" style="left:${p}%"></span>`).join('');
  const focusRoles = [
    { label: 'Protección solar', icon: '🛡️', key: 'spf_facial', o: prot },
    { label: 'Despigmentación',         icon: '🎯', key: 'despigmentacion', o: despig },
    { label: 'Barrera sana',            icon: '💧', key: 'barrera', o: barr },
    { label: 'Renovación celular',      icon: '🔬', key: 'regeneracion_celular', o: rege },
    { label: 'Textura / Poros',         icon: '🔍', key: 'textura_poros', o: textura }
  ];
  const buildFocusHTML = () => {
    // Prioridad: el eje de DOSIS más bajo. La adherencia solo se usa como
    // respaldo si todavía no hay datos de dosis — señala el estímulo que le
    // falta a la piel, no el paso de rutina que se saltó.
    if (dosisCara.length) {
      const sobre = dosisCara.find(x => x.o.overDays > 0);
      if (sobre) {
        return `<div class="focus-card">
  <div class="focus-card-title">⚠️ Cuidado: ${esc(sobre.o.cfg.label)}</div>
  <div class="focus-card-text">${doseDiag(sobre.key, sobre.o)}</div>
</div>`;
      }
      const peor = dosisCara.reduce((a, b) => (b.o.pct < a.o.pct ? b : a));
      if (peor.o.pct >= 90) {
        return `<div class="focus-card good">
  <div class="focus-card-title">✅ Vas muy bien</div>
  <div class="focus-card-text">Estás entregando prácticamente todo el estímulo útil en cada eje. No hay nada que reforzar ahora mismo — sigue así.</div>
</div>`;
      }
      return `<div class="focus-card">
  <div class="focus-card-title">${peor.o.cfg.icon} Enfócate en: ${esc(peor.o.cfg.label)}</div>
  <div class="focus-card-text">${doseDiag(peor.key, peor.o)}</div>
</div>`;
    }
    const withData = focusRoles.filter(r => r.o && r.o.pct != null);
    if (!withData.length) return '';
    const worst = withData.reduce((a, b) => (b.o.pct < a.o.pct ? b : a));
    if (worst.o.pct >= 90) {
      return `<div class="focus-card good">
  <div class="focus-card-title">✅ Vas muy bien</div>
  <div class="focus-card-text">Todas tus barras están arriba de 90%. No hay nada puntual que reforzar ahora mismo — sigue así.</div>
</div>`;
    }
    const text = diagnosisText(worst.key, worst.label, worst.o);
    return `<div class="focus-card">
  <div class="focus-card-title">${worst.icon} Enfócate en: ${worst.label}</div>
  <div class="focus-card-text">${text}</div>
</div>`;
  };
  const focusHTML = buildFocusHTML();
  // ── HEATMAP DE CONSTANCIA (12 semanas, estilo GitHub) ──────────────────────
  // skinByDate / sunByDate se construyen arriba, junto al cálculo de SPF, que
  // los necesita para modular el ideal diario por exposición solar.
  const heatHTML = (() => {
    // El title solo sirve con mouse; en móvil el detalle se muestra al TOCAR
    // el cuadro (showHeatDay), en la caja bajo el grid.
    _heatDayInfo = {};
    const DOW_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    // Columnas propias del heatmap: semanas de CALENDARIO lunes→domingo, para
    // que la primera fila siempre sea lunes. (No se usa `weekBuckets`, que son
    // ventanas móviles de 7 días y harían rotar las filas según el día de hoy.)
    const HEAT_WEEKS = 12;
    const _fUTC = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const _endD = new Date(ENDS + 'T12:00:00Z');
    // Lunes de la semana que contiene ENDS (getUTCDay: 0=Dom → retroceder 6).
    const _lastMon = new Date(_endD);
    _lastMon.setUTCDate(_lastMon.getUTCDate() - ((_endD.getUTCDay() + 6) % 7));
    const heatCols = [];
    for (let k = HEAT_WEEKS - 1; k >= 0; k--) {
      const s = new Date(_lastMon); s.setUTCDate(s.getUTCDate() - k * 7);
      const e = new Date(s); e.setUTCDate(e.getUTCDate() + 6);
      heatCols.push({ start: _fUTC(s), end: _fUTC(e) });
    }
    // Filas fijas: lunes → domingo.
    const rowDows = [1, 2, 3, 4, 5, 6, 0];
    const dayColHTML = '<div class="heat-daycol">' +
      rowDows.map(dw => `<div class="heat-daylabel">${DOW_ES[dw]}</div>`).join('') +
      '</div>';
    // Etiquetas de COLUMNA (mes): se muestra el mes solo cuando cambia.
    let _prevMonth = null;
    const monthRowHTML = '<div class="heat-months">' +
      heatCols.map(b => {
        const m = new Date(b.start + 'T12:00:00Z').getUTCMonth();
        let lbl = '';
        if (m !== _prevMonth) { lbl = MONTHS[m].slice(0, 3); _prevMonth = m; }
        return `<div class="heat-monthlabel">${lbl}</div>`;
      }).join('') +
      '</div>';
    const cols = heatCols.map(b => {
      const cells = [];
      eachDateStr(b.start, b.end, (ds, dow) => {
        // Días futuros de la semana en curso: hueco invisible que mantiene la
        // rejilla alineada sin fingir que hay dato.
        if (ds > ENDS) { cells.push('<div class="heat-cell heat-cell-void"></div>'); return; }
        const p = dailyRoutinePct[ds];
        let bg = '#F0ECE7';
        if (p != null) bg = `rgba(40,120,72,${(0.15 + p * 0.85).toFixed(2)})`;
        const pctTxt = p != null ? `📋 ${Math.round(p * 100)}% de rutina completada` : '📋 sin registros de rutina';
        const skin = skinByDate[ds] ? ` · 🙂 piel ${skinByDate[ds]}/5` : '';
        const sun = sunByDate[ds] ? ` · ☀️ sol: ${sunByDate[ds]}` : '';
        // Un día con hito lleva marca visible y su texto en el detalle.
        const hitos = hitosByDate[ds] || [];
        const hitoTxt = hitos.length
          ? `<div class="heat-detail-hito">${hitos.map(h => esc(h)).join('<br>')}</div>` : '';
        _heatDayInfo[ds] = `<strong>${DOW_ES[dow]} ${fmtDate(ds)}</strong><br>${pctTxt}${skin}${sun}${hitoTxt}`;
        cells.push(`<div class="heat-cell${hitos.length ? ' heat-cell-hito' : ''}" style="background:${bg}" onclick="showHeatDay('${ds}', this)"></div>`);
      });
      return `<div class="heat-col">${cells.join('')}</div>`;
    }).join('');
    return `<div class="heat-card">
  <div class="heat-title">🗓️ Constancia diaria · últimas 12 semanas</div>
  <div class="heat-monthsrow"><div class="heat-daycol-spacer"></div>${monthRowHTML}</div>
  <div class="heat-body">${dayColHTML}<div class="heat-grid">${cols}</div></div>
  <div class="heat-detail" id="heat-day-detail" style="display:none"></div>
  <div class="heat-legend">menos <span class="box" style="background:#F0ECE7"></span><span class="box" style="background:rgba(40,120,72,0.35)"></span><span class="box" style="background:rgba(40,120,72,0.65)"></span><span class="box" style="background:rgba(40,120,72,1)"></span> más · toca un día para ver el detalle${Object.keys(hitosByDate).length ? ' · <span class="heat-legend-hito"></span> día con hito' : ''}</div>
</div>`;
  })();
  // ── RACHAS (días seguidos, contando hacia atrás desde ayer) ────────────────
  const _dsOfUTC = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const streakOf = (hasDay) => {
    let n = 0;
    for (let k = 0; k < 365; k++) {
      const d = new Date(ENDS + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - k);
      if (hasDay(_dsOfUTC(d))) n++; else break;
    }
    return n;
  };
  let spfStreak = streakOf(ds => (spfPointsByDate[ds] || 0) > 0);
  if (spfPointsByDate[TODAY_STR]) spfStreak += 1; // hoy ya cuenta si registraste
  const routineStreak = streakOf(ds => (dailyRoutinePct[ds] || 0) >= 0.8);
  const streakCard = (icon, n, name) => {
    const cls = n >= 7 ? ' hot' : (n >= 3 ? ' warm' : '');
    return `<div class="streak-card${cls}">
  <div class="streak-icon">${icon}</div>
  <div class="streak-num${cls}">${n}</div>
  <div class="streak-days-lbl">día${n === 1 ? '' : 's'} seguidos</div>
  <div class="streak-name">${name}</div>
</div>`;
  };
  const streaksHTML = `<div class="streak-grid">${streakCard('🛡️', spfStreak, 'con SPF registrado')}${streakCard('📋', routineStreak, 'rutina ≥80% completa')}</div>`;
  // ── CORRELACIÓN: cómo amanece tu piel según qué usaste la víspera ─────────
  const nextDayStr = ds => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return _dsOfUTC(d); };
  const tretDates = new Set(), exfoDates = new Set();
  allAppsWithProd.forEach(({ r, rp }) => {
    const ds = localDateOfISO(r.applied_at);
    if (hasRole(rp, 'regeneracion_celular')) tretDates.add(ds);
    if (rp.category === '🫧 Exfoliantes' || /glic[oó]lico|salic[ií]|mandel|l[aá]ctico|\baha\b|\bbha\b/i.test(rp.name || '')) exfoDates.add(ds);
  });
  const avgSkinAfter = (dates) => {
    const vals = [];
    dates.forEach(ds => { const s = skinByDate[nextDayStr(ds)]; if (s) vals.push(s); });
    return vals.length ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
  };
  const skinDays = Object.keys(skinByDate);
  const skinAvg = skinDays.length ? skinDays.reduce((a, ds) => a + skinByDate[ds], 0) / skinDays.length : null;
  const afterTret = avgSkinAfter(tretDates);
  const afterExfo = avgSkinAfter(exfoDates);
  let corrHTML = '';
  if (skinAvg != null && (afterTret || afterExfo)) {
    const corrRow = (icon, label, o) => o
      ? `<div class="corr-row"><span>${icon} ${label}</span><span style="font-weight:800;color:${o.avg < skinAvg - 0.4 ? '#C43020' : (o.avg > skinAvg + 0.2 ? '#287848' : '#4A3E3A')}">${o.avg.toFixed(1)}/5 <span style="font-weight:400;color:#A09090;font-size:10.5px">(${o.n} día${o.n === 1 ? '' : 's'})</span></span></div>`
      : '';
    const corrNote =
      (afterTret && afterTret.n >= 3 && afterTret.avg < skinAvg - 0.5) ? '⚠️ Tu piel amanece notablemente peor tras noches de tretinoína/retinol — coméntalo con tu derma (bajar frecuencia o técnica sandwich con hidratante).' :
      (afterExfo && afterExfo.n >= 3 && afterExfo.avg < skinAvg - 0.5) ? '⚠️ Tu piel amanece peor tras noches de exfoliante — considera espaciarlas más.' :
      '✅ Por ahora ningún activo muestra impacto negativo claro en cómo amanece tu piel.';
    corrHTML = `<div class="adh-label">Piel al día siguiente · según qué usaste la víspera</div>
<div class="adh-card">
  <div class="corr-row"><span>📊 Tu promedio general</span><span style="font-weight:800">${skinAvg.toFixed(1)}/5</span></div>
  ${corrRow('🔬', 'Tras tretinoína/retinol', afterTret)}
  ${corrRow('🫧', 'Tras exfoliante', afterExfo)}
  <div class="adh-sub" style="margin-top:8px">${corrNote} Entre más días registres tu estado de piel, más confiable se vuelve esto.</div>
</div>`;
  }
  // Datos que reutiliza el reporte para la dermatóloga.
  lastReportData = { prot, despig, barr, rege, textura, constancia, weekNum, melStart };
  const routineRow = (pct, color, icon, label, sub) => {
    if (pct == null) return `<div class="adh-row"><div class="adh-top"><span class="adh-name"><span class="adh-ic">${icon}</span>${label}</span><span class="adh-val" style="color:#A09090">—</span></div><div class="adh-sub">Sin rutinas programadas en la ventana o aún sin registros.</div></div>`;
    return `<div class="adh-row">
  <div class="adh-top"><span class="adh-name"><span class="adh-ic">${icon}</span>${label}</span><span class="adh-val" style="color:${color}">${pct}%</span></div>
  <div class="adh-track"><div class="adh-fill" style="width:${pct}%;background:${color}"></div></div>
  <div class="adh-sub">${sub}</div>
</div>`;
  };
  // ── RENDER: ESTÍMULO ENTREGADO (dosis) ─────────────────────────────────────
  const doseRow = ({ key, o }) => {
    const c = o.cfg;
    const spark = sparkHTML(o.weekly, c.color);
    const warn = o.overDays > 0 ? ` <span class="dose-warn">⚠️ ${o.overDays}d de más</span>` : '';
    return `<div class="adh-row">
  <div class="adh-top"><span class="adh-name"><span class="adh-ic">${c.icon}</span>${esc(c.label)}${warn}</span><span class="adh-val" style="color:${c.color}">${o.pct}%</span></div>
  <div class="adh-track"><div class="adh-fill" style="width:${o.pct}%;background:${c.color}"></div></div>
  <div class="adh-sub">${doseDiag(key, o)}</div>
  ${spark || ''}
</div>`;
  };
  const dosisHTML = dosisCara.length ? `
<div class="adh-label">💪 Estímulo entregado · últimas 12 semanas</div>
<div class="adh-card">
  <div class="dose-intro">Mide la <strong>dosis de activos que tu piel recibió</strong>, no si seguiste una rutina. Una aplicación cuenta completa aunque la hagas fuera de rutina. Pasarse del ideal no baja el número — se avisa aparte.</div>
  ${dosisCara.map(doseRow).join('')}
</div>` : '';
  const dosisCuelloHTML = dosisCuello.length ? `
<div class="adh-label">🦢 Cuello y escote</div>
<div class="adh-card">
  <div class="dose-intro">Zona propia: la piel del cuello es más fina que la de la cara y envejece antes. Cuenta lo que te aplicas <strong>solo ahí</strong> más lo que extiendes desde la cara — estos últimos puntúan algo menos porque el mismo producto cubre el triple de superficie. El protector solar se registra solo, junto con el de la cara.</div>
  ${dosisCuello.map(doseRow).join('')}
</div>` : '';
  const dosisOtrosHTML = dosisOtros.length ? `
<div class="adh-label">🧴 Cuerpo, pies, cabello, manos y labios</div>
<div class="adh-card">${dosisOtros.map(doseRow).join('')}</div>` : '';
  const ROUTINE_COLOR = '#6B7FA0';
  const routineHTML = `
<div class="adh-label">Rutina completa · últimos 90 días</div>
<div class="adh-card">
  ${routineRow(routineCompletePct, ROUTINE_COLOR, '📋', 'General', 'Promedio de pasos de rutina marcados como hechos cada día, en las 4 secciones. No es específico de melasma.')}
  ${routineRow(routineBreakdown.am, ROUTINE_COLOR, '☀️', 'Mañana', 'Pasos de tu rutina AM completados.')}
  ${routineRow(routineBreakdown.pm, ROUTINE_COLOR, '🌙', 'Noche', 'Pasos de tu rutina PM completados.')}
  ${routineRow(routineBreakdown.body, ROUTINE_COLOR, '🧴', 'Cuerpo', 'Pasos de tu(s) rutina(s) de cuerpo completados.')}
  ${routineRow(routineBreakdown.feet, ROUTINE_COLOR, '🦶', 'Pies', 'Pasos de tu rutina de pies completados.')}
</div>`;
  el.innerHTML = `
${streaksHTML}
<div class="pj-card">
  <div class="pj-top">
    <span class="pj-title">🗺️ Tu camino · manchas solares</span>
    ${constancia != null ? `<span class="pj-const">constancia ${constancia}%</span>` : ''}
  </div>
  <div class="pj-week">Semana ${weekNum > 16 ? '16+' : weekNum} de 16${melStart ? ` · desde ${fmtDate(melStart)}` : ''}</div>
  <div class="pj-track"><div class="pj-fill" style="width:${journeyPct}%"></div>${mileDots}</div>
  <div class="pj-miles"><span>Barrera</span><span>Brillo</span><span>Aclaran</span><span>Visible</span></div>
  <div class="pj-note">${melStart ? `Cuenta desde tu primer registro de un producto de despigmentación o renovación celular (${fmtDate(melStart)}), no desde que abriste la app. ` : ''}Calculado al cierre de ayer. Los hitos son una guía, no una promesa médica.</div>
</div>
<button class="report-btn" onclick="openDermReport()">📄 Generar reporte para dermatóloga</button>
<button class="report-btn" onclick="openModal('guide-modal')">📖 Guía: manchas solares y procedimientos</button>
${focusHTML}
${heatHTML}
${dosisHTML}
${dosisCuelloHTML}
${dosisOtrosHTML}
${corrHTML}
<details class="adh-secondary">
  <summary class="adh-secondary-sum">📋 Adherencia a rutinas · vista secundaria</summary>
  <div class="adh-secondary-note">Esto mide si <em>seguiste el plan</em>, no cuánto estímulo recibió tu piel. Se conserva para revisar hábitos, pero el número que importa para resultados es el de arriba.</div>
  <div class="adh-label">Adherencia · últimos 90 días</div>
  <div class="adh-card">
    ${adhRow(prot, '#C4818A', '🛡️', 'Protección solar', 'spf_facial', sparkHTML(spfWeekly(), '#C4818A'))}
    ${adhRow(despig, '#C47A00', '🎯', 'Despigmentación', 'despigmentacion', sparkHTML(roleWeekly('despigmentacion'), '#C47A00'))}
    ${adhRow(barr, '#3A8A7A', '💧', 'Barrera sana', 'barrera', sparkHTML(roleWeekly('barrera'), '#3A8A7A'))}
    ${adhRow(rege, '#7E6BB0', '🔬', 'Renovación celular', 'regeneracion_celular', sparkHTML(roleWeekly('regeneracion_celular'), '#7E6BB0'))}
  </div>
  <div class="adh-label">Textura de piel · últimos 90 días</div>
  <div class="adh-card">
    ${adhRow(textura, '#5B8FA8', '🔍', 'Textura / Poros', 'textura_poros', sparkHTML(roleWeekly('textura_poros'), '#5B8FA8'))}
  </div>
  ${routineHTML}
</details>`;
  histApps = apps;
  renderHistorial();
  historyLoaded = true;
}
// ── HISTORIAL CON FILTRO POR PRODUCTO ────────────────────────────────────────
let histApps = [];
let histFilter = '';
let histCatFilter = '';
// Categoría de un registro: por product_id; para registros viejos sin id,
// se intenta resolver por nombre.
function categoryOfApp(r) {
  let p = r.product_id ? allProducts.find(x => x.id === r.product_id) : null;
  if (!p) {
    const pid = productIdForLoggedName(r.product_name);
    p = pid ? allProducts.find(x => x.id === pid) : null;
  }
  return p ? p.category : null;
}
function renderHistorial() {
  const logEl = document.getElementById('log-content');
  if (!logEl) return;
  // Filtro 1: tipo de producto (categoría). Filtro 2: producto específico —
  // la lista de productos se acota a la categoría elegida.
  const catOrder = c => { const i = PRODUCT_CATEGORIES.indexOf(c); return i === -1 ? 999 : i; };
  const cats = [...new Set(histApps.map(categoryOfApp).filter(Boolean))].sort((a, b) => catOrder(a) - catOrder(b));
  const byCat = histCatFilter ? histApps.filter(r => categoryOfApp(r) === histCatFilter) : histApps;
  const names = [...new Set(byCat.map(r => r.product_name))].sort((a, b) => a.localeCompare(b));
  if (histFilter && !names.includes(histFilter)) histFilter = '';
  const catOptions = '<option value="">— Todos los tipos —</option>' +
    cats.map(c => `<option value="${esc(c)}"${c === histCatFilter ? ' selected' : ''}>${esc(c)}</option>`).join('');
  const prodOptions = '<option value="">— Todos los productos —</option>' +
    names.map(n => `<option value="${esc(n)}"${n === histFilter ? ' selected' : ''}>${esc(loggedLabelText(n))}</option>`).join('');
  const filtered = histFilter ? byCat.filter(r => r.product_name === histFilter) : byCat;
  logEl.innerHTML = `<div class="logs-card"><h3>📋 Historial de aplicaciones</h3>
<button class="mini-action-btn" onclick="exportBackup()">⬇️ Exportar respaldo (JSON + CSV)</button>
<select class="prod-input prod-select hist-filter" onchange="histCatFilter=this.value; renderHistorial()">${catOptions}</select>
<select class="prod-input prod-select hist-filter" onchange="histFilter=this.value; renderHistorial()">${prodOptions}</select>
${buildHistorialByDay(filtered)}</div>`;
}
// ── EDITAR REGISTRO (antes solo se podía borrar y volver a crear) ────────────
function openEditApplication(id) {
  const r = histApps.find(x => x.id === id);
  if (!r) { showToast('⚠️ No encontré el registro', 'error'); return; }
  document.getElementById('ea-id').value = id;
  const sel = document.getElementById('ea-product');
  sel.innerHTML = allProducts.map(p => {
    const logName = p.logged_as || `${p.emoji} ${p.name}`;
    return `<option value="${p.id}"${logName === r.product_name ? ' selected' : ''}>${esc(prodLabelText(p))}</option>`;
  }).join('');
  const d = new Date(r.applied_at);
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('ea-datetime').value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  openModal('edit-app-modal');
}
async function saveEditedApplication() {
  const id = document.getElementById('ea-id').value;
  const pid = document.getElementById('ea-product').value;
  const dtv = document.getElementById('ea-datetime').value;
  const prod = allProducts.find(p => p.id === pid);
  if (!prod || !dtv) { showToast('⚠️ Completa producto y fecha', 'error'); return; }
  const d = new Date(dtv);
  if (isNaN(d.getTime())) { showToast('⚠️ Fecha inválida', 'error'); return; }
  const { error } = await db.from('product_applications').update({
    product_id: prod.id,
    product_name: prod.logged_as || `${prod.emoji} ${prod.name}`,
    applied_at: d.toISOString()
  }).eq('id', id);
  closeModal('edit-app-modal');
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  showToast('✅ Registro actualizado', 'success');
  historyLoaded = false;
  await loadHistory();
  await loadTodayRoutines(TODAY_STR);
  await loadTodayApplications();
}
// ── EXPORTAR RESPALDO (independencia de Supabase) ────────────────────────────
async function exportBackup() {
  showToast('⏳ Exportando...', '');
  const [apps, notes, prods, routs, steps, photos] = await Promise.all([
    db.from('product_applications').select('*').order('applied_at'),
    db.from('daily_notes').select('*').order('note_date'),
    db.from('products').select('*'),
    db.from('routines').select('*'),
    db.from('routine_steps').select('*'),
    db.from('progress_photos').select('*'),
  ]);
  const backup = {
    exported_at: new Date().toISOString(),
    product_applications: apps.data || [], daily_notes: notes.data || [],
    products: prods.data || [], routines: routs.data || [],
    routine_steps: steps.data || [], progress_photos: photos.data || []
  };
  const dl = (name, content, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  dl(`skincare-backup-${TODAY_STR}.json`, JSON.stringify(backup, null, 2), 'application/json');
  const csvEsc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = ['fecha_local,hora,producto,fuente'].concat((apps.data || []).map(r => {
    const d = new Date(r.applied_at);
    return [localDateOfISO(r.applied_at),
      d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      csvEsc(r.product_name), r.source || ''].join(',');
  }));
  dl(`skincare-aplicaciones-${TODAY_STR}.csv`, rows.join('\n'), 'text/csv');
  showToast('✅ Respaldo descargado (JSON + CSV)', 'success');
}
// ── REPORTE PARA LA DERMATÓLOGA ──────────────────────────────────────────────
// Abre una ventana imprimible (desde ahí se guarda como PDF) con: adherencia
// por rol, evolución fotográfica antes/ahora por área, y notas de 30 días.
let lastReportData = null;
async function openDermReport() {
  if (!lastReportData) { showToast('⚠️ Espera a que cargue Progreso', 'error'); return; }
  showToast('⏳ Preparando reporte...', '');
  const { data: photos } = await db.from('progress_photos').select('*').order('created_at', { ascending: true });
  const byType = {};
  (photos || []).forEach(p => { const t = p.photo_type || 'general'; (byType[t] = byType[t] || []).push(p); });
  const pairs = [];
  for (const t of PHOTO_TYPES) {
    const arr = byType[t.key];
    if (!arr || arr.length < 2) continue;
    pairs.push({ label: t.label, a: arr[0], b: arr[arr.length - 1] });
  }
  const allPaths = pairs.flatMap(p => [extractStoragePath(p.a.photo_url), extractStoragePath(p.b.photo_url)]);
  if (allPaths.length) {
    const { data: signed } = await db.storage.from('progress-photos').createSignedUrls(allPaths, 3600);
    pairs.forEach((p, i) => {
      const sa = signed && signed[i * 2], sb = signed && signed[i * 2 + 1];
      if (sa && sa.signedUrl) p.a.photo_url = sa.signedUrl;
      if (sb && sb.signedUrl) p.b.photo_url = sb.signedUrl;
    });
  }
  const { data: notes } = await db.from('daily_notes').select('*').order('note_date', { ascending: false }).limit(30);
  const m = lastReportData;
  const rowT = (label, o) => o ? `<tr><td>${label}</td><td style="text-align:right;font-weight:700">${o.pct}%</td></tr>` : '';
  // Checklist pre-cita: preguntas sugeridas generadas de los datos reales.
  const questions = [];
  if (m.rege && m.rege.pct < 60) questions.push(`Mi constancia con tretinoína/retinol va en ${m.rege.pct}% — ¿conviene ajustar frecuencia o técnica (sandwich) para tolerarla mejor?`);
  if (m.prot && m.prot.pct < 70) questions.push(`Mi protección solar promedia ${m.prot.pct}% del ideal — ¿qué estrategia de reaplicación me recomiendas para mi día a día?`);
  pairs.forEach(p => {
    const weeks = Math.round((new Date(p.b.photo_date) - new Date(p.a.photo_date)) / (7 * 86400000));
    if (weeks >= 8) questions.push(`El área "${p.label.replace(/^[^ ]+ /, '')}" tiene fotos con ${weeks} semanas de diferencia — ¿la mejoría es la esperada o conviene valorar un procedimiento?`);
  });
  questions.push('¿Alguna de mis manchas amerita dermatoscopia o vigilancia especial (regla ABCDE)?');
  questions.push('¿Soy candidata a crioterapia, IPL o láser Q-switched, y cuál conviene para mi fototipo?');
  const questionsHTML = `<h2>Preguntas sugeridas para la consulta</h2><ol style="font-size:12.5px;line-height:1.7;padding-left:20px">${questions.map(q => `<li>${q}</li>`).join('')}</ol>`;
  const w = window.open('', '_blank');
  if (!w) { showToast('❌ Permite ventanas emergentes para generar el reporte', 'error'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Reporte skincare — manchas solares</title>
<style>
body{font-family:Georgia,serif;max-width:700px;margin:24px auto;color:#2A2420;padding:0 16px}
h1{font-size:20px}h2{font-size:15px;margin-top:26px;border-bottom:1px solid #ddd;padding-bottom:4px}
h3{font-size:13px;margin:14px 0 4px}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 4px;border-bottom:1px solid #eee}
.pair{display:flex;gap:10px;margin:8px 0 16px}.pair>div{flex:1;text-align:center;font-size:11px;color:#666}
.pair img{width:100%;border-radius:8px}
.note{font-size:12px;margin:7px 0;color:#444;line-height:1.5}.note b{color:#000}
@media print{.no-print{display:none}}
</style></head><body>
<button class="no-print" onclick="window.print()" style="padding:9px 18px;margin-bottom:16px;cursor:pointer">🖨️ Imprimir / guardar como PDF</button>
<h1>Reporte de seguimiento — manchas solares (lentigos)</h1>
<p style="font-size:12px;color:#666">Generado: ${new Date().toLocaleDateString('es-MX', { dateStyle: 'long' })} · Semana ${m.weekNum > 16 ? '16+' : m.weekNum} de tratamiento${m.melStart ? ` (desde ${m.melStart})` : ''} · Adherencia calculada sobre los últimos 90 días</p>
<h2>Adherencia por objetivo</h2>
<table>
${rowT('🛡️ Protección solar facial (calidad + reaplicaciones)', m.prot)}
${rowT('🎯 Despigmentación', m.despig)}
${rowT('💧 Barrera cutánea', m.barr)}
${rowT('🔬 Renovación celular (tretinoína/retinol)', m.rege)}
${rowT('🔍 Textura / poros', m.textura)}
</table>
${m.constancia != null ? `<p style="font-size:13px"><b>Constancia global: ${m.constancia}%</b></p>` : ''}
${questionsHTML}
<h2>Evolución fotográfica</h2>
${pairs.map(p => `<h3>${p.label}</h3><div class="pair"><div><img src="${p.a.photo_url}"><br>ANTES · ${p.a.photo_date}</div><div><img src="${p.b.photo_url}"><br>AHORA · ${p.b.photo_date}</div></div>`).join('') || '<p style="font-size:12px;color:#888">Aún no hay pares de fotos por área.</p>'}
<h2>Notas y estado de piel (últimos 30 registros)</h2>
${(notes || []).filter(n => n.notes || n.skin_state || n.sun_exposure).map(n => `<div class="note"><b>${n.note_date}</b>${n.skin_state ? ` · piel ${n.skin_state}/5` : ''}${n.sun_exposure ? ` · sol: ${n.sun_exposure}` : ''}${n.notes ? ` — ${esc(n.notes)}` : ''}</div>`).join('') || '<p style="font-size:12px;color:#888">Sin notas registradas.</p>'}
<p style="font-size:10px;color:#999;margin-top:30px">Generado por Skincare Tracker. Los porcentajes reflejan registros de la usuaria, no medición clínica.</p>
</body></html>`);
  w.document.close();
}
function buildHistorialByDay(appsData) {
  if (!appsData.length) return '<div class="empty-state">Aún no hay aplicaciones registradas.<br>Ve a ☀️ Today para empezar.</div>';
  const byDate = {};
  appsData.forEach(r => {
    const ds = localDateOfISO(r.applied_at);
    if (!byDate[ds]) byDate[ds] = [];
    byDate[ds].push(r);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const fmtTime = iso => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const entryHTML = r => `<div class="reapp-entry">
  <span class="reapp-entry-product">${loggedLabelHTML(r.product_name)}</span>
  <span class="reapp-entry-right">
    <span class="reapp-entry-time">${fmtTime(r.applied_at)}</span>
    <button class="reapp-entry-del" onclick="openEditApplication('${r.id}')" title="Editar registro">✏️</button>
    <button class="reapp-entry-del" onclick="deleteApplication('${r.id}')" title="Eliminar registro">🗑️</button>
  </span>
</div>`;
  const groupHTML = (label, arr) => arr.length ? `<div class="reapp-history-title">${label}</div>${arr.map(entryHTML).join('')}` : '';
  return dates.map((ds, i) => {
    const dayApps = byDate[ds].slice().sort((a, b) => a.applied_at.localeCompare(b.applied_at));
    const rutina = dayApps.filter(r => r.source === 'rutina');
    const reapp  = dayApps.filter(r => r.source === 'reaplicacion');
    const sinClasificar = dayApps.filter(r => r.source !== 'rutina' && r.source !== 'reaplicacion');
    return `<details class="hist-day"${i < 3 ? ' open' : ''}>
  <summary class="hist-day-date">${fmtDate(ds)} <span class="hist-day-count">${dayApps.length}</span></summary>
  ${groupHTML('☀️🌙 Rutina', rutina)}
  ${groupHTML('🔄 Reaplicaciones', reapp)}
  ${groupHTML('Sin clasificar (antes del cambio)', sinClasificar)}
</details>`;
  }).join('');
}
function fmtDate(ds) {
  const d = new Date(ds + 'T12:00:00');
  return `${MONTHS[d.getMonth()].slice(0,3)} ${d.getDate()}`;
}
// Detalle del heatmap al tocar un cuadro (los tooltips title no existen en móvil).
let _heatDayInfo = {};
function showHeatDay(ds, cell) {
  const box = document.getElementById('heat-day-detail');
  if (!box) return;
  document.querySelectorAll('.heat-cell.sel').forEach(c => c.classList.remove('sel'));
  if (cell) cell.classList.add('sel');
  box.innerHTML = _heatDayInfo[ds] || `<strong>${fmtDate(ds)}</strong><br>sin registros`;
  box.style.display = 'block';
}
// Borra un registro hecho por error — con hoja de confirmación propia (no el
// confirm() nativo) y toast de "Deshacer" que lo restaura tal cual.
async function deleteApplication(id) {
  if (!id || id === 'null' || id === 'undefined') {
    showToast('⚠️ Este registro es muy viejo y no se puede borrar desde aquí', 'error');
    return;
  }
  const ok = await confirmSheet('¿Eliminar este registro de aplicación?');
  if (!ok) return;
  const { data: row } = await db.from('product_applications').select('*').eq('id', id).maybeSingle();
  const { error } = await db.from('product_applications').delete().eq('id', id);
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  historyLoaded = false;
  await loadHistory();
  await loadTodayRoutines(TODAY_STR);
  await loadTodayApplications();
  if (row) {
    showUndoToast('🗑️ Registro eliminado', async () => {
      await db.from('product_applications').insert(row);
      historyLoaded = false;
      await loadHistory();
      await loadTodayRoutines(TODAY_STR);
      await loadTodayApplications();
    });
  }
}

// ── REAPPLICATIONS + LOGGING ─────────────────────────────────────────────────
let selectedProduct = null;
async function quickLog(name) {
  selectedProduct = name;
  await logApplication('reaplicacion');
}
function stepProductOf(s) {
  return (s && s.product_id) ? allProducts.find(p => p.id === s.product_id) : null;
}
// Un registro guarda un STRING (product_name), no el id. Esta es la ÚNICA
// resolución string → producto; todo lo que necesite marca, categoría o id de
// un registro pasa por aquí (si se duplica, se desincroniza).
function productByLoggedName(name) {
  if (!name) return null;
  const n = String(name).trim();
  return allProducts.find(p =>
    (p.logged_as && p.logged_as === n) ||
    (`${p.emoji} ${p.name}` === n) ||
    (p.name === n)
  ) || null;
}
function productIdForLoggedName(name) {
  const p = productByLoggedName(name);
  return p ? p.id : null;
}

// ── ETIQUETA DE PRODUCTO: MARCA + NOMBRE ─────────────────────────────────────
// En pantalla un producto SIEMPRE se lee "emoji · marca · nombre", con la marca
// delante en azul acero itálico light (.p-brand) y el nombre con la tipografía
// del contenedor. Una sola función para no acabar con seis variantes del mismo
// formato (regla 5 de ARQUITECTURA.md).
//
// OJO: esto es solo PRESENTACIÓN. Lo que se guarda en product_applications
// sigue siendo `logged_as` o "emoji nombre" — meter la marca ahí rompería la
// hidratación de checkmarks y el histórico ya registrado.
function prodLabelHTML(p, opts) {
  if (!p) return '';
  const o = opts || {};
  const emoji = o.emoji === false ? '' : (p.emoji || '');
  const brand = (p.brand || '').trim();
  return [
    emoji ? esc(emoji) : '',
    brand ? `<span class="p-brand">${esc(brand)}</span>` : '',
    esc(p.name || '')
  ].filter(Boolean).join(' ');
}
// Versión plana: <option>, toasts y cualquier sitio que use textContent, donde
// no se puede pintar el <span> de la marca.
function prodLabelText(p, opts) {
  if (!p) return '';
  const o = opts || {};
  const emoji = o.emoji === false ? '' : (p.emoji || '');
  return [emoji, (p.brand || '').trim(), p.name || ''].filter(Boolean).join(' ');
}
// Etiqueta de un registro ya guardado. Un mismo paso puede tener VARIOS
// productos (multi-picker): la hidratación los concatena con " · ", así que se
// resuelve parte por parte. Si el producto ya no existe en Stock, se muestra el
// texto guardado tal cual — nunca se pierde el registro.
function loggedLabelHTML(name) {
  return String(name == null ? '' : name).split(' · ').map(part => {
    const t = part.trim();
    const p = productByLoggedName(t);
    return p ? prodLabelHTML(p) : esc(t);
  }).filter(Boolean).join(' · ');
}
function loggedLabelText(name) {
  return String(name == null ? '' : name).split(' · ').map(part => {
    const t = part.trim();
    const p = productByLoggedName(t);
    return p ? prodLabelText(p) : t;
  }).filter(Boolean).join(' · ');
}

// ── BACKDATE ─────────────────────────────────────────────────────────────────
function getBackdateOverrideISO() {
  const input = document.getElementById('backdate-input');
  if (!input || !input.value) return null;
  const d = new Date(input.value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}
async function onBackdateChange() {
  const input = document.getElementById('backdate-input');
  const resetBtn = document.getElementById('backdate-reset-btn');
  const note = document.getElementById('backdate-active-note');
  const iso = getBackdateOverrideISO();
  const card = document.getElementById('backdate-card');
  if (iso) {
    resetBtn.style.display = 'inline-block';
    note.style.display = 'block';
    if (card) card.classList.add('active');
    const label = new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    note.textContent = `📅 Estás registrando para: ${label} — no para ahora mismo.`;
    await loadTodayRoutines(input.value.slice(0, 10));
  } else {
    resetBtn.style.display = 'none';
    note.style.display = 'none';
    if (card) card.classList.remove('active');
  }
  updateTodaySummary();
}
async function resetBackdate() {
  const input = document.getElementById('backdate-input');
  input.value = '';
  document.getElementById('backdate-reset-btn').style.display = 'none';
  document.getElementById('backdate-active-note').style.display = 'none';
  const card = document.getElementById('backdate-card');
  if (card) card.classList.remove('active');
  await loadTodayRoutines(TODAY_STR);
  showToast('✅ Volviste a registrar en tiempo real', 'success');
}

// ── OFFLINE QUEUE ────────────────────────────────────────────────────────────
// Sin señal, un registro ya no se pierde: se encola en localStorage y se
// reenvía solo al recuperar conexión (o al reabrir la app).
// Cada entrada envuelve la fila con metadatos de reintento:
//   { row, attempts, queuedAt, lastError }
// `row` es lo ÚNICO que se manda a la base — los metadatos jamás se insertan.
//
// Se distingue fallo TRANSITORIO (sin señal: se reintenta callado, no cuenta
// intento) de fallo PERMANENTE (RLS, producto borrado, fila inválida: cuenta
// intento y al llegar al tope se marca atorado y se AVISA). Antes, una fila
// que fallaba en serio se quedaba encolada para siempre y en silencio: creías
// el registro guardado y no estaba en ningún lado.
const QUEUE_KEY = 'skincare_pending_applications';
const MAX_SYNC_ATTEMPTS = 3;

function isNetworkError(error) {
  return !navigator.onLine || /fetch|network/i.test((error && error.message) || '');
}
function readQueue() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { raw = []; }
  if (!Array.isArray(raw)) raw = [];
  // Compatibilidad: las entradas viejas son la fila pelona, sin metadatos.
  return raw
    .map(e => (e && e.row) ? e : { row: e, attempts: 0, queuedAt: null, lastError: null })
    .filter(e => e && e.row && e.row.product_name);
}
function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) { /* storage lleno */ }
  renderSyncBanner();
}
function queuePending(row) {
  const q = readQueue();
  q.push({ row, attempts: 0, queuedAt: new Date().toISOString(), lastError: null });
  writeQueue(q);
}
let _flushing = false;
async function flushPending() {
  if (_flushing) return;            // 'online' puede dispararse varias veces seguidas
  const q = readQueue();
  if (!q.length) { renderSyncBanner(); return; }
  _flushing = true;
  const rest = [];
  let ok = 0, atorados = 0;
  for (const e of q) {
    const { error } = await db.from('product_applications').insert(e.row);
    if (!error) { ok++; continue; }
    if (isNetworkError(error)) { rest.push(e); continue; }   // sin señal: no penaliza
    e.attempts = (e.attempts || 0) + 1;
    e.lastError = error.message || 'error desconocido';
    if (e.attempts >= MAX_SYNC_ATTEMPTS) atorados++;
    rest.push(e);
  }
  _flushing = false;
  writeQueue(rest);
  if (ok) {
    showToast(`📶 ${ok} registro(s) offline sincronizados`, 'success');
    historyLoaded = false;
    loadTodayApplications();
    loadTodayRoutines(TODAY_STR);
  }
  if (atorados) showToast(`⚠️ ${atorados} registro(s) no se pudieron guardar`, 'error');
}
// Aviso persistente: mientras la cola tenga algo, se ve en todas las pestañas.
function renderSyncBanner() {
  const el = document.getElementById('sync-banner');
  if (!el) return;
  const q = readQueue();
  if (!q.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const stuck = q.filter(e => (e.attempts || 0) >= MAX_SYNC_ATTEMPTS);
  // Va a innerHTML: loggedLabelHTML escapa y además pinta la marca.
  const nombres = q.slice(0, 3).map(e => loggedLabelHTML(e.row.product_name)).join(', ');
  const mas = q.length > 3 ? ` y ${q.length - 3} más` : '';
  el.style.display = 'flex';
  el.className = 'sync-banner' + (stuck.length ? ' stuck' : '');
  el.innerHTML = stuck.length
    ? `<div class="sync-banner-txt"><strong>⚠️ ${stuck.length} registro(s) no se pudieron guardar</strong>
    <div class="sync-banner-sub">${nombres}${mas} · ${esc(stuck[0].lastError || '')}</div></div>
  <div class="sync-banner-actions">
    <button class="sync-btn" onclick="retryPending()">Reintentar</button>
    <button class="sync-btn sync-btn-ghost" onclick="discardStuck()">Descartar</button>
  </div>`
    : `<div class="sync-banner-txt"><strong>📡 ${q.length} registro(s) sin sincronizar</strong>
    <div class="sync-banner-sub">${nombres}${mas}</div></div>
  <div class="sync-banner-actions">
    <button class="sync-btn" onclick="retryPending()">Reintentar</button>
  </div>`;
}
async function retryPending() {
  showToast('⏳ Reintentando...', '');
  await flushPending();
  if (!readQueue().length) showToast('✅ Todo sincronizado', 'success');
}
// Descartar es destructivo y solo aplica a lo que ya falló en serio.
async function discardStuck() {
  const q = readQueue();
  const stuck = q.filter(e => (e.attempts || 0) >= MAX_SYNC_ATTEMPTS);
  if (!stuck.length) return;
  const ok = await confirmSheet(
    `Se descartarán ${stuck.length} registro(s) que no se pudieron guardar. No se puede deshacer.`,
    'Descartar');
  if (!ok) return;
  writeQueue(q.filter(e => (e.attempts || 0) < MAX_SYNC_ATTEMPTS));
  showToast('🗑️ Registros descartados', '');
}
window.addEventListener('online', flushPending);
window.addEventListener('offline', renderSyncBanner);

// Devuelve true si el registro quedó guardado (o encolado offline) — los
// callers usan esto para revertir el checkmark si falló.
// `zonas` (opcional) = lo marcado en el multipicker de zona. Si no viene, se
// resuelven las de PRODUCT_ZONAS. Se escribe null cuando no hay nada
// defendible: el motor cae entonces al respaldo de PRODUCT_ZONAS, igual que
// todos los registros anteriores a esta columna.
async function logApplication(source, routineStepId, zonas) {
  if (!selectedProduct) return false;
  const name = selectedProduct;
  selectedProduct = null;
  const zonasFinal = zonasDeNombre(name, zonas);
  const row = {
    product_name: name,
    product_id: productIdForLoggedName(name),
    applied_at: getBackdateOverrideISO() || new Date().toISOString(),
    source: source || null,
    routine_step_id: routineStepId || null,
    zones: zonasFinal.length ? zonasFinal : null
  };
  // Se pide el id de vuelta para que quien registre pueda DESHACER esa fila
  // exacta. Sigue devolviendo un valor truthy, así que los callers que solo
  // preguntan `if (!ok)` no cambian de comportamiento.
  const { data, error } = await db.from('product_applications').insert(row).select('id').single();
  if (error) {
    if (!navigator.onLine || /fetch|network/i.test(error.message || '')) {
      queuePending(row);
      showToast('📡 Sin conexión — se guardará al reconectar', '');
      historyLoaded = false;
      return 'queued';
    }
    showToast('❌ ' + error.message, 'error');
    return false;
  }
  showToast('✅ ' + name.split(' ').slice(0,3).join(' ') + ' registrado', 'success');
  loadTodayApplications();
  historyLoaded = false;
  return (data && data.id) ? data.id : true;
}
async function loadTodayApplications() {
  loadLastReapp();
  loadTodaySpfLast();
  const _todayBounds = localDayBoundsUTC(TODAY_STR);
  const { data } = await db.from('product_applications')
    .select('*')
    .eq('source', 'reaplicacion')
    .gte('applied_at', _todayBounds.startISO)
    .lt('applied_at', _todayBounds.endISO)
    .order('applied_at', { ascending: false });
  const el = document.getElementById('reapp-history');
  if (!data || data.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="reapp-history-title">Reaplicaciones de hoy</div>' +
    data.map(r => {
      const t = new Date(r.applied_at);
      const time = t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      return `<div class="reapp-entry">
  <span class="reapp-entry-product">${loggedLabelHTML(r.product_name)}</span>
  <span class="reapp-entry-time">${time}</span>
</div>`;
    }).join('');
}

// ── REPETIR ÚLTIMA REAPLICACIÓN ──────────────────────────────────────────────
// El caso más común del día: volver a ponerte lo mismo de hace unas horas.
let _lastReappName = null;
async function loadLastReapp() {
  const { data } = await db.from('product_applications').select('product_name')
    .eq('source', 'reaplicacion').order('applied_at', { ascending: false }).limit(1);
  const el = document.getElementById('reapp-repeat-wrap');
  if (!el) return;
  if (data && data.length) {
    _lastReappName = data[0].product_name;
    el.innerHTML = `<button class="mini-action-btn" onclick="repeatLastReapp()">🔁 Repetir última: <strong>${esc(_lastReappName)}</strong></button>`;
  } else {
    _lastReappName = null;
    el.innerHTML = '';
  }
}
async function repeatLastReapp() {
  if (!_lastReappName) return;
  selectedProduct = _lastReappName;
  await logApplication('reaplicacion');
}

// ── RECORDATORIO DE REAPLICACIÓN SPF ─────────────────────────────────────────
// Limitación honesta: avisa mientras la app está abierta (pestaña o PWA
// activa) — push con la app cerrada requeriría un servidor de notificaciones.
// Revisa cada 30 min: si entre 10am y 7pm han pasado >3.5h desde tu último
// SPF facial registrado, manda notificación (o toast si no diste permiso).
const SPF_REMINDER_KEY = 'skincare_spf_reminder';
const SPF_NUDGE_TS_KEY = 'skincare_last_spf_nudge';
const SPF_REMINDER_GAP_H = 2; // recordar cada 2 horas
// ── WEB PUSH (notificaciones con la app CERRADA) ─────────────────────────────
// La llave pública VAPID es pública por diseño (va en el cliente). La privada
// vive SOLO en los secrets de la Edge Function — ver PUSH-SETUP.md.
const VAPID_PUBLIC_KEY = 'BA4kHPEAdoycLdzOsSZqaJQAco5i5ChUFdlrB-RYeJ5m-c0_av5QF1yuD90BFA0_cGUQItoiThFDvfQcs5sbi8c';
const PUSH_ENABLED_KEY = 'skincare_push_enabled';
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function enablePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const j = sub.toJSON();
    const { error } = await db.from('push_subscriptions').upsert(
      { endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
    localStorage.setItem(PUSH_ENABLED_KEY, '1');
    return true;
  } catch (e) {
    localStorage.removeItem(PUSH_ENABLED_KEY);
    return false;
  }
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) { /* best effort */ }
  localStorage.removeItem(PUSH_ENABLED_KEY);
}
function renderSpfReminderBtn() {
  const el = document.getElementById('spf-reminder-wrap');
  if (!el) return;
  const on = localStorage.getItem(SPF_REMINDER_KEY) === '1';
  el.innerHTML = `<button class="mini-action-btn${on ? ' on' : ''}" onclick="toggleSpfReminder()">${on ? '🔔 Recordatorio SPF activo · cada 2 h (10am–7pm)' : '🔕 Activar recordatorio de reaplicar SPF'}</button>`;
}
async function toggleSpfReminder() {
  const on = localStorage.getItem(SPF_REMINDER_KEY) === '1';
  if (!on) {
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) {}
    }
    if ('Notification' in window && Notification.permission === 'denied') {
      showToast('⚠️ Las notificaciones están BLOQUEADAS — actívalas en los ajustes del navegador/sitio', 'error');
    }
    localStorage.setItem(SPF_REMINDER_KEY, '1');
    const pushOk = await enablePush();
    showToast(pushOk
      ? '🔔 Push activo: te aviso cada 2 h aunque la app esté cerrada'
      : '🔔 Aviso cada 2 h con la app abierta (push no disponible en este navegador)', 'success');
    checkSpfReminder();
  } else {
    localStorage.removeItem(SPF_REMINDER_KEY);
    await disablePush();
    showToast('🔕 Recordatorio desactivado', '');
  }
  renderSpfReminderBtn();
}
// En iPhone, new Notification() NO existe: hay que mostrarlas a través del
// service worker (reg.showNotification), y solo funcionan con la app agregada
// a pantalla de inicio (iOS 16.4+) y permiso concedido. Fallback: toast.
async function notifySpf(msg) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification('☀️ Toca reaplicar SPF', {
          body: msg, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'spf-reminder'
        });
        return;
      }
    } catch (e) { /* sigue al fallback */ }
    try { new Notification('☀️ Toca reaplicar SPF', { body: msg, icon: 'icon-192.png' }); return; } catch (e) {}
  }
  showToast('☀️ ' + msg, '');
}
// _lastSpfNudge persiste en localStorage para no duplicar avisos al recargar.
let _lastSpfNudge = Number(localStorage.getItem(SPF_NUDGE_TS_KEY) || 0);
async function checkSpfReminder() {
  if (localStorage.getItem(SPF_REMINDER_KEY) !== '1') return;
  // Con push activo, el servidor (Edge Function + cron) es quien avisa —
  // así no llegan avisos dobles.
  if (localStorage.getItem(PUSH_ENABLED_KEY) === '1') return;
  const h = new Date().getHours();
  if (h < 10 || h >= 19) return;
  if (_currentUV != null && _currentUV < 2) return; // UV casi nulo: no molestar
  if (Date.now() - _lastSpfNudge < SPF_REMINDER_GAP_H * 3600000) return; // 1 aviso por ciclo de 2 h
  const spfIds = allProducts.filter(p => p.category === '🌞 SPF Facial').map(p => p.id);
  if (!spfIds.length) return;
  const b = localDayBoundsUTC(TODAY_STR);
  const { data } = await db.from('product_applications').select('applied_at')
    .in('product_id', spfIds)
    .gte('applied_at', b.startISO).lt('applied_at', b.endISO)
    .order('applied_at', { ascending: false }).limit(1);
  const last = (data && data.length) ? new Date(data[0].applied_at) : null;
  const gapH = last ? (Date.now() - last.getTime()) / 3600000 : Infinity;
  if (gapH < SPF_REMINDER_GAP_H) return;
  _lastSpfNudge = Date.now();
  localStorage.setItem(SPF_NUDGE_TS_KEY, String(_lastSpfNudge));
  const msg = last ? `Han pasado ${gapH.toFixed(1)} h desde tu último SPF facial` : 'Hoy aún no registras SPF facial';
  notifySpf(msg);
}

// ── BOTÓN FLOTANTE DE REAPLICACIÓN ───────────────────────────────────────────
// Visible en TODAS las pestañas: la reaplicación es lo que mueve el eje de
// Protección, y estaba enterrada al fondo de Today (mejora #2). Un toque
// registra el último protector usado, con deshacer.
// Se oculta durante backdate: ahí estás viendo otro día, no registrando ahora.
function renderSpfFab() {
  const el = document.getElementById('spf-fab');
  if (!el) return;
  const bd = document.getElementById('backdate-input');
  if (bd && bd.value) { el.style.display = 'none'; return; }
  const st = spfStatus();
  el.style.display = 'flex';
  el.className = 'spf-fab spf-fab-' + st.state;
  el.innerHTML = `<span class="spf-fab-icon">🛡️</span><span class="spf-fab-txt">${esc(st.label)}</span>`;
}

// ── REGISTRO DESDE LA NOTIFICACIÓN ───────────────────────────────────────────
// Tocar el aviso de SPF registra tu último protector sin navegar por la app.
// El service worker manda LOG_SPF (app abierta) o abre con ?log=spf (cerrada).
//
// No adivina: si nunca has registrado un SPF, abre el picker en vez de
// inventar un producto. Y si ya registraste hace menos de 15 min, avisa en
// lugar de duplicar — el mismo aviso puede tocarse dos veces.
const PUSH_LOG_MIN_GAP_MIN = 15;

async function lastSpfApplication() {
  const spfIds = allProducts.filter(p => p.category === '🌞 SPF Facial').map(p => p.id);
  if (!spfIds.length) return null;
  const { data } = await db.from('product_applications')
    .select('product_name, applied_at')
    .in('product_id', spfIds)
    .order('applied_at', { ascending: false }).limit(1);
  return (data && data.length) ? data[0] : null;
}

async function quickLogSpf() {
  const last = await lastSpfApplication();
  if (!last) { showToast('🛡️ Elige tu protector', ''); openSPFPicker(); return; }
  const gapMin = (Date.now() - new Date(last.applied_at).getTime()) / 60000;
  if (gapMin < PUSH_LOG_MIN_GAP_MIN) {
    showToast(`🛡️ Ya registraste ${loggedLabelText(last.product_name)} hace ${Math.round(gapMin)} min`, '');
    return;
  }
  selectedProduct = last.product_name;
  const id = await logApplication('reaplicacion');
  if (!id) return;
  if (id === 'queued') return;   // sin conexión: ya avisó la cola, no hay fila que deshacer
  showUndoToast(`🛡️ ${loggedLabelText(last.product_name)} registrado`, async () => {
    await db.from('product_applications').delete().eq('id', id);
    historyLoaded = false;
    await loadTodayApplications();
    await loadTodayRoutines(currentViewDateStr());
  });
}

// App cerrada: el SW abrió con ?log=spf. Se limpia la URL para que un refresh
// no vuelva a registrar.
async function handlePushLogParam() {
  const params = new URLSearchParams(location.search);
  if (params.get('log') !== 'spf') return;
  history.replaceState({}, '', location.pathname);
  await quickLogSpf();
}

// ── MAPA DE MANCHAS ──────────────────────────────────────────────────────────
// Las fotos rastrean ÁREAS; esto rastrea LESIONES. Una consulta no evalúa "la
// cara", evalúa esta mancha del pómulo y si aquella otra cambió.
//
// ⚠️ ALCANCE: sirve para seguir el progreso de un tratamiento. `shade` es
// apreciación visual de la usuaria, NO una medición, y así se presenta siempre.
// El estado "Preguntar en consulta" existe para no olvidarlo, no para que la
// app dictamine nada. Cualquier lesión que cambie, sangre o pique es de
// dermatoscopia — no agregar aquí nada que se lea como evaluación de riesgo.
// Una tabla nueva puede fallar por dos razones muy distintas: la migración no
// se corrió, o SÍ se corrió pero PostgREST todavía no la expone (su caché de
// esquema no se entera de tablas nuevas hasta que se le avisa). Ocultar el
// error en silencio hacía imposible distinguirlas — que es exactamente el
// problema que tuvimos.
function tablaNoVisible(e) {
  const txt = ((e && e.message) || '') + ' ' + ((e && e.code) || '');
  return /schema cache|does not exist|PGRST205|42P01|relation .* does not exist/i.test(txt);
}
function bloqueErrorTabla(titulo, e, archivoSql) {
  const msg = tablaNoVisible(e)
    ? `Falta correr <code>${esc(archivoSql)}</code>, o la API todavía no ve las tablas nuevas.<br>
       En Supabase → SQL Editor: <code>notify pgrst, 'reload schema';</code>`
    : esc((e && e.message) || 'No se pudo cargar.');
  return `<div class="week-card"><h3 style="margin-top:0">${esc(titulo)}</h3>
  <div class="empty-state" style="text-align:left">${msg}</div></div>`;
}
const SPOT_STATUS = {
  activa:      { e: '🔴', l: 'Activa' },
  aclarando:   { e: '🟡', l: 'Aclarando' },
  resuelta:    { e: '🟢', l: 'Resuelta' },
  vigilancia:  { e: '🩺', l: 'Preguntar en consulta' },
};
const SHADE_LEVELS = [
  { v: 1, e: '○',  l: 'Casi no se ve' },
  { v: 2, e: '◔',  l: 'Tenue' },
  { v: 3, e: '◑',  l: 'Media' },
  { v: 4, e: '◕',  l: 'Marcada' },
  { v: 5, e: '●',  l: 'Muy marcada' },
];
let spotsCache = [], obsCache = {}, zonePhotos = {}, _spotPos = { x: null, y: null };
// Foto sobre la que se marcaron las coordenadas. NO es "la más reciente de la
// zona": los % son de UNA foto concreta, y si la referencia cambiara sola el
// marcador terminaría señalando otro punto de la cara.
let _spotRef = { id: null, url: null, date: null };
let selectedShade = null;

const zoneLabel = k => (PHOTO_TYPES.find(t => t.key === k) || { label: k }).label;

// ── TIRA DE RECORTES ────────────────────────────────────────────────────────
// Amplía la MISMA región en cada foto del área y las pone en fila por fecha,
// para poder comparar una mancha concreta a lo largo de meses.
//
// El recorte se hace con CSS puro (`background-size` + `background-position` en
// %), no con canvas: así no hay que conocer la relación de aspecto de cada foto
// ni redibujar nada. `background-position: X% Y%` alinea el punto X% de la
// imagen con el punto X% del contenedor, así que la mancha siempre queda a la
// vista con el mismo encuadre relativo en todas las fotos.
//
// LIMITACIÓN, y es inherente: usa las mismas coordenadas en TODAS las fotos.
// Solo apunta al mismo sitio si el encuadre fue consistente — para eso está la
// foto fantasma al capturar. Por lo mismo NO se calcula ningún número de
// "cuánto aclaró": con luz e iluminación variables sería precisión inventada.
// Se muestran los recortes con su fecha y la usuaria juzga.
const SPOT_CROP_ZOOM = 420;   // % del ancho del contenedor: a más zoom, más detalle
// La URL firmada acaba dentro de un atributo `style`, así que es un dato que
// entra a innerHTML y le aplica la regla de oro 2. Un URL firmado de Supabase es
// base64url + JWT: nunca lleva comillas, paréntesis, backslash, punto y coma ni
// espacios — que son justo los caracteres con los que se podría romper el
// atributo o inyectar otra declaración CSS. Se eliminan y luego se escapa.
function cssUrlSafe(u) {
  return esc(String(u == null ? '' : u).replace(/['"()\\;\s]/g, ''));
}
function cropStyle(url, posX, posY) {
  const x = Math.max(0, Math.min(100, Number(posX)));
  const y = Math.max(0, Math.min(100, Number(posY)));
  return `background-image:url('${cssUrlSafe(url)}');background-size:${SPOT_CROP_ZOOM}% auto;`
       + `background-position:${x}% ${y}%;background-repeat:no-repeat`;
}

async function loadSpots() {
  const el = document.getElementById('spots-content');
  if (!el) return;
  const [spotsRes, obsRes] = await Promise.all([
    db.from('skin_spots').select('*').order('zone').order('name'),
    db.from('spot_observations').select('*').order('observed_at', { ascending: false })
  ]);
  if (spotsRes.error) {
    el.innerHTML = bloqueErrorTabla('🎯 Mis manchas', spotsRes.error, 'migracion-manchas.sql');
    return;
  }
  spotsCache = spotsRes.data || [];
  obsCache = {};
  ((obsRes && obsRes.data) || []).forEach(o => {
    (obsCache[o.spot_id] = obsCache[o.spot_id] || []).push(o);
  });
  // Fotos de las zonas que tienen manchas ubicadas, para armar las tiras.
  // Una sola consulta y UNA sola llamada a createSignedUrls (nunca una por
  // foto — regla de oro de progress_photos).
  zonePhotos = {};
  const zonasConPos = [...new Set(spotsCache
    .filter(s => s.pos_x != null && s.reference_photo_id).map(s => s.zone))];
  if (zonasConPos.length) {
    const { data: fotos } = await db.from('progress_photos')
      .select('id, photo_type, photo_url, photo_date')
      .in('photo_type', zonasConPos)
      .order('photo_date', { ascending: true });
    const lista = fotos || [];
    if (lista.length) {
      const { data: signed } = await db.storage.from('progress-photos')
        .createSignedUrls(lista.map(f => extractStoragePath(f.photo_url)), 3600);
      lista.forEach((f, i) => {
        const u = signed && signed[i] && signed[i].signedUrl;
        if (!u) return;
        (zonePhotos[f.photo_type] = zonePhotos[f.photo_type] || [])
          .push({ id: f.id, url: u, date: f.photo_date });
      });
    }
  }
  const porZona = {};
  spotsCache.forEach(s => { (porZona[s.zone] = porZona[s.zone] || []).push(s); });
  const grupos = Object.keys(porZona).sort().map(z =>
    `<div class="spot-zone-hdr">${esc(zoneLabel(z))}</div>` +
    porZona[z].map(spotRowHTML).join('')
  ).join('');
  el.innerHTML = `<div class="week-card">
  <h3 style="margin-top:0">🎯 Mis manchas</h3>
  <div class="spot-intro">Seguimiento de cada mancha por separado. Lo que registras es cómo la ves tú, no una medición — sirve para ver la dirección a lo largo de meses y para llegar a consulta con datos.</div>
  <button class="mini-action-btn" onclick="openSpotModal()">＋ Agregar mancha</button>
  ${grupos || '<div class="empty-state">Aún no hay manchas registradas.</div>'}
</div>`;
}

function spotRowHTML(s) {
  const st = SPOT_STATUS[s.status] || SPOT_STATUS.activa;
  const obs = obsCache[s.id] || [];
  const tr = spotTrend(obs);
  const ultima = obs[0];
  let tendencia = '<span class="spot-trend spot-trend-none">Sin tendencia todavía · registra al menos 2 veces</span>';
  if (tr) {
    const cls = tr.direction === 'aclarando' ? 'ok' : (tr.direction === 'oscureciendo' ? 'warn' : 'none');
    const meses = tr.days >= 60 ? ` en ${Math.round(tr.days / 30)} meses` : ` en ${tr.days} días`;
    tendencia = `<span class="spot-trend spot-trend-${cls}">${tr.first}/5 → ${tr.last}/5${esc(meses)} · ${esc(tr.direction)}</span>`;
  }
  const hoy = ultima ? `Última vez que la miraste: ${fmtDate(ultima.observed_at)} · ${ultima.shade}/5` : 'Sin observaciones';
  const aviso = s.status === 'vigilancia'
    ? '<div class="spot-vigilancia">🩺 Marcada para preguntar en tu próxima consulta.</div>' : '';
  // pos sin referencia = se borró la foto sobre la que se marcó. Las
  // coordenadas quedaron huérfanas y no se pueden interpretar.
  const sinRef = (s.pos_x != null && !s.reference_photo_id)
    ? '<div class="spot-vigilancia">📷 Se borró la foto de referencia de su ubicación — vuelve a marcarla.</div>' : '';
  const tira = cropStripHTML(s);
  return `<div class="spot-row">
  <div class="spot-row-top">
    <div class="spot-name">${esc(st.e)} ${esc(s.name)}</div>
    <div class="spot-actions">
      <button class="hito-del" onclick="openObsModal('${s.id}')" title="Registrar cómo se ve">👁️</button>
      <button class="hito-del" onclick="openSpotModal('${s.id}')" title="Editar">✏️</button>
      <button class="hito-del" onclick="deleteSpot('${s.id}')" title="Eliminar">🗑️</button>
    </div>
  </div>
  <div class="spot-meta">${esc(st.l)}${s.first_noticed ? ' · desde ' + fmtDate(s.first_noticed) : ''} · ${esc(hoy)}</div>
  ${tendencia}
  ${s.notes ? `<div class="spot-notes">${fmtRich(s.notes)}</div>` : ''}
  ${tira}
  ${aviso}
  ${sinRef}
</div>`;
}

// Tira de recortes de UNA mancha: la misma región en cada foto del área,
// en orden cronológico. Marca cuál foto es la referencia donde se ubicó.
function cropStripHTML(s) {
  if (s.pos_x == null || s.pos_y == null || !s.reference_photo_id) return '';
  const fotos = zonePhotos[s.zone] || [];
  if (fotos.length < 2) {
    return `<div class="crop-hint">La tira de comparación aparece a partir de la segunda foto de esta zona.</div>`;
  }
  const items = fotos.map(f => `<div class="crop-item">
  <div class="crop-img" style="${cropStyle(f.url, s.pos_x, s.pos_y)}"></div>
  <div class="crop-date">${esc(fmtDate(f.date))}${f.id === s.reference_photo_id ? ' 📌' : ''}</div>
</div>`).join('');
  return `<div class="crop-strip">${items}</div>
<div class="crop-hint">📌 = la foto donde la ubicaste. El recorte usa las mismas coordenadas en todas: si el encuadre cambió entre fotos, puede caer algo desviado.</div>`;
}

// ── Colocar la marca sobre la última foto de la zona ────────────────────────
// Se usa la foto REAL de esa área, no un diagrama genérico: es más fácil
// ubicar la mancha sobre tu propia cara. Las coordenadas se guardan en % para
// que no dependan del tamaño con que se muestre la imagen.
async function fetchSignedPhoto(row) {
  if (!row) return null;
  const { data: signed } = await db.storage.from('progress-photos')
    .createSignedUrls([extractStoragePath(row.photo_url)], 3600);
  const url = signed && signed[0] && signed[0].signedUrl;
  return url ? { id: row.id, url, date: row.photo_date } : null;
}

// Carga la foto sobre la que se marca la ubicación.
//   · Mancha existente con referencia → ESA foto, siempre la misma.
//   · Mancha nueva, o `forzarUltima`  → la más reciente de la zona.
// Cambiar de referencia BORRA la posición: unas coordenadas marcadas sobre otro
// encuadre no significan nada, y arrastrarlas sería peor que perderlas.
async function loadSpotZonePhoto(forzarUltima) {
  const zone = document.getElementById('sp-zone').value;
  const img  = document.getElementById('sp-map-img');
  const hint = document.getElementById('sp-map-hint');
  const wrap = document.getElementById('sp-map-wrap');
  const btn  = document.getElementById('sp-remark-btn');
  img.src = ''; wrap.style.display = 'none';
  if (btn) btn.style.display = 'none';
  let row = null;
  if (!forzarUltima && _spotRef.id) {
    const { data } = await db.from('progress_photos')
      .select('id, photo_url, photo_date').eq('id', _spotRef.id).limit(1);
    row = data && data[0];
    if (!row) hint.textContent = 'La foto de referencia ya no existe — vuelve a marcar sobre una actual.';
  }
  const usandoUltima = !row;
  if (!row) {
    const { data } = await db.from('progress_photos')
      .select('id, photo_url, photo_date').eq('photo_type', zone)
      .order('photo_date', { ascending: false }).limit(1);
    row = data && data[0];
  }
  if (!row) {
    _spotRef = { id: null, url: null, date: null };
    hint.textContent = 'Aún no tienes foto de esta zona — la ubicación se puede marcar después.';
    return;
  }
  const p = await fetchSignedPhoto(row);
  if (!p) { hint.textContent = 'No se pudo cargar la foto de referencia.'; return; }
  // Si la referencia cambió, las coordenadas viejas dejan de tener sentido.
  if (_spotRef.id && _spotRef.id !== p.id) _spotPos = { x: null, y: null };
  _spotRef = p;
  img.src = p.url;
  wrap.style.display = 'block';
  hint.textContent = usandoUltima
    ? `Toca sobre la foto para marcar dónde está. Referencia: foto del ${fmtDate(p.date)}.`
    : `Ubicación anclada a la foto del ${fmtDate(p.date)}. Toca para ajustarla.`;
  if (btn && !usandoUltima) btn.style.display = 'flex';
  renderSpotMarker();
}

// Cambiar de zona invalida la referencia: es otra foto y otro encuadre.
function onSpotZoneChange() {
  _spotRef = { id: null, url: null, date: null };
  _spotPos = { x: null, y: null };
  loadSpotZonePhoto(true);
}

// Re-anclar a la foto más reciente. Es explícito a propósito: la referencia
// nunca debe actualizarse en silencio, porque invalida la posición marcada.
async function remarkOnLatest() {
  const ok = await confirmSheet(
    'Se va a usar tu foto más reciente de esta zona como nueva referencia. Tendrás que volver a marcar dónde está la mancha.',
    'Cambiar referencia');
  if (!ok) return;
  _spotPos = { x: null, y: null };
  _spotRef = { id: null, url: null, date: null };
  await loadSpotZonePhoto(true);
  renderSpotMarker();
}

function placeSpotMarker(ev) {
  if (!_spotRef.url) return;
  const wrap = document.getElementById('sp-map-wrap');
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = ((ev.clientX - r.left) / r.width) * 100;
  const y = ((ev.clientY - r.top) / r.height) * 100;
  _spotPos = { x: Math.max(0, Math.min(100, +x.toFixed(2))),
               y: Math.max(0, Math.min(100, +y.toFixed(2))) };
  renderSpotMarker();
}

function renderSpotMarker() {
  const m = document.getElementById('sp-map-marker');
  if (!m) return;
  if (_spotPos.x == null || _spotPos.y == null) { m.style.display = 'none'; return; }
  m.style.left = _spotPos.x + '%';
  m.style.top  = _spotPos.y + '%';
  m.style.display = 'block';
}

function openSpotModal(id) {
  const s = id ? spotsCache.find(x => x.id === id) : null;
  document.getElementById('spot-modal-title').textContent = s ? '✏️ Editar mancha' : '＋ Nueva mancha';
  document.getElementById('sp-id').value = s ? s.id : '';
  document.getElementById('sp-name').value = s ? s.name : '';
  document.getElementById('sp-status').value = s ? s.status : 'activa';
  document.getElementById('sp-first').value = s ? (s.first_noticed || '') : '';
  document.getElementById('sp-notes').value = s ? (s.notes || '') : '';
  document.getElementById('sp-zone').innerHTML =
    PHOTO_TYPES.map(t => `<option value="${t.key}"${s && s.zone === t.key ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
  _spotPos = s ? { x: s.pos_x, y: s.pos_y } : { x: null, y: null };
  _spotRef = { id: s ? (s.reference_photo_id || null) : null, url: null, date: null };
  openModal('spot-modal');
  loadSpotZonePhoto();
}

async function saveSpot() {
  const id = document.getElementById('sp-id').value;
  const row = {
    name:   document.getElementById('sp-name').value.trim(),
    zone:   document.getElementById('sp-zone').value,
    status: document.getElementById('sp-status').value,
    first_noticed: document.getElementById('sp-first').value || null,
    notes:  document.getElementById('sp-notes').value.trim() || null,
    pos_x:  _spotPos.x, pos_y: _spotPos.y,
    // La posición no viaja sin su foto: guardarla sola es lo que producía la
    // deriva del marcador.
    reference_photo_id: (_spotPos.x != null && _spotRef.id) ? _spotRef.id : null
  };
  if (!row.name) { showToast('⚠️ Ponle un nombre', 'error'); return; }
  const btn = document.getElementById('save-spot-btn');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  const { error } = id
    ? await db.from('skin_spots').update(row).eq('id', id)
    : await db.from('skin_spots').insert(row);
  btn.disabled = false; btn.textContent = 'Guardar mancha';
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  closeModal('spot-modal');
  showToast(id ? '✅ Mancha actualizada' : '✅ Mancha guardada', 'success');
  await loadSpots();
}

async function deleteSpot(id) {
  const s = spotsCache.find(x => x.id === id);
  const n = (obsCache[id] || []).length;
  const ok = await confirmSheet(
    `¿Eliminar "${s ? s.name : 'esta mancha'}"?` + (n ? ` Se borran también sus ${n} observación(es).` : ''),
    'Eliminar');
  if (!ok) return;
  const { error } = await db.from('skin_spots').delete().eq('id', id);
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  showToast('🗑️ Mancha eliminada', '');
  await loadSpots();
}

// ── Observaciones ──────────────────────────────────────────────────────────
function renderShadeRow() {
  const el = document.getElementById('ob-shade-row');
  if (!el) return;
  el.innerHTML = SHADE_LEVELS.map(s =>
    `<button class="skin-btn${selectedShade === s.v ? ' on' : ''}" onclick="setShade(${s.v})">
      <span style="font-size:17px">${s.e}</span><span>${esc(s.l)}</span>
    </button>`).join('');
}
function setShade(v) { selectedShade = v; renderShadeRow(); }

function openObsModal(spotId) {
  const s = spotsCache.find(x => x.id === spotId);
  document.getElementById('obs-modal-title').textContent = s ? `👁️ ${s.name}` : 'Registrar cómo se ve';
  document.getElementById('ob-spot-id').value = spotId;
  document.getElementById('ob-date').value = TODAY_STR;
  document.getElementById('ob-notes').value = '';
  // Si ya hay observación de hoy, se precarga para CORREGIRLA en vez de duplicar
  // (la base tiene unique (spot_id, observed_at)).
  const hoy = (obsCache[spotId] || []).find(o => o.observed_at === TODAY_STR);
  selectedShade = hoy ? hoy.shade : null;
  if (hoy && hoy.notes) document.getElementById('ob-notes').value = hoy.notes;
  renderShadeRow();
  openModal('obs-modal');
}

async function saveObservation() {
  const spotId = document.getElementById('ob-spot-id').value;
  const fecha  = document.getElementById('ob-date').value;
  if (!fecha) { showToast('⚠️ Elige una fecha', 'error'); return; }
  if (!selectedShade) { showToast('⚠️ Elige qué tan marcada la ves', 'error'); return; }
  const btn = document.getElementById('save-obs-btn');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  // upsert por la restricción unique: corregir el mismo día no duplica.
  const { error } = await db.from('spot_observations').upsert({
    spot_id: spotId, observed_at: fecha, shade: selectedShade,
    notes: document.getElementById('ob-notes').value.trim() || null
  }, { onConflict: 'spot_id,observed_at' });
  btn.disabled = false; btn.textContent = 'Guardar';
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  closeModal('obs-modal');
  showToast('✅ Registrado', 'success');
  await loadSpots();
}

// ── HITOS DE TRATAMIENTO ─────────────────────────────────────────────────────
// Responde "qué cambió y cuándo": sin esto ninguna gráfica se puede leer de
// forma causal. Une DOS fuentes (vista treatment_timeline en la base):
//   · products.started_at    — cuándo entró cada producto (dato estructurado)
//   · treatment_events       — hitos que no son un producto
// Se consultan por separado en vez de usar la vista porque los eventos se
// editan y borran, y la vista no expone su id.
const HITO_TYPES = [
  { v: 'consulta',        e: '🩺', l: 'Consulta' },
  { v: 'procedimiento',   e: '⚡', l: 'Procedimiento' },
  { v: 'diagnostico',     e: '📋', l: 'Cambio de diagnóstico' },
  { v: 'medicacion',      e: '💊', l: 'Medicación' },
  { v: 'evento_solar',    e: '☀️', l: 'Exposición solar' },
  { v: 'producto_pausa',  e: '⏸️', l: 'Pausé un producto' },
  { v: 'producto_ajuste', e: '🎚️', l: 'Ajuste de un producto' },
  { v: 'otro',            e: '📌', l: 'Otro' },
];
const hitoType = v => HITO_TYPES.find(t => t.v === v) || { e: '📌', l: v || 'Otro' };
let hitosCache = [];

// Ventana de notas que se descarga: 120 días, para que un producto empezado
// hace 90 todavía tenga sus 14 días PREVIOS dentro del rango.
const REACCION_DIAS_NOTAS = 120;

// Construye el aviso de coincidencias. Se separa del render para que el texto
// —que es la parte delicada— quede en un solo lugar.
function buildReaccionesHTML(skinByDate) {
  const conFecha = allProducts.filter(p => p.started_at);
  const señales = [];
  conFecha.forEach(p => {
    const r = reactionSignal(p.started_at, skinByDate);
    if (!r) return;
    // ¿Empezó algo más casi al mismo tiempo? Si sí, NO se puede atribuir a uno.
    const juntos = conFecha.filter(q => q.id !== p.id &&
      Math.abs((new Date(q.started_at + 'T12:00:00Z') - new Date(p.started_at + 'T12:00:00Z')) / 86400000) <= 7);
    señales.push({ p, r, juntos });
  });
  if (!señales.length) return '';
  señales.sort((a, b) => Math.abs(b.r.delta) - Math.abs(a.r.delta));
  const filas = señales.map(({ p, r, juntos }) => {
    const peor = r.direction === 'peor';
    const compañía = juntos.length
      ? `<div class="reac-caveat">En esos mismos días también empezaste ${juntos.map(q => prodLabelHTML(q, { emoji: false })).join(', ')} — no se puede atribuir a uno solo.</div>`
      : '';
    return `<div class="reac-row ${peor ? 'reac-peor' : 'reac-mejor'}">
  <div class="reac-title">${prodLabelHTML(p)} · desde ${fmtDate(p.started_at)}</div>
  <div class="reac-nums">Tu piel promedió <strong>${r.after}/5</strong> en los 14 días siguientes, contra <strong>${r.before}/5</strong> en los 14 previos (${r.delta > 0 ? '+' : ''}${r.delta}).</div>
  <div class="reac-n">${r.nBefore} días con registro antes · ${r.nAfter} después</div>
  ${compañía}
</div>`;
  }).join('');
  return `<div class="logs-card">
  <h3>🔬 Coincidencias que vale la pena mirar</h3>
  ${filas}
  <div class="reac-disclaimer">Esto es una <strong>coincidencia en el tiempo, no una causa demostrada</strong>. Tu piel cambia por clima, hormonas, sueño y varios productos a la vez, y aquí no hay forma de separarlos. Sirve para notar algo y llevarlo a tu próxima consulta, no para concluir por tu cuenta que un producto te hace daño.</div>
</div>`;
}

async function loadHitos() {
  const el = document.getElementById('hitos-content');
  if (!el) return;
  const desde = toDateStr(new Date(Date.now() - REACCION_DIAS_NOTAS * 86400000));
  const [{ data, error }, notasRes] = await Promise.all([
    db.from('treatment_events').select('*').order('event_date', { ascending: false }),
    db.from('daily_notes').select('note_date, skin_state').gte('note_date', desde)
  ]);
  if (error) {
    el.innerHTML = bloqueErrorTabla('🗓️ Línea de tiempo del tratamiento', error, 'migracion-hitos-tratamiento.sql');
    return;
  }
  hitosCache = data || [];
  const skinByDate = {};
  ((notasRes && notasRes.data) || []).forEach(r => { if (r.skin_state) skinByDate[r.note_date] = r.skin_state; });
  const reaccionesHTML = buildReaccionesHTML(skinByDate);
  // Los inicios de producto salen de allProducts: ya está en memoria.
  const inicios = allProducts
    .filter(p => p.started_at)
    .map(p => ({ _auto: true, event_date: p.started_at, event_type: 'producto_inicio',
                 title: `Empecé ${p.name}`, emoji: p.emoji }));
  const todos = [...hitosCache.map(h => ({ ...h, _auto: false })), ...inicios]
    .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
  const filas = todos.map(h => {
    const t = h._auto ? { e: h.emoji || '🆕', l: 'Empecé a usarlo' } : hitoType(h.event_type);
    const acciones = h._auto ? '' :
      `<button class="hito-del" onclick="openHitoModal('${h.id}')" title="Editar">✏️</button>
       <button class="hito-del" onclick="deleteHito('${h.id}')" title="Eliminar">🗑️</button>`;
    return `<div class="hito-row${h._auto ? ' hito-auto' : ''}">
  <div class="hito-icon">${esc(t.e)}</div>
  <div class="hito-body">
    <div class="hito-title">${esc(h.title)}</div>
    <div class="hito-meta">${fmtDate(h.event_date)} · ${esc(t.l)}</div>
    ${h.notes ? `<div class="hito-notes">${fmtRich(h.notes)}</div>` : ''}
  </div>
  <div class="hito-actions">${acciones}</div>
</div>`;
  }).join('');
  el.innerHTML = reaccionesHTML + `<div class="logs-card">
  <h3>🗓️ Línea de tiempo del tratamiento</h3>
  <div class="hito-intro">Marca aquí lo que pueda explicar un cambio en tu piel. Las entradas en gris se generan solas desde la fecha de inicio de cada producto.</div>
  <button class="mini-action-btn" onclick="openHitoModal()">＋ Agregar hito</button>
  ${filas || '<div class="empty-state">Aún no hay hitos registrados.</div>'}
</div>`;
}

function openHitoModal(id) {
  const h = id ? hitosCache.find(x => x.id === id) : null;
  document.getElementById('hito-modal-title').textContent = h ? '✏️ Editar hito' : '＋ Nuevo hito';
  document.getElementById('hf-id').value = h ? h.id : '';
  document.getElementById('hf-type').innerHTML =
    HITO_TYPES.map(t => `<option value="${t.v}"${h && h.event_type === t.v ? ' selected' : ''}>${t.e} ${esc(t.l)}</option>`).join('');
  document.getElementById('hf-date').value = h ? h.event_date : TODAY_STR;
  document.getElementById('hf-title').value = h ? h.title : '';
  document.getElementById('hf-notes').value = h ? (h.notes || '') : '';
  document.getElementById('hf-product').innerHTML =
    '<option value="">— Ninguno —</option>' +
    allProducts.map(p => `<option value="${p.id}"${h && h.product_id === p.id ? ' selected' : ''}>${esc(prodLabelText(p))}</option>`).join('');
  openModal('hito-modal');
}

async function saveHito() {
  const id    = document.getElementById('hf-id').value;
  const row = {
    event_type: document.getElementById('hf-type').value,
    event_date: document.getElementById('hf-date').value,
    title:      document.getElementById('hf-title').value.trim(),
    notes:      document.getElementById('hf-notes').value.trim() || null,
    product_id: document.getElementById('hf-product').value || null
  };
  if (!row.title)      { showToast('⚠️ Escribe un título', 'error'); return; }
  if (!row.event_date) { showToast('⚠️ Elige una fecha', 'error'); return; }
  const btn = document.getElementById('save-hito-btn');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  const { error } = id
    ? await db.from('treatment_events').update(row).eq('id', id)
    : await db.from('treatment_events').insert(row);
  btn.disabled = false; btn.textContent = 'Guardar hito';
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  closeModal('hito-modal');
  showToast(id ? '✅ Hito actualizado' : '✅ Hito guardado', 'success');
  await loadHitos();
}

async function deleteHito(id) {
  const h = hitosCache.find(x => x.id === id);
  const ok = await confirmSheet(`¿Eliminar "${h ? h.title : 'este hito'}"?`, 'Eliminar');
  if (!ok) return;
  const { error } = await db.from('treatment_events').delete().eq('id', id);
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  showToast('🗑️ Hito eliminado', '');
  await loadHitos();
}

// ── MODALS ───────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
// Confirmación estilo bottom-sheet (reemplaza al confirm() nativo).
let _confirmResolve = null;
function confirmSheet(message, okLabel) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-msg').textContent = message;
    document.getElementById('confirm-ok').textContent = okLabel || 'Eliminar';
    openModal('confirm-modal');
  });
}
function confirmAnswer(v) {
  closeModal('confirm-modal');
  if (_confirmResolve) { const r = _confirmResolve; _confirmResolve = null; r(v); }
}
let currentPickerStepId = null;
function routineStepIdFromPickerStepId(pickerStepId) {
  if (!pickerStepId) return null;
  const el = document.getElementById(pickerStepId);
  return el ? (el.dataset.routineStepId || null) : null;
}
function markPickerStepDone(productName) {
  if (!currentPickerStepId) return;
  const step = document.getElementById(currentPickerStepId);
  if (step) {
    if (!step.classList.contains('done')) {
      step.classList.add('done');
      const sb = step.closest('.sec-body');
      if (sb) updateProgress(sb.id);
    }
    if (productName) showStepProduct(step, productName);
  }
  currentPickerStepId = null;
}
function showStepProduct(step, productName) {
  const sc = step.querySelector('.sc');
  if (!sc) return;
  const prod = productByLoggedName(productName);
  const why = (prod && prod.why_it_works)
    ? `<div class="sc-picked-why">💡 ${fmtRich(prod.why_it_works)}</div>` : '';
  const html = `<div class="sc-picked">
  <div class="sc-picked-name">✓ ${loggedLabelHTML(productName)}</div>
  ${why}
  <div class="sc-picked-change">Toca para cambiar →</div>
</div>`;
  const hint = sc.querySelector('.sc-pick-hint');
  if (hint) hint.remove();
  const existing = sc.querySelector('.sc-picked');
  if (existing) existing.outerHTML = html;
  else sc.insertAdjacentHTML('beforeend', html);
}

// ── ZONAS EN EL PASO: MOSTRARLAS Y CORREGIRLAS ───────────────────────────────
// El paso de producto FIJO no abre picker (marcar debe seguir siendo un toque),
// así que registra con las zonas por defecto y las muestra debajo. Ese renglón
// es el editor: se toca y se corrigen, sin sumar fricción al caso normal.
//
// El estado va en un Map por id de elemento y NO en data-attributes: son arrays
// de ids que tendrían que escaparse a mano dentro de un onclick, y ese es el
// patrón que ya causó bugs de escaping (regla 2).
const _stepZonas = new Map();
function setStepZonas(stepElId, appIds, zonas, aptas) {
  if (!stepElId) return;
  _stepZonas.set(stepElId, {
    ids: (appIds || []).filter(Boolean),
    zonas: zonas || [],
    aptas: (aptas && aptas.length) ? aptas : (zonas || [])
  });
  renderStepZonasRow(stepElId);
}
function stepZonasRowHTML(stepElId) {
  const st = _stepZonas.get(stepElId);
  if (!st || !st.zonas.length) return '';
  // Sin id de fila no hay nada que actualizar (registro encolado offline o
  // hidratado por un fallback que no identifica la fila): se muestra, pero no
  // se ofrece editar — prometer un editor que no puede guardar es peor.
  const editable = st.ids.length > 0;
  const lapiz = editable ? `<span class="sc-zonas-edit">✎</span>` : '';
  const click = editable
    ? ` onclick="event.stopPropagation(); openZonasEditorFromStep('${cssSafe(stepElId)}')"`
    : ' onclick="event.stopPropagation()"';
  return `<div class="sc-zonas${editable ? ' sc-zonas-editable' : ''}"${click}>
  <span class="sc-zonas-list">📍 ${esc(st.zonas.map(zonaLabel).join(' · '))}</span>${lapiz}
</div>`;
}
function renderStepZonasRow(stepElId) {
  const step = document.getElementById(stepElId);
  if (!step) return;
  const sc = step.querySelector('.sc');
  if (!sc) return;
  const html = stepZonasRowHTML(stepElId);
  const existing = sc.querySelector('.sc-zonas');
  if (existing) {
    if (html) existing.outerHTML = html; else existing.remove();
  } else if (html) {
    sc.insertAdjacentHTML('beforeend', html);
  }
}
function clearStepZonas(stepElId) {
  _stepZonas.delete(stepElId);
  const step = document.getElementById(stepElId);
  const existing = step && step.querySelector('.sc-zonas');
  if (existing) existing.remove();
}
// Al re-renderizar el día, las zonas se reconstruyen de las filas del propio
// registro (buildHydration.byStepIdApps). Los registros previos a la columna
// traen zones null: se muestran las de PRODUCT_ZONAS, que es exactamente lo que
// el motor está usando para ellos — y si las corriges, quedan explícitas.
function registerStepZonasFromRows(stepElId, rows) {
  if (!rows || !rows.length) return '';
  const zonasPorFila = rows.map(r => {
    if (Array.isArray(r.zones) && r.zones.length) return r.zones;
    return (typeof PRODUCT_ZONAS !== 'undefined' && PRODUCT_ZONAS[r.product_id]) || [];
  });
  const aptas = rows.map(r => {
    const p = r.product_id ? allProducts.find(x => x.id === r.product_id) : productByLoggedName(r.product_name);
    return (p && typeof zonasAptasDe === 'function') ? zonasAptasDe(p) : [];
  });
  const zonas = unionZonas(zonasPorFila, ZONAS_ORDEN);
  if (!zonas.length) return '';
  _stepZonas.set(stepElId, {
    ids: rows.map(r => r.id).filter(Boolean),
    zonas,
    aptas: unionZonas(aptas, ZONAS_ORDEN)
  });
  return stepZonasRowHTML(stepElId);
}
let _zonaEdit = { stepElId: null, ids: [], sel: new Set(), aptas: [] };
function openZonasEditorFromStep(stepElId) {
  const st = _stepZonas.get(stepElId);
  if (!st || !st.ids.length) return;
  _zonaEdit = {
    stepElId,
    ids: st.ids.slice(),
    sel: new Set(st.zonas),
    aptas: (st.aptas && st.aptas.length) ? st.aptas : st.zonas.slice()
  };
  const sub = document.getElementById('zonas-modal-sub');
  if (sub) sub.textContent = st.ids.length > 1
    ? `Se aplicará a los ${st.ids.length} registros de este paso.`
    : 'Corrige dónde te lo aplicaste.';
  renderZonasEditorChips();
  openModal('zonas-modal');
}
function renderZonasEditorChips() {
  const wrap = document.getElementById('zonas-modal-chips');
  if (!wrap) return;
  wrap.innerHTML = _zonaEdit.aptas.map(z => {
    const on = _zonaEdit.sel.has(z);
    return `<button type="button" class="zone-chip${on ? ' zone-chip-on' : ''}"
  onclick="event.stopPropagation(); toggleZonaEdit('${cssSafe(z)}')">${esc(zonaLabel(z))}</button>`;
  }).join('');
  const btn = document.getElementById('zonas-modal-save');
  if (btn) {
    btn.disabled = _zonaEdit.sel.size === 0;
    btn.textContent = _zonaEdit.sel.size ? 'Guardar zonas' : '📍 Elige al menos una zona';
  }
}
function toggleZonaEdit(z) {
  if (_zonaEdit.sel.has(z)) _zonaEdit.sel.delete(z); else _zonaEdit.sel.add(z);
  renderZonasEditorChips();
}
async function saveZonasEditor() {
  const zonas = ordenarZonas([..._zonaEdit.sel], ZONAS_ORDEN);
  if (!zonas.length || !_zonaEdit.ids.length) return;
  const stepElId = _zonaEdit.stepElId;
  const previas = (_stepZonas.get(stepElId) || {}).zonas || [];
  const st = _stepZonas.get(stepElId);
  // Optimista con rollback (regla 3): se pinta ya, y si Supabase falla vuelve
  // a lo anterior en vez de dejar en pantalla una zona que no se guardó.
  if (st) { st.zonas = zonas; renderStepZonasRow(stepElId); }
  closeModal('zonas-modal');
  const { error } = await db.from('product_applications')
    .update({ zones: zonas }).in('id', _zonaEdit.ids);
  if (error) {
    if (st) { st.zonas = previas; renderStepZonasRow(stepElId); }
    showToast('❌ ' + error.message, 'error');
    return;
  }
  historyLoaded = false;
  showToast('📍 Zonas actualizadas', 'success');
}

// ── PICKERS ──────────────────────────────────────────────────────────────────
// Texto sobre el que busca el filtro del picker: nombre, marca y etiquetas.
function searchKeyOf(p) {
  return esc([p.name, p.brand, p.category, ...tagsOf(p).map(t => t.label)]
    .filter(Boolean).join(' ').toLowerCase());
}
// Con 93 productos, varias categorías pasan de una pantalla. El buscador solo
// aparece cuando la lista lo amerita: en una lista de 3 estorba (mejora #7).
const PICKER_SEARCH_MIN = 6;
function pickerSearchHTML(n) {
  return n >= PICKER_SEARCH_MIN
    ? `<input class="picker-search" type="search" placeholder="🔍 Buscar entre ${n} productos..." oninput="filterPicker(this)" autocomplete="off">`
    : '';
}
function filterPicker(input) {
  const q = input.value.trim().toLowerCase();
  const body = input.closest('.modal-body');
  if (!body) return;
  let visibles = 0;
  body.querySelectorAll('.spf-item').forEach(el => {
    const ok = !q || (el.dataset.search || '').includes(q);
    el.style.display = ok ? '' : 'none';
    if (ok) visibles++;
  });
  let vacio = body.querySelector('.picker-empty');
  if (!visibles) {
    if (!vacio) {
      vacio = document.createElement('div');
      vacio.className = 'picker-empty empty-state';
      input.insertAdjacentElement('afterend', vacio);
    }
    vacio.textContent = `Ningún producto coincide con "${q}".`;
    vacio.style.display = '';
  } else if (vacio) {
    vacio.style.display = 'none';
  }
}
// ── MULTI PICKER ─────────────────────────────────────────────────────────────
// TODO paso que se resuelve por CATEGORÍA (picker_category) abre este picker:
// eliges uno o varios productos y se registra UNA fila por cada uno, todas con
// el mismo routine_step_id (la hidratación las concatena con " · ").
// Antes existía una lista blanca (MULTI_PICK_CATEGORIES = Toners + Serums AM) y
// tres pickers distintos; se unificaron porque cualquier categoría puede
// llevarse en capas. No reintroducir la lista blanca.
//
// PICKER_MODALS: lo ÚNICO que cambia por categoría es en qué modal se pinta,
// qué aviso clínico lleva arriba y si tiene botón extra abajo. Todo lo demás
// (selección múltiple, buscador, registro) es idéntico.
const PICKER_MODALS = {
  '🌞 SPF Facial': {
    modal: 'spf-modal', body: 'spf-picker-body',
    // El SPF facial no filtra no_reapp NUNCA, ni siquiera fuera de un paso de
    // rutina: reaplicar es justo el punto.
    ignoreNoReapp: true,
    filter: p => p.status !== 'out',
    warn: `<div style="background:#FFF3E0;border-left:3px solid #D4820A;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#7A4A00;line-height:1.5;">
  <strong>⚠️ NO NEGOCIABLE para manchas solares.</strong> El UV es la causa directa de los sunspots — sin SPF diario, los despigmentantes aclaran mientras el sol vuelve a pigmentar.
</div>`,
    footer: `<button class="spf-guide-btn" onclick="event.stopPropagation(); closeModal('spf-modal'); openCompare()">📊 Ver comparativa técnica →</button>`
  },
  '☀️ SPF Corporal': {
    modal: 'body-spf-modal', body: 'body-spf-picker-body',
    ignoreNoReapp: true,
    filter: p => p.status !== 'out',
    warn: `<div style="background:#FFF3E0;border-left:3px solid #D4820A;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#7A4A00;line-height:1.5;">
  <strong>⚠️ Las manchas en brazos son UV-triggered</strong> — el mismo mecanismo que los sunspots de la cara. Sin SPF corporal diario no van a mejorar sin importar lo que apliques.
</div>`
  }
};
// `cfg.filter` responde SOLO "¿está disponible?". El `no_reapp` se aplica
// aparte, en openMultiPickerByCat, porque depende del CONTEXTO y no del
// producto: ver el comentario de ahí.
const PICKER_MODAL_DEFAULT = {
  modal: 'product-picker-modal', body: 'product-picker-body', title: 'product-picker-title',
  filter: p => p.status !== 'out'
};
function pickerModalOf(cat) {
  return Object.assign({}, PICKER_MODAL_DEFAULT, PICKER_MODALS[cat] || {});
}
// Hora local que separa AM de PM al deducir a qué sección pertenece un registro
// que NO trae routine_step_id (reaplicaciones y registros sueltos). Evita que
// un toner de la mañana marque el paso "Toners" de la rutina de noche.
const AM_PM_CUTOFF_HOUR = 15;
let multiPickSelected = new Set();
let multiPickModalId = 'product-picker-modal';
// ── MULTIPICKER DE ZONA ──────────────────────────────────────────────────────
// La columna `zones` existía y el motor ya la leía, pero NADA la escribía: todo
// se calculaba con PRODUCT_ZONAS. Esto es lo que la escribe.
//
// Comportamiento pedido: PRESELECCIONADO Y EDITABLE. Los chips se rellenan
// solos con las zonas habituales de lo que vas eligiendo, así que el caso
// normal no suma ni un toque; en cuanto tocas un chip, `zonePickDirty` se
// enciende y la preselección deja de pisarte la elección. Ese flag es todo el
// truco: sin él, elegir un segundo producto revertía lo que acababas de marcar.
let zonePickSel = new Set();
let zonePickDirty = false;
let zonePickCat = '';
function zonasCandidatasDeCat(cat, items) {
  // Unión de la aptitud de los productos QUE SE VEN en el picker, no la tabla
  // de categorías: así un override (jabón de manos catalogado como Limpieza)
  // aporta su zona sin tener que duplicar la excepción aquí.
  const porCat = (typeof ZONAS_APTAS_POR_CATEGORIA !== 'undefined' && ZONAS_APTAS_POR_CATEGORIA[cat]) || [];
  const deItems = (items || []).map(p => (typeof zonasAptasDe === 'function') ? zonasAptasDe(p) : []);
  return unionZonas([porCat].concat(deItems), ZONAS_ORDEN);
}
function zonePickProductosElegidos() {
  return [...multiPickSelected].map(productByLoggedName).filter(Boolean);
}
// Preselección: unión de las zonas habituales de lo elegido. Sin nada elegido
// todavía no adivina — los chips se ven apagados y el botón pide seleccionar.
function syncZonePickFromSelection() {
  if (zonePickDirty) return;
  const prods = zonePickProductosElegidos();
  const defs = prods.map(p => (typeof PRODUCT_ZONAS !== 'undefined' && PRODUCT_ZONAS[p.id]) || []);
  zonePickSel = new Set(unionZonas(defs, ZONAS_ORDEN));
}
function renderZonePickChips() {
  const wrap = document.getElementById('zone-pick-chips');
  if (!wrap) return;
  const candidatas = zonasCandidatasDeCat(zonePickCat, allProducts.filter(p => p.category === zonePickCat));
  const prods = zonePickProductosElegidos();
  const aptasElegidas = new Set(unionZonas(
    prods.map(p => (typeof zonasAptasDe === 'function') ? zonasAptasDe(p) : []), ZONAS_ORDEN));
  wrap.innerHTML = candidatas.map(z => {
    const on = zonePickSel.has(z);
    // Apagado (no bloqueado): ninguno de los productos elegidos va ahí. Se deja
    // tocable porque puedes marcar la zona antes que el producto.
    const na = prods.length && !aptasElegidas.has(z);
    return `<button type="button" class="zone-chip${on ? ' zone-chip-on' : ''}${na ? ' zone-chip-na' : ''}"
  onclick="event.stopPropagation(); toggleZonePick('${cssSafe(z)}')">${esc(zonaLabel(z))}</button>`;
  }).join('');
  const sub = document.getElementById('zone-pick-sub');
  if (sub) {
    sub.textContent = zonePickSel.size
      ? [...zonePickSel].map(zonaLabel).join(' · ')
      : 'Elige un producto y se marcan solas tus zonas de siempre.';
  }
}
function toggleZonePick(z) {
  zonePickDirty = true;
  if (zonePickSel.has(z)) zonePickSel.delete(z); else zonePickSel.add(z);
  renderZonePickChips();
  updateMultiPickBtn();
}
function updateMultiPickBtn() {
  const btn = document.getElementById('multi-pick-btn');
  if (!btn) return;
  const nP = multiPickSelected.size, nZ = zonePickSel.size;
  btn.disabled = nP === 0 || nZ === 0;
  if (!nP) { btn.textContent = 'Aplicar seleccionados'; return; }
  if (!nZ) { btn.textContent = '📍 Elige al menos una zona'; return; }
  btn.textContent = `Aplicar ${nP} en ${nZ === 1 ? [...zonePickSel].map(zonaLabel)[0] : nZ + ' zonas'}`;
}
function multiPickItemHTML(p, degradado) {
  const logName = p.logged_as || `${p.emoji} ${p.name}`;
  // `degradado` = va al final de la lista por `no_reapp`. Se marca visualmente
  // para que se entienda por qué está hasta abajo, pero se puede elegir igual.
  const nota = degradado
    ? `<div class="spf-item-noreapp">· no suele reaplicarse — regístralo igual si te lo pusiste</div>` : '';
  return `<div class="spf-item tier-${cssSafe(p.tier)} multi-pick${degradado ? ' multi-pick-degradado' : ''}" data-name="${esc(logName)}" data-search="${searchKeyOf(p)}" onclick="toggleMultiPick(this)">
  <div class="spf-item-name"><span class="multi-pick-check">○</span> ${prodLabelHTML(p)}</div>
  ${nota}
  <div class="spf-item-tags">${tagsOf(p).map(t => `<span class="spf-tag spf-tag-${cssSafe(t.cls)}">${esc(t.label)}</span>`).join('')}</div>
  <div class="spf-item-note">${fmtRich(p.note || '')}</div>
</div>`;
}
function openMultiPickerByCat(stepId, cat) {
  const cfg = pickerModalOf(cat);
  currentPickerStepId = stepId;
  multiPickSelected = new Set();
  multiPickModalId = cfg.modal;
  if (cfg.title) {
    const t = document.getElementById(cfg.title);
    if (t) t.textContent = cat;
  }
  const body = document.getElementById(cfg.body);
  if (!body) { showToast('❌ Picker no disponible', 'error'); return; }
  // `no_reapp` YA NO ESCONDE A NADIE: DEGRADA.
  //
  // La bandera nació para la rejilla de reaplicación ("no me ofrezcas esto para
  // volver a ponérmelo a media tarde"). Cuando el picker se unificó, pasó a
  // esconder la tretinoína también del paso de rutina "Activos", donde sí tiene
  // que estar — una bandera que responde una pregunta usada para contestar otra.
  //
  // Esconderla del camino LIBRE tampoco se sostiene: la regla 1 dice que el
  // progreso mide DOSIS, no obediencia, y un producto que no se puede registrar
  // fuera de la rutina es un producto invisible para el motor. Es exactamente
  // el fallo que originó la Fase B (33 de 74 productos invisibles).
  //
  // Así que fuera de un paso de rutina baja al final de la lista con una nota,
  // en vez de desaparecer. Decisión de la usuaria, 2026-07-26.
  const degradar = p => !stepId && !cfg.ignoreNoReapp && !!p.no_reapp;
  const items = allProducts.filter(p => p.category === cat && cfg.filter(p))
    .sort((a, b) => (degradar(a) ? 1 : 0) - (degradar(b) ? 1 : 0));
  zonePickCat = cat;
  zonePickSel = new Set();
  zonePickDirty = false;
  const hint = `<div class="multi-pick-hint">Toca los que aplicaste — puedes elegir varios.</div>`;
  const zonaBlock = `<div class="zone-pick">
  <div class="zone-pick-label">📍 ¿Dónde te lo aplicaste?</div>
  <div class="zone-pick-chips" id="zone-pick-chips"></div>
  <div class="zone-pick-sub" id="zone-pick-sub"></div>
</div>`;
  body.innerHTML = (cfg.warn || '') + hint + zonaBlock + pickerSearchHTML(items.length) +
    (items.length
      ? items.map(p => multiPickItemHTML(p, degradar(p))).join('')
      : '<div class="empty-state">No hay productos de esta categoría en Stock todavía.</div>') +
    `<button class="save-btn" id="multi-pick-btn" onclick="confirmMultiPick()" disabled style="margin-top:6px;margin-bottom:0">Aplicar seleccionados</button>` +
    (cfg.footer || '');
  renderZonePickChips();
  updateMultiPickBtn();
  openModal(cfg.modal);
}
// Único wrapper que sobrevive: lo llama el recordatorio de reaplicar SPF, que
// abre el picker sin paso de rutina asociado.
function openSPFPicker(stepId = null) { openMultiPickerByCat(stepId, '🌞 SPF Facial'); }
function toggleMultiPick(el) {
  const name = el.dataset.name;
  const check = el.querySelector('.multi-pick-check');
  if (multiPickSelected.has(name)) {
    multiPickSelected.delete(name);
    el.classList.remove('multi-on');
    if (check) check.textContent = '○';
  } else {
    multiPickSelected.add(name);
    el.classList.add('multi-on');
    if (check) check.textContent = '●';
  }
  syncZonePickFromSelection();
  renderZonePickChips();
  updateMultiPickBtn();
}
async function confirmMultiPick() {
  const names = [...multiPickSelected];
  const zonasElegidas = [...zonePickSel];
  if (!names.length || !zonasElegidas.length) return;
  multiPickSelected = new Set();
  const source = currentPickerStepId ? 'rutina' : 'reaplicacion';
  const routineStepId = routineStepIdFromPickerStepId(currentPickerStepId);
  const stepElId = currentPickerStepId;
  closeModal(multiPickModalId);
  markPickerStepDone(names.join(' · '));
  let okCount = 0;
  const appIds = [];
  const zonasEscritas = [];
  const ajustados = [];
  for (const name of names) {
    selectedProduct = name;
    // Cada producto se queda con la parte de lo elegido que le sirve: marcar
    // "cara + manos" con una crema de manos en la tanda no la registra en cara.
    const zonasProd = zonasDeNombre(name, zonasElegidas);
    if (zonasProd.length !== zonasElegidas.length) ajustados.push(name);
    zonasEscritas.push(...zonasProd);
    const ok = await logApplication(source, routineStepId, zonasElegidas);
    if (ok) okCount++;
    if (ok && ok !== true && ok !== 'queued') appIds.push(ok);
  }
  if (okCount && stepElId) {
    setStepZonas(stepElId, appIds, unionZonas([zonasEscritas], ZONAS_ORDEN),
      unionZonas(names.map(zonasAptasDeNombre), ZONAS_ORDEN));
  }
  // Rollback del checkmark solo si NINGUNO se pudo registrar.
  if (okCount === 0 && stepElId) {
    const step = document.getElementById(stepElId);
    if (step) {
      step.classList.remove('done');
      const sb = step.closest('.sec-body');
      if (sb) updateProgress(sb.id);
    }
  } else if (okCount > 1) {
    showToast(`✅ ${okCount} productos registrados`, 'success');
  }
  // Aviso, no corrección silenciosa: si algo no iba donde marcaste, se dice.
  // VA AL FINAL a propósito: showToast reemplaza el aviso anterior, y puesto
  // antes lo tapaba el "✅ N productos registrados" en cuanto había varios.
  if (okCount && ajustados.length) {
    showToast(`📍 ${ajustados.length} producto(s) se registraron en su zona habitual`, '');
  }
}
// ── SPF COMPARE TABLE ────────────────────────────────────────────────────────
const COMPARE_COLS = [
  { id:'uvb',
    label:'UVB',
    title:'UVB — Rayos que queman (290–320 nm)',
    desc:'El número SPF mide exclusivamente la protección contra UVB. SPF 50 bloquea el 98% de estos rayos. Son los responsables de las quemaduras solares.',
    melasma:'Causa principal de los sunspots: los lentigos solares son daño UV acumulado. Sin protección UVB diaria, las manchas nuevas siguen apareciendo y las tratadas se re-pigmentan.' },
  { id:'uva',
    label:'UVA',
    title:'UVA Básico — Rayos de envejecimiento (320–370 nm)',
    desc:'Penetran nubes, vidrio y se mantienen presentes todo el año, incluso en días nublados o en interiores cerca de ventanas. Causan manchas y envejecimiento prematuro.',
    melasma:'Contribuye directo al fotoenvejecimiento y a la pigmentación de los lentigos. Además, usar tretinoína sin buena protección UVA anula gran parte del beneficio.' },
  { id:'uvalong',
    label:'UVA Largos',
    title:'UVA de Onda Larga (370–400 nm)',
    desc:'La fracción más profunda del espectro UVA. La mayoría de los filtros solares tradicionales no cubren este rango. Filtros como Tinosorb M, Mexoryl XL o Bemotrizinol lo alcanzan.',
    melasma:'Suma cobertura real contra el daño acumulativo que forma sunspots. L\'Oréal UV Defender y Eucerin Pigment Control cubren este rango.' },
  { id:'uva400',
    label:'UVA 400nm',
    title:'UVA 400nm — Cobertura UV completa hasta el límite con la luz visible',
    desc:'El filtro Mexoryl 400 (patente exclusiva de L\'Oréal / LRP UVMune 400) extiende la cobertura UV hasta exactamente 400nm — el límite exacto donde termina el UV y empieza la luz visible. Ningún otro filtro llega tan lejos.',
    melasma:'La cobertura UV más completa disponible — cierra el "gap" de 380–400nm de casi todos los SPF del mercado. Para sunspots es un plus sólido (aunque menos decisivo que en melasma).' },
  { id:'pa4',
    label:'PA++++',
    title:'PA++++ — Sistema asiático de clasificación UVA',
    desc:'Sistema de clasificación japonés/coreano basado en el índice PPD (Persistent Pigment Darkening). PA++++ es la categoría máxima y equivale a PPD ≥ 16. Los SPF europeos a veces usan el sello de círculo UVA en lugar del sistema PA.',
    melasma:'Imprescindible: garantiza protección UVA robusta y estandarizada contra el daño acumulativo que produce y re-pigmenta los lentigos.' },
  { id:'vis',
    label:'Luz Visible',
    title:'Luz Visible — Óxidos de hierro (400–700 nm)',
    desc:'Solo las fórmulas tintadas (con óxidos de hierro o pigmentos minerales) bloquean la luz visible. Las fórmulas transparentes —sin importar cuán alto sea el SPF— no ofrecen protección en este rango.',
    melasma:'Para sunspots la luz visible pesa MENOS que en melasma (los lentigos son primariamente UV). El tinte sigue sumando en pieles III–VI y da acabado uniforme, pero ya no es crítico — elige por comodidad.' },
  { id:'ira',
    label:'IR-A',
    title:'Infrarrojo A — Calor profundo (700–1400 nm)',
    desc:'Radiación infrarroja que penetra hasta la dermis profunda y genera calor en los tejidos. Solo algunos filtros avanzados como el Heliocare 360 (con tecnología Fernblock) ofrecen protección en este rango.',
    melasma:'En sunspots el calor tiene un papel menor (a diferencia del melasma, donde sí es detonante). Es un extra agradable, no un criterio de compra.' },
  { id:'act',
    label:'Activo ✦',
    title:'Activo Despigmentante — Thiamidol (Eucerin)',
    desc:'El único SPF de este arsenal que no solo protege sino que trata activamente las manchas existentes. El Thiamidol inhibe la tirosinasa (enzima que produce melanina) con eficacia clínicamente comparable a la hidroquinona al 2%, sin sus efectos adversos.',
    melasma:'El Thiamidol tiene evidencia también en lentigos solares: protege y aclara a la vez. Doble función ideal para sunspots.' },
];
// La tabla ya NO está escrita a mano: se deriva de los tags reales de tus
// productos en Stock (antes un SPF nuevo jamás aparecía aquí). Mapeo:
//   uva400→UVA 400nm (implica UVA Largos), uvalong→UVA Largos, pa4→PA++++,
//   tinted→Luz Visible, ira→IR-A, treats→Activo despigmentante.
// UVA básico se marca si tiene pa4/uvalong/uva400. Para que un producto
// muestre IR-A, agrégale en la base un tag {cls:'ira', label:'IR-A'}.
function compareRowsFromProducts() {
  const isSpf = p => p.category === '🌞 SPF Facial' || p.category === '☀️ SPF Corporal' ||
    (p.category === '💋 Labios' && /spf/i.test(p.name || ''));
  const areaOf = p => p.category === '☀️ SPF Corporal' ? 'Cuerpo' : (p.category === '💋 Labios' ? 'Labios' : 'Cara');
  const tierRank = { best: 0, good: 1, ok: 2 };
  return allProducts.filter(isSpf).map(p => {
    const cls = new Set(tagsOf(p).map(t => t.cls));
    const row = {
      // label ya viene con marca + nombre; `name` se conserva plano para ordenar.
      name: `${p.emoji || ''} ${p.name}`.trim(),
      label: prodLabelHTML(p),
      area: areaOf(p),
      tier: tierRank[p.tier] != null ? p.tier : 'ok',
      uvb: 1,
      uva400: cls.has('uva400') ? 1 : 0,
      uvalong: (cls.has('uvalong') || cls.has('uva400')) ? 1 : 0,
      pa4: cls.has('pa4') ? 1 : 0,
      vis: cls.has('tinted') ? 1 : 0,
      ira: cls.has('ira') ? 1 : 0,
      act: cls.has('treats') ? 1 : 0,
    };
    row.uva = (row.pa4 || row.uvalong || row.uva400) ? 1 : 0;
    return row;
  }).sort((a, b) => a.area.localeCompare(b.area) || tierRank[a.tier] - tierRank[b.tier] ||
    (COMPARE_COLS.reduce((s, c) => s + (b[c.id] || 0), 0) - COMPARE_COLS.reduce((s, c) => s + (a[c.id] || 0), 0)));
}
let activeCompareCol = null;
function openCompare() {
  activeCompareCol = null;
  const body = document.getElementById('compare-body');
  const rows = compareRowsFromProducts();
  const tierColor = { best:'#3A8A3A', good:'#C4818A', ok:'#9A9090' };
  const tierDot   = r => `<span style="color:${tierColor[r.tier]};font-size:10px;margin-right:4px">●</span>`;
  const areaTag   = a => `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;background:#F0EBE8;color:#9A8888;margin-left:4px">${a}</span>`;
  const chk = v => v
    ? `<td style="text-align:center;padding:7px 4px"><span style="color:#3A8A3A;font-size:15px;font-weight:800">✓</span></td>`
    : `<td style="text-align:center;padding:7px 4px"><span style="color:#E0D8D8;font-size:12px">—</span></td>`;
  const thead = `<tr style="border-bottom:2px solid #F0EBE8">
  <th style="text-align:left;padding:8px 10px 8px 4px;font-size:11px;color:#7A6E6A;font-weight:700;white-space:nowrap;min-width:130px">Producto</th>
  ${COMPARE_COLS.map(c => `<th onclick="showColInfo('${c.id}')" style="text-align:center;padding:6px 3px;font-size:10px;font-weight:700;color:#7A5A5A;cursor:pointer;white-space:pre-line;min-width:36px;user-select:none" title="${esc(c.title)}">${c.label}<br><span style="color:#C4818A;font-size:9px">ⓘ</span></th>`).join('')}
</tr>`;
  const tbody = rows.map(r => `<tr style="border-bottom:1px solid #F8F4F0">
  <td style="padding:7px 8px 7px 4px;font-size:11px;font-weight:600;color:#2A2420;white-space:nowrap">${tierDot(r)}${r.label || esc(r.name)}${areaTag(r.area)}</td>
  ${COMPARE_COLS.map(c => chk(r[c.id])).join('')}
</tr>`).join('');
  body.innerHTML = `
<p style="font-size:11px;color:#9A8888;margin-bottom:12px;line-height:1.5">Toca el encabezado de cada columna para ver qué es y por qué importa para tus manchas solares. La tabla se genera de los tags de tus productos en Stock.</p>
<div id="col-info-box" style="display:none;background:#F5F0FA;border-left:3px solid #7A5A9A;border-radius:10px;padding:12px 14px;margin-bottom:14px"></div>
<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
  <table style="width:100%;border-collapse:collapse;font-family:inherit">
    <thead>${thead}</thead>
    <tbody>${tbody || ''}</tbody>
  </table>
  ${rows.length ? '' : '<div class="empty-state">No hay productos SPF en Stock todavía.</div>'}
</div>
<div style="margin-top:12px;display:flex;gap:12px;font-size:10px;color:#9A8888">
  <span><span style="color:#3A8A3A">●</span> Mejor opción</span>
  <span><span style="color:#C4818A">●</span> Buena opción</span>
  <span><span style="color:#9A9090">●</span> Aceptable</span>
</div>`;
  openModal('compare-modal');
}
function showColInfo(colId) {
  const box = document.getElementById('col-info-box');
  if (!box) return;
  const col = COMPARE_COLS.find(c => c.id === colId);
  if (!col) return;
  if (activeCompareCol === colId) {
    box.style.display = 'none';
    activeCompareCol = null;
    return;
  }
  activeCompareCol = colId;
  box.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:#2A2420;margin-bottom:6px">${col.title}</div>
    <div style="font-size:11px;color:#4A3E3A;line-height:1.65;margin-bottom:8px">${col.desc}</div>
    <div style="background:#EDE8F5;border-radius:7px;padding:7px 10px;font-size:11px;color:#5A3A8A;font-weight:600;line-height:1.5">
      💜 Para tus manchas: ${col.melasma}
    </div>`;
  box.style.display = 'block';
  box.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── UI ───────────────────────────────────────────────────────────────────────
function toggleSec(id) { document.getElementById(id).classList.toggle('open'); }
function toggleStep(stepId, detId) {
  document.getElementById(stepId).classList.toggle('open');
  document.getElementById(detId).classList.toggle('open');
}
function showTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(e => e.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'photos')  { renderWeekCalendar(); loadSpots(); if (!galleryLoaded) loadPhotoGallery(); }
  if ((name === 'history' || name === 'log') && !historyLoaded) loadHistory();
  if (name === 'history') loadHitos();
  if (name === 'stock'   && !inventoryLoaded) loadInventory();
  if (name === 'routines' && !routinesLoaded) loadRoutines();
}
let toastTimer;
let _undoFn = null;
function showToast(msg, type) {
  const t = document.getElementById('toast');
  _undoFn = null;
  t.textContent = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3000);
}
// Toast con botón Deshacer — usado por deleteApplication.
function showUndoToast(msg, undoFn) {
  const t = document.getElementById('toast');
  _undoFn = undoFn;
  t.innerHTML = esc(msg) + ' <button class="toast-undo" onclick="runUndo()">Deshacer</button>';
  t.className = 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; _undoFn = null; }, 6000);
}
async function runUndo() {
  const fn = _undoFn; _undoFn = null;
  document.getElementById('toast').className = '';
  if (fn) { await fn(); showToast('↩️ Restaurado', 'success'); }
}
function nightCapsule(info) {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;background:${info.bg};color:${info.color};margin-left:3px;vertical-align:middle">${info.label}</span>`;
}

// ── INVENTORY ────────────────────────────────────────────────────────────────
let inventoryLoaded = false;
async function loadInventory() {
  if (!allProducts.length) await loadProducts();
  inventoryLoaded = true;
  renderInventory();
}
// ── FILTROS DE STOCK ─────────────────────────────────────────────────────────
// Estado en memoria, NO en localStorage: la regla 8 reserva localStorage para
// la cola offline y preferencias duraderas. Un filtro es estado de vista — que
// se pierda al recargar es lo correcto, y evita el bug de "abro Stock y me
// faltan productos" porque quedó un filtro puesto de la sesión anterior.
let invFilterCat = '';
let invFilterBrand = '';
let invFilterZona = '';
let invFilterFuncion = '';
// La marca viene con descriptores pegados ('SKIN1004 · centella 50%+HA',
// 'PURITO Seoul · barrera piel sensible'). Se corta en el '·' para que las
// variantes del mismo fabricante agrupen en una sola entrada del filtro.
function invBrandOf(p) { return String(p.brand || '').split('·')[0].trim(); }
// ── ZONA Y FUNCIÓN SEPARADAS, NO EL EJE COMPUESTO ───────────────────────────
// Antes había un solo filtro por EJE ('cuello_textura'), que mezclaba las dos
// preguntas y obligaba a recorrer una lista larguísima de combinaciones. Ahora
// son dos filtros que se componen: "lo que renueva textura" × "en manos".
//
// La ZONA usa `zonasAptasDe` (dónde PUEDE ir), no las zonas de dosis: en Stock
// la pregunta es "qué tengo que pueda usar aquí", no "dónde le he entregado
// estímulo". Es justo la distinción que motivó el refactor.
function invZonasOf(p) {
  return (typeof zonasAptasDe === 'function') ? zonasAptasDe(p) : [];
}
function invFuncionesOf(p) {
  if (typeof PRODUCT_DOSE === 'undefined') return [];
  const pot = PRODUCT_DOSE[p.id];
  return pot ? Object.keys(pot) : [];
}
function invMatches(p) {
  if (invFilterCat && p.category !== invFilterCat) return false;
  if (invFilterBrand && invBrandOf(p) !== invFilterBrand) return false;
  if (invFilterZona && !invZonasOf(p).includes(invFilterZona)) return false;
  if (invFilterFuncion && !invFuncionesOf(p).includes(invFilterFuncion)) return false;
  return true;
}
function setInvFilter(which, value) {
  if (which === 'cat') invFilterCat = value;
  else if (which === 'brand') invFilterBrand = value;
  else if (which === 'zona') invFilterZona = value;
  else if (which === 'funcion') invFilterFuncion = value;
  renderInventory();
}
function clearInvFilters() {
  invFilterCat = ''; invFilterBrand = ''; invFilterZona = ''; invFilterFuncion = '';
  renderInventory();
}
// Las opciones se GENERAN del catálogo real, nunca se hardcodean (regla 5):
// una lista escrita a mano se desincroniza en cuanto se da de alta un producto
// con categoría o marca nueva.
function invFilterBarHTML() {
  const cats = [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort();
  const brands = [...new Set(allProducts.map(invBrandOf).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  // Solo se ofrecen zonas y funciones que algún producto tenga: un desplegable
  // con opciones que no filtran nada hace parecer que el catálogo está vacío.
  const zPres = new Set(); allProducts.forEach(p => invZonasOf(p).forEach(z => zPres.add(z)));
  const fPres = new Set(); allProducts.forEach(p => invFuncionesOf(p).forEach(f => fPres.add(f)));
  // Orden de declaración: ZONAS por `orden`, FUNCIONES como se leen en Progreso.
  const zonas = (typeof ZONAS !== 'undefined' ? Object.keys(ZONAS) : [])
    .filter(z => zPres.has(z)).sort((a, b) => (ZONAS[a].orden || 99) - (ZONAS[b].orden || 99));
  const funcs = (typeof FUNCIONES !== 'undefined' ? Object.keys(FUNCIONES) : []).filter(f => fPres.has(f));
  const opt = (v, label, sel) =>
    `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
  const activos = [invFilterCat, invFilterBrand, invFilterZona, invFilterFuncion].filter(Boolean).length;
  const clearBtn = activos
    ? `<button class="inv-filter-clear" onclick="clearInvFilters()">✕ Limpiar filtros</button>`
    : '';
  return `<div class="inv-filters">
  <select class="inv-filter-sel${invFilterCat ? ' on' : ''}" onchange="setInvFilter('cat', this.value)" aria-label="Filtrar por tipo de producto">
    ${opt('', 'Todo tipo', invFilterCat)}${cats.map(c => opt(c, c, invFilterCat)).join('')}
  </select>
  <select class="inv-filter-sel${invFilterBrand ? ' on' : ''}" onchange="setInvFilter('brand', this.value)" aria-label="Filtrar por marca">
    ${opt('', 'Toda marca', invFilterBrand)}${brands.map(b => opt(b, b, invFilterBrand)).join('')}
  </select>
  <select class="inv-filter-sel${invFilterZona ? ' on' : ''}" onchange="setInvFilter('zona', this.value)" aria-label="Filtrar por zona del cuerpo">
    ${opt('', 'Toda zona', invFilterZona)}${zonas.map(z => opt(z, `${ZONAS[z].icon} ${ZONAS[z].label}`, invFilterZona)).join('')}
  </select>
  <select class="inv-filter-sel${invFilterFuncion ? ' on' : ''}" onchange="setInvFilter('funcion', this.value)" aria-label="Filtrar por función">
    ${opt('', 'Toda función', invFilterFuncion)}${funcs.map(f => opt(f, `${FUNCIONES[f].icon} ${FUNCIONES[f].label}`, invFilterFuncion)).join('')}
  </select>
  ${clearBtn}
</div>`;
}
function renderInventory() {
  const el = document.getElementById('inventory-content');
  if (!el) return;
  const visibles = allProducts.filter(invMatches);
  const filtrando = !!(invFilterCat || invFilterBrand || invFilterZona || invFilterFuncion);
  // El resumen cuenta lo FILTRADO, no el catálogo entero: con un filtro puesto,
  // "3 sin stock" tiene que referirse a lo que estás mirando. Se rotula abajo
  // para que no se confunda con el total.
  const lowCount = visibles.filter(p => p.status === 'low').length;
  const outCount = visibles.filter(p => p.status === 'out').length;
  const okCount  = visibles.length - lowCount - outCount;
  const summaryHTML = `<div class="inv-summary">
  <div class="inv-sum-card"><div class="inv-sum-val">${okCount}</div><div class="inv-sum-lbl">✅ Tengo</div></div>
  <div class="inv-sum-card"><div class="inv-sum-val amber">${lowCount}</div><div class="inv-sum-lbl">⚠️ Reponer</div></div>
  <div class="inv-sum-card"><div class="inv-sum-val red">${outCount}</div><div class="inv-sum-lbl">❌ Sin stock</div></div>
</div>`;
  const filterBar = invFilterBarHTML();
  const metaHTML = filtrando
    ? `<div class="inv-filter-meta">Mostrando <strong>${visibles.length}</strong> de ${allProducts.length} productos</div>`
    : '';
  const addBtn = `<button class="add-prod-btn" onclick="openAddProductModal()">＋ Agregar producto</button>`;
  // ── AVISO DE DERIVA DE LA MATRIZ DE DOSIS ─────────────────────────────────
  // PRODUCT_DOSE es un archivo estático; el catálogo vive en Supabase. Cada
  // producto nuevo nace INVISIBLE para el motor de dosis hasta que se le agrega
  // su fila en activos-matriz.js. Es exactamente el fallo que originó la Fase B
  // (33 de 74 productos no contaban para nada), reapareciendo por otra puerta.
  // Se avisa aquí, en Stock, porque es donde se dan de alta los productos.
  const sinMatriz = (typeof PRODUCT_DOSE !== 'undefined')
    ? allProducts.filter(p => !PRODUCT_DOSE[p.id])
    : [];
  // El id va visible: cuando este aviso aparece hay que ir a pegar una fila en
  // activos-matriz.js, y el id es justo el dato que hace falta. Sin él tocaba
  // ir a buscarlo a Supabase producto por producto.
  const driftHTML = sinMatriz.length ? `<div class="matrix-drift">
  <strong>⚠️ ${sinMatriz.length} producto(s) fuera de la matriz de dosis</strong>
  <div class="matrix-drift-sub">No cuentan para ningún eje de Progreso. Hay que agregarlos a <code>activos-matriz.js</code>:</div>
  <div class="matrix-drift-list">${sinMatriz.map(p => `<div class="matrix-drift-item">${prodLabelHTML(p)} <code>${esc(p.id)}</code></div>`).join('')}</div>
</div>` : '';
  // El aviso de deriva se pinta SIEMPRE contra el catálogo completo, no contra
  // lo filtrado: es una alerta de mantenimiento global y ocultarla porque hay
  // un filtro puesto sería justo la forma de volver a olvidarla.
  const groups = {};
  for (const item of visibles) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }
  const groupsHTML = visibles.length
    ? Object.entries(groups).map(([cat, items]) =>
      `<div class="inv-group">
  <div class="inv-group-hdr">${esc(cat)}</div>
  ${items.map(invItemHTML).join('')}
</div>`).join('')
    : `<div class="inv-empty">Ningún producto coincide con estos filtros.<br><button class="inv-filter-clear" onclick="clearInvFilters()">✕ Limpiar filtros</button></div>`;
  el.innerHTML = summaryHTML + driftHTML + filterBar + metaHTML + addBtn + groupsHTML;
}
function invItemDetailHTML(item) {
  let html = item.note ? `<div>${fmtRich(item.note)}</div>` : '';
  if (item.how_to_apply) html += `<div class="inv-detail-section"><div class="inv-detail-section-title">Cómo aplicar</div>${fmtRich(item.how_to_apply)}</div>`;
  if (item.why_it_works) html += `<div class="inv-detail-section"><div class="inv-detail-section-title">Por qué funciona</div><div style="color:#7A6E6A;font-style:italic">💡 ${fmtRich(item.why_it_works)}</div></div>`;
  html += `<button class="inv-edit-btn" onclick="openEditProductModal('${item.id}')" style="display:block;width:100%;margin-top:12px;padding:9px;background:#FBEAF0;color:#C4818A;border:1.5px solid #C4818A;border-radius:10px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;">✏️ Editar producto</button>`;
  html += `<button class="inv-custom-del" onclick="deleteCustomProduct('${item.id}')">🗑️ Eliminar producto</button>`;
  return html || '<div style="color:#B0A8A8;font-style:italic">Sin descripción.</div>';
}
// Caducidad por PAO: fecha de apertura + meses de vida del envase.
function paoBadge(item) {
  if (!item.opened_at || !item.pao_months) return '';
  const exp = new Date(item.opened_at + 'T12:00:00');
  exp.setMonth(exp.getMonth() + Number(item.pao_months));
  const days = Math.floor((exp - new Date()) / 86400000);
  if (days < 0)   return ` <span style="color:#C43020;font-weight:700">· ⏳ caducado</span>`;
  if (days <= 30) return ` <span style="color:#C47A00;font-weight:700">· ⏳ caduca en ${days}d</span>`;
  return ` <span style="color:#A09090">· ⏳ ${days}d</span>`;
}
function invItemHTML(item) {
  const domId = item.id;
  const status = item.status || 'ok';
  const statusCls = status !== 'ok' ? ` status-${cssSafe(status)}` : '';
  return `<div class="inv-item${statusCls}" id="inv-${domId}">
  <div class="inv-row" onclick="toggleInvDetail('${domId}')">
    <div class="inv-emoji">${esc(item.emoji)}</div>
    <div class="inv-info">
      <div class="inv-name">${esc(item.name)}</div>
      <div class="inv-brand">${esc(item.brand || '')}${paoBadge(item)}</div>
    </div>
    <div class="inv-chips" onclick="event.stopPropagation()">
      <span class="inv-chip ${status==='ok'?'active-ok':''}"  onclick="setInvStatus('${domId}','ok')">✅</span>
      <span class="inv-chip ${status==='low'?'active-low':''}" onclick="setInvStatus('${domId}','low')">⚠️</span>
      <span class="inv-chip ${status==='out'?'active-out':''}" onclick="setInvStatus('${domId}','out')">❌</span>
    </div>
    <div class="inv-arrow">›</div>
  </div>
  <div class="inv-detail">
    <div class="inv-detail-inner">${invItemDetailHTML(item)}</div>
  </div>
</div>`;
}
function toggleInvDetail(domId) {
  const el = document.getElementById('inv-' + domId);
  if (el) el.classList.toggle('open');
}
let editingProductId = null;
let pfFreq = 'daily';
let pfDays = new Set();
function selectPfFreq(freq) {
  pfFreq = freq;
  document.querySelectorAll('#pf-freq-row .seg-btn').forEach(b => b.classList.toggle('on', b.dataset.freq === freq));
  document.getElementById('pf-day-row').style.display = freq === 'days' ? 'flex' : 'none';
}
function togglePfDay(dow) {
  dow = Number(dow);
  if (pfDays.has(dow)) pfDays.delete(dow); else pfDays.add(dow);
  const chip = document.querySelector(`#pf-day-row .day-chip[data-dow="${dow}"]`);
  if (chip) chip.classList.toggle('on', pfDays.has(dow));
}
function resetPfClinicalFields() {
  document.querySelectorAll('#pf-clinical-roles input[type="checkbox"]').forEach(cb => {
    cb.checked = false; cb.closest('.clinrole-chip').classList.remove('on');
  });
  pfFreq = 'daily'; pfDays = new Set();
  document.querySelectorAll('#pf-freq-row .seg-btn').forEach(b => b.classList.toggle('on', b.dataset.freq === 'daily'));
  document.getElementById('pf-day-row').style.display = 'none';
  document.querySelectorAll('#pf-day-row .day-chip').forEach(c => c.classList.remove('on'));
}
function openAddProductModal() {
  editingProductId = null;
  ['pf-emoji','pf-name','pf-brand','pf-note','pf-how','pf-why','pf-cat-custom','pf-opened','pf-pao','pf-started'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; if (id === 'pf-cat-custom') el.style.display = 'none'; }
  });
  document.getElementById('pf-cat').value = '';
  resetPfClinicalFields();
  document.getElementById('emoji-preview').textContent = '🧴';
  document.querySelector('#add-product-modal .modal-title').textContent = '＋ Nuevo producto';
  const btn = document.getElementById('save-prod-btn');
  btn.disabled = false; btn.textContent = 'Guardar producto';
  openModal('add-product-modal');
}
function openEditProductModal(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  document.getElementById('pf-emoji').value = p.emoji || '';
  document.getElementById('pf-name').value  = p.name || '';
  document.getElementById('pf-brand').value = p.brand || '';
  document.getElementById('pf-note').value  = p.note || '';
  document.getElementById('pf-how').value   = p.how_to_apply || '';
  document.getElementById('pf-why').value   = p.why_it_works || '';
  document.getElementById('pf-opened').value = p.opened_at || '';
  document.getElementById('pf-started').value = p.started_at || '';
  document.getElementById('pf-pao').value    = p.pao_months || '';
  resetPfClinicalFields();
  const roles = (p.clinical_roles && p.clinical_roles.length) ? p.clinical_roles : (p.clinical_role ? [{ finacea: 'despigmentacion', tretinoina: 'regeneracion_celular', barrera: 'barrera', spf_facial: 'spf_facial' }[p.clinical_role]] : []);
  roles.filter(Boolean).forEach(role => {
    const cb = document.querySelector(`#pf-clinical-roles input[value="${role}"]`);
    if (cb) { cb.checked = true; cb.closest('.clinrole-chip').classList.add('on'); }
  });
  if (p.schedule_days && p.schedule_days.length) {
    pfDays = new Set(p.schedule_days.map(Number));
    selectPfFreq('days');
    document.querySelectorAll('#pf-day-row .day-chip').forEach(c => c.classList.toggle('on', pfDays.has(Number(c.dataset.dow))));
  } else {
    selectPfFreq('daily');
  }
  document.getElementById('emoji-preview').textContent = p.emoji || '🧴';
  const catSel = document.getElementById('pf-cat');
  const custom = document.getElementById('pf-cat-custom');
  catSel.value = p.category || '';
  if (catSel.value !== (p.category || '')) {
    catSel.value = '__new__'; custom.style.display = 'block'; custom.value = p.category || '';
  } else {
    custom.style.display = 'none'; custom.value = '';
  }
  document.querySelector('#add-product-modal .modal-title').textContent = '✏️ Editar producto';
  const btn = document.getElementById('save-prod-btn');
  btn.disabled = false; btn.textContent = 'Guardar cambios';
  openModal('add-product-modal');
}
function toggleCustomCat(sel) {
  document.getElementById('pf-cat-custom').style.display = sel.value === '__new__' ? 'block' : 'none';
}
async function saveCustomProduct() {
  const emoji  = document.getElementById('pf-emoji').value.trim() || '🧴';
  const name   = document.getElementById('pf-name').value.trim();
  const brand  = document.getElementById('pf-brand').value.trim();
  const catSel = document.getElementById('pf-cat').value;
  const cat    = catSel === '__new__' ? document.getElementById('pf-cat-custom').value.trim() : catSel;
  const note   = document.getElementById('pf-note').value.trim();
  const how    = document.getElementById('pf-how').value.trim();
  const why    = document.getElementById('pf-why').value.trim();
  const clinicalRoles = [...document.querySelectorAll('#pf-clinical-roles input[type="checkbox"]:checked')].map(cb => cb.value);
  const scheduleDays = (pfFreq === 'days' && pfDays.size) ? [...pfDays].sort((a,b) => a-b) : null;
  const openedAt  = document.getElementById('pf-opened').value || null;
  const startedAt = document.getElementById('pf-started').value || null;
  const paoMonths = parseInt(document.getElementById('pf-pao').value, 10) || null;
  if (!name) { showToast('⚠️ El nombre es obligatorio', 'error'); return; }
  if (!cat)  { showToast('⚠️ Elige una categoría', 'error'); return; }
  const btn = document.getElementById('save-prod-btn');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  if (editingProductId) {
    const { data, error } = await db.from('products').update({
      emoji, name, brand: brand || null, category: cat,
      note: note || null, how_to_apply: how || null, why_it_works: why || null,
      clinical_roles: clinicalRoles, schedule_days: scheduleDays,
      opened_at: openedAt, pao_months: paoMonths, started_at: startedAt, started_at: startedAt
    }).eq('id', editingProductId).select().single();
    btn.disabled = false; btn.textContent = 'Guardar cambios';
    if (error) { showToast('❌ ' + error.message, 'error'); return; }
    const idx = allProducts.findIndex(p => p.id === editingProductId);
    if (idx >= 0) allProducts[idx] = data;
    editingProductId = null;
    closeModal('add-product-modal');
    showToast('✅ Producto actualizado', 'success');
    renderInventory();
    renderReappCategories();
    return;
  }
  const { data, error } = await db.from('products').insert({
    emoji, name, brand: brand || null, category: cat,
    note: note || null, how_to_apply: how || null, why_it_works: why || null,
    clinical_roles: clinicalRoles, schedule_days: scheduleDays,
    opened_at: openedAt, pao_months: paoMonths, started_at: startedAt,
    tier: 'ok', tags: [], status: 'ok'
  }).select().single();
  btn.disabled = false; btn.textContent = 'Guardar producto';
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  allProducts.push(data);
  closeModal('add-product-modal');
  showToast('✅ Producto agregado', 'success');
  renderInventory();
  renderReappCategories();
}
async function deleteCustomProduct(id) {
  const ok = await confirmSheet('¿Eliminar este producto del inventario?');
  if (!ok) return;
  const { error } = await db.from('products').delete().eq('id', id);
  if (error) { showToast('❌ Error al eliminar', 'error'); return; }
  allProducts = allProducts.filter(p => p.id !== id);
  showToast('🗑️ Producto eliminado', '');
  renderInventory();
  renderReappCategories();
}
async function setInvStatus(productId, newStatus) {
  const prod = allProducts.find(p => p.id === productId);
  const current = prod ? prod.status || 'ok' : 'ok';
  const status = (current === newStatus && newStatus !== 'ok') ? 'ok' : newStatus;
  const prevStatus = prod ? prod.status : undefined;
  if (prod) prod.status = status;
  const applyChipUI = (st) => {
    const el = document.getElementById('inv-' + productId);
    if (!el) return;
    el.classList.remove('status-low','status-out');
    if (st !== 'ok') el.classList.add('status-' + st);
    const chips = el.querySelectorAll('.inv-chip');
    const map   = ['ok','low','out'];
    const cls   = ['active-ok','active-low','active-out'];
    chips.forEach((c, i) => { c.className = 'inv-chip' + (st === map[i] ? ' ' + cls[i] : ''); });
  };
  applyChipUI(status);
  const refreshSummary = () => {
    const lowCount = allProducts.filter(p => p.status === 'low').length;
    const outCount = allProducts.filter(p => p.status === 'out').length;
    const okCount  = allProducts.length - lowCount - outCount;
    const vals = document.querySelectorAll('.inv-sum-val');
    if (vals[0]) vals[0].textContent = okCount;
    if (vals[1]) vals[1].textContent = lowCount;
    if (vals[2]) vals[2].textContent = outCount;
  };
  refreshSummary();
  const { error } = await db.from('products').update({ status }).eq('id', productId);
  if (error) {
    // Rollback del visual si la base no guardó.
    if (prod) prod.status = prevStatus;
    applyChipUI(prevStatus || 'ok');
    refreshSummary();
    showToast('❌ Error al guardar', 'error');
  }
}
// ── ROUTINE EDITOR ───────────────────────────────────────────────────────────
let routinesLoaded = false;
let allRoutines = [];
let currentRoutineId = null;
async function loadRoutines() {
  const { data, error } = await db.from('routines').select('*').order('sort_order');
  if (!error && data) allRoutines = data;
  routinesLoaded = true;
  renderRoutineList();
}
// Orden fijo de secciones (mismo orden que las tarjetas de Today).
const ROUTINE_SECTION_ORDER = ['am', 'pm', 'body', 'feet'];
const ROUTINE_SECTION_ICON  = { am: '☀️', pm: '🌙', body: '🧴', feet: '🦶' };
const ROUTINE_SECTION_TITLE = { am: 'Mañana', pm: 'Noche', body: 'Cuerpo', feet: 'Pies' };
// Mismos degradados de color que ya usan las tarjetas AM/PM/Cuerpo/Pies en Today.
const ROUTINE_SECTION_HDR_CLS = { am: 'am-hdr', pm: 'pm-hdr', body: 'bod-hdr', feet: 'ft-hdr' };
function routineCardHTML(r) {
  return `
<div class="rout-card" onclick="openRoutineDetail('${r.id}')">
  <div class="rout-card-emoji">${esc(r.emoji)}</div>
  <div class="rout-card-info">
    <div class="rout-card-name">${esc(r.name)}</div>
    <div class="rout-card-sched">${esc(fmtDays(r.schedule_days))}</div>
    <div class="rout-card-sub" id="rout-sub-${r.id}">cargando...</div>
  </div>
  <button class="rout-card-del" title="Duplicar rutina" onclick="event.stopPropagation(); duplicateRoutine('${r.id}')">📄</button>
  <button class="rout-card-del" onclick="event.stopPropagation(); deleteRoutine('${r.id}')">🗑️</button>
  <div class="rout-card-arrow">›</div>
</div>`;
}
function renderRoutineList() {
  currentRoutineId = null;
  const el = document.getElementById('routines-content');
  if (!el) return;
  const bySection = {};
  allRoutines.forEach(r => { (bySection[r.section_key] = bySection[r.section_key] || []).push(r); });
  // Secciones con section_key desconocido/vacío (no debería pasar, pero por si acaso).
  const knownKeys = new Set(ROUTINE_SECTION_ORDER);
  const extraKeys = Object.keys(bySection).filter(k => !knownKeys.has(k));
  const orderedKeys = [...ROUTINE_SECTION_ORDER, ...extraKeys];
  const sectionsHTML = orderedKeys.map(key => {
    const list = bySection[key] || [];
    const secId = 'rout-sec-' + key;
    const icon = ROUTINE_SECTION_ICON[key] || '⚠️';
    const title = ROUTINE_SECTION_TITLE[key] || key;
    const hdrCls = ROUTINE_SECTION_HDR_CLS[key] || '';
    const body = list.length
      ? list.map(routineCardHTML).join('')
      : '<div class="tap-hint">Sin rutinas en esta sección todavía.</div>';
    return `
<div class="section" id="${secId}">
  <div class="sec-hdr ${hdrCls}" onclick="toggleSec('${secId}')">
    <span class="sec-icon">${icon}</span>
    <div class="sec-title">${esc(title)}
      <div class="sec-sub">${list.length} rutina${list.length === 1 ? '' : 's'}</div>
    </div>
    <span class="sec-arrow">⌄</span>
  </div>
  <div class="sec-body">${body}</div>
</div>`;
  }).join('');
  el.innerHTML = `
<div class="rout-hdr">
  <div class="rout-hdr-title">✏️ Rutinas</div>
  <button class="rout-add-btn" onclick="openAddRoutineModal()">＋ Nueva</button>
</div>
${sectionsHTML}`;
  loadStepCounts();
}
// Copia una rutina completa (config + todos sus pasos) — útil para variantes
// tipo "Cuerpo día par / día impar" sin capturar todo de nuevo.
async function duplicateRoutine(routineId) {
  const r = allRoutines.find(x => x.id === routineId);
  if (!r) return;
  const sort_order = allRoutines.length ? Math.max(...allRoutines.map(x => x.sort_order)) + 1 : 0;
  const { data: nr, error } = await db.from('routines').insert({
    emoji: r.emoji, name: r.name + ' (copia)', section_key: r.section_key,
    schedule_days: r.schedule_days, active: true, sort_order
  }).select().single();
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  const { data: steps } = await db.from('routine_steps').select('*').eq('routine_id', routineId).order('sort_order');
  if (steps && steps.length) {
    const copies = steps.map(s => ({
      routine_id: nr.id, emoji: s.emoji, name: s.name, brand: s.brand,
      how_to_apply: s.how_to_apply, why_it_works: s.why_it_works, warn: s.warn,
      picker_category: s.picker_category, product_id: s.product_id, sort_order: s.sort_order
    }));
    const { error: stepsErr } = await db.from('routine_steps').insert(copies);
    if (stepsErr) showToast('⚠️ Rutina copiada pero fallaron pasos: ' + stepsErr.message, 'error');
  }
  allRoutines.push(nr);
  showToast('📄 Rutina duplicada', 'success');
  renderRoutineList();
}
async function loadStepCounts() {
  const { data } = await db.from('routine_steps').select('routine_id');
  if (!data) return;
  const counts = {};
  data.forEach(r => { counts[r.routine_id] = (counts[r.routine_id] || 0) + 1; });
  allRoutines.forEach(r => {
    const el = document.getElementById('rout-sub-' + r.id);
    if (el) el.textContent = `${counts[r.id] || 0} pasos`;
  });
}
async function openRoutineDetail(routineId) {
  currentRoutineId = routineId;
  const routine = allRoutines.find(r => r.id === routineId);
  const el = document.getElementById('routines-content');
  el.innerHTML = '<div class="loading-state"><span class="spinner">⟳</span></div>';
  const { data: steps } = await db.from('routine_steps')
    .select('*').eq('routine_id', routineId).order('sort_order');
  renderRoutineDetail(routine, steps || []);
}
// ── VALIDADOR DE RUTINAS: detecta choques de activos ─────────────────────────
// Clasifica cada paso (por rol clínico, categoría, picker o nombre) y avisa
// si la misma rutina junta activos que suelen irritarse o anularse entre sí.
function stepActiveKinds(s) {
  const prod = stepProductOf(s);
  const roles = prod ? (prod.clinical_roles || []) : [];
  const txt = `${prod ? prod.name : s.name} ${prod ? (prod.category || '') : ''} ${s.picker_category || ''}`.toLowerCase();
  const kinds = new Set();
  if (roles.includes('regeneracion_celular') || /tretino|retino|retin-a|adapalen/.test(txt)) kinds.add('retinoide');
  if ((prod && prod.category === '🫧 Exfoliantes') || s.picker_category === '🫧 Exfoliantes' ||
      /glic[oó]lico|salic[ií]|mandel|l[aá]ctico|\baha\b|\bbha\b|\bpha\b/.test(txt)) kinds.add('exfoliante');
  if (/vitamina c|vit\.? ?c\b|ascorb/.test(txt)) kinds.add('vitc');
  if (/per[oó]xido de benzoilo|benzoyl/.test(txt)) kinds.add('bpo');
  return kinds;
}
function routineConflicts(steps) {
  const all = new Set();
  let exfoCount = 0;
  steps.forEach(s => {
    const k = stepActiveKinds(s);
    k.forEach(x => all.add(x));
    if (k.has('exfoliante')) exfoCount++;
  });
  const warns = [];
  if (all.has('retinoide') && all.has('exfoliante')) warns.push('🔬+🫧 Retinoide y exfoliante en la MISMA rutina: alto riesgo de irritación. Lo usual es alternarlos en noches distintas.');
  if (all.has('retinoide') && all.has('bpo')) warns.push('🔬 Retinoide + peróxido de benzoilo pueden desactivarse entre sí — sepáralos AM/PM.');
  if (all.has('vitc') && all.has('exfoliante')) warns.push('🍊+🫧 Vitamina C + exfoliante juntos pueden sobre-acidificar — si notas ardor, sepáralos.');
  if (exfoCount >= 2) warns.push('🫧 Dos pasos exfoliantes en la misma rutina — normalmente con uno basta.');
  return warns;
}
function renderRoutineDetail(routine, steps) {
  const el = document.getElementById('routines-content');
  const warns = routineConflicts(steps);
  const warnsHTML = warns.length
    ? `<div class="focus-card" style="margin-bottom:10px">
  <div class="focus-card-title">⚠️ Posibles choques de activos</div>
  <div class="focus-card-text">${warns.map(esc).join('<br><br>')}</div>
</div>`
    : '';
  el.innerHTML = `
<button class="rout-back-btn" onclick="renderRoutineList()">← Rutinas</button>
<div class="rout-hdr">
  <div class="rout-hdr-title">${esc(routine.emoji)} ${esc(routine.name)}</div>
  <button class="rout-add-btn" onclick="openEditRoutineModal('${routine.id}')">✏️ Editar</button>
</div>
<div class="rout-card-sched" style="margin:-4px 0 10px 2px">${fmtSection(routine.section_key)} · ${fmtDays(routine.schedule_days)}</div>
${warnsHTML}
${steps.map((s, i) => `
<div class="rout-step-item" id="rstep-${s.id}" draggable="true"
  ondragstart="stepDragStart(event,'${s.id}')" ondragend="stepDragEnd(event)"
  ondragover="stepDragOver(event)" ondrop="stepDrop(event,'${s.id}','${routine.id}')">
  <div class="rout-step-num">${i + 1}</div>
  <div class="rout-step-info">
    <div class="rout-step-name">${esc(s.emoji || '')} ${esc(s.name)}</div>
    ${s.brand ? `<div class="rout-step-brand">${esc(s.brand)}</div>` : ''}
    ${s.picker_category ? `<div class="rout-step-picker">→ picker: ${esc(s.picker_category)}</div>` : ''}
  </div>
  <div class="rout-step-actions">
    <button class="rout-move-btn" onclick="moveStep('${s.id}',-1,'${routine.id}')" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button class="rout-move-btn" onclick="moveStep('${s.id}',1,'${routine.id}')" ${i === steps.length - 1 ? 'disabled' : ''}>↓</button>
    <button class="rout-step-del" onclick="deleteStep('${s.id}','${routine.id}')">🗑️</button>
  </div>
</div>`).join('')}
<button class="rout-add-step-btn" onclick="openAddStepModal('${routine.id}')">＋ Agregar paso</button>`;
}
// Drag & drop de pasos (desktop; en móvil siguen las flechas ↑↓).
let _dragStepId = null;
function stepDragStart(e, id) { _dragStepId = id; e.currentTarget.classList.add('dragging'); }
function stepDragEnd(e) { e.currentTarget.classList.remove('dragging'); }
function stepDragOver(e) { e.preventDefault(); }
async function stepDrop(e, targetId, routineId) {
  e.preventDefault();
  if (!_dragStepId || _dragStepId === targetId) return;
  const { data: steps } = await db.from('routine_steps')
    .select('id,sort_order').eq('routine_id', routineId).order('sort_order');
  const ids = steps.map(s => s.id);
  const from = ids.indexOf(_dragStepId), to = ids.indexOf(targetId);
  _dragStepId = null;
  if (from < 0 || to < 0) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  const results = await Promise.all(ids.map((id, i) =>
    db.from('routine_steps').update({ sort_order: i }).eq('id', id)));
  if (results.some(r => r.error)) showToast('❌ Error al reordenar — revisa el orden', 'error');
  openRoutineDetail(routineId);
}
// Reordenar con flechas: intenta primero el RPC atómico swap_step_order
// (creado en supabase-hardening.sql); si no existe, cae a dos updates
// verificando errores.
async function moveStep(stepId, direction, routineId) {
  const { data: steps } = await db.from('routine_steps')
    .select('id,sort_order').eq('routine_id', routineId).order('sort_order');
  const idx = steps.findIndex(s => s.id === stepId);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= steps.length) return;
  const a = steps[idx], b = steps[swapIdx];
  const { error: rpcErr } = await db.rpc('swap_step_order', { step_a: a.id, step_b: b.id });
  if (rpcErr) {
    const [ra, rb] = await Promise.all([
      db.from('routine_steps').update({ sort_order: b.sort_order }).eq('id', a.id),
      db.from('routine_steps').update({ sort_order: a.sort_order }).eq('id', b.id),
    ]);
    if (ra.error || rb.error) showToast('❌ Error al reordenar — revisa el orden', 'error');
  }
  openRoutineDetail(routineId);
}
async function deleteStep(stepId, routineId) {
  const ok = await confirmSheet('¿Eliminar este paso de la rutina?');
  if (!ok) return;
  const { error } = await db.from('routine_steps').delete().eq('id', stepId);
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  openRoutineDetail(routineId);
}
async function deleteRoutine(routineId) {
  const ok = await confirmSheet('¿Eliminar esta rutina y todos sus pasos?');
  if (!ok) return;
  const { error } = await db.from('routines').delete().eq('id', routineId);
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  allRoutines = allRoutines.filter(r => r.id !== routineId);
  renderRoutineList();
}
let rfSection = 'am';
let rfDays = new Set();
let editingRoutineId = null;
const SECTION_LABELS = { am: '☀️ Mañana', pm: '🌙 Noche', body: '🧴 Cuerpo', feet: '🦶 Pies' };
function fmtSection(k) { return SECTION_LABELS[k] || '⚠️ Sin sección'; }
function fmtDays(arr) {
  if (!arr || !arr.length) return 'Todos los días';
  const L = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  return arr.slice().sort((a,b)=>a-b).map(d => L[d]).join('·');
}
function selectRoutineSection(sec) {
  rfSection = sec;
  document.querySelectorAll('#rf-section-row .seg-btn').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
}
function toggleRoutineDay(dow) {
  dow = Number(dow);
  if (rfDays.has(dow)) rfDays.delete(dow); else rfDays.add(dow);
  const chip = document.querySelector(`#rf-day-row .day-chip[data-dow="${dow}"]`);
  if (chip) chip.classList.toggle('on', rfDays.has(dow));
}
function openAddRoutineModal() {
  editingRoutineId = null;
  document.getElementById('rf-emoji').value = '';
  document.getElementById('rf-name').value = '';
  document.getElementById('rf-emoji-preview').textContent = '✨';
  rfSection = 'am'; rfDays = new Set();
  selectRoutineSection('am');
  document.querySelectorAll('#rf-day-row .day-chip').forEach(c => c.classList.remove('on'));
  document.querySelector('#add-routine-modal .modal-title').textContent = '＋ Nueva rutina';
  const btn = document.getElementById('save-routine-btn');
  btn.disabled = false; btn.textContent = 'Guardar rutina';
  openModal('add-routine-modal');
}
function openEditRoutineModal(routineId) {
  const r = allRoutines.find(x => x.id === routineId);
  if (!r) return;
  editingRoutineId = routineId;
  document.getElementById('rf-emoji').value = r.emoji || '';
  document.getElementById('rf-name').value = r.name || '';
  document.getElementById('rf-emoji-preview').textContent = r.emoji || '✨';
  rfSection = r.section_key || 'am';
  rfDays = new Set((r.schedule_days || []).map(Number));
  selectRoutineSection(rfSection);
  document.querySelectorAll('#rf-day-row .day-chip').forEach(c => c.classList.toggle('on', rfDays.has(Number(c.dataset.dow))));
  document.querySelector('#add-routine-modal .modal-title').textContent = '✏️ Editar rutina';
  const btn = document.getElementById('save-routine-btn');
  btn.disabled = false; btn.textContent = 'Guardar cambios';
  openModal('add-routine-modal');
}
async function saveNewRoutine() {
  const emoji = document.getElementById('rf-emoji').value.trim() || '✨';
  const name  = document.getElementById('rf-name').value.trim();
  if (!name) { showToast('⚠️ El nombre es obligatorio', 'error'); return; }
  const btn = document.getElementById('save-routine-btn');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  const schedule_days = rfDays.size ? [...rfDays].sort((a,b)=>a-b) : null;
  const fields = { emoji, name, section_key: rfSection, schedule_days, active: true };
  if (editingRoutineId) {
    const { data, error } = await db.from('routines').update(fields).eq('id', editingRoutineId).select().single();
    btn.disabled = false; btn.textContent = 'Guardar cambios';
    if (error) { showToast('❌ ' + error.message, 'error'); return; }
    const idx = allRoutines.findIndex(r => r.id === editingRoutineId);
    if (idx >= 0) allRoutines[idx] = data;
    editingRoutineId = null;
    closeModal('add-routine-modal');
    showToast('✅ Rutina actualizada', 'success');
    renderRoutineList();
  } else {
    const sort_order = allRoutines.length ? Math.max(...allRoutines.map(r => r.sort_order)) + 1 : 0;
    const { data, error } = await db.from('routines').insert({ ...fields, sort_order }).select().single();
    btn.disabled = false; btn.textContent = 'Guardar rutina';
    if (error) { showToast('❌ ' + error.message, 'error'); return; }
    allRoutines.push(data);
    closeModal('add-routine-modal');
    showToast('✅ Rutina agregada', 'success');
    renderRoutineList();
  }
}
function onStepCatChange() {
  const cat = document.getElementById('sf-cat').value;
  const pf = document.getElementById('sf-product-field');
  const inf = document.getElementById('sf-info-field');
  if (cat === '__info__') { pf.style.display = 'none'; inf.style.display = 'block'; return; }
  inf.style.display = 'none';
  if (!cat) { pf.style.display = 'none'; return; }
  const sel = document.getElementById('sf-product');
  const prods = allProducts.filter(p => p.category === cat);
  sel.innerHTML = '<option value="">— Sin fijar · rotar cada día —</option>' +
    prods.map(p => `<option value="${p.id}">${esc(prodLabelText(p))}</option>`).join('');
  pf.style.display = 'block';
}
function openAddStepModal(routineId) {
  document.getElementById('sf-cat').value = '';
  document.getElementById('sf-product').innerHTML = '<option value="">— Sin fijar · rotar cada día —</option>';
  document.getElementById('sf-product-field').style.display = 'none';
  document.getElementById('sf-info-field').style.display = 'none';
  const infoName = document.getElementById('sf-info-name'); if (infoName) infoName.value = '';
  document.getElementById('sf-how').value = '';
  document.getElementById('sf-routine-id').value = routineId;
  const btn = document.getElementById('save-step-btn');
  btn.disabled = false; btn.textContent = 'Guardar paso';
  openModal('add-step-modal');
}
async function saveNewStep() {
  const routineId = document.getElementById('sf-routine-id').value;
  const cat = document.getElementById('sf-cat').value;
  const how = document.getElementById('sf-how').value.trim();
  let emoji, name, brand = null, picker_category = null, product_id = null;
  if (cat === '__info__') {
    name = document.getElementById('sf-info-name').value.trim();
    emoji = '📝';
    if (!name) { showToast('⚠️ Escribe el nombre del paso', 'error'); return; }
  } else if (!cat) {
    showToast('⚠️ Elige un tipo de producto', 'error'); return;
  } else {
    const pid = document.getElementById('sf-product').value;
    if (pid) {
      const prod = allProducts.find(p => p.id === pid);
      if (!prod) { showToast('⚠️ Elige un producto', 'error'); return; }
      emoji = prod.emoji || '💧';
      name  = prod.name;
      brand = prod.brand || null;
      product_id = prod.id;
    } else {
      emoji = cat.split(' ')[0];
      name  = cat.split(' ').slice(1).join(' ') || cat;
      picker_category = cat;
    }
  }
  const btn = document.getElementById('save-step-btn');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';
  const { data: existing } = await db.from('routine_steps')
    .select('sort_order').eq('routine_id', routineId)
    .order('sort_order', { ascending: false }).limit(1);
  const sort_order = (existing && existing.length) ? existing[0].sort_order + 1 : 0;
  const { error } = await db.from('routine_steps').insert({
    routine_id: routineId, emoji, name,
    brand, how_to_apply: how || null,
    why_it_works: null, warn: null,
    picker_category, product_id, sort_order
  });
  btn.disabled = false; btn.textContent = 'Guardar paso';
  if (error) { showToast('❌ ' + error.message, 'error'); return; }
  closeModal('add-step-modal');
  showToast('✅ Paso agregado', 'success');
  openRoutineDetail(routineId);
}

// ── DYNAMIC ROUTINE RENDERING ────────────────────────────────────────────────
// Abre el picker que corresponda a una categoría. Es la versión FUNCIÓN del
// despacho: pickerFnForCat/reappPickerFnForCat solo generan la cadena para el
// onclick, pero checkStep necesita llamarlo de verdad.
// Todas las categorías son multi-selección; PICKER_MODALS decide en qué modal
// se pinta cada una (SPF cara / SPF cuerpo tienen el suyo con su aviso).
function openPickerForCat(stepId, cat) {
  return openMultiPickerByCat(stepId, cat);
}
function pickerFnForCat(cat, stepId) {
  return `openPickerForCat('${stepId}','${jsAttrEsc(cat)}')`;
}
// ── REAPLICACIONES: grid de categorías (generado desde Stock) ────────────────
const REAPP_EXCLUDE_CATEGORIES = [];
const REAPP_BODY_KEYWORDS = /cuerpo|corporal|pies/i;
const REAPP_LABELS = {
  '🌞 SPF Facial':      '🌞 SPF Cara',
  '☀️ SPF Corporal':    '☀️ SPF Cuerpo',
  '👁️ Contorno Ojos':  '👁️ Ojos',
};
function reappPickerFnForCat(cat) {
  return `openPickerForCat(null,'${jsAttrEsc(cat)}')`;
}
function renderReappCategories() {
  const el = document.getElementById('reapp-categories-wrap');
  if (!el) return;
  const cats = [...new Set(allProducts.map(p => p.category).filter(Boolean))]
    .filter(c => !REAPP_EXCLUDE_CATEGORIES.includes(c));
  const order = c => { const i = PRODUCT_CATEGORIES.indexOf(c); return i === -1 ? 999 : i; };
  const faceCats = cats.filter(c => !REAPP_BODY_KEYWORDS.test(c)).sort((a, b) => order(a) - order(b));
  const bodyCats = cats.filter(c => REAPP_BODY_KEYWORDS.test(c)).sort((a, b) => order(a) - order(b));
  const btn = c => `<button class="reapp-cat-btn" onclick="${reappPickerFnForCat(c)}">${esc(REAPP_LABELS[c] || c)}</button>`;
  const group = (label, list) => list.length
    ? `<div class="reapp-group-label">${label}</div><div class="reapp-categories">${list.map(btn).join('')}</div>`
    : '';
  el.innerHTML = group('Cara', faceCats) + group('Cuerpo', bodyCats);
}
function dbStepHTML(s, index, todayHydration, sectionKey) {
  const n  = index + 1;
  const id = 'sd_' + Math.random().toString(36).slice(2, 9);
  const _prod = stepProductOf(s) || allProducts.find(p => p.name === s.name);
  const dEmoji = _prod ? (_prod.emoji || '') : (s.emoji || '');
  const dName  = _prod ? _prod.name : s.name;
  const dBrand = _prod ? (_prod.brand || '') : (s.brand || '');
  const _whyTxt = (_prod && _prod.why_it_works) ? _prod.why_it_works : s.why_it_works;
  const why  = _whyTxt ? `<div class="det-why">💡 ${fmtRich(_whyTxt)}</div>` : '';
  const warn = s.warn ? `<div class="det-warn">${fmtRich(s.warn)}</div>` : '';
  // ¿Este paso exacto ya se aplicó ese día? La cadena de prioridades
  // (routine_step_id → product_id → categoría → nombre) vive en pure.js
  // con sus tests: reglas 4 y 19 de ARQUITECTURA.md.
  const appliedName = resolveStepHydration(s, todayHydration, sectionKey, `${dEmoji} ${dName}`.trim());
  const doneCls = appliedName ? ' done' : '';
  // Renglón de zonas de lo ya registrado en ESTE paso. Se reconstruye de las
  // filas (byStepIdApps) y no de un estado en memoria, para que sobreviva a
  // recargar el día — si desapareciera al refrescar parecería no haberse
  // guardado, que es justo la duda que el renglón viene a resolver.
  const _appRows = (appliedName && todayHydration && todayHydration.byStepIdApps)
    ? (todayHydration.byStepIdApps.get(s.id) || []) : [];
  const zonasRow = registerStepZonasFromRows(`step_${id}`, _appRows);
  if (s.picker_category) {
    const pickerFn = pickerFnForCat(s.picker_category, `step_${id}`);
    const pickedBlock = appliedName
      ? `<div class="sc-picked">
  <div class="sc-picked-name">✓ ${loggedLabelHTML(appliedName)}</div>
  <div class="sc-picked-change">Toca para cambiar →</div>
</div>`
      : `<div class="sc-pick-hint" style="font-size:11px;color:#C4818A;margin-top:5px;font-style:italic;">Toca para elegir producto →</div>`;
    return `<div class="step${doneCls}" id="step_${id}" data-routine-step-id="${s.id}" data-picker="1" data-picker-cat="${esc(s.picker_category)}">
  <div class="sn" onclick="checkStep('step_${id}',event)">
    <span class="sn-num">${n}</span><span class="sn-check">✓</span>
  </div>
  <div class="sc" onclick="try{${pickerFn}}catch(e){showToast('❌ Picker: '+e.message,'error')}">
    <div class="sc-top"><span class="sc-name">${esc(s.emoji||'')} ${esc(s.name)}</span></div>
    <div class="sc-brand">${esc(s.brand||'')}</div>
    ${pickedBlock}
    ${zonasRow}
  </div>
  <div class="step-chevron" onclick="try{${pickerFn}}catch(e){showToast('❌ Picker: '+e.message,'error')}">›</div>
</div>`;
  }
  return `<div class="step${doneCls}" id="step_${id}" data-routine-step-id="${s.id}">
  <div class="sn" onclick="checkStep('step_${id}',event)">
    <span class="sn-num">${n}</span><span class="sn-check">✓</span>
  </div>
  <div class="sc" onclick="toggleStep('step_${id}','${id}')">
    <div class="sc-top"><span class="sc-name">${esc(dEmoji)} ${esc(dName)}</span></div>
    <div class="sc-brand">${esc(dBrand)}</div>
    <div class="sc-detail" id="${id}">
      <div class="det-title">How to apply</div>${fmtRich(s.how_to_apply||'')}${why}${warn}
    </div>
    ${zonasRow}
  </div>
  <div class="step-chevron" onclick="toggleStep('step_${id}','${id}')">›</div>
</div>`;
}
function renderDbSteps(bodyId, steps, nightType, todayHydration, sectionKey) {
  const c = document.getElementById(bodyId);
  const hint = c.querySelector('.tap-hint');
  let badge = '';
  if (nightType) {
    const info = PM_NIGHT_INFO[nightType];
    badge = `<div style="padding:8px 16px 4px">
      <span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;background:${info.bg};color:${info.color}">${info.label}</span>
    </div>`;
  }
  c.innerHTML = (hint ? hint.outerHTML : '') + badge + steps.map((s, i) => dbStepHTML(s, i, todayHydration, sectionKey)).join('');
  updateProgress(bodyId);
}
function renderGroupedDbSteps(bodyId, routines, stepsByRoutine, todayHydration, sectionKey) {
  const c = document.getElementById(bodyId);
  const hint = c.querySelector('.tap-hint');
  const groupsHTML = routines.map(r => {
    const steps = stepsByRoutine[r.id] || [];
    if (!steps.length) return '';
    const title = `<div class="reapp-history-title">${esc(r.emoji || '')} ${esc(r.name)}</div>`;
    return title + steps.map((s, i) => dbStepHTML(s, i, todayHydration, sectionKey)).join('');
  }).join('');
  c.innerHTML = (hint ? hint.outerHTML : '') + groupsHTML;
  updateProgress(bodyId);
}

// ── CAMBIAR RUTINA DEL DÍA (override manual, solo UI) ───────────────────────
// A veces la piel no está para la rutina que "toca" por calendario. Esto deja
// elegir OTRA rutina de la misma sección (am/pm/body/feet) solo para el día
// que se está viendo — nunca toca routines.schedule_days ni product_applications,
// así que mañana (o al quitar el override) vuelve solo a la rutina automática.
// Se guarda en localStorage por fecha (preferencia de UI, no dato clínico —
// no afecta el cálculo de adherencia, que vive en pure.js y va por producto).
const ROUTINE_OVERRIDE_KEY = 'routineOverrides_v1';
function loadRoutineOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUTINE_OVERRIDE_KEY) || '{}');
    const cutoff = toDateStr(new Date(Date.now() - 14 * 86400000));
    Object.keys(raw).forEach(d => { if (d < cutoff) delete raw[d]; });
    return raw;
  } catch (e) { return {}; }
}
let routineOverrides = loadRoutineOverrides();
let allRoutinesCache = [];
function saveRoutineOverrides() {
  try { localStorage.setItem(ROUTINE_OVERRIDE_KEY, JSON.stringify(routineOverrides)); } catch (e) {}
}
function currentViewDateStr() {
  const bd = document.getElementById('backdate-input');
  return (bd && bd.value) ? bd.value.slice(0, 10) : TODAY_STR;
}
function updateSwitchBtnVisibility(sectionKey) {
  const btn = document.getElementById(sectionKey + '-switch-btn');
  if (!btn) return;
  const count = allRoutinesCache.filter(r => r.section_key === sectionKey).length;
  btn.style.display = count > 1 ? 'flex' : 'none';
}
function openRoutineSwitch(sectionKey) {
  const dateStr = currentViewDateStr();
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const options = allRoutinesCache
    .filter(r => r.section_key === sectionKey)
    .sort((a, b) => a.sort_order - b.sort_order);
  if (!options.length) { showToast('No hay otras rutinas guardadas para esta sección', ''); return; }
  const currentOverrideId = (routineOverrides[dateStr] || {})[sectionKey] || null;
  const scheduledTodayIds = new Set(
    options.filter(r => !r.schedule_days || !r.schedule_days.length || r.schedule_days.includes(dow)).map(r => r.id)
  );
  document.getElementById('routine-switch-title').textContent = `🔄 ${fmtSection(sectionKey)} — rutina de hoy`;
  const resetBtn = currentOverrideId
    ? `<button class="mini-action-btn on" onclick="clearRoutineOverride('${sectionKey}')">↩️ Volver a la rutina automática de hoy</button>`
    : '';
  document.getElementById('routine-switch-body').innerHTML = resetBtn + options.map(r => {
    const isActive = currentOverrideId ? r.id === currentOverrideId : scheduledTodayIds.has(r.id);
    return `<div class="rsw-item${isActive ? ' active' : ''}" onclick="setRoutineOverride('${sectionKey}','${r.id}')">
  <span class="rsw-emoji">${esc(r.emoji || '')}</span>
  <div class="rsw-info">
    <div class="rsw-name">${esc(r.name)}</div>
    <div class="rsw-sched">${esc(fmtDays(r.schedule_days))}</div>
  </div>
  ${isActive ? '<span class="rsw-badge-auto">Hoy</span>' : ''}
</div>`;
  }).join('');
  openModal('routine-switch-modal');
}
function setRoutineOverride(sectionKey, routineId) {
  const ds = currentViewDateStr();
  if (!routineOverrides[ds]) routineOverrides[ds] = {};
  routineOverrides[ds][sectionKey] = routineId;
  saveRoutineOverrides();
  closeModal('routine-switch-modal');
  loadTodayRoutines(ds);
  showToast('✅ Rutina cambiada solo para hoy', 'success');
}
function clearRoutineOverride(sectionKey) {
  const ds = currentViewDateStr();
  if (routineOverrides[ds]) delete routineOverrides[ds][sectionKey];
  saveRoutineOverrides();
  closeModal('routine-switch-modal');
  loadTodayRoutines(ds);
  showToast('↩️ De vuelta a la rutina automática', '');
}

// ── TODAY (carga AM/PM/Body/Feet para un día específico) ─────────────────────
async function loadTodayRoutines(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const { data: routines } = await db.from('routines')
    .select('*').eq('active', true).order('sort_order');
  allRoutinesCache = routines || [];
  const dayRoutines = (routines || []).filter(r =>
    !r.schedule_days || r.schedule_days.includes(dow)
  );
  const bySection = {};
  dayRoutines.forEach(r => { if (!bySection[r.section_key]) bySection[r.section_key] = r; });
  const bodyRoutines = dayRoutines
    .filter(r => r.section_key === 'body')
    .sort((a, b) => a.sort_order - b.sort_order);
  const feetRoutines = dayRoutines
    .filter(r => r.section_key === 'feet')
    .sort((a, b) => a.sort_order - b.sort_order);
  // Override manual: si hay una rutina elegida a mano para este día/sección,
  // reemplaza la selección automática (sin tocar schedule_days en la base).
  const ov = routineOverrides[dateStr] || {};
  const byId = id => allRoutinesCache.find(r => r.id === id);
  let amR = bySection['am'];
  let pmR = bySection['pm'];
  let bodyList = bodyRoutines;
  let feetList = feetRoutines;
  if (ov.am) { const r = byId(ov.am); if (r) amR = r; }
  if (ov.pm) { const r = byId(ov.pm); if (r) pmR = r; }
  if (ov.body) { const r = byId(ov.body); if (r) bodyList = [r]; }
  if (ov.feet) { const r = byId(ov.feet); if (r) feetList = [r]; }
  const ids = [...new Set([
    ...(amR ? [amR.id] : []),
    ...(pmR ? [pmR.id] : []),
    ...bodyList.map(r => r.id),
    ...feetList.map(r => r.id)
  ])];
  const { data: allSteps } = ids.length
    ? await db.from('routine_steps').select('*').in('routine_id', ids).order('sort_order')
    : { data: [] };
  const stepsByRoutine = {};
  (allSteps || []).forEach(s => {
    if (!stepsByRoutine[s.routine_id]) stepsByRoutine[s.routine_id] = [];
    stepsByRoutine[s.routine_id].push(s);
  });
  const _dayBounds = localDayBoundsUTC(dateStr);
  const { data: appsForHydration } = await db.from('product_applications')
    .select('*')
    .gte('applied_at', _dayBounds.startISO)
    .lt('applied_at', _dayBounds.endISO)
    .order('applied_at', { ascending: true });
  const _prodByIdForHydration = {};
  allProducts.forEach(p => { _prodByIdForHydration[p.id] = p; });
  // El índice de hidratación se construye en pure.js (buildHydration), donde
  // sí tiene tests. Segmenta los fallbacks por sección: sin eso, un toner de
  // la mañana marcaba también el paso "Toners" de la rutina de NOCHE, porque
  // ambos comparten picker_category (regla 19 de ARQUITECTURA.md).
  const hydration = buildHydration(appsForHydration, _prodByIdForHydration, AM_PM_CUTOFF_HOUR);
  // AM
  const amBadge = r => ov.am ? ` <span class="sec-override-badge" onclick="event.stopPropagation();clearRoutineOverride('am')">🔄 ${esc(r.emoji||'')} ${esc(r.name)} · toca para volver</span>` : '';
  if (amR) {
    const steps = stepsByRoutine[amR.id] || [];
    document.getElementById('am-sec-sub').innerHTML =
      `Face &amp; Neck <span class="sec-progress" id="prog-am-body"></span>${amBadge(amR)}`;
    renderDbSteps('am-body', steps, null, hydration, 'am');
  }
  updateSwitchBtnVisibility('am');
  // PM
  if (pmR) {
    const steps = stepsByRoutine[pmR.id] || [];
    // La rotación de noche (tretinoína/exfoliante/descanso) es una guía POR
    // CALENDARIO — solo aplica cuando se está usando la rutina automática.
    // Si hay override manual, esa etiqueta ya no describe lo que se ve, así
    // que se oculta por completo (aquí y dentro de renderDbSteps).
    const nightType = ov.pm ? null : pmNightType(dow);
    const nightInfo = nightType ? PM_NIGHT_INFO[nightType] : null;
    const pmBadge = ov.pm ? ` <span class="sec-override-badge" onclick="event.stopPropagation();clearRoutineOverride('pm')">🔄 ${esc(pmR.emoji||'')} ${esc(pmR.name)} · toca para volver</span>` : '';
    document.getElementById('pm-sec-sub').innerHTML =
      `Face &amp; Neck ${nightInfo ? nightCapsule(nightInfo) : ''} <span class="sec-progress" id="prog-pm-body"></span>${pmBadge}`;
    renderDbSteps('pm-body', steps, nightType, hydration, 'pm');
  }
  updateSwitchBtnVisibility('pm');
  // Body — todas las rutinas de cuerpo que apliquen ese día, agrupadas (o la
  // única elegida a mano si hay override).
  const bodySub = document.getElementById('body-sec-sub');
  if (bodySub) {
    const bodyBadge = (ov.body && bodyList[0]) ? ` <span class="sec-override-badge" onclick="event.stopPropagation();clearRoutineOverride('body')">🔄 ${esc(bodyList[0].emoji||'')} ${esc(bodyList[0].name)} · toca para volver</span>` : '';
    bodySub.innerHTML = `Ducha <span class="sec-progress" id="prog-body-body"></span>${bodyBadge}`;
  }
  if (bodyList.length) {
    renderGroupedDbSteps('body-body', bodyList, stepsByRoutine, hydration, 'body');
  } else {
    const c = document.getElementById('body-body');
    if (c) c.innerHTML = '<div class="tap-hint">Sin rutina de cuerpo programada ese día.</div>';
  }
  updateSwitchBtnVisibility('body');
  // Feet
  const feetSub = document.getElementById('feet-sec-sub');
  if (feetSub) {
    const feetBadge = (ov.feet && feetList[0]) ? ` <span class="sec-override-badge" onclick="event.stopPropagation();clearRoutineOverride('feet')">🔄 ${esc(feetList[0].emoji||'')} ${esc(feetList[0].name)} · toca para volver</span>` : '';
    feetSub.innerHTML = `Nightly · ~15 min <span class="sec-progress" id="prog-feet-body"></span>${feetBadge}`;
  }
  if (feetList.length) {
    const steps = feetList.flatMap(r => stepsByRoutine[r.id] || []);
    renderDbSteps('feet-body', steps, null, hydration, 'feet');
  } else {
    const c = document.getElementById('feet-body');
    if (c) c.innerHTML = '<div class="tap-hint">Sin rutina de pies programada ese día.</div>';
  }
  updateSwitchBtnVisibility('feet');
}
async function init() {
  await loadProducts();
  renderHeaderDate();
  await loadTodayRoutines(TODAY_STR);
  renderPhotoTypeGrid();
  renderCategorySelects();
  renderReappCategories();
  loadTodayApplications();
  loadTodayNote();
  renderSpfReminderBtn();
  flushPending();
  fetchUV();
  setInterval(fetchUV, 30 * 60 * 1000);
  checkSpfReminder();
  setInterval(checkSpfReminder, 15 * 60 * 1000);
  checkPhotoReminder();
  // App abierta: el SW avisa por postMessage al tocar la notificación.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'LOG_SPF') quickLogSpf();
    });
  }
  handlePushLogParam();
  // El FAB muestra una hora objetivo, así que hay que refrescarlo aunque no
  // pase nada: si no, "Próxima 1:40 pm" se queda pegado después de esa hora.
  renderSpfFab();
  setInterval(renderSpfFab, 60 * 1000);
}

// ── AUTH ─────────────────────────────────────────────────────────────────────
let appStarted = false;
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-root').style.display = 'block';
  if (!appStarted) { appStarted = true; init(); }
}
function showLogin(message) {
  document.getElementById('app-root').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  const err = document.getElementById('login-error');
  if (message) { err.textContent = message; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
}
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  if (!email || !password) { showLogin('Escribe tu email y contraseña.'); return; }
  btn.disabled = true; btn.textContent = '⏳ Entrando...';
  const { error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { showLogin('❌ ' + error.message, 'error'); return; }
  showApp();
}
async function doLogout() {
  await db.auth.signOut();
  appStarted = false;
  location.reload();
}
(async function bootAuth() {
  // PWA: registra el service worker (cache del shell para abrir sin conexión).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const { data: { session } } = await db.auth.getSession();
  if (session) showApp(); else showLogin();
  db.auth.onAuthStateChange((event, session) => {
    if (session) showApp(); else showLogin();
  });
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
})();
