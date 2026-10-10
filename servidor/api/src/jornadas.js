// Dominio jornadas: ventanas de encendido/apagado del equipo para el replay.
// Lee operations.dmt_jornada por (dispositivo_id, inicio_en) y calcula la
// duración en minutos; una jornada sin fin_en está abierta y se mide hasta now().

import { consultar } from './db.js';
import { noEncontrado } from './errores.js';
import { leerPaginacion, leerRango, respuestaJson } from './http.js';
import { PREDICADO_PERMISO, buscarDispositivo, permisoDe } from './flota.js';

function aJornada(fila) {
  return {
    id: Number(fila.id),
    inicioEn: fila.inicio_en.toISOString(),
    finEn: fila.fin_en === null ? null : fila.fin_en.toISOString(),
    duracionMin: Number(fila.duracion_min),
    abierta: fila.fin_en === null,
    ...(fila.solo_app ? { soloApp: true } : {}),
  };
}

// El iPhone no marca jornada: su "jornada" de cada día va del primer al último
// punto que mandó. Sigue abierta si el último punto es de hace menos de 15 min.
// $1 = zona horaria; el resto del WHERE lo pone quien la usa.
const VENTANAS_IPHONE = `
  SELECT -extract(epoch FROM min(p.registrado_en))::bigint AS id,
         p.dispositivo_id,
         min(p.registrado_en) AS inicio_en,
         CASE WHEN max(p.registrado_en) > now() - interval '15 minutes' THEN NULL
              ELSE max(p.registrado_en) END AS fin_en,
         true AS solo_app
  FROM tracking.dmt_posicion p`;
const DIA_LOCAL = (zona) => `(p.registrado_en AT TIME ZONE ${zona})::date`;
const DURACION = "round(extract(epoch FROM (coalesce(j.fin_en, now()) - j.inicio_en)) / 60, 1)::float8 AS duracion_min";

export async function listarJornadas(ctx) {
  const dispositivo = await buscarDispositivo(ctx.pool, ctx.usuario, ctx.params.id, ctx.signal, {
    incluirDeshabilitado: true,
  });
  if (!dispositivo) throw noEncontrado('El dispositivo no existe o no está visible para la cuenta.');
  const rango = leerRango(ctx.url, {
    porDefecto: 'hoy',
    maxDias: 366,
    zonaHoraria: ctx.entorno.zonaHoraria,
  });
  const ios = dispositivo.atributos?.plataforma === 'ios';
  const origen = ios
    ? `(${VENTANAS_IPHONE}
        WHERE p.dispositivo_id = $1 AND p.registrado_en >= $2 AND p.registrado_en < $3
        GROUP BY p.dispositivo_id, ${DIA_LOCAL('$4')})`
    : 'operations.dmt_jornada';
  const { rows } = await consultar(
    ctx.pool,
    `SELECT j.id, j.inicio_en, j.fin_en, ${DURACION}${ios ? ', true AS solo_app' : ''}
     FROM ${origen} j
     WHERE j.dispositivo_id = $1
       AND j.inicio_en >= $2
       AND j.inicio_en < $3
     ORDER BY j.inicio_en ASC, j.id ASC`,
    ios
      ? [Number(dispositivo.id), rango.desde, rango.hasta, ctx.entorno.zonaHoraria]
      : [Number(dispositivo.id), rango.desde, rango.hasta],
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, { jornadas: rows.map(aJornada), total: rows.length });
}

// GET /journeys: jornadas de los equipos que la cuenta puede ver (el
// administrador ve todos). dispositivoId acepta el id público, el anterior o
// el interno. Devuelve total, pagina y tamano junto con los datos.
export async function listarJornadasFlota(ctx) {
  const { url } = ctx;
  const { pagina, tamano, desplazamiento } = leerPaginacion(url);
  const rango = leerRango(url, {
    porDefecto: 'hoy',
    maxDias: 366,
    zonaHoraria: ctx.entorno.zonaHoraria,
  });
  const valores = [permisoDe(ctx.usuario), rango.desde, rango.hasta];
  const condiciones = ['d.habilitado', PREDICADO_PERMISO];
  const dispositivoId = url.searchParams.get('dispositivoId');
  if (dispositivoId) {
    valores.push(dispositivoId);
    condiciones.push(`(d.id_publico::text = $${valores.length} OR d.id_legado::text = $${valores.length} OR d.id::text = $${valores.length})`);
  }
  valores.push(ctx.entorno.zonaHoraria);
  const zona = `$${valores.length}`;
  valores.push(tamano, desplazamiento);
  const ES_IPHONE = "d.atributos->>'plataforma' = 'ios'";
  const { rows } = await consultar(
    ctx.pool,
    `SELECT j.id,
            j.dispositivo_id,
            d.id_publico,
            d.nombre,
            j.inicio_en,
            j.fin_en,
            j.solo_app,
            ${DURACION},
            count(*) OVER() AS total_filas
     FROM (
       SELECT id, dispositivo_id, inicio_en, fin_en, false AS solo_app
       FROM operations.dmt_jornada
       WHERE inicio_en >= $2 AND inicio_en < $3
       UNION ALL
       ${VENTANAS_IPHONE}
       WHERE p.registrado_en >= $2 AND p.registrado_en < $3
         AND p.dispositivo_id IN (SELECT d.id FROM tracking.dmt_dispositivo d WHERE ${ES_IPHONE})
       GROUP BY p.dispositivo_id, ${DIA_LOCAL(zona)}
     ) j
     JOIN tracking.dmt_dispositivo d ON d.id = j.dispositivo_id
     WHERE ${condiciones.join(' AND ')}
       AND coalesce(${ES_IPHONE}, false) = j.solo_app
     ORDER BY j.inicio_en ASC, j.dispositivo_id, j.id ASC
     LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
    valores,
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map((fila) => ({
      ...aJornada(fila),
      dispositivoId: Number(fila.dispositivo_id),
      idPublico: fila.id_publico,
      nombre: fila.nombre,
    })),
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}
