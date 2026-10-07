// Rutas que usa la app (/api/mobile/v1/...). Cada pedido trae la clave del
// canal (X-Api-Key, se acepta la actual y la anterior) o el token de sesión,
// y el equipo en X-Device-Id.

import { createHash, timingSafeEqual, randomBytes, pbkdf2Sync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { filaSalud } from './salud.js';
import { alertasDeDiagnostico } from './alertas.js';
import {
  MENSAJE_OTRO_TELEFONO,
  limpiarFallos,
  mensajeBloqueo,
  minutosBloqueo,
  registrarFallo,
  sesionEnOtroTelefono,
} from '../../comun/acceso.js';

const LIMITE_JSON = 64 * 1024;
const LIMITE_DIAGNOSTICO = 10_000;
// Un lote de hasta 500 puntos (unos 200 B cada uno) entra en 512 KB; más
// grande se rechaza con 413.
const LIMITE_LOTE = 512 * 1024;
const MAX_EVENTOS_LOTE = 500;
const VENTANA_ANTIRREBOTE = 20_000;
const VENTANA_AUDITORIA_OTA = 60_000;
const MAX_TOKEN = 512;
const MAX_TEXTO = 64;
const MAX_INTENTO_RECUPERACION = 128;
const MAX_ETAPA_RECUPERACION = 32;
const MAX_PRIORIDAD_RECUPERACION = 32;
const MAX_RAZON_RECUPERACION = 512;

const ultimosDiagnosticos = new Map();

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

export function responderSinCuerpo(res, codigo) {
  res.writeHead(codigo, { 'cache-control': 'no-store' });
  res.end();
}

export function responderJson(res, codigo, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    'cache-control': 'no-store',
  });
  res.end(texto);
}

// ---------------------------------------------------------------------------
// Autenticacion y lectura de la peticion
// ---------------------------------------------------------------------------

function claveValida(cabecera, claves) {
  if (typeof cabecera !== 'string' || cabecera === '' || claves.length === 0) {
    return false;
  }
  const dada = Buffer.from(cabecera, 'utf8');
  let valida = false;
  for (const clave of claves) {
    const esperada = Buffer.from(clave, 'utf8');
    if (dada.length === esperada.length && timingSafeEqual(dada, esperada)) {
      valida = true;
    }
  }
  return valida;
}

// ---------------------------------------------------------------------------
// Sesión de la app: usuario y clave, y después un token en cada pedido
// ---------------------------------------------------------------------------
// El token se guarda en iam.dmt_sesion con tipo 'movil' (solo su SHA-256).
// Las demás rutas aceptan la clave compartida X-Api-Key o este token.

// Valores que recibe la app cuando ni el equipo ni la persona tienen otro.
// Deben coincidir con CONFIG_POR_DEFECTO de servidor/api/src/esquema.js.
const CONFIG_MOVIL_POR_DEFECTO = {
  intervalSeconds: 10,
  bufferMax: 5000,
  bufferPolicy: 'drop_oldest',
  ackTimeoutSeconds: 15,
  maxRetries: 30,
  distanceMeters: 10,
  angleDegrees: 15,
  accuracy: 'high',
  bufferEnabled: true,
  l1_pending_intent_enabled: false,
  store_all_enabled: false,
  l1_max_update_delay_ms: 60000,
  min_interval_seconds: 10,
};

const CLAVES_CONFIG_MOVIL = Object.keys(CONFIG_MOVIL_POR_DEFECTO);

// Mismo formato de contraseña que la API (PBKDF2-HMAC-SHA1, 1000 vueltas, 24 bytes, hex).
const ITERACIONES_CLAVE = 1000;
const BYTES_CLAVE = 24;
const HEX_24_BYTES = /^[0-9a-fA-F]{48}$/;
const SAL_DESCARTE = Buffer.from('00112233445566778899aabbccddeeff0011223344556677', 'hex');

function verificarClaveMovil(clave, hashHex, salHex) {
  const sal = typeof salHex === 'string' && HEX_24_BYTES.test(salHex) ? Buffer.from(salHex, 'hex') : SAL_DESCARTE;
  const esperado =
    typeof hashHex === 'string' && HEX_24_BYTES.test(hashHex) ? Buffer.from(hashHex, 'hex') : Buffer.alloc(BYTES_CLAVE);
  const calculado = pbkdf2Sync(clave, sal, ITERACIONES_CLAVE, BYTES_CLAVE, 'sha1');
  return typeof hashHex === 'string' && HEX_24_BYTES.test(hashHex) && timingSafeEqual(esperado, calculado);
}

