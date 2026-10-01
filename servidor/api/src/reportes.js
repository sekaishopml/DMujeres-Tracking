// Reportes: viajes, paradas y resumen del rango. Los tramos se calculan desde
// las posiciones con segmentos.js.

import { consultar } from './db.js';
import { datosInvalidos } from './errores.js';
import { iso } from './dto.js';
import { precalentar, resolucionEnCache } from './geocodigo.js';
import { leerOrden, leerPaginacion, leerRango, respuestaJson } from './http.js';
import { permisoDe } from './flota.js';
import { LAT_MAX_OP, LAT_MIN_OP, LON_MAX_OP, LON_MIN_OP, ORDEN_VIAJES, sqlSegmentos } from './segmentos.js';
import { detectarParadas } from './paradas.js';

const DURACION_MAXIMA_DIAS = 92;

function redondear(valor, decimales) {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return null;
  const factor = 10 ** decimales;
  return Math.round(Number(valor) * factor) / factor;
}

function aViaje(fila) {
  const segundos = Number(fila.segundos);
  const km = Number(fila.km);
  return {
    id: Number(fila.id),
    dispositivoId: Number(fila.dispositivo_id),
    idPublico: fila.id_publico,
    inicio: iso(fila.inicio),
    fin: iso(fila.fin),
    duracionMin: redondear(segundos / 60, 1),
    distanciaKm: redondear(km, 3),
    velocidadPromedioKmh: segundos > 0 ? redondear((km / segundos) * 3600, 1) : null,
    velocidadMaximaKmh: Number(fila.velocidad_maxima) > 0 ? redondear(fila.velocidad_maxima, 1) : null,
    origen: { latitud: Number(fila.lat_inicio), longitud: Number(fila.lon_inicio) },
    destino: { latitud: Number(fila.lat_fin), longitud: Number(fila.lon_fin) },
    paradas: Number(fila.paradas),
  };
}

function aParada(fila) {
  const latitud = Number(fila.lat_inicio);
  const longitud = Number(fila.lon_inicio);
  // La dirección se busca para el punto representativo (mediana de los
  // puntos buenos), no para el primero, que puede ser de antenas y estar lejos.
  const latRep = fila.lat_rep === null || fila.lat_rep === undefined ? latitud : Number(fila.lat_rep);
  const lonRep = fila.lon_rep === null || fila.lon_rep === undefined ? longitud : Number(fila.lon_rep);
  const precisionM = fila.precision_rep === null || fila.precision_rep === undefined ? null : redondear(fila.precision_rep, 1);
  const resolucion = resolucionEnCache(latRep, lonRep, precisionM);
  if (!resolucion) precalentar(latRep, lonRep, precisionM);
  return {
    id: Number(fila.id),
    dispositivoId: Number(fila.dispositivo_id),
    idPublico: fila.id_publico,
    inicio: iso(fila.inicio),
    fin: iso(fila.fin),
    duracionMin: redondear(Number(fila.segundos) / 60, 1),
    latitud,
    longitud,
    direccion: resolucion?.direccion ?? null,
    direccionAproximada: resolucion ? resolucion.aproximada : null,
    latitudRepresentativa: latRep,
    longitudRepresentativa: lonRep,
    precisionM,
    // Fusión inteligente: cuántos fragmentos del mismo sitio se unieron y
    // la clave del lugar (visitas repetidas comparten lugar).
    fragmentos: Number(fila.fragmentos ?? 1),
    lugar: fila.lugar ?? null,
  };
}

// dispositivoId puede venir como id público, id anterior o id interno; el SQL
// filtra por el id numérico. Si no coincide nada se usa -1 para no devolver
// filas.
async function resolverDispositivoId(ctx) {
  const valor = ctx.url.searchParams.get('dispositivoId');
  if (!valor) return null;
  const { rows } = await consultar(
    ctx.pool,
    `SELECT d.id FROM tracking.dmt_dispositivo d
     WHERE d.id_publico::text = $1 OR d.id_legado::text = $1 OR d.id::text = $1
     LIMIT 1`,
    [String(valor)],
    { signal: ctx.signal },
  );
  return rows[0] ? Number(rows[0].id) : -1;
}

function parametrosSegmentos(ctx, { pagina, tamano, desplazamiento, dispositivoId }) {
  const rango = leerRango(ctx.url, {
    porDefecto: 'hoy',
    maxDias: DURACION_MAXIMA_DIAS,
    zonaHoraria: ctx.entorno.zonaHoraria,
  });
  const valores = [permisoDe(ctx.usuario), rango.desde, rango.hasta, dispositivoId];
  if (pagina !== undefined) valores.push(tamano, desplazamiento);
  return { valores, rango };
}

