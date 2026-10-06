// Busca teléfonos en silencio y decide si mandarles un aviso para despertarlos.
//
// En cada vuelta revisa los equipos habilitados. Un equipo es candidato si
// tiene jornada activa y lleva al menos DMJ_RECUPERACION_SILENCIO_MIN minutos
// sin reportar (última conexión y último punto). Sin jornada no se avisa: el
// teléfono no está registrando y despertarlo solo gasta su batería. Luego se decide si se envía: hace falta token, que no haya un
// intento en curso, que haya pasado la pausa y no superar el máximo por hora.
// Cada envío queda en operations.dmt_alerta (recovery_probe) y el equipo pasa
// a mobile.recoveryState='SENT'. Cuando el teléfono confirma (recovery_ack,
// lo guarda el receptor) el estado pasa a RECEIVED o STARTED.

import { randomUUID } from 'node:crypto';

export const DECISION = Object.freeze({
  ALLOW: 'ALLOW',
  SKIP_DISABLED: 'SKIP_DISABLED',
  SKIP_NO_TOKEN: 'SKIP_NO_TOKEN',
  SKIP_ACTIVE_ATTEMPT: 'SKIP_ACTIVE_ATTEMPT',
  SKIP_COOLDOWN: 'SKIP_COOLDOWN',
  SKIP_RATE_LIMIT: 'SKIP_RATE_LIMIT',
});

// Etapas que cierran un intento: el inicio efectivo de la captura o un fallo
// terminal. RECEIVED solo confirma la recepcion del push, el intento sigue
// abierto hasta STARTED o hasta que venza la vigencia.
const ETAPAS_CIERRE = new Set([
  'STARTED',
  'FGS_ACTIVE',
  'TRACKING_ACTIVE',
  'GPS_CONFIRMED',
  'SUCCESS',
  'BLOCKED',
  'FAILED',
  'TIMEOUT',
]);

// Etapas que se reflejan en mobile.recoveryState: RECOVERY_RECEIVED y luego
// RECOVERY_STARTED.
const ETAPAS_ESTADO = new Set(['RECEIVED', 'STARTED']);

export function normalizarEtapa(etapa) {
  const valor = String(etapa ?? '').trim().toUpperCase();
  return valor.startsWith('RECOVERY_') ? valor.slice('RECOVERY_'.length) : valor;
}

// Decide si enviar, en este orden: deshabilitado, sin token, intento en curso,
// pausa entre intentos y máximo por hora.
export function decidir({
  habilitado,
  tieneToken,
  intentoEnCurso,
  ultimoIntentoEn,
  intentosUltimaHora,
  ahoraMs,
  cooldownMs,
  maxPorHora,
}) {
  if (!habilitado) return DECISION.SKIP_DISABLED;
  if (!tieneToken) return DECISION.SKIP_NO_TOKEN;
  if (intentoEnCurso) return DECISION.SKIP_ACTIVE_ATTEMPT;
  if (
    Number.isFinite(ultimoIntentoEn) &&
    ultimoIntentoEn > 0 &&
    ahoraMs - ultimoIntentoEn < cooldownMs
  ) {
    return DECISION.SKIP_COOLDOWN;
  }
  if (intentosUltimaHora >= maxPorHora) return DECISION.SKIP_RATE_LIMIT;
  return DECISION.ALLOW;
}

// Evalua las condiciones de disparo de un equipo (sin politica de intentos).
export function evaluarEquipo(equipo, politica, ahoraMs) {
  const jornadaActiva = Number.isFinite(equipo.journeyId) && equipo.journeyId > 0;
  const presenciaOffline = equipo.presencia === 'offline';
  const senales = [];
  if (equipo.ultimaConexionEn instanceof Date && !Number.isNaN(equipo.ultimaConexionEn.getTime())) {
    senales.push(equipo.ultimaConexionEn.getTime());
  }
  if (equipo.ultimaPosicionEn instanceof Date && !Number.isNaN(equipo.ultimaPosicionEn.getTime())) {
    senales.push(equipo.ultimaPosicionEn.getTime());
  }
  const ultimaSenalMs = senales.length > 0 ? Math.max(...senales) : null;
  const silencioMin = ultimaSenalMs === null
    ? Infinity
    : Math.max(0, (ahoraMs - ultimaSenalMs) / 60_000);
  const motivos = [];
  if (jornadaActiva) motivos.push('jornada_activa');
  if (presenciaOffline) motivos.push('presencia_offline');
  const dispara = jornadaActiva;
  const candidato = dispara && silencioMin >= politica.silencioMin;
  return {
    jornadaActiva,
    presenciaOffline,
    silencioMin,
    ultimaSenalMs,
    candidato,
    motivo: motivos.length > 0 ? motivos.join('+') : null,
  };
}

