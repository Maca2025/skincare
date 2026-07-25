// ============================================================================
// AGREGAR A activos-matriz.js — 11 productos de la compra de Amazon
// ============================================================================
// Pegar DENTRO del objeto PRODUCT_DOSE, antes de la llave que lo cierra.
// Sin esto, los 11 productos quedan invisibles para el motor de dosis y el
// aviso de deriva de la pestaña Stock los va a marcar.
//
// CRITERIOS (ver FASE-B-matriz-activos.md §3):
//   90–100  estándar de oro / grado prescripción a concentración eficaz
//   75–89   activo OTC fuerte con evidencia clínica
//   55–74   activo de soporte sólido
//   35–54   contribución moderada
//   15–34   adyuvante marginal
//   0       no toca ese eje
//
// Los limpiadores puntúan bajo A PROPÓSITO: se enjuagan, el tiempo de contacto
// es de segundos. Es el mismo criterio con que el Limpiador Oleoso tiene 10.
// ============================================================================

  // ── Esencia barrera de arroz negro fermentado ────────────────────────────
  // Ceramida NP + ceramidas adicionales + colesterol + ácidos grasos: es el
  // trío completo con que la piel rehace su barrera, no solo humectantes.
  // Tres fermentos (Galactomyces, Bifida, Aspergillus) suman hidratación y algo
  // de luminosidad. Se calibra contra Hyalu-Cica Moisture Cream (barrera 80):
  // esta es esencia, capa más ligera, por eso 70.
  '900a4aab-bed0-402c-bcb9-a01806886918': { barrera: 70, aclarado: 15 },  // Black Rice Probiotics Barrier Essence — haruharu Wonder

  // ── Bruma crema calmante ─────────────────────────────────────────────────
  // Agua de salvado de arroz de primer ingrediente, madecasósido y centella.
  // Calma e hidrata, pero es bruma: poca sustantividad y se aplica sobre otras
  // capas. Por debajo del NAD+ Serum Mist (barrera 60), que trae más activos.
  '4a9ab636-db1f-424f-bcfc-7abc237c673c': { barrera: 45 },  // 345 Relief Cream Mist — Dr.Althea

  // ── Gel crema para poros ─────────────────────────────────────────────────
  // Centella 50.96% + niacinamida + adenosina. La niacinamida no declara
  // concentración; por posición en la lista ronda 2–5%, así que aclarado va
  // moderado y no al nivel de un despigmentante dedicado. `firmeza 15` es por
  // la adenosina, de los pocos activos coreanos con evidencia real en líneas
  // finas. Poros entra por `textura`, con aporte secundario de firmeza —el
  // criterio de FASE-B §2.
  'dbe863ae-eb6d-42ad-9565-26cc6ed6e86f': { barrera: 55, textura: 45, aclarado: 25, firmeza: 15 },  // Poremizing Light Gel Cream — SKIN1004

  // ── Crema de cuello ──────────────────────────────────────────────────────
  // ⚠️ PUNTAJE CONSERVADOR POR FALTA DE DATOS, no por mala calidad. Marca
  // genérica de Amazon sin lista INCI verificable: solo hay claims de marketing
  // (hialurónico hidrolizado, péptidos, vitamina E, jojoba) sin concentraciones
  // ni ficha independiente. Se puntúa lo único sostenible —hidratación— y un
  // mínimo de firmeza por los péptidos declarados.
  // Va a ejes de CUERPO: el cuello no es cara y no debe inflar la métrica
  // facial de firmeza (criterio de FASE-B §2).
  // Si algún día aparece la lista real de ingredientes, revisar.
  'd944830f-82e8-434e-8409-dd7a89997fd9': { cuerpo_barrera: 40, cuerpo_firmeza: 20 },  // Crema Reafirmante Cuello — WEUD

  // ── Espuma limpiadora con BHA/PHA ────────────────────────────────────────
  // Trae salicílico y gluconolactona de verdad, pero es un LIMPIADOR: 30–60
  // segundos de contacto y al drenaje. Por eso 20 y no 60, aunque el mismo
  // ácido en un producto sin enjuague puntuaría muchísimo más alto.
  //
  // NO ENTRA EN `IRRITANTES`, y es deliberado. Esa lista existe para avisar de
  // sobre-exposición a retinoides y ácidos exfoliantes SIN ENJUAGUE. Un
  // salicílico de contacto corto no acumula irritación de la misma forma, y
  // meterlo dispararía avisos falsos todos los días —exactamente el error que
  // FASE-B §6 corrigió cuando la niacinamida disparaba alertas.
  '9b91d98e-c293-4e27-8cf1-b5faae440bad': { textura: 20 },  // BALANCEFUL Pore Cleansing Foam — Torriden

  // ── Serum labial con PDRN ────────────────────────────────────────────────
  // Entrada VACÍA A PROPÓSITO. Los labios no son piel facial: no tienen estrato
  // córneo comparable ni participan en los ejes de manchas, textura o firmeza
  // de la cara. Es el mismo trato que el bálsamo labial, el único producto que
  // FASE-B dejaba fuera.
  // Se deja la clave presente (en vez de omitirla) para que el aviso de deriva
  // de Stock no lo marque como "olvidado": está considerado, y su decisión es
  // no puntuar.
  '34b622c4-e4bf-4289-b8a6-923632995796': {},  // PDRN Lip Serum — Anua (labios: fuera de los ejes faciales, igual que el bálsamo)

  // ── Kit de viaje SKIN1004 (5 minis) ──────────────────────────────────────
  // Mismos criterios que sus versiones de tamaño completo. Que sean minis no
  // cambia la potencia por aplicación, solo cuánto duran.
  '837c26e3-6b7c-438a-9664-e63d01d4a9e7': { textura: 10 },  // Centella Light Cleansing Oil (viaje) — igual que el Limpiador Oleoso
  'd93e2cfd-b65c-4be1-86af-36fd64108486': { textura: 10 },  // Centella Ampoule Foam (viaje) — limpiador, contacto corto
  'acbcd16d-c0b0-4fc8-8130-7b61e076f801': { barrera: 35 },  // Centella Toning Toner (viaje)
  '914a738d-a1f7-4657-9f84-53be8ad64b66': { barrera: 55 },  // Centella Ampoule (viaje) — centella en alta concentración, sin enjuague
  'bc6ce9fd-5335-456e-a111-367c21603699': { barrera: 60 },  // Centella Soothing Cream (viaje) — crema oclusiva
