// Geocercas: polígonos dibujados en el mapa del panel, con historial de quién
// las creó y editó, y detección de llegadas y salidas de un equipo.
//   GET   /api/v1/geocercas                 activas (?todas=1 incluye las dadas de baja)
//   POST  /api/v1/geocercas                 {nombre, tipo, puntos, quien}
//   PATCH /api/v1/geocercas/:id             {nombre?, tipo?, puntos?, activo?, quien}
//   GET   /api/v1/geocercas/:id/historial
//   GET   /api/v1/geocercas/visitas         ?dispositivoId&desde&hasta

import { consultar } from './db.js';
import { datosInvalidos, noEncontrado } from './errores.js';
import { leerCuerpoJson, leerRango, respuestaJson } from './http.js';
import { buscarDispositivo } from './flota.js';
import { auditar } from './sesiones.js';
import { exigirOperativo } from './permisos.js';

export const TIPOS_GEOCERCA = ['casa', 'cliente', 'oficina', 'cc', 'pdv', 'na'];

// Criterio de visita. Los puntos con precisión peor que PRECISION_MAX_M o
// inválidos se descartan. Un tramo seguido adentro (o afuera) solo cuenta si
// tiene MIN_PUNTOS puntos y dura al menos MIN_PERMANENCIA_S (adentro: una
// visita tiene que quedarse; un vehículo que pasa rozando el borde deja 3
// puntos en 30 s y no es visita).
export const PRECISION_MAX_M = 60;
export const MIN_PUNTOS = 3;
export const MIN_PERMANENCIA_S = 90;
// Una llegada o una salida solo se cuenta si se vio el paso: el último punto
// de un lado y el primero del otro están a 150 m como mucho. Si el teléfono
// volvió a dar señal lejos, no se sabe cuándo cruzó: N/A. El tiempo de corte
// va hasta 30 min, porque sin señal en la casa el equipo tarda en volver.
const CONTINUIDAD_MS = 30 * 60_000;
const CONTINUIDAD_M = 150;
// Una casa mide menos que el error del GPS: quieta adentro, los puntos caen
// unos metros afuera y volvían a entrar, y cada salto contaba como salida y
// llegada. Por eso está adentro hasta MARGEN_LLEGADA_M del borde y solo sale
// al pasar MARGEN_SALIDA_M.
// Solo en casas: en un local o edificio grande el margen contaba como visita
// al que se estacionaba en la calle del frente (Unidad Judicial del Sur).
export const MARGEN_LLEGADA_M = 15;
export const MARGEN_SALIDA_M = 40;
const MAX_POSICIONES = 50000;
const MARGEN_FIJADO_MS = 24 * 60 * 60 * 1000;

// Punto en polígono por trazado de rayo. `poligono` es [[lon, lat], ...].
export function puntoEnPoligono(lon, lat, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// puntos: [{ registradoEn, latitud, longitud, precisionM, valida }] en orden de tiempo.
// Devuelve [{ llegada, salida|null, duracionMin|null }] (ISO). Si el rango
// empieza adentro, la llegada es el primer punto; si termina adentro, salida null.
// Metros de un punto al borde del polígono (0 si está adentro).
export function metrosAlPoligono(lon, lat, poligono) {
  if (puntoEnPoligono(lon, lat, poligono)) return 0;
  const k = 111320;
  const c = Math.cos((lat * Math.PI) / 180);
  let menor = Infinity;
  for (let i = 0; i < poligono.length; i += 1) {
    const a = poligono[i];
    const b = poligono[(i + 1) % poligono.length];
    const ax = (a[0] - lon) * k * c;
    const ay = (a[1] - lat) * k;
    const dx = (b[0] - a[0]) * k * c;
    const dy = (b[1] - a[1]) * k;
    const largo = dx * dx + dy * dy;
    const f = largo === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / largo));
    menor = Math.min(menor, Math.hypot(ax + f * dx, ay + f * dy));
  }
  return menor;
}

