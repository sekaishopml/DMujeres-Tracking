// Sesion propia DMujeres Tracking: cookie dmj_sesion + tabla iam.dmt_sesion.
// Se guarda solo el SHA-256 del token; el valor en claro nunca toca la base.

import { createHash, randomBytes } from 'node:crypto';
import { aUsuario } from './dto.js';

export const NOMBRE_COOKIE = 'dmj_sesion';

// Equipos habilitados y asignados del usuario (lista de idPublico ordenada por
// nombre). Se usa al iniciar sesión y en la gestión de usuarios. Un equipo
// dado de baja no aparece en ninguna lista del panel.
export const SUBCONSULTA_DISPOSITIVOS = `
  COALESCE((
    SELECT array_agg(d.id_publico::text ORDER BY d.nombre, d.id)
    FROM operations.dmt_asignacion a
    JOIN tracking.dmt_dispositivo d ON d.id = a.dispositivo_id
    WHERE a.usuario_id = u.id AND a.activa
      AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())
      AND d.habilitado
  ), '{}') AS dispositivo_ids`;

export function leerCookies(req) {
  const cabecera = req.headers.cookie;
  const cookies = {};
  if (!cabecera) return cookies;
  for (const parte of cabecera.split(';')) {
    const separador = parte.indexOf('=');
    if (separador <= 0) continue;
    cookies[parte.slice(0, separador).trim()] = parte.slice(separador + 1).trim();
  }
  return cookies;
}

export function tokenDeSesion(req) {
  return leerCookies(req)[NOMBRE_COOKIE] ?? null;
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function cookieSesion(token, { segundos, seguro }) {
  const partes = [
    `${NOMBRE_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.trunc(segundos)}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export function cookieExpirada({ seguro }) {
  const partes = [`${NOMBRE_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export async function crearSesion(pool, usuarioId, { horas, direccion, agente }) {
  const token = randomBytes(32).toString('base64url');
  const { rows } = await pool.query(
    `INSERT INTO iam.dmt_sesion (usuario_id, token_hash, tipo, direccion_ip, agente, expira_en)
     VALUES ($1, $2, 'web', $3, $4, now() + ($5::numeric * interval '1 hour'))
     RETURNING id, expira_en`,
    [usuarioId, hashToken(token), direccion, agente, horas],
  );
  return { token, sesionId: Number(rows[0].id), expiraEn: rows[0].expira_en };
}

export async function validarSesion(pool, token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.id AS sesion_id, s.expira_en,
            u.id, u.id_publico, u.nombre, u.correo, u.administrador, u.solo_lectura, u.habilitado,
            ${SUBCONSULTA_DISPOSITIVOS}
     FROM iam.dmt_sesion s
     JOIN iam.dmt_usuario u ON u.id = s.usuario_id
     WHERE s.token_hash = $1
       AND s.revocada_en IS NULL
       AND s.expira_en > now()
       AND u.habilitado`,
    [hashToken(token)],
  );
  if (rows.length === 0) return null;
  const fila = rows[0];
  return {
    sesionId: Number(fila.sesion_id),
    expiraEn: fila.expira_en,
    usuario: aUsuario(fila),
  };
}

export async function revocarSesion(pool, token) {
  if (!token) return false;
  const { rowCount } = await pool.query(
    `UPDATE iam.dmt_sesion
     SET revocada_en = now(), actualizado_en = now()
     WHERE token_hash = $1 AND revocada_en IS NULL`,
    [hashToken(token)],
  );
  return rowCount > 0;
}

export async function actualizarUltimoAcceso(pool, usuarioId) {
  await pool.query('UPDATE iam.dmt_usuario SET ultimo_acceso_en = now() WHERE id = $1', [usuarioId]);
}

export function direccionCliente(req) {
  const reenviada = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const candidata = reenviada || req.socket.remoteAddress || '';
  const limpia = candidata.replace(/^\[|\]$/g, '');
  return /^[0-9a-fA-F:.]{3,45}$/.test(limpia) ? limpia : null;
}

export function agenteCliente(req) {
  const agente = req.headers['user-agent'];
  return typeof agente === 'string' ? agente.slice(0, 300) : null;
}

// `datos` es el detalle minimo de la accion (nunca claves, hashes ni tokens).
export async function auditar(
  pool,
  log,
  { usuarioId, accion, entidad, entidadId, descripcion, datos, req },
) {
  try {
    await pool.query(
      `INSERT INTO audit.dmt_auditoria (usuario_id, accion, entidad, entidad_id, descripcion, datos, direccion, agente)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        usuarioId ?? null,
        accion,
        entidad ?? null,
        entidadId === undefined || entidadId === null ? null : String(entidadId),
        descripcion ?? null,
        JSON.stringify(datos ?? {}),
        req ? direccionCliente(req) : null,
        req ? agenteCliente(req) : null,
      ],
    );
  } catch (error) {
    // Si falla la auditoría, la operación sigue; el error queda en el log.
    log.aviso('auditoria_no_registrada', { detalle: error.message });
  }
}
