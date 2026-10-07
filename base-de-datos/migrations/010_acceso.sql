-- 010: acceso más estricto.
--  - Tres claves equivocadas seguidas bloquean la cuenta un rato.
--  - Cada sesión del teléfono guarda la instalación de la app que la abrió,
--    para no dejar entrar la misma cuenta desde otro teléfono.
BEGIN;
ALTER TABLE iam.dmt_usuario
    ADD COLUMN IF NOT EXISTS intentos_fallidos integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bloqueado_hasta timestamptz;
ALTER TABLE iam.dmt_sesion
    ADD COLUMN IF NOT EXISTS instalacion text;
COMMIT;
