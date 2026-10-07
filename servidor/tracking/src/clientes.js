// Lo que la app necesita para registrar actividades con pocos toques:
//  - GET  /api/mobile/v1/clientes            lista de clientes con dirección;
//  - POST /api/mobile/v1/clientes            agrega un cliente nuevo desde la app;
//  - GET  /api/mobile/v1/paradas?fecha=      dónde estuvo detenido ese día, para
//    registrar cada parada como actividad (la hora sale del GPS, no se escribe).

import { detectarParadas } from '../../api/src/paradas.js';
import {
  autorizacionMovil,
  buscarOFallar,
  identificadorDe,
  leerJson,
  numeroFinito,
  objeto,
  responderJson,
  responderSinCuerpo,
  texto,
} from './movil.js';

const LIMITE_JSON = 8 * 1024;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function aCliente(f) {
  return {
    id: Number(f.id),
    nombre: f.nombre,
    direccion: f.direccion ?? null,
    lat: f.latitud === null ? null : Number(f.latitud),
    lon: f.longitud === null ? null : Number(f.longitud),
  };
}

async function equipoAutorizado(req, res, ctx, identificador) {
  let codigo = null;
  if (!ctx.configuracion.canalMovilActivo) codigo = 404;
  else if (!(await autorizacionMovil(req, ctx))) codigo = 401;
  else if (!identificador) codigo = 400;
  if (codigo) {
    responderSinCuerpo(res, codigo);
    return null;
  }
  return buscarOFallar(ctx, res, identificador, 404);
}

export async function atenderClientesConsulta(req, res, ctx) {
  const dispositivo = await equipoAutorizado(req, res, ctx, identificadorDe(req, ctx.url));
  if (!dispositivo) return;
  try {
    const { rows } = await ctx.almacen.pool.query(
      `SELECT id, nombre, direccion, latitud, longitud
         FROM operations.dmt_cliente WHERE activo ORDER BY lower(nombre)`,
    );
    return responderJson(res, 200, { clientes: rows.map(aCliente) });
  } catch (error) {
    ctx.log.error(`movil/clientes-get: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}

// {deviceId, nombre, direccion?, lat?, lon?}. Si ya existe uno con ese nombre
// se devuelve ese: dos personas que agregan el mismo cliente no lo duplican.
export async function atenderClienteNuevo(req, res, ctx) {
  const lectura = await leerJson(req, LIMITE_JSON);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const cuerpo = objeto(lectura.datos);
  const dispositivo = await equipoAutorizado(req, res, ctx, cuerpo ? texto(cuerpo.deviceId) : null);
  if (!dispositivo) return;
  const nombre = texto(cuerpo.nombre)?.slice(0, 120);
  if (!nombre) return responderSinCuerpo(res, 400);
  const direccion = texto(cuerpo.direccion)?.slice(0, 300) ?? null;
  const lat = numeroFinito(cuerpo.lat);
  const lon = numeroFinito(cuerpo.lon);
  const conUbicacion = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  try {
    const existente = await ctx.almacen.pool.query(
      `SELECT id, nombre, direccion, latitud, longitud FROM operations.dmt_cliente
        WHERE activo AND lower(nombre) = lower($1) LIMIT 1`,
      [nombre],
    );
    if (existente.rows[0]) return responderJson(res, 200, { cliente: aCliente(existente.rows[0]) });
    const { rows } = await ctx.almacen.pool.query(
      `INSERT INTO operations.dmt_cliente (nombre, direccion, latitud, longitud, creado_por_dispositivo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, direccion, latitud, longitud`,
      [nombre, direccion, conUbicacion ? lat : null, conUbicacion ? lon : null, Number(dispositivo.id)],
    );
    return responderJson(res, 201, { cliente: aCliente(rows[0]) });
  } catch (error) {
    ctx.log.error(`movil/clientes-post: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}

export async function atenderParadasDia(req, res, ctx) {
  const dispositivo = await equipoAutorizado(req, res, ctx, identificadorDe(req, ctx.url));
  if (!dispositivo) return;
  const fecha = ctx.url.searchParams.get('fecha');
  if (!FECHA_RE.test(fecha ?? '')) return responderSinCuerpo(res, 400);
  try {
    const { rows } = await ctx.almacen.pool.query(
      `SELECT registrado_en, latitud, longitud, precision_m
         FROM tracking.dmt_posicion
        WHERE dispositivo_id = $1
          AND registrado_en >= ($2::date::timestamp AT TIME ZONE 'America/Guayaquil')
          AND registrado_en < (($2::date + 1)::timestamp AT TIME ZONE 'America/Guayaquil')
        ORDER BY registrado_en`,
      [Number(dispositivo.id), fecha],
    );
    const puntos = rows.map((p) => ({
      registradoEn: p.registrado_en,
      latitud: Number(p.latitud),
      longitud: Number(p.longitud),
      precisionM: p.precision_m === null ? null : Number(p.precision_m),
    }));
    const paradas = detectarParadas(puntos).map((p) => ({
      inicio: p.inicio.getTime(),
      fin: p.fin.getTime(),
      lat: p.latitud,
      lon: p.longitud,
    }));
    return responderJson(res, 200, { fecha, paradas });
  } catch (error) {
    ctx.log.error(`movil/paradas: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}
