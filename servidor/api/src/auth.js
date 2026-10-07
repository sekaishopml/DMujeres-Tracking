// Inicio y cierre de sesión del panel. La contraseña nunca se registra ni se
// devuelve.

import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { iso, aUsuario } from './dto.js';
import { ErrorApi, datosInvalidos, noAutenticado } from './errores.js';
import { limpiarFallos, mensajeBloqueo, minutosBloqueo, registrarFallo } from '../../comun/acceso.js';
import { leerCuerpoJson, respuestaJson, respuestaSinContenido } from './http.js';
import {
  actualizarUltimoAcceso,
  agenteCliente,
  auditar,
  cookieExpirada,
  cookieSesion,
  crearSesion,
  direccionCliente,
  revocarSesion,
  SUBCONSULTA_DISPOSITIVOS,
  tokenDeSesion,
} from './sesiones.js';

const ITERACIONES = 1000;
const BYTES_CLAVE = 24;
const BYTES_SAL = 24;
const ALGORITMO = 'sha1';
const HEX_24_BYTES = /^[0-9a-fA-F]{48}$/;

// Credencial de descarte: mantiene un costo similar cuando el usuario no existe.
const SAL_DESCARTE = Buffer.from('00112233445566778899aabbccddeeff0011223344556677', 'hex');

export function verificarClave(clave, hashHex, salHex) {
  const sal = typeof salHex === 'string' && HEX_24_BYTES.test(salHex) ? Buffer.from(salHex, 'hex') : SAL_DESCARTE;
  const esperado =
    typeof hashHex === 'string' && HEX_24_BYTES.test(hashHex) ? Buffer.from(hashHex, 'hex') : Buffer.alloc(BYTES_CLAVE);
  const calculado = pbkdf2Sync(clave, sal, ITERACIONES, BYTES_CLAVE, ALGORITMO);
  return typeof hashHex === 'string' && HEX_24_BYTES.test(hashHex) && timingSafeEqual(esperado, calculado);
}

// Genera el hash de una contraseña con el mismo formato que valida
// verificarClave: PBKDF2-HMAC-SHA1, 1000 vueltas, 24 bytes, sal aleatoria de
// 24 bytes, en hex.
export function crearCredencial(clave) {
  const sal = randomBytes(BYTES_SAL);
  const hash = pbkdf2Sync(clave, sal, ITERACIONES, BYTES_CLAVE, ALGORITMO);
  return { hash: hash.toString('hex'), sal: sal.toString('hex') };
}

export async function iniciarSesion(ctx) {
  const cuerpo = await leerCuerpoJson(ctx.req, 8192);
  const identificador = typeof cuerpo.usuario === 'string' ? cuerpo.usuario.trim() : '';
  const clave = typeof cuerpo.clave === 'string' ? cuerpo.clave : '';
  if (!identificador || !clave) {
    throw datosInvalidos('Los campos usuario y clave son obligatorios.');
  }
  const { rows } = await ctx.pool.query(
    `SELECT u.id, u.id_publico, u.nombre, u.correo, u.administrador, u.solo_lectura, u.habilitado,
            u.hash_clave, u.sal, u.bloqueado_hasta, ${SUBCONSULTA_DISPOSITIVOS}
     FROM iam.dmt_usuario u
     WHERE lower(u.nombre_usuario) = lower($1) OR lower(u.correo) = lower($1)
     LIMIT 1`,
    [identificador],
  );
  const fila = rows[0];
  const bloqueo = minutosBloqueo(fila?.bloqueado_hasta);
  if (bloqueo > 0) {
    await auditar(ctx.pool, ctx.log, {
      usuarioId: fila.id,
      accion: 'login_bloqueado',
      entidad: 'usuario',
      entidadId: fila.id,
      descripcion: 'Intento de entrar con la cuenta bloqueada.',
      req: ctx.req,
    });
    throw new ErrorApi('CUENTA_BLOQUEADA', mensajeBloqueo(bloqueo), 423);
  }
  const credencialValida = verificarClave(clave, fila?.hash_clave, fila?.sal);
  if (!fila || !credencialValida || !fila.habilitado) {
    const minutos = fila && fila.habilitado ? await registrarFallo(ctx.pool, fila.id) : 0;
    await auditar(ctx.pool, ctx.log, {
      usuarioId: fila?.id,
      accion: 'login_denegado',
      entidad: 'usuario',
      entidadId: fila?.id,
      descripcion: 'Credencial invalida o cuenta no habilitada.',
      req: ctx.req,
    });
    if (minutos > 0) throw new ErrorApi('CUENTA_BLOQUEADA', mensajeBloqueo(minutos), 423);
    throw noAutenticado('Usuario o clave incorrectos.');
  }
  await limpiarFallos(ctx.pool, fila.id);
  const sesion = await crearSesion(ctx.pool, fila.id, {
    horas: ctx.entorno.sesionHoras,
    direccion: direccionCliente(ctx.req),
    agente: agenteCliente(ctx.req),
  });
  await actualizarUltimoAcceso(ctx.pool, fila.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: fila.id,
    accion: 'login',
    entidad: 'usuario',
    entidadId: fila.id,
    descripcion: 'Inicio de sesion web.',
    req: ctx.req,
  });
  respuestaJson(
    ctx.res,
    200,
    { usuario: aUsuario(fila), expiraEn: iso(sesion.expiraEn) },
    {
      'Set-Cookie': cookieSesion(sesion.token, {
        segundos: ctx.entorno.sesionHoras * 3600,
        seguro: ctx.entorno.tls,
      }),
    },
  );
}

export async function cerrarSesion(ctx) {
  const token = tokenDeSesion(ctx.req);
  await revocarSesion(ctx.pool, token);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.sesion?.usuario?.id,
    accion: 'logout',
    entidad: 'usuario',
    entidadId: ctx.sesion?.usuario?.id,
    descripcion: 'Cierre de sesion web.',
    req: ctx.req,
  });
  respuestaSinContenido(ctx.res, {
    'Set-Cookie': cookieExpirada({ seguro: ctx.entorno.tls }),
  });
}

export function obtenerSesion(ctx) {
  // ctx.sesion.usuario ya es el DTO del contrato: no se vuelve a convertir.
  respuestaJson(ctx.res, 200, ctx.sesion.usuario);
}
