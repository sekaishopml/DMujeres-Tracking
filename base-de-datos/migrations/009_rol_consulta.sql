-- 009: rol de solo lectura para la consola del panel (Sistema). Ve los datos
-- de operación (equipos, puntos, jornadas, actividades) y nunca las cuentas,
-- claves ni sesiones (iam) ni la auditoría.
BEGIN;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmt_consulta') THEN
        CREATE ROLE dmt_consulta NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END $$;
GRANT USAGE ON SCHEMA tracking, operations, telemetry TO dmt_consulta;
GRANT SELECT ON ALL TABLES IN SCHEMA tracking, operations, telemetry TO dmt_consulta;
-- Las particiones y tablas que se creen después también se pueden leer.
ALTER DEFAULT PRIVILEGES FOR ROLE dmt IN SCHEMA tracking, operations, telemetry
    GRANT SELECT ON TABLES TO dmt_consulta;
GRANT dmt_consulta TO dmt;
COMMIT;
