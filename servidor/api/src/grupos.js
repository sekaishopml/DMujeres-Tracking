// Grupos de personas: CRUD en /api/v1/grupos y PUT /api/v1/grupos/:id/miembros.
// Al borrar un grupo se borran sus membresías, nunca las personas.

import { consultar, enTransaccion } from './db.js';
import { conflicto, datosInvalidos, noEncontrado } from './errores.js';
import {
  leerCuerpoJson,
  leerOrden,
  leerPaginacion,
  respuestaJson,
  respuestaSinContenido,
} from './http.js';
import { auditar } from './sesiones.js';
import { exigirOperativo } from './permisos.js';

const ORDEN_GRUPOS = {
  id: 'g.id',
  nombre: 'g.nombre',
};

function textoObligatorio(valor, campo, maximo = 200) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw datosInvalidos(`El campo ${campo} es obligatorio.`);
  }
  const limpio = valor.trim();
  if (limpio.length > maximo) {
    throw datosInvalidos(`El campo ${campo} supera ${maximo} caracteres.`);
  }
  return limpio;
}

function textoOpcional(valor, campo, maximo = 500) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') {
    throw datosInvalidos(`El campo ${campo} debe ser texto.`);
  }
  const limpio = valor.trim();
  if (limpio === '') return null;
  if (limpio.length > maximo) {
    throw datosInvalidos(`El campo ${campo} supera ${maximo} caracteres.`);
  }
  return limpio;
}

function listaIds(valor, campo) {
  if (valor === undefined || valor === null) {
    throw datosInvalidos(`El campo ${campo} es obligatorio.`);
  }
  if (!Array.isArray(valor)) {
    throw datosInvalidos(`El campo ${campo} debe ser una lista.`);
  }
  const ids = valor.map((elemento) => {
    if (typeof elemento === 'string' && elemento.trim() !== '') return elemento.trim();
    if (typeof elemento === 'number' && Number.isInteger(elemento)) return String(elemento);
    throw datosInvalidos(`Cada elemento de ${campo} debe ser un id válido.`);
  });
  return [...new Set(ids)];
}

async function buscarGrupo(clienteOpool, valor) {
  const texto = String(valor);
  const { rows } = await clienteOpool.query(
    `SELECT g.id, g.id_publico, g.nombre, g.descripcion
       FROM iam.dmt_grupo g
      WHERE g.id_publico::text = $1 OR g.id::text = $1 OR g.nombre = $1
      LIMIT 1`,
    [texto],
  );
  return rows[0] ?? null;
}

async function miembrosDe(clienteOpool, grupoId) {
  const { rows } = await clienteOpool.query(
    `SELECT u.id, u.id_publico, u.nombre_usuario, u.nombre
       FROM iam.dmt_usuario_grupo ug
       JOIN iam.dmt_usuario u ON u.id = ug.usuario_id
      WHERE ug.grupo_id = $1
      ORDER BY u.nombre, u.id`,
    [Number(grupoId)],
  );
  return rows.map((fila) => ({
    id: Number(fila.id),
    idPublico: fila.id_publico,
    usuario: fila.nombre_usuario,
    nombre: fila.nombre,
  }));
}

function aGrupo(fila, miembros) {
  return {
    id: Number(fila.id),
    idPublico: fila.id_publico,
    nombre: fila.nombre,
    descripcion: fila.descripcion ?? null,
    miembros: miembros ?? undefined,
    totalMiembros: miembros !== undefined && miembros !== null
      ? miembros.length
      : (fila.total_miembros !== undefined ? Number(fila.total_miembros) : undefined),
  };
}

