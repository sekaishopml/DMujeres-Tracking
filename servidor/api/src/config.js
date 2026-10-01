// Dominio configuracion de la Web: valores por defecto + system.dmt_configuracion.
// Nunca expone filas marcadas es_secreto.

import { consultar } from './db.js';
import { respuestaJson } from './http.js';
import { PREDICADO_PERMISO, permisoDe } from './flota.js';

const ENTORNOS_VALIDOS = new Set(['desarrollo', 'pruebas', 'produccion']);

function indiceDe(filas) {
  const mapa = new Map();
  for (const fila of filas) mapa.set(fila.clave, fila.valor);
  return mapa;
}

function centroValido(valor) {
  const candidato = Array.isArray(valor)
    ? { lat: valor[0], lon: valor[1] }
    : valor && typeof valor === 'object'
      ? { lat: valor.latitud ?? valor.lat, lon: valor.longitud ?? valor.lon }
      : null;
  if (!candidato) return null;
  const lat = Number(candidato.lat);
  const lon = Number(candidato.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  return [lat, lon];
}

export async function obtenerConfiguracion(ctx) {
  const { rows } = await consultar(
    ctx.pool,
    `SELECT clave, valor FROM system.dmt_configuracion WHERE es_secreto = FALSE`,
    [],
    { signal: ctx.signal },
  );
  const configurados = indiceDe(rows);
  const entorno = ENTORNOS_VALIDOS.has(ctx.entorno.entorno) ? ctx.entorno.entorno : 'desarrollo';
  const intervalo = Number(configurados.get('web.intervaloRefrescoSegundos') ?? ctx.entorno.intervaloRefrescoSegundos);
  const zonaHoraria = String(configurados.get('web.zonaHoraria') ?? ctx.entorno.zonaHoraria);
  const estiloUrl = String(configurados.get('web.mapa.estiloUrl') ?? ctx.entorno.mapa.estiloUrl);
  const zoom = Number(configurados.get('web.mapa.zoom') ?? ctx.entorno.mapa.zoom);
  const centro = centroValido(configurados.get('web.mapa.centro')) ?? (await centroOperativo(ctx));
  respuestaJson(ctx.res, 200, {
    versionApi: 'v1',
    entorno,
    zonaHoraria,
    intervaloRefrescoSegundos: Number.isFinite(intervalo) && intervalo >= 1 ? Math.trunc(intervalo) : 5,
    mapa: {
      estiloUrl,
      centroInicial: { latitud: centro[0], longitud: centro[1] },
      zoomInicial: Number.isFinite(zoom) && zoom >= 0 && zoom <= 24 ? zoom : 12,
    },
    capacidades: {
      replay: true,
      reportes: true,
      sse: false,
      websocket: false,
      exportacion: false,
    },
  });
}

async function centroOperativo(ctx) {
  try {
    const { rows } = await consultar(
      ctx.pool,
      `SELECT avg(pa.latitud) AS lat, avg(pa.longitud) AS lon
       FROM tracking.dmt_posicion_actual pa
       JOIN tracking.dmt_dispositivo d ON d.id = pa.dispositivo_id
       WHERE d.habilitado AND ${PREDICADO_PERMISO}`,
      [permisoDe(ctx.usuario)],
      { signal: ctx.signal, timeoutMs: 3000 },
    );
    const lat = Number(rows[0]?.lat);
    const lon = Number(rows[0]?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
  } catch (error) {
    // Sin posiciones vivas se usa el centro configurado por entorno.
    ctx.log.aviso('config_centro_no_disponible', { detalle: error.message });
  }
  return ctx.entorno.mapa.centro;
}
