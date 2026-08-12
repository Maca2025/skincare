-- Reporte posterior a la migración. Correr DESPUÉS del archivo principal.
select
  count(*)                                        as productos_totales,
  count(*) filter (where dose_potencias is not null) as con_potencia,
  count(*) filter (where dose_zonas     is not null) as con_zonas,
  count(*) filter (where dose_potencias is null)     as sin_calibrar
from products;