export async function listarGrupos(ctx) {
  await exigirOperativo(ctx);
  const { pagina, tamano, desplazamiento } = leerPaginacion(ctx.url);
  const orden = leerOrden(ctx.url, ORDEN_GRUPOS, 'g.nombre ASC');
  const { rows } = await consultar(
    ctx.pool,
    `SELECT g.id, g.id_publico, g.nombre, g.descripcion,
            count(ug.usuario_id)::int AS total_miembros,
            count(*) OVER() AS total_filas
       FROM iam.dmt_grupo g
       LEFT JOIN iam.dmt_usuario_grupo ug ON ug.grupo_id = g.id
      GROUP BY g.id, g.id_publico, g.nombre, g.descripcion
      ORDER BY ${orden.sql}, g.id
      LIMIT $1 OFFSET $2`,
    [tamano, desplazamiento],
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map((fila) => ({
      id: Number(fila.id),
      idPublico: fila.id_publico,
      nombre: fila.nombre,
      descripcion: fila.descripcion ?? null,
      totalMiembros: Number(fila.total_miembros),
    })),
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}

export async function obtenerGrupo(ctx) {
  await exigirOperativo(ctx);
  const fila = await buscarGrupo(ctx.pool, ctx.params.id);
  if (!fila) throw noEncontrado('El grupo no existe.');
  const miembros = await miembrosDe(ctx.pool, fila.id);
  respuestaJson(ctx.res, 200, { grupo: aGrupo(fila, miembros) });
}

export async function crearGrupo(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 8192);
  const nombre = textoObligatorio(cuerpo.nombre, 'nombre', 200);
  const descripcion = textoOpcional(cuerpo.descripcion, 'descripcion', 500);

  const { rows } = await consultar(
    ctx.pool,
    'SELECT 1 FROM iam.dmt_grupo WHERE lower(nombre) = lower($1) LIMIT 1',
    [nombre],
    { signal: ctx.signal },
  );
  if (rows.length > 0) {
    throw conflicto(`El grupo ${nombre} ya existe.`);
  }
  const { rows: creados } = await consultar(
    ctx.pool,
    `INSERT INTO iam.dmt_grupo (nombre, descripcion)
     VALUES ($1, $2)
     RETURNING id, id_publico, nombre, descripcion`,
    [nombre, descripcion],
    { signal: ctx.signal },
  );
  const grupo = aGrupo(creados[0], []);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'crear_grupo',
    entidad: 'grupo',
    entidadId: grupo.id,
    descripcion: `Grupo ${nombre} creado.`,
    datos: { nombre },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 201, { grupo });
}

export async function actualizarGrupo(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 8192);
  const nombre = cuerpo.nombre === undefined ? undefined : textoObligatorio(cuerpo.nombre, 'nombre', 200);
  const descripcion = cuerpo.descripcion === undefined
    ? undefined
    : textoOpcional(cuerpo.descripcion, 'descripcion', 500);
  if (nombre === undefined && descripcion === undefined) {
    throw datosInvalidos('No se enviaron cambios: indique nombre y/o descripcion.');
  }
  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const actual = await buscarGrupo(cliente, ctx.params.id);
    if (!actual) throw noEncontrado('El grupo no existe.');
    if (nombre !== undefined && nombre.toLowerCase() !== actual.nombre.toLowerCase()) {
      const { rowCount } = await cliente.query(
        'SELECT 1 FROM iam.dmt_grupo WHERE lower(nombre) = lower($1) AND id <> $2 LIMIT 1',
        [nombre, actual.id],
      );
      if (rowCount > 0) {
        throw conflicto(`El grupo ${nombre} ya existe.`);
      }
    }
    await cliente.query(
      `UPDATE iam.dmt_grupo
          SET nombre = coalesce($2, nombre),
              descripcion = $3,
              actualizado_en = now()
        WHERE id = $1`,
      [actual.id, nombre ?? null, descripcion === undefined ? actual.descripcion : descripcion],
    );
    return { id: Number(actual.id) };
  });
  const fila = await buscarGrupo(ctx.pool, resultado.id);
  const miembros = await miembrosDe(ctx.pool, resultado.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'editar_grupo',
    entidad: 'grupo',
    entidadId: resultado.id,
    descripcion: `Grupo ${fila.nombre} actualizado.`,
    datos: { nombre: nombre !== undefined, descripcion: descripcion !== undefined },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { grupo: aGrupo(fila, miembros) });
}

