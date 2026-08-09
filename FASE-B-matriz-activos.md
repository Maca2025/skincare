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

Hoy **los 87 productos de la matriz puntúan** en al menos un eje. Ninguna
entrada queda vacía: ver "el caso de los labiales" abajo.

> **Conteos verificados el 2026-08-09** (este documento decía 104 / 19 / 13):
> `PRODUCT_DOSE` **87** · `PRODUCT_ZONAS` **87** · `DOSE_AXES` **23** ejes ·
> `IRRITANTES` **12**. Los 87 ids cuadran **exactamente** con el catálogo de
> Supabase: cero huérfanos en las dos direcciones, cero duplicados, ninguna
> categoría descubierta. La bajada de 104 a 87 no es pérdida: son las fusiones
> de productos duplicados y la eliminación de los 14 productos "(Manos)", que el
> modelo función × zona volvió innecesarios.

> ⚠️ **`PRODUCT_DOSE` es un archivo estático y el catálogo vive en Supabase:**
> cada producto nuevo nace **invisible** para el motor de dosis hasta que se le
> agrega su fila. Es el mismo fallo que originó la Fase B, por otra puerta. La
> pestaña Stock avisa cuáles faltan (`renderInventory`) y muestra su id para
> poder pegarlo directo.

> ⚠️ **Reincidencia registrada (2026-07-25).** El aviso de deriva funcionó —
> marcó 12 productos— pero eso no bastó. Las entradas de 11 de ellos se
> redactaron en un archivo aparte, `activos-matriz-agregar.js`, "para pegarlas
> después". Nunca se pegaron, y los 11 pasaron semanas sin contar para nada con
> la calibración ya hecha y esperando en el repo. **Lección: detectar el
> problema y redactar la solución no lo resuelve; la matriz es un archivo
> único** (regla 28 de ARQUITECTURA.md). Un producto nuevo se agrega a
> `PRODUCT_DOSE` en la misma sesión en que se da de alta.

---

## 2. Los ejes de resultado

### Cara (5)

> El cuello **ya no vive aquí** — tiene su propio bloque más abajo (2026-07-25).

| Eje | Qué mide | `techoDiario` | `diasIdeales` |
|---|---|---|---|
| 🛡️ `proteccion` | UVA/UVB/visible | 500 | 7 |
| 🎯 `aclarado` | inhibición de melanina | 370 | 7 |
| 🔬 `textura` | turnover, textura y poros | 265 | 4 |
| 💧 `barrera` | lípidos y humectación | 460 | 7 |
| 🧬 `firmeza` | síntesis de colágeno y elastina | 200 | 6 |

> Estos techos ya son los **recalibrados**: la primera versión (115 / 95 / 140 /
> 115) dejaba cuatro ejes clavados entre 92% y 100% y la barra no discriminaba.
> Valores verificados contra `activos-matriz.js`.

### Cuerpo, pies, cabello y manos (13)

| Eje | `techoDiario` | `diasIdeales` |
|---|---|---|
| ☀️ `cuerpo_proteccion` | 500 | 7 |
| 🎯 `cuerpo_aclarado` | 90 | 7 |
| 🫧 `cuerpo_textura` | 80 | 3 |
| 🧬 `cuerpo_firmeza` | 75 | 5 |
| 💧 `cuerpo_barrera` | 95 | 7 |
| 🦶 `pies` | 85 | 7 |
| 💇 `cabello` | 70 | 3 |
| ✋ `manos` (aclarado — la clave va sin sufijo) | 90 | 7 |
| 🧴 `manos_proteccion` | 500 | 7 |
| 🔬 `manos_textura` | 80 | 3 |
| 💧 `manos_barrera` | 90 | 7 |
| 🧬 `manos_firmeza` | 75 | 6 |
| 💋 `labios` | 110 | 7 |

