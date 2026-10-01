// Divide los recorridos en viajes y paradas a partir de tracking.dmt_posicion,
// con las mismas reglas para Reportes y para la Repetición de ruta.

import { VELOCIDAD_IMPOSIBLE_KMH } from './geo.js';

export const UMBRAL_MOVIMIENTO_KMH = 5;
// Desplazamiento mínimo entre fixes para confiar en la velocidad calculada
// (por debajo es jitter del GPS parado) y ventana máxima entre ellos.
export const MIN_DESPLAZAMIENTO_FIABLE_M = 30;
// Fixes usados para la coordenada representativa de una parada.
export const PRECISION_BUENA_FIX_M = 80;
export const MAX_INTERVALO_VELOCIDAD_S = 300;
export const MIN_PARADA_SEGUNDOS = 180;
// Una parada larga llegaba partida en muchos registros: cada temblor del GPS
// o cada hueco sin señal la cortaba. Por eso primero se unen los pedazos del
// mismo lugar (desde 30 s) y recién después se exige que la parada unida dure
// 180 s o más.
export const MIN_EMISION_PARADA_SEGUNDOS = 30;
// Un viaje muy corto dentro del mismo sitio (mover el equipo en el patio) no
// corta la parada. Un viaje real (150 m o más) sí: irse y volver son dos visitas.
export const MAX_PUENTE_KM = 0.15;
export const MAX_PUENTE_SEGUNDOS = 600;
// Para unir fragmentos del mismo sitio: hueco temporal máximo y radio.
// El hueco largo (teléfono apagado) se une solo en el mismo lugar; la
// duración reportada suma solo tiempo observado, nunca el hueco.
export const VENTANA_FUSION_SEGUNDOS = 1800;
export const RADIO_FUSION_KM = 0.15;
// Área de trabajo (Ecuador continental y Galápagos, con margen). Un grupo de
// puntos fuera de este cuadro es error de GPS. Solo afecta a las paradas; los
// puntos guardados no cambian y los viajes no se filtran.
export const LAT_MIN_OP = -5;
export const LAT_MAX_OP = 2;
export const LON_MIN_OP = -93;
export const LON_MAX_OP = -74;
export const MIN_VIAJE_SEGUNDOS = 60;
export const MAX_SALTO_SEGUNDOS = 900;
export const MIN_DISTANCIA_VIAJE_KM = 0.05;
// Un tramo "en movimiento" de menos de 300 m es temblor del GPS (el equipo
// quieto con la velocidad saltando entre 0 y picos altos): esos puntos cuentan
// como detenidos para no partir una parada en decenas.
export const MAX_RUIDO_MOVIMIENTO_KM = 0.3;

export const ORDEN_VIAJES = {
  inicio: 'v.inicio',
  fin: 'v.fin',
  duracionMin: 'v.segundos',
  distanciaKm: 'v.km',
  velocidadMaximaKmh: 'v.velocidad_maxima',
  paradas: 'v.paradas',
  dispositivoId: 'v.dispositivo_id',
};

export const ORDEN_PARADAS = {
  inicio: 's.inicio',
  fin: 's.fin',
  duracionMin: 's.segundos',
  dispositivoId: 's.dispositivo_id',
};

