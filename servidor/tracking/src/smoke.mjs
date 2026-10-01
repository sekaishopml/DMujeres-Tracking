// Prueba completa del receptor contra la base real.
//
// Arranca el receptor en un puerto libre y prueba OsmAnd, config, journey,
// diagnostics, OTA, fcm-token y recovery-ack con el equipo de pruebas qa-f0.
// Revisa lo guardado en la base y al final la deja como estaba: restaura el
// equipo y borra solo lo que creó la prueba.
//
// Uso: node24 src/smoke.mjs   (sale con 0 si todo pasa)

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { cargarConfiguracion } from './entorno.js';
import { opcionesPool } from './db.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_SERVIDOR = resolve(AQUI, 'servidor.js');
const DISPOSITIVO_QA = 'qa-f0';

// Manifiesto de humo y bucket OTA (mismo criterio documentado del servicio:
// SHA-256 del deviceId, dos primeros bytes big-endian modulo 100).
const MANIFIESTO_OTA = {
  version: '9.9.9-humo',
  versionCode: 9100,
  minVersionCode: 9050,
  url: 'https://ota.invalid/DMujeres-Tracking-9.9.9-humo.apk',
  notes: 'manifiesto temporal del smoke',
  sha256: '0'.repeat(64),
};

function bucketOta(deviceId) {
  const hash = createHash('sha256').update(deviceId, 'utf8').digest();
  return (((hash[0] & 0xff) << 8) | (hash[1] & 0xff)) % 100;
}

let fallos = 0;
function comprobar(nombre, condicion, detalle = '') {
  const ok = Boolean(condicion);
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLO'} - ${nombre}${detalle ? ` (${detalle})` : ''}`);
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function casiIgual(a, b, tolerancia = 0.001) {
  return typeof a === 'number' && Math.abs(a - b) <= tolerancia;
}

async function puertoLibre() {
  return await new Promise((resolver, rechazar) => {
    const servidor = net.createServer();
    servidor.once('error', rechazar);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(() => resolver(port));
    });
  });
}

function describirFallo(padre, hijo, salida) {
  padre.error(`el servidor de prueba termino con codigo ${hijo.exitCode ?? 'senal'} ` +
    `(senal ${hijo.signalCode ?? '-'})`);
  const lineas = salida.trim().split('\n').slice(-20);
  for (const linea of lineas) padre.error(`  servidor: ${linea}`);
}

