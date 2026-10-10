// Eliminación definitiva de una cuenta ya dada de baja. Primero se guarda su
// ruta (posiciones, jornadas, eventos y datos de la cuenta) en un ZIP en
// DMJ_BAJAS_DIR, sin tener la base bloqueada. Después se borra todo en una
// transacción; si el borrado falla, el ZIP se quita y no queda nada suelto.

import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { consultar, enTransaccion } from './db.js';
import { conflicto, noEncontrado } from './errores.js';
import { respuestaJson } from './http.js';
import { auditar } from './sesiones.js';
import { exigirAdministracion } from './permisos.js';

const ejecutar = promisify(execFile);
// Se lee al usar, para que las pruebas puedan cambiar la carpeta.
const dirBajas = () => process.env.DMJ_BAJAS_DIR ?? '/home/DMujeres-backups/bajas';
const NOMBRE_ZIP = /^[A-Za-z0-9._-]+\.zip$/;
const TIEMPO_MAXIMO_MS = 120_000;

async function leerCuenta(pool, referencia) {
  const { rows } = await consultar(
    pool,
    `SELECT u.id, u.id_publico, u.nombre_usuario, u.nombre, u.correo, u.telefono, u.cargo,
            u.creado_en, u.actualizado_en, u.habilitado, u.administrador
       FROM iam.dmt_usuario u
      WHERE u.id_publico::text = $1 OR u.id::text = $1 OR u.nombre_usuario = $1`,
    [referencia],
  );
  return rows[0] ?? null;
}

// Equipos ligados a la cuenta: el propio (nombre exacto) y los asignados.
async function equiposDe(pool, cuenta) {
  const { rows } = await consultar(
    pool,
    `SELECT d.id, d.id_publico, d.nombre, d.identificador
       FROM tracking.dmt_dispositivo d
      WHERE d.identificador = $1
         OR d.id IN (SELECT a.dispositivo_id FROM operations.dmt_asignacion a WHERE a.usuario_id = $2)`,
    [cuenta.nombre_usuario, cuenta.id],
  );
  return rows;
}

