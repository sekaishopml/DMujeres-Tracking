// Direcciones a partir de coordenadas con Nominatim (OpenStreetMap), cortas y
// en español. Guarda en caché (24 h, hasta 5000, en disco) y pide como máximo
// una por segundo, como exige Nominatim. Ninguna función lanza error: si algo
// falla devuelve null.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datosInvalidos } from './errores.js';
import { respuestaJson } from './http.js';

const URL_NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const AGENTE = 'DMujeresTracking/0.1 (contacto interno: soporte@dmujeres.local)';
const TIEMPO_LIMITE_MS = 6000;
const INTERVALO_MINIMO_MS = 1000;
const MAX_REINTENTOS = 2;
const ESPERA_MAXIMA_REINTENTO_MS = 8000;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRADAS = 5000;
// 4 decimales ≈ 11 m: paradas y puntos vecinos comparten resultado.
const DECIMALES_CLAVE = 4;
const MAX_PENDIENTES_PRECALENTADO = 60;

// Umbrales de confianza según la precisión del fix (metros).
export const PRECISION_BUENA_M = 50; // hasta aquí se muestra como dirección exacta
export const PRECISION_POI_M = 30; // hasta aquí se antepone el nombre del lugar
export const PRECISION_SOLO_ZONA_M = 150; // por encima solo se pide barrio (zoom 16)
const DISTANCIA_POI_M = 30;
const DISTANCIA_CALLE_BASE_M = 60;

// Categorías OSM cuyo nombre es reconocible para una persona (comercio,
// institución, edificio). Las calles (highway) nunca cuentan como lugar.
const CATEGORIAS_LUGAR = new Set([
  'amenity', 'shop', 'tourism', 'office', 'leisure', 'healthcare', 'craft', 'historic', 'building', 'man_made',
]);

const cache = new Map();
let cola = Promise.resolve();
let ultimaPeticion = 0;
let pendientes = 0;
let cambiosSinGuardar = false;
let temporizadorGuardado = null;

const RUTA_CACHE =
  process.env.DMJ_GEOCODIGO_CACHE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'geocodigo.json');

function coordenadaValida(valor, minimo, maximo) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < minimo || numero > maximo) return null;
  return numero;
}

