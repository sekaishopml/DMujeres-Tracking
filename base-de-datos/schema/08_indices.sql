-- 08_indices.sql: índices, unicidad y claves foráneas que cruzan esquemas.
-- Prefijos: idx_dmt_ (búsqueda), brin_dmt_ (BRIN), uq_dmt_ (únicos) y fk_dmt_
-- (claves foráneas). Los índices de las tablas particionadas se crean en la
-- tabla madre y PostgreSQL los copia a cada partición.

BEGIN;

-- ---------------------------------------------------------------------------
-- tracking
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_dmt_dispositivo_identificador
    ON tracking.dmt_dispositivo (identificador);

CREATE INDEX idx_dmt_dispositivo_ultima_conexion
    ON tracking.dmt_dispositivo (ultima_conexion_en DESC);

CREATE INDEX idx_dmt_posicion_dispositivo_tiempo
    ON tracking.dmt_posicion (dispositivo_id, registrado_en DESC);

CREATE INDEX brin_dmt_posicion_tiempo
    ON tracking.dmt_posicion USING BRIN (registrado_en);

CREATE INDEX idx_dmt_evento_dispositivo_tiempo
    ON tracking.dmt_evento (dispositivo_id, ocurrido_en DESC);

CREATE INDEX idx_dmt_evento_tipo_tiempo
    ON tracking.dmt_evento (tipo, ocurrido_en DESC);

-- ---------------------------------------------------------------------------
-- telemetry
-- ---------------------------------------------------------------------------
CREATE INDEX idx_dmt_bateria_dispositivo_tiempo
    ON telemetry.dmt_bateria (dispositivo_id, registrado_en DESC);

CREATE INDEX idx_dmt_senal_dispositivo_tiempo
    ON telemetry.dmt_senal (dispositivo_id, registrado_en DESC);

CREATE INDEX idx_dmt_salud_dispositivo_tiempo
    ON telemetry.dmt_salud_dispositivo (dispositivo_id, registrado_en DESC);

CREATE INDEX idx_dmt_salud_dispositivo_tipo
    ON telemetry.dmt_salud_dispositivo (tipo_evento, registrado_en DESC);

-- ---------------------------------------------------------------------------
-- operations
-- ---------------------------------------------------------------------------
CREATE INDEX idx_dmt_jornada_dispositivo_inicio
    ON operations.dmt_jornada (dispositivo_id, inicio_en DESC);

CREATE INDEX idx_dmt_jornada_usuario_inicio
    ON operations.dmt_jornada (usuario_id, inicio_en DESC);

CREATE INDEX idx_dmt_jornada_tramo_jornada
    ON operations.dmt_jornada_tramo (jornada_id, inicio_en);

CREATE INDEX idx_dmt_asignacion_usuario
    ON operations.dmt_asignacion (usuario_id, activa);

CREATE INDEX idx_dmt_asignacion_dispositivo
    ON operations.dmt_asignacion (dispositivo_id, activa);

CREATE INDEX idx_dmt_alerta_dispositivo_tiempo
    ON operations.dmt_alerta (dispositivo_id, ocurrido_en DESC);

CREATE INDEX idx_dmt_alerta_estado
    ON operations.dmt_alerta (estado, ocurrido_en DESC);

CREATE UNIQUE INDEX uq_dmt_alerta_origen_legado
    ON operations.dmt_alerta (origen, id_legado);

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------
CREATE INDEX idx_dmt_auditoria_usuario_tiempo
    ON audit.dmt_auditoria (usuario_id, ocurrido_en DESC);

CREATE INDEX idx_dmt_auditoria_entidad
    ON audit.dmt_auditoria (entidad, entidad_id, ocurrido_en DESC);

-- ---------------------------------------------------------------------------
-- iam
-- ---------------------------------------------------------------------------
CREATE INDEX idx_dmt_sesion_usuario
    ON iam.dmt_sesion (usuario_id, iniciada_en DESC);

CREATE INDEX idx_dmt_token_fcm_dispositivo
    ON iam.dmt_token_fcm (dispositivo_id, activo);

-- ---------------------------------------------------------------------------
-- Claves foraneas diferidas iam -> tracking
-- ---------------------------------------------------------------------------
ALTER TABLE iam.dmt_sesion
    ADD CONSTRAINT fk_dmt_sesion_dispositivo FOREIGN KEY (dispositivo_id)
        REFERENCES tracking.dmt_dispositivo (id) ON DELETE SET NULL;

ALTER TABLE iam.dmt_token_fcm
    ADD CONSTRAINT fk_dmt_token_fcm_dispositivo FOREIGN KEY (dispositivo_id)
        REFERENCES tracking.dmt_dispositivo (id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Registro de versiones aplicadas
-- ---------------------------------------------------------------------------
INSERT INTO system.dmt_version_esquema (version, archivo, descripcion) VALUES
    ('00', '00_compat.sql',    'Funcion system.uuidv7() para PG17/PG18'),
    ('01', '01_esquemas.sql',  'Esquemas, pg_stat_statements y PostGIS opcional'),
    ('02', '02_iam.sql',       'Usuarios, roles, sesiones, tokens FCM y claves'),
    ('03', '03_tracking.sql',  'Dispositivos, posiciones y eventos'),
    ('04', '04_telemetry.sql', 'Bateria, senal y salud del dispositivo'),
    ('05', '05_operations.sql','Jornadas, tramos, asignaciones y alertas'),
    ('06', '06_audit.sql',     'Auditoria'),
    ('07', '07_system.sql',    'Configuracion, mapa de migracion y version'),
    ('08', '08_indices.sql',   'Indices, unicidad y FK diferidas')
ON CONFLICT (version) DO NOTHING;

COMMIT;