export async function eliminarGrupo(ctx) {
  await exigirOperativo(ctx);
  const fila = await buscarGrupo(ctx.pool, ctx.params.id);
  if (!fila) throw noEncontrado('El grupo no existe.');
  await consultar(
    ctx.pool,
    'DELETE FROM iam.dmt_grupo WHERE id = $1',
    [fila.id],
    { signal: ctx.signal },
  );
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'eliminar_grupo',
    entidad: 'grupo',
    entidadId: Number(fila.id),
    descripcion: `Grupo ${fila.nombre} eliminado.`,
    datos: { nombre: fila.nombre },
    req: ctx.req,
  });
  respuestaSinContenido(ctx.res);
}

export async function reemplazarMiembros(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 16384);
  const usuarioIds = listaIds(cuerpo.usuarioIds, 'usuarioIds');

  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const grupo = await buscarGrupo(cliente, ctx.params.id);
    if (!grupo) throw noEncontrado('El grupo no existe.');
    let personas = [];
    if (usuarioIds.length > 0) {
      const { rows } = await cliente.query(
        `SELECT id, id_publico, nombre_usuario, nombre, habilitado FROM iam.dmt_usuario
          WHERE id_publico::text = ANY($1) OR id::text = ANY($1) OR nombre_usuario = ANY($1)`,
        [usuarioIds],
      );
      const porId = new Map();
      const porPublico = new Map();
      const porUsuario = new Map();
      for (const fila of rows) {
        porId.set(String(fila.id), fila);
        porPublico.set(String(fila.id_publico ?? ''), fila);
        if (fila.nombre_usuario) porUsuario.set(fila.nombre_usuario, fila);
      }
      const vistos = new Set();
      for (const id of usuarioIds) {
        const fila = porId.get(id) ?? porPublico.get(id) ?? porUsuario.get(id);
        if (!fila) throw datosInvalidos(`El usuario ${id} no existe.`);
        if (vistos.has(String(fila.id))) continue;
        vistos.add(String(fila.id));
        personas.push(fila);
      }
    }
    // Reglas del grupo: una persona pertenece a un solo grupo y una cuenta
    // dada de baja no se suma. Si alguna no cumple, no se cambia nada.
    const debaja = personas.filter((p) => !p.habilitado).map((p) => p.nombre);
    if (debaja.length > 0) throw conflicto(`Está dada de baja: ${debaja.join(', ')}. Reactívala antes de sumarla.`);
    if (personas.length > 0) {
      const { rows: enOtro } = await cliente.query(
        `SELECT u.nombre, g.nombre AS grupo
           FROM iam.dmt_usuario_grupo ug
           JOIN iam.dmt_usuario u ON u.id = ug.usuario_id
           JOIN iam.dmt_grupo g ON g.id = ug.grupo_id
          WHERE ug.usuario_id = ANY($1::bigint[]) AND ug.grupo_id <> $2`,
        [personas.map((p) => p.id), grupo.id],
      );
      if (enOtro.length > 0) {
        throw conflicto(
          `Ya pertenece a otro grupo: ${enOtro.map((f) => `${f.nombre} (${f.grupo})`).join(', ')}. Quítala de ese grupo primero.`,
        );
      }
    }
    await cliente.query('DELETE FROM iam.dmt_usuario_grupo WHERE grupo_id = $1', [grupo.id]);
    for (const persona of personas) {
      await cliente.query(
        'INSERT INTO iam.dmt_usuario_grupo (usuario_id, grupo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [persona.id, grupo.id],
      );
    }
    return { id: Number(grupo.id), total: personas.length };
  });

  const fila = await buscarGrupo(ctx.pool, resultado.id);
  const miembros = await miembrosDe(ctx.pool, resultado.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'editar_miembros_grupo',
    entidad: 'grupo',
    entidadId: resultado.id,
    descripcion: `Miembros del grupo ${fila.nombre} reemplazados (${resultado.total}).`,
    datos: { totalMiembros: resultado.total },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { grupo: aGrupo(fila, miembros) });
}
