# HANDOFF — EvenSkyn Lumo⁺ (2026) · para la sesión que lo meta a la app

**Fecha:** 11 de agosto de 2026
**Qué es esto:** investigación del dispositivo + el protocolo personal que Maca
va a seguir, escrito para que la siguiente sesión pueda modelarlo en la app sin
volver a investigar. **No es una decisión de diseño tomada** — la sección 4 son
preguntas abiertas, y hay una que rompe un supuesto del motor de dosis.

**Leer antes:** `claude/cadencia-especificacion.md` (el motor de piso/techo).
Este documento asume ese vocabulario.

---

## 1 · El aparato

Dispositivo de mano antiedad, ~$499 USD. **El "2026" no trae modos nuevos**
respecto al 2025: los cambios son batería (2000 mAh vs 650), 550 ciclos de vida
vs 150, carga en ~2–3 h y garantía de 2 años. Cualquier documentación del Lumo⁺
2025 aplica igual.

**Cinco modos, cinco niveles de intensidad cada uno:**

| Modo | Qué hace | Especificación | ¿Gel? |
|---|---|---|---|
| RF | Calienta la dermis → colágeno, firmeza | 1 MHz bipolar | Sí |
| EMS | Microcorriente, estimula músculo → lifting | 3–15 mA | Sí |
| LED | Rojo 623 nm (colágeno) / Azul 465 nm (calma, acné) | — | **No** |
| ION | Limpieza iónica | 100 Hz | Sí |
| ENI | Empuja activos del sérum hacia adentro | — | Sí |

El gel debe ser **conductor a base de agua**. Nunca aceite ni alcohol.

## 2 · Las reglas duras del fabricante

Éstas son las que la app tendría que hacer cumplir:

- **Arranque:** 1 sesión/semana las primeras 2–4 semanas. Después 2/semana.
- **Sostenido:** 2–3 sesiones/semana según edad (Maca <40 → 1–2, hasta nivel 4
  de intensidad; >40 → 2–3, hasta nivel 5).
- **Separación mínima entre sesiones de RF: 2–3 días.** El colágeno necesita ese
  descanso para remodelarse.
- **Techo semanal en MINUTOS, no en días:** máx. 15 min/semana de cara si <40
  (20 min si cara+cuello). Nunca más de 30 min/semana en total.
- Sesión típica: 5–8 min. La combinación recomendada por la marca es 5 min RF +
  5 min EMS, o bien 2–3 min ION → 2 min ENI → 3–5 min EMS.
- **Cada modo tiene apagado automático**; el aparato regresa a standby solo.

**Precauciones:** no pasar sobre tiroides, busto ni zona genital. Rosácea →
nivel 1–2. Implantes metálicos en cara → consultar médico.

**Expectativa de resultados:** algunos ven cambio a las 2 semanas, lo típico es
a las 8, los mejores resultados tardan hasta 6 meses. En RF se siente calor
ligero o nada; en EMS, pequeños tirones. **La ausencia de sensación no significa
que no esté funcionando** — importante para no subir intensidad de más.

---

## 3 · El conflicto con la tretinoína, y cómo se resolvió

**Maca detectó una contradicción real en la guía del fabricante** y hay que
dejarla asentada para que nadie la reintroduzca:

> Dicen "úsalo 2–3 veces por semana" y también "espera 4 días a una semana
> después de cada sesión para aplicar tretinoína de receta". Con 3 sesiones
> semanales **nunca quedan 4 días libres**. Las dos frases no pueden ser ciertas.

**Diagnóstico:** esa advertencia es texto de responsabilidad legal copiado de
protocolos de consultorio. La regla dermatológica de pausar tretinoína 1–2
semanas aplica a **microneedling, RF fraccionada, láser y peelings** — cosas que
rompen o ablacionan la barrera. El Lumo⁺ no perfora ni ablaciona: es RF de
potencia de consumidor. **El riesgo real no es daño, es irritación acumulada**
(calor + fricción + tallar el gel sobre piel retinizada).

**Y el fabricante omite lo obvio:** la tretinoína es producto de noche. No hacen
falta 4 días — hace falta **saltarse la noche de tretinoína del día que usó el
aparato**. Se pierde una noche, no cuatro.

### Perfil de Maca

**Tretinoína 0.025% (la concentración de receta más baja), desde abril de 2026.**
A la fecha de este documento son ~4 meses. **La retinización — la fase de
irritación mientras la piel se adapta — dura 8–12 semanas y ya pasó.** Barrera
adaptada. Es el escenario de mayor flexibilidad: no necesita pausar la
tretinoína ni limitarse a modo LED.

### Protocolo acordado — fase de arranque

Una noche fija por semana (**se sugirió domingo**, para que si queda rojez el
lunes la baje), durante **3 semanas**:

1. Limpiar y secar bien
2. Gel conductor, capa generosa
3. **5 min de RF a intensidad 2**
4. Retirar el gel con agua tibia y las manos, **sin tallar ni toallita**
5. Hidratante suave
6. **Esa noche no hay tretinoína.** Se retoma la noche siguiente

Al terminar las 3 semanas, Maca reporta cómo respondió su piel y de ahí se
decide subir a 2 sesiones, agregar EMS y en qué intensidad. **Ese siguiente paso
no está decidido — no adelantarlo.**

### Por qué esto no rompe el piso de `textura`