function precisionValida(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

// El nivel de detalle pedido es parte de la clave de caché: para la misma
// coordenada, un punto preciso y uno impreciso no comparten respuesta.
export function nivelDePrecision(precisionM) {
  if (precisionM === null) return 'n';
  if (precisionM <= PRECISION_POI_M) return 'a';
  if (precisionM <= PRECISION_BUENA_M) return 'b';
  if (precisionM <= PRECISION_SOLO_ZONA_M) return 'c';
  return 'z';
}

export function claveDeCache(lat, lon, precisionM = null) {
  return `${lat.toFixed(DECIMALES_CLAVE)}/${lon.toFixed(DECIMALES_CLAVE)}/${nivelDePrecision(precisionM)}`;
}

function leerCache(clave) {
  const entrada = cache.get(clave);
  if (!entrada) return undefined;
  if (Date.now() - entrada.guardadoEn > TTL_MS) {
    cache.delete(clave);
    return undefined;
  }
  return entrada.resultado;
}

function guardarCache(clave, resultado) {
  cache.delete(clave);
  cache.set(clave, { resultado, guardadoEn: Date.now() });
  while (cache.size > MAX_ENTRADAS) {
    const masAntigua = cache.keys().next().value;
    if (masAntigua === undefined) break;
    cache.delete(masAntigua);
  }
  programarGuardado();
}

// La caché sobrevive a reinicios del servicio: se escribe en diferido y de
// forma atómica; si el disco falla, se sigue solo en memoria.
function programarGuardado() {
  cambiosSinGuardar = true;
  if (temporizadorGuardado) return;
  temporizadorGuardado = setTimeout(() => {
    temporizadorGuardado = null;
    if (!cambiosSinGuardar) return;
    cambiosSinGuardar = false;
    try {
      fs.mkdirSync(path.dirname(RUTA_CACHE), { recursive: true });
      const temporal = `${RUTA_CACHE}.tmp`;
      fs.writeFileSync(temporal, JSON.stringify([...cache.entries()]));
      fs.renameSync(temporal, RUTA_CACHE);
    } catch {
      /* sin persistencia: no es motivo para fallar */
    }
  }, 5000);
  temporizadorGuardado.unref?.();
}

function cargarCacheDeDisco() {
  try {
    const entradas = JSON.parse(fs.readFileSync(RUTA_CACHE, 'utf8'));
    for (const [clave, entrada] of entradas) {
      if (typeof clave === 'string' && entrada?.resultado?.direccion && Date.now() - entrada.guardadoEn <= TTL_MS) {
        cache.set(clave, entrada);
      }
    }
  } catch {
    /* primera ejecución o archivo dañado: se empieza vacía */
  }
}
cargarCacheDeDisco();

function esperar(ms, signal) {
  return new Promise((resolver) => {
    const completar = () => {
      clearTimeout(temporizador);
      signal?.removeEventListener('abort', completar);
      resolver();
    };
    const temporizador = setTimeout(completar, ms);
    signal?.addEventListener('abort', completar, { once: true });
    if (signal?.aborted) completar();
  });
}

// Serializa el acceso al geocodificador: cada turno espera a que se cumpla el
// segundo desde el inicio de la peticion anterior.
async function esperarTurno(signal) {
  const turno = cola.then(async () => {
    const espera = INTERVALO_MINIMO_MS - (Date.now() - ultimaPeticion);
    if (espera > 0) await esperar(espera, signal);
    ultimaPeticion = Date.now();
  });
  cola = turno.then(
    () => {},
    () => {},
  );
  return turno;
}

async function consultarNominatim(lat, lon, zoom, signal) {
  for (let intento = 0; intento <= MAX_REINTENTOS; intento += 1) {
    if (intento > 0) await esperarTurno(signal);
    if (signal?.aborted) return null;
    const controlador = new AbortController();
    const porTiempo = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);
    const porSenal = () => controlador.abort();
    signal?.addEventListener('abort', porSenal, { once: true });
    let espera = 0;
    try {
      const parametros = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lon),
        zoom: String(zoom),
        addressdetails: '1',
        'accept-language': 'es',
      });
      const respuesta = await fetch(`${URL_NOMINATIM}?${parametros.toString()}`, {
        headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
        signal: controlador.signal,
      });
      if (respuesta.ok) return await respuesta.json();
      // 429 (límite) y 5xx son transitorios: se espera y se reintenta.
      if (respuesta.status !== 429 && respuesta.status < 500) return null;
      const indicada = Number(respuesta.headers.get('retry-after'));
      espera = Number.isFinite(indicada) && indicada > 0 ? indicada * 1000 : 2000 * (intento + 1);
    } catch {
      espera = 1000;
    } finally {
      clearTimeout(porTiempo);
      signal?.removeEventListener('abort', porSenal);
    }
    if (intento < MAX_REINTENTOS) await esperar(Math.min(espera, ESPERA_MAXIMA_REINTENTO_MS), signal);
  }
  return null;
}

function primeroConValor(address, claves) {
  if (!address || typeof address !== 'object') return '';
  for (const clave of claves) {
    const valor = address[clave];
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
  }
  return '';
}

