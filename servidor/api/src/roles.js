// Roles de la plataforma: GET /api/v1/roles (los 3 existentes).
// Solo administradores; el catálogo lo crea la migración base.

import { consultar } from './db.js';
import { respuestaJson } from './http.js';
import { exigirAdministracion } from './permisos.js';

export async function listarRoles(ctx) {
  await exigirAdministracion(ctx);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT id, id_publico, codigo, nombre, descripcion
       FROM iam.dmt_rol
      ORDER BY id`,
    [],
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map((fila) => ({
      id: Number(fila.id),
      idPublico: fila.id_publico,
      codigo: fila.codigo,
      nombre: fila.nombre,
      descripcion: fila.descripcion ?? null,
    })),
  });
}
