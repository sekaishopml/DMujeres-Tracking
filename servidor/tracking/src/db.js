// Acceso a la base de datos del receptor. Escribe en los esquemas tracking,
// operations y telemetry.

import pg from 'pg';

const { Pool } = pg;

const MAX_CONEXIONES = 10;

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

function dosDigitos(numero) {
  return String(numero).padStart(2, '0');
}

function nombreParticion(fecha) {
  return `dmt_posicion_${fecha.getUTCFullYear()}_${dosDigitos(fecha.getUTCMonth() + 1)}`;
}

function nombreParticionEvento(fecha) {
  return `dmt_evento_${fecha.getUTCFullYear()}_${dosDigitos(fecha.getUTCMonth() + 1)}`;
}

function limitesMesUtc(fecha) {
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const inicio = `${anio}-${dosDigitos(mes)}-01 00:00:00+00`;
  const siguienteAnio = mes === 12 ? anio + 1 : anio;
  const siguienteMes = mes === 12 ? 1 : mes + 1;
  const fin = `${siguienteAnio}-${dosDigitos(siguienteMes)}-01 00:00:00+00`;
  return { inicio, fin };
}

// Solo se aceptan puntos de los últimos 30 días hasta 24 h adelante. Fuera de
// eso el reloj del teléfono está mal y el punto se marca como inválido.
const VENTANA_CAPTURA_MS_ATRAS = 30 * 24 * 60 * 60 * 1000;
const VENTANA_CAPTURA_MS_ADELANTE = 24 * 60 * 60 * 1000;
const MAX_ATRASO_INICIO_IOS_MS = 30 * 60 * 1000;
const ZONA_JORNADA = 'America/Guayaquil';

export function fechaCapturaValida(fecha, ahoraMs = Date.now()) {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) return false;
  const instante = fecha.getTime();
  return (
    instante >= ahoraMs - VENTANA_CAPTURA_MS_ATRAS &&
    instante <= ahoraMs + VENTANA_CAPTURA_MS_ADELANTE
  );
}

export class Almacen {
  #pool;
  #particiones = new Set();
  #particionesEvento = new Set();
  #log;
  #tieneIdempotencia = null;

  constructor(pool, log) {
    this.#pool = pool;
    this.#log = log;
  }

  get pool() {
    return this.#pool;
  }

  // Comprueba si existen las columnas boot_id/local_sequence. Con ellas no se
  // guardan puntos repetidos; sin ellas el receptor sigue funcionando igual.
  async #soportaIdempotencia(conexion) {
    if (this.#tieneIdempotencia !== null) return this.#tieneIdempotencia;
    const ejecutor = conexion ?? this.#pool;
    try {
      const resultado = await ejecutor.query(
        `SELECT count(*)::int AS total
           FROM information_schema.columns
          WHERE table_schema = 'tracking'
            AND table_name = 'dmt_posicion'
            AND column_name IN ('boot_id', 'local_sequence')`,
      );
      this.#tieneIdempotencia = Number(resultado.rows[0]?.total) === 2;
    } catch {
      // Si no se puede leer el esquema, se sigue sin control de repetidos.
      this.#tieneIdempotencia = false;
    }
    if (!this.#tieneIdempotencia) {
      this.#log?.warn?.('idempotencia sin columnas boot_id/local_sequence; dedupe desactivado hasta migración 002');
    }
    return this.#tieneIdempotencia;
  }