function hashSesion(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function tokenPortador(req) {
  const cabecera = req.headers['authorization'];
  if (typeof cabecera !== 'string') return null;
  const coincidencia = /^Bearer\s+(.+)$/.exec(cabecera.trim());
  if (!coincidencia) return null;
  const token = coincidencia[1].trim();
  return token !== '' && token.length <= 512 ? token : null;
}

async function validarTokenMovil(pool, token) {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.expira_en, u.id AS usuario_id, u.nombre
         FROM iam.dmt_sesion s
         JOIN iam.dmt_usuario u ON u.id = s.usuario_id
        WHERE s.token_hash = $1
          AND s.revocada_en IS NULL
          AND (s.expira_en IS NULL OR s.expira_en > now())
          AND u.habilitado
        LIMIT 1`,
      [hashSesion(token)],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Clave compartida (flota instalada) o sesión Bearer (app con login).
export async function autorizacionMovil(req, ctx) {
  if (claveValida(req.headers['x-api-key'], ctx.configuracion.clavesMoviles)) {
    return { modo: 'clave' };
  }
  const token = tokenPortador(req);
  if (!token || !ctx.almacen?.pool) return null;
  const sesion = await validarTokenMovil(ctx.almacen.pool, token);
  return sesion ? { modo: 'sesion', sesion } : null;
}

function direccionCliente(req) {
  const reenviada = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const candidata = reenviada || req.socket?.remoteAddress || '';
  const limpia = candidata.replace(/^\[|\]$/g, '');
  return /^[0-9a-fA-F:.]{3,45}$/.test(limpia) ? limpia : null;
}

function agenteCliente(req) {
  const agente = req.headers['user-agent'];
  return typeof agente === 'string' ? agente.slice(0, 300) : null;
}

// Solo pasan claves conocidas con el tipo esperado; un ajuste viejo no rompe
// el inicio de sesión.
function filtrarConfigApp(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const limpia = {};
  for (const [clave, dato] of Object.entries(valor)) {
    if (!CLAVES_CONFIG_MOVIL.includes(clave)) continue;
    const defecto = CONFIG_MOVIL_POR_DEFECTO[clave];
    if (typeof defecto === 'boolean' && typeof dato === 'boolean') limpia[clave] = dato;
    else if (typeof defecto === 'number' && typeof dato === 'number' && Number.isFinite(dato)) limpia[clave] = dato;
    else if (typeof defecto === 'string' && typeof dato === 'string' && dato.length <= 500) limpia[clave] = dato;
  }
  return limpia;
}

// POST /api/mobile/v1/sesion {usuario, clave, instalacion} -> {token,
// expiraEn, usuario:{nombre}, configuracion}. 401 sin decir si el usuario
// existe, 423 con la cuenta bloqueada, 409 si la cuenta ya está abierta en
// otro teléfono, 400 si faltan datos y 503 con el canal apagado.
export async function atenderSesion(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 503);
  const lectura = await leerJson(req, LIMITE_JSON);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const datos = objeto(lectura.datos);
  const identificador = datos ? texto(datos.usuario) : null;
  const clave = datos && typeof datos.clave === 'string' ? datos.clave : '';
  if (!identificador || !clave) return responderSinCuerpo(res, 400);
  // Identificador de la instalación de la app (cambia si se reinstala).
  const instalacion = datos && typeof datos.instalacion === 'string' && /^[\w-]{8,64}$/.test(datos.instalacion)
    ? datos.instalacion
    : null;
  let fila = null;
  try {
    const resultado = await ctx.almacen.pool.query(
      `SELECT u.id, u.nombre, u.nombre_usuario, u.correo, u.habilitado,
              u.hash_clave, u.sal, u.atributos, u.bloqueado_hasta
         FROM iam.dmt_usuario u
        WHERE lower(u.nombre_usuario) = lower($1) OR lower(u.correo) = lower($1)
        LIMIT 1`,
      [identificador],
    );
    fila = resultado.rows[0] ?? null;
  } catch (error) {
    ctx.log.error(`movil/sesion: fallo al buscar usuario: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  const bloqueo = minutosBloqueo(fila?.bloqueado_hasta);
  if (bloqueo > 0) {
    return responderJson(res, 423, { error: { codigo: 'CUENTA_BLOQUEADA', mensaje: mensajeBloqueo(bloqueo) } });
  }
  // Mensaje único para no revelar si el usuario existe o está deshabilitado.
  if (!fila || !verificarClaveMovil(clave, fila.hash_clave, fila.sal) || !fila.habilitado) {
    const minutos = fila && fila.habilitado ? await registrarFallo(ctx.almacen.pool, fila.id).catch(() => 0) : 0;
    if (minutos > 0) {
      return responderJson(res, 423, { error: { codigo: 'CUENTA_BLOQUEADA', mensaje: mensajeBloqueo(minutos) } });
    }
    return responderJson(res, 401, {
      error: { codigo: 'NO_AUTENTICADO', mensaje: 'Usuario o clave incorrectos.' },
    });
  }
  try {
    await limpiarFallos(ctx.almacen.pool, fila.id);
    if (await sesionEnOtroTelefono(ctx.almacen.pool, fila.id, instalacion)) {
      return responderJson(res, 409, { error: { codigo: 'SESION_EN_OTRO_TELEFONO', mensaje: MENSAJE_OTRO_TELEFONO } });
    }
    // Entrar de nuevo desde el mismo teléfono reemplaza su sesión anterior.
    if (instalacion) {
      await ctx.almacen.pool.query(
        `UPDATE iam.dmt_sesion SET revocada_en = now(), actualizado_en = now()
          WHERE usuario_id = $1 AND tipo = 'movil' AND revocada_en IS NULL AND instalacion = $2`,
        [fila.id, instalacion],
      );
    }
  } catch (error) {
    ctx.log.error(`movil/sesion: fallo al revisar sesiones: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  const horas = Number.isFinite(Number(ctx.configuracion.sesionMovilHoras))
    ? Number(ctx.configuracion.sesionMovilHoras)
    : 720;
  const token = randomBytes(32).toString('base64url');
  let expiraEn = null;
  try {
    const creada = await ctx.almacen.pool.query(
      `INSERT INTO iam.dmt_sesion (usuario_id, token_hash, tipo, direccion_ip, agente, expira_en, instalacion)
       VALUES ($1, $2, 'movil', $3, $4, now() + ($5::numeric * interval '1 hour'), $6)
       RETURNING expira_en`,
      [fila.id, hashSesion(token), direccionCliente(req), agenteCliente(req), horas, instalacion],
    );
    expiraEn = creada.rows[0]?.expira_en ?? null;
    await ctx.almacen.pool.query('UPDATE iam.dmt_usuario SET ultimo_acceso_en = now() WHERE id = $1', [fila.id]);
  } catch (error) {
    ctx.log.error(`movil/sesion: fallo al crear sesion: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  const atributos = fila.atributos ?? {};
  const configuracion = {
    ...CONFIG_MOVIL_POR_DEFECTO,
    ...filtrarConfigApp(atributos.configApp),
  };
  // Equipo de la persona: la app adopta su identificador al entrar, asi la
  // ruta de quien inicia sesion queda bajo su equipo. Sin equipo vinculado
  // (cuentas antiguas o de flota) el movil conserva su identificador actual.
  let equipo = null;
  try {
    const equipos = await ctx.almacen.pool.query(
      `SELECT d.identificador, d.nombre
         FROM operations.dmt_asignacion a
         JOIN tracking.dmt_dispositivo d ON d.id = a.dispositivo_id
        WHERE a.usuario_id = $1 AND a.activa
          AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())
          AND d.habilitado
        ORDER BY d.nombre, d.id
        LIMIT 1`,
      [fila.id],
    );
    if (equipos.rows[0]) {
      equipo = { identificador: equipos.rows[0].identificador, nombre: equipos.rows[0].nombre };
    }
  } catch (error) {
    ctx.log.warn(`movil/sesion: fallo al leer equipo de la cuenta: ${error.message}`);
  }
  return responderJson(res, 200, {
    token,
    expiraEn: expiraEn instanceof Date ? expiraEn.toISOString() : new Date(expiraEn).toISOString(),
    usuario: { nombre: fila.nombre },
    equipo,
    configuracion,
  });
}

async function leerCuerpo(req, limite) {
  const trozos = [];
  let total = 0;
  let excedido = false;
  for await (const trozo of req) {
    if (excedido) continue;
    total += trozo.length;
    if (total > limite) {
      excedido = true;
      continue;
    }
    trozos.push(trozo);
  }
  if (excedido) return { ok: false, motivo: 'grande' };
  return { ok: true, buffer: Buffer.concat(trozos) };
}

export async function leerJson(req, limite) {
  const lectura = await leerCuerpo(req, limite);
  if (!lectura.ok) return lectura;
  const texto = lectura.buffer.toString('utf8');
  if (texto.trim() === '') return { ok: true, datos: {} };
  try {
    return { ok: true, datos: JSON.parse(texto) };
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
}

export function identificadorDe(req, url) {
  const cabecera = req.headers['x-device-id'];
  if (typeof cabecera === 'string' && cabecera.trim() !== '') return cabecera.trim();
  const consulta = url.searchParams.get('deviceId');
  return consulta !== null && consulta.trim() !== '' ? consulta.trim() : null;
}

function identificadorDeCabecera(req) {
  const cabecera = req.headers['x-device-id'];
  return typeof cabecera === 'string' && cabecera.trim() !== '' ? cabecera.trim() : null;
}

// ---------------------------------------------------------------------------
// Conversiones de valores (mismos defaults que el servidor actual)
// ---------------------------------------------------------------------------

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const convertido = Number(String(valor).trim());
  return Number.isFinite(convertido) ? convertido : null;
}

function entero(valor, defecto) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.trunc(valor);
  if (typeof valor === 'string' && /^-?\d+$/.test(valor.trim())) {
    return Number.parseInt(valor.trim(), 10);
  }
  return defecto;
}

export function texto(valor) {
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    return limpio === '' ? null : limpio;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

function booleanoJson(valor) {
  return typeof valor === 'boolean' ? valor : null;
}

export function objeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor : null;
}

function numeroAttr(attrs, clave, defecto) {
  const valor = attrs[clave];
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.trunc(valor);
  if (typeof valor === 'string' && /^-?\d+$/.test(valor.trim())) {
    return Number.parseInt(valor.trim(), 10);
  }
  return defecto;
}

function textoAttr(attrs, clave, defecto) {
  const valor = attrs[clave];
  return valor !== null && valor !== undefined ? String(valor) : defecto;
}

function booleanoAttr(attrs, clave, defecto) {
  const valor = attrs[clave];
  if (typeof valor === 'boolean') return valor;
  if (valor !== null && valor !== undefined) return String(valor).trim().toLowerCase() === 'true';
  return defecto;
}

function prefijoToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12);
}

