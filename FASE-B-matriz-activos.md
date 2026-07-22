# Fase B — Progreso por resultado: criterios completos

Registro de **todos los criterios** con que se construyó el motor de dosis, por qué
se eligió cada uno y qué NO se debe romper. Última actualización: julio 2026.

Convierte *"apliqué estos productos"* en *"estoy entregando este estímulo, y por lo
tanto puedo esperar estos resultados"*.

---

## 1. El problema que resuelve

El progreso medía **obediencia a un plan**, no resultados:

- `dailyRoutinePct` y el heatmap solo contaban un registro si traía
  `routine_step_id`. Aplicar 6 productos buenos fuera de rutina marcaba **0%**.
- `roleAdherence` dividía días aplicados entre días programados: cualquier
  desviación castigaba, aunque la dosis entregada fuera excelente.
- El "camino · 16 semanas" avanzaba por **tiempo transcurrido**, no por lo aplicado.
- **33 de 74 productos no tenían rol clínico** — eran invisibles: la Vitamina C 20%,
  el Glicólico 7%, todos los salicílicos y los 8 productos de firmeza.

Hoy **73 de 74 puntúan** (solo el bálsamo labial queda fuera, igual que antes).

---

## 2. Los ejes de resultado

### Cara y cuello (5)

| Eje | Qué mide | `techoDiario` | `diasIdeales` |
|---|---|---|---|
| 🛡️ `proteccion` | UVA/UVB/visible | 500 | 7 |
| 🎯 `aclarado` | inhibición de melanina | 115 | 7 |
| 🔬 `textura` | turnover, textura y poros | 95 | 4 |
| 💧 `barrera` | lípidos y humectación | 140 | 7 |
| 🧬 `firmeza` | síntesis de colágeno y elastina | 115 | 6 |

### Cuerpo, pies y cabello (6)

`cuerpo_proteccion` · `cuerpo_textura` · `cuerpo_firmeza` · `cuerpo_barrera` ·
`pies` · `cabello`

**Criterio:** ejes propios, separados de la cara. Una crema corporal de retinol NO
debe inflar la métrica facial de firmeza — no toca la cara.

### Dónde caen poros y firmeza

- **Poros → `textura`.** Su causa dominante es obstrucción por sebo y células
  muertas (BHA, niacinamida, arcilla, retinoides). Pero recibe **aporte secundario
  de `firmeza`**: al perder colágeno perifolicular el poro pierde soporte y se ve
  más grande. Por eso retinoides y péptidos ayudan por dos vías distintas.
- **`firmeza` recibió eje propio.** Sin él, 8 productos (péptidos de cobre, PDRN,
  factores de crecimiento, colágeno, NAD+) no contaban para nada.

---

## 3. Potencia por producto

Cada producto recibe **0–100 por eje**, según composición declarada:

| Rango | Significado |
|---|---|
| 90–100 | estándar de oro / grado prescripción a concentración eficaz |
| 75–89 | activo OTC fuerte con evidencia clínica a concentración eficaz |
| 55–74 | activo de soporte sólido |
| 35–54 | contribución moderada |
| 15–34 | adyuvante marginal |
| 0 | no toca ese eje |

**Criterios aplicados:**

- Los limpiadores puntúan bajo aunque traigan buenos activos: **se enjuagan**, el
  tiempo de contacto es corto.
- El colágeno hidrolizado tópico cuenta como humectante (`barrera`), no como
  reafirmante: no penetra para estimular colágeno propio.
- Un producto de contorno de ojos puntúa acotado: el área tratada es pequeña.
- **`proteccion` NO lleva número en la matriz.** Se toma `spfScoreOf(p)` para no
  duplicar la calibración UVA. **Una sola fuente de verdad.**

---

## 4. Protección UVA — `spfScoreOf`

### El error que se corrigió

La versión anterior **sumaba etiquetas**: más tags = más puntos. Eso premiaba la
convención de etiquetado, no la protección real. Un SPF50 europeo sin etiqueta PA
sacaba 25/100 aunque protegiera igual que un PA++++.

### Los tres componentes (independientes, no acumulables entre sí)

**1) MAGNITUD (0–60)** — cuánta UVA se bloquea. Los sistemas asiático y europeo
miden lo mismo con métodos distintos, así que son **equivalentes y jamás se suman**:

- `pa4` — PA++++ (ISO 24442, PPD in vivo) = PPD ≥ 16 → **60**
- `euuva` — sello UVA europeo (ISO 24443) = UVA-PF ≥ SPF/3, en SPF50 ≥ 16.7 → **60**
- `pa3` → 43 · `pa2` → 27 · sin dato → **21** (piso de amplio espectro, no cero)

**2) ESPECTRO (0–30)** — hasta qué longitud de onda llega. El mínimo de amplio
espectro es longitud de onda crítica ≥370 nm; ir más allá es beneficio extra:

- `uva400` — Mexoryl 400 (MCE, pico 385 nm) cierra el hueco 380–400 nm que los
  demás filtros dejan abierto y reduce la pigmentación por UVA-1 → **30**
- `uvalong` — UVA largos sin llegar a 400 → **15**

**3) LUZ VISIBLE (0–10)** — `tinted`, óxidos de hierro → **10**

### Calibración: LENTIGOS, no melasma

Los pesos 60/30/10 están calibrados a **manchas solares**, donde la causa es casi
puramente UV. **Si el diagnóstico cambia a melasma, subir `vis` a ~20 y bajar
`mag`**, porque ahí la luz visible sí es detonante de primer orden.

### Puntajes resultantes

| Protector | Puntos | Nota |
|---|---|---|
| Anthelios UVMune 400 **tintado** | 100 | **No tolerado** (irrita) |
| Anthelios UVMune 400 sin tinte | 90 | **Techo real alcanzable** |
| Eucerin Pigment Control tintado | 85 | Además despigmenta (Thiamidol) |
| L'Oréal UV Defender | 75 | |
| Anthelios UV AIR Serum | 70 | Antes 25 por no tener tags |
| Coreanos/japoneses PA++++ | 60 | |
| Nivea Sun Silky UV Stick | 60 | Antes 25 por no llevar etiqueta PA |

> **Nota clínica:** sí tolera el UVMune 400 **sin tinte**, que lleva el mismo
> Mexoryl 400. Lo que irrita de la versión con color casi seguro no es el filtro
> sino pigmentos, fragancia o vehículo. Si algún día quiere cubrir luz visible,
> buscar otro tintado con base distinta es más prometedor que descartar el Mexoryl.

---

## 5. Ideal de aplicaciones modulado por exposición solar

Exigir 5 reaplicaciones en un día de oficina no tiene sentido clínico y castiga sin
motivo. El ideal se modula con `sun_exposure` de `daily_notes`.

**Cara** — `IDEAL_SPF_BY_SUN`:

| exposición | ideal | 2 aplicaciones ese día |
|---|---|---|
| interior | 2 | 90% |
| normal | 3 | 60% |
| alta | 4 | 45% |
| playa | 5 | 36% |

Sin nota ese día → `IDEAL_SPF_DEFAULT = 3` (día normal).

**Cuerpo** — `IDEAL_BODY_SPF_BY_SUN` = interior 1 · normal 1 · alta 2 · playa 4.

Criterio: la piel corporal va cubierta por ropa buena parte del tiempo y **nadie
reaplica protector corporal 5 veces al día**. Con el ideal de la cara, este eje
marcaba 4% — medía una expectativa irreal, no un descuido.

`interior` vale **1 y no 0** porque trae brazos y escote descubiertos a diario en
Guadalajara (1,566 m, UV alto casi todo el año): incluso bajo techo se acumula UVA
incidental, que es justo lo que pigmenta los brazos. **Si se prefiere que los días
de interior no se evalúen, poner 0** — el código lo soporta (`ideal <= 0` → día no
evaluable).

### Frecuencia vs calidad de producto

A ~2 aplicaciones diarias:

- Subir el producto de 85 a 100 puntos → **+6**
- Subir de 2 a 4 aplicaciones → **+34**

**La frecuencia tiene ~6× más palanca que la calidad del producto.** Por eso no se
reescaló el techo a "lo mejor que tolera": habría arreglado el problema chico
escondiendo el grande, y habría creado un incentivo perverso (sacar un buen
producto del stock subiría el porcentaje sin haber mejorado nada).

---

## 6. Motor de dosis (`pure.js`)

### `doseWeekPct(dailyPoints, techoDiario, diasIdeales)`

**Techo diario.** Exfoliar dos veces el mismo día no vale el doble. Los puntos de
cada día se topan **antes** de sumar la semana. Sin esto el modelo premiaría
sobre-aplicar, que es lo contrario de la realidad clínica.

