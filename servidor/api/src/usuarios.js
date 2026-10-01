// Usuarios (rutas /api/v1/users): lectura y escritura, solo administradores;
// el resto recibe 403. Las contraseñas se guardan con hash y nunca se registran.

import { consultar, enTransaccion } from './db.js';
import { aUsuario } from './dto.js';
import { datosInvalidos, noEncontrado, sinPermiso } from './errores.js';
import {
  leerCuerpoJson,
  leerOrden,
  leerPaginacion,
  respuestaJson,
  respuestaSinContenido,
} from './http.js';
import { auditar, SUBCONSULTA_DISPOSITIVOS } from './sesiones.js';
import { crearCredencial } from './auth.js';

const CAMPOS_USUARIO = `u.id, u.id_publico, u.nombre, u.correo, u.administrador,
       u.solo_lectura, u.habilitado, u.nombre_usuario, u.ultimo_acceso_en`;

const ORDEN_USUARIOS = {
  id: 'u.id',
  nombre: 'u.nombre',
  correo: 'u.correo',
  ultimoAcceso: 'u.ultimo_acceso_en',
  habilitado: 'u.habilitado',
};

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLAVE_MINIMA = 8;
const CLAVE_MAXIMA = 200;

function exigirAdministrador(usuario) {
  // Solo lectura bloquea toda escritura, incluso con flag de administradora.
  if (usuario?.soloLectura) {
    throw sinPermiso('La cuenta de solo lectura no puede hacer cambios.');
  }
  if (!usuario?.administrador) {
    throw sinPermiso('Se requiere una cuenta administradora.');
  }
}

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

function correoObligatorio(valor) {
  const correo = textoObligatorio(valor, 'correo', 320).toLowerCase();
  if (!CORREO_VALIDO.test(correo)) {
    throw datosInvalidos('El correo no tiene un formato válido.');
  }
  return correo;
}

function claveObligatoria(valor) {
  if (typeof valor !== 'string' || valor === '') {
    throw datosInvalidos('El campo clave es obligatorio.');
  }
  if (valor.length < CLAVE_MINIMA || valor.length > CLAVE_MAXIMA) {
    throw datosInvalidos(`La clave debe tener entre ${CLAVE_MINIMA} y ${CLAVE_MAXIMA} caracteres.`);
  }
  return valor;
}

function booleanoOpcional(valor, campo, porDefecto) {
  if (valor === undefined || valor === null) return porDefecto;
  if (typeof valor !== 'boolean') {
    throw datosInvalidos(`El campo ${campo} debe ser booleano.`);
  }
  return valor;
}

function leerDispositivoIds(valor) {
  if (valor === undefined) return undefined;
  if (!Array.isArray(valor)) {
    throw datosInvalidos('El campo dispositivoIds debe ser una lista.');
  }
  const ids = valor.map((elemento) => {
    if (typeof elemento === 'string' && elemento.trim() !== '') return elemento.trim();
    if (typeof elemento === 'number' && Number.isInteger(elemento)) return String(elemento);
    throw datosInvalidos('Cada elemento de dispositivoIds debe ser un id válido.');
  });
  return [...new Set(ids)];
}

// Busca los equipos pedidos (id interno, público, anterior o identificador) y
// rechaza los deshabilitados: no se asignan equipos dados de baja.
async function resolverDispositivos(cliente, ids) {
  if (ids.length === 0) return [];
  const { rows } = await cliente.query(
    `SELECT d.id, d.id_legado, d.id_publico, d.nombre, d.habilitado
     FROM tracking.dmt_dispositivo d
     WHERE d.id_publico::text = ANY($1) OR d.id_legado::text = ANY($1) OR d.id::text = ANY($1)`,
    [ids],
  );
  const mapa = new Map();
  for (const fila of rows) {
    mapa.set(fila.id_publico, fila);
    mapa.set(String(fila.id), fila);
    if (fila.id_legado !== null && fila.id_legado !== undefined) {
      mapa.set(String(fila.id_legado), fila);
    }
  }
  const resueltos = [];
  const vistos = new Set();
  for (const id of ids) {
    const fila = mapa.get(id);
    if (!fila) throw datosInvalidos(`El dispositivo ${id} no existe.`);
    if (fila.habilitado !== true) throw datosInvalidos(`El dispositivo ${fila.nombre} no está habilitado.`);
    if (vistos.has(String(fila.id))) continue;
    vistos.add(String(fila.id));
    resueltos.push(fila);
  }
  return resueltos;
}