function idCoincide(reportado, dispositivo) {
  if (reportado === null || reportado === undefined) return true;
  const valor = String(reportado).trim();
  if (valor === '') return true;
  if (/^\d+$/.test(valor)) return valor === String(dispositivo.id);
  return valor.toLowerCase() === dispositivo.identificador.toLowerCase();
}

export async function buscarOFallar(ctx, res, identificador, codigoDesconocido) {
  let dispositivo;
  try {
    dispositivo = await ctx.almacen.buscarDispositivo(identificador);
  } catch (error) {
    ctx.log.error(`movil: fallo al buscar dispositivo: ${error.message}`);
    responderSinCuerpo(res, 503);
    return null;
  }
  if (!dispositivo) {
    responderSinCuerpo(res, codigoDesconocido);
    return null;
  }
  return dispositivo;
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/config
// ---------------------------------------------------------------------------

export async function atenderConfig(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 503);
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const identificador = identificadorDe(req, ctx.url);
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  const attrs = dispositivo.atributos;
  // La configuración sale en este orden: la del equipo (Configuración del
  // panel), la de la persona asignada (Usuarios) y el valor por defecto. La
  // app la vuelve a pedir cada 10 minutos.
  let persona = {};
  try {
    const { rows } = await ctx.almacen.pool.query(
      `SELECT u.atributos->'configApp' AS config
         FROM operations.dmt_asignacion a
         JOIN iam.dmt_usuario u ON u.id = a.usuario_id
        WHERE a.dispositivo_id = $1 AND a.activa
          AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())
          AND u.habilitado AND NOT u.administrador
        ORDER BY a.desde_en DESC
        LIMIT 1`,
      [dispositivo.id],
    );
    persona = filtrarConfigApp(rows[0]?.config);
  } catch (error) {
    ctx.log.warn(`movil/config: no se pudo leer la configuración de la persona: ${error.message}`);
  }
  const base = { ...CONFIG_MOVIL_POR_DEFECTO, ...persona };
  return responderJson(res, 200, {
    intervalSeconds: numeroAttr(attrs, 'mobile.intervalSeconds', base.intervalSeconds),
    bufferMax: numeroAttr(attrs, 'mobile.bufferMax', base.bufferMax),
    bufferPolicy: textoAttr(attrs, 'mobile.bufferPolicy', base.bufferPolicy),
    ackTimeoutSeconds: numeroAttr(attrs, 'mobile.ackTimeoutSeconds', base.ackTimeoutSeconds),
    maxRetries: numeroAttr(attrs, 'mobile.maxRetries', base.maxRetries),
    distanceMeters: numeroAttr(attrs, 'mobile.distanceMeters', base.distanceMeters),
    angleDegrees: numeroAttr(attrs, 'mobile.angleDegrees', base.angleDegrees),
    accuracy: textoAttr(attrs, 'mobile.accuracy', base.accuracy),
    bufferEnabled: booleanoAttr(attrs, 'mobile.bufferEnabled', base.bufferEnabled),
    l1_pending_intent_enabled: booleanoAttr(attrs, 'mobile.l1PendingIntentEnabled', base.l1_pending_intent_enabled),
    store_all_enabled: booleanoAttr(attrs, 'mobile.storeAllEnabled', base.store_all_enabled),
    l1_max_update_delay_ms: numeroAttr(attrs, 'mobile.l1MaxUpdateDelayMs', base.l1_max_update_delay_ms),
    min_interval_seconds: numeroAttr(attrs, 'mobile.minIntervalSeconds', base.min_interval_seconds),
  });
}