// Placeholders: $1 = usuario (NULL = administrador), $2 = desde, $3 = hasta,
// $4 = dispositivo (NULL = todos). Devuelve una fila por tramo con `tipo`.
export function sqlSegmentos() {
  return `
    WITH crudos_pts AS (
      SELECT p.id, p.id_publico, p.dispositivo_id, p.registrado_en, p.latitud, p.longitud,
             p.direccion, p.velocidad_kmh, p.precision_m,
             lag(p.registrado_en) OVER wp AS t_previo,
             lag(p.latitud) OVER wp AS lat_prev,
             lag(p.longitud) OVER wp AS lon_prev
      FROM tracking.dmt_posicion p
      JOIN tracking.dmt_dispositivo d ON d.id = p.dispositivo_id
      WHERE d.habilitado
        AND p.registrado_en >= $2 AND p.registrado_en < $3
        AND ($1::bigint IS NULL OR EXISTS (
              SELECT 1 FROM operations.dmt_asignacion a
              WHERE a.dispositivo_id = d.id AND a.usuario_id = $1 AND a.activa
                AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())))
        AND ($4::bigint IS NULL OR p.dispositivo_id = $4)
      WINDOW wp AS (PARTITION BY p.dispositivo_id ORDER BY p.registrado_en)
    ),
    -- Velocidad efectiva: la mayor entre la reportada y la del desplazamiento
    -- real contra el fix anterior, si ese desplazamiento es fiable (>= ${MIN_DESPLAZAMIENTO_FIABLE_M} m y
    -- mayor que la precisión del punto, en <= ${MAX_INTERVALO_VELOCIDAD_S} s). Algunos
    -- teléfonos reportan 0 en marcha y la parada se tragaba el viaje.
    pts AS (
      SELECT c.id, c.id_publico, c.dispositivo_id, c.registrado_en, c.latitud, c.longitud, c.direccion, c.precision_m,
             greatest(coalesce(c.velocidad_kmh, 0), coalesce(v.implicita, 0)) AS velocidad,
             (greatest(coalesce(c.velocidad_kmh, 0), coalesce(v.implicita, 0)) > ${UMBRAL_MOVIMIENTO_KMH}) AS en_movimiento
      FROM crudos_pts c
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN c.t_previo IS NULL THEN NULL
          WHEN extract(epoch FROM (c.registrado_en - c.t_previo)) NOT BETWEEN 1 AND ${MAX_INTERVALO_VELOCIDAD_S} THEN NULL
          ELSE (
            6371000 * 2 * asin(sqrt(
              power(sin(radians(c.latitud - c.lat_prev) / 2), 2)
              + cos(radians(c.lat_prev)) * cos(radians(c.latitud))
                * power(sin(radians(c.longitud - c.lon_prev) / 2), 2)
            ))
          ) END AS metros
      ) d
      CROSS JOIN LATERAL (
        SELECT CASE WHEN d.metros >= greatest(${MIN_DESPLAZAMIENTO_FIABLE_M}, coalesce(c.precision_m, 0))
                    THEN d.metros / extract(epoch FROM (c.registrado_en - c.t_previo)) * 3.6
               END AS implicita
      ) v
    ),
    saltos AS (
      SELECT pts.*,
             CASE WHEN lag(registrado_en) OVER w IS NULL
                    OR registrado_en - lag(registrado_en) OVER w > interval '${MAX_SALTO_SEGUNDOS} seconds'
                  THEN 1 ELSE 0 END AS salto
      FROM pts
      WINDOW w AS (PARTITION BY dispositivo_id ORDER BY registrado_en)
    ),
    islas AS (
      SELECT saltos.*, sum(salto) OVER (PARTITION BY dispositivo_id ORDER BY registrado_en) AS isla
      FROM saltos
    ),
    cambios AS (
      SELECT islas.*,
             CASE WHEN en_movimiento IS DISTINCT FROM
                       lag(en_movimiento) OVER (PARTITION BY dispositivo_id, isla ORDER BY registrado_en)
                  THEN 1 ELSE 0 END AS cambio
      FROM islas
    ),
    grupos AS (
      SELECT cambios.*, sum(cambio) OVER (PARTITION BY dispositivo_id, isla ORDER BY registrado_en) AS grupo
      FROM cambios
    ),
    pares AS (
      SELECT grupos.*,
             lag(latitud) OVER (PARTITION BY dispositivo_id, isla, grupo ORDER BY registrado_en) AS lat_previa,
             lag(longitud) OVER (PARTITION BY dispositivo_id, isla, grupo ORDER BY registrado_en) AS lon_previa,
             lag(registrado_en) OVER (PARTITION BY dispositivo_id, isla, grupo ORDER BY registrado_en) AS t_previo
      FROM grupos
    ),
    distancias AS (
      SELECT dispositivo_id, isla, grupo,
             sum(CASE
               -- Saltos imposibles (más de VELOCIDAD_IMPOSIBLE_KMH, o
               -- desplazamiento sin tiempo entre fixes) no suman distancia:
               -- misma regla que el replay (geo.js). Suelen ser dos teléfonos
               -- con la misma cuenta o fixes de red muy malos.
               WHEN d_km > 0.05 AND NOT (seg > 0 AND d_km / seg * 3600 <= ${VELOCIDAD_IMPOSIBLE_KMH}) THEN 0
               ELSE d_km
             END) AS km
      FROM (
        SELECT *,
               6371 * 2 * asin(sqrt(
                                          power(sin(radians(latitud - lat_previa) / 2), 2)
                                          + cos(radians(lat_previa)) * cos(radians(latitud))
                                            * power(sin(radians(longitud - lon_previa) / 2), 2)
                                        )) AS d_km,
               extract(epoch FROM registrado_en - t_previo) AS seg
        FROM pares
      ) pares
      WHERE lat_previa IS NOT NULL
      GROUP BY dispositivo_id, isla, grupo
    ),
    crudos AS (
      SELECT g.dispositivo_id, g.isla, g.grupo, bool_and(g.en_movimiento) AS movimiento,
             coalesce(d.km, 0) AS km
      FROM grupos g
      LEFT JOIN distancias d
        ON d.dispositivo_id = g.dispositivo_id AND d.isla = g.isla AND d.grupo = g.grupo
      GROUP BY g.dispositivo_id, g.isla, g.grupo, d.km
    ),
    ruido AS (
      SELECT dispositivo_id, isla, grupo
      FROM crudos
      WHERE movimiento AND km < ${MAX_RUIDO_MOVIMIENTO_KM}
    ),
    puntos2 AS (
      SELECT g.*,
             (g.en_movimiento AND NOT EXISTS (
               SELECT 1 FROM ruido r
               WHERE r.dispositivo_id = g.dispositivo_id AND r.isla = g.isla AND r.grupo = g.grupo
             )) AS mov2
      FROM grupos g
    ),
    cambios2 AS (
      SELECT puntos2.*,
             CASE WHEN mov2 IS DISTINCT FROM
                       lag(mov2) OVER (PARTITION BY dispositivo_id, isla ORDER BY registrado_en)
                  THEN 1 ELSE 0 END AS cambio2
      FROM puntos2
    ),
    grupos2 AS (
      SELECT cambios2.*, sum(cambio2) OVER (PARTITION BY dispositivo_id, isla ORDER BY registrado_en) AS grupo2
      FROM cambios2
    ),
    pares2 AS (
      SELECT grupos2.*,
             lag(latitud) OVER (PARTITION BY dispositivo_id, isla, grupo2 ORDER BY registrado_en) AS lat_previa,
             lag(longitud) OVER (PARTITION BY dispositivo_id, isla, grupo2 ORDER BY registrado_en) AS lon_previa,
             lag(registrado_en) OVER (PARTITION BY dispositivo_id, isla, grupo2 ORDER BY registrado_en) AS t_previo
      FROM grupos2
    ),
    distancias2 AS (
      SELECT dispositivo_id, isla, grupo2,
             sum(CASE
               -- Saltos imposibles (más de VELOCIDAD_IMPOSIBLE_KMH, o
               -- desplazamiento sin tiempo entre fixes) no suman distancia:
               -- misma regla que el replay (geo.js). Suelen ser dos teléfonos
               -- con la misma cuenta o fixes de red muy malos.
               WHEN d_km > 0.05 AND NOT (seg > 0 AND d_km / seg * 3600 <= ${VELOCIDAD_IMPOSIBLE_KMH}) THEN 0
               ELSE d_km
             END) AS km
      FROM (
        SELECT *,
               6371 * 2 * asin(sqrt(
                                          power(sin(radians(latitud - lat_previa) / 2), 2)
                                          + cos(radians(lat_previa)) * cos(radians(latitud))
                                            * power(sin(radians(longitud - lon_previa) / 2), 2)
                                        )) AS d_km,
               extract(epoch FROM registrado_en - t_previo) AS seg
        FROM pares2
      ) pares2
      WHERE lat_previa IS NOT NULL
      GROUP BY dispositivo_id, isla, grupo2
    ),
    tramos AS (
      SELECT g.dispositivo_id, bool_and(g.mov2) AS movimiento,
             min(g.registrado_en) AS inicio, max(g.registrado_en) AS fin,
             extract(epoch FROM (max(g.registrado_en) - min(g.registrado_en))) AS segundos,
             count(*) AS puntos,
             (array_agg(g.id ORDER BY g.registrado_en))[1] AS id,
             (array_agg(g.id_publico ORDER BY g.registrado_en))[1] AS id_publico,
             (array_agg(g.latitud ORDER BY g.registrado_en))[1] AS lat_inicio,
             (array_agg(g.longitud ORDER BY g.registrado_en))[1] AS lon_inicio,
             (array_agg(g.latitud ORDER BY g.registrado_en DESC))[1] AS lat_fin,
             (array_agg(g.longitud ORDER BY g.registrado_en DESC))[1] AS lon_fin,
             (array_agg(g.direccion ORDER BY g.registrado_en))[1] AS direccion,
             -- Coordenada representativa: mediana de los fixes con precisión
             -- <= ${PRECISION_BUENA_FIX_M} m (el primer fix suele ser de red/wifi y caer a cientos
             -- de metros). Sin ninguno bueno, el de menor error.
             coalesce(
               percentile_cont(0.5) WITHIN GROUP (ORDER BY g.latitud) FILTER (WHERE g.precision_m <= ${PRECISION_BUENA_FIX_M}),
               (array_agg(g.latitud ORDER BY coalesce(g.precision_m, 1e9)))[1]) AS lat_rep,
             coalesce(
               percentile_cont(0.5) WITHIN GROUP (ORDER BY g.longitud) FILTER (WHERE g.precision_m <= ${PRECISION_BUENA_FIX_M}),
               (array_agg(g.longitud ORDER BY coalesce(g.precision_m, 1e9)))[1]) AS lon_rep,
             coalesce(
               percentile_cont(0.5) WITHIN GROUP (ORDER BY g.precision_m) FILTER (WHERE g.precision_m <= ${PRECISION_BUENA_FIX_M}),
               min(g.precision_m)) AS precision_rep,
             max(g.velocidad) AS velocidad_maxima,
             coalesce(d.km, 0) AS km
      FROM grupos2 g
      LEFT JOIN distancias2 d
        ON d.dispositivo_id = g.dispositivo_id AND d.isla = g.isla AND d.grupo2 = g.grupo2
      GROUP BY g.dispositivo_id, g.isla, g.grupo2, d.km
    ),
    -- Candidatos a fusión: paradas desde 30 s (el umbral de 180 s se exige a
    -- la parada fusionada, no al fragmento) y puentes (micro-viajes dentro
    -- del mismo sitio). Los viajes reales no son fusionables.
    candidatos AS (
      SELECT t.*,
             (NOT t.movimiento AND t.segundos >= ${MIN_EMISION_PARADA_SEGUNDOS}
              AND t.lat_inicio BETWEEN ${LAT_MIN_OP} AND ${LAT_MAX_OP}
              AND t.lat_fin BETWEEN ${LAT_MIN_OP} AND ${LAT_MAX_OP}
              AND t.lon_inicio BETWEEN ${LON_MIN_OP} AND ${LON_MAX_OP}
              AND t.lon_fin BETWEEN ${LON_MIN_OP} AND ${LON_MAX_OP}) AS es_parada,
             (t.movimiento AND t.km < ${MAX_PUENTE_KM}
              AND t.segundos < ${MAX_PUENTE_SEGUNDOS}) AS es_puente
      FROM tramos t
    ),
    -- Cadenas de fusión (gap-and-island): se corta en viaje real, en hueco
    -- mayor a la ventana o en salto de lugar. Solo importan las filas
    -- fusionables; el resto se emite por su vía normal.
    bordes AS (
      SELECT c.*,
             CASE WHEN NOT (c.es_parada OR c.es_puente) THEN 1
                  WHEN lag(c.id) OVER w IS NULL THEN 1
                  WHEN NOT (lag(c.es_parada) OVER w OR lag(c.es_puente) OVER w) THEN 1
                  WHEN extract(epoch FROM (c.inicio - lag(c.fin) OVER w)) > ${VENTANA_FUSION_SEGUNDOS} THEN 1
                  WHEN 6371 * 2 * asin(sqrt(
                         power(sin(radians(c.lat_inicio - lag(c.lat_fin) OVER w) / 2), 2)
                         + cos(radians(lag(c.lat_fin) OVER w)) * cos(radians(c.lat_inicio))
                           * power(sin(radians(c.lon_inicio - lag(c.lon_fin) OVER w) / 2), 2)
                       )) > ${RADIO_FUSION_KM} THEN 1
                  ELSE 0 END AS corte
      FROM candidatos c
      WINDOW w AS (PARTITION BY c.dispositivo_id ORDER BY c.inicio)
    ),
    cadenas AS (
      SELECT b.*, sum(b.corte) OVER (PARTITION BY b.dispositivo_id ORDER BY b.inicio) AS cadena
      FROM bordes b
      WHERE b.es_parada OR b.es_puente
    ),
    -- Solo califica la cadena con al menos una parada y 180 s observados.
    -- La duración suma fragmentos (tiempo con evidencia), nunca el hueco.
    calificadas AS (
      SELECT dispositivo_id, cadena
      FROM cadenas
      GROUP BY dispositivo_id, cadena
      HAVING count(*) FILTER (WHERE es_parada) >= 1
         AND sum(CASE WHEN es_parada THEN segundos ELSE 0 END) >= ${MIN_PARADA_SEGUNDOS}
    ),
    fusionadas AS (
      SELECT c.dispositivo_id, false AS movimiento,
             min(c.inicio) AS inicio, max(c.fin) AS fin,
             sum(CASE WHEN c.es_parada THEN c.segundos ELSE 0 END) AS segundos,
             sum(c.puntos) AS puntos,
             (array_agg(c.id ORDER BY c.inicio))[1] AS id,
             (array_agg(c.id_publico ORDER BY c.inicio))[1] AS id_publico,
             (array_agg(c.lat_inicio ORDER BY c.inicio))[1] AS lat_inicio,
             (array_agg(c.lon_inicio ORDER BY c.inicio))[1] AS lon_inicio,
             (array_agg(c.lat_fin ORDER BY c.inicio DESC))[1] AS lat_fin,
             (array_agg(c.lon_fin ORDER BY c.inicio DESC))[1] AS lon_fin,
             (array_agg(c.direccion ORDER BY c.inicio))[1] AS direccion,
             -- La representativa es la del fragmento parado más largo.
             (array_agg(c.lat_rep ORDER BY c.es_parada DESC, c.segundos DESC))[1] AS lat_rep,
             (array_agg(c.lon_rep ORDER BY c.es_parada DESC, c.segundos DESC))[1] AS lon_rep,
             (array_agg(c.precision_rep ORDER BY c.es_parada DESC, c.segundos DESC))[1] AS precision_rep,
             max(c.velocidad_maxima) AS velocidad_maxima,
             sum(c.km) AS km,
             count(*) FILTER (WHERE c.es_parada) AS fragmentos,
             round(avg((c.lat_inicio + c.lat_fin) / 2)::numeric, 3)::text || ','
               || round(avg((c.lon_inicio + c.lon_fin) / 2)::numeric, 3)::text AS lugar
      FROM cadenas c
      JOIN calificadas q USING (dispositivo_id, cadena)
      GROUP BY c.dispositivo_id, c.cadena
    ),
    -- Emisión final: paradas fusionadas + viajes reales no absorbidos. Las
    -- paradas sueltas solo existen vía fusión (una cadena de un fragmento
    -- califica igual si dura >= 180 s).
    final AS (
      SELECT t.dispositivo_id, t.movimiento, t.inicio, t.fin, t.segundos,
             t.puntos, t.id, t.id_publico, t.lat_inicio, t.lon_inicio,
             t.lat_fin, t.lon_fin, t.direccion, t.lat_rep, t.lon_rep, t.precision_rep,
             t.velocidad_maxima, t.km,
             1 AS fragmentos,
             round(t.lat_inicio::numeric, 3)::text || ','
               || round(t.lon_inicio::numeric, 3)::text AS lugar
      FROM tramos t
      WHERE t.movimiento
        AND t.segundos >= ${MIN_VIAJE_SEGUNDOS}
        AND t.puntos >= 2
        AND t.km >= ${MIN_DISTANCIA_VIAJE_KM}
        AND NOT EXISTS (
          SELECT 1 FROM cadenas c
          JOIN calificadas q USING (dispositivo_id, cadena)
          WHERE c.id = t.id AND c.dispositivo_id = t.dispositivo_id
        )
      UNION ALL
      SELECT f.dispositivo_id, f.movimiento, f.inicio, f.fin, f.segundos,
             f.puntos, f.id, f.id_publico, f.lat_inicio, f.lon_inicio,
             f.lat_fin, f.lon_fin, f.direccion, f.lat_rep, f.lon_rep, f.precision_rep,
             f.velocidad_maxima, f.km,
             f.fragmentos, f.lugar
      FROM fusionadas f
    )
    SELECT 'viaje' AS tipo, t.*
    FROM final t
    WHERE t.movimiento
    UNION ALL
    SELECT 'parada' AS tipo, t.*
    FROM final t
    WHERE NOT t.movimiento
  `;
}
