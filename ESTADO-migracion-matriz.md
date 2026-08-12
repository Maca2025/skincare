# ⚠️ Migración de las matrices a Supabase — A MEDIO CAMINO

**Fecha:** 11 de agosto de 2026
**Estado:** `expand` y `migrate` hechos. **Falta `contract`.**

## Qué se hizo

`PRODUCT_DOSE` y `PRODUCT_ZONAS` salieron de `activos-matriz.js` hacia dos
columnas nuevas en Supabase:

```sql
alter table products
  add column dose_potencias jsonb,
  add column dose_zonas     jsonb;
```

Los 87 productos se migraron con `migracion-matriz-a-supabase.sql` (generado
desde el archivo, no a mano) y se **verificaron uno por uno** contra el CSV que
devolvió Supabase: 87 de 87 idénticos, incluidos los 14 `proteccion: null`, que
llegaron como `null` y no como `0`. Ese detalle importa: `null` significa "usa
`spfScoreOf`", y un `0` habría apagado la protección solar de todos los filtros.

## Por qué esto es peligroso ahora mismo

**El mismo dato está en dos lugares y el código sigue leyendo el viejo.**

La app no cambió de comportamiento — `PRODUCT_DOSE` y `PRODUCT_ZONAS` siguen en
`activos-matriz.js` y siguen siendo la única fuente que se consulta. Las
columnas de Supabase están llenas pero nadie las mira.

Mientras dure este estado: **si alguien edita una potencia, tiene que editarla
en el archivo**, no en la base. Cambiarla en Supabase no hace nada y crea una
divergencia silenciosa entre las dos copias.

## Lo que falta (en orden)

1. Escribir un resolvedor que lea `p.dose_potencias` / `p.dose_zonas` en vez de
   las constantes. Son ~8 sitios que leen `PRODUCT_DOSE` y ~6 que leen
   `PRODUCT_ZONAS`, todos en `app.js`.
2. **Borrar ambas constantes de `activos-matriz.js`.** El archivo queda solo con
   las reglas: `FUNCIONES`, `ZONAS`, `DOSE_AXES`, `IRRITANTES`, `ZONAS_APTAS…`.
   Éste es el paso que elimina la deuda. *Retirar algo a medias es peor que no
   retirarlo.*
3. El ciclo de calibración de dos pegadas: botón "Copiar pendientes de calibrar"
   y caja "Pegar calibración" en Stock, más un campo de ingredientes (INCI) en
   el alta. Los números de potencia los investiga Claude, no los captura Maca —
   el formulario solo recoge la materia prima.
4. Rediseño del alta para escritorio y foto del producto.

## Por qué se detuvo aquí

El commit `4fb3348 motor cadencia`, de un chat paralelo, tocó `activos-matriz.js`,
`app.js`, `pure.js`, `sw.js` y las pruebas — los mismos archivos que toca el
paso 1. **Las dos sesiones escriben sobre la misma carpeta en disco**, así que no
hay conflicto de git que avise: el último que guarda borra al otro en silencio.

**Regla mientras dure: un solo chat escribiendo en la carpeta a la vez.**