// ---------------------------------------------------------------------------
// POST /api/mobile/v1/journey
// ---------------------------------------------------------------------------

export async function atenderJornada(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const lectura = await leerJson(req, LIMITE_JSON);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const cuerpo = objeto(lectura.datos);
  const identificador = cuerpo ? texto(cuerpo.deviceId) : null;
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  const accion = texto(cuerpo.action);
  if (accion !== 'start' && accion !== 'stop') return responderSinCuerpo(res, 400);

  const ahora = Date.now();
  // Hora real del toque (epoch ms) si la app la manda y es creíble: hasta 72 h
  // atrás (aviso encolado sin señal) y 2 min adelante (reloj del teléfono).
  const atCrudo = numeroFinito(cuerpo.at);
  const instante = atCrudo !== null && atCrudo >= ahora - 72 * 3_600_000 && atCrudo <= ahora + 120_000
    ? Math.min(atCrudo, ahora)
    : ahora;
  const bateria = numeroAttr(dispositivo.atributos, 'mobile.battery', -1);
  try {
    if (accion === 'start') {
      let jornadaId = entero(cuerpo.journeyId, ahora);
      if (jornadaId <= 0) jornadaId = ahora;
      const cliente = cuerpo.client !== undefined ? texto(cuerpo.client) : null;
      const parche = { 'mobile.journeyId': jornadaId };
      if (cliente) parche['mobile.client'] = cliente;
      await ctx.almacen.abrirJornada({
        dispositivoId: dispositivo.id,
        journeyId: jornadaId,
        bateriaInicio: bateria >= 0 && bateria <= 100 ? bateria : null,
        atributosJornada: {
          journeyId: jornadaId,
          client: cliente,
          origen: 'movil.journey',
        },
        parcheDispositivo: parche,
        inicioEn: new Date(instante),
      });
    } else {
      let jornadaId = entero(cuerpo.journeyId, 0);
      // Si el aviso trae su journeyId, solo cierra esa jornada.
      const soloJornada = jornadaId > 0 ? jornadaId : null;
      if (jornadaId <= 0) {
        jornadaId = numeroAttr(dispositivo.atributos, 'mobile.journeyId', ahora);
      }
      if (jornadaId <= 0) jornadaId = ahora;
      await ctx.almacen.cerrarJornada({
        dispositivoId: dispositivo.id,
        journeyId: jornadaId,
        soloJornada,
        finEn: new Date(instante),
        bateriaFin: bateria >= 0 && bateria <= 100 ? bateria : null,
        parcheDispositivo: {
          'mobile.journeyId': 0,
          'mobile.lastEndedJourneyId': jornadaId,
          'mobile.journeyEndedAt': ahora,
        },
      });
    }
  } catch (error) {
    ctx.log.error(`movil/journey: fallo al registrar jornada: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  return responderJson(res, 200, { ok: true });
}

// ---------------------------------------------------------------------------
// Cronograma de actividades
// GET  /api/mobile/v1/actividades?deviceId=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// POST /api/mobile/v1/actividades {deviceId, clientId, fecha, hora, tipo,
//      lugar, lugarId (cliente de la lista), lugarLat/lugarLon (dónde está
//      el lugar: la parada desde la que se registró), nota, at, lat, lon,
//      accuracy, deleted}
// ---------------------------------------------------------------------------

const TIPOS_ACTIVIDAD = new Set(['visita', 'almuerzo', 'permiso_medico', 'vacaciones', 'permiso', 'novedad']);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^[0-2]\d:[0-5]\d$/;

function recortar(valor, maximo) {
  const limpio = texto(valor);
  return limpio ? limpio.slice(0, maximo) : null;
}

export async function atenderActividadesConsulta(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) return responderSinCuerpo(res, 401);
  const identificador = identificadorDe(req, ctx.url);
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  const desde = ctx.url.searchParams.get('desde');
  const hasta = ctx.url.searchParams.get('hasta');
  if (!FECHA_RE.test(desde ?? '') || !FECHA_RE.test(hasta ?? '')) return responderSinCuerpo(res, 400);
  try {
    const filas = await ctx.almacen.listarActividades({ dispositivoId: dispositivo.id, desde, hasta });
    return responderJson(res, 200, {
      actividades: filas.map((f) => ({
        clientId: f.cliente_id,
        fecha: f.fecha,
        hora: f.hora,
        horaFin: f.hora_fin ?? null,
        tipo: f.tipo,
        lugar: f.lugar,
        lugarId: f.cliente_lugar_id === null || f.cliente_lugar_id === undefined ? null : Number(f.cliente_lugar_id),
        nota: f.nota,
        registradoEn: f.registrado_en instanceof Date ? f.registrado_en.getTime() : Date.parse(f.registrado_en),
        conJornada: f.con_jornada,
        conUbicacion: f.latitud !== null,
      })),
    });
  } catch (error) {
    ctx.log.error(`movil/actividades-get: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}

export async function atenderActividad(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) return responderSinCuerpo(res, 401);
  const lectura = await leerJson(req, LIMITE_JSON);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const cuerpo = objeto(lectura.datos);
  const identificador = cuerpo ? texto(cuerpo.deviceId) : null;
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  const clienteId = recortar(cuerpo.clientId, 64);
  const fecha = texto(cuerpo.fecha);
  const hora = texto(cuerpo.hora);
  const tipo = texto(cuerpo.tipo);
  if (!clienteId || !FECHA_RE.test(fecha ?? '') || !HORA_RE.test(hora ?? '') || !TIPOS_ACTIVIDAD.has(tipo)) {
    return responderSinCuerpo(res, 400);
  }
  // La hora de fin es opcional ("de 09:00 a 11:30"). Si no es válida o no
  // queda después de la de inicio, se ignora.
  const horaFinCruda = texto(cuerpo.horaFin);
  const horaFin = horaFinCruda && HORA_RE.test(horaFinCruda) && horaFinCruda > hora ? horaFinCruda : null;
  const lugar = recortar(cuerpo.lugar, 200);
  const nota = recortar(cuerpo.nota, 500);
  if (tipo === 'novedad' && !nota) return responderSinCuerpo(res, 400);
  if (tipo === 'visita' && !lugar) return responderSinCuerpo(res, 400);
  const ahora = Date.now();
  const at = numeroFinito(cuerpo.at);
  const registradoEn = new Date(at !== null && at >= ahora - 30 * 86_400_000 && at <= ahora + 120_000 ? Math.min(at, ahora) : ahora);
  try {
    const guardada = await ctx.almacen.guardarActividad({
      dispositivoId: dispositivo.id,
      clienteId,
      fecha,
      hora,
      horaFin,
      tipo,
      lugar,
      nota,
      registradoEn,
      latitud: numeroFinito(cuerpo.lat),
      longitud: numeroFinito(cuerpo.lon),
      precisionM: numeroFinito(cuerpo.accuracy),
      eliminada: cuerpo.deleted === true,
      lugarId: Number.isInteger(cuerpo.lugarId) && cuerpo.lugarId > 0 ? cuerpo.lugarId : null,
      lugarLat: numeroFinito(cuerpo.lugarLat),
      lugarLon: numeroFinito(cuerpo.lugarLon),
    });
    return responderJson(res, 200, { ok: true, conJornada: guardada.con_jornada, conUbicacion: guardada.con_coordenada });
  } catch (error) {
    ctx.log.error(`movil/actividades: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}

// ---------------------------------------------------------------------------
// POST /api/mobile/v1/power
// ---------------------------------------------------------------------------
// Apagado y encendido del teléfono: {deviceId, event:'shutdown'|'boot',
// cause:'battery'|'manual'|null, at (epoch ms), battery (0-100)}. La app lo
// intenta enviar al apagarse y, si no alcanza, al volver a encender.

export async function atenderEnergia(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) return responderSinCuerpo(res, 401);
  const lectura = await leerJson(req, LIMITE_JSON);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const cuerpo = objeto(lectura.datos);
  const identificador = cuerpo ? texto(cuerpo.deviceId) : null;
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  const evento = texto(cuerpo.event);
  if (evento !== 'shutdown' && evento !== 'boot') return responderSinCuerpo(res, 400);
  const ahora = Date.now();
  const at = numeroFinito(cuerpo.at);
  if (at === null || at < ahora - 7 * 86_400_000 || at > ahora + 120_000) return responderSinCuerpo(res, 400);
  const causaCruda = texto(cuerpo.cause);
  const causa = causaCruda === 'battery' || causaCruda === 'manual' ? causaCruda : null;
  const bateria = numeroFinito(cuerpo.battery);
  try {
    await ctx.almacen.registrarEventoEnergia({
      dispositivoId: dispositivo.id,
      tipo: evento === 'shutdown' ? 'mobilePowerOff' : 'mobilePowerOn',
      ocurridoEn: new Date(Math.min(at, ahora)),
      atributos: {
        clave: `${evento}-${Math.trunc(at)}`,
        cause: causa,
        battery: bateria !== null && bateria >= 0 && bateria <= 100 ? bateria : null,
        mobileSeverity: evento === 'shutdown' ? 'warning' : 'info',
      },
    });
  } catch (error) {
    ctx.log.error(`movil/power: fallo al registrar: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  return responderSinCuerpo(res, 204);
}

// ---------------------------------------------------------------------------
// POST /api/mobile/v1/diagnostics
// ---------------------------------------------------------------------------

export async function atenderDiagnosticos(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const identificador = identificadorDe(req, ctx.url);
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;

  const lectura = await leerJson(req, LIMITE_DIAGNOSTICO);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const datos = objeto(lectura.datos);
  if (!datos) return responderSinCuerpo(res, 400);
  if (!idCoincide(datos.deviceId, dispositivo)) return responderSinCuerpo(res, 403);

  const ahora = Date.now();
  const anterior = ultimosDiagnosticos.get(dispositivo.id);
  if (anterior !== undefined && ahora - anterior < VENTANA_ANTIRREBOTE) {
    return responderSinCuerpo(res, 204);
  }

  const reporte = objeto(datos.report) ?? {};
  const parche = {
    lastDiagnostics: JSON.stringify(datos),
    lastDiagnosticsAt: ahora,
  };
  const permisos = objeto(reporte.perms);
  if (permisos) {
    const fondo = booleanoJson(permisos.background);
    if (fondo !== null) parche['mobile.permBackground'] = fondo;
  }
  const energia = objeto(reporte.power);
  if (energia) {
    const exenta = booleanoJson(energia.exempt);
    if (exenta !== null) parche['mobile.batteryExempt'] = exenta;
  }
  const gps = objeto(reporte.gps);
  if (gps) {
    const simulado = booleanoJson(gps.mock);
    if (simulado !== null) parche['mobile.mockLocation'] = simulado;
    const habilitado = booleanoJson(gps.enabled);
    if (habilitado !== null) {
      parche['mobile.gps'] = habilitado ? 'on' : 'off';
      parche['mobile.gpsAt'] = ahora;
    }
  }
  const crash = texto(reporte.crash);
  if (crash) parche['mobile.lastCrashAt'] = ahora;
  const alertas = alertasDeDiagnostico(dispositivo.atributos, reporte);
  Object.assign(parche, alertas.parche);

  let bateria = null;
  if (energia) {
    const nivel = numero(energia.battery);
    if (nivel !== null && nivel >= 0 && nivel <= 100) {
      const marca = numero(datos.ts);
      bateria = {
        porcentaje: Math.trunc(nivel),
        cargando: booleanoJson(energia.charging),
        registradoEn: new Date(marca ?? ahora),
      };
    }
  }

  try {
    await ctx.almacen.registrarDiagnostico({
      dispositivoId: dispositivo.id,
      parcheDispositivo: parche,
      bateria,
      // Historial: cada diagnóstico queda como fila (salud.js).
      salud: filaSalud(datos, agenteCliente(req), ahora),
    });
  } catch (error) {
    ctx.log.error(`movil/diagnostics: fallo al guardar diagnostico: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  for (const tipo of alertas.eventos) {
    await ctx.almacen
      .registrarEventoEnergia({
        dispositivoId: dispositivo.id,
        tipo,
        ocurridoEn: new Date(ahora),
        atributos: { clave: `${tipo}-${ahora}`, mobileSeverity: 'warning' },
      })
      .catch((error) => ctx.log.warn(`movil/diagnostics: alerta ${tipo} sin guardar: ${error.message}`));
  }
  ultimosDiagnosticos.set(dispositivo.id, ahora);
  return responderSinCuerpo(res, 204);
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/ota
// ---------------------------------------------------------------------------

// Reglas para ofrecer la actualización:
//  1) si el teléfono ya tiene esa versión o una mayor, no hay nada;
//  2) si hay lista de equipos (allow), solo ellos la reciben;
//  3) por debajo de minVersionCode es obligatoria, aunque esté en pausa;
//  4) en pausa, nadie la recibe;
//  5) con percent < 100, solo los equipos cuyo número (SHA-256 del deviceId,
//     dos primeros bytes, módulo 100) quede por debajo. Siempre el mismo
//     equipo recibe la misma respuesta.
const BUCKETS_ROLLOUT = 100;

function bucketRollout(deviceId) {
  const hash = createHash('sha256').update(deviceId ?? '', 'utf8').digest();
  const valor = ((hash[0] & 0xff) << 8) | (hash[1] & 0xff);
  return valor % BUCKETS_ROLLOUT;
}

// rollout.json opcional: ausente/ilegible/fuera de rango = fail-open 100/false
// (mismo criterio del servidor anterior).
async function leerRollout(directorio) {
  try {
    const crudo = JSON.parse(await readFile(join(directorio, 'rollout.json'), 'utf8'));
    if (objeto(crudo) === null) return { percent: 100, paused: false, allow: [] };
    const percentCrudo = numero(crudo.percent);
    const percent = percentCrudo === null
      ? 100
      : Math.max(0, Math.min(BUCKETS_ROLLOUT, Math.trunc(percentCrudo)));
    const allow = Array.isArray(crudo.allow)
      ? crudo.allow.map((entrada) => texto(entrada)).filter((entrada) => entrada !== null)
      : [];
    return { percent, paused: crudo.paused === true, allow };
  } catch {
    return { percent: 100, paused: false, allow: [] };
  }
}

function permitirActualizacion({ deviceId, instalado, publicado, minVersionCode, rollout }) {
  if (instalado >= publicado) return false;
  if (rollout.allow.length > 0) return rollout.allow.includes(deviceId);
  if (instalado < minVersionCode) return true;
  if (rollout.paused) return false;
  if (rollout.percent >= BUCKETS_ROLLOUT) return true;
  return bucketRollout(deviceId) < rollout.percent;
}

async function auditarOta(ctx, dispositivo, versionCode, actualiza, userAgent) {
  const attrs = dispositivo.atributos;
  const ultima = numeroAttr(attrs, 'mobile.lastOtaCheckAt', 0);
  const ahora = Date.now();
  if (ahora - ultima < VENTANA_AUDITORIA_OTA) return;
  const parche = {
    'mobile.lastOtaCheckAt': ahora,
    'mobile.lastOtaVersionCode': versionCode,
    'mobile.lastOtaUpdate': actualiza,
  };
  const agente = texto(userAgent);
  if (agente) parche['mobile.lastOtaUa'] = agente.slice(0, 80);
  await ctx.almacen.fusionarAtributosDispositivo(dispositivo.id, parche);
}

export async function atenderOta(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 503);
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const identificador = identificadorDe(req, ctx.url);
  const versionTexto = (ctx.url.searchParams.get('versionCode') ?? '').trim();
  const versionCode = /^\d+$/.test(versionTexto) ? Number.parseInt(versionTexto, 10) : Number.NaN;
  if (!identificador || !Number.isInteger(versionCode)) {
    return responderSinCuerpo(res, 400);
  }
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;

  let manifiesto;
  try {
    manifiesto = JSON.parse(await readFile(join(ctx.configuracion.otaDir, 'latest.json'), 'utf8'));
  } catch (error) {
    ctx.log.warn(`movil/ota: sin manifiesto en ${ctx.configuracion.otaDir}: ${error.code ?? error.message}`);
    return responderSinCuerpo(res, 404);
  }
  const publicado = numero(manifiesto?.versionCode) ?? 0;
  const minVersionCode = numero(manifiesto?.minVersionCode) ?? 0;
  const rollout = await leerRollout(ctx.configuracion.otaDir);
  const actualiza = permitirActualizacion({
    deviceId: dispositivo.identificador,
    instalado: versionCode,
    publicado,
    minVersionCode,
    rollout,
  });
  try {
    await auditarOta(ctx, dispositivo, versionCode, actualiza, req.headers['user-agent']);
  } catch (error) {
    ctx.log.warn(`movil/ota: auditoria no escrita: ${error.message}`);
  }
  if (!actualiza) return responderJson(res, 200, { update: false });
  return responderJson(res, 200, manifiesto);
}

// ---------------------------------------------------------------------------
// POST /api/mobile/v1/fcm-token
// ---------------------------------------------------------------------------

export async function atenderTokenFcm(req, res, ctx) {
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const identificador = identificadorDeCabecera(req);
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 403);
  if (!dispositivo) return;
  const lectura = await leerJson(req, LIMITE_JSON);
  if (!lectura.ok) return responderSinCuerpo(res, 400);
  const datos = objeto(lectura.datos);
  const token = datos ? texto(datos.fcmToken) : null;
  if (!token || token.length > MAX_TOKEN) return responderSinCuerpo(res, 400);

  const prefijo = prefijoToken(token);
  const ahora = Date.now();
  const parche = {
    'mobile.fcmTokenRegistered': true,
    'mobile.fcmTokenPrefix': prefijo,
    'mobile.fcmUpdatedAt': ahora,
  };
  const version = datos ? texto(datos.appVersion) : null;
  if (version) parche['mobile.appVersion'] = version.slice(0, MAX_TEXTO);
  try {
    await ctx.almacen.guardarTokenFcm({ dispositivoId: dispositivo.id, token });
    await ctx.almacen.fusionarAtributosDispositivo(dispositivo.id, parche);
  } catch (error) {
    ctx.log.error(`movil/fcm-token: fallo al guardar token: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  // El token completo solo vive en iam.dmt_token_fcm; los logs usan el prefijo.
  ctx.log.info(`movil/fcm-token: registrado device=${dispositivo.identificador} prefix=${prefijo}`);
  return responderJson(res, 200, { ok: true, success: true, status: 'registered' });
}

// ---------------------------------------------------------------------------
// POST /api/mobile/v1/recovery-ack
// ---------------------------------------------------------------------------

export async function atenderRecuperacionAck(req, res, ctx) {
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const identificador = identificadorDeCabecera(req);
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 403);
  if (!dispositivo) return;
  const lectura = await leerJson(req, LIMITE_JSON);
  if (!lectura.ok) return responderSinCuerpo(res, 400);
  const datos = objeto(lectura.datos);
  const intento = datos ? texto(datos.recoveryAttemptId) : null;
  const etapa = datos ? texto(datos.stage) : null;
  if (!intento || !etapa) return responderSinCuerpo(res, 400);
  const prioridad = (datos ? texto(datos.priority) : null) ?? '-';
  const razon = datos ? texto(datos.reason) : null;
  const atributos = {
    attemptId: intento.slice(0, MAX_INTENTO_RECUPERACION),
    stage: etapa.slice(0, MAX_ETAPA_RECUPERACION),
    priority: prioridad.slice(0, MAX_PRIORIDAD_RECUPERACION),
    reason: razon === null ? null : razon.slice(0, MAX_RAZON_RECUPERACION),
  };
  // Se registra la confirmación en operations.dmt_alerta.
  try {
    await ctx.almacen.registrarAlertaRecuperacion({
      dispositivoId: dispositivo.id,
      atributos,
    });
  } catch (error) {
    ctx.log.error(`movil/recovery-ack: fallo al registrar ack: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
  ctx.log.info(
    `movil/recovery-ack: device=${dispositivo.identificador} attempt=${atributos.attemptId} ` +
    `stage=${atributos.stage} priority=${atributos.priority}`,
  );
  return responderJson(res, 200, { ok: true, success: true, status: 'accepted' });
}

// ---------------------------------------------------------------------------
// GET /api/mobile/v1/journey
// ---------------------------------------------------------------------------
// Después de un reinicio la app pregunta al servidor si la jornada sigue
// abierta. Responde {estado:'abierta'|'cerrada'|'ninguna', journeyId, inicioEn}.
export async function atenderJornadaConsulta(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const identificador = identificadorDe(req, ctx.url);
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  try {
    const estado = await ctx.almacen.obtenerJornadaEstado(dispositivo.id);
    return responderJson(res, 200, estado);
  } catch (error) {
    ctx.log.error(`movil/journey-get: fallo al leer jornada: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}

// ---------------------------------------------------------------------------
// POST /api/mobile/v1/positions
// ---------------------------------------------------------------------------
// Recibe {eventos:[{bootId, seq, journeyId, capturedAt, lat, lon, alt,
// speed (nudos), bearing, accuracy, battery, charging, mock, provider,
// movementState}]} y responde {resultados:[{seq, estado}]}:
//   accepted   guardado
//   duplicate  ya estaba (mismo equipo, boot y seq)
//   invalid    coordenadas, fecha o identidad incorrectas; no se guarda
//   dead       equipo deshabilitado; se descarta
// Máximo 500 puntos por lote, en una sola transacción.
//
// La app manda la velocidad en nudos: aquí se pasa a km/h. Si llega
// speedKmh, se usa ese valor.
const KMH_POR_NUDO = 1.852;

function velocidadDelEvento(evento) {
  const kmh = numeroFinito(evento.speedKmh);
  if (kmh !== null) return kmh;
  const nudos = numeroFinito(evento.speed);
  return nudos === null ? null : nudos * KMH_POR_NUDO;
}

function esLatitud(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= -90 && valor <= 90;
}

function esLongitud(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= -180 && valor <= 180;
}

function enteroSecuencia(valor) {
  if (typeof valor === 'number' && Number.isInteger(valor) && valor >= 0) return valor;
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) {
    const convertido = Number.parseInt(valor.trim(), 10);
    if (Number.isSafeInteger(convertido) && convertido >= 0) return convertido;
  }
  return null;
}

export function numeroFinito(valor) {
  if (valor === null || valor === undefined) return null;
  const convertido = typeof valor === 'number' ? valor : Number(String(valor).trim());
  return Number.isFinite(convertido) ? convertido : null;
}

export async function atenderLotePosiciones(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 503);
  if (!(await autorizacionMovil(req, ctx))) {
    return responderSinCuerpo(res, 401);
  }
  const lectura = await leerJson(req, LIMITE_LOTE);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const cuerpo = objeto(lectura.datos);
  // El dispositivo viaja en X-Device-Id (canal móvil); se acepta ?deviceId o
  // body.deviceId como respaldo para pruebas con curl.
  let identificador = identificadorDeCabecera(req);
  if (!identificador) {
    try {
      const urlAux = ctx.url ?? new URL(req.url, 'http://127.0.0.1');
      identificador = identificadorDe(req, urlAux);
    } catch {
      identificador = null;
    }
  }
  if (!identificador && cuerpo) {
    identificador = texto(cuerpo.deviceId) ?? texto(cuerpo.dispositivoId);
  }
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  const eventos = cuerpo ? cuerpo.eventos : null;
  if (!Array.isArray(eventos) || eventos.length === 0) return responderSinCuerpo(res, 400);
  if (eventos.length > MAX_EVENTOS_LOTE) return responderSinCuerpo(res, 413);
  if (cuerpo && cuerpo.deviceId !== undefined && !idCoincide(cuerpo.deviceId, dispositivo)) {
    return responderSinCuerpo(res, 403);
  }

  // Equipo deshabilitado: dead para todo el lote (drena sin guardar).
  if (dispositivo.habilitado === false) {
    const resultados = eventos.map((evento) => {
      const crudo = evento !== null && typeof evento === 'object' ? evento.seq : null;
      return { seq: enteroSecuencia(crudo), estado: 'dead' };
    });
    return responderJson(res, 200, { resultados });
  }

  // Primero se revisa cada punto sin tocar la base; los válidos se guardan
  // juntos en una transacción.
  const ahora = Date.now();
  const limiteAtras = ahora - 30 * 24 * 60 * 60 * 1000;
  const limiteAdelante = ahora + 24 * 60 * 60 * 1000;
  const resultados = new Array(eventos.length);
  const validos = [];
  for (let indice = 0; indice < eventos.length; indice += 1) {
    const evento = eventoObjeto(eventos[indice]);
    const seqEco = evento ? enteroSecuencia(evento.seq) : null;
    if (!evento || seqEco === null) {
      resultados[indice] = { seq: seqEco, estado: 'invalid' };
      continue;
    }
    const bootId = typeof evento.bootId === 'string' ? evento.bootId.trim() : null;
    if (!bootId) {
      resultados[indice] = { seq: seqEco, estado: 'invalid' };
      continue;
    }
    const lat = numeroFinito(evento.lat);
    const lon = numeroFinito(evento.lon);
    if (!esLatitud(lat) || !esLongitud(lon)) {
      resultados[indice] = { seq: seqEco, estado: 'invalid' };
      continue;
    }
    const capturado = evento.capturedAt === undefined || evento.capturedAt === null
      ? null
      : new Date(evento.capturedAt);
    if (!(capturado instanceof Date) || Number.isNaN(capturado.getTime())) {
      resultados[indice] = { seq: seqEco, estado: 'invalid' };
      continue;
    }
    const instante = capturado.getTime();
    if (instante < limiteAtras || instante > limiteAdelante) {
      resultados[indice] = { seq: seqEco, estado: 'invalid' };
      continue;
    }
    // Los datos opcionales que no sirven quedan en null.
    const bateriaCruda = numeroFinito(evento.battery);
    const bateria = bateriaCruda === null ? null : Math.min(100, Math.max(0, bateriaCruda));
    const simulado = evento.mock === true;
    const atributos = {};
    if (evento.journeyId !== undefined && evento.journeyId !== null) {
      const jornadaCruda = enteroSecuencia(evento.journeyId) ?? numeroFinito(evento.journeyId);
      if (jornadaCruda !== null) atributos.journeyId = jornadaCruda;
    }
    if (typeof evento.provider === 'string' && evento.provider.trim() !== '') {
      atributos.provider = evento.provider.trim().slice(0, 32);
    }
    if (typeof evento.movementState === 'string' && evento.movementState.trim() !== '') {
      atributos.movementState = evento.movementState.trim().slice(0, 32);
    }
    if (evento.charging !== undefined) atributos.charging = evento.charging === true;
    if (simulado) atributos.mock = true;
    validos.push({
      indice,
      seqEco,
      posicion: {
        protocolo: 'lote',
        latitud: lat,
        longitud: lon,
        altitud: numeroFinito(evento.alt),
        velocidadKmh: velocidadDelEvento(evento),
        rumbo: numeroFinito(evento.bearing),
        precision: numeroFinito(evento.accuracy),
        bateria,
        valida: !simulado,
        registradoEn: capturado,
        bootId,
        secuencia: seqEco,
        atributos,
      },
    });
  }

  try {
    if (validos.length > 0) {
      const lote = validos.map((entrada) => ({ ...entrada.posicion, seq: entrada.seqEco }));
      const parciales = await ctx.almacen.registrarLotePosiciones(dispositivo.id, lote);
      const porSeq = new Map();
      for (const parcial of parciales) {
        // La clave de dedupe es (boot,seq); el seq basta para reatar porque el
        // boot ya se validó por evento y el lote es de un solo dispositivo.
        if (!porSeq.has(parcial.seq)) porSeq.set(parcial.seq, []);
        porSeq.get(parcial.seq).push(parcial.estado);
      }
      const usados = new Map();
      for (const entrada of validos) {
        const estados = porSeq.get(entrada.seqEco) ?? ['accepted'];
        const vez = usados.get(entrada.seqEco) ?? 0;
        usados.set(entrada.seqEco, vez + 1);
        resultados[entrada.indice] = { seq: entrada.seqEco, estado: estados[Math.min(vez, estados.length - 1)] };
      }
    }
    // Los inválidos ya quedaron en `resultados`; por seguridad se rellena
    // cualquier hueco como invalid (nunca se deja undefined).
    for (let indice = 0; indice < resultados.length; indice += 1) {
      if (!resultados[indice]) {
        const evento = eventoObjeto(eventos[indice]);
        resultados[indice] = { seq: evento ? enteroSecuencia(evento.seq) : null, estado: 'invalid' };
      }
    }
    return responderJson(res, 200, { resultados });
  } catch (error) {
    ctx.log.error(`movil/positions: fallo al guardar lote: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}

function eventoObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor : null;
}
