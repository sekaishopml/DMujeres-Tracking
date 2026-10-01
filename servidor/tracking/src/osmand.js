// Protocolo OsmAnd, el que usan las versiones viejas de la app. Acepta GET y
// POST en la raíz con los datos en la query (o en un cuerpo
// application/x-www-form-urlencoded) y responde 200 sin cuerpo cuando el
// punto se acepta; la app borra el punto de su cola con cualquier 2xx.
//
// Equipo desconocido: 404. Falla al guardar: 503, para que la app reintente.

import { fechaCapturaValida } from './db.js';

const LIMITE_CUERPO = 64 * 1024;
const MAX_ALARMA = 200;
const MAX_INT_32 = 2147483647;

function responder(res, codigo) {
  res.writeHead(codigo, { 'cache-control': 'no-store' });
  res.end();
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const convertido = Number(String(valor).trim());
  return Number.isFinite(convertido) ? convertido : null;
}

function booleano(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim().toLowerCase();
  if (texto === 'true' || texto === '1') return true;
  if (texto === 'false' || texto === '0') return false;
  return null;
}

// La hora puede venir en milisegundos, en segundos (si el número es menor a
// Integer.MAX_VALUE) o como fecha ISO.
function interpretarTimestamp(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const texto = String(valor).trim();
  if (/^\d+$/.test(texto)) {
    let milisegundos = Number.parseInt(texto, 10);
    if (milisegundos < MAX_INT_32) milisegundos *= 1000;
    const fecha = new Date(milisegundos);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

async function leerTexto(req, limite) {
  const trozos = [];
  let total = 0;
  let excedido = false;
  for await (const trozo of req) {
    if (excedido) continue;
    total += trozo.length;
    if (total > limite) {
      excedido = true;
      continue;
    }
    trozos.push(trozo);
  }
  if (excedido) {
    const error = new Error('cuerpo_demasiado_grande');
    error.codigo = 'GRANDE';
    throw error;
  }
  return Buffer.concat(trozos).toString('utf8');
}

async function leerParametros(req) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.searchParams.size > 0) return url.searchParams;
  if (req.method === 'POST') {
    const texto = await leerTexto(req, LIMITE_CUERPO);
    return new URLSearchParams(texto);
  }
  return url.searchParams;
}

function construirAtributosPosicion(params) {
  const atributos = { id_legado: null };
  const carga = booleano(params.get('charge'));
  if (carga !== null) atributos.charge = carga;
  const simulado = booleano(params.get('mock'));
  if (simulado !== null) atributos.mock = simulado;
  const alarma = params.get('alarm');
  if (alarma !== null && alarma.trim() !== '') {
    atributos.alarm = alarma.trim().slice(0, MAX_ALARMA);
  }
  return atributos;
}

export async function atenderOsmand(req, res, ctx) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return responder(res, 405);
  }
  let params;
  try {
    params = await leerParametros(req);
  } catch {
    return responder(res, 400);
  }
  const identificador = (params.get('id') ?? params.get('deviceid') ?? '').trim();
  if (!identificador) return responder(res, 400);

  const latitud = numero(params.get('lat'));
  const longitud = numero(params.get('lon'));
  const momento = interpretarTimestamp(params.get('timestamp'));
  if (latitud === null || longitud === null || momento === null) {
    return responder(res, 400);
  }

  let dispositivo;
  try {
    dispositivo = await ctx.almacen.buscarDispositivo(identificador);
  } catch (error) {
    ctx.log.error(`osmand: fallo al buscar dispositivo: ${error.message}`);
    return responder(res, 503);
  }
  if (!dispositivo) return responder(res, 404);
  // Equipo deshabilitado: se responde 200 para que la app vacíe su cola, pero
  // no se guarda nada.
  if (dispositivo.habilitado === false) return responder(res, 200);

  // Fecha imposible (reloj del teléfono mal): 200 sin guardar, para que la app
  // no reintente para siempre. El rango aceptado está en db.js.
  if (!fechaCapturaValida(momento)) {
    ctx.log.warn(`osmand: fecha invalida id=${identificador} ts=${momento.toISOString()}`);
    return responder(res, 200);
  }

  const nudos = numero(params.get('speed'));
  const rumbo = numero(params.get('bearing') ?? params.get('heading'));
  const bateria = numero(params.get('batt'));
  const simulado = booleano(params.get('mock'));
  const posicion = {
    protocolo: 'osmand',
    latitud,
    longitud,
    altitud: numero(params.get('altitude')),
    velocidadKmh:
      nudos !== null && nudos >= 0 ? Math.round(nudos * 1.852 * 1000) / 1000 : null,
    rumbo: rumbo !== null && rumbo >= 0 ? rumbo : null,
    precision: numero(params.get('accuracy')),
    bateria:
      bateria !== null ? Math.min(100, Math.max(0, bateria)) : null,
    valida: simulado !== true,
    registradoEn: momento,
    atributos: construirAtributosPosicion(params),
  };

  try {
    const resultado = await ctx.almacen.registrarPosicion(dispositivo.id, posicion);
    // Duplicado o inválido tardío (carrera): 200 igual para drenar el buffer;
    // el servidor ya tiene el dato o lo rechazó por fecha sin polucionar.
    if (resultado?.duplicado) ctx.log.info(`osmand: duplicado id=${identificador}`);
    if (resultado?.invalido) ctx.log.warn(`osmand: fecha invalida al guardar id=${identificador}`);
  } catch (error) {
    ctx.log.error(`osmand: fallo al guardar posicion: ${error.message}`);
    return responder(res, 503);
  }
  return responder(res, 200);
}
