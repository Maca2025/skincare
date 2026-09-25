// ============================================================================
// Skincare Tracker — config.js
// La conexión a Supabase, en UN solo lugar. La leen las dos interfaces:
//   · index.html  (la app del celular)   → app.js
//   · escritorio.html (la de computadora) → escritorio.js
// Antes vivía escrita dentro de app.js; con dos interfaces, dos copias se
// desincronizan en silencio (regla 5 de ARQUITECTURA.md).
//
// Esta key es "publishable" y es seguro exponerla SOLO si RLS está activado
// con políticas en todas las tablas y en el bucket. Ver supabase-hardening.sql.
// ============================================================================
const SUPABASE_URL = 'https://psvphqieczrlbovwnxgi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_V4eBcTHlVl4JTj4EFszfTg_ReJU1Wy4';