function normalizar(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Quita repeticiones ("Barrio Cuba" / "Cuba"): se queda con la primera que
// aparezca y descarta las que ya contiene o que la contienen.
function sinRepetidos(partes) {
  const resultado = [];
  for (const parte of partes) {
    if (!parte) continue;
    const n = normalizar(parte);
    if (resultado.some((previa) => normalizar(previa).includes(n) || n.includes(normalizar(previa)))) continue;
    resultado.push(parte);
  }
  return resultado;
}

const RADIO_TIERRA_M = 6371000;
const aRadianes = (grados) => (grados * Math.PI) / 180;

export function distanciaM(lat1, lon1, lat2, lon2) {
  const h =
    Math.sin(aRadianes(lat2 - lat1) / 2) ** 2 +
    Math.cos(aRadianes(lat1)) * Math.cos(aRadianes(lat2)) * Math.sin(aRadianes(lon2 - lon1) / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h));
}

// Distancia del punto al resultado de Nominatim. Las calles vienen con una
// caja y su centro puede quedar lejos aunque el punto esté encima, por eso se
// mide contra la caja.
export function distanciaAlResultado(lat, lon, datos) {
  const caja = Array.isArray(datos?.boundingbox) ? datos.boundingbox.map(Number) : null;
  if (caja && caja.length === 4 && caja.every(Number.isFinite)) {
    const [sur, norte, oeste, este] = caja;
    const latCercana = Math.min(Math.max(lat, sur), norte);
    const lonCercana = Math.min(Math.max(lon, oeste), este);
    return distanciaM(lat, lon, latCercana, lonCercana);
  }
  const latR = Number(datos?.lat);
  const lonR = Number(datos?.lon);
  if (Number.isFinite(latR) && Number.isFinite(lonR)) return distanciaM(lat, lon, latR, lonR);
  return null;
}

// Arma una dirección legible sin afirmar más de lo que se sabe:
//  - con mala precisión o resultado lejano no se da calle ni número, solo
//    "Cerca de barrio, ciudad";
//  - el nombre de un lugar solo se antepone si el punto es bueno y está a
//    pocos metros;
//  - sin provincia ni país, y sin nombres repetidos.
// Devuelve { direccion, aproximada, distanciaM } o null.
export function resolverDatos(datos, lat, lon, precisionM = null) {
  const address = datos?.address;
  if (!address || typeof address !== 'object') {
    const display = typeof datos?.display_name === 'string' ? datos.display_name.trim() : '';
    return display !== '' ? { direccion: display, aproximada: true, distanciaM: null } : null;
  }
  const distancia = Number.isFinite(lat) && Number.isFinite(lon) ? distanciaAlResultado(lat, lon, datos) : null;
  const precisionMala = precisionM !== null && precisionM > PRECISION_BUENA_M;
  const limiteCalle = DISTANCIA_CALLE_BASE_M + Math.min(precisionM ?? 0, 200);
  const resultadoLejano = distancia !== null && distancia > limiteCalle;
  const puedeNombrarCalle = !precisionMala && !resultadoLejano;

  const via = puedeNombrarCalle ? primeroConValor(address, ['road', 'pedestrian', 'footway', 'path', 'cycleway']) : '';
  const numero = via ? primeroConValor(address, ['house_number']) : '';
  const nombre = typeof datos?.name === 'string' ? datos.name.trim() : '';
  const esLugar =
    nombre !== '' &&
    CATEGORIAS_LUGAR.has(datos?.category) &&
    precisionM !== null &&
    precisionM <= PRECISION_POI_M &&
    distancia !== null &&
    distancia <= DISTANCIA_POI_M;
  // Sin nombre de calle, Nominatim pone en 'suburb' cosas como "Terminal
  // Portuario": se muestra como zona, nunca como si fuera la calle.
  const zonas = sinRepetidos([
    primeroConValor(address, ['neighbourhood']),
    primeroConValor(address, ['quarter']),
    primeroConValor(address, ['suburb']),
    primeroConValor(address, ['residential']),
  ]).slice(0, 2);
  const ciudad = primeroConValor(address, ['city', 'town', 'village', 'municipality', 'county']);

  const calle = via ? (numero ? `${via} ${numero}` : via) : '';
  // La ciudad se compara solo por igualdad: "Terminal Portuario Guayaquil"
  // contiene "Guayaquil" y aun así la ciudad debe aparecer.
  const partes = sinRepetidos([esLugar ? nombre : '', calle, ...zonas]);
  if (ciudad && !partes.some((parte) => normalizar(parte) === normalizar(ciudad))) partes.push(ciudad);
  if (partes.length === 0) {
    const display = typeof datos?.display_name === 'string' ? datos.display_name.trim() : '';
    return display !== '' ? { direccion: display, aproximada: true, distanciaM: distancia } : null;
  }
  const aproximada = !(esLugar || via) || precisionMala || resultadoLejano;
  const texto = partes.join(', ');
  return { direccion: aproximada ? `Cerca de ${texto}` : texto, aproximada, distanciaM: distancia };
}

