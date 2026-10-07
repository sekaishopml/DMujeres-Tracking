// Acceso a la base. Lee equipos y tokens y solo escribe en
// operations.dmt_alerta, iam.dmt_token_fcm, los atributos mobile.recovery* y
// mobile.silencioDesde, y los eventos de silencio del teléfono.

import pg from 'pg';

const { Pool } = pg;

const MAX_CONEXIONES = 5;

export function opcionesPool(configuracion) {
  if (configuracion.bd.url) {
    return { connectionString: configuracion.bd.url, max: MAX_CONEXIONES };
  }
  return {
    host: configuracion.bd.host,
    port: configuracion.bd.puerto,
    database: configuracion.bd.base,
    user: configuracion.bd.usuario,
    password: configuracion.bd.clave,
    max: MAX_CONEXIONES,
  };
}

// Equipos habilitados con un token de notificaciones válido. Si tienen varios,
// se usa el más reciente. El token solo sale de la base para enviar el aviso.
const SQL_EQUIPOS = `
  SELECT d.id,
         d.identificador,
         d.atributos,
         d.ultima_conexion_en,
         d.atributos->>'mobile.presenceState' AS presencia,
         CASE
           WHEN (d.atributos->>'mobile.journeyId') ~ '^[0-9]+$'
           THEN (d.atributos->>'mobile.journeyId')::numeric
         END AS journey_id,
         CASE
           WHEN (d.atributos->>'mobile.lastPositionAt') ~ '^[0-9]+$'
           THEN to_timestamp((d.atributos->>'mobile.lastPositionAt')::bigint / 1000.0)
         END AS ultima_posicion_en,
         t.token,
         t.token_id
    FROM tracking.dmt_dispositivo d
    LEFT JOIN LATERAL (
      SELECT tf.id AS token_id, tf.token
        FROM iam.dmt_token_fcm tf
       WHERE tf.dispositivo_id = d.id
         AND tf.activo
         AND NOT tf.invalido
       ORDER BY tf.ultimo_uso_en DESC NULLS LAST, tf.id DESC
       LIMIT 1
    ) t ON TRUE
   WHERE d.habilitado
   ORDER BY d.id`;

// Intentos por equipo: el último (aviso o error) y cuántos hubo en la última
// hora. Un envío fallido también cuenta como intento.
const SQL_RESUMEN_INTENTOS = `
  SELECT dispositivo_id,
         MAX(ocurrido_en) AS ultimo_en,
         COUNT(*) FILTER (WHERE ocurrido_en >= now() - interval '1 hour')::int AS ultima_hora
    FROM operations.dmt_alerta
   WHERE origen = 'recuperacion'
     AND tipo IN ('recovery_probe', 'recovery_send_error')
     AND dispositivo_id IS NOT NULL
   GROUP BY dispositivo_id`;

const SQL_ACK_RECIENTE = `
  SELECT atributos->>'stage' AS stage,
         ocurrido_en
    FROM operations.dmt_alerta
   WHERE origen = 'recuperacion'
     AND tipo = 'recovery_ack'
     AND dispositivo_id = $1
     AND atributos->>'attemptId' = $2
     AND ocurrido_en >= now() - ($3::int * interval '1 minute')
   ORDER BY ocurrido_en DESC, id DESC
   LIMIT 1`;

export class Almacen {
  #pool;
  #log;

  constructor(pool, log) {
    this.#pool = pool;
    this.#log = log;
  }

  get pool() {
    return this.#pool;
  }

  async listarEquipos() {
    const resultado = await this.#pool.query(SQL_EQUIPOS);
    return resultado.rows.map((fila) => ({
      id: String(fila.id),
      identificador: fila.identificador,
      atributos: fila.atributos ?? {},
      ultimaConexionEn: fila.ultima_conexion_en ? new Date(fila.ultima_conexion_en) : null,
      ultimaPosicionEn: fila.ultima_posicion_en ? new Date(fila.ultima_posicion_en) : null,
      journeyId: fila.journey_id === null || fila.journey_id === undefined
        ? null
        : Number(fila.journey_id),
      presencia: fila.presencia ?? null,
      token: fila.token ?? null,
      tokenId: fila.token_id === null || fila.token_id === undefined ? null : String(fila.token_id),
    }));
  }

