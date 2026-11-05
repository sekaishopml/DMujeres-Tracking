-- 015: la ubicación de un cliente la confirma una persona en el panel o la
-- aprende el sistema del primer registro de la app, que puede estar en camino
-- o en otra ciudad. Solo con una ubicación confirmada se dice "Lejos del
-- cliente": una aprendida no sirve para acusar a nadie.
BEGIN;
ALTER TABLE operations.dmt_cliente
    ADD COLUMN IF NOT EXISTS ubicacion_confirmada BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
