// POST /api/v1/consola {comando}: consola de Sistema (solo administración).
// Cada comando es una consulta de solo lectura: transacción READ ONLY, rol
// dmt_consulta (no ve cuentas, claves ni sesiones), tiempo máximo y tope de
// filas. `sql` permite una consulta libre con las mismas reglas. Todo queda
// en la auditoría.

import { exigirAdministracion } from './permisos.js';
import { leerCuerpoJson, respuestaJson } from './http.js';
import { datosInvalidos } from './errores.js';
import { auditar } from './sesiones.js';
import { panelesEnVivo } from './vivo.js';

const MAX_FILAS = 200;
const TIEMPO_MAXIMO = '5s';
const ZONA = 'America/Guayaquil';

// Persona por nombre (parcial), identificador o id público.
const PERSONA = `(
  SELECT d.id FROM tracking.dmt_dispositivo d
   WHERE d.habilitado AND (d.nombre ILIKE '%' || $1 || '%' OR lower(d.identificador) = lower($1) OR d.id_publico::text = $1)
   ORDER BY (lower(d.nombre) = lower($1)) DESC, d.nombre
   LIMIT 1)`;

const hora = (columna) => `to_char(${columna} AT TIME ZONE '${ZONA}', 'DD/MM HH24:MI:SS')`;