// nombre_usuario sale del correo (parte antes de la @, en minúsculas y sin
// espacios) y se le agrega un número si ya existe. La app inicia sesión con él.
async function derivarNombreUsuario(cliente, correo) {
  const base =
    correo
      .split('@')[0]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '')
      .slice(0, 40) || 'usuario';
  let candidato = base;
  for (let intento = 2; intento <= 100; intento += 1) {
    const { rowCount } = await cliente.query(
      'SELECT 1 FROM iam.dmt_usuario WHERE nombre_usuario = $1',
      [candidato],
    );
    if (rowCount === 0) return candidato;
    candidato = `${base}${intento}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Actualiza las asignaciones sin borrar historial: nunca se borra una fila de
// operations.dmt_asignacion, se usan `activa` y las fechas.
async function sincronizarAsignaciones(cliente, usuarioId, dispositivos) {
  const { rows: actuales } = await cliente.query(
    `SELECT a.dispositivo_id, d.id_publico
     FROM operations.dmt_asignacion a
     JOIN tracking.dmt_dispositivo d ON d.id = a.dispositivo_id
     WHERE a.usuario_id = $1 AND a.activa`,
    [usuarioId],
  );
  const activos = new Map(actuales.map((fila) => [String(fila.dispositivo_id), fila]));
  const destino = new Set(dispositivos.map((dispositivo) => String(dispositivo.id)));
  const asignados = [];
  const desasignados = [];
  for (const dispositivo of dispositivos) {
    if (activos.has(String(dispositivo.id))) continue;
    await cliente.query(
      `INSERT INTO operations.dmt_asignacion (usuario_id, dispositivo_id, activa, desde_en)
       VALUES ($1, $2, true, now())`,
      [usuarioId, dispositivo.id],
    );
    asignados.push(dispositivo.id_publico);
  }
  for (const [dispositivoId, fila] of activos) {
    if (destino.has(dispositivoId)) continue;
    await cliente.query(
      `UPDATE operations.dmt_asignacion
       SET activa = false, hasta_en = now(), actualizado_en = now()
       WHERE usuario_id = $1 AND dispositivo_id = $2 AND activa`,
      [usuarioId, Number(dispositivoId)],
    );
    desasignados.push(fila.id_publico);
  }
  return { asignados, desasignados };
}

async function contarAdministradoresActivos(cliente) {
  const { rows } = await cliente.query(
    'SELECT count(*)::int AS total FROM iam.dmt_usuario WHERE administrador AND habilitado',
  );
  return rows[0].total;
}

// Decision de la baja de usuarios. Es una funcion pura para poder probar la
// guarda del ultimo administrador, que por HTTP solo es alcanzable cuando el
// ejecutor se elimina a si mismo (un admin activo siempre se cuenta a si mismo).
export function motivoRechazoEliminacion({ esEjecutor, objetivoEsAdminActivo, administradoresActivos }) {
  if (objetivoEsAdminActivo && administradoresActivos <= 1) return 'ultimo_administrador';
  if (esEjecutor) return 'autoborrado';
  return null;
}

async function buscarUsuarioInterno(cliente, valor) {
  const { rows } = await cliente.query(
    `SELECT ${CAMPOS_USUARIO}
     FROM iam.dmt_usuario u
     WHERE u.id_publico::text = $1 OR u.id_legado::text = $1 OR u.id::text = $1
     LIMIT 1
     FOR UPDATE`,
    [String(valor)],
  );
  return rows[0] ?? null;
}

async function cargarUsuario(pool, id) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS_USUARIO}, ${SUBCONSULTA_DISPOSITIVOS}
     FROM iam.dmt_usuario u
     WHERE u.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listarUsuarios(ctx) {
  exigirAdministrador(ctx.usuario);
  const { pagina, tamano, desplazamiento } = leerPaginacion(ctx.url);
  const orden = leerOrden(ctx.url, ORDEN_USUARIOS, 'u.nombre ASC');
  const { rows } = await consultar(
    ctx.pool,
    `SELECT ${CAMPOS_USUARIO}, ${SUBCONSULTA_DISPOSITIVOS},
            count(*) OVER() AS total_filas
     FROM iam.dmt_usuario u
     ORDER BY ${orden.sql}, u.id
     LIMIT $1 OFFSET $2`,
    [tamano, desplazamiento],
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map((fila) => aUsuario(fila)),
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}

export async function obtenerUsuario(ctx) {
  exigirAdministrador(ctx.usuario);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT ${CAMPOS_USUARIO}, ${SUBCONSULTA_DISPOSITIVOS}
     FROM iam.dmt_usuario u
     WHERE u.id_publico::text = $1 OR u.id_legado::text = $1 OR u.id::text = $1
     LIMIT 1`,
    [String(ctx.params.id)],
    { signal: ctx.signal },
  );
  if (rows.length === 0) throw noEncontrado('El usuario no existe.');
  respuestaJson(ctx.res, 200, aUsuario(rows[0]));
}

