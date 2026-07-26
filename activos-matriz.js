// ══════════════════════════════════════════════════════════════════════════
// MATRIZ DE ACTIVOS → EJES DE RESULTADO  (Fase B)
// Generado a partir de la composicion declarada de cada producto.
//
// POTENCIA 0-100 por eje. Rubrica:
//   90-100  estandar de oro / grado prescripcion a concentracion eficaz
//   75-89   activo OTC fuerte con evidencia clinica a concentracion eficaz
//   55-74   activo de soporte solido
//   35-54   contribucion moderada
//   15-34   adyuvante marginal
//        0  no toca ese eje
//
// 'SPF' = no se pone numero: se toma spfScoreOf(p) para no duplicar la
// calibracion UVA (una sola fuente de verdad).
// ══════════════════════════════════════════════════════════════════════════
const DOSE_AXES = {
  proteccion: { icon: '🛡️', label: 'Protección solar', color: '#C4818A', grupo: 'cara', techoDiario: 500, diasIdeales: 7 },
  aclarado: { icon: '🎯', label: 'Aclarado / pigmentación', color: '#C47A00', grupo: 'cara', techoDiario: 370, diasIdeales: 7 },
  textura: { icon: '🔬', label: 'Renovación, textura y poros', color: '#7E6BB0', grupo: 'cara', techoDiario: 265, diasIdeales: 4 },
  barrera: { icon: '💧', label: 'Barrera e hidratación', color: '#3A8A7A', grupo: 'cara', techoDiario: 460, diasIdeales: 7 },
  firmeza: { icon: '🧬', label: 'Firmeza / colágeno', color: '#B0567E', grupo: 'cara', techoDiario: 200, diasIdeales: 6 },
  cuerpo_proteccion: { icon: '☀️', label: 'Protección corporal', color: '#C4818A', grupo: 'cuerpo', techoDiario: 500, diasIdeales: 7 },
  cuerpo_textura: { icon: '🫧', label: 'Textura corporal', color: '#7E6BB0', grupo: 'cuerpo', techoDiario: 80, diasIdeales: 3 },
  cuerpo_firmeza: { icon: '🧬', label: 'Firmeza corporal', color: '#B0567E', grupo: 'cuerpo', techoDiario: 75, diasIdeales: 5 },
  cuerpo_barrera: { icon: '💧', label: 'Hidratación corporal', color: '#3A8A7A', grupo: 'cuerpo', techoDiario: 95, diasIdeales: 7 },
  pies: { icon: '🦶', label: 'Pies / queratolítico', color: '#8A6A00', grupo: 'pies', techoDiario: 85, diasIdeales: 7 },
  cabello: { icon: '💇', label: 'Cabello', color: '#5B8FA8', grupo: 'cabello', techoDiario: 70, diasIdeales: 3 },
  manos: { icon: '✋', label: 'Manos y brazos / pigmentación', color: '#C47A00', grupo: 'manos', techoDiario: 90, diasIdeales: 7 },
  manos_proteccion: { icon: '🧴', label: 'Protección manos', color: '#C4818A', grupo: 'manos', techoDiario: 500, diasIdeales: 7 },
  labios: { icon: '💋', label: 'Labios', color: '#A8455E', grupo: 'labios', techoDiario: 110, diasIdeales: 7 },
  cuello_proteccion: { icon: '🛡️', label: 'Protección cuello', color: '#C4818A', grupo: 'cuello', techoDiario: 500, diasIdeales: 7 },
  cuello_aclarado: { icon: '🎯', label: 'Aclarado cuello', color: '#C47A00', grupo: 'cuello', techoDiario: 135, diasIdeales: 7 },
  // 110 y no 130: en el cuello no se apilan tantos activos como en la cara. Una
  // noche de tretinoína entrega 80 y una de ácidos ~115, así que con 130 el eje
  // no llegaba a 100% ni haciéndolo todo bien. Los techos se calibran contra el
  // día real, no contra la suma teórica de todo el catálogo.
  cuello_textura: { icon: '🔬', label: 'Renovación cuello', color: '#7E6BB0', grupo: 'cuello', techoDiario: 110, diasIdeales: 4 },
  cuello_barrera: { icon: '💧', label: 'Barrera cuello', color: '#3A8A7A', grupo: 'cuello', techoDiario: 150, diasIdeales: 7 },
  cuello_firmeza: { icon: '🧬', label: 'Firmeza cuello', color: '#B0567E', grupo: 'cuello', techoDiario: 170, diasIdeales: 6 },
};

