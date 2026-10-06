// Receptor de OwnTracks (modo HTTP): POST /owntracks con un JSON por punto.
// El equipo se identifica con `?id=` en la URL o con la cabecera X-Limit-D.
// Responde siempre `[]` (lo que espera la app); solo se guardan los mensajes
// de tipo location. Equipo desconocido: 404. Falla al guardar: 503 (reintenta).

import { fechaCapturaValida } from './db.js';

const LIMITE_CUERPO = 64 * 1024;

function responder(res, codigo) {
  res.writeHead(codigo, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end('[]');
}

function numero(valor) {
  const n = typeof valor === 'number' ? valor : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

async function leerJson(req) {
  const trozos = [];
  let total = 0;
  for await (const trozo of req) {
    total += trozo.length;
    if (total > LIMITE_CUERPO) throw new Error('cuerpo_demasiado_grande');
    trozos.push(trozo);
  }
  return JSON.parse(Buffer.concat(trozos).toString('utf8'));
}

export async function atenderOwnTracks(req, res, ctx) {
  if (req.method !== 'POST') return responder(res, 405);
  let msg;
  try {
    msg = await leerJson(req);
  } catch {
    return responder(res, 400);
  }
  if (msg?._type !== 'location') return responder(res, 200);

  const identificador = (ctx.url.searchParams.get('id') ?? req.headers['x-limit-d'] ?? '').trim();
  if (!identificador) return responder(res, 400);
  const latitud = numero(msg.lat);
  const longitud = numero(msg.lon);
  const tst = numero(msg.tst);
  if (latitud === null || longitud === null || tst === null) return responder(res, 400);
  const momento = new Date(tst * 1000);

  let dispositivo;
  try {
    dispositivo = await ctx.almacen.buscarDispositivo(identificador);
  } catch (error) {
    ctx.log.error(`owntracks: fallo al buscar dispositivo: ${error.message}`);
    return responder(res, 503);
  }
  if (!dispositivo) return responder(res, 404);
  if (dispositivo.habilitado === false || !fechaCapturaValida(momento)) return responder(res, 200);

  const bateria = numero(msg.batt);
  const velocidad = numero(msg.vel);
  const rumbo = numero(msg.cog);
  const atributos = { id_legado: null };
  if (msg.bs === 2) atributos.charge = true;
  else if (msg.bs === 1) atributos.charge = false;
  const posicion = {
    protocolo: 'owntracks',
    latitud,
    longitud,
    altitud: numero(msg.alt),
    velocidadKmh: velocidad !== null && velocidad >= 0 ? velocidad : null,
    rumbo: rumbo !== null && rumbo >= 0 ? rumbo : null,
    precision: numero(msg.acc),
    bateria: bateria !== null && bateria >= 0 ? Math.min(100, bateria) : null,
    valida: true,
    registradoEn: momento,
    atributos,
  };
  try {
    await ctx.almacen.registrarPosicion(dispositivo.id, posicion);
  } catch (error) {
    ctx.log.error(`owntracks: fallo al guardar posicion: ${error.message}`);
    return responder(res, 503);
  }
  return responder(res, 200);
}