export const COMANDOS = {
  resumen: {
    ayuda: 'resumen — estado general: equipos, puntos y eventos de hoy',
    sql: () => `SELECT
        (SELECT count(*) FROM tracking.dmt_dispositivo WHERE habilitado) AS equipos,
        (SELECT count(*) FROM tracking.dmt_dispositivo WHERE habilitado AND ultima_conexion_en > now() - interval '15 minutes') AS reportando_15min,
        (SELECT count(*) FROM operations.dmt_jornada WHERE estado = 'abierta') AS jornadas_abiertas,
        (SELECT count(*) FROM tracking.dmt_posicion WHERE registrado_en >= date_trunc('day', now() AT TIME ZONE '${ZONA}') AT TIME ZONE '${ZONA}') AS puntos_hoy,
        (SELECT count(*) FROM tracking.dmt_posicion WHERE recibido_en > now() - interval '5 minutes') AS puntos_5min,
        (SELECT ${hora('max(recibido_en)')} FROM tracking.dmt_posicion_actual) AS ultimo_recibido,
        (SELECT count(*) FROM tracking.dmt_evento WHERE ocurrido_en >= date_trunc('day', now() AT TIME ZONE '${ZONA}') AT TIME ZONE '${ZONA}') AS eventos_hoy,
        (SELECT coalesce(sum((atributos->>'mobile.pending')::int), 0) FROM tracking.dmt_dispositivo
          WHERE habilitado AND atributos->>'mobile.pending' ~ '^[0-9]+$') AS pendientes_telefonos`,
  },
  equipos: {
    ayuda: 'equipos — todos los equipos con su estado, batería y versión',
    sql: () => `SELECT d.nombre, d.identificador,
        coalesce(d.atributos->>'plataforma', 'android') AS plataforma,
        ${hora('d.ultima_conexion_en')} AS ultima_conexion,
        pa.bateria_pct AS bateria,
        d.atributos->>'mobile.pending' AS pendientes,
        d.atributos->>'mobile.appVersion' AS version_app,
        EXISTS (SELECT 1 FROM operations.dmt_jornada j WHERE j.dispositivo_id = d.id AND j.estado = 'abierta') AS en_jornada
      FROM tracking.dmt_dispositivo d
      LEFT JOIN tracking.dmt_posicion_actual pa ON pa.dispositivo_id = d.id
      WHERE d.habilitado ORDER BY d.ultima_conexion_en DESC NULLS LAST`,
  },
  posicion: {
    ayuda: 'posicion <persona> — última posición con coordenadas',
    persona: true,
    sql: () => `SELECT ${hora('pa.registrado_en')} AS capturado, ${hora('pa.recibido_en')} AS recibido,
        pa.latitud, pa.longitud, round(pa.precision_m::numeric, 1) AS precision_m,
        round(pa.velocidad_kmh::numeric, 1) AS kmh, pa.bateria_pct AS bateria
      FROM tracking.dmt_posicion_actual pa WHERE pa.dispositivo_id = ${PERSONA}`,
  },
  posiciones: {
    ayuda: 'posiciones <persona> [n] — últimos n puntos (20 por defecto)',
    persona: true,
    cantidad: 20,
    sql: () => `SELECT ${hora('p.registrado_en')} AS capturado, ${hora('p.recibido_en')} AS recibido,
        p.latitud, p.longitud, round(p.precision_m::numeric, 1) AS precision_m,
        round(p.velocidad_kmh::numeric, 1) AS kmh, p.bateria_pct AS bateria
      FROM tracking.dmt_posicion p
      WHERE p.dispositivo_id = ${PERSONA} AND p.registrado_en > now() - interval '7 days'
      ORDER BY p.registrado_en DESC LIMIT $2`,
  },
  bateria: {
    ayuda: 'bateria <persona> [n] — capturas de batería con hora y coordenadas',
    persona: true,
    cantidad: 30,
    sql: () => `SELECT ${hora('p.registrado_en')} AS capturado, p.bateria_pct AS bateria,
        coalesce((p.atributos->>'charge')::boolean, false) AS cargando, p.latitud, p.longitud
      FROM tracking.dmt_posicion p
      WHERE p.dispositivo_id = ${PERSONA} AND p.bateria_pct IS NOT NULL AND p.registrado_en > now() - interval '7 days'
      ORDER BY p.registrado_en DESC LIMIT $2`,
  },
  recibidos: {
    ayuda: 'recibidos [persona] — puntos recibidos por hora hoy y su atraso promedio',
    personaOpcional: true,
    sql: (conPersona) => `SELECT to_char(date_trunc('hour', p.registrado_en AT TIME ZONE '${ZONA}'), 'HH24:00') AS hora,
        count(*) AS puntos,
        round(avg(extract(epoch FROM (p.recibido_en - p.registrado_en)))::numeric, 1) AS atraso_s
      FROM tracking.dmt_posicion p
      WHERE p.registrado_en >= date_trunc('day', now() AT TIME ZONE '${ZONA}') AT TIME ZONE '${ZONA}'
        ${conPersona ? `AND p.dispositivo_id = ${PERSONA}` : ''}
      GROUP BY 1 ORDER BY 1 DESC`,
  },
  pendientes: {
    ayuda: 'pendientes — puntos por enviar en cada teléfono y recibidos hoy',
    sql: () => `SELECT d.nombre, coalesce(d.atributos->>'mobile.pending', '—') AS por_enviar,
        (SELECT count(*) FROM tracking.dmt_posicion p WHERE p.dispositivo_id = d.id
          AND p.registrado_en >= date_trunc('day', now() AT TIME ZONE '${ZONA}') AT TIME ZONE '${ZONA}') AS recibidos_hoy,
        ${hora('d.ultima_conexion_en')} AS ultima_conexion
      FROM tracking.dmt_dispositivo d WHERE d.habilitado
      ORDER BY (d.atributos->>'mobile.pending') ~ '^[1-9]' DESC, d.nombre`,
  },
  eventos: {
    ayuda: 'eventos <persona> [n] — últimos eventos (jornada, energía, alertas)',
    persona: true,
    cantidad: 30,
    sql: () => `SELECT ${hora('e.ocurrido_en')} AS hora, e.tipo, e.atributos::text AS datos
      FROM tracking.dmt_evento e
      WHERE e.dispositivo_id = ${PERSONA} AND e.ocurrido_en > now() - interval '30 days'
      ORDER BY e.ocurrido_en DESC LIMIT $2`,
  },
  jornadas: {
    ayuda: 'jornadas <persona> [n] — últimas jornadas con su duración',
    persona: true,
    cantidad: 10,
    sql: () => `SELECT ${hora('j.inicio_en')} AS inicio, ${hora('j.fin_en')} AS fin, j.estado,
        round(extract(epoch FROM (coalesce(j.fin_en, now()) - j.inicio_en)) / 3600, 2) AS horas,
        j.atributos->>'reason' AS cierre, j.atributos->>'origen' AS origen
      FROM operations.dmt_jornada j WHERE j.dispositivo_id = ${PERSONA}
      ORDER BY j.inicio_en DESC LIMIT $2`,
  },
  actividades: {
    ayuda: 'actividades <persona> [n] — cronograma declarado',
    persona: true,
    cantidad: 20,
    sql: () => `SELECT a.fecha::text AS fecha, a.hora, a.hora_fin, a.tipo, a.lugar, a.con_jornada, a.eliminada
      FROM operations.dmt_actividad a WHERE a.dispositivo_id = ${PERSONA}
      ORDER BY a.fecha DESC, a.hora DESC LIMIT $2`,
  },
  tablas: {
    ayuda: 'tablas — tablas que se pueden consultar con sql',
    sql: () => `SELECT table_schema || '.' || table_name AS tabla
      FROM information_schema.tables
      WHERE table_schema IN ('tracking', 'operations', 'telemetry')
        AND table_name !~ '_[0-9]{4}_[0-9]{2}$'
      ORDER BY 1`,
  },
};