// ── ZONA 'cuello' — agregada 2026-07-25 ─────────────────────────────────────
// Antes el cuello estaba PARTIDO: la Neck & Chest Firming Cream y la mascarilla
// de péptidos puntuaban en ejes de CARA, y la crema WEUD en ejes de CUERPO. Tres
// productos de la misma zona en dos grupos distintos, así que ninguna de las dos
// métricas decía nada real sobre el cuello.
//
// Lleva los 5 ejes de la cara y no un subconjunto, porque la piel del cuello se
// comporta como piel facial —de hecho es MÁS fina, con menos densidad sebácea y
// menos soporte dérmico—. En particular conserva `cuello_textura` aunque "poros"
// no sea un tema aquí: ese es el eje que dispara el aviso de sobre-exposición a
// irritantes (ver EJE_IRRITANTE_POR_GRUPO en app.js), y el cuello es justo donde
// la tretinoína irrita ANTES que en la cara. Quitarlo habría dejado sin aviso la
// zona que más lo necesita.
//
// ── El espejo del SPF ───────────────────────────────────────────────────────
// La usuaria confirma que cada vez que se aplica protector en la cara se lo
// aplica también en el cuello. Por eso `cuello_proteccion` NO lleva entradas
// propias en PRODUCT_DOSE ni productos duplicados "(Cuello)" en la base como sí
// se hizo con Manos: se DERIVA en app.js de toda aplicación con eje
// `proteccion` (constante ESPEJO_SPF_CUELLO). Es la regla 5 —nada de listas
// duplicadas—: un SPF facial nuevo queda cubierto solo, sin que nadie recuerde
// añadirlo en dos sitios. Su ideal es el de la CARA, no el de cuerpo, porque es
// literalmente la misma aplicación.
//
// ⚠️ Consecuencia a tener presente: mientras se extiendan TODOS los protectores
// al cuello, esta barra va a marcar lo mismo que la de Protección facial. No es
// un bug —es la lectura correcta de "misma aplicación, dos zonas"— y se separa
// en el momento en que aparezca un SPF que no se extienda o uno específico de
// cuello. Si algún día se prefiere medir solo la primera aplicación del día
// (mañana sí, retoques no), es cambiar ESPEJO_SPF_CUELLO en app.js.
//
// ── Por qué los productos extendidos puntúan MENOS que en la cara ───────────
// Los que se aplican "en cara, cuello y escote" reparten la misma cantidad de
// producto sobre ~3x de superficie: la dosis por cm² baja de verdad. Se aplica
// un factor ~0.85 sobre su valor facial. No es un castigo por desviarse (eso es
// justo lo que Fase B eliminó), es que la dosis entregada por unidad de piel es
// menor. Los productos EXCLUSIVOS de cuello conservan su valor íntegro.
//
// Techos y diasIdeales PROVISIONALES, igual que lo fueron los de `manos` y
// `labios`: salen de simular días típicos, no de datos observados. Recalibrar
// con ~1 mes de registros reales.

// ── EJE 'labios' — agregado 2026-07-25 ──────────────────────────────────────
// Hasta hoy los labiales eran los ÚNICOS productos deliberadamente fuera de
// todos los ejes (FASE-B §1: "solo el bálsamo labial queda fuera"). El criterio
// original era correcto pero incompleto: los labios no son piel facial —no
// tienen estrato córneo comparable ni participan en manchas, textura o firmeza
// de la cara— pero de ahí no se sigue que no haya nada que medir. Se sigue que
// necesitan eje PROPIO, exactamente el mismo razonamiento con que `pies`,
// `cabello` y `manos` salieron de los ejes genéricos (FASE-B §2).
//
// Qué mide: hidratación y fotoprotección del bermellón. Es el tejido con MENOS
// defensa UV del cuerpo —melanina casi nula y estrato córneo de 3-5 capas
// contra las 15-20 de la piel facial—, y es donde aparecen queilitis actínica y
// lentigos labiales. En una usuaria cuyo foco clínico es manchas solares, tener
// SPF labial sin medir era un hueco real, no una omisión inofensiva.
//
// NO se mete en `proteccion` aunque el bálsamo lleve SPF50: ese eje mide
// protección de la CARA y su ideal se modula por aplicaciones faciales. Un
// bálsamo de labios inflaría esa métrica sin cubrir un solo cm² de mejilla.
// Por la misma razón `labios` NO usa spfScoreOf: el puntaje aquí es mixto
// (hidratación + protección), no protección pura, así que lleva número fijo.
//
// techoDiario 110 y diasIdeales 7 son PROVISIONALES, igual que lo fueron los de
// `manos`: no hay datos reales todavía. Con 110, un día de solo bálsamo (60)
// da ~55% y un día de bálsamo + sérum (130) topa en 100% — discrimina. Si en
// ~1 mes se queda clavado arriba, subir el techo (mismo procedimiento que la
// recalibración del 2026-07-23).

