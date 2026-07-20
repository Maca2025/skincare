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
    step.classList.add('done');
    if (sb) updateProgress(sb.id);
    const nameEl = step.querySelector('.sc-name');
    if (nameEl) {
      selectedProduct = nameEl.textContent.trim();
      const ok = await logApplication('rutina', routineStepId);
      if (!ok) { step.classList.remove('done'); if (sb) updateProgress(sb.id); }
    }
  } else {
    step.classList.remove('done');
    if (sb) updateProgress(sb.id);
    const ok = await unlogRoutineStep(routineStepId, step);
    if (!ok) { step.classList.add('done'); if (sb) updateProgress(sb.id); }
    else if (step.dataset.picker) {
      // Paso con picker: quitar el "✓ producto elegido" y regresar el hint.
      const picked = step.querySelector('.sc-picked');
      if (picked) picked.outerHTML = '<div class="sc-pick-hint" style="font-size:11px;color:#C4818A;margin-top:5px;font-style:italic;">Toca para elegir producto →</div>';
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
function updateTodaySummary() {
  const el = document.getElementById('today-summary');
  if (!el) return;
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
  let spf;
  if (!_lastSpfTodayISO) {
    spf = `<span class="tsum-item tsum-warn">🛡️ sin SPF hoy</span>`;
  } else {
    const gapH = (Date.now() - new Date(_lastSpfTodayISO).getTime()) / 3600000;
    spf = gapH >= SPF_REMINDER_GAP_H
      ? `<span class="tsum-item tsum-warn">🛡️ hace ${gapH.toFixed(1)}h ⚠️</span>`
      : `<span class="tsum-item tsum-ok">🛡️ hace ${gapH < 1 ? Math.round(gapH * 60) + ' min' : gapH.toFixed(1) + 'h'}</span>`;
  }
  const uv = _currentUV != null
    ? `<span class="tsum-item${_currentUV >= 8 ? ' tsum-warn' : (_currentUV < 3 ? ' tsum-ok' : '')}">☀️ UV ${Math.round(_currentUV)}</span>`
    : '';
  el.innerHTML = `<div class="tsum-card">${parts.join('')}${spf}${uv}</div>`;
}
// ── ÍNDICE UV EN VIVO (Open-Meteo, gratis y sin key) ─────────────────────────
// Coordenadas de Guadalajara. Además de mostrarse en el resumen, hace el
// recordatorio SPF más exigente con UV alto y lo silencia con UV bajo.
async function fetchUV() {
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=20.67&longitude=-103.35&current=uv_index');
    const j = await r.json();
    _currentUV = (j && j.current && j.current.uv_index != null) ? j.current.uv_index : null;
  } catch (e) { _currentUV = null; }
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
  if (gb) gb.style.display = 'flex';
  updateUploadBtn();
}
// Overlay de silueta sobre el preview — para verificar que el ángulo/encuadre
// coincida con las fotos anteriores antes de subirla (si no coincide, retoma).
function togglePhotoGuide() {
  const ov = document.getElementById('photo-guide-overlay');
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
  const [appsRes, stepsRes, routinesRes, allStepsRes, notesRes] = await Promise.all([
    db.from('product_applications').select('id, product_name, product_id, applied_at, source, routine_step_id')
      .gte('applied_at', localDayBoundsUTC(toDateStr(since90)).startISO)
      .order('applied_at', { ascending: false }),
    db.from('routine_steps').select('product_id, routines(schedule_days)').not('product_id', 'is', null),
    db.from('routines').select('id, section_key, schedule_days, sort_order').eq('active', true),
    db.from('routine_steps').select('id, routine_id'),
    db.from('daily_notes').select('note_date, skin_state, sun_exposure').gte('note_date', toDateStr(since90))
  ]);
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
  const IDEAL_SPF_APPS = 5; // 1 rutina AM + 4 reaplicaciones
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
        sumPct += Math.min(100, Math.round(pts / (IDEAL_SPF_APPS * 100) * 100));
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
      sum += Math.min(100, Math.round((spfPointsByDate[ds] || 0) / (IDEAL_SPF_APPS * 100) * 100));
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
      return `El que más se te dificulta es ${esc(worstProduct.p.emoji || '')} ${esc(worstProduct.p.name)} (${worstProduct.adh.pct}%) — reforzarlo es tu mayor oportunidad aquí.`;
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
  const skinByDate = {};
  const sunByDate = {};
  ((notesRes && notesRes.data) || []).forEach(r => {
    if (r.skin_state) skinByDate[r.note_date] = r.skin_state;
    if (r.sun_exposure) sunByDate[r.note_date] = r.sun_exposure;
  });
  const heatHTML = (() => {
    // El title solo sirve con mouse; en móvil el detalle se muestra al TOCAR
    // el cuadro (showHeatDay), en la caja bajo el grid.
    _heatDayInfo = {};
    const DOW_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const cols = weekBuckets.map(b => {
      const cells = [];
      eachDateStr(b.start, b.end, (ds, dow) => {
        const p = dailyRoutinePct[ds];
        let bg = '#F0ECE7';
        if (p != null) bg = `rgba(40,120,72,${(0.15 + p * 0.85).toFixed(2)})`;
        const pctTxt = p != null ? `📋 ${Math.round(p * 100)}% de rutina completada` : '📋 sin registros de rutina';
        const skin = skinByDate[ds] ? ` · 🙂 piel ${skinByDate[ds]}/5` : '';
        const sun = sunByDate[ds] ? ` · ☀️ sol: ${sunByDate[ds]}` : '';
        _heatDayInfo[ds] = `<strong>${DOW_ES[dow]} ${fmtDate(ds)}</strong><br>${pctTxt}${skin}${sun}`;
        cells.push(`<div class="heat-cell" style="background:${bg}" onclick="showHeatDay('${ds}', this)"></div>`);
      });
      return `<div class="heat-col">${cells.join('')}</div>`;
    }).join('');
    return `<div class="heat-card">
  <div class="heat-title">🗓️ Constancia diaria · últimas 12 semanas</div>
  <div class="heat-grid">${cols}</div>
  <div class="heat-detail" id="heat-day-detail" style="display:none"></div>
  <div class="heat-legend">menos <span class="box" style="background:#F0ECE7"></span><span class="box" style="background:rgba(40,120,72,0.35)"></span><span class="box" style="background:rgba(40,120,72,0.65)"></span><span class="box" style="background:rgba(40,120,72,1)"></span> más · toca un día para ver el detalle</div>
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
${corrHTML}
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
${routineHTML}`;
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
    names.map(n => `<option value="${esc(n)}"${n === histFilter ? ' selected' : ''}>${esc(n)}</option>`).join('');
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
    return `<option value="${p.id}"${logName === r.product_name ? ' selected' : ''}>${esc(logName)}</option>`;
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
  <span class="reapp-entry-product">${esc(r.product_name)}</span>
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
function productIdForLoggedName(name) {
  if (!name) return null;
  const p = allProducts.find(p =>
    (p.logged_as && p.logged_as === name) ||
    (`${p.emoji} ${p.name}` === name) ||
    (p.name === name)
  );
  return p ? p.id : null;
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
const QUEUE_KEY = 'skincare_pending_applications';
function queuePending(row) {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    q.push(row);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (e) { /* storage lleno o bloqueado — nada que hacer */ }
}
async function flushPending() {
  let q;
  try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { q = []; }
  if (!q.length) return;
  const rest = [];
  for (const row of q) {
    const { error } = await db.from('product_applications').insert(row);
    if (error) rest.push(row);
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(rest));
  if (q.length !== rest.length) {
    showToast(`📶 ${q.length - rest.length} registro(s) offline sincronizados`, 'success');
    historyLoaded = false;
    loadTodayApplications();
    loadTodayRoutines(TODAY_STR);
  }
}
window.addEventListener('online', flushPending);

// Devuelve true si el registro quedó guardado (o encolado offline) — los
// callers usan esto para revertir el checkmark si falló.
async function logApplication(source, routineStepId) {
  if (!selectedProduct) return false;
  const name = selectedProduct;
  selectedProduct = null;
  const row = {
    product_name: name,
    product_id: productIdForLoggedName(name),
    applied_at: getBackdateOverrideISO() || new Date().toISOString(),
    source: source || null,
    routine_step_id: routineStepId || null
  };
  const { error } = await db.from('product_applications').insert(row);
  if (error) {
    if (!navigator.onLine || /fetch|network/i.test(error.message || '')) {
      queuePending(row);
      showToast('📡 Sin conexión — se guardará al reconectar', '');
      historyLoaded = false;
      return true;
    }
    showToast('❌ ' + error.message, 'error');
    return false;
  }
  showToast('✅ ' + name.split(' ').slice(0,3).join(' ') + ' registrado', 'success');
  loadTodayApplications();
  historyLoaded = false;
  return true;
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
  <span class="reapp-entry-product">${esc(r.product_name)}</span>
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
  const prod = allProducts.find(p => (p.logged_as || `${p.emoji} ${p.name}`) === productName);
  const why = (prod && prod.why_it_works)
    ? `<div class="sc-picked-why">💡 ${fmtRich(prod.why_it_works)}</div>` : '';
  const html = `<div class="sc-picked">
  <div class="sc-picked-name">✓ ${esc(productName)}</div>
  ${why}
  <div class="sc-picked-change">Toca para cambiar →</div>
</div>`;
  const hint = sc.querySelector('.sc-pick-hint');
  if (hint) hint.remove();
  const existing = sc.querySelector('.sc-picked');
  if (existing) existing.outerHTML = html;
  else sc.insertAdjacentHTML('beforeend', html);
}

// ── PICKERS ──────────────────────────────────────────────────────────────────
function spfItemHTML(p, selectFnName) {
  const logName = p.logged_as || `${p.emoji} ${p.name}`;
  return `<div class="spf-item tier-${cssSafe(p.tier)}" data-name="${esc(logName)}" onclick="${selectFnName}(this.dataset.name)">
  <div class="spf-item-name">${esc(p.emoji)} ${esc(p.name)}</div>
  <div class="spf-item-tags">${tagsOf(p).map(t => `<span class="spf-tag spf-tag-${cssSafe(t.cls)}">${esc(t.label)}</span>`).join('')}</div>
  <div class="spf-item-note">${fmtRich(p.note || '')}</div>
</div>`;
}
function openSPFPicker(stepId = null) {
  currentPickerStepId = stepId;
  const body = document.getElementById('spf-picker-body');
  const warnBox = `<div style="background:#FFF3E0;border-left:3px solid #D4820A;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#7A4A00;line-height:1.5;">
  <strong>⚠️ NO NEGOCIABLE para manchas solares.</strong> El UV es la causa directa de los sunspots — sin SPF diario, los despigmentantes aclaran mientras el sol vuelve a pigmentar.
</div>`;
  const products = allProducts.filter(p => p.category === '🌞 SPF Facial' && p.status !== 'out');
  body.innerHTML = warnBox + products.map(p => spfItemHTML(p, 'selectSPF')).join('') +
`<button class="spf-guide-btn" onclick="event.stopPropagation(); closeModal('spf-modal'); openCompare()">📊 Ver comparativa técnica →</button>`;
  openModal('spf-modal');
}
// Elegir desde cualquier picker: cierra modal, marca el paso, registra — y si
// el registro falla, revierte el checkmark (rollback).
async function pickAndLog(name, modalId) {
  const source = currentPickerStepId ? 'rutina' : 'reaplicacion';
  const routineStepId = routineStepIdFromPickerStepId(currentPickerStepId);
  const stepElId = currentPickerStepId;
  closeModal(modalId);
  markPickerStepDone(name);
  selectedProduct = name;
  const ok = await logApplication(source, routineStepId);
  if (!ok && stepElId) {
    const step = document.getElementById(stepElId);
    if (step) {
      step.classList.remove('done');
      const sb = step.closest('.sec-body');
      if (sb) updateProgress(sb.id);
    }
  }
}
async function selectSPF(name) { await pickAndLog(name, 'spf-modal'); }
function openBodySPFPicker(stepId = null) {
  currentPickerStepId = stepId;
  const body = document.getElementById('body-spf-picker-body');
  const warnBox = `<div style="background:#FFF3E0;border-left:3px solid #D4820A;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#7A4A00;line-height:1.5;">
  <strong>⚠️ Las manchas en brazos son UV-triggered</strong> — el mismo mecanismo que los sunspots de la cara. Sin SPF corporal diario no van a mejorar sin importar lo que apliques.
</div>`;
  const products = allProducts.filter(p => p.category === '☀️ SPF Corporal' && p.status !== 'out');
  body.innerHTML = warnBox + products.map(p => spfItemHTML(p, 'selectBodySPF')).join('');
  openModal('body-spf-modal');
}
async function selectBodySPF(name) { await pickAndLog(name, 'body-spf-modal'); }
async function selectFromGenericPicker(name) { await pickAndLog(name, 'product-picker-modal'); }
function openGenericPickerByCat(stepId, cat) {
  currentPickerStepId = stepId;
  document.getElementById('product-picker-title').textContent = cat;
  const body = document.getElementById('product-picker-body');
  body.innerHTML = allProducts
    .filter(p => p.category === cat && !p.no_reapp && p.status !== 'out')
    .map(p => spfItemHTML(p, 'selectFromGenericPicker')).join('');
  openModal('product-picker-modal');
}

// ── MULTI PICKER ─────────────────────────────────────────────────────────────
// Categorías donde un mismo paso admite VARIOS productos a la vez (eliges
// los que quieras cada día y se registra cada uno por separado). Para volver
// multi otra categoría, solo agrégala aquí.
const MULTI_PICK_CATEGORIES = ['💦 Toners', '✨ Serums AM'];
let multiPickSelected = new Set();
function openMultiPickerByCat(stepId, cat) {
  currentPickerStepId = stepId;
  multiPickSelected = new Set();
  document.getElementById('product-picker-title').textContent = cat + ' · elige uno o varios';
  const body = document.getElementById('product-picker-body');
  const items = allProducts.filter(p => p.category === cat && !p.no_reapp && p.status !== 'out');
  body.innerHTML = (items.length ? items.map(p => {
    const logName = p.logged_as || `${p.emoji} ${p.name}`;
    return `<div class="spf-item tier-${cssSafe(p.tier)} multi-pick" data-name="${esc(logName)}" onclick="toggleMultiPick(this)">
  <div class="spf-item-name"><span class="multi-pick-check">○</span> ${esc(p.emoji)} ${esc(p.name)}</div>
  <div class="spf-item-tags">${tagsOf(p).map(t => `<span class="spf-tag spf-tag-${cssSafe(t.cls)}">${esc(t.label)}</span>`).join('')}</div>
  <div class="spf-item-note">${fmtRich(p.note || '')}</div>
</div>`;
  }).join('') : '<div class="empty-state">No hay productos de esta categoría en Stock todavía.</div>') +
  `<button class="save-btn" id="multi-pick-btn" onclick="confirmMultiPick()" disabled style="margin-top:6px;margin-bottom:0">Aplicar seleccionados</button>`;
  openModal('product-picker-modal');
}
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
  const btn = document.getElementById('multi-pick-btn');
  if (btn) {
    btn.disabled = multiPickSelected.size === 0;
    btn.textContent = multiPickSelected.size
      ? `Aplicar ${multiPickSelected.size} seleccionado${multiPickSelected.size > 1 ? 's' : ''}`
      : 'Aplicar seleccionados';
  }
}
async function confirmMultiPick() {
  const names = [...multiPickSelected];
  if (!names.length) return;
  multiPickSelected = new Set();
  const source = currentPickerStepId ? 'rutina' : 'reaplicacion';
  const routineStepId = routineStepIdFromPickerStepId(currentPickerStepId);
  const stepElId = currentPickerStepId;
  closeModal('product-picker-modal');
  markPickerStepDone(names.join(' · '));
  let okCount = 0;
  for (const name of names) {
    selectedProduct = name;
    const ok = await logApplication(source, routineStepId);
    if (ok) okCount++;
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
      name: `${p.emoji || ''} ${p.name}`.trim(),
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
  <td style="padding:7px 8px 7px 4px;font-size:11px;font-weight:600;color:#2A2420;white-space:nowrap">${tierDot(r)}${esc(r.name)}${areaTag(r.area)}</td>
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
  if (name === 'photos')  { renderWeekCalendar(); if (!galleryLoaded) loadPhotoGallery(); }
  if ((name === 'history' || name === 'log') && !historyLoaded) loadHistory();
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
function renderInventory() {
  const el = document.getElementById('inventory-content');
  if (!el) return;
  const lowCount = allProducts.filter(p => p.status === 'low').length;
  const outCount = allProducts.filter(p => p.status === 'out').length;
  const okCount  = allProducts.length - lowCount - outCount;
  const summaryHTML = `<div class="inv-summary">
  <div class="inv-sum-card"><div class="inv-sum-val">${okCount}</div><div class="inv-sum-lbl">✅ Tengo</div></div>
  <div class="inv-sum-card"><div class="inv-sum-val amber">${lowCount}</div><div class="inv-sum-lbl">⚠️ Reponer</div></div>
  <div class="inv-sum-card"><div class="inv-sum-val red">${outCount}</div><div class="inv-sum-lbl">❌ Sin stock</div></div>
</div>`;
  const addBtn = `<button class="add-prod-btn" onclick="openAddProductModal()">＋ Agregar producto</button>`;
  const groups = {};
  for (const item of allProducts) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }
  const groupsHTML = Object.entries(groups).map(([cat, items]) =>
    `<div class="inv-group">
  <div class="inv-group-hdr">${esc(cat)}</div>
  ${items.map(invItemHTML).join('')}
</div>`).join('');
  el.innerHTML = summaryHTML + addBtn + groupsHTML;
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
  ['pf-emoji','pf-name','pf-brand','pf-note','pf-how','pf-why','pf-cat-custom','pf-opened','pf-pao'].forEach(id => {
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
      opened_at: openedAt, pao_months: paoMonths
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
    opened_at: openedAt, pao_months: paoMonths,
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
function renderRoutineList() {
  currentRoutineId = null;
  const el = document.getElementById('routines-content');
  if (!el) return;
  el.innerHTML = `
<div class="rout-hdr">
  <div class="rout-hdr-title">✏️ Rutinas</div>
  <button class="rout-add-btn" onclick="openAddRoutineModal()">＋ Nueva</button>
</div>
${allRoutines.map(r => `
<div class="rout-card" onclick="openRoutineDetail('${r.id}')">
  <div class="rout-card-emoji">${esc(r.emoji)}</div>
  <div class="rout-card-info">
    <div class="rout-card-name">${esc(r.name)}</div>
    <div class="rout-card-sched">${fmtSection(r.section_key)} · ${fmtDays(r.schedule_days)}</div>
    <div class="rout-card-sub" id="rout-sub-${r.id}">cargando...</div>
  </div>
  <button class="rout-card-del" title="Duplicar rutina" onclick="event.stopPropagation(); duplicateRoutine('${r.id}')">📄</button>
  <button class="rout-card-del" onclick="event.stopPropagation(); deleteRoutine('${r.id}')">🗑️</button>
  <div class="rout-card-arrow">›</div>
</div>`).join('')}`;
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
    prods.map(p => `<option value="${p.id}">${esc(p.emoji)} ${esc(p.name)}</option>`).join('');
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
function pickerFnForCat(cat, stepId) {
  if (cat === '🌞 SPF Facial')   return `openSPFPicker('${stepId}')`;
  if (cat === '☀️ SPF Corporal') return `openBodySPFPicker('${stepId}')`;
  if (MULTI_PICK_CATEGORIES.includes(cat)) return `openMultiPickerByCat('${stepId}','${jsAttrEsc(cat)}')`;
  return `openGenericPickerByCat('${stepId}','${jsAttrEsc(cat)}')`;
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
  if (cat === '🌞 SPF Facial')   return `openSPFPicker()`;
  if (cat === '☀️ SPF Corporal') return `openBodySPFPicker()`;
  if (MULTI_PICK_CATEGORIES.includes(cat)) return `openMultiPickerByCat(null,'${jsAttrEsc(cat)}')`;
  return `openGenericPickerByCat(null,'${jsAttrEsc(cat)}')`;
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
function dbStepHTML(s, index, todayHydration) {
  const n  = index + 1;
  const id = 'sd_' + Math.random().toString(36).slice(2, 9);
  const _prod = stepProductOf(s) || allProducts.find(p => p.name === s.name);
  const dEmoji = _prod ? (_prod.emoji || '') : (s.emoji || '');
  const dName  = _prod ? _prod.name : s.name;
  const dBrand = _prod ? (_prod.brand || '') : (s.brand || '');
  const _whyTxt = (_prod && _prod.why_it_works) ? _prod.why_it_works : s.why_it_works;
  const why  = _whyTxt ? `<div class="det-why">💡 ${fmtRich(_whyTxt)}</div>` : '';
  const warn = s.warn ? `<div class="det-warn">${fmtRich(s.warn)}</div>` : '';
  // ¿Este paso exacto ya se aplicó ese día? Prioridad 1: routine_step_id.
  // Prioridades 2/3/4: heurísticos viejos, solo para historial previo.
  let appliedName = null;
  if (todayHydration) {
    if (todayHydration.byStepId && todayHydration.byStepId.has(s.id)) {
      appliedName = todayHydration.byStepId.get(s.id);
    } else if (s.product_id && todayHydration.byProductId.has(s.product_id)) {
      appliedName = todayHydration.byProductId.get(s.product_id);
    } else if (s.picker_category && todayHydration.byCategory.has(s.picker_category)) {
      appliedName = todayHydration.byCategory.get(s.picker_category);
    } else if (!s.picker_category && !s.product_id) {
      const expected = `${dEmoji} ${dName}`.trim();
      if (todayHydration.byName.has(expected)) appliedName = todayHydration.byName.get(expected);
    }
  }
  const doneCls = appliedName ? ' done' : '';
  if (s.picker_category) {
    const pickerFn = pickerFnForCat(s.picker_category, `step_${id}`);
    const pickedBlock = appliedName
      ? `<div class="sc-picked">
  <div class="sc-picked-name">✓ ${esc(appliedName)}</div>
  <div class="sc-picked-change">Toca para cambiar →</div>
</div>`
      : `<div class="sc-pick-hint" style="font-size:11px;color:#C4818A;margin-top:5px;font-style:italic;">Toca para elegir producto →</div>`;
    return `<div class="step${doneCls}" id="step_${id}" data-routine-step-id="${s.id}" data-picker="1">
  <div class="sn" onclick="checkStep('step_${id}',event)">
    <span class="sn-num">${n}</span><span class="sn-check">✓</span>
  </div>
  <div class="sc" onclick="try{${pickerFn}}catch(e){showToast('❌ Picker: '+e.message,'error')}">
    <div class="sc-top"><span class="sc-name">${esc(s.emoji||'')} ${esc(s.name)}</span></div>
    <div class="sc-brand">${esc(s.brand||'')}</div>
    ${pickedBlock}
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
  </div>
  <div class="step-chevron" onclick="toggleStep('step_${id}','${id}')">›</div>
</div>`;
}
function renderDbSteps(bodyId, steps, nightType, todayHydration) {
  const c = document.getElementById(bodyId);
  const hint = c.querySelector('.tap-hint');
  let badge = '';
  if (nightType) {
    const info = PM_NIGHT_INFO[nightType];
    badge = `<div style="padding:8px 16px 4px">
      <span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;background:${info.bg};color:${info.color}">${info.label}</span>
    </div>`;
  }
  c.innerHTML = (hint ? hint.outerHTML : '') + badge + steps.map((s, i) => dbStepHTML(s, i, todayHydration)).join('');
  updateProgress(bodyId);
}
function renderGroupedDbSteps(bodyId, routines, stepsByRoutine, todayHydration) {
  const c = document.getElementById(bodyId);
  const hint = c.querySelector('.tap-hint');
  const groupsHTML = routines.map(r => {
    const steps = stepsByRoutine[r.id] || [];
    if (!steps.length) return '';
    const title = `<div class="reapp-history-title">${esc(r.emoji || '')} ${esc(r.name)}</div>`;
    return title + steps.map((s, i) => dbStepHTML(s, i, todayHydration)).join('');
  }).join('');
  c.innerHTML = (hint ? hint.outerHTML : '') + groupsHTML;
  updateProgress(bodyId);
}

// ── TODAY (carga AM/PM/Body/Feet para un día específico) ─────────────────────
async function loadTodayRoutines(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const { data: routines } = await db.from('routines')
    .select('*').eq('active', true).order('sort_order');
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
  const ids = [...new Set([...Object.values(bySection).map(r => r.id), ...bodyRoutines.map(r => r.id), ...feetRoutines.map(r => r.id)])];
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
  const hydration = { byStepId: new Map(), byProductId: new Map(), byCategory: new Map(), byName: new Map() };
  (appsForHydration || []).forEach(r => {
    const label = r.product_name;
    if (r.routine_step_id) {
      // Un paso multi (ej. Toners) puede tener VARIAS aplicaciones el mismo
      // día — se concatenan para mostrarlas todas en el paso.
      const prev = hydration.byStepId.get(r.routine_step_id);
      hydration.byStepId.set(r.routine_step_id, prev ? prev + ' · ' + label : label);
      return;
    }
    if (r.product_id) hydration.byProductId.set(r.product_id, label);
    const prod = r.product_id ? _prodByIdForHydration[r.product_id] : null;
    if (prod && prod.category) hydration.byCategory.set(prod.category, label);
    hydration.byName.set(label, label);
  });
  // AM
  const amR = bySection['am'];
  if (amR) {
    const steps = stepsByRoutine[amR.id] || [];
    document.getElementById('am-sec-sub').innerHTML =
      `Face &amp; Neck <span class="sec-progress" id="prog-am-body"></span>`;
    renderDbSteps('am-body', steps, null, hydration);
  }
  // PM
  const pmR = bySection['pm'];
  if (pmR) {
    const steps = stepsByRoutine[pmR.id] || [];
    const nightType = pmNightType(dow);
    const nightInfo = PM_NIGHT_INFO[nightType];
    document.getElementById('pm-sec-sub').innerHTML =
      `Face &amp; Neck ${nightCapsule(nightInfo)} <span class="sec-progress" id="prog-pm-body"></span>`;
    renderDbSteps('pm-body', steps, nightType, hydration);
  }
  // Body — todas las rutinas de cuerpo que apliquen ese día, agrupadas.
  if (bodyRoutines.length) {
    renderGroupedDbSteps('body-body', bodyRoutines, stepsByRoutine, hydration);
  } else {
    const c = document.getElementById('body-body');
    if (c) c.innerHTML = '<div class="tap-hint">Sin rutina de cuerpo programada ese día.</div>';
  }
  // Feet
  if (feetRoutines.length) {
    const steps = feetRoutines.flatMap(r => stepsByRoutine[r.id] || []);
    renderDbSteps('feet-body', steps, null, hydration);
  } else {
    const c = document.getElementById('feet-body');
    if (c) c.innerHTML = '<div class="tap-hint">Sin rutina de pies programada ese día.</div>';
  }
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