async function humo() {
  const configuracion = cargarConfiguracion();
  if (configuracion.clavesMoviles.length === 0) {
    throw new Error('Falta DMJ_CLAVE_MOVIL en /home/DMujeres-Tracking/.env');
  }
  const clave = configuracion.clavesMoviles[0];
  const claveAnterior = configuracion.clavesMoviles[1] ?? null;
  const puerto = await puertoLibre();
  const base = `http://127.0.0.1:${puerto}`;

  const pool = new pg.Pool(opcionesPool(configuracion));
  const log = {
    info: (mensaje) => console.log(`[smoke] ${mensaje}`),
    warn: (mensaje) => console.warn(`[smoke] AVISO ${mensaje}`),
    error: (mensaje) => console.error(`[smoke] ERROR ${mensaje}`),
  };

  async function pedir(ruta, opciones = {}) {
    const respuesta = await fetch(`${base}${ruta}`, opciones);
    const texto = await respuesta.text();
    return { estado: respuesta.status, texto };
  }

  const dispositivo = (
    await pool.query(
      `SELECT id, identificador, estado, habilitado, ultima_conexion_en, ultima_posicion_id, atributos
         FROM tracking.dmt_dispositivo
        WHERE lower(identificador) = lower($1)`,
      [DISPOSITIVO_QA],
    )
  ).rows[0];
  if (!dispositivo) throw new Error(`no existe el dispositivo ${DISPOSITIVO_QA}`);
  const idDispositivo = String(dispositivo.id);
  // qa-f0 está deshabilitado: la prueba lo habilita un momento y lo deja como
  // estaba al terminar.
  const habilitadoOriginal = dispositivo.habilitado !== false;
  if (!habilitadoOriginal) {
    await pool.query('UPDATE tracking.dmt_dispositivo SET habilitado = true WHERE id = $1', [idDispositivo]);
  }

  const contar = async (tabla, extra = '', parametros = []) => (
    await pool.query(`SELECT count(*)::int AS total FROM ${tabla} WHERE ${extra || 'true'}`, parametros)
  ).rows[0].total;

  const antes = {
    posiciones: await contar('tracking.dmt_posicion', 'dispositivo_id = $1', [idDispositivo]),
    posicionActual: await contar('tracking.dmt_posicion_actual', 'dispositivo_id = $1', [idDispositivo]),
    jornadas: await contar('operations.dmt_jornada', 'dispositivo_id = $1', [idDispositivo]),
    baterias: await contar('telemetry.dmt_bateria', 'dispositivo_id = $1', [idDispositivo]),
      eventos: await contar('tracking.dmt_evento', 'dispositivo_id = $1', [idDispositivo]),
      tokens: await contar('iam.dmt_token_fcm', 'dispositivo_id = $1', [idDispositivo]),
      alertas: await contar('operations.dmt_alerta', 'dispositivo_id = $1', [idDispositivo]),
    };
  const jornadasAbiertas = (
    await pool.query(
      `SELECT id, estado, fin_en, duracion_s, bateria_fin_pct, actualizado_en
         FROM operations.dmt_jornada
        WHERE dispositivo_id = $1 AND estado = 'abierta'`,
      [idDispositivo],
    )
  ).rows;
  const actualAntes = (
    await pool.query('SELECT * FROM tracking.dmt_posicion_actual WHERE dispositivo_id = $1', [idDispositivo])
  ).rows[0] ?? null;

  log.info(`dispositivo ${DISPOSITIVO_QA} id=${idDispositivo}; antes: ` +
    `posiciones=${antes.posiciones} actual=${antes.posicionActual} ` +
    `jornadas=${antes.jornadas} baterias=${antes.baterias} abiertas=${jornadasAbiertas.length} ` +
    `eventos=${antes.eventos} tokens=${antes.tokens} alertas=${antes.alertas}`);

  const t1 = Date.now();
  const t2 = Date.now() + 1000;
  const tsDiagnostico = Date.now() + 2000;
  // Horas del lote de puntos (distintas de t1/t2 para poder limpiar exacto).
  const tLote1 = Date.now() + 3000;
  const tLote2 = Date.now() + 4000;
  const bootLote = `humo-boot-${Date.now()}`;
  const jornadaId = Date.now();
  const tokenFcm = `humo-token-${jornadaId}-${'a'.repeat(24)}`;
  const intentoRecuperacion = `humo-attempt-${jornadaId}`;
  const dirOta = await mkdtemp(join(tmpdir(), 'dmj-ota-humo-'));
  const rutaOtaLatest = join(dirOta, 'latest.json');
  const rutaOtaRollout = join(dirOta, 'rollout.json');
  const escribirOta = async (latest, rollout) => {
    await writeFile(rutaOtaLatest, JSON.stringify(latest));
    if (rollout === null) await rm(rutaOtaRollout, { force: true });
    else await writeFile(rutaOtaRollout, JSON.stringify(rollout));
  };

  const salidaServidor = [];
  const hijo = spawn(process.execPath, [RUTA_SERVIDOR], {
    cwd: resolve(AQUI, '..'),
    env: {
      ...process.env,
      DMJ_TRACKING_HOST: '127.0.0.1',
      DMJ_TRACKING_PORT: String(puerto),
      DMJ_CANAL_MOVIL: '1',
      DMJ_OTA_DIR: dirOta,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hijo.stdout.on('data', (trozo) => salidaServidor.push(trozo.toString()));
  hijo.stderr.on('data', (trozo) => salidaServidor.push(trozo.toString()));
  const salida = () => salidaServidor.join('');

  let servidorDetenido = false;
  let falloDescrito = false;
  const detenerServidor = async () => {
    if (servidorDetenido) return;
    servidorDetenido = true;
    if (hijo.exitCode === null && hijo.signalCode === null) {
      hijo.kill('SIGTERM');
      await Promise.race([once(hijo, 'exit'), esperar(5000)]);
      if (hijo.exitCode === null && hijo.signalCode === null) hijo.kill('SIGKILL');
    }
  };
  const describirUnaVez = () => {
    if (falloDescrito) return;
    falloDescrito = true;
    if (hijo.exitCode !== 0 && hijo.exitCode !== null) describirFallo(log, hijo, salida());
  };

  let posicionesCreadas = [];

  try {
    // Arranque y comprobacion de vida.
    let listo = false;
    const inicioEspera = Date.now();
    while (Date.now() - inicioEspera < 15_000 && hijo.exitCode === null) {
      try {
        const respuesta = await fetch(`${base}/api/mobile/v1/config`, {
          headers: { 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
        });
        if (respuesta.status === 200) {
          listo = true;
          break;
        }
      } catch {
        // El puerto aun no acepta conexiones.
      }
      await esperar(200);
    }
    comprobar('el servidor arranca en un puerto de prueba', listo);
    if (!listo) {
      describirUnaVez();
      return;
    }

    // 1. OsmAnd GET (todos los parametros del contrato).
    const consulta = new URLSearchParams({
      id: DISPOSITIVO_QA,
      timestamp: String(t1),
      lat: '-2.1894',
      lon: '-79.8891',
      speed: '12.5',
      bearing: '91',
      altitude: '35',
      accuracy: '8',
      batt: '77',
      charge: 'true',
      mock: 'false',
      alarm: 'humo-smoke',
    });
    const osmAndGet = await pedir(`/?${consulta.toString()}`);
    comprobar('OsmAnd GET responde 200 sin cuerpo', osmAndGet.estado === 200 && osmAndGet.texto === '',
      `estado=${osmAndGet.estado} cuerpo=${osmAndGet.texto.length}b`);

    // 2. OsmAnd POST con mock (no debe validarse).
    const cuerpoMock = new URLSearchParams({
      id: DISPOSITIVO_QA,
      timestamp: String(t2),
      lat: '-2.1900',
      lon: '-79.8900',
      speed: '0',
      batt: '11',
      mock: 'true',
    });
    const osmAndPost = await pedir('/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: cuerpoMock.toString(),
    });
    comprobar('OsmAnd POST responde 200', osmAndPost.estado === 200 && osmAndPost.texto === '');

    // 3. Errores de datos: falta lon -> 400; dispositivo inexistente -> 404.
    const faltante = await pedir(`/?id=${DISPOSITIVO_QA}&timestamp=${t1}&lat=1.5`);
    comprobar('OsmAnd sin lon responde 400', faltante.estado === 400, `estado=${faltante.estado}`);
    const desconocido = await pedir(`/?id=no-existe-humo&timestamp=${t1}&lat=1.5&lon=-79.8`);
    comprobar('OsmAnd con dispositivo desconocido responde 404', desconocido.estado === 404,
      `estado=${desconocido.estado}`);

    // 4. Filas persistidas.
    const filas = await pool.query(
      `SELECT id, velocidad_kmh, rumbo_grados, altitud_m, precision_m, bateria_pct, valida,
              fijado_en, registrado_en, atributos
         FROM tracking.dmt_posicion
        WHERE dispositivo_id = $1 AND registrado_en = ANY($2::timestamptz[])
        ORDER BY registrado_en`,
      [idDispositivo, [new Date(t1), new Date(t2)]],
    );
    comprobar('dmt_posicion guarda las dos posiciones', filas.rowCount === 2, `filas=${filas.rowCount}`);
    posicionesCreadas = filas.rows.map((fila) => String(fila.id));
    if (filas.rowCount === 2) {
      const real = filas.rows[0];
      const simulada = filas.rows[1];
      comprobar('velocidad convertida de nudos a km/h', casiIgual(Number(real.velocidad_kmh), 23.15, 0.01),
        `velocidad=${real.velocidad_kmh} km/h`);
      comprobar('rumbo, altitud y precision', Number(real.rumbo_grados) === 91 &&
        Number(real.altitud_m) === 35 && Number(real.precision_m) === 8);
      comprobar('bateria en dmt_posicion', Number(real.bateria_pct) === 77);
      comprobar('fijado_en = registrado_en', real.fijado_en instanceof Date &&
        real.registrado_en instanceof Date && real.fijado_en.getTime() === real.registrado_en.getTime());
      comprobar('atributos charge/alarm/id_legado', real.atributos.charge === true &&
        real.atributos.alarm === 'humo-smoke' && real.atributos.id_legado === null,
        JSON.stringify(real.atributos));
      comprobar('posicion real valida', real.valida === true);
      comprobar('posicion mock no valida y guarda el atributo', simulada.valida === false &&
        simulada.atributos.mock === true);
    }

    const actual = (
      await pool.query('SELECT * FROM tracking.dmt_posicion_actual WHERE dispositivo_id = $1', [idDispositivo])
    ).rows[0];
    comprobar('dmt_posicion_actual apunta a la ultima posicion', actual !== undefined &&
      posicionesCreadas.includes(String(actual.posicion_id)));
    const dispositivoTrasPosicion = (
      await pool.query('SELECT estado, ultima_conexion_en, ultima_posicion_id FROM tracking.dmt_dispositivo WHERE id = $1',
        [idDispositivo])
    ).rows[0];
    comprobar('dispositivo online con last seen y ultima posicion',
      dispositivoTrasPosicion.estado === 'online' &&
      dispositivoTrasPosicion.ultima_conexion_en instanceof Date &&
      String(dispositivoTrasPosicion.ultima_posicion_id) === String(actual?.posicion_id));

    // 5. Canal movil: config.
    const configBuena = await fetch(`${base}/api/mobile/v1/config`, {
      headers: { 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
    });
    const configJson = await configBuena.json().catch(() => null);
    comprobar('config responde 200 con JSON compatible', configBuena.status === 200 &&
      configJson !== null && typeof configJson.intervalSeconds === 'number' &&
      typeof configJson.bufferMax === 'number' &&
      ['intervalSeconds', 'bufferMax', 'bufferPolicy', 'ackTimeoutSeconds', 'maxRetries',
        'distanceMeters', 'angleDegrees', 'accuracy', 'bufferEnabled', 'l1_pending_intent_enabled',
        'store_all_enabled', 'l1_max_update_delay_ms', 'min_interval_seconds']
        .every((campo) => campo in configJson),
      `estado=${configBuena.status}`);
    const configMala = await fetch(`${base}/api/mobile/v1/config`, {
      headers: { 'x-api-key': 'clave-incorrecta', 'x-device-id': DISPOSITIVO_QA },
    });
    comprobar('config con clave invalida responde 401', configMala.status === 401, `estado=${configMala.status}`);
    const configDesconocida = await fetch(`${base}/api/mobile/v1/config`, {
      headers: { 'x-api-key': clave, 'x-device-id': 'no-existe-humo' },
    });
    comprobar('config con dispositivo desconocido responde 404', configDesconocida.status === 404,
      `estado=${configDesconocida.status}`);
    if (claveAnterior) {
      const configAnterior = await fetch(`${base}/api/mobile/v1/config`, {
        headers: { 'x-api-key': claveAnterior, 'x-device-id': DISPOSITIVO_QA },
      });
      comprobar('config acepta la clave anterior en rotacion', configAnterior.status === 200,
        `estado=${configAnterior.status}`);
    }

    // 6. Journey start/stop.
    const jornadaInicio = await pedir('/api/mobile/v1/journey', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave },
      body: JSON.stringify({ deviceId: DISPOSITIVO_QA, action: 'start', journeyId: jornadaId, client: 'smoke' }),
    });
    comprobar('journey start responde 200 {ok:true}', jornadaInicio.estado === 200 &&
      JSON.parse(jornadaInicio.texto || '{}').ok === true);
    const jornadaAbierta = (
      await pool.query(
        `SELECT id, estado, fin_en FROM operations.dmt_jornada
          WHERE dispositivo_id = $1 AND atributos->>'journeyId' = $2`,
        [idDispositivo, String(jornadaId)],
      )
    ).rows[0];
    comprobar('operations.dmt_jornada abre la jornada', jornadaAbierta !== undefined &&
      jornadaAbierta.estado === 'abierta' && jornadaAbierta.fin_en === null);
    const attrsTrasInicio = (
      await pool.query('SELECT atributos FROM tracking.dmt_dispositivo WHERE id = $1', [idDispositivo])
    ).rows[0].atributos;
    comprobar('mobile.journeyId actualizado al iniciar', Number(attrsTrasInicio['mobile.journeyId']) === jornadaId);

    const eventoInicio = (
      await pool.query(
        `SELECT id, ocurrido_en, atributos FROM tracking.dmt_evento
          WHERE dispositivo_id = $1 AND tipo = 'mobileJourneyStarted'
            AND atributos->>'journeyId' = $2`,
        [idDispositivo, String(jornadaId)],
      )
    ).rows;
    const bateriaDispositivo = Number(attrsTrasInicio['mobile.battery']);
    const bateriaEsperada = bateriaDispositivo >= 0 && bateriaDispositivo <= 100;
    comprobar('dmt_evento registra mobileJourneyStarted con journeyId/severidad/bateria',
      eventoInicio.length === 1 && Number(eventoInicio[0].atributos.journeyId) === jornadaId &&
      eventoInicio[0].atributos.mobileSeverity === 'info' &&
      (bateriaEsperada
        ? eventoInicio[0].atributos.battery === bateriaDispositivo
        : eventoInicio[0].atributos.battery === undefined) &&
      eventoInicio[0].ocurrido_en instanceof Date);

    const jornadaInicioRepetida = await pedir('/api/mobile/v1/journey', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave },
      body: JSON.stringify({ deviceId: DISPOSITIVO_QA, action: 'start', journeyId: jornadaId, client: 'smoke' }),
    });
    const eventosInicioRepetidos = (
      await pool.query(
        `SELECT count(*)::int AS total FROM tracking.dmt_evento
          WHERE dispositivo_id = $1 AND tipo = 'mobileJourneyStarted'
            AND atributos->>'journeyId' = $2`,
        [idDispositivo, String(jornadaId)],
      )
    ).rows[0].total;
    comprobar('journey start repetido no duplica el evento',
      jornadaInicioRepetida.estado === 200 && eventosInicioRepetidos === 1,
      `eventos=${eventosInicioRepetidos}`);

    const jornadaFin = await pedir('/api/mobile/v1/journey', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave },
      body: JSON.stringify({ deviceId: DISPOSITIVO_QA, action: 'stop', journeyId: jornadaId }),
    });
    comprobar('journey stop responde 200 {ok:true}', jornadaFin.estado === 200 &&
      JSON.parse(jornadaFin.texto || '{}').ok === true);
    const jornadaCerrada = (
      await pool.query('SELECT estado, fin_en FROM operations.dmt_jornada WHERE id = $1', [jornadaAbierta?.id])
    ).rows[0];
    comprobar('operations.dmt_jornada cierra la jornada', jornadaCerrada !== undefined &&
      jornadaCerrada.estado === 'cerrada' && jornadaCerrada.fin_en instanceof Date);
    const attrsTrasFin = (
      await pool.query('SELECT atributos FROM tracking.dmt_dispositivo WHERE id = $1', [idDispositivo])
    ).rows[0].atributos;
    comprobar('journeyId a 0 y lastEndedJourneyId', Number(attrsTrasFin['mobile.journeyId']) === 0 &&
      Number(attrsTrasFin['mobile.lastEndedJourneyId']) === jornadaId);

    const eventoFin = (
      await pool.query(
        `SELECT id, ocurrido_en, atributos FROM tracking.dmt_evento
          WHERE dispositivo_id = $1 AND tipo = 'mobileJourneyEnded'
            AND atributos->>'journeyId' = $2`,
        [idDispositivo, String(jornadaId)],
      )
    ).rows;
    comprobar('dmt_evento registra mobileJourneyEnded con journeyId/severidad',
      eventoFin.length === 1 && Number(eventoFin[0].atributos.journeyId) === jornadaId &&
      eventoFin[0].atributos.mobileSeverity === 'info' && eventoFin[0].ocurrido_en instanceof Date);

    const jornadaFinRepetida = await pedir('/api/mobile/v1/journey', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave },
      body: JSON.stringify({ deviceId: DISPOSITIVO_QA, action: 'stop', journeyId: jornadaId }),
    });
    const eventosFinRepetidos = (
      await pool.query(
        `SELECT count(*)::int AS total FROM tracking.dmt_evento
          WHERE dispositivo_id = $1 AND tipo = 'mobileJourneyEnded'
            AND atributos->>'journeyId' = $2`,
        [idDispositivo, String(jornadaId)],
      )
    ).rows[0].total;
    comprobar('journey stop repetido no duplica el evento',
      jornadaFinRepetida.estado === 200 && eventosFinRepetidos === 1,
      `eventos=${eventosFinRepetidos}`);

    // 7. Diagnostics (204 + atajos + muestra de bateria).
    const diagnostico = {
      deviceId: Number(idDispositivo),
      ts: tsDiagnostico,
      report: {
        app: { versionCode: 999, versionName: 'smoke' },
        power: { battery: 55, charging: true, exempt: true },
        perms: { fine: true, background: true },
        gps: { enabled: true, mock: false, provider: 'fused', fixAgeSec: 1 },
        buffer: { pending: 0, max: 5000, policy: 'drop_oldest' },
      },
    };
    const diagOk = await pedir('/api/mobile/v1/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
      body: JSON.stringify(diagnostico),
    });
    comprobar('diagnostics responde 204', diagOk.estado === 204 && diagOk.texto === '',
      `estado=${diagOk.estado}`);
    const attrsDiag = (
      await pool.query('SELECT atributos FROM tracking.dmt_dispositivo WHERE id = $1', [idDispositivo])
    ).rows[0].atributos;
    let diagnosticoGuardado = null;
    try {
      diagnosticoGuardado = JSON.parse(attrsDiag.lastDiagnostics);
    } catch {
      diagnosticoGuardado = null;
    }
    const at = Number(attrsDiag.lastDiagnosticsAt);
    comprobar('diagnostics persistido en lastDiagnostics',
      Number.isFinite(at) && at >= t1 && at <= Date.now() &&
      diagnosticoGuardado?.report?.power?.battery === 55);
    const gpsAt = Number(attrsDiag['mobile.gpsAt']);
    comprobar('atajos mobile.* del diagnostico',
      attrsDiag['mobile.permBackground'] === true && attrsDiag['mobile.batteryExempt'] === true &&
      attrsDiag['mobile.mockLocation'] === false && attrsDiag['mobile.gps'] === 'on' &&
      Number.isFinite(gpsAt) && gpsAt >= t1 && gpsAt <= Date.now());
    const muestraBateria = (
      await pool.query(
        `SELECT porcentaje, cargando FROM telemetry.dmt_bateria
          WHERE dispositivo_id = $1 AND registrado_en = $2`,
        [idDispositivo, new Date(tsDiagnostico)],
      )
    ).rows[0];
    comprobar('telemetry.dmt_bateria recibe la muestra', muestraBateria !== undefined &&
      Number(muestraBateria.porcentaje) === 55 && muestraBateria.cargando === true);

    const diagGrande = await pedir('/api/mobile/v1/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
      body: JSON.stringify({ deviceId: Number(idDispositivo), relleno: 'x'.repeat(11_000) }),
    });
    comprobar('diagnostics mayor a 10 KB responde 413', diagGrande.estado === 413,
      `estado=${diagGrande.estado}`);
    const diagAjeno = await pedir('/api/mobile/v1/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
      body: JSON.stringify({ deviceId: 999_999, report: {} }),
    });
    comprobar('diagnostics con deviceId ajeno responde 403', diagAjeno.estado === 403,
      `estado=${diagAjeno.estado}`);
    const diagInvalido = await pedir('/api/mobile/v1/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
      body: '{',
    });
    comprobar('diagnostics con JSON invalido responde 400', diagInvalido.estado === 400,
      `estado=${diagInvalido.estado}`);

    // 8. OTA propia: latest.json/rollout.json en DMJ_OTA_DIR temporal.
    const pedirOta = async (instalado, cabeceras = {}) => pedir(
      `/api/mobile/v1/ota?deviceId=${encodeURIComponent(DISPOSITIVO_QA)}&versionCode=${instalado}`,
      { headers: { 'x-api-key': clave, ...cabeceras } },
    );
    const comoJson = (resultado) => {
      try {
        return JSON.parse(resultado.texto || '{}');
      } catch {
        return {};
      }
    };

    await escribirOta(MANIFIESTO_OTA, null);
    const otaIgual = await pedirOta(MANIFIESTO_OTA.versionCode);
    comprobar('OTA con instalado igual al publicado responde {"update":false}',
      otaIgual.estado === 200 && comoJson(otaIgual).update === false, `estado=${otaIgual.estado}`);
    const otaMayor = await pedirOta(MANIFIESTO_OTA.versionCode + 1);
    comprobar('OTA con instalado mayor al publicado responde {"update":false}',
      otaMayor.estado === 200 && comoJson(otaMayor).update === false, `estado=${otaMayor.estado}`);
    const otaMenor = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    const otaMenorJson = comoJson(otaMenor);
    comprobar('OTA con instalado menor entrega el manifiesto completo',
      otaMenor.estado === 200 && otaMenorJson.versionCode === MANIFIESTO_OTA.versionCode &&
      otaMenorJson.url === MANIFIESTO_OTA.url && otaMenorJson.sha256 === MANIFIESTO_OTA.sha256 &&
      otaMenorJson.minVersionCode === MANIFIESTO_OTA.minVersionCode,
      `estado=${otaMenor.estado}`);

    const attrsOta = (
      await pool.query('SELECT atributos FROM tracking.dmt_dispositivo WHERE id = $1', [idDispositivo])
    ).rows[0].atributos;
    const otaCheckAt = Number(attrsOta['mobile.lastOtaCheckAt']);
    comprobar('OTA audita mobile.lastOta* en el dispositivo',
      Number(attrsOta['mobile.lastOtaVersionCode']) === MANIFIESTO_OTA.versionCode &&
      attrsOta['mobile.lastOtaUpdate'] === false &&
      typeof attrsOta['mobile.lastOtaUa'] === 'string' && attrsOta['mobile.lastOtaUa'].length > 0 &&
      otaCheckAt >= t1 && otaCheckAt <= Date.now(),
      `checkAt=${attrsOta['mobile.lastOtaCheckAt']} update=${attrsOta['mobile.lastOtaUpdate']}`);

    await escribirOta(MANIFIESTO_OTA, { percent: 100, paused: true, allow: [] });
    const otaPausa = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar('OTA en pausa con instalado >= minVersionCode responde {"update":false}',
      otaPausa.estado === 200 && comoJson(otaPausa).update === false, `estado=${otaPausa.estado}`);
    const otaForzada = await pedirOta(MANIFIESTO_OTA.minVersionCode - 1);
    comprobar('OTA con instalado bajo minVersionCode se sirve aunque este en pausa (forzada)',
      otaForzada.estado === 200 && comoJson(otaForzada).versionCode === MANIFIESTO_OTA.versionCode,
      `estado=${otaForzada.estado}`);

    await escribirOta(MANIFIESTO_OTA, { percent: 100, paused: true, allow: ['otro-equipo'] });
    const otaAllowAjeno = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar('OTA con allowlist sin el equipo responde {"update":false}',
      otaAllowAjeno.estado === 200 && comoJson(otaAllowAjeno).update === false,
      `estado=${otaAllowAjeno.estado}`);
    await escribirOta(MANIFIESTO_OTA, { percent: 100, paused: true, allow: [DISPOSITIVO_QA] });
    const otaAllowPropio = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar('OTA con allowlist que incluye al equipo entrega el manifiesto (vence la pausa)',
      otaAllowPropio.estado === 200 && comoJson(otaAllowPropio).versionCode === MANIFIESTO_OTA.versionCode,
      `estado=${otaAllowPropio.estado}`);

    const bucketQa = bucketOta(DISPOSITIVO_QA);
    await escribirOta(MANIFIESTO_OTA, { percent: 0, paused: false, allow: [] });
    const otaCero = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar('OTA con percent 0 responde {"update":false}',
      otaCero.estado === 200 && comoJson(otaCero).update === false, `estado=${otaCero.estado}`);
    await escribirOta(MANIFIESTO_OTA, { percent: bucketQa + 1, paused: false, allow: [] });
    const otaBucketSi = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar(`OTA con percent por encima del bucket estable (${bucketQa + 1}) entrega el manifiesto`,
      otaBucketSi.estado === 200 && comoJson(otaBucketSi).versionCode === MANIFIESTO_OTA.versionCode,
      `estado=${otaBucketSi.estado}`);
    await escribirOta(MANIFIESTO_OTA, { percent: bucketQa, paused: false, allow: [] });
    const otaBucketNo = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    const otaBucketNoB = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar(`OTA con percent igual al bucket estable (${bucketQa}) responde {"update":false} y de forma estable`,
      otaBucketNo.estado === 200 && comoJson(otaBucketNo).update === false &&
      otaBucketNoB.estado === 200 && comoJson(otaBucketNoB).update === false &&
      otaBucketNo.texto === otaBucketNoB.texto,
      `estado=${otaBucketNo.estado}`);
    await escribirOta(MANIFIESTO_OTA, { percent: 100, paused: false, allow: [] });
    const otaCien = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar('OTA con percent 100 entrega el manifiesto',
      otaCien.estado === 200 && comoJson(otaCien).versionCode === MANIFIESTO_OTA.versionCode,
      `estado=${otaCien.estado}`);

    await rm(rutaOtaLatest, { force: true });
    const otaSinManifiesto = await pedirOta(MANIFIESTO_OTA.versionCode - 1);
    comprobar('OTA sin latest.json responde 404', otaSinManifiesto.estado === 404,
      `estado=${otaSinManifiesto.estado}`);
    await escribirOta(MANIFIESTO_OTA, null);

    const otaClaveMala = await pedirOta(MANIFIESTO_OTA.versionCode - 1, { 'x-api-key': 'clave-incorrecta' });
    comprobar('OTA con clave invalida responde 401', otaClaveMala.estado === 401,
      `estado=${otaClaveMala.estado}`);
    const otaSinVersion = await pedir(
      `/api/mobile/v1/ota?deviceId=${encodeURIComponent(DISPOSITIVO_QA)}`,
      { headers: { 'x-api-key': clave } },
    );
    comprobar('OTA sin versionCode responde 400', otaSinVersion.estado === 400,
      `estado=${otaSinVersion.estado}`);
    const otaDesconocida = await pedirOta(MANIFIESTO_OTA.versionCode - 1, { 'x-device-id': 'no-existe-humo' });
    comprobar('OTA con dispositivo desconocido responde 404', otaDesconocida.estado === 404,
      `estado=${otaDesconocida.estado}`);

    // 8b. Canal apagado: OTA responde 503 (servidor aparte con DMJ_CANAL_MOVIL=0).
    const puertoApagado = await puertoLibre();
    const baseApagado = `http://127.0.0.1:${puertoApagado}`;
    const hijoApagado = spawn(process.execPath, [RUTA_SERVIDOR], {
      cwd: resolve(AQUI, '..'),
      env: {
        ...process.env,
        DMJ_TRACKING_HOST: '127.0.0.1',
        DMJ_TRACKING_PORT: String(puertoApagado),
        DMJ_CANAL_MOVIL: '0',
        DMJ_OTA_DIR: dirOta,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let estadoApagado = null;
    const inicioApagado = Date.now();
    try {
      while (Date.now() - inicioApagado < 15_000 && hijoApagado.exitCode === null) {
        try {
          const respuesta = await fetch(
            `${baseApagado}/api/mobile/v1/ota?deviceId=${encodeURIComponent(DISPOSITIVO_QA)}&versionCode=1`,
            { headers: { 'x-api-key': clave } },
          );
          estadoApagado = respuesta.status;
          break;
        } catch {
          await esperar(200);
        }
      }
      comprobar('OTA con canal apagado (DMJ_CANAL_MOVIL=0) responde 503',
        estadoApagado === 503, `estado=${estadoApagado ?? 'sin respuesta'}`);
    } finally {
      if (hijoApagado.exitCode === null && hijoApagado.signalCode === null) {
        hijoApagado.kill('SIGTERM');
        await Promise.race([once(hijoApagado, 'exit'), esperar(5000)]).catch(() => {});
      }
      if (hijoApagado.exitCode === null && hijoApagado.signalCode === null) hijoApagado.kill('SIGKILL');
    }

    // 9. FCM real: token completo en iam.dmt_token_fcm.
    const fcmUno = await pedir('/api/mobile/v1/fcm-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
      body: JSON.stringify({ fcmToken: tokenFcm, appVersion: 'humo-ota', platform: 'android' }),
    });
    comprobar('fcm-token responde 200 {ok:true}', fcmUno.estado === 200 && comoJson(fcmUno).ok === true,
      `estado=${fcmUno.estado}`);
    const filaToken = (
      await pool.query(
        `SELECT dispositivo_id, token, activo, invalido, ultimo_uso_en
           FROM iam.dmt_token_fcm WHERE token = $1`,
        [tokenFcm],
      )
    ).rows[0];
    comprobar('iam.dmt_token_fcm guarda el token completo con ultimo_uso_en',
      filaToken !== undefined && String(filaToken.dispositivo_id) === idDispositivo &&
      filaToken.token === tokenFcm && filaToken.activo === true && filaToken.invalido === false &&
      filaToken.ultimo_uso_en instanceof Date, `filas=${filaToken ? 1 : 0}`);

    const fcmDos = await pedir('/api/mobile/v1/fcm-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
      body: JSON.stringify({ fcmToken: tokenFcm, appVersion: 'humo-ota-2' }),
    });
    const filasToken = (
      await pool.query('SELECT count(*)::int AS total FROM iam.dmt_token_fcm WHERE token = $1', [tokenFcm])
    ).rows[0].total;
    const attrsFcm = (
      await pool.query('SELECT atributos FROM tracking.dmt_dispositivo WHERE id = $1', [idDispositivo])
    ).rows[0].atributos;
    comprobar('fcm-token repetido hace upsert (una fila) y marca mobile.fcm*',
      fcmDos.estado === 200 && filasToken === 1 &&
      attrsFcm['mobile.fcmTokenRegistered'] === true &&
      Number(attrsFcm['mobile.fcmUpdatedAt']) >= t1 &&
      attrsFcm['mobile.appVersion'] === 'humo-ota-2',
      `filas=${filasToken}`);

    // 10. recovery-ack: fila en operations.dmt_alerta.
    const ack = await pedir('/api/mobile/v1/recovery-ack', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
      body: JSON.stringify({
        recoveryAttemptId: intentoRecuperacion,
        stage: 'TRACKING_ACTIVE',
        priority: 'HIGH',
        reason: 'humo',
      }),
    });
    comprobar('recovery-ack responde 200 {ok:true}', ack.estado === 200 && comoJson(ack).ok === true,
      `estado=${ack.estado}`);
    const filaAlerta = (
      await pool.query(
        `SELECT origen, dispositivo_id, tipo, estado, atributos
           FROM operations.dmt_alerta
          WHERE tipo = 'recovery_ack' AND atributos->>'attemptId' = $1`,
        [intentoRecuperacion],
      )
    ).rows[0];
    comprobar('operations.dmt_alerta registra recovery_ack con attemptId/stage/priority/reason',
      filaAlerta !== undefined && filaAlerta.origen === 'recuperacion' &&
      String(filaAlerta.dispositivo_id) === idDispositivo &&
      filaAlerta.atributos.stage === 'TRACKING_ACTIVE' && filaAlerta.atributos.priority === 'HIGH' &&
      filaAlerta.atributos.reason === 'humo', `filas=${filaAlerta ? 1 : 0}`);

    // 11. Lote de puntos: aceptado, duplicado, inválido y equipo deshabilitado.
    const pedirLote = async (eventos, cabeceras = {}) => {
      const respuesta = await fetch(`${base}/api/mobile/v1/positions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': clave,
          'x-device-id': DISPOSITIVO_QA,
          ...cabeceras,
        },
        body: JSON.stringify({ eventos }),
      });
      const texto = await respuesta.text();
      let json = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null;
      }
      return { estado: respuesta.status, json };
    };
    const columnasIdempotencia = (
      await pool.query(
        `SELECT count(*)::int AS total FROM information_schema.columns
          WHERE table_schema = 'tracking' AND table_name = 'dmt_posicion'
            AND column_name IN ('boot_id', 'local_sequence')`,
      )
    ).rows[0].total === 2;
    const loteValido = [
      {
        bootId: bootLote, seq: 1, journeyId: jornadaId, capturedAt: new Date(tLote1).toISOString(),
        lat: -2.1894, lon: -79.8891, alt: 35, speed: 23.1, bearing: 91,
        accuracy: 8, battery: 77, charging: true, mock: false,
        provider: 'fused', movementState: 'ACTIVE',
      },
      {
        bootId: bootLote, seq: 2, journeyId: jornadaId, capturedAt: new Date(tLote2).toISOString(),
        lat: -2.19, lon: -79.89, accuracy: 9, battery: 76, mock: false,
      },
    ];
    const loteUno = await pedirLote(loteValido);
    comprobar('lote responde 200 con resultados accepted',
      loteUno.estado === 200 && Array.isArray(loteUno.json?.resultados) &&
      loteUno.json.resultados.length === 2 &&
      loteUno.json.resultados.every((r) => r.estado === 'accepted'),
      `estado=${loteUno.estado} ${JSON.stringify(loteUno.json)?.slice(0, 200)}`);
    const filasLote = (
      await pool.query(
        `SELECT id, registrado_en FROM tracking.dmt_posicion
          WHERE dispositivo_id = $1 AND registrado_en = ANY($2::timestamptz[])
          ORDER BY registrado_en`,
        [idDispositivo, [new Date(tLote1), new Date(tLote2)]],
      )
    ).rows;
    comprobar('lote guarda las dos posiciones', filasLote.length === 2, `filas=${filasLote.length}`);
    for (const fila of filasLote) posicionesCreadas.push(String(fila.id));

    const loteRepetido = await pedirLote(loteValido);
    const estadosRepetidos = (loteRepetido.json?.resultados ?? []).map((r) => r.estado);
    if (columnasIdempotencia) {
      comprobar('lote repetido clasifica duplicate sin duplicar filas',
        loteRepetido.estado === 200 && estadosRepetidos.every((e) => e === 'duplicate'),
        `estados=${estadosRepetidos.join(',')}`);
      const conteoTrasDupe = (
        await pool.query(
          `SELECT count(*)::int AS total FROM tracking.dmt_posicion
            WHERE dispositivo_id = $1 AND registrado_en = ANY($2::timestamptz[])`,
          [idDispositivo, [new Date(tLote1), new Date(tLote2)]],
        )
      ).rows[0].total;
      comprobar('duplicado no crea filas nuevas', conteoTrasDupe === 2, `total=${conteoTrasDupe}`);
    } else {
      // Sin control de repetidos el receptor acepta los dos y la prueba borra
      // los sobrantes por hora.
      comprobar('lote sin columnas 002 acepta (dedupe pendiente de migración)',
        loteRepetido.estado === 200 && estadosRepetidos.every((e) => e === 'accepted'),
        `estados=${estadosRepetidos.join(',')}`);
      const extras = (
        await pool.query(
          `SELECT id FROM tracking.dmt_posicion
            WHERE dispositivo_id = $1 AND registrado_en = ANY($2::timestamptz[])
            ORDER BY id`,
          [idDispositivo, [new Date(tLote1), new Date(tLote2)]],
        )
      ).rows.map((fila) => String(fila.id));
      for (const id of extras) {
        if (!posicionesCreadas.includes(id)) posicionesCreadas.push(id);
      }
    }

    const loteInvalido = await pedirLote([
      // Fecha imposible: invalid sin guardar.
      { bootId: bootLote, seq: 3, capturedAt: '2037-10-15T18:59:35.000Z', lat: -2.19, lon: -79.89 },
      // Sin identidad y fuera de rango: invalid.
      { bootId: '', seq: -1, capturedAt: new Date(tLote1).toISOString(), lat: 999, lon: -79.89 },
    ]);
    comprobar('lote con fechas/coordenadas absurdas responde invalid',
      loteInvalido.estado === 200 &&
      loteInvalido.json?.resultados?.[0]?.estado === 'invalid' &&
      loteInvalido.json?.resultados?.[1]?.estado === 'invalid',
      `estado=${loteInvalido.estado}`);
    const loteLimite = await pedirLote(new Array(501).fill(loteValido[0]));
    comprobar('lote con más de 500 eventos responde 413', loteLimite.estado === 413,
      `estado=${loteLimite.estado}`);
    const loteClaveMala = await pedirLote(loteValido, { 'x-api-key': 'clave-incorrecta' });
    comprobar('lote con clave inválida responde 401', loteClaveMala.estado === 401,
      `estado=${loteClaveMala.estado}`);

    // 12. Jornada GET para reconciliación (tras el stop queda cerrada).
    const jornadaGet = await fetch(`${base}/api/mobile/v1/journey`, {
      headers: { 'x-api-key': clave, 'x-device-id': DISPOSITIVO_QA },
    });
    const jornadaGetJson = await jornadaGet.json().catch(() => null);
    comprobar('GET journey responde 200 con estado/journeyId/inicioEn',
      jornadaGet.status === 200 &&
      ['abierta', 'cerrada', 'ninguna'].includes(jornadaGetJson?.estado) &&
      ('journeyId' in (jornadaGetJson ?? {})) && ('inicioEn' in (jornadaGetJson ?? {})),
      `estado=${jornadaGet.status} cuerpo=${JSON.stringify(jornadaGetJson)?.slice(0, 160)}`);
    const jornadaGetClaveMala = await fetch(`${base}/api/mobile/v1/journey`, {
      headers: { 'x-api-key': 'clave-incorrecta', 'x-device-id': DISPOSITIVO_QA },
    });
    comprobar('GET journey con clave inválida responde 401', jornadaGetClaveMala.status === 401,
      `estado=${jornadaGetClaveMala.status}`);

    // 13. OsmAnd con fecha imposible: 200 sin guardar.
    const absurda = await pedir(`/?id=${DISPOSITIVO_QA}&timestamp=2147483647000&lat=-2.19&lon=-79.89`);
    comprobar('OsmAnd con fecha 2038 responde 200 sin guardar', absurda.estado === 200,
      `estado=${absurda.estado}`);
    const filaAbsurda = (
      await pool.query(
        `SELECT count(*)::int AS total FROM tracking.dmt_posicion
          WHERE dispositivo_id = $1 AND registrado_en > now() + interval '24 hours'`,
        [idDispositivo],
      )
    ).rows[0].total;
    // Solo cuenta fechas de más de 24 h adelante; la prueba no deja ninguna.
    comprobar('fecha absurda no crea partición ni fila futura', filaAbsurda === 0,
      `futuras=${filaAbsurda}`);

    // 14. Particiones mes+2 precreadas al arrancar (posiciones y eventos).
    const nombreMes = (desplazamiento) => {
      const base = new Date();
      const fecha = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + desplazamiento, 1));
      const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
      return `${fecha.getUTCFullYear()}_${mes}`;
    };
    const particiones = (
      await pool.query(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = 'tracking' AND tablename LIKE 'dmt_posicion_%'
             OR schemaname = 'tracking' AND tablename LIKE 'dmt_evento_%'`,
      )
    ).rows.map((fila) => fila.tablename);
    const mesesEsperados = [0, 1, 2].map(nombreMes);
    const posicionesOk = mesesEsperados.every((mes) => particiones.includes(`dmt_posicion_${mes}`));
    comprobar('particiones mes+2 de posiciones precreadas', posicionesOk,
      `meses=${mesesEsperados.join(',')}`);
  } finally {
    await detenerServidor();
    describirUnaVez();

    // Limpieza: primero lo creado por el humo, despues la restauracion exacta.
    try {
      const encontradas = await pool.query(
        `SELECT id FROM tracking.dmt_posicion
          WHERE dispositivo_id = $1 AND registrado_en = ANY($2::timestamptz[])`,
        [idDispositivo, [new Date(t1), new Date(t2), new Date(tLote1), new Date(tLote2)]],
      );
      const ids = [...new Set([...posicionesCreadas, ...encontradas.rows.map((fila) => String(fila.id))])];
      if (ids.length > 0) {
        await pool.query('DELETE FROM tracking.dmt_posicion WHERE id = ANY($1::bigint[])', [ids]);
        await pool.query(
          'DELETE FROM tracking.dmt_posicion_actual WHERE dispositivo_id = $1 AND posicion_id = ANY($2::bigint[])',
          [idDispositivo, ids],
        );
      }
      await pool.query(
        `DELETE FROM operations.dmt_jornada
          WHERE dispositivo_id = $1 AND atributos->>'journeyId' = $2`,
        [idDispositivo, String(jornadaId)],
      );
      await pool.query(
        'DELETE FROM telemetry.dmt_bateria WHERE dispositivo_id = $1 AND registrado_en = $2',
        [idDispositivo, new Date(tsDiagnostico)],
      );
      await pool.query(
        `DELETE FROM tracking.dmt_evento
          WHERE dispositivo_id = $1 AND atributos->>'journeyId' = $2`,
        [idDispositivo, String(jornadaId)],
      );
      await pool.query('DELETE FROM iam.dmt_token_fcm WHERE token = $1', [tokenFcm]);
      await pool.query(
        `DELETE FROM operations.dmt_alerta
          WHERE tipo = 'recovery_ack' AND atributos->>'attemptId' = $1`,
        [intentoRecuperacion],
      );
      await rm(dirOta, { recursive: true, force: true });
      for (const abierta of jornadasAbiertas) {
        await pool.query(
          `UPDATE operations.dmt_jornada
              SET estado = $2, fin_en = $3, duracion_s = $4, bateria_fin_pct = $5, actualizado_en = $6
            WHERE id = $1`,
          [abierta.id, abierta.estado, abierta.fin_en, abierta.duracion_s,
            abierta.bateria_fin_pct, abierta.actualizado_en],
        );
      }
      if (actualAntes) {
        const columnas = Object.keys(actualAntes);
        const marcadores = columnas.map((_, indice) => `$${indice + 1}`);
        const valores = columnas.map((columna) => (
          columna === 'atributos' ? JSON.stringify(actualAntes[columna]) : actualAntes[columna]
        ));
        await pool.query(
          `INSERT INTO tracking.dmt_posicion_actual (${columnas.join(', ')})
           VALUES (${marcadores.map((m, i) => (columnas[i] === 'atributos' ? `${m}::jsonb` : m)).join(', ')})
           ON CONFLICT (dispositivo_id) DO UPDATE SET
             posicion_id = EXCLUDED.posicion_id, latitud = EXCLUDED.latitud,
             longitud = EXCLUDED.longitud, altitud_m = EXCLUDED.altitud_m,
             velocidad_kmh = EXCLUDED.velocidad_kmh, rumbo_grados = EXCLUDED.rumbo_grados,
             precision_m = EXCLUDED.precision_m, bateria_pct = EXCLUDED.bateria_pct,
             valida = EXCLUDED.valida, fijado_en = EXCLUDED.fijado_en,
             registrado_en = EXCLUDED.registrado_en, recibido_en = EXCLUDED.recibido_en,
             atributos = EXCLUDED.atributos, actualizado_en = EXCLUDED.actualizado_en`,
          valores,
        );
      }
      await pool.query(
        `UPDATE tracking.dmt_dispositivo
            SET estado = $2, ultima_conexion_en = $3, ultima_posicion_id = $4,
                atributos = $5::jsonb, habilitado = $6, actualizado_en = now()
          WHERE id = $1`,
        [idDispositivo, dispositivo.estado, dispositivo.ultima_conexion_en,
          dispositivo.ultima_posicion_id, JSON.stringify(dispositivo.atributos), habilitadoOriginal],
      );
      log.info('limpieza aplicada');
    } catch (error) {
      fallos += 1;
      log.error(`limpieza: ${error.message}`);
    }

    const despues = {
      posiciones: await contar('tracking.dmt_posicion', 'dispositivo_id = $1', [idDispositivo]),
      posicionActual: await contar('tracking.dmt_posicion_actual', 'dispositivo_id = $1', [idDispositivo]),
      jornadas: await contar('operations.dmt_jornada', 'dispositivo_id = $1', [idDispositivo]),
      baterias: await contar('telemetry.dmt_bateria', 'dispositivo_id = $1', [idDispositivo]),
      eventos: await contar('tracking.dmt_evento', 'dispositivo_id = $1', [idDispositivo]),
      tokens: await contar('iam.dmt_token_fcm', 'dispositivo_id = $1', [idDispositivo]),
      alertas: await contar('operations.dmt_alerta', 'dispositivo_id = $1', [idDispositivo]),
    };
    comprobar('limpieza: posiciones igual que antes',
      despues.posiciones === antes.posiciones, `${antes.posiciones} -> ${despues.posiciones}`);
    comprobar('limpieza: posicion actual igual que antes',
      despues.posicionActual === antes.posicionActual, `${antes.posicionActual} -> ${despues.posicionActual}`);
    comprobar('limpieza: jornadas igual que antes',
      despues.jornadas === antes.jornadas, `${antes.jornadas} -> ${despues.jornadas}`);
    comprobar('limpieza: baterias igual que antes',
      despues.baterias === antes.baterias, `${antes.baterias} -> ${despues.baterias}`);
    comprobar('limpieza: eventos igual que antes',
      despues.eventos === antes.eventos, `${antes.eventos} -> ${despues.eventos}`);
    comprobar('limpieza: tokens FCM igual que antes',
      despues.tokens === antes.tokens, `${antes.tokens} -> ${despues.tokens}`);
    comprobar('limpieza: alertas igual que antes',
      despues.alertas === antes.alertas, `${antes.alertas} -> ${despues.alertas}`);
    const atributosFinales = (
      await pool.query('SELECT atributos FROM tracking.dmt_dispositivo WHERE id = $1', [idDispositivo])
    ).rows[0].atributos;
    comprobar('limpieza: atributos del dispositivo restaurados',
      JSON.stringify(atributosFinales) === JSON.stringify(dispositivo.atributos));

    await pool.end();
  }
}

humo()
  .then(() => {
    console.log(fallos === 0 ? 'PASS' : `FAIL (${fallos} comprobaciones)`);
    process.exitCode = fallos === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error(`[smoke] ERROR ${error.message}`);
    console.log('FAIL');
    process.exitCode = 1;
  });