**Ventana semanal.** El retinoide rinde ~4 noches/semana y se aplana. Medido día a
día, las noches de descanso contarían como falla y volveríamos a castigar la
desviación — justo lo que se quería eliminar. Con ventana semanal, 4 noches de
tretinoína = 100%, y 7 noches tampoco baja: se topa.

**Semana en curso prorrateada.** El ideal se escala por días transcurridos
(`diasIdeales * days.length / 7`). Sin esto, el lunes la barra caía de 98% a 14% y
parecía un desplome.

**Un eje solo se evalúa desde su primera semana con registro**: no se castiga el
tiempo anterior a empezar a usar ese tipo de producto.

**Ejes sin datos devuelven `null` y no se renderizan** — nada de barras vacías.

### `overExposureDays(irritantDays, diasIdeales)`

Avisa cuando hay demasiados días con irritante. **No penaliza el puntaje** —
pasarse se topa en 100 y se avisa aparte.

**Recibe días con IRRITANTE, no puntos del eje `textura`.** La niacinamida, el
azelaico y el NAG suben textura **sin irritar**; contarlos disparaba avisos falsos.
La lista `IRRITANTES` (13 productos) tiene solo retinoides y ácidos exfoliantes.

Tolera 1 día de margen antes de avisar.

---

## 7. Render de Progreso

- **"Estímulo entregado" es la vista primaria.** La adherencia a rutinas pasó a un
  `<details>` colapsado, con nota de que mide si seguiste el plan, no el estímulo.
- **Focus card prioriza:** primero sobre-exposición a irritantes, luego el eje de
  dosis más bajo. La adherencia solo es respaldo si aún no hay datos de dosis.
- **Mensaje distinto por eje.** Si las 5 barras dicen lo mismo, se dejan de leer.
  Cada mensaje aporta algo que el número no dice (p. ej. que en aclarado el
  limitante ya no es la usuaria sino los 3–4 meses que tardan las manchas).

### Orden de declaración — NO reordenar

- `doseDiag` se define **junto a `dosisCara`**, no en el bloque de render, porque
  `buildFocusHTML` lo usa antes. Siendo `const`, moverlo abajo revienta el render
  por zona muerta temporal.
- `skinByDate` / `sunByDate` se construyen **arriba, junto al cálculo de SPF**, que
  los necesita para modular el ideal. El heatmap los reutiliza después.

---

## 8. Estado actual y pendientes

Con su mezcla real de productos:

| Eje | Valor |
|---|---|
| 🛡️ Protección | **35%** |
| 🎯 Aclarado | 92% |
| 🔬 Textura | 100% |
| 💧 Barrera | 93% |
| 🧬 Firmeza | 96% |

**Conclusión del modelo:** los activos están en su techo. Lo único que separa esta
rutina de un protocolo completo para manchas solares es **reaplicar protector
durante el día**. No comprar nada, no agregar pasos.

### Pendientes

1. **Recalibrar techos con datos reales.** Los `techoDiario` salieron de una
   simulación. En la primera pasada casi todo se pegaba en 100% y hubo que
   subirlos. Con 4 ejes entre 92% y 100%, hoy el único con señal útil es
   Protección. **Si en un mes siguen clavados arriba, subir los techos** para que
   la barra vuelva a discriminar.
2. **Revisar la matriz.** Las potencias son lectura de la composición declarada, no
   verdad clínica. `matriz-activos-revision.csv` trae el razonamiento por producto.
3. **Fase C (opcional):** superponer `skin_state` y fotos para contrastar estímulo
   entregado contra resultado observado, y detectar divergencias (dosis alta de
   renovación + piel irritada → bajar frecuencia).

---

## 9. Archivos

| Archivo | Contenido |
|---|---|
| `activos-matriz.js` | `DOSE_AXES`, `PRODUCT_DOSE` (74 productos por id), `IRRITANTES` |
| `pure.js` | `spfScoreOf`, `doseWeekPct`, `overExposureDays` |
| `app.js` | Cálculo de dosis, render, focus card, ideales por exposición |
| `tests-spf-agregar.js` · `tests-dosis-agregar.js` | 26 casos para `tests.html` |
| `matriz-activos-revision.csv` | Hoja de revisión con razonamiento por producto |
| `migracion-tags-uva.sql` | Recalibración de tags UVA (idempotente, ya corrida) |

**Fuentes de la investigación UVA:** equivalencia PA/PPD y UVA-PF; sello UVA europeo
y longitud de onda crítica 370 nm (ISO 24442 / ISO 24443); Mexoryl 400 y el rango
380–400 nm; óxidos de hierro y luz visible en pigmentación.