`textura` de cara quedó en **piso 3 / techo 6**. Con 1 sesión semanal quedan 6
noches disponibles para tretinoína; con 2 sesiones, 5. **En ambos casos se
cumple el piso 3 y se respeta el techo 6.** El dispositivo no compite con la
meta de renovación. Vale la pena verificarlo en código, pero el análisis en
papel cierra.

---

## 4 · Preguntas abiertas de diseño 🔶

Ninguna está resuelta. Van en orden de qué tan caro sale equivocarse.

### 4.1 · El techo del dispositivo se mide en minutos; el motor cuenta días

**Éste es el choque de modelo, y es el que hay que resolver primero.**
`DOSE_AXES` razona en `techoDiario` (acumulación dentro de un día) y
`diasPiso`/`diasTecho` (días de la semana). El límite del Lumo⁺ es
**15–30 minutos por semana**, y una sesión de 8 min pesa distinto que una de 5.

Meterlo como "una aplicación más" pierde exactamente la información que gobierna
la seguridad. Las salidas posibles: (a) un eje con unidad propia, (b) guardar
duración en la aplicación y que el techo del eje se exprese en minutos, o (c)
dejar el dispositivo **fuera del motor de dosis** con su propio contador. **No
elegir sin verlo contra el código.**

### 4.2 · ¿Es un `product`?

No se consume, no tiene stock, no se agota (`products.status = 'out'` no
significa nada aquí), y tiene **modos con intensidades** — un producto no tiene
eso. Pero Stock, `my_rating` y el cruce `invFilterZona`/`invFilterFuncion` ya
existen y servirían. Decidir si es una `category` nueva o una entidad aparte.

### 4.3 · ¿A qué ejes alimenta, y con cuánta potencia?

Lo defendible por mecanismo: **RF y EMS → `firmeza`**; **LED rojo → `firmeza`**;
**LED azul → nada claro** (calma/acné, que no es un eje actual). ION y ENI no son
tratamiento, son preparación.

**Advertencia:** los valores de `PRODUCT_DOSE` de los tópicos salieron de datos
reales y se recalibraron el 2026-07-23. **Inventar una potencia para el
dispositivo mete un número sin respaldo a un eje calibrado** y ensucia la barra
de `firmeza` durante meses. Si no hay base, la opción honesta es que no aporte
dosis todavía y solo se registre.

### 4.4 · La regla de exclusión con tretinoína

Funcionalmente es la misma que `IRRITANTES` (nunca dos la misma noche en la
misma zona) y esa plomería ya existe con `EJE_IRRITANTE_POR_ZONA`. **Pero el
Lumo⁺ no es un irritante químico**, y meterlo a esa lista hace que la app afirme
algo falso sobre por qué chocan. Evaluar si conviene una regla de exclusión
propia o reusar el mecanismo con otro nombre.

### 4.5 · La rampa de arranque

La app no tiene concepto de "fase de adaptación" — un piso/techo que cambia
después de N semanas. Puede que no valga la pena construirlo para un solo
aparato: quizá basta que Maca avise y se ajuste el número a mano.

### 4.6 · Detalle menor

**Al entregar, subir la caché del service worker** (`sw.js`, iba en v24 → v25
según la spec de cadencia). Sin eso el celular sirve la versión vieja y parece
que nada cambió.

---

## 5 · Cómo trabajar con Maca

Lo de siempre, y sigue funcionando: **razonamiento completo, UN SOLO PASO DE
INSTRUCCIONES A LA VEZ.** Cerrar con una sola acción concreta y esperar su
"listo".

**Esta sesión confirmó algo que conviene recordar:** ella detectó sola la
contradicción del fabricante ("es muy raro eso"). Cuando algo no le cuadra,
tiene razón lo suficientemente seguido como para que valga la pena verificarlo
antes de defender la fuente. La respuesta correcta fue ir a buscar la evidencia,
no explicarle mejor el texto original.

---

## 6 · Fuentes

- [Página de producto Lumo⁺ 2026 — EvenSkyn](https://www.evenskyn.com/products/evenskyn-lumo-rf-microcurrent-red-light-skin-tightening-device)
- [FAQs del Lumo⁺ — EvenSkyn](https://www.evenskyn.com/pages/lumo-faqs)
- [Comparativa de versiones Lumo — EvenSkyn](https://www.evenskyn.com/pages/device-comparison)
- [Lumo⁺ 5-en-1, especificaciones técnicas — EvenSkyn](https://www.evenskyn.com/products/2025-lumo-plus)
- [Stopping and Restarting Tretinoin: How to Pause for Procedures — Okdermo](https://okdermo.com/stopping-and-restarting-tretinoin-how-to-pause-for-procedures-and-ramp-back-up/)
- [Combinar LED con tretinoína tópica — Dr. Oracle](https://www.droracle.ai/articles/915018/is-it-safe-to-combine-led-facial-light-therapy)
- [Guía de dispositivos LED y microcorriente caseros — Joan Pohutsky, DNP](https://mohs-md.com/a-dermatology-experts-guide-to-safe-at-home-led-masks-microcurrent-tools/)

**Advertencia médica:** nada de esto es consejo dermatológico. El protocolo de
la sección 3 es un razonamiento sobre documentación pública, no una indicación
clínica. Con tretinoína de receta, la última palabra es de quien la recetó.
