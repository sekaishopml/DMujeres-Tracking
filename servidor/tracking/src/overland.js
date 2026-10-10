// Receptor de Overland (iPhone): POST /overland?id=<equipo> con un lote de
// puntos en GeoJSON ({ locations: [...] }). La app guarda los puntos en el
// teléfono y solo los borra cuando recibe {"result":"ok"}; con cualquier otra
// respuesta reintenta el mismo lote, así que nada se pierde sin conexión.
// El equipo se identifica con `?id=` en la URL o con el device_id de la app.

const LIMITE_CUERPO = 2 * 1024 * 1024;
const MAX_PUNTOS = 1000;
// Un lote repetido trae las mismas horas: con esta marca la base lo descarta.
const ORIGEN = 'overland';

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

function numero(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

// Overland manda -1 cuando no conoce un dato (velocidad, rumbo, precisión).
function noNegativo(valor) {
  const n = numero(valor);
  return n !== null && n >= 0 ? n : null;
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

// Pasa un punto de Overland a la forma que guarda la base; null si no sirve.
export function posicionDeOverland(punto) {
  const coordenadas = punto?.geometry?.coordinates;
  const datos = punto?.properties;
  if (!Array.isArray(coordenadas) || typeof datos !== 'object' || datos === null) return null;
  const longitud = numero(coordenadas[0]);
  const latitud = numero(coordenadas[1]);
  const momento = new Date(datos.timestamp);
  if (latitud === null || longitud === null || Math.abs(latitud) > 90 || Math.abs(longitud) > 180) return null;
  if (typeof datos.timestamp !== 'string' || Number.isNaN(momento.getTime())) return null;

  const velocidad = noNegativo(datos.speed);
  const bateria = noNegativo(datos.battery_level);
  const atributos = {};
  if (datos.battery_state === 'charging' || datos.battery_state === 'full') atributos.charging = true;
  else if (datos.battery_state === 'unplugged') atributos.charging = false;
  if (Array.isArray(datos.motion) && typeof datos.motion[0] === 'string') {
    atributos.movementState = datos.motion[0].slice(0, 32);
  }
  return {
    protocolo: ORIGEN,
    latitud,
    longitud,
    altitud: numero(datos.altitude),
    // Overland da la velocidad en m/s y la batería de 0 a 1.
    velocidadKmh: velocidad === null ? null : Math.round(velocidad * 36) / 10,
    rumbo: noNegativo(datos.course),
    precision: noNegativo(datos.horizontal_accuracy),
    bateria: bateria === null ? null : Math.round(Math.min(1, bateria) * 100),
    valida: true,
    registradoEn: momento,
    bootId: ORIGEN,
    secuencia: 0,
    atributos,
  };
}

export async function atenderOverland(req, res, ctx) {
  if (req.method !== 'POST') return responder(res, 405, { error: 'metodo' });
  let cuerpo;
  try {
    cuerpo = await leerJson(req);
  } catch {
    return responder(res, 400, { error: 'cuerpo' });
  }
  const puntos = Array.isArray(cuerpo?.locations) ? cuerpo.locations : null;
  if (puntos === null || puntos.length > MAX_PUNTOS) return responder(res, 400, { error: 'lote' });

  const identificador = String(
    ctx.url.searchParams.get('id') ?? puntos[0]?.properties?.device_id ?? '',
  ).trim();
  if (!identificador) return responder(res, 400, { error: 'equipo' });

  let dispositivo;
  try {
    dispositivo = await ctx.almacen.buscarDispositivo(identificador);
  } catch (error) {
    ctx.log.error(`overland: fallo al buscar dispositivo: ${error.message}`);
    return responder(res, 503, { error: 'servidor' });
  }
  if (!dispositivo) return responder(res, 404, { error: 'equipo' });

  // Equipo deshabilitado o puntos que no sirven: se responde ok para que la
  // app vacíe su cola en vez de reintentar para siempre.
  const posiciones = dispositivo.habilitado === false ? [] : puntos.map(posicionDeOverland).filter(Boolean);
  try {
    if (posiciones.length > 0) await ctx.almacen.registrarLotePosiciones(dispositivo.id, posiciones);
  } catch (error) {
    ctx.log.error(`overland: fallo al guardar lote: ${error.message}`);
    return responder(res, 503, { error: 'servidor' });
  }
  return responder(res, 200, { result: 'ok' });
}