// Estado del intento del equipo segun sus atributos y la vigencia configurada.
export function evaluarIntento(equipo, politica, ahoraMs) {
  const atributos = equipo.atributos ?? {};
  const attemptId = typeof atributos['mobile.recoveryAttemptId'] === 'string'
    ? atributos['mobile.recoveryAttemptId']
    : null;
  const estado = typeof atributos['mobile.recoveryState'] === 'string'
    ? atributos['mobile.recoveryState'].toUpperCase()
    : null;
  const recoveryAt = Number(atributos['mobile.recoveryAt']);
  const edadMin = Number.isFinite(recoveryAt) && recoveryAt > 0
    ? Math.max(0, (ahoraMs - recoveryAt) / 60_000)
    : Infinity;
  const pendiente = estado === 'SENT' || estado === 'RECEIVED';
  const abierto = attemptId !== null && pendiente && edadMin < politica.vigenciaMin;
  return { attemptId, estado, edadMin, abierto };
}

export function formatearSilencio(silencioMin) {
  return Number.isFinite(silencioMin) ? `${Math.round(silencioMin * 10) / 10} min` : 'sin senal';
}

// Refleja en el equipo el ack mas reciente del intento abierto. Devuelve la
// etapa aplicada (o null). En dry-run solo se lee y se registra.
async function procesarAck({ equipo, intento, almacen, politica, log, dryRun }) {
  if (!intento.attemptId || !intento.abierto) return null;
  const ack = await almacen.ackMasReciente({
    dispositivoId: equipo.id,
    attemptId: intento.attemptId,
    vigenciaMin: politica.vigenciaMin,
  });
  if (!ack) return null;
  const etapa = normalizarEtapa(ack.stage);
  if (ETAPAS_CIERRE.has(etapa)) {
    log.info(`ack terminal sin cambio de estado equipo=${equipo.identificador} attempt=${intento.attemptId} stage=${etapa}`);
    return null;
  }
  if (!ETAPAS_ESTADO.has(etapa)) return null;
  const avanza = intento.estado === 'SENT' || (intento.estado === 'RECEIVED' && etapa === 'STARTED');
  if (!avanza) return null;
  if (!dryRun) {
    await almacen.fusionarAtributos(equipo.id, { 'mobile.recoveryState': etapa });
  }
  equipo.atributos['mobile.recoveryState'] = etapa;
  log.info(
    `${dryRun ? 'DRY_RUN ' : ''}ack aplicado equipo=${equipo.identificador} ` +
    `attempt=${intento.attemptId} stage=${etapa}`
  );
  return etapa;
}

// Envia un intento real (mismo camino que usa el ciclo cuando decide ALLOW).
export async function enviarIntento({ almacen, emisor, equipo, silencioMin, motivo, ahoraMs, log }) {
  const attemptId = `fcm-${randomUUID()}`;
  const atributosBase = {
    recoveryAttemptId: attemptId,
    silencioMin: Number.isFinite(silencioMin) ? Math.round(silencioMin * 10) / 10 : null,
    motivo,
  };
  const resultado = await emisor.enviarProbe({
    token: equipo.token,
    attemptId,
    deviceId: equipo.identificador,
    issuedAtMs: ahoraMs,
  });
  if (resultado.messageId) {
    await almacen.registrarProbe({
      dispositivoId: equipo.id,
      atributos: { ...atributosBase, messageId: resultado.messageId },
    });
    await almacen.fusionarAtributos(equipo.id, {
      'mobile.recoveryState': 'SENT',
      'mobile.recoveryAttemptId': attemptId,
      'mobile.recoveryAt': ahoraMs,
    });
    log.info(
      `probe enviado equipo=${equipo.identificador} attempt=${attemptId} ` +
      `messageId=${resultado.messageId} silencio=${formatearSilencio(silencioMin)} motivo=${motivo ?? '-'}`
    );
    return { attemptId, messageId: resultado.messageId, errorCode: null, tokenInvalido: false };
  }
  if (resultado.tokenInvalido) {
    await almacen.marcarTokenInvalido(equipo.token);
  }
  await almacen.registrarErrorEnvio({
    dispositivoId: equipo.id,
    atributos: {
      ...atributosBase,
      errorCode: resultado.errorCode,
      http: resultado.http,
      tokenInvalido: resultado.tokenInvalido,
    },
  });
  log.warn(
    `probe fallido equipo=${equipo.identificador} attempt=${attemptId} error=${resultado.errorCode}` +
    `${resultado.tokenInvalido ? ' (token marcado invalido)' : ''}`
  );
  return {
    attemptId,
    messageId: null,
    errorCode: resultado.errorCode,
    http: resultado.http,
    tokenInvalido: resultado.tokenInvalido,
  };
}

