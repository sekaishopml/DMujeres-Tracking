// Prueba completa del servicio de recuperación.
//
// Prueba las reglas de envío con casos armados, pide un token real a Google
// (sin enviar ni mostrarlo), corre una vuelta en modo de prueba con datos
// reales, manda un aviso real al equipo qa-f0 (lo habilita un momento) y
// revisa que la confirmación se refleje. Al final deja el equipo como estaba y
// borra solo lo que creó.
//
// Uso: node24 src/smoke.mjs   (sale con 0 si todo pasa)

import { existsSync } from 'node:fs';
import { cargarConfiguracion } from './config.js';
import { crearAlmacen } from './db.js';
import { cargarCredencial, crearEmisorFcm, firmarJwt } from './fcm.js';
import {
  DECISION,
  decidir,
  evaluarEquipo,
  evaluarIntento,
  ejecutarCiclo,
  enviarIntento,
  formatearSilencio,
  normalizarEtapa,
} from './monitor.js';

const DISPOSITIVO_QA = 'qa-f0';
const CLAVES_RECUPERACION = ['mobile.recoveryState', 'mobile.recoveryAttemptId', 'mobile.recoveryAt'];

let fallos = 0;

function comprobar(nombre, condicion, detalle = '') {
  const ok = Boolean(condicion);
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLO'} - ${nombre}${detalle ? ` (${detalle})` : ''}`);
}

function politicaConstruida() {
  return { silencioMin: 15, cooldownMs: 60_000, maxHora: 5, vigenciaMin: 5 };
}

