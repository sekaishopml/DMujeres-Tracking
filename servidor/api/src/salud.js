// Salud del servidor y de los teléfonos.
// /health, /ready y /version son públicas. /salud pide sesión y devuelve el
// estado de cada equipo según sus posiciones, eventos y atributos. Lo que la
// app no reporta va en null. Cada estado trae su causa en español.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consultar } from './db.js';
import { respuestaJson } from './http.js';
import { servicioNoDisponible } from './errores.js';
import { PREDICADO_PERMISO, permisoDe } from './flota.js';

export function salud(ctx) {
  respuestaJson(ctx.res, 200, { estado: 'ok' });
}

export async function disponibilidad(ctx) {
  let baseDatos = 'ok';
  let tracking = 'ok';
  try {
    await consultar(ctx.pool, 'SELECT 1', [], { timeoutMs: 2500 });
  } catch (error) {
    ctx.log.aviso('ready_db_error', { detalle: error.message });
    baseDatos = 'error';
  }
  if (baseDatos === 'ok') {
    try {
      await consultar(ctx.pool, 'SELECT 1 FROM tracking.dmt_posicion_actual LIMIT 1', [], { timeoutMs: 2500 });
    } catch (error) {
      ctx.log.aviso('ready_tracking_error', { detalle: error.message });
      tracking = 'error';
    }
  } else {
    tracking = 'error';
  }
  if (ctx.entorno.trackingUrl) {
    tracking = (await servicioTrackingDisponible(ctx)) ? 'ok' : 'error';
  }
  if (baseDatos === 'error') {
    throw servicioNoDisponible('La base de datos no responde.');
  }
  respuestaJson(ctx.res, 200, {
    estado: tracking === 'ok' ? 'listo' : 'degradado',
    dependencias: { baseDatos, tracking },
    comprobadoEn: new Date().toISOString(),
  });
}

async function servicioTrackingDisponible(ctx) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 2000);
  try {
    const respuesta = await fetch(ctx.entorno.trackingUrl, { signal: controlador.signal });
    return respuesta.ok;
  } catch (error) {
    ctx.log.aviso('ready_tracking_sin_respuesta', { detalle: error.message });
    return false;
  } finally {
    clearTimeout(temporizador);
  }
}

// Versión de la app publicada (ota/latest.json), o null si no se puede leer.
async function versionAppPublicada() {
  try {
    const ruta = join(process.env.DMJ_OTA_DIR || '/home/DMujeres-Tracking/ota', 'latest.json');
    const manifiesto = JSON.parse(await readFile(ruta, 'utf8'));
    return typeof manifiesto.version === 'string' ? manifiesto.version : null;
  } catch {
    return null;
  }
}

export async function version(ctx) {
  let versionEsquema = 'desconocida';
  try {
    const { rows } = await consultar(
      ctx.pool,
      'SELECT max(version) AS version FROM system.dmt_version_esquema',
      [],
      { signal: ctx.signal, timeoutMs: 2500 },
    );
    if (rows.length > 0 && rows[0].version) versionEsquema = String(rows[0].version);
  } catch (error) {
    ctx.log.aviso('version_esquema_no_disponible', { detalle: error.message });
  }
  respuestaJson(ctx.res, 200, {
    version: ctx.entorno.version,
    versionApi: 'v1',
    versionEsquema,
    versionApp: await versionAppPublicada(),
    commit: ctx.entorno.commit,
    construidoEn: ctx.entorno.construidoEn,
  });
}

// ---------------------------------------------------------------------------
// GET /api/v1/salud: estado de cada equipo con su causa
// ---------------------------------------------------------------------------

const UMBRAL_OFFLINE_SEGUNDOS = 30 * 60;
const UMBRAL_DEGRADADO_SEGUNDOS = 5 * 60;

function enteroAtributo(atributos, clave) {
  const valor = atributos?.[clave];
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.trunc(valor);
  if (typeof valor === 'string' && /^-?\d+$/.test(valor.trim())) {
    return Number.parseInt(valor.trim(), 10);
  }
  return null;
}

function textoAtributo(atributos, ...claves) {
  for (const clave of claves) {
    const valor = atributos?.[clave];
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
  }
  return null;
}

function booleanoAtributo(atributos, ...claves) {
  for (const clave of claves) {
    const valor = atributos?.[clave];
    if (typeof valor === 'boolean') return valor;
    if (typeof valor === 'string' && (valor.trim().toLowerCase() === 'true' || valor.trim().toLowerCase() === 'false')) {
      return valor.trim().toLowerCase() === 'true';
    }
  }
  return null;
}