export async function crearUsuario(ctx) {
  exigirAdministrador(ctx.usuario);
  const cuerpo = await leerCuerpoJson(ctx.req, 16384);
  const nombre = textoObligatorio(cuerpo.nombre, 'nombre');
  const correo = correoObligatorio(cuerpo.correo);
  const clave = claveObligatoria(cuerpo.clave);
  const administrador = booleanoOpcional(cuerpo.administrador, 'administrador', false);
  const soloLectura = booleanoOpcional(cuerpo.soloLectura, 'soloLectura', false);
  const dispositivoIds = leerDispositivoIds(cuerpo.dispositivoIds);
  const credencial = crearCredencial(clave);

  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const duplicado = await cliente.query(
      'SELECT 1 FROM iam.dmt_usuario WHERE lower(correo) = lower($1) LIMIT 1',
      [correo],
    );
    if (duplicado.rowCount > 0) {
      throw datosInvalidos(`El correo ${correo} ya está registrado.`);
    }
    const nombreUsuario = await derivarNombreUsuario(cliente, correo);
    const dispositivos = await resolverDispositivos(cliente, dispositivoIds ?? []);
    const { rows } = await cliente.query(
      `INSERT INTO iam.dmt_usuario
         (nombre_usuario, nombre, correo, hash_clave, sal, administrador, solo_lectura, habilitado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`,
      [nombreUsuario, nombre, correo, credencial.hash, credencial.sal, administrador, soloLectura],
    );
    const id = Number(rows[0].id);
    const { asignados } = await sincronizarAsignaciones(cliente, id, dispositivos);
    return { id, nombreUsuario, asignados };
  });

  const fila = await cargarUsuario(ctx.pool, resultado.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'crear_usuario',
    entidad: 'usuario',
    entidadId: fila.id,
    descripcion: `Usuario ${fila.correo ?? fila.nombre} creado.`,
    datos: {
      correo: fila.correo,
      administrador: fila.administrador,
      soloLectura: fila.soloLectura,
      nombreUsuario: resultado.nombreUsuario,
      dispositivosAsignados: resultado.asignados,
    },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 201, { usuario: aUsuario(fila) });
}

export async function actualizarUsuario(ctx) {
  exigirAdministrador(ctx.usuario);
  const cuerpo = await leerCuerpoJson(ctx.req, 16384);
  const cambios = {};
  if (cuerpo.nombre !== undefined) cambios.nombre = textoObligatorio(cuerpo.nombre, 'nombre');
  if (cuerpo.correo !== undefined) cambios.correo = correoObligatorio(cuerpo.correo);
  if (cuerpo.administrador !== undefined) cambios.administrador = booleanoOpcional(cuerpo.administrador, 'administrador', false);
  if (cuerpo.soloLectura !== undefined) cambios.soloLectura = booleanoOpcional(cuerpo.soloLectura, 'soloLectura', false);
  const clave = cuerpo.clave === undefined || cuerpo.clave === null || cuerpo.clave === ''
    ? null
    : claveObligatoria(cuerpo.clave);
  const dispositivoIds = leerDispositivoIds(cuerpo.dispositivoIds);
  if (Object.keys(cambios).length === 0 && clave === null && dispositivoIds === undefined) {
    throw datosInvalidos('No se enviaron cambios: indique nombre, correo, clave, administrador, soloLectura y/o dispositivoIds.');
  }

  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const actual = await buscarUsuarioInterno(cliente, ctx.params.id);
    if (!actual) throw noEncontrado('El usuario no existe.');
    if (cambios.correo && cambios.correo !== (actual.correo ?? '').toLowerCase()) {
      const duplicado = await cliente.query(
        'SELECT 1 FROM iam.dmt_usuario WHERE lower(correo) = lower($1) AND id <> $2 LIMIT 1',
        [cambios.correo, actual.id],
      );
      if (duplicado.rowCount > 0) {
        throw datosInvalidos(`El correo ${cambios.correo} ya está registrado.`);
      }
    }
    if (cambios.administrador === false && actual.administrador && actual.habilitado) {
      const administradores = await contarAdministradoresActivos(cliente);
      if (administradores <= 1) {
        throw datosInvalidos('No se puede quitar el rol de administrador al último administrador activo.');
      }
    }
    let indice = 1;
    const columnas = [];
    const valores = [];
    const agregar = (columna, valor) => {
      columnas.push(`${columna} = $${indice}`);
      valores.push(valor);
      indice += 1;
    };
    if (cambios.nombre !== undefined) agregar('nombre', cambios.nombre);
    if (cambios.correo !== undefined) agregar('correo', cambios.correo);
    if (cambios.administrador !== undefined) agregar('administrador', cambios.administrador);
    if (cambios.soloLectura !== undefined) agregar('solo_lectura', cambios.soloLectura);
    if (clave !== null) {
      const credencial = crearCredencial(clave);
      agregar('hash_clave', credencial.hash);
      agregar('sal', credencial.sal);
    }
    if (columnas.length > 0) {
      columnas.push('actualizado_en = now()');
      await cliente.query(
        `UPDATE iam.dmt_usuario SET ${columnas.join(', ')} WHERE id = $${indice}`,
        [...valores, actual.id],
      );
    }
    let sincronizacion = null;
    if (dispositivoIds !== undefined) {
      const dispositivos = await resolverDispositivos(cliente, dispositivoIds);
      sincronizacion = await sincronizarAsignaciones(cliente, actual.id, dispositivos);
    }
    const campos = [...Object.keys(cambios)];
    if (clave !== null) campos.push('clave');
    if (dispositivoIds !== undefined) campos.push('dispositivoIds');
    return { id: Number(actual.id), campos, sincronizacion };
  });

  const fila = await cargarUsuario(ctx.pool, resultado.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'editar_usuario',
    entidad: 'usuario',
    entidadId: fila.id,
    descripcion: `Usuario ${fila.correo ?? fila.nombre} actualizado.`,
    datos: {
      campos: resultado.campos,
      dispositivos: resultado.sincronizacion ?? undefined,
    },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { usuario: aUsuario(fila) });
}