async function humo() {
  const configuracion = cargarConfiguracion();
  const log = {
    info: (mensaje) => console.log(`[smoke] ${mensaje}`),
    warn: (mensaje) => console.warn(`[smoke] AVISO ${mensaje}`),
    error: (mensaje) => console.error(`[smoke] ERROR ${mensaje}`),
  };

  // ------------------------------------------------------------------
  // 1. Configuracion y politica pura con casos construidos
  // ------------------------------------------------------------------
  const politica = politicaConstruida();
  const ahora = 1_800_000_000_000;
  const base = {
    habilitado: true,
    tieneToken: true,
    intentoEnCurso: false,
    ultimoIntentoEn: null,
    intentosUltimaHora: 0,
    ahoraMs: ahora,
    cooldownMs: politica.cooldownMs,
    maxPorHora: politica.maxHora,
  };
  comprobar('politica: apagado -> SKIP_DISABLED',
    decidir({ ...base, habilitado: false }) === DECISION.SKIP_DISABLED);
  comprobar('politica: sin token -> SKIP_NO_TOKEN',
    decidir({ ...base, tieneToken: false }) === DECISION.SKIP_NO_TOKEN);
  comprobar('politica: intento en curso -> SKIP_ACTIVE_ATTEMPT',
    decidir({ ...base, intentoEnCurso: true }) === DECISION.SKIP_ACTIVE_ATTEMPT);
  comprobar('politica: ultimo intento hace 30 s -> SKIP_COOLDOWN',
    decidir({ ...base, ultimoIntentoEn: ahora - 30_000 }) === DECISION.SKIP_COOLDOWN);
  comprobar('politica: ultimo intento hace 61 s -> ALLOW',
    decidir({ ...base, ultimoIntentoEn: ahora - 61_000 }) === DECISION.ALLOW);
  comprobar('politica: 5 intentos en la hora -> SKIP_RATE_LIMIT',
    decidir({ ...base, intentosUltimaHora: 5 }) === DECISION.SKIP_RATE_LIMIT);

  const senalHace = (minutos) => new Date(ahora - minutos * 60_000);
  const equipoBase = { journeyId: 1790000000000, presencia: 'offline', ultimaConexionEn: null, ultimaPosicionEn: null, atributos: {} };
  comprobar('candidato: jornada activa + offline con 20 min de silencio',
    evaluarEquipo({ ...equipoBase, ultimaConexionEn: senalHace(20) }, politica, ahora).candidato === true);
  comprobar('no candidato: jornada cerrada y presencia online',
    evaluarEquipo({ ...equipoBase, journeyId: 0, presencia: 'online', ultimaConexionEn: senalHace(60) }, politica, ahora).candidato === false);
  comprobar('no candidato: silencio de 5 min menor al minimo de 15',
    evaluarEquipo({ ...equipoBase, ultimaConexionEn: senalHace(5) }, politica, ahora).candidato === false);
  comprobar('candidato: solo lastPositionAt de 16 min',
    evaluarEquipo({ ...equipoBase, presencia: null, ultimaPosicionEn: senalHace(16) }, politica, ahora).candidato === true);
  comprobar('no candidato: sin senal pero sin jornada ni offline',
    evaluarEquipo({ ...equipoBase, journeyId: 0, presencia: null }, politica, ahora).candidato === false);

  const intentoBase = {
    atributos: {
      'mobile.recoveryState': 'SENT',
      'mobile.recoveryAttemptId': 'fcm-construido',
      'mobile.recoveryAt': ahora - 60_000,
    },
  };
  comprobar('intento: SENT de 1 min con vigencia 5 -> abierto',
    evaluarIntento(intentoBase, politica, ahora).abierto === true);
  comprobar('intento: SENT de 6 min -> cerrado por vigencia',
    evaluarIntento({
      atributos: { ...intentoBase.atributos, 'mobile.recoveryAt': ahora - 6 * 60_000 },
    }, politica, ahora).abierto === false);
  comprobar('intento: STARTED -> cerrado',
    evaluarIntento({
      atributos: { ...intentoBase.atributos, 'mobile.recoveryState': 'STARTED' },
    }, politica, ahora).abierto === false);
  comprobar('normalizarEtapa quita el prefijo RECOVERY_',
    normalizarEtapa('RECOVERY_RECEIVED') === 'RECEIVED' && normalizarEtapa('started') === 'STARTED');

  // ------------------------------------------------------------------
  // 2. Canje OAuth real con la cuenta de servicio (sin enviar push)
  // ------------------------------------------------------------------
  comprobar('credencial FCM presente y legible', existsSync(configuracion.fcm.credencial),
    configuracion.fcm.credencial);
  const credencial = cargarCredencial(configuracion.fcm.credencial);
  comprobar('JWT RS256 con 3 segmentos',
    firmarJwt(credencial).split('.').length === 3);
  const emisor = crearEmisorFcm({ credencial, log });
  const acceso = await emisor.obtenerAccessToken();
  comprobar('canje OAuth real devuelve access token',
    typeof acceso === 'string' && acceso.length > 20, `largo=${acceso.length}`);
  const acceso2 = await emisor.obtenerAccessToken();
  comprobar('access token cacheado (segundo canje sin red)', acceso2 === acceso);

  // ------------------------------------------------------------------
  // 3. Vuelta en modo de prueba con datos reales (no envía ni escribe)
  // ------------------------------------------------------------------
  const almacen = await crearAlmacen(configuracion, log);
  try {
    const cicloDry = await ejecutarCiclo({
      almacen,
      emisor: null,
      configuracion,
      log,
      dryRun: true,
      ahoraMs: Date.now(),
    });
    comprobar('dry-run evalua equipos habilitados', cicloDry.evaluaciones.length > 0,
      `equipos=${cicloDry.evaluaciones.length}`);
    comprobar('dry-run no envia ni escribe', cicloDry.enviados.length === 0);
    comprobar('dry-run encuentra equipos sin token vigente',
      cicloDry.evaluaciones.some((e) => e.equipo.token === null));
    console.log('[smoke] DRY_RUN decisiones con datos reales:');
    for (const evaluacion of cicloDry.evaluaciones) {
      console.log(
        `  - ${evaluacion.equipo.identificador}: candidato=${evaluacion.candidato} ` +
        `decision=${evaluacion.candidato ? evaluacion.decision : '-'} ` +
        `jornadaActiva=${evaluacion.condiciones.jornadaActiva} ` +
        `presencia=${evaluacion.equipo.presencia ?? '-'} ` +
        `silencio=${formatearSilencio(evaluacion.condiciones.silencioMin)} ` +
        `intentosHora=${evaluacion.historial.ultimaHora}`
      );
    }

    // ------------------------------------------------------------------
    // 4. Envío real a qa-f0 (habilitado y con token por un momento)
    // ------------------------------------------------------------------
    const fila = (await almacen.pool.query(
      `SELECT id, identificador, estado, habilitado, atributos
         FROM tracking.dmt_dispositivo
        WHERE lower(identificador) = lower($1)`,
      [DISPOSITIVO_QA],
    )).rows[0];
    if (!fila) throw new Error(`no existe el dispositivo ${DISPOSITIVO_QA}`);
    const idQa = String(fila.id);
    const habilitadoOriginal = fila.habilitado !== false;
    const atributosOriginales = Object.fromEntries(
      CLAVES_RECUPERACION.map((clave) => [
        clave,
        Object.prototype.hasOwnProperty.call(fila.atributos ?? {}, clave) ? fila.atributos[clave] : null,
      ]),
    );
    const alertasAntes = (await almacen.pool.query(
      `SELECT count(*)::int AS total FROM operations.dmt_alerta
        WHERE origen = 'recuperacion' AND dispositivo_id = $1`,
      [idQa],
    )).rows[0].total;
    const tokenOriginal = (await almacen.pool.query(
      `SELECT id, activo, invalido
         FROM iam.dmt_token_fcm
        WHERE dispositivo_id = $1
        ORDER BY invalido ASC, id DESC
        LIMIT 1`,
      [idQa],
    )).rows[0];

    const intentosCreados = new Set();
    let resultadoEnvio = null;
    try {
      if (!habilitadoOriginal) {
        await almacen.pool.query(
          'UPDATE tracking.dmt_dispositivo SET habilitado = true WHERE id = $1', [idQa]);
      }
      if (tokenOriginal && (!tokenOriginal.activo || tokenOriginal.invalido)) {
        await almacen.pool.query(
          'UPDATE iam.dmt_token_fcm SET activo = true, invalido = false WHERE id = $1',
          [tokenOriginal.id],
        );
      }
      comprobar('qa-f0 tiene token FCM para la prueba', Boolean(tokenOriginal),
        tokenOriginal ? `token_id=${tokenOriginal.id}` : 'sin fila en iam.dmt_token_fcm');

      const equipoQa = (await almacen.listarEquipos()).find((equipo) => equipo.id === idQa);
      comprobar('qa-f0 habilitado con token vigente entra al monitor',
        Boolean(equipoQa && equipoQa.token), `token=${equipoQa?.token ? 'si' : 'no'}`);
      const condiciones = evaluarEquipo(equipoQa, configuracion.recuperacion, Date.now());
      comprobar('qa-f0 es candidato (jornada/offline + silencio suficiente)',
        condiciones.candidato === true,
        `silencio=${formatearSilencio(condiciones.silencioMin)} motivo=${condiciones.motivo}`);

      // Confirmación real de la app reflejada por el monitor. Va antes del
      // envío: con el estado RECEIVED no se vuelve a enviar.
      const attemptAck = 'fcm-smoke-ack';
      intentosCreados.add(attemptAck);
      await almacen.pool.query(
        `UPDATE tracking.dmt_dispositivo
            SET atributos = atributos || $2::jsonb
          WHERE id = $1`,
        [idQa, JSON.stringify({
          'mobile.recoveryState': 'SENT',
          'mobile.recoveryAttemptId': attemptAck,
          'mobile.recoveryAt': Date.now(),
        })],
      );
      await almacen.pool.query(
        `INSERT INTO operations.dmt_alerta (
           origen, dispositivo_id, tipo, severidad, estado, ocurrido_en, atributos
         ) VALUES ('recuperacion', $1, 'recovery_ack', 'media', 'nueva', now(), $2::jsonb)`,
        [idQa, JSON.stringify({
          attemptId: attemptAck, stage: 'RECOVERY_RECEIVED', priority: 'HIGH', reason: 'smoke',
        })],
      );
      const cicloAck = await ejecutarCiclo({
        almacen, emisor: null, configuracion, log, dryRun: true, ahoraMs: Date.now(),
      });
      const evalAck = cicloAck.evaluaciones.find((equipo) => equipo.equipo.id === idQa);
      comprobar('ack RECOVERY_RECEIVED se refleja en RECEIVED y bloquea el reenvio',
        Boolean(evalAck) && evalAck.equipo.atributos['mobile.recoveryState'] === 'RECEIVED' &&
        evalAck.decision === DECISION.SKIP_ACTIVE_ATTEMPT,
        `estado=${evalAck?.equipo.atributos['mobile.recoveryState']} decision=${evalAck?.decision}`);
      const sinEscribir = (await almacen.pool.query(
        `SELECT atributos->>'mobile.recoveryState' AS estado
           FROM tracking.dmt_dispositivo WHERE id = $1`,
        [idQa],
      )).rows[0];
      comprobar('dry-run no escribe el ack en la base', sinEscribir.estado === 'SENT');

      // El envio real parte sin intento abierto.
      await almacen.pool.query(
        `UPDATE tracking.dmt_dispositivo
            SET atributos = atributos - $2::text[]
          WHERE id = $1`,
        [idQa, CLAVES_RECUPERACION],
      );

      try {
        resultadoEnvio = await enviarIntento({
          almacen,
          emisor,
          equipo: equipoQa,
          silencioMin: condiciones.silencioMin,
          motivo: condiciones.motivo,
          ahoraMs: Date.now(),
          log,
        });
        intentosCreados.add(resultadoEnvio.attemptId);
      } catch (error) {
        comprobar('envio real ejecuta sin excepcion', false, error.message);
      }

      if (resultadoEnvio?.messageId) {
        comprobar('envio real FCM devuelve messageId', true, resultadoEnvio.messageId);
      } else if (resultadoEnvio?.tokenInvalido) {
        console.log(
          `[smoke] envio real rechazado por token invalido (no es fallo del servicio): ` +
          `errorCode=${resultadoEnvio.errorCode} http=${resultadoEnvio.http}`
        );
        comprobar('envio real registra el token invalido', resultadoEnvio.errorCode !== null,
          resultadoEnvio.errorCode);
      } else {
        comprobar('envio real FCM devuelve messageId', false,
          `${resultadoEnvio?.errorCode ?? 'sin resultado'}`);
      }

      if (resultadoEnvio) {
        const alerta = (await almacen.pool.query(
          `SELECT id, tipo, estado, atributos
             FROM operations.dmt_alerta
            WHERE origen = 'recuperacion' AND dispositivo_id = $1
              AND atributos->>'recoveryAttemptId' = $2
            ORDER BY id DESC
            LIMIT 1`,
          [idQa, resultadoEnvio.attemptId],
        )).rows[0];
        if (resultadoEnvio.messageId) {
          comprobar('dmt_alerta registra recovery_probe con messageId/silencio/motivo',
            Boolean(alerta) && alerta.tipo === 'recovery_probe' && alerta.estado === 'nueva' &&
            alerta.atributos.messageId === resultadoEnvio.messageId &&
            typeof alerta.atributos.silencioMin === 'number' && alerta.atributos.silencioMin > 0 &&
            typeof alerta.atributos.motivo === 'string');
          const equipoDespues = (await almacen.pool.query(
            `SELECT atributos->>'mobile.recoveryState' AS estado,
                    atributos->>'mobile.recoveryAttemptId' AS attempt
               FROM tracking.dmt_dispositivo WHERE id = $1`,
            [idQa],
          )).rows[0];
          comprobar('equipo queda en mobile.recoveryState=SENT con el attempt',
            equipoDespues.estado === 'SENT' && equipoDespues.attempt === resultadoEnvio.attemptId);
        } else {
          comprobar('dmt_alerta registra recovery_send_error con errorCode',
            Boolean(alerta) && alerta.tipo === 'recovery_send_error' &&
            alerta.atributos.errorCode === resultadoEnvio.errorCode,
            `errorCode=${resultadoEnvio.errorCode}`);
          const tokenDespues = (await almacen.pool.query(
            'SELECT invalido FROM iam.dmt_token_fcm WHERE id = $1', [tokenOriginal?.id ?? -1],
          )).rows[0];
          comprobar('token invalido marcado en iam.dmt_token_fcm',
            resultadoEnvio.tokenInvalido ? tokenDespues?.invalido === true : true,
            `invalido=${tokenDespues?.invalido}`);
        }

        // Cooldown real: un fallo UNREGISTERED invalida el token por diseno,
        // asi que se revalida solo para esta comprobacion y el finally lo
        // devuelve a su estado original.
        if (tokenOriginal) {
          await almacen.pool.query(
            'UPDATE iam.dmt_token_fcm SET invalido = false WHERE id = $1', [tokenOriginal.id]);
        }
        await almacen.pool.query(
          `UPDATE tracking.dmt_dispositivo
              SET atributos = atributos - $2::text[]
            WHERE id = $1`,
          [idQa, CLAVES_RECUPERACION],
        );
        const cicloCooldown = await ejecutarCiclo({
          almacen, emisor: null, configuracion, log, dryRun: true, ahoraMs: Date.now(),
        });
        const evalCooldown = cicloCooldown.evaluaciones.find((equipo) => equipo.equipo.id === idQa);
        comprobar('cooldown real: intento recien auditado -> SKIP_COOLDOWN',
          Boolean(evalCooldown) && evalCooldown.candidato === true &&
          evalCooldown.decision === DECISION.SKIP_COOLDOWN,
          `decision=${evalCooldown?.decision} intentosHora=${evalCooldown?.historial.ultimaHora}`);
      }
    } finally {
      // Limpieza: borra solo lo creado por el humo y restaura el equipo.
      const intentos = [...intentosCreados];
      if (intentos.length > 0) {
        await almacen.pool.query(
          `DELETE FROM operations.dmt_alerta
            WHERE origen = 'recuperacion' AND dispositivo_id = $1
              AND (atributos->>'recoveryAttemptId' = ANY($2::text[])
                   OR atributos->>'attemptId' = ANY($2::text[]))`,
          [idQa, intentos],
        );
      }
      const restaurar = {};
      const quitar = [];
      for (const [clave, valor] of Object.entries(atributosOriginales)) {
        if (valor === null || valor === undefined) quitar.push(clave);
        else restaurar[clave] = valor;
      }
      await almacen.pool.query(
        `UPDATE tracking.dmt_dispositivo
            SET atributos = (atributos - $2::text[]) || $3::jsonb,
                actualizado_en = now()
          WHERE id = $1`,
        [idQa, quitar, JSON.stringify(restaurar)],
      );
      if (tokenOriginal) {
        await almacen.pool.query(
          'UPDATE iam.dmt_token_fcm SET activo = $2, invalido = $3, actualizado_en = now() WHERE id = $1',
          [tokenOriginal.id, tokenOriginal.activo, tokenOriginal.invalido],
        );
      }
      if (!habilitadoOriginal) {
        await almacen.pool.query(
          'UPDATE tracking.dmt_dispositivo SET habilitado = false WHERE id = $1', [idQa]);
      }

      const alertasDespues = (await almacen.pool.query(
        `SELECT count(*)::int AS total FROM operations.dmt_alerta
          WHERE origen = 'recuperacion' AND dispositivo_id = $1`,
        [idQa],
      )).rows[0].total;
      comprobar('limpieza: alertas de recuperacion de qa-f0 igual que antes',
        alertasDespues === alertasAntes, `${alertasAntes} -> ${alertasDespues}`);
      const atributosFinales = (await almacen.pool.query(
        `SELECT atributos->>'mobile.recoveryState' AS estado,
                atributos->>'mobile.recoveryAttemptId' AS attempt,
                atributos->>'mobile.recoveryAt' AS at
           FROM tracking.dmt_dispositivo WHERE id = $1`,
        [idQa],
      )).rows[0];
      comprobar('limpieza: atributos recovery restaurados',
        atributosFinales.estado === atributosOriginales['mobile.recoveryState'] &&
        atributosFinales.attempt === atributosOriginales['mobile.recoveryAttemptId'] &&
        atributosFinales.at === atributosOriginales['mobile.recoveryAt']);
      const tokenFinal = (await almacen.pool.query(
        `SELECT activo, invalido FROM iam.dmt_token_fcm
          WHERE id = $1`, [tokenOriginal?.id ?? -1],
      )).rows[0];
      comprobar('limpieza: token FCM restaurado',
        Boolean(tokenOriginal) ? tokenFinal.activo === tokenOriginal.activo &&
          tokenFinal.invalido === tokenOriginal.invalido : true);
      const habilitadoFinal = (await almacen.pool.query(
        'SELECT habilitado FROM tracking.dmt_dispositivo WHERE id = $1', [idQa],
      )).rows[0].habilitado;
      comprobar('limpieza: habilitado restaurado', habilitadoFinal === habilitadoOriginal);
    }
  } finally {
    await almacen.cerrar();
  }
}

try {
  await humo();
} catch (error) {
  fallos += 1;
  console.error(`[smoke] ERROR ${error.stack ?? error.message}`);
}
console.log(fallos === 0 ? '[smoke] PASS' : `[smoke] FAIL (${fallos} fallos)`);
process.exit(fallos === 0 ? 0 : 1);
