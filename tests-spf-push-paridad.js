// ============================================================================
// tests-spf-push-paridad.js — la app y el push tienen que decir lo MISMO
//
//   node tests-spf-push-paridad.js
//
// El ritmo de reaplicación vive en dos sitios: `pure.js` (la app) y
// `spf-push-function.ts` (la Edge Function). Deno no puede importar el pure.js
// del repo y no hay build en este proyecto, así que la duplicación es
// inevitable — lo que NO es inevitable es que se separen sin que nadie se
// entere.
//
// Ese fallo sería silencioso, que es la peor clase en este proyecto: la app
// diría "siguiente en 1.5 h" y el push seguiría llegando cada 2 h. Ningún
// error, ninguna traza, solo dos números distintos durante meses. Es la misma
// familia del "espejo" de cuello que se perdió al refactorizar.
//
// Esta prueba lee AMBOS archivos como texto y compara lo que de verdad
// importa: bandas, plazos, margen de ocaso y los títulos de los avisos.
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const TS_PATH = path.join(dir, 'spf-push-function.ts');
// Faltar el archivo es un FALLO, no un permiso para pasar. Hasta el 2026-08-09
// esto salía con éxito y sin comparar nada, y así es exactamente como dos
// divergencias reales sobrevivieron más de una semana: el .ts vivía solo en el
// dashboard de Supabase, la prueba no lo encontraba y el semáforo decía verde.
// Una prueba que se rinde en silencio es peor que no tener prueba.
if (!fs.existsSync(TS_PATH)) {
  console.log('❌ No está spf-push-function.ts junto a pure.js.');
  console.log('   Esta prueba EXISTE para evitar que la app y el push se separen.');
  console.log('   Sin el archivo no puede comparar nada, así que falla a propósito.');
  console.log('   Trae una copia desde el dashboard de Supabase al repositorio.');
  process.exit(1);
}
const ts = fs.readFileSync(TS_PATH, 'utf8');

// pure.js se ejecuta de verdad; del .ts se extraen los valores con regex (no se
// puede ejecutar TS de Deno desde node, y no vale la pena una toolchain solo
// para esto).
const NOMBRES = ['uvBand', 'spfGapHours', 'spfNudgeText', 'SPF_MINUTOS_ANTES_DE_OCASO',
                 'SPF_GAP_POR_EXPOSICION'];
const ctx = { console, __api: null };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'pure.js'), 'utf8')
  + `\n;__api = { ${NOMBRES.join(', ')} };`, ctx, { filename: 'pure.js' });
const { uvBand, spfGapHours, spfNudgeText, SPF_MINUTOS_ANTES_DE_OCASO,
        SPF_GAP_POR_EXPOSICION } = ctx.__api;

let pass = 0, fail = 0;
function t(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++; console.log(`❌ ${name}\n   pure.js: ${w}\n   push .ts: ${g}`);
}

// ── PLAZOS POR BANDA ────────────────────────────────────────────────────────
const mapaTs = {};
const bloque = (ts.match(/const\s+SPF_GAP_POR_BANDA[^=]*=\s*\{([^}]*)\}/) || [])[1] || '';
bloque.split(',').forEach(par => {
  const m = par.match(/(\w+)\s*:\s*(null|[\d.]+)/);
  if (m) mapaTs[m[1]] = m[2] === 'null' ? null : Number(m[2]);
});
['bajo', 'moderado', 'alto', 'muy_alto', 'extremo'].forEach(banda => {
  // Un UV representativo de cada banda, para leer el plazo desde pure.js sin
  // exponer su tabla interna.
  const uvDe = { bajo: 1, moderado: 4, alto: 6.5, muy_alto: 9, extremo: 12 }[banda];
  t(`plazo de la banda "${banda}"`, mapaTs[banda], spfGapHours(uvDe));
  t(`la banda de UV ${uvDe} es "${banda}"`, banda, uvBand(uvDe));
});
t('el .ts no inventó bandas de más', Object.keys(mapaTs).sort(),
  ['alto', 'bajo', 'extremo', 'moderado', 'muy_alto']);