// Puntos que el teléfono tiene sin enviar: mobile.pending o el que viene en el
// diagnóstico. Null si la app no lo reporta.
function bufferDepthDe(atributos) {
  const directo = enteroAtributo(atributos, 'mobile.pending')
    ?? enteroAtributo(atributos, 'mobile.bufferPending')
    ?? enteroAtributo(atributos, 'mobile.bufferDepth');
  if (directo !== null) return directo;
  const crudo = atributos?.lastDiagnostics;
  if (typeof crudo === 'string' && crudo !== '') {
    try {
      const latido = JSON.parse(crudo);
      const pendiente = latido?.report?.buffer?.pending;
      if (typeof pendiente === 'number' && Number.isFinite(pendiente)) return Math.trunc(pendiente);
    } catch {
      return null;
    }
  }
  return null;
}

function minutosLegibles(segundos) {
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${minutos % 60} min`;
}

function aSaludDispositivo(fila, ahoraMs) {
  const atributos = fila.atributos ?? {};
  const registradoEn = fila.registrado_en instanceof Date ? fila.registrado_en.getTime() : null;
  const recibidoEn = fila.recibido_en instanceof Date ? fila.recibido_en.getTime() : null;
  const lastFixAgeS = registradoEn === null ? null : Math.max(0, Math.floor((ahoraMs - registradoEn) / 1000));
  const uploadLagS = registradoEn === null || recibidoEn === null
    ? null
    : Math.max(0, Math.floor((recibidoEn - registradoEn) / 1000));
  const previoMs = fila.prev_registrado_en instanceof Date ? fila.prev_registrado_en.getTime() : null;
  const captureGapS = registradoEn === null || previoMs === null
    ? null
    : Math.max(0, Math.floor((registradoEn - previoMs) / 1000));
  const bufferDepth = bufferDepthDe(atributos);
  // Igual que /fleet: vale la lectura más reciente entre la muestra de
  // telemetría y el último fix.
  const hayPa = fila.pa_bateria !== null && fila.pa_bateria !== undefined;
  const hayBat = fila.bat_pct !== null && fila.bat_pct !== undefined;
  const paMasReciente = hayPa && (!hayBat || !fila.bat_registrado_en
    || (fila.registrado_en && new Date(fila.registrado_en) > new Date(fila.bat_registrado_en)));
  const bateriaPct = paMasReciente ? Number(fila.pa_bateria) : hayBat ? Number(fila.bat_pct) : null;
  const bateriaNum = Number.isFinite(bateriaPct) ? Math.trunc(bateriaPct) : null;
  const cargando = fila.bat_cargando === true || fila.bat_cargando === false
    ? fila.bat_cargando
    : booleanoAtributo(atributos, 'mobile.charging');
  const gps = textoAtributo(atributos, 'mobile.gps')
    ?? (booleanoAtributo(atributos, 'mobile.gpsEnabled') === null
      ? null
      : (booleanoAtributo(atributos, 'mobile.gpsEnabled') ? 'on' : 'off'));
  const permFondo = booleanoAtributo(atributos, 'mobile.permBackground');
  const permFina = booleanoAtributo(atributos, 'mobile.permFine');
  const permisos = permFondo === null && permFina === null
    ? null
    : { fondo: permFondo, fina: permFina };
  const bateriaExenta = booleanoAtributo(atributos, 'mobile.batteryExempt');
  const fgs = textoAtributo(atributos, 'mobile.fgs', 'mobile.fgsState', 'mobile.service');
  const jornada = fila.jornada_estado === 'abierta' ? 'abierta'
    : fila.jornada_estado === null || fila.jornada_estado === undefined ? 'ninguna'
    : 'cerrada';
  const red = textoAtributo(atributos, 'mobile.network');
  const bootId = textoAtributo(atributos, 'mobile.bootId', 'mobile.boot_id');
  const recoveryCount = enteroAtributo(atributos, 'mobile.recoveryCount')
    ?? enteroAtributo(atributos, 'mobile.recovery_count');
  const appVersion = textoAtributo(atributos, 'mobile.appVersion', 'mobile.app_version');
  const android = textoAtributo(atributos, 'mobile.android', 'mobile.androidVersion', 'mobile.osVersion');
  const fabricante = textoAtributo(atributos, 'mobile.vendor', 'mobile.manufacturer', 'mobile.fabricante');
  const modelo = textoAtributo(atributos, 'mobile.model', 'mobile.modelo');

  // Orden: primero lo mal configurado, después sin señal, después lo que se
  // está recuperando, después lo degradado; si no hay nada, HEALTHY.
  let estado = 'HEALTHY';
  let causa = 'Operativo.';
  if (permFina === false) {
    estado = 'MISCONFIGURED';
    causa = 'Sin permiso de ubicación precisa.';
  } else if (permFondo === false) {
    estado = 'MISCONFIGURED';
    causa = 'Sin permiso de ubicación en segundo plano.';
  } else if (gps === 'off') {
    estado = 'MISCONFIGURED';
    causa = 'GPS apagado en el equipo.';
  } else if (lastFixAgeS === null) {
    estado = 'OFFLINE';
    causa = 'Sin fixes registrados.';
  } else if (lastFixAgeS > UMBRAL_OFFLINE_SEGUNDOS) {
    estado = 'OFFLINE';
    causa = `Último GPS hace ${minutosLegibles(lastFixAgeS)}.`;
  } else if (bufferDepth !== null && bufferDepth > 0 && lastFixAgeS < UMBRAL_DEGRADADO_SEGUNDOS) {
    estado = 'RECOVERING';
    causa = `Recuperando continuidad (${bufferDepth} pendientes).`;
  } else if (lastFixAgeS > UMBRAL_DEGRADADO_SEGUNDOS) {
    estado = 'DEGRADED';
    causa = `Último GPS hace ${minutosLegibles(lastFixAgeS)}.`;
  } else if (uploadLagS !== null && uploadLagS > 300) {
    estado = 'DEGRADED';
    causa = `Subida con retraso de ${minutosLegibles(uploadLagS)}.`;
  } else if (captureGapS !== null && captureGapS > 600) {
    estado = 'DEGRADED';
    causa = `Hueco de captura de ${minutosLegibles(captureGapS)}.`;
  } else if (bateriaNum !== null && bateriaNum < 15 && cargando !== true) {
    estado = 'DEGRADED';
    causa = `Batería baja (${bateriaNum} %).`;
  } else if (fila.precision_m !== null && Number(fila.precision_m) > 80) {
    estado = 'DEGRADED';
    causa = 'Señal GPS débil.';
  }

  return {
    dispositivoId: Number(fila.id),
    estado,
    causa,
    lastFixAgeS,
    uploadLagS,
    captureGapS,
    bufferDepth,
    bateriaPct: bateriaNum,
    cargando,
    gps,
    permisos,
    bateriaExenta,
    fgs,
    jornada,
    red,
    bootId,
    recoveryCount,
    appVersion,
    android,
    fabricante,
    modelo,
  };
}

export async function listarSalud(ctx) {
  const { rows } = await consultar(
    ctx.pool,
    `SELECT d.id, d.atributos,
            pa.registrado_en, pa.recibido_en, pa.bateria_pct AS pa_bateria,
            pa.precision_m,
            bat.porcentaje AS bat_pct, bat.cargando AS bat_cargando, bat.registrado_en AS bat_registrado_en,
            j.estado AS jornada_estado,
            prev.registrado_en AS prev_registrado_en
       FROM tracking.dmt_dispositivo d
       LEFT JOIN tracking.dmt_posicion_actual pa ON pa.dispositivo_id = d.id
       LEFT JOIN LATERAL (
         SELECT b.porcentaje, b.cargando, b.registrado_en
           FROM telemetry.dmt_bateria b
          WHERE b.dispositivo_id = d.id
          ORDER BY b.registrado_en DESC
          LIMIT 1
       ) bat ON TRUE
       LEFT JOIN LATERAL (
         SELECT e.estado
           FROM operations.dmt_jornada e
          WHERE e.dispositivo_id = d.id
          ORDER BY e.inicio_en DESC, e.id DESC
          LIMIT 1
       ) j ON TRUE
       LEFT JOIN LATERAL (
         SELECT p.registrado_en
           FROM tracking.dmt_posicion p
          WHERE p.dispositivo_id = d.id
            AND pa.registrado_en IS NOT NULL
            AND p.registrado_en < pa.registrado_en
          ORDER BY p.registrado_en DESC
          LIMIT 1
       ) prev ON TRUE
      WHERE d.habilitado AND ${PREDICADO_PERMISO}
      ORDER BY d.id`,
    [permisoDe(ctx.usuario)],
    { signal: ctx.signal },
  );
  const ahoraMs = Date.now();
  respuestaJson(ctx.res, 200, { datos: rows.map((fila) => aSaludDispositivo(fila, ahoraMs)) });
}

// GET /api/v1/salud/historial?horas=24 -> {horas, datos:[...]}: resumen por
// equipo de los diagnósticos (uno cada 10 min). Sirve para ver si un equipo
// falla seguido (GPS atrasado, cola sin enviar, recuperaciones) y con qué
// teléfono. Las recuperaciones se cuentan por arranque del teléfono, porque el
// contador de la app vuelve a cero al reiniciarlo.
export async function historialSalud(ctx) {
  const pedidas = Number(ctx.url.searchParams.get('horas') ?? 24);
  const horas = Number.isFinite(pedidas) ? Math.min(Math.max(Math.trunc(pedidas), 1), 168) : 24;
  const { rows } = await consultar(
    ctx.pool,
    `WITH h AS (
       SELECT s.*, d.id_publico AS dispositivo_publico, d.nombre
         FROM telemetry.dmt_salud_dispositivo s
         JOIN tracking.dmt_dispositivo d ON d.id = s.dispositivo_id
        WHERE s.registrado_en > now() - ($2::int * interval '1 hour')
          AND ${PREDICADO_PERMISO}
     ), recuperaciones AS (
       SELECT dispositivo_id,
              sum(maximo - minimo)::int AS recuperaciones
         FROM (SELECT dispositivo_id, sesion_id,
                      max(recuperacion::int) AS maximo, min(recuperacion::int) AS minimo
                 FROM h WHERE recuperacion ~ '^[0-9]+$'
                GROUP BY dispositivo_id, sesion_id) por_arranque
        GROUP BY dispositivo_id
     ), ultimo AS (
       SELECT DISTINCT ON (dispositivo_id) dispositivo_id, fabricante, modelo, version_android,
              version_app, estado_salud, registrado_en
         FROM h ORDER BY dispositivo_id, registrado_en DESC
     )
     SELECT h.dispositivo_publico, h.nombre, count(*)::int AS reportes,
            count(*) FILTER (WHERE h.estado_salud = 'ok')::int AS ok,
            count(*) FILTER (WHERE h.estado_salud = 'gps_atrasado')::int AS gps_atrasado,
            count(*) FILTER (WHERE h.estado_salud = 'cola_pendiente')::int AS cola_pendiente,
            count(*) FILTER (WHERE h.estado_salud NOT IN ('ok', 'gps_atrasado', 'cola_pendiente'))::int AS otros_problemas,
            max(h.cola_salida)::int AS cola_maxima,
            u.fabricante, u.modelo, u.version_android, u.version_app, u.estado_salud AS ultimo_estado,
            u.registrado_en AS ultimo_reporte, r.recuperaciones
       FROM h
       JOIN ultimo u ON u.dispositivo_id = h.dispositivo_id
       LEFT JOIN recuperaciones r ON r.dispositivo_id = h.dispositivo_id
      GROUP BY h.dispositivo_publico, h.nombre, u.fabricante, u.modelo, u.version_android, u.version_app,
               u.estado_salud, u.registrado_en, r.recuperaciones
      ORDER BY h.nombre`,
    [permisoDe(ctx.usuario), horas],
    { signal: ctx.signal, timeoutMs: 15000 },
  );
  respuestaJson(ctx.res, 200, {
    horas,
    datos: rows.map((f) => ({
      dispositivoId: f.dispositivo_publico,
      nombre: f.nombre,
      reportes: f.reportes,
      ok: f.ok,
      gpsAtrasado: f.gps_atrasado,
      colaPendiente: f.cola_pendiente,
      otrosProblemas: f.otros_problemas,
      colaMaxima: f.cola_maxima,
      recuperaciones: f.recuperaciones ?? null,
      // "Infinix" + "Infinix X6876" no se repite; "Samsung" + "SM-A175F" sí se une.
      telefono:
        f.modelo && f.fabricante && !f.modelo.toLowerCase().startsWith(f.fabricante.toLowerCase())
          ? `${f.fabricante} ${f.modelo}`
          : f.modelo ?? f.fabricante ?? null,
      versionAndroid: f.version_android,
      versionApp: f.version_app,
      ultimoEstado: f.ultimo_estado,
      ultimoReporte: f.ultimo_reporte instanceof Date ? f.ultimo_reporte.toISOString() : f.ultimo_reporte,
    })),
  });
}
