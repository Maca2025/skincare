// ══════════════════════════════════════════════════════════════════════════
// MATRIZ DE ACTIVOS  ·  MODELO FUNCIÓN × ZONA   (refactor 2026-07-25)
//
// QUÉ CAMBIÓ Y POR QUÉ
// Antes un producto declaraba ejes YA MEZCLADOS con la zona (`firmeza` para
// cara, `cuello_firmeza`, `cuerpo_firmeza`...). Eso obligaba a decidir de
// antemano, y a mano, a qué zonas llegaba cada producto — con el resultado de
// que 7 productos tenían valores de cuello inventados a partir del texto de su
// nota, y un factor de dilución 0.85 igual de inventado.
//
// Ahora se separan las dos preguntas, que nunca fueron la misma:
//   · PRODUCT_DOSE  → QUÉ HACE el producto (potencia por FUNCIÓN, sin zona).
//   · La zona la aporta el REGISTRO de la aplicación (dato real, no supuesto).
//   · PRODUCT_ZONAS → zonas por defecto: preselección en el picker y cálculo
//                     del histórico anterior a que se registraran zonas.
//   · ZONAS_APTAS   → dónde PUEDE ir el producto (aptitud), que es una
//                     pregunta distinta de dónde le entregaste estímulo.
//
// El eje de Progreso se COMPONE: eje = función × zona. Así, aplicar la
// tretinoína marcando cara+cuello alimenta `textura` y `cuello_textura` con la
// MISMA potencia, sin dilución (se retiró a petición de la usuaria: solo se
// justificaba en productos de dosis medida, y para una crema simplemente te
// sirves más).
//
// POTENCIA 0-100 por función. Rúbrica:
//   90-100  estándar de oro / grado prescripción a concentración eficaz
//   75-89   activo OTC fuerte con evidencia clínica a concentración eficaz
//   55-74   activo de soporte sólido
//   35-54   contribución moderada
//   15-34   adyuvante marginal
//        0  no toca esa función
//
// `null` = protección: se toma spfScoreOf(p), una sola fuente de verdad para la
// calibración UVA.
// ══════════════════════════════════════════════════════════════════════════

const FUNCIONES = {
  proteccion: { icon: '🛡️', label: 'Protección solar', color: '#C4818A' },
  aclarado: { icon: '🎯', label: 'Aclarado / pigmentación', color: '#C47A00' },
  textura: { icon: '🔬', label: 'Renovación, textura y poros', color: '#7E6BB0' },
  barrera: { icon: '💧', label: 'Barrera e hidratación', color: '#3A8A7A' },
  firmeza: { icon: '🧬', label: 'Firmeza / colágeno', color: '#B0567E' },
  queratolitico: { icon: '🦶', label: 'Queratolítico', color: '#8A6A00' },
  capilar: { icon: '💇', label: 'Cuidado capilar', color: '#5B8FA8' },
  labial: { icon: '💋', label: 'Cuidado labial', color: '#A8455E' },
};

// Zonas del cuerpo. `orden` fija cómo se listan en el picker y en Progreso.
// `soloFuncion` marca las zonas que admiten UNA sola función: no tiene sentido
// un eje de "firmeza de pies" ni de "aclarado de cabello".
const ZONAS = {
  cara: { icon: '😊', label: 'Cara', orden: 1 },
  cuello: { icon: '🦢', label: 'Cuello y escote', orden: 2 },
  cuerpo: { icon: '🧴', label: 'Cuerpo', orden: 3 },
  manos: { icon: '✋', label: 'Manos y brazos', orden: 4 },
  pies: { icon: '🦶', label: 'Pies', orden: 5, soloFuncion: 'queratolitico' },
  labios: { icon: '💋', label: 'Labios', orden: 6, soloFuncion: 'labial' },
  cabello: { icon: '💇', label: 'Cabello', orden: 7, soloFuncion: 'capilar' },
};