export function calcularVisitas(puntos, poligono, margenLlegada = MARGEN_LLEGADA_M) {
  const usables = puntos.filter(
    (p) => p.valida !== false && (p.precisionM == null || p.precisionM <= PRECISION_MAX_M),
  );
  const tramos = [];
  let dentro = null;
  for (const p of usables) {
    const t = new Date(p.registradoEn).getTime();
    const pt = { t, lat: Number(p.latitud), lon: Number(p.longitud) };
    const metros = metrosAlPoligono(pt.lon, pt.lat, poligono);
    if (metros <= margenLlegada) dentro = true;
    else if (metros > MARGEN_SALIDA_M) dentro = false;
    // Entre los dos márgenes sigue como estaba; sin dato previo, cuenta por cercanía.
    else if (dentro === null) dentro = margenLlegada > 0;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.dentro === dentro) {
      ultimo.n += 1;
      ultimo.fin = t;
      ultimo.pFin = pt;
    } else {
      tramos.push({ dentro, n: 1, ini: t, fin: t, pIni: pt, pFin: pt });
    }
  }
  const firmes = [];
  for (let i = 0; i < tramos.length; i += 1) {
    const tr = tramos[i];
    // Una visita (adentro) necesita quedarse. Una salida con vuelta también:
    // el GPS, al recuperarse de una mala lectura, da varios puntos afuera en
    // pocos segundos. La última del día basta con que se vea, porque ya no vuelve.
    // Lo mismo al llegar: si es lo último que se ve (llegó y cerró la
    // jornada), ya no sale y basta con que se vea.
    const duracion = (tr.fin - tr.ini) / 1000;
    // "Lo último" es lo último antes de dejar de verse más de 30 min (fin de
    // la jornada de ese día), no solo lo último del rango pedido: si no, al
    // pedir la semana solo contaba el último día.
    const siguiente = tramos[i + 1];
    const ultimo = !siguiente || siguiente.ini - tr.fin > CONTINUIDAD_MS;
    const quedo = tr.n >= MIN_PUNTOS && (duracion >= MIN_PERMANENCIA_S || ultimo);
    const salio = duracion >= MIN_PERMANENCIA_S || (ultimo && tr.n >= MIN_PUNTOS);
    if (!(tr.dentro ? quedo : salio)) continue;
    const previo = firmes[firmes.length - 1];
    if (previo && previo.dentro === tr.dentro) {
      previo.fin = tr.fin;
      previo.pFin = tr.pFin;
    } else {
      firmes.push({ ...tr });
    }
  }
  const continuo = (a, b) => b.t - a.t <= CONTINUIDAD_MS && metrosEntre(a, b) <= CONTINUIDAD_M;
  const visitas = [];
  firmes.forEach((tr, i) => {
    if (!tr.dentro) return;
    const previo = firmes[i - 1];
    const sig = firmes[i + 1];
    const llegada = previo && !previo.dentro && continuo(previo.pFin, tr.pIni) ? tr.ini : null;
    const salida = sig && continuo(tr.pFin, sig.pIni) ? sig.ini : null;
    visitas.push({
      llegada: llegada === null ? null : new Date(llegada).toISOString(),
      salida: salida === null ? null : new Date(salida).toISOString(),
      duracionMin: llegada === null || salida === null ? null : Math.round((salida - llegada) / 6000) / 10,
    });
  });
  return visitas;
}

function metrosEntre(a, b) {
  const medioLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos(medioLat));
}

export function resumirVisitas(geocerca, visitas) {
  return {
    geocercaId: geocerca.id,
    nombre: geocerca.nombre,
    tipo: geocerca.tipo,
    llegadas: visitas.filter((v) => v.llegada).map((v) => v.llegada).reverse(),
    salidas: visitas.filter((v) => v.salida).map((v) => v.salida),
    visitas,
  };
}

function aGeocerca(f) {
  return {
    id: Number(f.id),
    nombre: f.nombre,
    tipo: f.tipo,
    puntos: f.puntos,
    centro: { lat: Number(f.centro_lat), lon: Number(f.centro_lon) },
    activo: f.activo === true,
    creadoPor: f.creado_por,
    creadoEn: new Date(f.creado_en).toISOString(),
    editadoPor: f.editado_por ?? null,
    actualizadoEn: new Date(f.actualizado_en).toISOString(),
  };
}

function nombreValido(valor) {
  const nombre = typeof valor === 'string' ? valor.trim() : '';
  if (!nombre) throw datosInvalidos('La geocerca necesita un nombre.');
  if (nombre.length > 120) throw datosInvalidos('El nombre de la geocerca admite hasta 120 caracteres.');
  return nombre;
}

function tipoValido(valor) {
  if (!TIPOS_GEOCERCA.includes(valor)) {
    throw datosInvalidos('El tipo debe ser casa, cliente, oficina, cc (centro comercial), pdv (punto de venta) o na.');
  }
  return valor;
}

function quienValido(valor) {
  const quien = typeof valor === 'string' ? valor.trim() : '';
  if (!quien) throw datosInvalidos('Indique quién edita la geocerca.');
  if (quien.length > 80) throw datosInvalidos('El nombre de quien edita admite hasta 80 caracteres.');
  return quien;
}

