-- Tipo PDV (punto de venta) para las geocercas.
ALTER TABLE operations.dmt_geocerca DROP CONSTRAINT IF EXISTS ck_dmt_geocerca_tipo;
ALTER TABLE operations.dmt_geocerca ADD CONSTRAINT ck_dmt_geocerca_tipo
  CHECK (tipo IN ('casa', 'cliente', 'oficina', 'cc', 'pdv', 'na'));