// ── EJES = FUNCIÓN × ZONA ───────────────────────────────────────────────────
// Las CLAVES se conservan idénticas a las de antes del refactor (`firmeza`,
// `cuello_firmeza`, `manos`, `pies`...) para no invalidar la calibración ni los
// techos recalibrados con datos reales el 2026-07-23. `ejeKey(zona, funcion)`
// en app.js reproduce exactamente este naming: cara va sin prefijo, las zonas
// monofunción usan su propio nombre.
//
// techoDiario  = dosis máxima útil en un día (rendimientos decrecientes).
// diasIdeales  = días/semana para llegar al 100%. Pasarse NO penaliza el
//                puntaje (se topa), pero dispara el aviso de sobre-exposición.
const DOSE_AXES = {
  proteccion: { zona: 'cara', funcion: 'proteccion', icon: '🛡️', label: 'Protección solar', color: '#C4818A', techoDiario: 500, diasIdeales: 7 },
  aclarado: { zona: 'cara', funcion: 'aclarado', icon: '🎯', label: 'Aclarado / pigmentación', color: '#C47A00', techoDiario: 370, diasIdeales: 7 },
  textura: { zona: 'cara', funcion: 'textura', icon: '🔬', label: 'Renovación, textura y poros', color: '#7E6BB0', techoDiario: 265, diasIdeales: 4 },
  barrera: { zona: 'cara', funcion: 'barrera', icon: '💧', label: 'Barrera e hidratación', color: '#3A8A7A', techoDiario: 460, diasIdeales: 7 },
  firmeza: { zona: 'cara', funcion: 'firmeza', icon: '🧬', label: 'Firmeza / colágeno', color: '#B0567E', techoDiario: 200, diasIdeales: 6 },
  cuello_proteccion: { zona: 'cuello', funcion: 'proteccion', icon: '🛡️', label: 'Protección solar', color: '#C4818A', techoDiario: 500, diasIdeales: 7 },
  cuello_aclarado: { zona: 'cuello', funcion: 'aclarado', icon: '🎯', label: 'Aclarado / pigmentación', color: '#C47A00', techoDiario: 135, diasIdeales: 7 },
  cuello_textura: { zona: 'cuello', funcion: 'textura', icon: '🔬', label: 'Renovación, textura y poros', color: '#7E6BB0', techoDiario: 110, diasIdeales: 4 },
  cuello_barrera: { zona: 'cuello', funcion: 'barrera', icon: '💧', label: 'Barrera e hidratación', color: '#3A8A7A', techoDiario: 150, diasIdeales: 7 },
  cuello_firmeza: { zona: 'cuello', funcion: 'firmeza', icon: '🧬', label: 'Firmeza / colágeno', color: '#B0567E', techoDiario: 170, diasIdeales: 6 },
  cuerpo_proteccion: { zona: 'cuerpo', funcion: 'proteccion', icon: '🛡️', label: 'Protección solar', color: '#C4818A', techoDiario: 500, diasIdeales: 7 },
  cuerpo_aclarado: { zona: 'cuerpo', funcion: 'aclarado', icon: '🎯', label: 'Aclarado / pigmentación', color: '#C47A00', techoDiario: 90, diasIdeales: 7 },  // PROVISIONAL — sin datos reales todavía
  cuerpo_textura: { zona: 'cuerpo', funcion: 'textura', icon: '🔬', label: 'Renovación, textura y poros', color: '#7E6BB0', techoDiario: 80, diasIdeales: 3 },
  cuerpo_barrera: { zona: 'cuerpo', funcion: 'barrera', icon: '💧', label: 'Barrera e hidratación', color: '#3A8A7A', techoDiario: 95, diasIdeales: 7 },
  cuerpo_firmeza: { zona: 'cuerpo', funcion: 'firmeza', icon: '🧬', label: 'Firmeza / colágeno', color: '#B0567E', techoDiario: 75, diasIdeales: 5 },
  manos_proteccion: { zona: 'manos', funcion: 'proteccion', icon: '🛡️', label: 'Protección solar', color: '#C4818A', techoDiario: 500, diasIdeales: 7 },
  manos: { zona: 'manos', funcion: 'aclarado', icon: '🎯', label: 'Aclarado / pigmentación', color: '#C47A00', techoDiario: 90, diasIdeales: 7 },
  manos_textura: { zona: 'manos', funcion: 'textura', icon: '🔬', label: 'Renovación, textura y poros', color: '#7E6BB0', techoDiario: 80, diasIdeales: 3 },  // PROVISIONAL — sin datos reales todavía
  manos_barrera: { zona: 'manos', funcion: 'barrera', icon: '💧', label: 'Barrera e hidratación', color: '#3A8A7A', techoDiario: 90, diasIdeales: 7 },  // PROVISIONAL — sin datos reales todavía
  manos_firmeza: { zona: 'manos', funcion: 'firmeza', icon: '🧬', label: 'Firmeza / colágeno', color: '#B0567E', techoDiario: 75, diasIdeales: 6 },  // PROVISIONAL — sin datos reales todavía
  pies: { zona: 'pies', funcion: 'queratolitico', icon: '🦶', label: 'Queratolítico', color: '#8A6A00', techoDiario: 85, diasIdeales: 7 },
  labios: { zona: 'labios', funcion: 'labial', icon: '💋', label: 'Cuidado labial', color: '#A8455E', techoDiario: 110, diasIdeales: 7 },
  cabello: { zona: 'cabello', funcion: 'capilar', icon: '💇', label: 'Cuidado capilar', color: '#5B8FA8', techoDiario: 70, diasIdeales: 3 },
};