export function puntosValidos(valor) {
  if (!Array.isArray(valor) || valor.length < 3 || valor.length > 200) {
    throw datosInvalidos('La geocerca necesita entre 3 y 200 puntos.');
  }
  const puntos = valor.map((p) => {
    const ok =
      Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
    if (!ok || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) {
      throw datosInvalidos('Cada punto debe ser [longitud, latitud] con valores válidos.');
    }
    return [p[0], p[1]];
  });
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  // Si llega cerrado, se quita el punto repetido.
  if (puntos.length > 3 && primero[0] === ultimo[0] && primero[1] === ultimo[1]) puntos.pop();
  return puntos;
}

// Centro del recuadro que contiene al polígono.
function centroDe(puntos) {
  const lons = puntos.map((p) => p[0]);
  const lats = puntos.map((p) => p[1]);
  return { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
}

async function registrar(ctx, cliente, geocercaId, accion, quien, cambios) {
  await cliente.query(
    `INSERT INTO operations.dmt_geocerca_historial (geocerca_id, accion, quien, usuario_id, cambios)
     VALUES ($1, $2, $3, $4, $5)`,
    [geocercaId, accion, quien, ctx.usuario?.id ?? null, JSON.stringify(cambios)],
  );
}

export async function listarGeocercas(ctx) {
  const todas = ctx.url.searchParams.get('todas') === '1';
  const { rows } = await consultar(
    ctx.pool,
    `SELECT * FROM operations.dmt_geocerca ${todas ? '' : 'WHERE activo'} ORDER BY lower(nombre), id`,
    [],
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, { datos: rows.map(aGeocerca) });
}

export async function crearGeocerca(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 64 * 1024);
  const nombre = nombreValido(cuerpo.nombre);
  const tipo = tipoValido(cuerpo.tipo);
  const quien = quienValido(cuerpo.quien);
  const puntos = puntosValidos(cuerpo.puntos);
  const centro = centroDe(puntos);
  const cliente = await ctx.pool.connect();
  let fila;
  try {
    await cliente.query('BEGIN');
    ({ rows: [fila] } = await cliente.query(
      `INSERT INTO operations.dmt_geocerca (nombre, tipo, puntos, centro_lat, centro_lon, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre, tipo, JSON.stringify(puntos), centro.lat, centro.lon, quien],
    ));
    await registrar(ctx, cliente, fila.id, 'crear', quien, { despues: { nombre, tipo, puntos } });
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'crear_geocerca',
    entidad: 'geocerca',
    entidadId: Number(fila.id),
    descripcion: `Geocerca ${nombre} creada por ${quien}.`,
    req: ctx.req,
  });
  respuestaJson(ctx.res, 201, { geocerca: aGeocerca(fila) });
}

export async function actualizarGeocerca(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 64 * 1024);
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id)) throw noEncontrado('La geocerca no existe.');
  const quien = quienValido(cuerpo.quien);
  const nuevo = {};
  if (cuerpo.nombre !== undefined) nuevo.nombre = nombreValido(cuerpo.nombre);
  if (cuerpo.tipo !== undefined) nuevo.tipo = tipoValido(cuerpo.tipo);
  if (cuerpo.puntos !== undefined) nuevo.puntos = puntosValidos(cuerpo.puntos);
  if (cuerpo.activo !== undefined) {
    if (typeof cuerpo.activo !== 'boolean') throw datosInvalidos('El campo activo debe ser verdadero o falso.');
    nuevo.activo = cuerpo.activo;
  }
  if (Object.keys(nuevo).length === 0) throw datosInvalidos('No hay nada que cambiar.');

  const cliente = await ctx.pool.connect();
  let fila;
  let accion;
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query('SELECT * FROM operations.dmt_geocerca WHERE id = $1 FOR UPDATE', [id]);
    const actual = rows[0];
    if (!actual) throw noEncontrado('La geocerca no existe.');
    const antes = {};
    const despues = {};
    for (const [campo, valor] of Object.entries(nuevo)) {
      if (JSON.stringify(actual[campo]) !== JSON.stringify(valor)) {
        antes[campo] = actual[campo];
        despues[campo] = valor;
      }
    }
    if (Object.keys(despues).length === 0) throw datosInvalidos('No hay nada que cambiar.');
    // Dar de baja o restaurar se anota aparte; si además cambia otra cosa, es una edición.
    const soloActivo = Object.keys(despues).length === 1 && 'activo' in despues;
    accion = soloActivo ? (despues.activo ? 'restaurar' : 'eliminar') : 'editar';
    const final = { ...actual, ...despues };
    const centro = despues.puntos ? centroDe(despues.puntos) : { lat: actual.centro_lat, lon: actual.centro_lon };
    ({ rows: [fila] } = await cliente.query(
      `UPDATE operations.dmt_geocerca
          SET nombre = $2, tipo = $3, puntos = $4, activo = $5, centro_lat = $6, centro_lon = $7,
              editado_por = $8, actualizado_en = now()
        WHERE id = $1 RETURNING *`,
      [id, final.nombre, final.tipo, JSON.stringify(final.puntos), final.activo, centro.lat, centro.lon, quien],
    ));
    await registrar(ctx, cliente, id, accion, quien, { antes, despues });
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: `${accion}_geocerca`,
    entidad: 'geocerca',
    entidadId: id,
    descripcion: `Geocerca ${fila.nombre}: ${accion} por ${quien}.`,
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { geocerca: aGeocerca(fila) });
}

export async function historialGeocerca(ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id)) throw noEncontrado('La geocerca no existe.');
  const { rows: existe } = await consultar(ctx.pool, 'SELECT 1 FROM operations.dmt_geocerca WHERE id = $1', [id], {
    signal: ctx.signal,
  });
  if (!existe[0]) throw noEncontrado('La geocerca no existe.');
  const { rows } = await consultar(
    ctx.pool,
    `SELECT h.id, h.accion, h.quien, u.nombre AS usuario, h.ocurrido_en, h.cambios
       FROM operations.dmt_geocerca_historial h
       LEFT JOIN iam.dmt_usuario u ON u.id = h.usuario_id
      WHERE h.geocerca_id = $1
      ORDER BY h.ocurrido_en DESC, h.id DESC`,
    [id],
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map((f) => ({
      id: Number(f.id),
      accion: f.accion,
      quien: f.quien,
      usuario: f.usuario ?? null,
      ocurridoEn: new Date(f.ocurrido_en).toISOString(),
      cambios: f.cambios,
    })),
  });
}

export async function visitasGeocercas(ctx) {
  const valor = ctx.url.searchParams.get('dispositivoId');
  if (!valor) throw datosInvalidos('Falta el parámetro dispositivoId.');
  const dispositivo = await buscarDispositivo(ctx.pool, ctx.usuario, valor, ctx.signal, {
    incluirDeshabilitado: true,
  });
  if (!dispositivo) throw noEncontrado('El dispositivo no existe o no está visible para la cuenta.');
  const rango = leerRango(ctx.url, { porDefecto: 'hoy', maxDias: 31, zonaHoraria: ctx.entorno.zonaHoraria });
  const { rows: geocercas } = await consultar(
    ctx.pool,
    'SELECT * FROM operations.dmt_geocerca WHERE activo ORDER BY lower(nombre), id',
    [],
    { signal: ctx.signal },
  );
  if (geocercas.length === 0) return respuestaJson(ctx.res, 200, { datos: [] });
  const { rows } = await consultar(
    ctx.pool,
    `SELECT p.latitud, p.longitud, p.precision_m, p.valida,
            coalesce(p.fijado_en, p.registrado_en) AS registrado_en
       FROM tracking.dmt_posicion p
      WHERE p.dispositivo_id = $1
        AND p.registrado_en >= $4 AND p.registrado_en < $5
        AND coalesce(p.fijado_en, p.registrado_en) >= $2
        AND coalesce(p.fijado_en, p.registrado_en) < $3
      ORDER BY coalesce(p.fijado_en, p.registrado_en)
      LIMIT ${MAX_POSICIONES + 1}`,
    [
      Number(dispositivo.id),
      rango.desde,
      rango.hasta,
      new Date(rango.desde.getTime() - MARGEN_FIJADO_MS),
      new Date(rango.hasta.getTime() + MARGEN_FIJADO_MS),
    ],
    { signal: ctx.signal, timeoutMs: 20000 },
  );
  if (rows.length > MAX_POSICIONES) throw datosInvalidos('El rango tiene demasiadas posiciones; reduzca el rango.');
  const puntos = rows.map((f) => ({
    registradoEn: f.registrado_en,
    latitud: Number(f.latitud),
    longitud: Number(f.longitud),
    precisionM: f.precision_m === null ? null : Number(f.precision_m),
    valida: f.valida,
  }));
  const datos = [];
  for (const g of geocercas) {
    const visitas = calcularVisitas(puntos, g.puntos, g.tipo === 'casa' ? MARGEN_LLEGADA_M : 0);
    if (visitas.length > 0) datos.push(resumirVisitas(aGeocerca(g), visitas));
  }
  respuestaJson(ctx.res, 200, { datos });
}