// Escribe la ruta en un ZIP. Si algo falla, el ZIP incompleto se quita.
async function escribirZip(pool, cuenta, dispositivos) {
  const ids = dispositivos.map((d) => d.id);
  const posiciones = await consultar(
    pool,
    `SELECT row_to_json(p)::text AS f FROM tracking.dmt_posicion p
      WHERE p.dispositivo_id = ANY($1) ORDER BY p.registrado_en`,
    [ids],
  );
  const eventos = await consultar(
    pool,
    `SELECT row_to_json(e)::text AS f FROM tracking.dmt_evento e
      WHERE e.dispositivo_id = ANY($1) ORDER BY e.ocurrido_en`,
    [ids],
  );
  const jornadas = await consultar(
    pool,
    `SELECT row_to_json(j)::text AS f FROM operations.dmt_jornada j
      WHERE j.usuario_id = $1 OR j.dispositivo_id = ANY($2) ORDER BY j.inicio_en`,
    [cuenta.id, ids],
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nombre = `${cuenta.nombre_usuario ?? 'sin-usuario'}-${cuenta.id_publico}-${stamp}.zip`;
  const destino = join(dirBajas(), nombre);
  const carpeta = join(dirBajas(), `.trabajo-${randomUUID()}`);
  await mkdir(carpeta, { recursive: true });
  try {
    await writeFile(join(carpeta, 'cuenta.json'), JSON.stringify({
      usuario: cuenta.nombre_usuario,
      nombre: cuenta.nombre,
      correo: cuenta.correo,
      telefono: cuenta.telefono,
      cargo: cuenta.cargo,
      creadaEn: cuenta.creado_en,
      dadaDeBajaEn: cuenta.actualizado_en,
      equipos: dispositivos.map((d) => ({ idPublico: d.id_publico, nombre: d.nombre, identificador: d.identificador })),
    }, null, 2));
    await writeFile(join(carpeta, 'posiciones.jsonl'), posiciones.rows.map((r) => r.f + '\n').join(''));
    await writeFile(join(carpeta, 'eventos.jsonl'), eventos.rows.map((r) => r.f + '\n').join(''));
    await writeFile(join(carpeta, 'jornadas.jsonl'), jornadas.rows.map((r) => r.f + '\n').join(''));
    const archivos = ['cuenta.json', 'posiciones.jsonl', 'eventos.jsonl', 'jornadas.jsonl'];
    await ejecutar('zip', ['-q', '-X', destino, ...archivos], { cwd: carpeta, timeout: TIEMPO_MAXIMO_MS });
    await ejecutar('unzip', ['-tq', destino], { timeout: TIEMPO_MAXIMO_MS });
  } catch (error) {
    await rm(destino, { force: true });
    throw error;
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
  return { nombre, posiciones: posiciones.rowCount, eventos: eventos.rowCount, jornadas: jornadas.rowCount };
}

// DELETE /api/v1/usuarios/:id/definitivo. Solo cuentas ya dadas de baja.
export async function eliminarDefinitivamente(ctx) {
  await exigirAdministracion(ctx);
  const cuenta = await leerCuenta(ctx.pool, ctx.params.id);
  if (!cuenta) throw noEncontrado('El usuario no existe.');
  if (cuenta.habilitado) throw conflicto('Primero dé de baja al usuario; después puede eliminarlo.');
  if (Number(cuenta.id) === Number(ctx.usuario.id)) throw conflicto('No puede eliminar su propia cuenta.');

  const dispositivos = await equiposDe(ctx.pool, cuenta);
  const idsPropios = dispositivos.filter((d) => d.identificador === cuenta.nombre_usuario).map((d) => d.id);
  const zip = await escribirZip(ctx.pool, cuenta, dispositivos);
  try {
    await enTransaccion(ctx.pool, async (cliente) => {
      const { rows } = await cliente.query(
        'SELECT habilitado FROM iam.dmt_usuario WHERE id = $1 FOR UPDATE',
        [cuenta.id],
      );
      if (rows.length === 0 || rows[0].habilitado) {
        throw conflicto('La cuenta cambió mientras se guardaba la ruta. Intente de nuevo.');
      }
      await cliente.query('DELETE FROM telemetry.dmt_bateria WHERE dispositivo_id = ANY($1)', [idsPropios]);
      await cliente.query('DELETE FROM telemetry.dmt_senal WHERE dispositivo_id = ANY($1)', [idsPropios]);
      await cliente.query('DELETE FROM telemetry.dmt_salud_dispositivo WHERE dispositivo_id = ANY($1)', [idsPropios]);
      await cliente.query('DELETE FROM tracking.dmt_posicion WHERE dispositivo_id = ANY($1)', [idsPropios]);
      await cliente.query('DELETE FROM tracking.dmt_evento WHERE dispositivo_id = ANY($1)', [idsPropios]);
      await cliente.query('DELETE FROM operations.dmt_actividad WHERE dispositivo_id = ANY($1)', [idsPropios]);
      await cliente.query(
        'DELETE FROM operations.dmt_jornada WHERE usuario_id = $1 OR dispositivo_id = ANY($2)',
        [cuenta.id, idsPropios],
      );
      await cliente.query('DELETE FROM tracking.dmt_dispositivo WHERE id = ANY($1)', [idsPropios]);
      await cliente.query('DELETE FROM iam.dmt_usuario WHERE id = $1', [cuenta.id]);
    });
  } catch (error) {
    // Sin borrado no hay nada que conservar aparte: el ZIP se quita.
    await rm(join(dirBajas(), zip.nombre), { force: true });
    throw error;
  }
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'eliminar_definitivo',
    entidad: 'usuario',
    entidadId: Number(cuenta.id),
    descripcion: `Cuenta ${cuenta.nombre_usuario} eliminada; ruta guardada en ${zip.nombre}.`,
    datos: { zip: zip.nombre, equiposEliminados: idsPropios.length },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { eliminado: true, zip: { nombre: zip.nombre }, equiposEliminados: idsPropios.length });
}

// GET /api/v1/bajas: rutas guardadas de cuentas eliminadas.
export async function listarBajas(ctx) {
  await exigirAdministracion(ctx);
  const nombres = await readdir(dirBajas()).catch(() => []);
  const archivos = await Promise.all(
    nombres.filter((n) => NOMBRE_ZIP.test(n)).map(async (nombre) => {
      const info = await stat(join(dirBajas(), nombre));
      return { nombre, bytes: info.size, creadoEn: info.mtime.toISOString() };
    }),
  );
  archivos.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  respuestaJson(ctx.res, 200, { archivos });
}

// GET /api/v1/bajas/:nombre: descarga una ruta guardada.
export async function descargarBaja(ctx) {
  await exigirAdministracion(ctx);
  const nombre = ctx.params.nombre;
  if (!NOMBRE_ZIP.test(nombre)) throw noEncontrado('La ruta no existe.');
  const ruta = join(dirBajas(), nombre);
  const info = await stat(ruta).catch(() => null);
  if (!info) throw noEncontrado('La ruta no existe.');
  ctx.res.writeHead(200, {
    'content-type': 'application/zip',
    'content-length': info.size,
    'content-disposition': `attachment; filename="${nombre}"`,
    'cache-control': 'no-store',
  });
  createReadStream(ruta).pipe(ctx.res);
}