// ── POTENCIA POR FUNCIÓN (sin zona) ─────────────────────────────────────────
// Un solo juego de números por producto. La zona la decide el registro.
const PRODUCT_DOSE = {
  '4a9ab636-db1f-424f-bcfc-7abc237c673c': { barrera: 45 },  // 345 Relief Cream Mist
  '7454f16a-51b3-44c9-b392-4d97b50038b8': { barrera: 35 },  // Aceite de Ducha PH5
  '6447629f-d5f2-4a83-b011-006b25cf18e3': { queratolitico: 90 },  // Aceite Urea 60%
  'd62e61a3-0715-44c3-95bb-a402ca0f73cc': { proteccion: null, aclarado: 25 },  // Anthelios UV AIR Serum SPF 50+ (Tono Medio Natural)
  '57ff2048-f0d3-42a6-a9e5-8e56fb8a564e': { proteccion: null },  // Anthelios UVMune 400 SPF50
  '1b656610-fce5-45a6-b6e8-8ec33e209653': { aclarado: 70, barrera: 25 },  // Anti-Pigment Contorno de Ojos
  '9b91d98e-c293-4e27-8cf1-b5faae440bad': { textura: 20 },  // BALANCEFUL Pore Cleansing Foam
  'f5419858-d505-4621-9379-bdedad67dd50': { queratolitico: 85 },  // Barra Urea 60% (Aguacate + Jojoba)
  'd5332696-838e-4d79-9f4e-cde584f0aa91': { barrera: 65 },  // Barrier Support Serum
  '27826422-4e8b-47a3-a6a0-27f436ce2b26': { proteccion: null },  // Black Rice Airyfit Sunscreen
  '900a4aab-bed0-402c-bcb9-a01806886918': { barrera: 70, aclarado: 15 },  // Black Rice Probiotics Barrier Essence
  '20064300-8139-45ef-b803-4e4bf61d94bc': { barrera: 60, firmeza: 30 },  // Black Rice Probiotics NAD+ Serum Mist
  '86d57790-31c4-4db8-888f-ffdd6a2465c5': { barrera: 15 },  // Caffeine Eye Cream Stick
  'f4f4f34a-d243-41f3-9bb1-dc1ca966d035': { proteccion: null },  // Canmake Mermaid Skin Gel SPF50
  'b73336bc-ad0e-444b-b807-7956498daa5e': { barrera: 15 },  // Caudalie Beauty Elixir Bruma Facial
  '914a738d-a1f7-4657-9f84-53be8ad64b66': { barrera: 55 },  // Centella Ampoule (viaje)
  'd93e2cfd-b65c-4be1-86af-36fd64108486': { textura: 10 },  // Centella Ampoule Foam (viaje)
  '837c26e3-6b7c-438a-9664-e63d01d4a9e7': { textura: 10 },  // Centella Light Cleansing Oil (viaje)
  'bc6ce9fd-5335-456e-a111-367c21603699': { barrera: 60 },  // Centella Soothing Cream (viaje)
  'acbcd16d-c0b0-4fc8-8130-7b61e076f801': { barrera: 35 },  // Centella Toning Toner (viaje)
  '3b90cc0e-7170-4f62-9e99-c582510d6361': { barrera: 55 },  // Ceramide Eye Cream Stick
  '22b2bb98-8431-4d40-8ffe-08f02f3db40b': { barrera: 65, aclarado: 15 },  // Cerave Eye Repair Cream
  '44b6586f-754c-49a0-b6f6-867d77bd2e44': { queratolitico: 45 },  // Crema con Lanolina
  'bc090811-c158-4bd2-b97a-6f83f0de7a24': { firmeza: 60, textura: 50, barrera: 30 },  // Crema Corporal Retinol Reafirmante
  'ccea1f6a-4935-44ef-a70a-e332bc9b2b9c': { barrera: 70 },  // Crema Hidratante Diaria
  'd944830f-82e8-434e-8409-dd7a89997fd9': { barrera: 40, firmeza: 20 },  // Crema Reafirmante Cuello
  'c3e2d898-e5d3-4e00-879a-827e84a44854': { queratolitico: 65 },  // Crema Urea 40%
  'c6fac7f0-2900-4eb9-910d-440b65e5a53d': { queratolitico: 80 },  // Crema Urea 60% SA 2%
  '3d201bba-ff43-413e-b96b-3c443bec8057': { queratolitico: 85 },  // Crema Urea 70% SA 2%
  '786a92d8-a357-4053-9b4b-d5c96ae9e821': { queratolitico: 95 },  // Crema Urea 80%
  'dcff4486-a13e-4bef-a4d3-9fce38945ac2': { barrera: 55, firmeza: 45, textura: 35 },  // Crepe Corrector Body Lotion
  '2b41c15a-bbab-4a44-b583-476d0f11f3f9': { barrera: 75 },  // Dove Ceramidas Body Lotion
  'c495313f-4f9c-49a6-a672-13483a04f0f2': { proteccion: null, aclarado: 75 },  // Eucerin Pigment Control Tintado SPF50
  'ecef5283-7bdd-460b-a9a8-ccb917942c4c': { aclarado: 90, textura: 55, barrera: 10 },  // Finacea Ácido Azelaico 15%
  'b464ed06-74c8-413b-8513-289eb6a53931': { queratolitico: 60 },  // Gel Ácido Salicílico 2%
  '999186d7-a30e-42c4-914f-b0b76f619b58': { aclarado: 65, textura: 55, firmeza: 35 },  // GlycoIsdin Serum
  '86cd48aa-fab8-43bf-8275-534d625268e8': { textura: 65 },  // Glycolic Acid 7%
  '3ba97655-b68a-4084-8bec-fd0c4aac09de': { textura: 25, aclarado: 15 },  // Glycolic Bright Gel Cleanser
  '6cfe7393-865c-4af0-b1bf-5d90e7cd52de': { aclarado: 15 },  // Hasselan Turmeric Lemon Kojic Acid Soap
  '5e0fd428-5d22-41ed-91d9-bcd57fddad20': { proteccion: null },  // Heliocare 360 Opti D Gel SPF50
  '17913609-6130-48bd-977e-45ee06379ff6': { barrera: 80, aclarado: 20, firmeza: 15 },  // Hyalu-Cica Moisture Cream
  '7daf598c-e5aa-402f-a26a-6662aa196be9': { proteccion: null },  // Hyalu-Cica Water-Fit Sun Serum
  '8a2eb58a-2c7e-47c7-8fe8-532d541e7803': { barrera: 60 },  // Hydro Boost Gel Cream
  'b4b6743b-2aa6-468f-9662-b6d9d1cc1736': { proteccion: null },  // Isdin Fotoprotector Wet Skin SPF50+
  '3c1c8b13-bf04-4cf2-a154-5f0d0e2be2ec': { proteccion: null },  // Isdin Fusion Water Color SPF50
  'c998b392-f91e-4ea5-a2b4-9acb871bcc20': { proteccion: null },  // Isdin Fusion Water SPF50
  'b3a581cd-c0fd-43e0-8c73-cf043bc7e5a4': { firmeza: 55, barrera: 55 },  // Kopher Curepair Derma Ampoule Mist
  '4c775124-b388-45d0-941f-77cf67c48148': { proteccion: null },  // L'Oréal UV Defender SPF50 PA++++
  '3cef35a0-bc27-440f-9d97-a19709ee2bb9': { capilar: 70 },  // Lambdapil Shampoo Anticaída
  'feac892a-7a0c-4647-9035-c5278c23cd19': { barrera: 70, firmeza: 30 },  // Laneige Cream Skin Toner & Moisturizer
  '23236746-4738-468c-b043-250f0db91ddb': { barrera: 25 },  // Limpiador Hidratante
  '0193747b-4c2f-4f7d-ac97-7565c98b94b6': { textura: 10 },  // Limpiador Oleoso
  'aea54bb5-6e67-4345-8801-d64239f3081f': { barrera: 60, aclarado: 45, firmeza: 40 },  // Medicube PDRN Pink Niacinamide Toner
  'e26cc8e4-79da-4389-baac-852263e51007': { aclarado: 70 },  // Melascreen Serum
  'f0797f0c-1ccc-42fa-b3c2-3ba82ecd419a': { firmeza: 60, barrera: 30 },  // Mercilen Golden Peptide Honeycomb Neck Mask
  '17bcd631-39a5-4f79-81c1-c494208c2cb1': { barrera: 10 },  // Mercilen Plant Extract Cleansing Cream
  'b6026bce-10f2-49d3-aa77-12f94beee1c2': { barrera: 50, aclarado: 45, textura: 40 },  // Milky Toner Saccharomyces Ferment 30%
  'd2fa2faa-9408-41cf-8e86-3d3575ae2ac3': { textura: 40, barrera: 15 },  // Moisturizing Clay Mask (genérico)
  '1e59f9b3-18b8-4a98-91a0-376a0f8f72f8': { firmeza: 80, textura: 30, barrera: 15 },  // Multi-Peptide + Copper Peptides 1% Serum
  '6b2ab52e-8479-4016-a8eb-2a61864491f7': { firmeza: 55, barrera: 40 },  // Neck and Chest Firming Cream
  'c74e3fdb-3665-438e-9cbb-574459d0e87f': { textura: 65, aclarado: 55, barrera: 50 },  // Niacinamide 10% + Zinc 1% Serum
  '6d30d838-50c9-461c-a93a-7e32eba414f0': { proteccion: null },  // Nivea Sun Silky UV Stick SPF50
  '83f81d90-df90-4b65-897c-029c479acb62': { firmeza: 65, barrera: 45, aclarado: 25 },  // Numbuzin Toner No.9 NAD+ PDRN
  'be7a694e-0211-4d3f-b9ed-0c2d83f05943': { labial: 60 },  // Ollie Lip Hydrating Balm SPF50
  '34b622c4-e4bf-4289-b8a6-923632995796': { labial: 70 },  // PDRN Lip Serum
  'fd5ac61c-3146-49ed-813f-d3b0c4e097aa': { firmeza: 55, barrera: 45 },  // Peptide + HA Serum
  'a6451499-e856-4494-b68b-acdbbc038824': { textura: 55 },  // Poremizing Clay Stick Mask
  'dbe863ae-eb6d-42ad-9565-26cc6ed6e86f': { barrera: 55, textura: 45, aclarado: 25, firmeza: 15 },  // Poremizing Light Gel Cream
  '844e871d-3993-47ac-9fbc-d4fe3e7d6a82': { proteccion: null },  // Probio-Cica Glow Sun Ampoule
  '70f8c5ee-c241-41d4-bfe4-2cf4d52a7577': { textura: 95, firmeza: 85, aclarado: 70 },  // Retin-A Tretinoína 0.025%
  'e029ae8d-5443-4c99-bb5a-3c2718f12694': { firmeza: 55, textura: 45, barrera: 30 },  // Retinol Body Cream (Vit E, Té Verde, Aloe)
  '7a10d78f-3fd3-4308-9df5-25f16a062d52': { firmeza: 60, textura: 50, barrera: 30 },  // Retinol Crema Corporal Reafirmante
  '05f7037d-f73b-4ff8-9081-c64afb2c5cf2': { textura: 40, firmeza: 45 },  // Retinol Overnight Lotion
  'a5953eaf-73e5-4ba9-80fa-9979641b62b8': { firmeza: 45, aclarado: 45, textura: 40, barrera: 25 },  // Revitalift Laser Day Cream
  '83fb4617-acd4-404c-80e5-f4dae81accb6': { textura: 35, barrera: 20 },  // SA Cleanser
  '106e6207-662c-451d-ac3c-5c8c1db73883': { aclarado: 60 },  // Sadoer Kojic Acid Hand Cream
  'd8085cbe-cae2-4f49-92b5-9f118c9fbdfb': { textura: 55 },  // Salicylic Acid 2% Gel
  '5f197c24-5c60-4d16-8bb6-b0c80bd621f8': { textura: 75 },  // Salicylic Acid 2% Masque
  '50e32222-59b0-4b20-ad26-23b552f91239': { textura: 70 },  // Salicylic Acid 2% Spray
  '8d0912a7-441d-4e03-a344-e16076334dbe': { textura: 85 },  // Skin Perfecting 2% BHA
  '21a728f9-3cfa-43eb-a3fe-8a57d417240f': { barrera: 85 },  // Sleeping Pack Ceramidas + Cica
  '0dfd4acf-5300-4822-aa77-f048fa588cd8': { barrera: 30, textura: 15 },  // Spray Ácido Hipocloroso
  'b06008de-44b8-4d11-b6a8-0de0dc543bed': { aclarado: 85, firmeza: 60, textura: 20 },  // Suero Vitamina C 20%
  '9c30b24f-9e2b-422c-8518-0536579cf894': { aclarado: 55, barrera: 40, textura: 35 },  // The Ordinary Saccharomyces Ferment 30% Milky Toner
  'f95c263b-102e-46c9-bc24-485bf192cdc9': { barrera: 40, firmeza: 35, aclarado: 30 },  // Tocobo Collagen Eye Gel Cream
  '2026eae7-7ae3-4596-b61f-8b3bb5cd2088': { proteccion: null },  // Tocobo Sun Stick Cotton Soft SPF50
  'd6f17e28-ccb7-4267-a588-5812bdfa2fde': { barrera: 85, aclarado: 20 },  // Toleriane Double Repair
  '18d9e716-ed74-41f9-b234-a4c0fcd229c1': { barrera: 80, aclarado: 20 },  // Toleriane Double Repair Face Moisturizer
  '110a2828-a348-41f3-93b6-bc2b7612d731': { textura: 70, aclarado: 30, barrera: 10 },  // Toner AHA BHA PHA + Niacinamide 2%
  'b71bc26f-a501-49eb-8461-c7485192ee48': { barrera: 35, firmeza: 20, aclarado: 20 },  // Ultramo Bruma Hidratante Niacinamida
};