// Devuelve { direccion, aproximada, distanciaM } o null. Los aciertos se
// guardan en caché; los fallos no, para reintentar cuando vuelva la red.
export async function resolverDireccion(lat, lon, opciones = {}) {
  try {
    const latitud = coordenadaValida(lat, -90, 90);
    const longitud = coordenadaValida(lon, -180, 180);
    if (latitud === null || longitud === null) return null;
    const precisionM = precisionValida(opciones.precisionM);
    const clave = claveDeCache(latitud, longitud, precisionM);
    const cacheada = leerCache(clave);
    if (cacheada !== undefined) return cacheada;
    const { signal } = opciones;
    if (signal?.aborted) return null;
    await esperarTurno(signal);
    if (signal?.aborted) return null;
    const zoom = precisionM !== null && precisionM > PRECISION_SOLO_ZONA_M ? 16 : 18;
    const resultado = resolverDatos(await consultarNominatim(latitud, longitud, zoom, signal), latitud, longitud, precisionM);
    if (resultado) guardarCache(clave, resultado);
    return resultado;
  } catch {
    return null;
  }
}

// Solo consulta la caché, sin llamar a Nominatim. La usa el listado de
// paradas para responder rápido.
export function resolucionEnCache(lat, lon, precisionM = null) {
  try {
    const latitud = coordenadaValida(lat, -90, 90);
    const longitud = coordenadaValida(lon, -180, 180);
    if (latitud === null || longitud === null) return null;
    return leerCache(claveDeCache(latitud, longitud, precisionValida(precisionM))) ?? null;
  } catch {
    return null;
  }
}

// Busca en segundo plano las direcciones que faltan (una por segundo) para
// que la próxima consulta ya las tenga. La cola tiene tope.
export function precalentar(lat, lon, precisionM = null) {
  if (resolucionEnCache(lat, lon, precisionM) || pendientes >= MAX_PENDIENTES_PRECALENTADO) return;
  pendientes += 1;
  resolverDireccion(lat, lon, { precisionM }).finally(() => {
    pendientes -= 1;
  });
}

function leerCoordenada(valor, minimo, maximo, nombre) {
  const texto = valor === null ? '' : String(valor).trim();
  if (texto === '') throw datosInvalidos(`Falta el parámetro ${nombre}.`);
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < minimo || numero > maximo) {
    throw datosInvalidos(`El parámetro ${nombre} debe ser un número entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

export async function obtenerDireccion(ctx) {
  const lat = leerCoordenada(ctx.url.searchParams.get('lat'), -90, 90, 'lat');
  const lon = leerCoordenada(ctx.url.searchParams.get('lon'), -180, 180, 'lon');
  const texto = ctx.url.searchParams.get('precision');
  const precisionM = texto === null || texto.trim() === '' ? null : precisionValida(texto);
  const resultado = await resolverDireccion(lat, lon, { signal: ctx.signal, precisionM });
  respuestaJson(ctx.res, 200, {
    direccion: resultado?.direccion ?? null,
    direccionAproximada: resultado ? resultado.aproximada : null,
    precisionM,
  });
}
