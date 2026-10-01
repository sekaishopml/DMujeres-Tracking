-- 001: corrige la hora de los datos importados al inicio.
--
-- La importación guardó la hora local de Ecuador como si fuera UTC, así que
-- esas horas quedaron 5 horas antes (una ruta de las 22:23 se leía 17:23).
-- Esto corre las columnas importadas a su hora real. Las que llenó el propio
-- servidor (creado_en, actualizado_en) no se tocan.
--
-- Una marca en system.dmt_configuracion evita aplicarlo dos veces.

BEGIN;

DO $$
DECLARE
  aplicado boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM system.dmt_configuracion WHERE clave = 'migracion.zonaHorariaAjustada'
  ) INTO aplicado;

  IF aplicado THEN
    RAISE NOTICE 'Ajuste de zona horaria ya aplicado; no se repite.';
    RETURN;
  END IF;

  UPDATE tracking.dmt_posicion
     SET registrado_en = registrado_en + interval '5 hours',
         fijado_en     = fijado_en + interval '5 hours',
         recibido_en   = recibido_en + interval '5 hours';

  UPDATE tracking.dmt_posicion_actual
     SET registrado_en = registrado_en + interval '5 hours',
         fijado_en     = fijado_en + interval '5 hours',
         recibido_en   = recibido_en + interval '5 hours';

  UPDATE tracking.dmt_evento
     SET ocurrido_en = ocurrido_en + interval '5 hours',
         recibido_en = recibido_en + interval '5 hours';

  UPDATE operations.dmt_jornada
     SET inicio_en = inicio_en + interval '5 hours',
         fin_en    = CASE WHEN fin_en IS NULL THEN NULL ELSE fin_en + interval '5 hours' END;

  UPDATE telemetry.dmt_bateria
     SET registrado_en = registrado_en + interval '5 hours',
         recibido_en   = recibido_en + interval '5 hours';

  UPDATE tracking.dmt_dispositivo
     SET ultima_conexion_en = ultima_conexion_en + interval '5 hours'
   WHERE ultima_conexion_en IS NOT NULL;

  UPDATE iam.dmt_usuario
     SET expira_en       = CASE WHEN expira_en IS NULL THEN NULL ELSE expira_en + interval '5 hours' END,
         ultimo_acceso_en = CASE WHEN ultimo_acceso_en IS NULL THEN NULL ELSE ultimo_acceso_en + interval '5 hours' END;

  UPDATE iam.dmt_token_fcm
     SET ultimo_uso_en = CASE WHEN ultimo_uso_en IS NULL THEN NULL ELSE ultimo_uso_en + interval '5 hours' END,
         creado_en     = creado_en + interval '5 hours',
         actualizado_en = actualizado_en + interval '5 hours';

  INSERT INTO system.dmt_configuracion (clave, valor, descripcion, es_secreto)
  VALUES (
    'migracion.zonaHorariaAjustada',
    to_jsonb(now()::text),
    'Los instantes migrados se corrigieron +5 h (hora local de Ecuador que se guardó como UTC).',
    false
  );
END $$;

COMMIT;