// ── ZONAS POR DEFECTO ───────────────────────────────────────────────────────
// ⚠️ LOS SPF FACIALES INCLUYEN 'cuello' A PROPÓSITO. Antes del refactor eso no
// vivía aquí sino en app.js, como una regla que derivaba `cuello_proteccion` de
// toda aplicación con `proteccion` (el "espejo"): la usuaria extiende siempre el
// protector de la cara al cuello. Al pasar a función × zona esa regla se retiró,
// y sin subir 'cuello' a estas listas el histórico de protección de cuello se
// habría ido a CERO de golpe. Ahora es dato explícito en vez de regla oculta,
// que era el objetivo del refactor.
// Dos usos: (1) preseleccionar el multipicker de zona al registrar, y (2)
// calcular el HISTÓRICO — los registros anteriores al refactor no traen zona, y
// se les aplica esta lista para que sus porcentajes no se muevan ni un punto.
const PRODUCT_ZONAS = {
  '4a9ab636-db1f-424f-bcfc-7abc237c673c': ['cara'],  // 345 Relief Cream Mist
  '7454f16a-51b3-44c9-b392-4d97b50038b8': ['cuerpo'],  // Aceite de Ducha PH5
  '6447629f-d5f2-4a83-b011-006b25cf18e3': ['pies'],  // Aceite Urea 60%
  'd62e61a3-0715-44c3-95bb-a402ca0f73cc': ['cara', 'cuello', 'manos'],  // Anthelios UV AIR Serum SPF 50+ (Tono Medio Natural)
  '57ff2048-f0d3-42a6-a9e5-8e56fb8a564e': ['cara', 'cuello', 'manos'],  // Anthelios UVMune 400 SPF50
  '1b656610-fce5-45a6-b6e8-8ec33e209653': ['cara'],  // Anti-Pigment Contorno de Ojos
  '9b91d98e-c293-4e27-8cf1-b5faae440bad': ['cara'],  // BALANCEFUL Pore Cleansing Foam
  'f5419858-d505-4621-9379-bdedad67dd50': ['pies'],  // Barra Urea 60% (Aguacate + Jojoba)
  'd5332696-838e-4d79-9f4e-cde584f0aa91': ['cara'],  // Barrier Support Serum
  '27826422-4e8b-47a3-a6a0-27f436ce2b26': ['cara', 'cuello', 'manos'],  // Black Rice Airyfit Sunscreen
  '900a4aab-bed0-402c-bcb9-a01806886918': ['cara'],  // Black Rice Probiotics Barrier Essence
  '20064300-8139-45ef-b803-4e4bf61d94bc': ['cara'],  // Black Rice Probiotics NAD+ Serum Mist
  '86d57790-31c4-4db8-888f-ffdd6a2465c5': ['cara'],  // Caffeine Eye Cream Stick
  'f4f4f34a-d243-41f3-9bb1-dc1ca966d035': ['cara', 'cuello', 'manos'],  // Canmake Mermaid Skin Gel SPF50
  'b73336bc-ad0e-444b-b807-7956498daa5e': ['cara'],  // Caudalie Beauty Elixir Bruma Facial
  '914a738d-a1f7-4657-9f84-53be8ad64b66': ['cara'],  // Centella Ampoule (viaje)
  'd93e2cfd-b65c-4be1-86af-36fd64108486': ['cara'],  // Centella Ampoule Foam (viaje)
  '837c26e3-6b7c-438a-9664-e63d01d4a9e7': ['cara'],  // Centella Light Cleansing Oil (viaje)
  'bc6ce9fd-5335-456e-a111-367c21603699': ['cara'],  // Centella Soothing Cream (viaje)
  'acbcd16d-c0b0-4fc8-8130-7b61e076f801': ['cara'],  // Centella Toning Toner (viaje)
  '3b90cc0e-7170-4f62-9e99-c582510d6361': ['cara'],  // Ceramide Eye Cream Stick
  '22b2bb98-8431-4d40-8ffe-08f02f3db40b': ['cara'],  // Cerave Eye Repair Cream
  '44b6586f-754c-49a0-b6f6-867d77bd2e44': ['pies'],  // Crema con Lanolina
  'bc090811-c158-4bd2-b97a-6f83f0de7a24': ['cuerpo'],  // Crema Corporal Retinol Reafirmante
  'ccea1f6a-4935-44ef-a70a-e332bc9b2b9c': ['cara', 'cuerpo'],  // Crema Hidratante Diaria
  'd944830f-82e8-434e-8409-dd7a89997fd9': ['cuello'],  // Crema Reafirmante Cuello
  'c3e2d898-e5d3-4e00-879a-827e84a44854': ['pies'],  // Crema Urea 40%
  'c6fac7f0-2900-4eb9-910d-440b65e5a53d': ['pies'],  // Crema Urea 60% SA 2%
  '3d201bba-ff43-413e-b96b-3c443bec8057': ['pies'],  // Crema Urea 70% SA 2%
  '786a92d8-a357-4053-9b4b-d5c96ae9e821': ['pies'],  // Crema Urea 80%
  'dcff4486-a13e-4bef-a4d3-9fce38945ac2': ['cuerpo'],  // Crepe Corrector Body Lotion
  '2b41c15a-bbab-4a44-b583-476d0f11f3f9': ['cuerpo'],  // Dove Ceramidas Body Lotion
  'c495313f-4f9c-49a6-a672-13483a04f0f2': ['cara', 'cuello', 'manos'],  // Eucerin Pigment Control Tintado SPF50
  'ecef5283-7bdd-460b-a9a8-ccb917942c4c': ['cara', 'cuello'],  // Finacea Ácido Azelaico 15%
  'b464ed06-74c8-413b-8513-289eb6a53931': ['pies'],  // Gel Ácido Salicílico 2%
  '999186d7-a30e-42c4-914f-b0b76f619b58': ['cara'],  // GlycoIsdin Serum
  '86cd48aa-fab8-43bf-8275-534d625268e8': ['cara', 'cuerpo'],  // Glycolic Acid 7%
  '3ba97655-b68a-4084-8bec-fd0c4aac09de': ['cara', 'cuello'],  // Glycolic Bright Gel Cleanser
  '6cfe7393-865c-4af0-b1bf-5d90e7cd52de': ['manos'],  // Hasselan Turmeric Lemon Kojic Acid Soap
  '5e0fd428-5d22-41ed-91d9-bcd57fddad20': ['cuerpo', 'manos'],  // Heliocare 360 Opti D Gel SPF50
  '17913609-6130-48bd-977e-45ee06379ff6': ['cara'],  // Hyalu-Cica Moisture Cream
  '7daf598c-e5aa-402f-a26a-6662aa196be9': ['cara', 'cuello', 'manos'],  // Hyalu-Cica Water-Fit Sun Serum
  '8a2eb58a-2c7e-47c7-8fe8-532d541e7803': ['cara'],  // Hydro Boost Gel Cream
  'b4b6743b-2aa6-468f-9662-b6d9d1cc1736': ['cuerpo', 'manos'],  // Isdin Fotoprotector Wet Skin SPF50+
  '3c1c8b13-bf04-4cf2-a154-5f0d0e2be2ec': ['cara', 'cuello', 'manos'],  // Isdin Fusion Water Color SPF50
  'c998b392-f91e-4ea5-a2b4-9acb871bcc20': ['cara', 'cuello', 'manos'],  // Isdin Fusion Water SPF50
  'b3a581cd-c0fd-43e0-8c73-cf043bc7e5a4': ['cara'],  // Kopher Curepair Derma Ampoule Mist
  '4c775124-b388-45d0-941f-77cf67c48148': ['cara', 'cuello', 'manos'],  // L'Oréal UV Defender SPF50 PA++++
  '3cef35a0-bc27-440f-9d97-a19709ee2bb9': ['cabello'],  // Lambdapil Shampoo Anticaída
  'feac892a-7a0c-4647-9035-c5278c23cd19': ['cara'],  // Laneige Cream Skin Toner & Moisturizer
  '23236746-4738-468c-b043-250f0db91ddb': ['cara'],  // Limpiador Hidratante
  '0193747b-4c2f-4f7d-ac97-7565c98b94b6': ['cara'],  // Limpiador Oleoso
  'aea54bb5-6e67-4345-8801-d64239f3081f': ['cara'],  // Medicube PDRN Pink Niacinamide Toner
  'e26cc8e4-79da-4389-baac-852263e51007': ['cara'],  // Melascreen Serum
  'f0797f0c-1ccc-42fa-b3c2-3ba82ecd419a': ['cuello'],  // Mercilen Golden Peptide Honeycomb Neck Mask
  '17bcd631-39a5-4f79-81c1-c494208c2cb1': ['cara'],  // Mercilen Plant Extract Cleansing Cream
  'b6026bce-10f2-49d3-aa77-12f94beee1c2': ['cara', 'cuello'],  // Milky Toner Saccharomyces Ferment 30%
  'd2fa2faa-9408-41cf-8e86-3d3575ae2ac3': ['cara'],  // Moisturizing Clay Mask (genérico)
  '1e59f9b3-18b8-4a98-91a0-376a0f8f72f8': ['cara', 'cuello'],  // Multi-Peptide + Copper Peptides 1% Serum
  '6b2ab52e-8479-4016-a8eb-2a61864491f7': ['cuello'],  // Neck and Chest Firming Cream
  'c74e3fdb-3665-438e-9cbb-574459d0e87f': ['cara'],  // Niacinamide 10% + Zinc 1% Serum
  '6d30d838-50c9-461c-a93a-7e32eba414f0': ['cara', 'cuello', 'manos'],  // Nivea Sun Silky UV Stick SPF50
  '83f81d90-df90-4b65-897c-029c479acb62': ['cara'],  // Numbuzin Toner No.9 NAD+ PDRN
  'be7a694e-0211-4d3f-b9ed-0c2d83f05943': ['labios'],  // Ollie Lip Hydrating Balm SPF50
  '34b622c4-e4bf-4289-b8a6-923632995796': ['labios'],  // PDRN Lip Serum
  'fd5ac61c-3146-49ed-813f-d3b0c4e097aa': ['cara', 'cuello'],  // Peptide + HA Serum
  'a6451499-e856-4494-b68b-acdbbc038824': ['cara'],  // Poremizing Clay Stick Mask
  'dbe863ae-eb6d-42ad-9565-26cc6ed6e86f': ['cara'],  // Poremizing Light Gel Cream
  '844e871d-3993-47ac-9fbc-d4fe3e7d6a82': ['cara', 'cuello', 'manos'],  // Probio-Cica Glow Sun Ampoule
  '70f8c5ee-c241-41d4-bfe4-2cf4d52a7577': ['cara', 'cuello'],  // Retin-A Tretinoína 0.025%
  'e029ae8d-5443-4c99-bb5a-3c2718f12694': ['cuerpo'],  // Retinol Body Cream (Vit E, Té Verde, Aloe)
  '7a10d78f-3fd3-4308-9df5-25f16a062d52': ['cuerpo'],  // Retinol Crema Corporal Reafirmante
  '05f7037d-f73b-4ff8-9081-c64afb2c5cf2': ['cuerpo'],  // Retinol Overnight Lotion
  'a5953eaf-73e5-4ba9-80fa-9979641b62b8': ['cara'],  // Revitalift Laser Day Cream
  '83fb4617-acd4-404c-80e5-f4dae81accb6': ['cara'],  // SA Cleanser
  '106e6207-662c-451d-ac3c-5c8c1db73883': ['manos'],  // Sadoer Kojic Acid Hand Cream
  'd8085cbe-cae2-4f49-92b5-9f118c9fbdfb': ['cara', 'cuerpo'],  // Salicylic Acid 2% Gel
  '5f197c24-5c60-4d16-8bb6-b0c80bd621f8': ['cara'],  // Salicylic Acid 2% Masque
  '50e32222-59b0-4b20-ad26-23b552f91239': ['cuerpo'],  // Salicylic Acid 2% Spray
  '8d0912a7-441d-4e03-a344-e16076334dbe': ['cara'],  // Skin Perfecting 2% BHA
  '21a728f9-3cfa-43eb-a3fe-8a57d417240f': ['cara'],  // Sleeping Pack Ceramidas + Cica
  '0dfd4acf-5300-4822-aa77-f048fa588cd8': ['cara'],  // Spray Ácido Hipocloroso
  'b06008de-44b8-4d11-b6a8-0de0dc543bed': ['cara'],  // Suero Vitamina C 20%
  '9c30b24f-9e2b-422c-8518-0536579cf894': ['cara'],  // The Ordinary Saccharomyces Ferment 30% Milky Toner
  'f95c263b-102e-46c9-bc24-485bf192cdc9': ['cara'],  // Tocobo Collagen Eye Gel Cream
  '2026eae7-7ae3-4596-b61f-8b3bb5cd2088': ['cara', 'cuello', 'manos'],  // Tocobo Sun Stick Cotton Soft SPF50
  'd6f17e28-ccb7-4267-a588-5812bdfa2fde': ['cara'],  // Toleriane Double Repair
  '18d9e716-ed74-41f9-b234-a4c0fcd229c1': ['cara'],  // Toleriane Double Repair Face Moisturizer
  '110a2828-a348-41f3-93b6-bc2b7612d731': ['cara', 'cuello'],  // Toner AHA BHA PHA + Niacinamide 2%
  'b71bc26f-a501-49eb-8461-c7485192ee48': ['cara'],  // Ultramo Bruma Hidratante Niacinamida
};

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
// ── ZONAS APTAS: DÓNDE PUEDE IR EL PRODUCTO ─────────────────────────────────
// Pregunta DISTINTA de PRODUCT_ZONAS. Aquélla dice dónde le entregaste
// estímulo; ésta dice dónde tiene sentido ponértelo. Confundirlas rompe el
// picker: filtrar candidatos por los ejes de dosis dejaba "Hidratantes ·
// cara+cuello" en CERO productos, porque ninguna crema facial tenía valores de
// cuello — y sin embargo todas sirven ahí.
//
// La aptitud se resuelve por CATEGORÍA, no producto por producto: es lo que
// evita que la lista se desincronice al dar de alta algo nuevo (regla 5).
//
// ── FUNDAMENTO CLÍNICO DE CADA RESTRICCIÓN ──────────────────────────────────
//
// CUELLO ← casi todo lo facial. Es piel facial más fina, con menos glándulas
//   sebáceas. Los retinoides y ácidos SÍ pueden ir, con la advertencia de que
//   irritan antes: la guía estándar es empezar 2-3 noches/semana y subir según
//   tolerancia, no copiar la frecuencia de la cara. Por eso el eje
//   `cuello_textura` conserva su aviso de sobre-exposición.
//
// CARA ← NO admite producto corporal. No es delicadeza: la piel facial mide
//   ~0.5 mm contra ~2 mm del cuerpo y tiene mucha mayor densidad sebácea, y las
//   lociones corporales se formulan más oclusivas y con fragancia (con
//   frecuencia 3-5 en escala comedogénica). El resultado típico es acné
//   cosmético. Misma razón para el SPF corporal en cara.
//
// PIES ← solo lo suyo, y no sale de ahí. La urea al 40-80% es queratolítica
//   sobre piel plantar, que es el tejido más grueso del cuerpo. En cara esa
//   concentración es agresiva; el rango facial de urea es 5-10%.
//
// CONTORNO DE OJOS ← se deja SOLO en cara por defecto. Físicamente el cuello
//   admite la fórmula (ambos son piel fina), pero la recomendación derma es
//   producto dedicado para cuello en vez de sustituirlo por el de ojos, y el
//   formato de contorno es pequeño y caro para cubrir cuello y escote. Si
//   prefieres poder marcarlo, agrega 'cuello' a esta línea.
//
// SPF FACIAL ← apto en cara, cuello y manos. Esto es lo que vuelve innecesarios
//   los 14 productos duplicados "(Manos)": existían solo porque no había forma
//   de decir "este protector me lo puse en las manos".
const ZONAS_APTAS_POR_CATEGORIA = {
  '🧼 Limpieza':        ['cara', 'cuello'],
  '💦 Toners':          ['cara', 'cuello'],
  '✨ Serums AM':       ['cara', 'cuello'],
  '💧 Hidratantes':     ['cara', 'cuello', 'manos'],
  '💊 Activos':         ['cara', 'cuello'],
  '🫧 Exfoliantes':     ['cara', 'cuello'],
  '👁️ Contorno Ojos':  ['cara'],
  '🌞 SPF Facial':      ['cara', 'cuello', 'manos'],
  // Sin 'cuello': la usuaria confirma que nunca se pone protector corporal ahí,
  // y ofrecerlo solo ensuciaba el picker de cuello. El cuello se cubre con los
  // SPF faciales, que sí lo declaran.
  '☀️ SPF Corporal':    ['cuerpo', 'manos'],
  '🧴 Cuerpo':          ['cuerpo', 'manos'],
  '✋ Manos':           ['manos', 'cuerpo'],
  '🦶 Pies':            ['pies'],
  '💋 Labios':          ['labios'],
};

