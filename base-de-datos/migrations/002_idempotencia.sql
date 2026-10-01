-- 002: puntos sin repetir (boot_id + secuencia).
--
-- Si la app reenviaba un lote que ya había llegado, los puntos se guardaban
-- dos veces. Ahora cada punto se identifica por (dispositivo_id, boot_id,
-- local_sequence): boot_id cambia cada vez que arranca la app y
-- local_sequence es un contador que solo sube.
--
--   * tracking.dmt_posicion suma boot_id y local_sequence.
--   * Índice único (dispositivo_id, registrado_en, boot_id, local_sequence)
--     donde boot_id no es nulo. Incluye registrado_en porque PostgreSQL lo
--     exige en tablas particionadas; un reenvío trae la misma hora, así que
--     funciona igual.
--   * Se borra un punto con fecha de 2037 (reloj del teléfono mal).
--
-- Para deshacer:
--   DROP INDEX IF EXISTS tracking.uq_dmt_posicion_identidad;
--   ALTER TABLE tracking.dmt_posicion DROP COLUMN IF EXISTS local_sequence;
--   ALTER TABLE tracking.dmt_posicion DROP COLUMN IF EXISTS boot_id;

BEGIN;

ALTER TABLE tracking.dmt_posicion
  ADD COLUMN IF NOT EXISTS boot_id text;

ALTER TABLE tracking.dmt_posicion
  ADD COLUMN IF NOT EXISTS local_sequence bigint;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dmt_posicion_identidad
  ON tracking.dmt_posicion (dispositivo_id, registrado_en, boot_id, local_sequence)
  WHERE boot_id IS NOT NULL;

-- Se borra solo ese punto, por su id.
DELETE FROM tracking.dmt_posicion
 WHERE id = 92908;

COMMIT;
