-- 006: hasta cuándo vio cada cuenta del panel el cronograma de cada persona.
-- Lo cargado o editado después se marca como nuevo en Reportes. Abrir el
-- cronograma de la persona actualiza la marca.
BEGIN;

CREATE TABLE IF NOT EXISTS operations.dmt_cronograma_visto (
    usuario_id      BIGINT      NOT NULL REFERENCES iam.dmt_usuario(id) ON DELETE CASCADE,
    dispositivo_id  BIGINT      NOT NULL REFERENCES tracking.dmt_dispositivo(id) ON DELETE CASCADE,
    visto_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (usuario_id, dispositivo_id)
);

CREATE INDEX IF NOT EXISTS dmt_actividad_actualizado_idx
    ON operations.dmt_actividad (dispositivo_id, actualizado_en) WHERE NOT eliminada;

GRANT SELECT, INSERT, UPDATE, DELETE ON operations.dmt_cronograma_visto TO dmt;

COMMIT;