export async function eliminarUsuario(ctx) {
  exigirAdministrador(ctx.usuario);
  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const actual = await buscarUsuarioInterno(cliente, ctx.params.id);
    if (!actual) throw noEncontrado('El usuario no existe.');
    const objetivoEsAdminActivo = actual.administrador && actual.habilitado;
    const administradores = await contarAdministradoresActivos(cliente);
    const motivo = motivoRechazoEliminacion({
      esEjecutor: Number(actual.id) === Number(ctx.usuario.id),
      objetivoEsAdminActivo,
      administradoresActivos: administradores,
    });
    if (motivo === 'ultimo_administrador') {
      throw datosInvalidos('No se puede eliminar al último administrador activo: la instancia quedaría sin administradores.');
    }
    if (motivo === 'autoborrado') {
      throw datosInvalidos('No puede eliminar su propia cuenta.');
    }
    if (!actual.habilitado) {
      return { id: Number(actual.id), correo: actual.correo, yaEliminado: true };
    }
    // Baja lógica: se marca deshabilitado, se cierran sus sesiones y se
    // desactivan sus asignaciones, sin borrar historial.
    await cliente.query(
      'UPDATE iam.dmt_usuario SET habilitado = false, actualizado_en = now() WHERE id = $1',
      [actual.id],
    );
    const { rowCount: sesionesRevocadas } = await cliente.query(
      `UPDATE iam.dmt_sesion
       SET revocada_en = now(), actualizado_en = now()
       WHERE usuario_id = $1 AND revocada_en IS NULL`,
      [actual.id],
    );
    const { rows: desasignadas } = await cliente.query(
      `UPDATE operations.dmt_asignacion
       SET activa = false, hasta_en = now(), actualizado_en = now()
       WHERE usuario_id = $1 AND activa
       RETURNING dispositivo_id`,
      [actual.id],
    );
    return {
      id: Number(actual.id),
      correo: actual.correo,
      yaEliminado: false,
      sesionesRevocadas,
      asignacionesDesactivadas: desasignadas.length,
    };
  });

  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'eliminar_usuario',
    entidad: 'usuario',
    entidadId: resultado.id,
    descripcion: `Usuario ${resultado.correo ?? resultado.id} dado de baja.`,
    datos: {
      bajaLogica: true,
      yaEliminado: resultado.yaEliminado,
      sesionesRevocadas: resultado.sesionesRevocadas ?? 0,
      asignacionesDesactivadas: resultado.asignacionesDesactivadas ?? 0,
    },
    req: ctx.req,
  });
  respuestaSinContenido(ctx.res);
}
