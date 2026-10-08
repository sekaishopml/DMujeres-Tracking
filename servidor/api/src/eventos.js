// Eventos del día para Inicio, en una sola línea de tiempo:
//  - de la app: inicio y fin de jornada, GPS apagado o encendido, permiso de
//    ubicación, ahorro de batería, batería crítica, teléfono apagado o
//    encendido y silencio con la jornada abierta;
//  - actividades que se subieron al cronograma (por la hora de carga).
// GET /api/v1/eventos?desde=ISO&hasta=ISO -> {total, conteo, datos}

import { consultar } from './db.js';
import { datosInvalidos } from './errores.js';
import { respuestaJson } from './http.js';
import { PREDICADO_PERMISO, permisoDe } from './flota.js';

// Tipo de evento de la app y su categoría y texto. Los que no están aquí
// (presencia, diagnóstico, movimiento) son internos.
const TIPOS = {
  mobileJourneyStarted: { categoria: 'inicio_jornada', texto: 'Inició jornada' },
  mobileJourneyEnded: { categoria: 'fin_jornada', texto: 'Finalizó jornada' },
  mobileGpsDisabled: { categoria: 'alerta', texto: 'Apagó el GPS' },
  mobileBatteryCritical: { categoria: 'alerta', texto: 'Batería crítica' },
  mobileNetworkLost: { categoria: 'alerta', texto: 'Perdió la red' },
  mobilePowerOff: { categoria: 'alerta', texto: 'Apagó el teléfono' },
  mobileShutdown: { categoria: 'alerta', texto: 'Apagó el teléfono' },
  mobileGpsReenabled: { categoria: 'recuperacion', texto: 'Reactivó el GPS' },
  mobileNetworkRestored: { categoria: 'recuperacion', texto: 'Recuperó la red' },
  mobilePowerOn: { categoria: 'recuperacion', texto: 'Encendió el teléfono' },
  mobilePermissionLost: { categoria: 'alerta', texto: 'Quitó el permiso de ubicación' },
  mobilePermissionRestored: { categoria: 'recuperacion', texto: 'Devolvió el permiso de ubicación' },
  mobileBatterySaverOn: { categoria: 'alerta', texto: 'Puso la app en ahorro de batería' },
  mobileBatterySaverOff: { categoria: 'recuperacion', texto: 'Quitó la app del ahorro de batería' },
  mobilePowerSaveOn: { categoria: 'alerta', texto: 'Activó el ahorro de batería del teléfono' },
  mobilePowerSaveOff: { categoria: 'recuperacion', texto: 'Quitó el ahorro de batería del teléfono' },
  mobileClockOff: { categoria: 'alerta', texto: 'La hora del teléfono no coincide con la real' },
  mobileClockOk: { categoria: 'recuperacion', texto: 'La hora del teléfono volvió a ser la correcta' },
  mobileSilent: { categoria: 'alerta', texto: 'Dejó de reportar con la jornada abierta' },
  mobileResumed: { categoria: 'recuperacion', texto: 'Volvió a reportar' },
};

const ETIQUETA_ACTIVIDAD = {
  visita: 'Visita',
  almuerzo: 'Almuerzo',
  permiso_medico: 'Permiso médico',
  vacaciones: 'Vacaciones',
  permiso: 'Permiso',
  novedad: 'Novedad',
};

const MAX_EVENTOS = 300;

export async function listarEventos(ctx) {
  const desde = ctx.url.searchParams.get('desde');
  const hasta = ctx.url.searchParams.get('hasta');
  if (!desde || !hasta || Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) {
    throw datosInvalidos('desde y hasta deben ser fechas ISO.');
  }
  const permiso = permisoDe(ctx.usuario);
  const [eventos, actividades] = await Promise.all([
    consultar(
      ctx.pool,
      `SELECT e.tipo, e.ocurrido_en AS en, d.id_publico, d.nombre
         FROM tracking.dmt_evento e
         JOIN tracking.dmt_dispositivo d ON d.id = e.dispositivo_id
        WHERE e.ocurrido_en BETWEEN $2::timestamptz AND $3::timestamptz
          AND e.tipo = ANY($4::text[])
          AND ${PREDICADO_PERMISO}
        ORDER BY e.ocurrido_en DESC
        LIMIT ${MAX_EVENTOS}`,
      [permiso, desde, hasta, Object.keys(TIPOS)],
      { signal: ctx.signal },
    ),
    consultar(
      ctx.pool,
      `SELECT a.tipo, a.lugar, a.hora, a.hora_fin, a.con_jornada, a.registrado_en AS en, d.id_publico, d.nombre
         FROM operations.dmt_actividad a
         JOIN tracking.dmt_dispositivo d ON d.id = a.dispositivo_id
        WHERE NOT a.eliminada
          AND a.registrado_en BETWEEN $2::timestamptz AND $3::timestamptz
          AND ${PREDICADO_PERMISO}
        ORDER BY a.registrado_en DESC
        LIMIT ${MAX_EVENTOS}`,
      [permiso, desde, hasta],
      { signal: ctx.signal },
    ),
  ]);
  const iso = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
  const datos = [
    ...eventos.rows.map((f) => ({
      categoria: TIPOS[f.tipo].categoria,
      texto: TIPOS[f.tipo].texto,
      detalle: null,
      en: iso(f.en),
      dispositivoId: f.id_publico,
      nombre: f.nombre,
    })),
    ...actividades.rows.map((f) => ({
      categoria: 'actividad',
      texto: `Subió ${(ETIQUETA_ACTIVIDAD[f.tipo] ?? f.tipo).toLowerCase()} ${f.hora_fin ? `de ${f.hora} a ${f.hora_fin}` : `de las ${f.hora}`}`,
      detalle: [f.lugar, f.con_jornada ? null : 'sin jornada'].filter(Boolean).join(' · ') || null,
      en: iso(f.en),
      dispositivoId: f.id_publico,
      nombre: f.nombre,
    })),
  ].sort((a, b) => b.en.localeCompare(a.en));
  const conteo = { inicio_jornada: 0, fin_jornada: 0, actividad: 0, alerta: 0, recuperacion: 0 };
  for (const e of datos) conteo[e.categoria] += 1;
  respuestaJson(ctx.res, 200, { total: datos.length, conteo, datos });
}