// ── EJE 'manos_proteccion' — agregado 2026-07-23 ────────────────────────────
// Mismo patrón que 'cuerpo_proteccion': techoDiario=500 fijo (IDEAL_SPF_APPS=5
// aplicaciones x 100 pts) y el ideal diario real se modula por sun_exposure en
// app.js reusando idealBodySpfAppsFor (interior 1 · normal 1 · alta 2 · playa
// 4) — así lo pidió la usuaria, "igual que cuerpo". NO lleva número en
// PRODUCT_DOSE (va null): se toma spfScoreOf(p), igual que proteccion y
// cuerpo_proteccion — una sola fuente de verdad para la calibración UVA.
// Requiere que app.js tenga el `else if (ax === 'manos_proteccion')` en el
// bucle de dosePtsByDate (ver ARQUITECTURA/handoff de la conversación).

// ── EJE 'manos' — agregado 2026-07-23 ───────────────────────────────────────
// Nuevo, mismo patrón que 'pies': zona del cuerpo con su propio eje porque los
// productos que la tratan (crema de manos, jabón despigmentante) no encajan
// en los ejes genéricos de cuerpo. Enfoque: pigmentación/manchas en manos y
// brazos (mismo mecanismo que `aclarado` en cara — inhibición de tirosinasa —
// pero NO se mete al eje `aclarado` porque ese es solo cara, ver regla 11).
// techoDiario=90 y diasIdeales=7 son PROVISIONALES (como lo fueron los techos
// originales de Fase B) — no hay datos reales todavía porque los productos
// son nuevos. Recalibrar con datos reales en ~1 mes, igual que se hizo con
// aclarado/textura/barrera/firmeza el 2026-07-23.

// techoDiario  = dosis maxima util en un dia (rendimientos decrecientes).
// diasIdeales  = dias/semana para llegar al 100%. Pasarse NO penaliza el
//                puntaje (se topa), pero dispara el aviso de sobre-exfoliacion.
// idealSemanal = techoDiario * diasIdeales.
//
// ── RECALIBRACIÓN 2026-07-23 (datos reales, no simulación) ──────────────────
// aclarado/textura/barrera/firmeza estaban pegados en 90-100% con los techos
// originales (85-100% de los días de julio topaban el techo). Se recalibraron
// al percentil 90 real de puntos/día observado en 23 días de product_applications
// (1-23 jul 2026): aclarado 115→370, textura 95→265, barrera 140→460,
// firmeza 115→200. Con esto las mismas 4 semanas pasan de ~90-100% fijo a un
// rango 43-100% que sí distingue semana buena de floja.
// proteccion NO se tocó: nunca topaba su techo (máximo real 330/500) y ya
// discriminaba (15-36% semanal) — es el único eje con señal útil hoy.
// cuerpo_*, pies y cabello NO se tocaron: solo 2-14 días con registro, muy
// poco para recalibrar con confianza. Revisar de nuevo cuando haya ~3-4
// semanas continuas de datos en esos ejes.