> Los cuatro últimos de cuerpo/manos (`cuerpo_aclarado`, `manos_textura`,
> `manos_barrera`, `manos_firmeza`) **existían en el código y faltaban en esta
> tabla** — se agregaron el 2026-08-09. Están marcados PROVISIONALES en
> `activos-matriz.js`: sus techos no se han calibrado con datos reales.

### Cuello y escote (5)

| Eje | `techoDiario` | `diasIdeales` |
|---|---|---|
| 🛡️ `cuello_proteccion` | 500 | 7 |
| 🎯 `cuello_aclarado` | 135 | 7 |
| 🔬 `cuello_textura` | 110 | 4 |
| 💧 `cuello_barrera` | 150 | 7 |
| 🧬 `cuello_firmeza` | 170 | 6 |

Antes el cuello estaba **partido**: dos productos dedicados puntuaban en ejes de
CARA y uno en ejes de CUERPO. Tres productos de la misma zona en dos grupos
distintos, así que ninguna de las dos métricas decía nada real sobre el cuello.

Lleva los 5 ejes de la cara y no un subconjunto porque su piel **se comporta como
piel facial** — de hecho es más fina, con menos densidad sebácea y menos soporte
dérmico. Conserva `cuello_textura` aunque "poros" no sea un tema ahí porque es el
eje que dispara el aviso de irritantes, y el cuello es donde la tretinoína irrita
**antes** que en la cara.

**El espejo del SPF — RETIRADO.** ⚠️ Corregido el 2026-08-09. Este párrafo
describía una constante `ESPEJO_SPF_CUELLO` que **no existe en el proyecto**
(cero coincidencias en todos los archivos). El espejo se eliminó al pasar al
modelo función × zona. Hoy `cuello_proteccion` se alimenta de un dato explícito:
los 12 SPF faciales llevan `'cuello'` y `'manos'` en `PRODUCT_ZONAS`, y el motor
recorre zonas × funciones una sola vez. **Verificado: no hay doble conteo.**
Convertir una regla oculta en dato explícito era justamente el objetivo del
refactor — no es algo que haya que "arreglar".

**Productos extendidos — SIN factor de dilución.** ⚠️ Corregido el 2026-08-09.
Este párrafo mandaba aplicar **~0.85** a los ejes de la zona extendida. Ese
factor **no existe en el código y fue retirado a propósito**, a petición de la
usuaria: solo se justificaba en productos de dosis medida, y para una crema
simplemente te sirves más. Los productos que se aplican en "cara, cuello y
escote" puntúan en ambas zonas con el **valor íntegro** — es una sola aplicación
que sí entrega estímulo a las dos, no doble conteo.

**23 ejes en total** (5 de cara + 13 de otras zonas + 5 de cuello). Los de manos,
el de labios y los de cuello se agregaron después de la primera versión de este
documento: las manos y los brazos pigmentan por UVA incidental y no compartían
eje con nada.

**Criterio:** ejes propios, separados de la cara. Una crema corporal de retinol NO
debe inflar la métrica facial de firmeza — no toca la cara. La excepción
deliberada son los productos que se aplican **a la vez** en dos zonas (ver
"productos extendidos"): ahí el estímulo sí llega a ambas.

### El caso de los labiales — por qué "fuera de todo" era un error

La versión original de este documento decía que el bálsamo labial era el único
producto sin eje, y lo daba por resuelto. La premisa era buena: los labios **no**
son piel facial, no tienen estrato córneo comparable y no participan en manchas,
textura ni firmeza de la cara. Pero la conclusión no se seguía. De "no encaja en
los ejes de cara" no se deduce "no hay nada que medir": se deduce que necesita
**eje propio**, exactamente el razonamiento con que `pies`, `cabello` y `manos`
salieron de los ejes genéricos.

Y había algo que medir. El bermellón es el tejido con **menos defensa UV del
cuerpo**: melanina casi nula y un estrato córneo de 3–5 capas contra las 15–20 de
la piel facial. Es donde aparecen la queilitis actínica y los lentigos labiales.
En una usuaria cuyo foco clínico son las **manchas solares**, tener un bálsamo
con SPF50 y no medirlo era un hueco real, no una omisión inofensiva.

