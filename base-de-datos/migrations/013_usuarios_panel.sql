-- 013: usuarios del panel con permisos.
-- Qué personal puede ver una cuenta de panel que no es administradora:
-- grupos completos (incluye a quien entre después) y/o personas sueltas.
-- Las secciones visibles viven en iam.dmt_usuario.atributos -> 'panel'.
BEGIN;
CREATE TABLE IF NOT EXISTS iam.dmt_panel_grupo (
    cuenta_id BIGINT NOT NULL REFERENCES iam.dmt_usuario(id) ON DELETE CASCADE,
    grupo_id  BIGINT NOT NULL REFERENCES iam.dmt_grupo(id) ON DELETE CASCADE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cuenta_id, grupo_id)
);
CREATE TABLE IF NOT EXISTS iam.dmt_panel_persona (
    cuenta_id  BIGINT NOT NULL REFERENCES iam.dmt_usuario(id) ON DELETE CASCADE,
    persona_id BIGINT NOT NULL REFERENCES iam.dmt_usuario(id) ON DELETE CASCADE,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cuenta_id, persona_id)
);
CREATE INDEX IF NOT EXISTS idx_dmt_panel_grupo_grupo ON iam.dmt_panel_grupo (grupo_id);
CREATE INDEX IF NOT EXISTS idx_dmt_panel_persona_persona ON iam.dmt_panel_persona (persona_id);
COMMENT ON TABLE iam.dmt_panel_grupo IS 'Grupos de personal que una cuenta de panel puede ver.';
COMMENT ON TABLE iam.dmt_panel_persona IS 'Personas que una cuenta de panel puede ver, elegidas una por una.';
GRANT SELECT ON iam.dmt_panel_grupo, iam.dmt_panel_persona TO dmt_consulta;
COMMIT;
