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
  aclarado: { icon: '🎯', label: 'Aclarado / pigmentación', color: '#C47A00', grupo: 'cara', techoDiario: 115, diasIdeales: 7 },
  textura: { icon: '🔬', label: 'Renovación, textura y poros', color: '#7E6BB0', grupo: 'cara', techoDiario: 95, diasIdeales: 4 },
  barrera: { icon: '💧', label: 'Barrera e hidratación', color: '#3A8A7A', grupo: 'cara', techoDiario: 140, diasIdeales: 7 },
  firmeza: { icon: '🧬', label: 'Firmeza / colágeno', color: '#B0567E', grupo: 'cara', techoDiario: 115, diasIdeales: 6 },
  cuerpo_proteccion: { icon: '☀️', label: 'Protección corporal', color: '#C4818A', grupo: 'cuerpo', techoDiario: 500, diasIdeales: 7 },
  cuerpo_textura: { icon: '🫧', label: 'Textura corporal', color: '#7E6BB0', grupo: 'cuerpo', techoDiario: 80, diasIdeales: 3 },
  cuerpo_firmeza: { icon: '🧬', label: 'Firmeza corporal', color: '#B0567E', grupo: 'cuerpo', techoDiario: 75, diasIdeales: 5 },
  cuerpo_barrera: { icon: '💧', label: 'Hidratación corporal', color: '#3A8A7A', grupo: 'cuerpo', techoDiario: 95, diasIdeales: 7 },
  pies: { icon: '🦶', label: 'Pies / queratolítico', color: '#8A6A00', grupo: 'pies', techoDiario: 85, diasIdeales: 7 },
  cabello: { icon: '💇', label: 'Cabello', color: '#5B8FA8', grupo: 'cabello', techoDiario: 70, diasIdeales: 3 },
};

// techoDiario  = dosis maxima util en un dia (rendimientos decrecientes).
// diasIdeales  = dias/semana para llegar al 100%. Pasarse NO penaliza el
//                puntaje (se topa), pero dispara el aviso de sobre-exfoliacion.
// idealSemanal = techoDiario * diasIdeales.

const PRODUCT_DOSE = {
  '0193747b-4c2f-4f7d-ac97-7565c98b94b6': { textura: 10 },  // Limpiador Oleoso
  '05f7037d-f73b-4ff8-9081-c64afb2c5cf2': { textura: 65, firmeza: 60, aclarado: 30 },  // Retinol Overnight Lotion
  '0dfd4acf-5300-4822-aa77-f048fa588cd8': { barrera: 30, textura: 15 },  // Spray Ácido Hipocloroso
  '110a2828-a348-41f3-93b6-bc2b7612d731': { textura: 70, aclarado: 30, barrera: 10 },  // Toner AHA BHA PHA + Niacinamide 2%
  '17913609-6130-48bd-977e-45ee06379ff6': { barrera: 80, aclarado: 20, firmeza: 15 },  // Hyalu-Cica Moisture Cream
  '18d9e716-ed74-41f9-b234-a4c0fcd229c1': { barrera: 80, aclarado: 20 },  // Toleriane Double Repair Face Moisturizer
  '1b656610-fce5-45a6-b6e8-8ec33e209653': { aclarado: 70, barrera: 25 },  // Anti-Pigment Contorno de Ojos
  '1e59f9b3-18b8-4a98-91a0-376a0f8f72f8': { firmeza: 80, textura: 30, barrera: 15 },  // Multi-Peptide + Copper Peptides 1% Serum
  '20064300-8139-45ef-b803-4e4bf61d94bc': { barrera: 60, firmeza: 30 },  // Black Rice Probiotics NAD+ Serum Mist
  '2026eae7-7ae3-4596-b61f-8b3bb5cd2088': { proteccion: null }, /* proteccion via spfScoreOf */  // Tocobo Sun Stick Cotton Soft SPF50
  '21a728f9-3cfa-43eb-a3fe-8a57d417240f': { barrera: 85 },  // Sleeping Pack Ceramidas + Cica
  '22b2bb98-8431-4d40-8ffe-08f02f3db40b': { barrera: 65, aclarado: 15 },  // Cerave Eye Repair Cream
  '23236746-4738-468c-b043-250f0db91ddb': { barrera: 25 },  // Limpiador Hidratante
  '27826422-4e8b-47a3-a6a0-27f436ce2b26': { proteccion: null }, /* proteccion via spfScoreOf */  // Black Rice Airyfit Sunscreen
  '2b41c15a-bbab-4a44-b583-476d0f11f3f9': { cuerpo_barrera: 75 },  // Dove Ceramidas Body Lotion
  '3b90cc0e-7170-4f62-9e99-c582510d6361': { barrera: 55 },  // Ceramide Eye Cream Stick
  '3ba97655-b68a-4084-8bec-fd0c4aac09de': { textura: 25, aclarado: 15 },  // Glycolic Bright Gel Cleanser
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
  '6b2ab52e-8479-4016-a8eb-2a61864491f7': { firmeza: 55, barrera: 40 },  // Neck and Chest Firming Cream
  '6d30d838-50c9-461c-a93a-7e32eba414f0': { proteccion: null }, /* proteccion via spfScoreOf */  // Nivea Sun Silky UV Stick SPF50
  '70f8c5ee-c241-41d4-bfe4-2cf4d52a7577': { textura: 95, firmeza: 85, aclarado: 70 },  // Retin-A Tretinoína 0.025%
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
  'b6026bce-10f2-49d3-aa77-12f94beee1c2': { barrera: 50, aclarado: 45, textura: 40 },  // Milky Toner Saccharomyces Ferment 30%
  'b71bc26f-a501-49eb-8461-c7485192ee48': { barrera: 35, firmeza: 20, aclarado: 20 },  // Ultramo Bruma Hidratante Niacinamida
  'b73336bc-ad0e-444b-b807-7956498daa5e': { barrera: 15 },  // Caudalie Beauty Elixir Bruma Facial
  'bc090811-c158-4bd2-b97a-6f83f0de7a24': { cuerpo_firmeza: 60, cuerpo_textura: 50, cuerpo_barrera: 30 },  // Crema Corporal Retinol Reafirmante
  // 'be7a694e-0211-4d3f-b9ed-0c2d83f05943': {},  // Ollie Lip Hydrating Balm SPF50 — Labios: fuera de los ejes faciales (igual que hoy).
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
  'ecef5283-7bdd-460b-a9a8-ccb917942c4c': { aclarado: 90, textura: 55, barrera: 10 },  // Finacea Ácido Azelaico 15%
  'f4f4f34a-d243-41f3-9bb1-dc1ca966d035': { proteccion: null }, /* proteccion via spfScoreOf */  // Canmake Mermaid Skin Gel SPF50
  'f5419858-d505-4621-9379-bdedad67dd50': { pies: 85 },  // Barra Urea 60% (Aguacate + Jojoba)
  'f95c263b-102e-46c9-bc24-485bf192cdc9': { barrera: 40, firmeza: 35, aclarado: 30 },  // Tocobo Collagen Eye Gel Cream
  'fd5ac61c-3146-49ed-813f-d3b0c4e097aa': { firmeza: 55, barrera: 45 },  // Peptide + HA Serum
  'feac892a-7a0c-4647-9035-c5278c23cd19': { barrera: 70, firmeza: 30 },  // Laneige Cream Skin Toner & Moisturizer
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