Dos decisiones de diseño del eje:

- **No entra en `proteccion`** aunque el bálsamo lleve SPF50. Ese eje mide la
  cara y su ideal se modula por aplicaciones faciales; un bálsamo inflaría la
  métrica sin cubrir un cm² de mejilla.
- **No usa `spfScoreOf`.** El puntaje aquí es mixto —hidratación + protección—,
  no protección pura, así que lleva número fijo. La regla de "una sola fuente de
  verdad para la calibración UVA" aplica a los ejes de protección; este no lo es.

Techo 110 y 7 días ideales son **provisionales**, igual que lo fueron los de
`manos`: no hay datos reales todavía. Con 110, un día de solo bálsamo (60) da
~55% y un día de bálsamo + sérum (130) topa en 100% — discrimina. Recalibrar en
~1 mes.

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
La lista `IRRITANTES` tiene **12** productos: solo retinoides y ácidos exfoliantes.
Es un `Set` (no un arreglo) y se consulta con `.has(id)` — `app.js` la lee con
guarda `typeof IRRITANTES !== 'undefined'`.

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

> ⚠️ **Los porcentajes de la tabla de arriba son de la primera medición y ya no
> son válidos**: se tomaron con los techos viejos y antes de que la reaplicación
> se volviera de un toque (FAB + registro desde la notificación). Volver a
> leerlos de la app antes de citarlos en cualquier lado.

### Pendientes

1. ~~**Recalibrar techos con datos reales.**~~ **HECHO** — los techos de cara
   subieron a 370 / 265 / 460 / 200. Queda vigente el criterio: si vuelven a
   clavarse arriba de 90% varias semanas seguidas, subirlos otra vez. La
   recalibración automática por percentil de los propios 90 días sigue siendo la
   mejora pendiente, para no tener que hacerlo a mano.
2. **Revisar la matriz.** Las potencias son lectura de la composición declarada, no
   verdad clínica. `matriz-activos-revision.csv` trae el razonamiento por producto.
3. **Fase C (opcional):** superponer `skin_state` y fotos para contrastar estímulo
   entregado contra resultado observado, y detectar divergencias (dosis alta de
   renovación + piel irritada → bajar frecuencia).

---

## 9. Archivos

| Archivo | Contenido |
|---|---|
| `activos-matriz.js` | `DOSE_AXES` (**23** ejes), `PRODUCT_DOSE` (**87** productos por id), `PRODUCT_ZONAS` (87), `IRRITANTES` (`Set` de **12**), `ZONAS_APTAS_*` y `zonasAptasDe`. **Archivo único: no volver a partirlo en "agregar" + "base".** ⚠️ `activos-matriz-agregar.js` sigue existiendo: sus 11 entradas ya están pegadas, pero **2 traen el vocabulario anterior** (`cuerpo_barrera`/`cuerpo_firmeza` en vez de funciones puras, y el sérum labial vacío). Pegarlas hoy haría que esos productos puntuaran 0 en silencio. |
| `pure.js` | `spfScoreOf`, `doseWeekPct`, `overExposureDays` |
| `app.js` | Cálculo de dosis, render, focus card, ideales por exposición |
| `tests-spf-agregar.js` · `tests-dosis-agregar.js` | 26 casos para `tests.html` |
| `matriz-activos-revision.csv` | Hoja de revisión con razonamiento por producto |
| `migracion-tags-uva.sql` | Recalibración de tags UVA (idempotente, ya corrida) |

**Fuentes de la investigación UVA:** equivalencia PA/PPD y UVA-PF; sello UVA europeo
y longitud de onda crítica 370 nm (ISO 24442 / ISO 24443); Mexoryl 400 y el rango
380–400 nm; óxidos de hierro y luz visible en pigmentación.