// Excepciones que la categoría no puede adivinar. Se usan SOLO para RESTRINGIR
// o para añadir una zona que la categoría no contempla.
const ZONAS_APTAS_OVERRIDE = {
  // Exclusivos de cuello: están catalogados como Hidratantes, pero un producto
  // de cuello en la cara no aporta nada y ensucia el picker facial.
  '6b2ab52e-8479-4016-a8eb-2a61864491f7': ['cuello'],  // Neck and Chest Firming Cream
  'f0797f0c-1ccc-42fa-b3c2-3ba82ecd419a': ['cuello'],  // Golden Peptide Honeycomb Neck Mask
  'd944830f-82e8-434e-8409-dd7a89997fd9': ['cuello'],  // Crema Reafirmante Cuello — WEUD
  // Champú: ni es cuerpo ni es cara.
  '3cef35a0-bc27-440f-9d97-a19709ee2bb9': ['cabello'],  // Lambdapil Shampoo Anticaída
  // Jabón de manos catalogado como Limpieza facial — el caso que originó todo
  // esto. Es un limpiador (tipo) DE MANOS (zona): con el modelo nuevo ya no hay
  // que elegir entre las dos cosas.
  '6cfe7393-865c-4af0-b1bf-5d90e7cd52de': ['manos'],  // Turmeric Lemon Kojic Acid Soap
  '106e6207-662c-451d-ac3c-5c8c1db73883': ['manos'],  // Sadoer Kojic Acid Hand Cream
  // Confirmado por la usuaria: los usa en CUERPO pese a su categoría facial.
  '05f7037d-f73b-4ff8-9081-c64afb2c5cf2': ['cuerpo'],  // Retinol Overnight Lotion
  '50e32222-59b0-4b20-ad26-23b552f91239': ['cuerpo'],  // Salicylic Acid 2% Spray
};

// Aptitud efectiva = categoría ∪ zonas donde YA entrega estímulo, salvo que
// haya override explícito. La unión evita tener que listar producto por
// producto los que su categoría no describe bien: un producto siempre puede
// ir, como mínimo, donde la matriz dice que actúa.
function zonasAptasDe(p) {
  if (!p) return [];
  if (ZONAS_APTAS_OVERRIDE[p.id]) return ZONAS_APTAS_OVERRIDE[p.id].slice();
  const base = ZONAS_APTAS_POR_CATEGORIA[p.category] || [];
  const dosis = PRODUCT_ZONAS[p.id] || [];
  const set = new Set([].concat(base, dosis));
  return Object.keys(ZONAS).filter(z => set.has(z));
}