const PRODUCT_DOSE = {
  '0193747b-4c2f-4f7d-ac97-7565c98b94b6': { textura: 10 },  // Limpiador Oleoso
  '05f7037d-f73b-4ff8-9081-c64afb2c5cf2': { cuerpo_textura: 40, cuerpo_firmeza: 45 },  // Retinol Overnight Lotion — CORREGIDO 2026-07-23: usuaria confirma uso en CUERPO, no cara (aunque el note del producto en `products` diga "cara, cuello y escote" — revisar/actualizar ese texto si se puede). Puntos algo por debajo de las cremas corporales de retinol dedicadas (cuerpo_firmeza 55-60/cuerpo_textura 45-50) porque es "fórmula suave para principiantes".
  '0dfd4acf-5300-4822-aa77-f048fa588cd8': { barrera: 30, textura: 15 },  // Spray Ácido Hipocloroso
  // EXTENDIDO A CUELLO ("cara y cuello" en sus instrucciones), factor ~0.85.
  '110a2828-a348-41f3-93b6-bc2b7612d731': { textura: 70, aclarado: 30, barrera: 10, cuello_textura: 60, cuello_aclarado: 25 },  // Toner AHA BHA PHA + Niacinamide 2%
  '17913609-6130-48bd-977e-45ee06379ff6': { barrera: 80, aclarado: 20, firmeza: 15 },  // Hyalu-Cica Moisture Cream
  '18d9e716-ed74-41f9-b234-a4c0fcd229c1': { barrera: 80, aclarado: 20 },  // Toleriane Double Repair Face Moisturizer
  '1b656610-fce5-45a6-b6e8-8ec33e209653': { aclarado: 70, barrera: 25 },  // Anti-Pigment Contorno de Ojos
  // EXTENDIDO A CUELLO (cara + cuello + escote), factor ~0.85.
  '1e59f9b3-18b8-4a98-91a0-376a0f8f72f8': { firmeza: 80, textura: 30, barrera: 15, cuello_firmeza: 70, cuello_textura: 25, cuello_barrera: 15 },  // Multi-Peptide + Copper Peptides 1% Serum
  '20064300-8139-45ef-b803-4e4bf61d94bc': { barrera: 60, firmeza: 30 },  // Black Rice Probiotics NAD+ Serum Mist
  '2026eae7-7ae3-4596-b61f-8b3bb5cd2088': { proteccion: null }, /* proteccion via spfScoreOf */  // Tocobo Sun Stick Cotton Soft SPF50
  '21a728f9-3cfa-43eb-a3fe-8a57d417240f': { barrera: 85 },  // Sleeping Pack Ceramidas + Cica
  '22b2bb98-8431-4d40-8ffe-08f02f3db40b': { barrera: 65, aclarado: 15 },  // Cerave Eye Repair Cream
  '23236746-4738-468c-b043-250f0db91ddb': { barrera: 25 },  // Limpiador Hidratante
  '27826422-4e8b-47a3-a6a0-27f436ce2b26': { proteccion: null }, /* proteccion via spfScoreOf */  // Black Rice Airyfit Sunscreen
  '2b41c15a-bbab-4a44-b583-476d0f11f3f9': { cuerpo_barrera: 75 },  // Dove Ceramidas Body Lotion
  '3b90cc0e-7170-4f62-9e99-c582510d6361': { barrera: 55 },  // Ceramide Eye Cream Stick
  // EXTENDIDO A CUELLO, factor ~0.85. Ya parte de un valor bajo por ser
  // limpiador de enjuague (tiempo de contacto corto).
  '3ba97655-b68a-4084-8bec-fd0c4aac09de': { textura: 25, aclarado: 15, cuello_textura: 20, cuello_aclarado: 15 },  // Glycolic Bright Gel Cleanser
  '3c1c8b13-bf04-4cf2-a154-5f0d0e2be2ec': { proteccion: null }, /* proteccion via spfScoreOf */  // Isdin Fusion Water Color SPF50
  '3cef35a0-bc27-440f-9d97-a19709ee2bb9': { cabello: 70 },  // Lambdapil Shampoo Anticaída
  '3d201bba-ff43-413e-b96b-3c443bec8057': { pies: 85 },  // Crema Urea 70% SA 2%
  '44b6586f-754c-49a0-b6f6-867d77bd2e44': { pies: 45 },  // Crema con Lanolina
  '4c775124-b388-45d0-941f-77cf67c48148': { proteccion: null }, /* proteccion via spfScoreOf */  // L'Oréal UV Defender SPF50 PA++++
  '50e32222-59b0-4b20-ad26-23b552f91239': { cuerpo_textura: 70 },  // Salicylic Acid 2% Spray
  '57ff2048-f0d3-42a6-a9e5-8e56fb8a564e': { proteccion: null }, /* proteccion via spfScoreOf */  // Anthelios UVMune 400 SPF50
  '5e0fd428-5d22-41ed-91d9-bcd57fddad20': { cuerpo_proteccion: null }, /* proteccion via spfScoreOf */  // Heliocare 360 Opti D Gel SPF50
  '5f197c24-5c60-4d16-8bb6-b0c80bd621f8': { textura: 75 },  // Salicylic Acid 2% Masque
  '6447629f-d5f2-4a83-b011-006b25cf18e3': { pies: 90 },  // Aceite Urea 60%
  // EXCLUSIVO DE CUELLO — movido 2026-07-25 de ejes de cara a ejes de cuello.
  // Valor íntegro: no es un producto extendido, es su zona.
  '6b2ab52e-8479-4016-a8eb-2a61864491f7': { cuello_firmeza: 55, cuello_barrera: 40 },  // Neck and Chest Firming Cream
  '6d30d838-50c9-461c-a93a-7e32eba414f0': { proteccion: null }, /* proteccion via spfScoreOf */  // Nivea Sun Silky UV Stick SPF50
  // EXTENDIDO A CUELLO (cara + cuello + escote). Ejes de cuello a ~0.85 del
  // valor facial: misma cantidad de producto sobre ~3x de superficie.
  '70f8c5ee-c241-41d4-bfe4-2cf4d52a7577': { textura: 95, firmeza: 85, aclarado: 70, cuello_textura: 80, cuello_firmeza: 70, cuello_aclarado: 60 },  // Retin-A Tretinoína 0.025%
  '7454f16a-51b3-44c9-b392-4d97b50038b8': { cuerpo_barrera: 35 },  // Aceite de Ducha PH5
  '786a92d8-a357-4053-9b4b-d5c96ae9e821': { pies: 95 },  // Crema Urea 80%
  '7a10d78f-3fd3-4308-9df5-25f16a062d52': { cuerpo_firmeza: 60, cuerpo_textura: 50, cuerpo_barrera: 30 },  // Retinol Crema Corporal Reafirmante
  '7daf598c-e5aa-402f-a26a-6662aa196be9': { proteccion: null }, /* proteccion via spfScoreOf */  // Hyalu-Cica Water-Fit Sun Serum
  '83f81d90-df90-4b65-897c-029c479acb62': { firmeza: 65, barrera: 45, aclarado: 25 },  // Numbuzin Toner No.9 NAD+ PDRN
  '83fb4617-acd4-404c-80e5-f4dae81accb6': { textura: 35, barrera: 20 },  // SA Cleanser
  '844e871d-3993-47ac-9fbc-d4fe3e7d6a82': { proteccion: null }, /* proteccion via spfScoreOf */  // Probio-Cica Glow Sun Ampoule
  '86cd48aa-fab8-43bf-8275-534d625268e8': { cuerpo_textura: 65, textura: 25 },  // Glycolic Acid 7%
  '86d57790-31c4-4db8-888f-ffdd6a2465c5': { barrera: 15 },  // Caffeine Eye Cream Stick
  '8a2eb58a-2c7e-47c7-8fe8-532d541e7803': { barrera: 60 },  // Hydro Boost Gel Cream
  '8d0912a7-441d-4e03-a344-e16076334dbe': { textura: 85 },  // Skin Perfecting 2% BHA
  '999186d7-a30e-42c4-914f-b0b76f619b58': { aclarado: 65, textura: 55, firmeza: 35 },  // GlycoIsdin Serum
  '9c30b24f-9e2b-422c-8518-0536579cf894': { aclarado: 55, barrera: 40, textura: 35 },  // The Ordinary Saccharomyces Ferment 30% Milky Toner
  'a5953eaf-73e5-4ba9-80fa-9979641b62b8': { firmeza: 45, aclarado: 45, textura: 40, barrera: 25 },  // Revitalift Laser Day Cream
  'a6451499-e856-4494-b68b-acdbbc038824': { textura: 55 },  // Poremizing Clay Stick Mask
  'aea54bb5-6e67-4345-8801-d64239f3081f': { barrera: 60, aclarado: 45, firmeza: 40 },  // Medicube PDRN Pink Niacinamide Toner
  'b06008de-44b8-4d11-b6a8-0de0dc543bed': { aclarado: 85, firmeza: 60, textura: 20 },  // Suero Vitamina C 20%
  'b3a581cd-c0fd-43e0-8c73-cf043bc7e5a4': { firmeza: 55, barrera: 55 },  // Kopher Curepair Derma Ampoule Mist
  'b464ed06-74c8-413b-8513-289eb6a53931': { pies: 60 },  // Gel Ácido Salicílico 2%
  'b4b6743b-2aa6-468f-9662-b6d9d1cc1736': { cuerpo_proteccion: null }, /* proteccion via spfScoreOf */  // Isdin Fotoprotector Wet Skin SPF50+
  // EXTENDIDO A CUELLO, factor ~0.85.
  'b6026bce-10f2-49d3-aa77-12f94beee1c2': { barrera: 50, aclarado: 45, textura: 40, cuello_barrera: 45, cuello_aclarado: 40, cuello_textura: 35 },  // Milky Toner Saccharomyces Ferment 30%
  'b71bc26f-a501-49eb-8461-c7485192ee48': { barrera: 35, firmeza: 20, aclarado: 20 },  // Ultramo Bruma Hidratante Niacinamida
  'b73336bc-ad0e-444b-b807-7956498daa5e': { barrera: 15 },  // Caudalie Beauty Elixir Bruma Facial
  'bc090811-c158-4bd2-b97a-6f83f0de7a24': { cuerpo_firmeza: 60, cuerpo_textura: 50, cuerpo_barrera: 30 },  // Crema Corporal Retinol Reafirmante
  // Ollie Lip Hydrating Balm SPF50 — REINCORPORADO 2026-07-25 al nuevo eje `labios`.
  // Antes estaba comentado ("fuera de los ejes faciales"), lo que lo dejaba
  // invisible para el motor Y disparaba el aviso de deriva de Stock a perpetuidad.
  // 60 = hidratación oclusiva + SPF50 sobre el tejido con menos defensa UV del
  // cuerpo. Deliberadamente NO va a `proteccion` ni usa spfScoreOf (ver nota del
  // eje `labios` arriba): un bálsamo no protege la cara.
  'be7a694e-0211-4d3f-b9ed-0c2d83f05943': { labios: 60 },  // Ollie Lip Hydrating Balm SPF50
  'c3e2d898-e5d3-4e00-879a-827e84a44854': { pies: 65 },  // Crema Urea 40%
  'c495313f-4f9c-49a6-a672-13483a04f0f2': { proteccion: null, aclarado: 75 }, /* proteccion via spfScoreOf */  // Eucerin Pigment Control Tintado SPF50
  'c6fac7f0-2900-4eb9-910d-440b65e5a53d': { pies: 80 },  // Crema Urea 60% SA 2%
  'c74e3fdb-3665-438e-9cbb-574459d0e87f': { textura: 65, aclarado: 55, barrera: 50 },  // Niacinamide 10% + Zinc 1% Serum
  'c998b392-f91e-4ea5-a2b4-9acb871bcc20': { proteccion: null }, /* proteccion via spfScoreOf */  // Isdin Fusion Water SPF50
  'ccea1f6a-4935-44ef-a70a-e332bc9b2b9c': { barrera: 70, cuerpo_barrera: 60 },  // Crema Hidratante Diaria
  'd5332696-838e-4d79-9f4e-cde584f0aa91': { barrera: 65 },  // Barrier Support Serum
  'd62e61a3-0715-44c3-95bb-a402ca0f73cc': { proteccion: null, aclarado: 25 }, /* proteccion via spfScoreOf */  // Anthelios UV AIR Serum SPF 50+ (Tono Medio Natural)
  'd6f17e28-ccb7-4267-a588-5812bdfa2fde': { barrera: 85, aclarado: 20 },  // Toleriane Double Repair
  'd8085cbe-cae2-4f49-92b5-9f118c9fbdfb': { textura: 55, cuerpo_textura: 40 },  // Salicylic Acid 2% Gel
  'dcff4486-a13e-4bef-a4d3-9fce38945ac2': { cuerpo_barrera: 55, cuerpo_firmeza: 45, cuerpo_textura: 35 },  // Crepe Corrector Body Lotion
  'e029ae8d-5443-4c99-bb5a-3c2718f12694': { cuerpo_firmeza: 55, cuerpo_textura: 45, cuerpo_barrera: 30 },  // Retinol Body Cream (Vit E, Té Verde, Aloe)
  'e26cc8e4-79da-4389-baac-852263e51007': { aclarado: 70 },  // Melascreen Serum
  // EXTENDIDO A CUELLO, factor ~0.85. Es el despigmentante más fuerte que llega
  // a la zona, así que carga casi todo el eje `cuello_aclarado`.
  'ecef5283-7bdd-460b-a9a8-ccb917942c4c': { aclarado: 90, textura: 55, barrera: 10, cuello_aclarado: 75, cuello_textura: 45 },  // Finacea Ácido Azelaico 15%
  'f4f4f34a-d243-41f3-9bb1-dc1ca966d035': { proteccion: null }, /* proteccion via spfScoreOf */  // Canmake Mermaid Skin Gel SPF50
  'f5419858-d505-4621-9379-bdedad67dd50': { pies: 85 },  // Barra Urea 60% (Aguacate + Jojoba)
  'f95c263b-102e-46c9-bc24-485bf192cdc9': { barrera: 40, firmeza: 35, aclarado: 30 },  // Tocobo Collagen Eye Gel Cream
  // EXTENDIDO A CUELLO, factor ~0.85.
  'fd5ac61c-3146-49ed-813f-d3b0c4e097aa': { firmeza: 55, barrera: 45, cuello_firmeza: 45, cuello_barrera: 40 },  // Peptide + HA Serum
  'feac892a-7a0c-4647-9035-c5278c23cd19': { barrera: 70, firmeza: 30 },  // Laneige Cream Skin Toner & Moisturizer

  // ── Alta 2026-07-23 (ver alta-productos-manos-cuello.sql) ────────────────
  // Los 5 ids de aquí abajo son los mismos que puse en el SQL de alta — si
  // cambias el id al correr el INSERT, actualiza también aquí.
  '106e6207-662c-451d-ac3c-5c8c1db73883': { manos: 60 },  // Sadoer Kojic Acid Hand Cream — leave-on, kojic acid+niacinamide+HA, tier OTC fuerte
  '6cfe7393-865c-4af0-b1bf-5d90e7cd52de': { manos: 15 },  // Hasselan Turmeric Lemon Kojic Acid Soap — rinse-off, mismo criterio que limpiadores (contacto corto = pocos puntos aunque el activo sea bueno)
  // EXCLUSIVO DE CUELLO — movido 2026-07-25 de ejes de cara a ejes de cuello.
  // Algo más alto que la Neck & Chest Firming Cream porque el formato
  // parche/oclusivo mejora la entrega del activo.
  'f0797f0c-1ccc-42fa-b3c2-3ba82ecd419a': { cuello_firmeza: 60, cuello_barrera: 30 },  // Mercilen Golden Peptide Honeycomb Neck Mask
  'd2fa2faa-9408-41cf-8e86-3d3575ae2ac3': { textura: 40, barrera: 15 },  // Moisturizing Clay Mask (genérico) — mismo eje que "Poremizing Clay Stick Mask" pero potencia más baja: sin INCI verificable y formulación "hidratante" (menos arcilla activa que un clay stick clarificante).
  '17bcd631-39a5-4f79-81c1-c494208c2cb1': { barrera: 10 },  // Mercilen Plant Extract Cleansing Cream — limpiador, puntúa bajo por tiempo de contacto corto (mismo criterio que Limpiador Oleoso: textura=10). El escualano/aceites van a barrera en vez de textura porque no exfolia, solo limpia sin agredir el manto lipídico.

  // ── 14 SPF duplicados como "(Manos)" 2026-07-23 (ver alta-spf-manos-duplicados.sql) ──
  // Mismos ids que en ese SQL — si cambias el id al correr el INSERT, actualiza aquí también.
  '4db3009f-bbe9-44d7-b8af-68270c0bd167': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Isdin Fusion Water Color SPF50 (Manos)
  'efefbb3f-a268-4163-9eaa-2132697105e4': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Heliocare 360 Opti D Gel SPF50 (Manos)
  '00f87492-1e78-42f2-99b0-f8077f990ac4': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Isdin Fotoprotector Wet Skin SPF50+ (Manos)
  '1f467bd0-e75d-469d-9dfb-6f99294526ec': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Tocobo Sun Stick Cotton Soft SPF50 (Manos)
  '8d600de1-b696-4bcc-a38d-c471266c09a7': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Nivea Sun Silky UV Stick SPF50 (Manos)
  '41e73a9e-788b-40a8-b1d7-21449f0522ad': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Isdin Fusion Water SPF50 (Manos)
  'ee0d72b3-f639-4bfe-8eae-b8620d71ab09': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Eucerin Pigment Control Tintado SPF50 (Manos)
  '296dd1c2-648d-43e2-9d5f-7e3d8db1e554': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Probio-Cica Glow Sun Ampoule (Manos)
  '54fcb159-b00c-4afb-a3d8-71bd45cd3a31': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Hyalu-Cica Water-Fit Sun Serum (Manos)
  'c4bb9f39-991b-48aa-85ee-79a4a47a7b10': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Black Rice Airyfit Sunscreen (Manos)
  'f3659011-6e5b-4ea1-8502-63b5e56f2a3a': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Canmake Mermaid Skin Gel SPF50 (Manos)
  'b2b73756-d9a1-4d40-ac66-93e15dff6db2': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Anthelios UVMune 400 SPF50 (Manos)
  '99924fdc-cb71-46e9-83ab-d44b576357e2': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // L'Oréal UV Defender SPF50 PA++++ (Manos)
  'c17786a0-2acb-4a2c-9c0e-5e37bd7a7204': { manos_proteccion: null },  /* proteccion via spfScoreOf */  // Anthelios UV AIR Serum SPF 50+ (Tono Medio Natural) (Manos)

  // ── Alta 2026-07-25 — compra Amazon (11 productos) ───────────────────────
  // Estas entradas venían redactadas en `activos-matriz-agregar.js` pero nunca
  // se integraron aquí, así que los 11 seguían invisibles para el motor de dosis
  // y el aviso de deriva de Stock los marcaba. Al integrarlos se borró ese
  // archivo suelto: tener la matriz partida en dos era justo lo que causó el
  // olvido. Criterios de puntuación: FASE-B §3.

  // Esencia barrera de arroz negro fermentado. Ceramida NP + colesterol + ácidos
  // grasos: el trío completo con que la piel rehace su barrera, no solo
  // humectantes. Tres fermentos (Galactomyces, Bifida, Aspergillus) suman
  // hidratación y algo de luminosidad. Se calibra contra Hyalu-Cica Moisture
  // Cream (barrera 80): esta es esencia, capa más ligera, por eso 70.
  '900a4aab-bed0-402c-bcb9-a01806886918': { barrera: 70, aclarado: 15 },  // Black Rice Probiotics Barrier Essence — haruharu Wonder

  // Bruma crema calmante. Agua de salvado de arroz de primer ingrediente,
  // madecasósido y centella. Calma e hidrata, pero es bruma: poca sustantividad
  // y se aplica sobre otras capas. Por debajo del NAD+ Serum Mist (barrera 60),
  // que trae más activos.
  '4a9ab636-db1f-424f-bcfc-7abc237c673c': { barrera: 45 },  // 345 Relief Cream Mist — Dr.Althea

  // Gel crema para poros. Centella 50.96% + niacinamida + adenosina. La
  // niacinamida no declara concentración; por posición en la lista ronda 2–5%,
  // así que `aclarado` va moderado y no al nivel de un despigmentante dedicado.
  // `firmeza 15` es por la adenosina, de los pocos activos coreanos con
  // evidencia real en líneas finas. Poros entra por `textura` con aporte
  // secundario de firmeza — criterio de FASE-B §2.
  'dbe863ae-eb6d-42ad-9565-26cc6ed6e86f': { barrera: 55, textura: 45, aclarado: 25, firmeza: 15 },  // Poremizing Light Gel Cream — SKIN1004

  // Crema de cuello. ⚠️ PUNTAJE CONSERVADOR POR FALTA DE DATOS, no por mala
  // calidad. Marca genérica de Amazon sin lista INCI verificable: solo claims de
  // marketing (hialurónico hidrolizado, péptidos, vitamina E, jojoba) sin
  // concentraciones ni ficha independiente. Se puntúa lo único sostenible
  // —hidratación— y un mínimo de firmeza por los péptidos declarados. Si algún
  // día aparece la lista real de ingredientes, revisar.
  // ✅ INCONSISTENCIA RESUELTA 2026-07-25: estaba en ejes de CUERPO mientras los
  // otros dos productos de cuello estaban en ejes de CARA. Los tres viven ahora
  // en la zona `cuello`, que es de donde nunca debieron salir.
  'd944830f-82e8-434e-8409-dd7a89997fd9': { cuello_barrera: 40, cuello_firmeza: 20 },  // Crema Reafirmante Cuello — WEUD

  // Espuma limpiadora con BHA/PHA. Trae salicílico y gluconolactona de verdad,
  // pero es un LIMPIADOR: 30–60 segundos de contacto y al drenaje. Por eso 20 y
  // no 60, aunque el mismo ácido sin enjuague puntuaría muchísimo más alto.
  // NO ENTRA EN `IRRITANTES`, y es deliberado: esa lista existe para avisar de
  // sobre-exposición a retinoides y ácidos SIN ENJUAGUE. Un salicílico de
  // contacto corto no acumula irritación igual, y meterlo dispararía avisos
  // falsos todos los días — el mismo error que FASE-B §6 corrigió con la
  // niacinamida.
  '9b91d98e-c293-4e27-8cf1-b5faae440bad': { textura: 20 },  // BALANCEFUL Pore Cleansing Foam — Torriden

  // Sérum labial con PDRN. Iba a quedar con entrada VACÍA por el criterio viejo
  // de "los labios no son piel facial". Ese criterio sigue siendo cierto y por
  // eso NO toca los ejes de cara — pero ahora tiene el eje `labios` (ver nota
  // arriba). 70 = PDRN en leave-on sobre un tejido de barrera muy fina, donde
  // la penetración es mayor que en la cara; por encima del bálsamo (60) porque
  // es un activo regenerador dedicado, no solo oclusión.
  '34b622c4-e4bf-4289-b8a6-923632995796': { labios: 70 },  // PDRN Lip Serum — Anua

  // ── Kit de viaje SKIN1004 (5 minis) ──────────────────────────────────────
  // Mismos criterios que sus versiones de tamaño completo: que sean minis no
  // cambia la potencia por aplicación, solo cuánto duran.
  '837c26e3-6b7c-438a-9664-e63d01d4a9e7': { textura: 10 },  // Centella Light Cleansing Oil (viaje) — igual que el Limpiador Oleoso
  'd93e2cfd-b65c-4be1-86af-36fd64108486': { textura: 10 },  // Centella Ampoule Foam (viaje) — limpiador, contacto corto
  'acbcd16d-c0b0-4fc8-8130-7b61e076f801': { barrera: 35 },  // Centella Toning Toner (viaje)
  '914a738d-a1f7-4657-9f84-53be8ad64b66': { barrera: 55 },  // Centella Ampoule (viaje) — centella en alta concentración, sin enjuague
  'bc6ce9fd-5335-456e-a111-367c21603699': { barrera: 60 },  // Centella Soothing Cream (viaje) — crema oclusiva
};