  async buscarDispositivo(identificador) {
    const resultado = await this.#pool.query(
      `SELECT id, identificador, estado, habilitado, atributos
         FROM tracking.dmt_dispositivo
        WHERE lower(identificador) = lower($1)
        LIMIT 1`,
      [identificador],
    );
    const fila = resultado.rows[0];
    if (!fila) return null;
    return {
      id: String(fila.id),
      identificador: fila.identificador,
      estado: fila.estado,
      habilitado: fila.habilitado !== false,
      atributos: fila.atributos ?? {},
    };
  }

  // Crea la partición del mes de la fecha dada si todavía no existe, para que
  // ningún punto quede sin dónde guardarse. Recuerda en memoria los meses ya
  // revisados.
  async #asegurarParticion(conexion, fecha) {
    const nombre = nombreParticion(fecha);
    if (this.#particiones.has(nombre)) return;
    const { inicio, fin } = limitesMesUtc(fecha);
    await conexion.query(
      `CREATE TABLE IF NOT EXISTS tracking.${nombre}
         PARTITION OF tracking.dmt_posicion
         FOR VALUES FROM ('${inicio}') TO ('${fin}')`,
    );
    this.#particiones.add(nombre);
    this.#log?.info(`particion ${nombre} verificada`);
  }

  // Misma garantia para dmt_evento (particionada por ocurrido_en): el esquema
  // trae 2026-09 y 2026-10; los meses siguientes se crean aqui con la misma
  // plantilla de 03_tracking.sql para que ningun evento quede sin particion.
  async #asegurarParticionEvento(conexion, fecha) {
    const nombre = nombreParticionEvento(fecha);
    if (this.#particionesEvento.has(nombre)) return;
    const { inicio, fin } = limitesMesUtc(fecha);
    await conexion.query(
      `CREATE TABLE IF NOT EXISTS tracking.${nombre}
         PARTITION OF tracking.dmt_evento
         FOR VALUES FROM ('${inicio}') TO ('${fin}')`,
    );
    this.#particionesEvento.add(nombre);
    this.#log?.info(`particion ${nombre} verificada`);
  }

  // Guarda un evento de jornada una sola vez por (equipo, tipo, journeyId):
  // si la app reintenta, no se duplica. Va dentro de la misma transacción que
  // la jornada. El SELECT evita el duplicado y el ON CONFLICT cubre dos
  // pedidos que lleguen a la vez.
  async #insertarEvento(conexion, { dispositivoId, tipo, journeyId, bateria, ocurridoEn = null }) {
    if (journeyId === null || journeyId === undefined) return false;
    const existente = await conexion.query(
      `SELECT 1
         FROM tracking.dmt_evento
        WHERE dispositivo_id = $1
          AND tipo = $2
          AND atributos->>'journeyId' = $3
        LIMIT 1`,
      [dispositivoId, tipo, String(journeyId)],
    );
    if (existente.rowCount > 0) return false;
    const marca = ocurridoEn ?? (await conexion.query('SELECT now() AS ahora')).rows[0].ahora;
    await this.#asegurarParticionEvento(conexion, marca);
    const atributos = { journeyId, mobileSeverity: 'info' };
    if (typeof bateria === 'number' && Number.isFinite(bateria)) atributos.battery = bateria;
    const insertado = await conexion.query(
      `INSERT INTO tracking.dmt_evento (dispositivo_id, tipo, ocurrido_en, atributos)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [dispositivoId, tipo, marca, JSON.stringify(atributos)],
    );
    if (insertado.rowCount > 0) await this.#avisar(conexion, 'e', dispositivoId);
    return insertado.rowCount > 0;
  }

  // Aviso al panel en vivo (lo escucha la API). Dentro de una transacción
  // sale recién al confirmarla.
  async #avisar(conexion, tipo, dispositivoId) {
    await conexion.query("SELECT pg_notify('dmt_vivo', $1)", [`${tipo}:${dispositivoId}`]);
  }

  async #fusionarAtributos(conexion, dispositivoId, parche) {
    await conexion.query(
      `UPDATE tracking.dmt_dispositivo
          SET atributos = atributos || $2::jsonb,
              actualizado_en = now()
        WHERE id = $1`,
      [dispositivoId, JSON.stringify(parche)],
    );
  }

  async fusionarAtributosDispositivo(dispositivoId, parche) {
    await this.#pool.query(
      `UPDATE tracking.dmt_dispositivo
          SET atributos = atributos || $2::jsonb,
              actualizado_en = now()
        WHERE id = $1`,
      [dispositivoId, JSON.stringify(parche)],
    );
  }

  // Guarda un punto sin duplicar (equipo, boot, seq). Un punto atrasado no
  // mueve la posición actual hacia atrás. Devuelve {posicionId},
  // {duplicado:true} o {invalido:true}.
  async registrarPosicion(dispositivoId, posicion) {
    if (!fechaCapturaValida(posicion.registradoEn)) {
      return { invalido: true };
    }
    const conexion = await this.#pool.connect();
    try {
      await conexion.query('BEGIN');
      await this.#asegurarParticion(conexion, posicion.registradoEn);
      const usaIdempotencia = await this.#soportaIdempotencia(conexion);
      const bootId = typeof posicion.bootId === 'string' && posicion.bootId.trim() !== ''
        ? posicion.bootId.trim().slice(0, 64)
        : null;
      const secuencia = Number.isInteger(posicion.secuencia) && posicion.secuencia >= 0
        ? posicion.secuencia
        : (typeof posicion.seq === 'number' && Number.isInteger(posicion.seq) && posicion.seq >= 0
          ? posicion.seq
          : null);
      let insertada;
      if (usaIdempotencia) {
        insertada = await conexion.query(
          `INSERT INTO tracking.dmt_posicion (
             dispositivo_id, protocolo, latitud, longitud, altitud_m,
             velocidad_kmh, rumbo_grados, precision_m, bateria_pct, valida,
             fijado_en, registrado_en, atributos, boot_id, local_sequence
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12::jsonb, $13, $14)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            dispositivoId,
            posicion.protocolo,
            posicion.latitud,
            posicion.longitud,
            posicion.altitud,
            posicion.velocidadKmh,
            posicion.rumbo,
            posicion.precision,
            posicion.bateria,
            posicion.valida,
            posicion.registradoEn,
            JSON.stringify(posicion.atributos ?? {}),
            bootId,
            secuencia,
          ],
        );
      } else {
        insertada = await conexion.query(
          `INSERT INTO tracking.dmt_posicion (
             dispositivo_id, protocolo, latitud, longitud, altitud_m,
             velocidad_kmh, rumbo_grados, precision_m, bateria_pct, valida,
             fijado_en, registrado_en, atributos
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12::jsonb)
           RETURNING id`,
          [
            dispositivoId,
            posicion.protocolo,
            posicion.latitud,
            posicion.longitud,
            posicion.altitud,
            posicion.velocidadKmh,
            posicion.rumbo,
            posicion.precision,
            posicion.bateria,
            posicion.valida,
            posicion.registradoEn,
            JSON.stringify(posicion.atributos ?? {}),
          ],
        );
      }
      if (insertada.rowCount === 0) {
        await conexion.query('ROLLBACK');
        return { duplicado: true };
      }
      const posicionId = String(insertada.rows[0].id);
      // Solo avanza: un punto viejo no reemplaza la posición actual.
      await conexion.query(
        `INSERT INTO tracking.dmt_posicion_actual (
           dispositivo_id, posicion_id, latitud, longitud, altitud_m,
           velocidad_kmh, rumbo_grados, precision_m, bateria_pct, valida,
           fijado_en, registrado_en, atributos
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12::jsonb)
         ON CONFLICT (dispositivo_id) DO UPDATE SET
           posicion_id = EXCLUDED.posicion_id,
           latitud = EXCLUDED.latitud,
           longitud = EXCLUDED.longitud,
           altitud_m = EXCLUDED.altitud_m,
           velocidad_kmh = EXCLUDED.velocidad_kmh,
           rumbo_grados = EXCLUDED.rumbo_grados,
           precision_m = EXCLUDED.precision_m,
           bateria_pct = EXCLUDED.bateria_pct,
           valida = EXCLUDED.valida,
           fijado_en = EXCLUDED.fijado_en,
           registrado_en = EXCLUDED.registrado_en,
           atributos = EXCLUDED.atributos,
           recibido_en = now(),
           actualizado_en = now()
         WHERE EXCLUDED.registrado_en > tracking.dmt_posicion_actual.registrado_en`,
        [
          dispositivoId,
          posicionId,
          posicion.latitud,
          posicion.longitud,
          posicion.altitud,
          posicion.velocidadKmh,
          posicion.rumbo,
          posicion.precision,
          posicion.bateria,
          posicion.valida,
          posicion.registradoEn,
          JSON.stringify(posicion.atributos ?? {}),
        ],
      );
      // Lo mismo para la última conexión del equipo.
      await conexion.query(
        `UPDATE tracking.dmt_dispositivo
            SET estado = 'online',
                ultima_conexion_en = GREATEST(coalesce(ultima_conexion_en, $2), $2),
                ultima_posicion_id = CASE
                  WHEN ultima_conexion_en IS NULL OR $2 > ultima_conexion_en THEN $3
                  ELSE ultima_posicion_id
                END,
                actualizado_en = now()
          WHERE id = $1
            AND (ultima_conexion_en IS NULL OR $2 >= ultima_conexion_en)`,
        [dispositivoId, posicion.registradoEn, posicionId],
      );
      await this.#avisar(conexion, 'p', dispositivoId);
      await conexion.query('COMMIT');
      // El punto ya quedó guardado: si falla la jornada no se pide reenviarlo.
      await this.#abrirJornadaIos(dispositivoId, posicion).catch((error) => {
        this.#log?.warn(`jornada ios fallo dispositivo=${dispositivoId}: ${error.message}`);
      });
      return { posicionId };
    } catch (error) {
      await conexion.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  // Guarda un lote de puntos en una sola transacción. Devuelve por punto
  // {seq, estado} con accepted, duplicate o invalid. Un punto malo no tumba
  // el lote: solo se marca.
  async registrarLotePosiciones(dispositivoId, posiciones) {
    const resultados = [];
    const conexion = await this.#pool.connect();
    try {
      await conexion.query('BEGIN');
      const usaIdempotencia = await this.#soportaIdempotencia(conexion);
      let mejorPosicionId = null;
      let mejorRegistradoEn = null;
      let mejorPosicion = null;
      for (const posicion of posiciones) {
        const seqEco = Number.isInteger(posicion.secuencia) ? posicion.secuencia
          : (Number.isInteger(posicion.seq) ? posicion.seq : null);
        if (!fechaCapturaValida(posicion.registradoEn)) {
          resultados.push({ seq: seqEco, estado: 'invalid' });
          continue;
        }
        await this.#asegurarParticion(conexion, posicion.registradoEn);
        const bootId = typeof posicion.bootId === 'string' && posicion.bootId.trim() !== ''
          ? posicion.bootId.trim().slice(0, 64)
          : null;
        const secuencia = Number.isInteger(posicion.secuencia) && posicion.secuencia >= 0
          ? posicion.secuencia
          : (Number.isInteger(posicion.seq) && posicion.seq >= 0 ? posicion.seq : null);
        let insertada;
        if (usaIdempotencia) {
          insertada = await conexion.query(
            `INSERT INTO tracking.dmt_posicion (
               dispositivo_id, protocolo, latitud, longitud, altitud_m,
               velocidad_kmh, rumbo_grados, precision_m, bateria_pct, valida,
               fijado_en, registrado_en, atributos, boot_id, local_sequence
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12::jsonb, $13, $14)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              dispositivoId,
              posicion.protocolo ?? 'lote',
              posicion.latitud,
              posicion.longitud,
              posicion.altitud,
              posicion.velocidadKmh,
              posicion.rumbo,
              posicion.precision,
              posicion.bateria,
              posicion.valida ?? true,
              posicion.registradoEn,
              JSON.stringify(posicion.atributos ?? {}),
              bootId,
              secuencia,
            ],
          );
        } else {
          insertada = await conexion.query(
            `INSERT INTO tracking.dmt_posicion (
               dispositivo_id, protocolo, latitud, longitud, altitud_m,
               velocidad_kmh, rumbo_grados, precision_m, bateria_pct, valida,
               fijado_en, registrado_en, atributos
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12::jsonb)
             RETURNING id`,
            [
              dispositivoId,
              posicion.protocolo ?? 'lote',
              posicion.latitud,
              posicion.longitud,
              posicion.altitud,
              posicion.velocidadKmh,
              posicion.rumbo,
              posicion.precision,
              posicion.bateria,
              posicion.valida ?? true,
              posicion.registradoEn,
              JSON.stringify(posicion.atributos ?? {}),
            ],
          );
        }
        if (insertada.rowCount === 0) {
          resultados.push({ seq: seqEco, estado: 'duplicate' });
          continue;
        }
        const posicionId = String(insertada.rows[0].id);
        resultados.push({ seq: seqEco, estado: 'accepted' });
        if (mejorRegistradoEn === null || posicion.registradoEn > mejorRegistradoEn) {
          mejorRegistradoEn = posicion.registradoEn;
          mejorPosicionId = posicionId;
          mejorPosicion = posicion;
        }
      }
      // La posición actual solo avanza con el punto más nuevo del lote.
      if (mejorPosicion !== null) {
        await conexion.query(
          `INSERT INTO tracking.dmt_posicion_actual (
             dispositivo_id, posicion_id, latitud, longitud, altitud_m,
             velocidad_kmh, rumbo_grados, precision_m, bateria_pct, valida,
             fijado_en, registrado_en, atributos
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12::jsonb)
           ON CONFLICT (dispositivo_id) DO UPDATE SET
             posicion_id = EXCLUDED.posicion_id,
             latitud = EXCLUDED.latitud,
             longitud = EXCLUDED.longitud,
             altitud_m = EXCLUDED.altitud_m,
             velocidad_kmh = EXCLUDED.velocidad_kmh,
             rumbo_grados = EXCLUDED.rumbo_grados,
             precision_m = EXCLUDED.precision_m,
             bateria_pct = EXCLUDED.bateria_pct,
             valida = EXCLUDED.valida,
             fijado_en = EXCLUDED.fijado_en,
             registrado_en = EXCLUDED.registrado_en,
             atributos = EXCLUDED.atributos,
             recibido_en = now(),
             actualizado_en = now()
           WHERE EXCLUDED.registrado_en > tracking.dmt_posicion_actual.registrado_en`,
          [
            dispositivoId,
            mejorPosicionId,
            mejorPosicion.latitud,
            mejorPosicion.longitud,
            mejorPosicion.altitud,
            mejorPosicion.velocidadKmh,
            mejorPosicion.rumbo,
            mejorPosicion.precision,
            mejorPosicion.bateria,
            mejorPosicion.valida ?? true,
            mejorPosicion.registradoEn,
            JSON.stringify(mejorPosicion.atributos ?? {}),
          ],
        );
        await conexion.query(
          `UPDATE tracking.dmt_dispositivo
              SET estado = 'online',
                  ultima_conexion_en = GREATEST(coalesce(ultima_conexion_en, $2), $2),
                  ultima_posicion_id = CASE
                    WHEN ultima_conexion_en IS NULL OR $2 > ultima_conexion_en THEN $3
                    ELSE ultima_posicion_id
                  END,
                  actualizado_en = now()
            WHERE id = $1
              AND (ultima_conexion_en IS NULL OR $2 >= ultima_conexion_en)`,
          [dispositivoId, mejorRegistradoEn, mejorPosicionId],
        );
      }
      await conexion.query('COMMIT');
      return resultados;
    } catch (error) {
      await conexion.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  // Estado de la jornada según el servidor, para que la app se ponga al día
  // si se reinició el teléfono.
  async obtenerJornadaEstado(dispositivoId) {
    const resultado = await this.#pool.query(
      `SELECT estado, inicio_en, atributos
         FROM operations.dmt_jornada
        WHERE dispositivo_id = $1
        ORDER BY inicio_en DESC, id DESC
        LIMIT 1`,
      [dispositivoId],
    );
    const fila = resultado.rows[0];
    if (!fila) return { estado: 'ninguna', journeyId: null, inicioEn: null };
    const attrs = fila.atributos ?? {};
    const crudo = attrs.journeyId ?? attrs.journey_id ?? attrs.journey_id_legado ?? null;
    const journeyId = crudo === null || crudo === undefined ? null : Number(crudo);
    const inicioEn = fila.inicio_en instanceof Date ? fila.inicio_en.toISOString() : new Date(fila.inicio_en).toISOString();
    if (fila.estado === 'abierta') {
      return {
        estado: 'abierta',
        journeyId: Number.isFinite(journeyId) ? journeyId : null,
        inicioEn,
      };
    }
    return {
      estado: 'cerrada',
      journeyId: Number.isFinite(journeyId) ? journeyId : null,
      inicioEn,
    };
  }

  // Al arrancar se crean las tablas del mes actual y de los 2 siguientes
  // (y en job diario) para que ninguna escritura quede sin partición. La
  // creación on-write se conserva como red de seguridad.
  async precrearParticionesProximas(ahora = new Date()) {
    const conexion = await this.#pool.connect();
    try {
      const base = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
      for (let desplazamiento = 0; desplazamiento < 3; desplazamiento += 1) {
        const fecha = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + desplazamiento, 1));
        await this.#asegurarParticion(conexion, fecha);
        await this.#asegurarParticionEvento(conexion, fecha);
      }
    } finally {
      conexion.release();
    }
  }

  // inicioEn es la hora real en que se tocó el botón (la app reintenta hasta
  // que llega, aunque no haya señal). Un reintento del mismo journeyId no
  // duplica ni cierra la jornada.
  async abrirJornada({ dispositivoId, journeyId, bateriaInicio, atributosJornada, parcheDispositivo, inicioEn = new Date() }) {
    const conexion = await this.#pool.connect();
    try {
      await conexion.query('BEGIN');
      if (journeyId != null) {
        const existente = await conexion.query(
          `SELECT id FROM operations.dmt_jornada
            WHERE dispositivo_id = $1 AND atributos->>'journeyId' = $2::text
            ORDER BY inicio_en DESC LIMIT 1`,
          [dispositivoId, String(journeyId)],
        );
        if (existente.rows.length > 0) {
          await conexion.query('COMMIT');
          return String(existente.rows[0].id);
        }
      }
      await conexion.query(
        `UPDATE operations.dmt_jornada
            SET estado = 'cerrada',
                fin_en = GREATEST($2::timestamptz, inicio_en),
                duracion_s = GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - inicio_en))::bigint),
                actualizado_en = now()
          WHERE dispositivo_id = $1 AND estado = 'abierta'`,
        [dispositivoId, inicioEn],
      );
      const insertada = await conexion.query(
        `INSERT INTO operations.dmt_jornada (
           dispositivo_id, usuario_id, inicio_en, estado, bateria_inicio_pct, atributos
         ) VALUES (
           $1,
           (SELECT usuario_id
              FROM operations.dmt_asignacion
             WHERE dispositivo_id = $1
               AND activa
               AND (hasta_en IS NULL OR hasta_en > now())
             ORDER BY desde_en DESC
             LIMIT 1),
           $4, 'abierta', $2, $3::jsonb
         )
         RETURNING id`,
        [dispositivoId, bateriaInicio, JSON.stringify(atributosJornada), inicioEn],
      );
      await this.#insertarEvento(conexion, {
        dispositivoId,
        tipo: 'mobileJourneyStarted',
        journeyId: journeyId ?? atributosJornada?.journeyId ?? null,
        bateria: bateriaInicio,
        ocurridoEn: inicioEn,
      });
      await this.#fusionarAtributos(conexion, dispositivoId, parcheDispositivo);
      await conexion.query('COMMIT');
      return String(insertada.rows[0].id);
    } catch (error) {
      await conexion.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  // Apagado/encendido del teléfono informado por la app (con la hora real y
  // la causa). Idempotente por (tipo, clave) para los reintentos.
  async registrarEventoEnergia({ dispositivoId, tipo, ocurridoEn, atributos }) {
    const conexion = await this.#pool.connect();
    try {
      const clave = String(atributos.clave);
      const existente = await conexion.query(
        `SELECT 1 FROM tracking.dmt_evento WHERE dispositivo_id = $1 AND tipo = $2 AND atributos->>'clave' = $3 LIMIT 1`,
        [dispositivoId, tipo, clave],
      );
      if (existente.rowCount > 0) return false;
      await this.#asegurarParticionEvento(conexion, ocurridoEn);
      await conexion.query(
        `INSERT INTO tracking.dmt_evento (dispositivo_id, tipo, ocurrido_en, atributos)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
        [dispositivoId, tipo, ocurridoEn, JSON.stringify(atributos)],
      );
      await this.#avisar(conexion, 'e', dispositivoId);
      return true;
    } finally {
      conexion.release();
    }
  }

  // Cronograma de actividades (operations.dmt_actividad).
  async listarActividades({ dispositivoId, desde, hasta }) {
    const { rows } = await this.#pool.query(
      `SELECT cliente_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, hora, hora_fin, tipo, lugar, nota,
              registrado_en, con_jornada, latitud, longitud, precision_m
         FROM operations.dmt_actividad
        WHERE dispositivo_id = $1 AND NOT eliminada AND fecha BETWEEN $2::date AND $3::date
        ORDER BY fecha, hora, registrado_en`,
      [dispositivoId, desde, hasta],
    );
    return rows;
  }

  // Alta o edición por cliente_id. La ubicación solo se guarda si había una
  // jornada abierta: cargada desde la casa no describe el lugar declarado.
  async guardarActividad({ dispositivoId, clienteId, fecha, hora, horaFin, tipo, lugar, nota, registradoEn, latitud, longitud, precisionM, eliminada }) {
    const jornada = await this.#pool.query(
      `SELECT 1 FROM operations.dmt_jornada
        WHERE dispositivo_id = $1 AND inicio_en <= $2 AND (fin_en IS NULL OR fin_en >= $2)
        LIMIT 1`,
      [dispositivoId, registradoEn],
    );
    const conJornada = jornada.rowCount > 0;
    const conCoordenada = conJornada && Number.isFinite(latitud) && Number.isFinite(longitud);
    const { rows } = await this.#pool.query(
      `INSERT INTO operations.dmt_actividad
         (dispositivo_id, cliente_id, fecha, hora, tipo, lugar, nota, registrado_en, con_jornada,
          latitud, longitud, precision_m, eliminada, hora_fin)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (dispositivo_id, cliente_id) DO UPDATE SET
         fecha = EXCLUDED.fecha, hora = EXCLUDED.hora, hora_fin = EXCLUDED.hora_fin, tipo = EXCLUDED.tipo,
         lugar = EXCLUDED.lugar, nota = EXCLUDED.nota, eliminada = EXCLUDED.eliminada,
         actualizado_en = now()
       RETURNING con_jornada, latitud IS NOT NULL AS con_coordenada`,
      [
        dispositivoId, clienteId, fecha, hora, tipo, lugar, nota, registradoEn, conJornada,
        conCoordenada ? latitud : null, conCoordenada ? longitud : null,
        conCoordenada && Number.isFinite(precisionM) ? precisionM : null, eliminada === true, horaFin ?? null,
      ],
    );
    await this.#avisar(this.#pool, 'a', dispositivoId);
    return rows[0];
  }

  async cerrarJornada({ dispositivoId, journeyId, soloJornada = null, finEn, bateriaFin, parcheDispositivo }) {
    const conexion = await this.#pool.connect();
    try {
      await conexion.query('BEGIN');
      // Un aviso de fin que llega tarde (por ejemplo el de ayer, después del
      // inicio de hoy) no debe cerrar la jornada nueva: con `soloJornada` solo
      // cierra la que lleva ese journeyId. Sin él, o si la jornada no tiene
      // journeyId, se cierra la abierta.
      const cerradas = await conexion.query(
        `UPDATE operations.dmt_jornada
            SET estado = 'cerrada',
                fin_en = $2,
                duracion_s = GREATEST(0, EXTRACT(EPOCH FROM ($2 - inicio_en))::bigint),
                bateria_fin_pct = $3,
                actualizado_en = now()
          WHERE dispositivo_id = $1 AND estado = 'abierta'
            AND ($4::text IS NULL OR atributos->>'journeyId' IS NULL OR atributos->>'journeyId' = $4::text)`,
        [dispositivoId, finEn, bateriaFin, soloJornada == null ? null : String(soloJornada)],
      );
      // Si el cierre se repite, ya no hay jornada abierta y no se duplica el evento.
      if (cerradas.rowCount > 0) {
        await this.#insertarEvento(conexion, {
          dispositivoId,
          tipo: 'mobileJourneyEnded',
          journeyId: journeyId ?? null,
          bateria: bateriaFin,
          ocurridoEn: finEn,
        });
      }
      // Si el aviso era de otra jornada y la abierta sigue ahí, los datos del
      // equipo (journeyId vigente) no se tocan.
      const sigueOtra = cerradas.rowCount === 0 && soloJornada != null
        && (await conexion.query(
          `SELECT 1 FROM operations.dmt_jornada WHERE dispositivo_id = $1 AND estado = 'abierta' LIMIT 1`,
          [dispositivoId],
        )).rowCount > 0;
      if (!sigueOtra) await this.#fusionarAtributos(conexion, dispositivoId, parcheDispositivo);
      await conexion.query('COMMIT');
      return cerradas.rowCount;
    } catch (error) {
      await conexion.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async registrarDiagnostico({ dispositivoId, parcheDispositivo, bateria, salud }) {
    const conexion = await this.#pool.connect();
    try {
      await conexion.query('BEGIN');
      await this.#fusionarAtributos(conexion, dispositivoId, parcheDispositivo);
      if (bateria) {
        await conexion.query(
          `INSERT INTO telemetry.dmt_bateria (
             dispositivo_id, porcentaje, cargando, registrado_en, atributos
           ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            dispositivoId,
            bateria.porcentaje,
            bateria.cargando,
            bateria.registradoEn,
            JSON.stringify({ origen: 'movil.diagnostics' }),
          ],
        );
      }
      if (salud) {
        await conexion.query(
          `INSERT INTO telemetry.dmt_salud_dispositivo (
             dispositivo_id, fabricante, modelo, version_android, version_app,
             estado_salud, primer_plano, movimiento, cola_salida, ultimo_fix_en,
             continuidad, recuperacion, sesion_id, tipo_evento, registrado_en, atributos
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
          [
            dispositivoId,
            salud.fabricante,
            salud.modelo,
            salud.versionAndroid,
            salud.versionApp,
            salud.estadoSalud,
            salud.primerPlano,
            salud.movimiento,
            salud.colaSalida,
            salud.ultimoFixEn,
            salud.continuidad,
            salud.recuperacion,
            salud.sesionId,
            salud.tipoEvento,
            salud.registradoEn,
            JSON.stringify(salud.atributos ?? {}),
          ],
        );
      }
      await conexion.query('COMMIT');
    } catch (error) {
      await conexion.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  // Guarda el token de notificaciones del teléfono. Si el token ya existe se
  // actualiza. Un equipo puede tener varios tokens válidos.
  async guardarTokenFcm({ dispositivoId, token }) {
    const resultado = await this.#pool.query(
      `INSERT INTO iam.dmt_token_fcm (
         dispositivo_id, token, activo, invalido, ultimo_uso_en, actualizado_en
       ) VALUES ($1, $2, TRUE, FALSE, now(), now())
       ON CONFLICT (token) DO UPDATE SET
         dispositivo_id = EXCLUDED.dispositivo_id,
         activo = TRUE,
         invalido = FALSE,
         ultimo_uso_en = now(),
         actualizado_en = now()
       RETURNING id`,
      [dispositivoId, token],
    );
    return String(resultado.rows[0].id);
  }

  // Ack de recuperacion en operations.dmt_alerta (origen 'recuperacion'): el
  // detalle variable (attemptId, stage, priority, reason) vive en atributos.
  async registrarAlertaRecuperacion({ dispositivoId, atributos }) {
    const resultado = await this.#pool.query(
      `INSERT INTO operations.dmt_alerta (
         origen, dispositivo_id, tipo, severidad, estado, ocurrido_en, atributos
       ) VALUES ('recuperacion', $1, 'recovery_ack', 'media', 'nueva', now(), $2::jsonb)
       RETURNING id`,
      [dispositivoId, JSON.stringify(atributos)],
    );
    return String(resultado.rows[0].id);
  }

  // Traccar Client de iOS no avisa inicio ni fin de jornada: la abre su primer
  // punto reciente (los viejos que llegan del búfer no abren nada). Si la
  // abierta viene de otro día, se parte a medianoche como hace la app Android.
  async #abrirJornadaIos(dispositivoId, posicion) {
    // Por ahora los iPhone quedan fuera del control de jornadas: solo se guardan
    // sus puntos. Quitar esta línea para volver a abrirlas con el primer punto.
    return;
    const instante = new Date(posicion.registradoEn);
    if (Date.now() - instante.getTime() > MAX_ATRASO_INICIO_IOS_MS) return;
    const { rows } = await this.#pool.query(
      `SELECT j.inicio_en, j.atributos->>'journeyId' AS journey_id,
              date_trunc('day', $2::timestamptz AT TIME ZONE '${ZONA_JORNADA}') AT TIME ZONE '${ZONA_JORNADA}' AS dia
         FROM tracking.dmt_dispositivo d
         LEFT JOIN operations.dmt_jornada j ON j.dispositivo_id = d.id AND j.estado = 'abierta'
        WHERE d.id = $1 AND d.atributos->>'plataforma' = 'ios'
        LIMIT 1`,
      [dispositivoId, instante],
    );
    const fila = rows[0];
    if (!fila) return;
    let inicioEn = instante;
    if (fila.inicio_en) {
      if (fila.inicio_en >= fila.dia) return;
      await this.cerrarJornada({
        dispositivoId,
        journeyId: fila.journey_id,
        finEn: new Date(fila.dia.getTime() - 1),
        bateriaFin: null,
        parcheDispositivo: { 'mobile.journeyId': 0 },
      });
      inicioEn = fila.dia;
    }
    const journeyId = inicioEn.getTime();
    await this.abrirJornada({
      dispositivoId,
      journeyId,
      bateriaInicio: posicion.bateria ?? null,
      atributosJornada: { journeyId, origen: 'ios' },
      parcheDispositivo: { 'mobile.journeyId': journeyId },
      inicioEn,
    });
    this.#log?.info(`jornada ios abierta dispositivo=${dispositivoId} journey=${journeyId}`);
  }

  /**
   * Revisa las jornadas al arrancar y cada hora:
   *  1. Crea la jornada de los equipos que la iniciaron con el servidor caído.
   *     El journeyId de la app es la hora de inicio, así que no se inventa.
   *  2. Cierra las jornadas abiertas que llevan más de `horasTimeout` sin
   *     actividad (`horasTimeoutIos` en iPhone, que no avisa el cierre; ahí
   *     se registra el cierre como evento).
   * Devuelve cuántas creó y cuántas cerró.
   */
  async reconciliarJornadas({ horasTimeout = 12, horasTimeoutIos = 2 } = {}) {
    const creadas = await this.#pool.query(
      `INSERT INTO operations.dmt_jornada (dispositivo_id, usuario_id, inicio_en, estado, atributos)
       SELECT d.id,
              (SELECT a.usuario_id
                 FROM operations.dmt_asignacion a
                WHERE a.dispositivo_id = d.id AND a.activa
                  AND (a.hasta_en IS NULL OR a.hasta_en > now())
                ORDER BY a.desde_en DESC
                LIMIT 1),
              to_timestamp(((d.atributos ->> 'mobile.journeyId')::bigint) / 1000.0),
              'abierta',
              jsonb_build_object('origen', 'reconciliacion',
                                 'journeyId', (d.atributos ->> 'mobile.journeyId')::bigint)
         FROM tracking.dmt_dispositivo d
        WHERE d.habilitado
          AND (d.atributos ->> 'mobile.journeyId') ~ '^[0-9]+$'
          AND (d.atributos ->> 'mobile.journeyId')::bigint > 0
          AND NOT EXISTS (
                SELECT 1 FROM operations.dmt_jornada j
                 WHERE j.dispositivo_id = d.id AND j.estado = 'abierta')
       RETURNING id, dispositivo_id, atributos->>'journeyId' AS journey_id`,
    );
    for (const fila of creadas.rows) {
      await this.#insertarEvento(this.#pool, {
        dispositivoId: fila.dispositivo_id,
        tipo: 'mobileJourneyStarted',
        journeyId: fila.journey_id,
        bateria: null,
      });
      this.#log?.info(`jornada reconciliada dispositivo=${fila.dispositivo_id} journey=${fila.journey_id}`);
    }

    const vencidas = await this.#pool.query(
      `WITH actividad AS (
         SELECT j.id AS jornada_id, j.dispositivo_id,
                j.atributos->>'journeyId' AS journey_id,
                (d.atributos->>'plataforma') = 'ios' AS ios,
                GREATEST(j.inicio_en,
                         coalesce(max(p.registrado_en), j.inicio_en),
                         coalesce(d.ultima_conexion_en, j.inicio_en)) AS ultima
           FROM operations.dmt_jornada j
           JOIN tracking.dmt_dispositivo d ON d.id = j.dispositivo_id
           LEFT JOIN tracking.dmt_posicion p
                  ON p.dispositivo_id = j.dispositivo_id AND p.registrado_en >= j.inicio_en
          WHERE j.estado = 'abierta'
          GROUP BY j.id, j.dispositivo_id, j.inicio_en, j.atributos, d.ultima_conexion_en, d.atributos
       )
       SELECT jornada_id, dispositivo_id, journey_id, ios, ultima
         FROM actividad
        WHERE now() - ultima > make_interval(hours => CASE WHEN ios THEN $2::int ELSE $1::int END)`,
      [horasTimeout, horasTimeoutIos],
    );
    for (const fila of vencidas.rows) {
      await this.#pool.query(
        `UPDATE operations.dmt_jornada
            SET estado = 'cerrada',
                fin_en = $2,
                duracion_s = GREATEST(0, EXTRACT(EPOCH FROM ($2 - inicio_en))::bigint),
                atributos = coalesce(atributos, '{}'::jsonb)
                            || jsonb_build_object('reason', 'timeout'),
                actualizado_en = now()
          WHERE id = $1`,
        [fila.jornada_id, fila.ultima],
      );
      await this.#pool.query(
        `UPDATE tracking.dmt_dispositivo
            SET atributos = coalesce(atributos, '{}'::jsonb)
                            || jsonb_build_object(
                                 'mobile.journeyId', 0,
                                 'mobile.lastEndedJourneyId',
                                   coalesce(atributos ->> 'mobile.journeyId', '0')::bigint),
                actualizado_en = now()
          WHERE id = $1`,
        [fila.dispositivo_id],
      );
      if (fila.ios) {
        await this.#insertarEvento(this.#pool, {
          dispositivoId: fila.dispositivo_id,
          tipo: 'mobileJourneyEnded',
          journeyId: fila.journey_id,
          bateria: null,
          ocurridoEn: fila.ultima,
        });
      }
      await this.#avisar(this.#pool, 'e', fila.dispositivo_id);
      this.#log?.info(`jornada cerrada por timeout dispositivo=${fila.dispositivo_id} jornada=${fila.jornada_id}`);
    }
    return { creadas: creadas.rowCount, cerradas: vencidas.rowCount };
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