  async resumenIntentos() {
    const resultado = await this.#pool.query(SQL_RESUMEN_INTENTOS);
    const resumen = new Map();
    for (const fila of resultado.rows) {
      resumen.set(String(fila.dispositivo_id), {
        ultimoEn: fila.ultimo_en ? new Date(fila.ultimo_en).getTime() : null,
        ultimaHora: Number(fila.ultima_hora ?? 0),
      });
    }
    return resumen;
  }

  async ackMasReciente({ dispositivoId, attemptId, vigenciaMin }) {
    const resultado = await this.#pool.query(SQL_ACK_RECIENTE, [
      dispositivoId,
      attemptId,
      vigenciaMin,
    ]);
    const fila = resultado.rows[0];
    if (!fila) return null;
    return {
      stage: fila.stage,
      ocurridoEn: new Date(fila.ocurrido_en),
    };
  }

  async registrarProbe({ dispositivoId, atributos }) {
    const resultado = await this.#pool.query(
      `INSERT INTO operations.dmt_alerta (
         origen, dispositivo_id, tipo, severidad, estado, ocurrido_en, atributos
       ) VALUES ('recuperacion', $1, 'recovery_probe', 'media', 'nueva', now(), $2::jsonb)
       RETURNING id`,
      [dispositivoId, JSON.stringify(atributos)],
    );
    return String(resultado.rows[0].id);
  }

  async registrarErrorEnvio({ dispositivoId, atributos }) {
    const resultado = await this.#pool.query(
      `INSERT INTO operations.dmt_alerta (
         origen, dispositivo_id, tipo, severidad, estado, ocurrido_en, atributos
       ) VALUES ('recuperacion', $1, 'recovery_send_error', 'media', 'nueva', now(), $2::jsonb)
       RETURNING id`,
      [dispositivoId, JSON.stringify(atributos)],
    );
    return String(resultado.rows[0].id);
  }

  async marcarTokenInvalido(token) {
    await this.#pool.query(
      `UPDATE iam.dmt_token_fcm
          SET invalido = TRUE,
              actualizado_en = now()
        WHERE token = $1`,
      [token],
    );
  }

  async fusionarAtributos(dispositivoId, parche) {
    await this.#pool.query(
      `UPDATE tracking.dmt_dispositivo
          SET atributos = atributos || $2::jsonb,
              actualizado_en = now()
        WHERE id = $1`,
      [dispositivoId, JSON.stringify(parche)],
    );
  }

  // Evento de la línea de tiempo (tracking.dmt_evento). La clave evita
  // repetirlo si el ciclo vuelve a pasar antes de guardar el estado.
  async registrarEvento({ dispositivoId, tipo, ocurridoEn, atributos }) {
    await this.#pool.query(
      `INSERT INTO tracking.dmt_evento (dispositivo_id, tipo, ocurrido_en, atributos)
       SELECT $1, $2, $3, $4::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM tracking.dmt_evento
           WHERE dispositivo_id = $1 AND tipo = $2 AND atributos->>'clave' = $5)`,
      [dispositivoId, tipo, ocurridoEn, JSON.stringify(atributos), String(atributos.clave)],
    );
    await this.#pool.query("SELECT pg_notify('dmt_vivo', $1)", [`e:${dispositivoId}`]);
  }

  async cerrar() {
    await this.#pool.end();
  }
}

export async function crearAlmacen(configuracion, log) {
  const pool = new Pool(opcionesPool(configuracion));
  pool.on('error', (error) => log?.error(`pool de base de datos: ${error.message}`));
  await pool.query('SELECT 1');
  return new Almacen(pool, log);
}