export async function listarViajes(ctx) {
  const { pagina, tamano, desplazamiento } = leerPaginacion(ctx.url);
  const orden = leerOrden(ctx.url, ORDEN_VIAJES, 'v.inicio DESC');
  const { valores } = parametrosSegmentos(ctx, {
    pagina,
    tamano,
    desplazamiento,
    dispositivoId: await resolverDispositivoId(ctx),
  });
  const { rows } = await consultar(
    ctx.pool,
    `WITH tramos AS (${sqlSegmentos()}),
     viajes AS (SELECT * FROM tramos WHERE tipo = 'viaje'),
     paradas AS (SELECT * FROM tramos WHERE tipo = 'parada')
     SELECT v.*, count(*) OVER() AS total_filas
     FROM (
       -- Subconsulta: así "paradas" existe como columna de v y se puede
       -- ordenar por ella (?orden=paradas daba 500).
       SELECT v0.*,
              (SELECT count(*) FROM paradas s
               WHERE s.dispositivo_id = v0.dispositivo_id
                 AND s.inicio > v0.inicio AND s.fin < v0.fin) AS paradas
       FROM viajes v0
     ) v
     ORDER BY ${orden.sql}, v.dispositivo_id
     LIMIT $5 OFFSET $6`,
    valores,
    { signal: ctx.signal, timeoutMs: 20000 },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map(aViaje),
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}

// Paradas por permanencia (paradas.js) sobre los fixes crudos del rango, con
// los mismos filtros de permiso y equipo que los segmentos.
async function paradasDelRango(ctx, dispositivoId) {
  const { valores, rango } = parametrosSegmentos(ctx, { dispositivoId });
  const { rows } = await consultar(
    ctx.pool,
    `SELECT p.id, p.id_publico, p.dispositivo_id, p.registrado_en, p.latitud, p.longitud, p.precision_m
     FROM tracking.dmt_posicion p
     JOIN tracking.dmt_dispositivo d ON d.id = p.dispositivo_id
     WHERE d.habilitado
       AND p.registrado_en >= $2 AND p.registrado_en < $3
       AND p.latitud BETWEEN ${LAT_MIN_OP} AND ${LAT_MAX_OP}
       AND p.longitud BETWEEN ${LON_MIN_OP} AND ${LON_MAX_OP}
       AND ($1::bigint IS NULL OR EXISTS (
             SELECT 1 FROM operations.dmt_asignacion a
             WHERE a.dispositivo_id = d.id AND a.usuario_id = $1 AND a.activa
               AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())))
       AND ($4::bigint IS NULL OR p.dispositivo_id = $4)
     ORDER BY p.dispositivo_id, p.registrado_en`,
    valores,
    { signal: ctx.signal, timeoutMs: 20000 },
  );
  const porEquipo = new Map();
  for (const fila of rows) {
    const id = Number(fila.dispositivo_id);
    if (!porEquipo.has(id)) porEquipo.set(id, []);
    porEquipo.get(id).push({
      id: fila.id,
      idPublico: fila.id_publico,
      registradoEn: fila.registrado_en,
      latitud: Number(fila.latitud),
      longitud: Number(fila.longitud),
      precisionM: fila.precision_m === null ? null : Number(fila.precision_m),
    });
  }
  const filas = [];
  for (const [dispositivoId, puntos] of porEquipo) {
    for (const parada of detectarParadas(puntos)) {
      const primero = puntos.find((pt) => new Date(pt.registradoEn).getTime() === parada.inicio.getTime());
      filas.push({
        id: primero?.id ?? 0,
        id_publico: primero?.idPublico ?? null,
        dispositivo_id: dispositivoId,
        inicio: parada.inicio,
        fin: parada.fin,
        segundos: parada.segundos,
        lat_inicio: parada.latitud,
        lon_inicio: parada.longitud,
        lat_rep: parada.latitud,
        lon_rep: parada.longitud,
        precision_rep: parada.precisionM,
        fragmentos: 1,
      });
    }
  }
  return { filas, rango };
}

const ORDEN_PARADAS_JS = {
  inicio: (f) => f.inicio.getTime(),
  fin: (f) => f.fin.getTime(),
  duracionMin: (f) => f.segundos,
  dispositivoId: (f) => f.dispositivo_id,
};

export async function listarParadas(ctx) {
  const { pagina, tamano, desplazamiento } = leerPaginacion(ctx.url);
  // Mismo contrato que leerOrden: sin orden, inicio descendente; "-campo"
  // descendente y "campo" ascendente.
  const valor = ctx.url.searchParams.get('orden');
  const ascendente = valor != null && !valor.startsWith('-');
  const clave = ORDEN_PARADAS_JS[(valor ?? 'inicio').replace(/^-/, '')];
  if (!clave) throw datosInvalidos(`El campo de orden ${valor} no es válido.`);
  const { filas } = await paradasDelRango(ctx, await resolverDispositivoId(ctx));
  filas.sort((a, b) => (ascendente ? clave(a) - clave(b) : clave(b) - clave(a)) || a.dispositivo_id - b.dispositivo_id);
  respuestaJson(ctx.res, 200, {
    datos: filas.slice(desplazamiento, desplazamiento + tamano).map(aParada),
    total: filas.length,
    pagina,
    tamano,
  });
}

export async function obtenerResumen(ctx) {
  const dispositivoIdResumen = await resolverDispositivoId(ctx);
  const { valores, rango } = parametrosSegmentos(ctx, {
    dispositivoId: dispositivoIdResumen,
  });
  const { rows } = await consultar(
    ctx.pool,
    `WITH tramos AS (${sqlSegmentos()}),
     viajes AS (SELECT * FROM tramos WHERE tipo = 'viaje'),
     paradas AS (SELECT * FROM tramos WHERE tipo = 'parada'),
     por_dispositivo AS (
       SELECT v.dispositivo_id,
              sum(v.km) AS distancia_km,
              sum(v.segundos) AS duracion_s,
              count(*) AS viajes
       FROM viajes v
       GROUP BY v.dispositivo_id
     ),
     -- Las paradas se cuentan aparte: una persona con paradas y sin viajes
     -- salía con 0 paradas.
     paradas_por_dispositivo AS (
       SELECT dispositivo_id, count(*) AS paradas FROM paradas GROUP BY dispositivo_id
     ),
     posiciones AS (
       SELECT p.dispositivo_id, count(*) AS total, max(p.registrado_en) AS ultima
       FROM tracking.dmt_posicion p
       JOIN tracking.dmt_dispositivo d ON d.id = p.dispositivo_id
       WHERE d.habilitado
         AND p.registrado_en >= $2 AND p.registrado_en < $3
         AND ($1::bigint IS NULL OR EXISTS (
               SELECT 1 FROM operations.dmt_asignacion a
               WHERE a.dispositivo_id = d.id AND a.usuario_id = $1 AND a.activa
                 AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())))
         AND ($4::bigint IS NULL OR p.dispositivo_id = $4)
       GROUP BY p.dispositivo_id
     )
     SELECT d.id AS dispositivo_id, d.id_publico, d.nombre,
            coalesce(pd.distancia_km, 0) AS distancia_km,
            coalesce(pd.duracion_s, 0) AS duracion_s,
            coalesce(pd.viajes, 0) AS viajes,
            coalesce(pp.paradas, 0) AS paradas,
            pos.total AS total_posiciones, pos.ultima AS ultima_posicion
     FROM posiciones pos
     JOIN tracking.dmt_dispositivo d ON d.id = pos.dispositivo_id
     LEFT JOIN por_dispositivo pd ON pd.dispositivo_id = pos.dispositivo_id
     LEFT JOIN paradas_por_dispositivo pp ON pp.dispositivo_id = pos.dispositivo_id
     ORDER BY d.nombre, d.id`,
    valores,
    { signal: ctx.signal, timeoutMs: 20000 },
  );
  // Paradas por permanencia, igual que /reports/stops.
  const { filas: paradasJs } = await paradasDelRango(ctx, dispositivoIdResumen);
  const paradasPorEquipo = new Map();
  for (const f of paradasJs) paradasPorEquipo.set(f.dispositivo_id, (paradasPorEquipo.get(f.dispositivo_id) ?? 0) + 1);
  const porDispositivo = rows.map((fila) => ({
    dispositivoId: Number(fila.dispositivo_id),
    idPublico: fila.id_publico,
    nombre: fila.nombre,
    distanciaKm: redondear(fila.distancia_km, 3),
    duracionMin: redondear(Number(fila.duracion_s) / 60, 1),
    viajes: Number(fila.viajes),
    paradas: paradasPorEquipo.get(Number(fila.dispositivo_id)) ?? 0,
    ultimaPosicionEn: iso(fila.ultima_posicion),
  }));
  respuestaJson(ctx.res, 200, {
    desde: rango.desde.toISOString(),
    hasta: rango.hasta.toISOString(),
    dispositivos: porDispositivo.length,
    posiciones: rows.reduce((total, fila) => total + Number(fila.total_posiciones), 0),
    distanciaTotalKm: redondear(rows.reduce((total, fila) => total + Number(fila.distancia_km), 0), 3),
    duracionTotalMin: redondear(rows.reduce((total, fila) => total + Number(fila.duracion_s), 0) / 60, 1),
    viajes: rows.reduce((total, fila) => total + Number(fila.viajes), 0),
    paradas: porDispositivo.reduce((total, fila) => total + fila.paradas, 0),
    porDispositivo,
  });
}