// ── ACTIVOS IRRITANTES (retinoides y ácidos exfoliantes) ────────────────────
// Solo estos cuentan para el aviso de sobre-exposición. La niacinamida, el
// azelaico o el NAG aportan a `textura` pero NO irritan, así que incluirlos
// disparaba avisos falsos.
const IRRITANTES = new Set([
  '70f8c5ee-c241-41d4-bfe4-2cf4d52a7577',  // Retin-A Tretinoína 0.025%
  '05f7037d-f73b-4ff8-9081-c64afb2c5cf2',  // Retinol Overnight Lotion
  '110a2828-a348-41f3-93b6-bc2b7612d731',  // Toner AHA BHA PHA + Niacinamide 2%
  '86cd48aa-fab8-43bf-8275-534d625268e8',  // Glycolic Acid 7%
  '8d0912a7-441d-4e03-a344-e16076334dbe',  // Skin Perfecting 2% BHA
  '5f197c24-5c60-4d16-8bb6-b0c80bd621f8',  // Salicylic Acid 2% Masque
  'd8085cbe-cae2-4f49-92b5-9f118c9fbdfb',  // Salicylic Acid 2% Gel
  '50e32222-59b0-4b20-ad26-23b552f91239',  // Salicylic Acid 2% Spray
  '999186d7-a30e-42c4-914f-b0b76f619b58',  // GlycoIsdin Serum
  '3ba97655-b68a-4084-8bec-fd0c4aac09de',  // Glycolic Bright Gel Cleanser
  '7a10d78f-3fd3-4308-9df5-25f16a062d52',  // Retinol Crema Corporal Reafirmante
  'bc090811-c158-4bd2-b97a-6f83f0de7a24',  // Crema Corporal Retinol Reafirmante
  'e029ae8d-5443-4c99-bb5a-3c2718f12694',  // Retinol Body Cream (Vit E, Té Verde, Aloe)
]);