export async function ejecutarCiclo({
  almacen,
  emisor,
  configuracion,
  log,
  ahoraMs = Date.now(),
  dryRun = configuracion.recuperacion.dryRun,
}) {
  const politica = configuracion.recuperacion;
  const equipos = await almacen.listarEquipos();
  const resumen = await almacen.resumenIntentos();
  const evaluaciones = [];
  const enviados = [];

  for (const equipo of equipos) {
    const intentoInicial = evaluarIntento(equipo, politica, ahoraMs);
    await procesarAck({ equipo, intento: intentoInicial, almacen, politica, log, dryRun });
    const intento = evaluarIntento(equipo, politica, ahoraMs);
    const condiciones = evaluarEquipo(equipo, politica, ahoraMs);
    const historial = resumen.get(equipo.id) ?? { ultimoEn: null, ultimaHora: 0 };
    const decision = decidir({
      habilitado: configuracion.fcm.habilitado,
      tieneToken: equipo.token !== null,
      intentoEnCurso: intento.abierto,
      ultimoIntentoEn: historial.ultimoEn,
      intentosUltimaHora: historial.ultimaHora,
      ahoraMs,
      cooldownMs: politica.cooldownMs,
      maxPorHora: politica.maxHora,
    });
    const evaluacion = {
      equipo,
      condiciones,
      intento,
      historial,
      decision,
      candidato: condiciones.candidato,
    };
    evaluaciones.push(evaluacion);

    if (!condiciones.candidato) {
      if (dryRun) {
        log.info(
          `DRY_RUN equipo=${equipo.identificador} NO candidato ` +
          `(jornadaActiva=${condiciones.jornadaActiva} presencia=${equipo.presencia ?? '-'} ` +
          `silencio=${formatearSilencio(condiciones.silencioMin)} < ${politica.silencioMin} min)`
        );
      }
      continue;
    }
    if (dryRun) {
      log.info(
        `DRY_RUN equipo=${equipo.identificador} candidato ` +
        `(token=${equipo.token ? 'si' : 'no'} intentoAbierto=${intento.abierto} ` +
        `ultimoIntentoMin=${historial.ultimoEn ? Math.round((ahoraMs - historial.ultimoEn) / 60000) : '-'} ` +
        `intentosHora=${historial.ultimaHora} silencio=${formatearSilencio(condiciones.silencioMin)} ` +
        `motivo=${condiciones.motivo}) decision=${decision}`
      );
    }
    if (decision !== DECISION.ALLOW) continue;
    if (dryRun) continue;
    if (!emisor) {
      log.error(
        `equipo=${equipo.identificador}: politica ALLOW pero no hay emisor FCM ` +
        '(credencial ausente o DMJ_FCM_ENABLED=0); no se envia'
      );
      continue;
    }
    const resultado = await enviarIntento({
      almacen,
      emisor,
      equipo,
      silencioMin: condiciones.silencioMin,
      motivo: condiciones.motivo,
      ahoraMs,
      log,
    });
    enviados.push({ identificador: equipo.identificador, ...resultado });
  }

  const candidatos = evaluaciones.filter((e) => e.candidato).length;
  log.info(
    `${dryRun ? 'DRY_RUN ' : ''}ciclo: equipos=${equipos.length} candidatos=${candidatos} ` +
    `permitidos=${evaluaciones.filter((e) => e.candidato && e.decision === DECISION.ALLOW).length} ` +
    `enviados=${enviados.length}`
  );
  return { evaluaciones, enviados, dryRun };
}
