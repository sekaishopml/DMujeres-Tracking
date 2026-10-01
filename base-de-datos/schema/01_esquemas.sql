-- 01_esquemas.sql: esquemas de la base.
--   iam        usuarios, roles, sesiones y credenciales
--   tracking   equipos, posiciones y eventos
--   telemetry  batería, señal y salud del teléfono
--   operations jornadas, tramos, asignaciones, alertas y cronograma
--   audit      registro de acciones
--   system     configuración y versión del esquema

BEGIN;

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS tracking;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS system;

-- Metricas de consultas: requiere shared_preload_libraries='pg_stat_statements'
-- y reinicio para recolectar. La extension puede crearse sin preload, pero la
-- vista pg_stat_statements fallara hasta que el parametro este activo.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- PostGIS no se usa por ahora. Si algún día hace falta:
-- CREATE EXTENSION IF NOT EXISTS postgis;

COMMIT;