// ── MARGEN DE OCASO ─────────────────────────────────────────────────────────
const margenTs = Number((ts.match(/SPF_MINUTOS_ANTES_DE_OCASO\s*=\s*(\d+)/) || [])[1]);
t('margen antes del ocaso', margenTs, SPF_MINUTOS_ANTES_DE_OCASO);

// ── RESPALDO SIN DATO DE UV ─────────────────────────────────────────────────
// Los dos tienen que seguir avisando cuando Open-Meteo no responde.
const fallbackTs = Number((ts.match(/GAP_FALLBACK_H\s*=\s*([\d.]+)/) || [])[1]);
t('plazo cuando no hay dato de UV', fallbackTs, spfGapHours(null));

// ── TÍTULOS DE LOS AVISOS ───────────────────────────────────────────────────
// Es lo único que se lee en la pantalla de bloqueo: si divergen, la app y el
// push hablan con dos voces distintas.
[[12, 'extremo'], [9, 'muy_alto'], [6.5, 'alto'], [4, 'moderado'], [1, 'bajo']].forEach(([uv, banda]) => {
  // `\b` no es adorno: sin él, "alto" hacía match dentro de "muy_alto" (el `_`
  // es carácter de palabra, así que la frontera solo existe al inicio real del
  // nombre) y la prueba comparaba el título equivocado. La cazó ella misma.
  const re = new RegExp(`\\b${banda}\\s*:\\s*\\{\\s*titulo:\\s*'([^']+)',\\s*cola:\\s*'([^']+)'`);
  const m = ts.match(re) || [];
  t(`título de "${banda}"`, m[1], spfNudgeText(uv, 2).titulo);
  // El CUERPO también, no solo el título. Comparar únicamente títulos dejó
  // pasar que las colas de muy_alto y extremo siguieran diciendo "cada 1.5 h"
  // después de que la app corrigiera el ritmo a 2 h: mismo titular, instrucción
  // contraria. Es el texto que ella lee y obedece.
  const colaApp = spfNudgeText(uv, 2).cuerpo.split('. ').slice(1).join('. ');
  t(`cuerpo del aviso de "${banda}"`, m[2], colaApp);
});

// ── CADENCIA POR TIPO DE EXPOSICIÓN ─────────────────────────────────────────
// La app usa esta tabla desde el 2026-08-01 y SUSTITUYE a la banda de UV cuando
// se conoce la exposición del día. Si el push no la tiene, en un día de alberca
// avisa cada 2 h cuando debería hacerlo cada 70 min.
const expTs = {};
const bloqueExp = (ts.match(/const\s+SPF_GAP_POR_EXPOSICION[^=]*=\s*\{([^}]*)\}/) || [])[1] || '';
bloqueExp.split(',').forEach(par => {
  const m = par.match(/(\w+)\s*:\s*([\d.]+)\s*(?:\/\s*([\d.]+))?/);
  if (m) expTs[m[1]] = m[3] ? Number(m[2]) / Number(m[3]) : Number(m[2]);
});
t('el push conoce las mismas exposiciones', Object.keys(expTs).sort(),
  Object.keys(SPF_GAP_POR_EXPOSICION).sort());
Object.keys(SPF_GAP_POR_EXPOSICION).forEach(k => {
  t(`cadencia de "${k}"`, expTs[k], SPF_GAP_POR_EXPOSICION[k]);
});
// Y que de verdad la aplique: la exposición manda sobre la banda de UV.
t('el .ts pasa la exposición a spfGapHours',
  /spfGapHours\(uv,\s*exposure\)/.test(ts), true);
t('el .ts lee la exposición del día de daily_notes',
  /daily_notes[\s\S]{0,200}sun_exposure/.test(ts), true);

// ── LA VENTANA HORARIA ──────────────────────────────────────────────────────
const inicioTs = Number((ts.match(/SPF_HORA_INICIO\s*=\s*(\d+)/) || [])[1]);
t('hora a la que empieza a avisar', inicioTs, 8);
// El corte viejo de las 19 h sobrevive SOLO como respaldo sin dato de ocaso.
t('el .ts conserva el respaldo de las 19 h', /gdlHour\s*>=\s*19/.test(ts), true);

console.log(`\n${fail ? '❌' : '✅'} paridad app ↔ push: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