export function textoAyuda() {
  return [
    ...Object.values(COMANDOS).map((c) => c.ayuda),
    'sql <consulta> — consulta libre de solo lectura (máx. 200 filas, 5 s)',
    'limpiar — borra la pantalla · ↑ ↓ — comandos anteriores',
  ];
}

// Separa el comando: "posiciones maria 50" -> {nombre, persona, cantidad}.
export function interpretar(texto) {
  const limpio = String(texto ?? '').trim();
  if (limpio === '' || limpio.length > 4000) throw datosInvalidos('Escribe un comando (ayuda para ver la lista).');
  const [primera, ...resto] = limpio.split(/\s+/);
  const nombre = primera.toLowerCase();
  if (nombre === 'sql') {
    const consulta = limpio.slice(3).trim().replace(/;\s*$/, '');
    if (!/^(select|with|table|values)\b/i.test(consulta)) throw datosInvalidos('sql solo admite consultas de lectura (SELECT o WITH).');
    return { nombre, consulta };
  }
  const comando = COMANDOS[nombre];
  if (!comando && nombre !== 'ayuda') throw datosInvalidos(`No existe el comando "${primera}". Escribe ayuda.`);
  let cantidad = null;
  if (resto.length > 0 && /^\d+$/.test(resto.at(-1)) && comando?.cantidad) cantidad = Math.min(Number(resto.pop()), MAX_FILAS);
  const persona = resto.join(' ') || null;
  if (comando?.persona && !persona) throw datosInvalidos(`Falta la persona. Uso: ${comando.ayuda.split(' — ')[0]}`);
  return { nombre, persona, cantidad: cantidad ?? comando?.cantidad ?? null };
}

async function leer(pool, texto, valores) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN READ ONLY');
    await cliente.query(`SET LOCAL statement_timeout = '${TIEMPO_MAXIMO}'`);
    await cliente.query('SET LOCAL ROLE dmt_consulta');
    // Protocolo extendido: una sola sentencia, nunca varias separadas por ';'.
    const resultado = await cliente.query({ text: texto, values: valores, queryMode: 'extended', rowMode: 'array' });
    return resultado;
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
  }
}

export async function ejecutarConsola(ctx) {
  await exigirAdministracion(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 8192);
  const pedido = interpretar(cuerpo.comando);
  if (pedido.nombre === 'ayuda') {
    return respuestaJson(ctx.res, 200, { columnas: ['comando'], filas: textoAyuda().map((t) => [t]) });
  }
  let texto;
  let valores = [];
  if (pedido.nombre === 'sql') {
    texto = `SELECT * FROM (${pedido.consulta}) AS consulta LIMIT ${MAX_FILAS + 1}`;
  } else {
    const comando = COMANDOS[pedido.nombre];
    const conPersona = Boolean(comando.persona || (comando.personaOpcional && pedido.persona));
    texto = comando.sql(conPersona);
    if (conPersona) valores.push(pedido.persona);
    if (comando.cantidad) valores = [pedido.persona, pedido.cantidad];
  }
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'consola',
    entidad: 'sistema',
    descripcion: String(cuerpo.comando).slice(0, 500),
    req: ctx.req,
  });
  const inicio = Date.now();
  let resultado;
  try {
    resultado = await leer(ctx.pool, texto, valores);
  } catch (error) {
    // El error de la base se muestra tal cual: es la herramienta de quien administra.
    throw datosInvalidos(error.message);
  }
  const filas = resultado.rows.slice(0, MAX_FILAS);
  const extra = pedido.nombre === 'resumen' ? { paneles_en_vivo: panelesEnVivo() } : null;
  respuestaJson(ctx.res, 200, {
    columnas: [...resultado.fields.map((f) => f.name), ...(extra ? Object.keys(extra) : [])],
    filas: extra ? filas.map((f) => [...f, ...Object.values(extra)]) : filas,
    recortado: resultado.rows.length > MAX_FILAS,
    duracionMs: Date.now() - inicio,
  });
}
