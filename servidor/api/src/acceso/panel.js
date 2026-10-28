// Cuentas del panel (atributos.sistema = true): quién entra, qué partes ve y
// a qué personal llega. Solo las administra una cuenta administradora.
//   GET   /api/v1/panel/opciones      -> {secciones, grupos, personas}
//   GET   /api/v1/panel/cuentas       -> {datos, total}
//   POST  /api/v1/panel/cuentas       -> 201 {cuenta}
//   GET   /api/v1/panel/cuentas/:id   -> {cuenta}
//   PATCH /api/v1/panel/cuentas/:id   -> {cuenta}
// No hay borrado: se deshabilitan. La clave nunca se devuelve ni se registra.

import { consultar, enTransaccion } from '../base/db.js';
import { conflicto, datosInvalidos, noEncontrado } from '../base/errores.js';
import { leerCuerpoJson, respuestaJson } from '../base/http.js';
import { auditar } from './sesiones.js';
import { crearCredencial } from './auth.js';
import { exigirAdministracion } from './permisos.js';
import { claveObligatoria, usuarioObligatorio } from './cuentas.js';
import { ASIGNABLES, SECCIONES, seccionesDe } from './secciones.js';
import { minutosBloqueo } from '../../../comun/acceso.js';

export const TIPOS = ['administrador', 'operador', 'solo_lectura'];

const CAMPOS = `u.id, u.id_publico, u.nombre_usuario, u.nombre, u.administrador, u.solo_lectura,
  u.habilitado, u.atributos, u.ultimo_acceso_en, u.bloqueado_hasta`;
const ES_DE_PANEL = "coalesce(u.atributos->>'sistema' = 'true', false)";
const ES_PERSONA = `NOT ${ES_DE_PANEL}`;

export function tipoDe(fila) {
  if (fila.administrador) return 'administrador';
  return fila.solo_lectura ? 'solo_lectura' : 'operador';
}

function tipoValido(valor) {
  if (!TIPOS.includes(valor)) throw datosInvalidos(`El campo tipo debe ser: ${TIPOS.join(', ')}.`);
  return valor;
}

export function seccionesValidas(valor) {
  if (!Array.isArray(valor)) throw datosInvalidos('El campo secciones debe ser una lista.');
  const lista = [...new Set(valor)];
  const mala = lista.find((codigo) => !ASIGNABLES.includes(codigo));
  if (mala !== undefined) throw datosInvalidos(`La sección ${String(mala).slice(0, 40)} no existe o es solo de administradores.`);
  return lista;
}

function listaIds(valor, campo) {
  if (valor === undefined) return undefined;
  if (!Array.isArray(valor)) throw datosInvalidos(`El campo ${campo} debe ser una lista.`);
  return [...new Set(valor.map((v) => {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isInteger(v)) return String(v);
    throw datosInvalidos(`Cada elemento de ${campo} debe ser un id válido.`);
  }))];
}

async function resolver(cliente, sql, ids, campo) {
  if (ids.length === 0) return [];
  const { rows } = await cliente.query(sql, [ids]);
  if (new Set(rows.map((f) => String(f.id))).size !== ids.length) {
    throw datosInvalidos(`Alguno de los ${campo} no existe.`);
  }
  return rows;
}

const resolverGrupos = (cliente, ids) => resolver(cliente,
  'SELECT id FROM iam.dmt_grupo WHERE id_publico::text = ANY($1) OR id::text = ANY($1)', ids, 'grupos');
const resolverPersonas = (cliente, ids) => resolver(cliente,
  `SELECT u.id FROM iam.dmt_usuario u
    WHERE (u.id_publico::text = ANY($1) OR u.id::text = ANY($1)) AND ${ES_PERSONA}`, ids, 'usuarios');

async function reemplazar(cliente, tabla, columna, cuentaId, filas) {
  await cliente.query(`DELETE FROM iam.${tabla} WHERE cuenta_id = $1`, [cuentaId]);
  for (const fila of filas) {
    await cliente.query(
      `INSERT INTO iam.${tabla} (cuenta_id, ${columna}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [cuentaId, fila.id],
    );
  }
}

async function sincronizarRol(cliente, cuentaId, tipo) {
  await cliente.query('DELETE FROM iam.dmt_usuario_rol WHERE usuario_id = $1', [cuentaId]);
  await cliente.query(
    `INSERT INTO iam.dmt_usuario_rol (usuario_id, rol_id)
     SELECT $1, id FROM iam.dmt_rol WHERE codigo = $2`,
    [cuentaId, tipo],
  );
}

async function contarAdministradoresActivos(cliente) {
  const { rows } = await cliente.query(
    'SELECT count(*)::int AS total FROM iam.dmt_usuario WHERE administrador AND habilitado',
  );
  return rows[0].total;
}

async function revocarSesiones(cliente, cuentaId, salvo) {
  await cliente.query(
    `UPDATE iam.dmt_sesion SET revocada_en = now(), actualizado_en = now()
      WHERE usuario_id = $1 AND revocada_en IS NULL AND ($2::bigint IS NULL OR id <> $2)`,
    [cuentaId, salvo ?? null],
  );
}

function aCuenta(fila, grupos, personas, yoId) {
  return {
    id: Number(fila.id),
    idPublico: fila.id_publico,
    usuario: fila.nombre_usuario,
    nombre: fila.nombre,
    tipo: tipoDe(fila),
    secciones: seccionesDe(fila.administrador === true, fila.atributos),
    grupos,
    personas,
    habilitado: fila.habilitado === true,
    bloqueada: minutosBloqueo(fila.bloqueado_hasta) > 0,
    ultimoAcceso: fila.ultimo_acceso_en ? new Date(fila.ultimo_acceso_en).toISOString() : null,
    propia: Number(fila.id) === Number(yoId),
  };
}

async function cargar(ejecutor, yoId, { valor, todas } = {}) {
  const { rows } = await ejecutor.query(
    `SELECT ${CAMPOS} FROM iam.dmt_usuario u
      WHERE ${ES_DE_PANEL}
        AND ($1::text IS NULL OR u.id_publico::text = $1 OR u.id::text = $1)
      ORDER BY u.habilitado DESC, lower(u.nombre), u.id`,
    [todas ? null : String(valor)],
  );
  const ids = rows.map((f) => Number(f.id));
  const [g, p] = await Promise.all([
    ejecutor.query(
      `SELECT pg.cuenta_id, g.id_publico, g.nombre FROM iam.dmt_panel_grupo pg
         JOIN iam.dmt_grupo g ON g.id = pg.grupo_id
        WHERE pg.cuenta_id = ANY($1::bigint[]) ORDER BY g.nombre`, [ids]),
    ejecutor.query(
      `SELECT pp.cuenta_id, u.id_publico, u.nombre, u.nombre_usuario FROM iam.dmt_panel_persona pp
         JOIN iam.dmt_usuario u ON u.id = pp.persona_id
        WHERE pp.cuenta_id = ANY($1::bigint[]) ORDER BY u.nombre`, [ids]),
  ]);
  return rows.map((fila) => aCuenta(
    fila,
    g.rows.filter((x) => Number(x.cuenta_id) === Number(fila.id)).map((x) => ({ id: x.id_publico, nombre: x.nombre })),
    p.rows.filter((x) => Number(x.cuenta_id) === Number(fila.id))
      .map((x) => ({ id: x.id_publico, nombre: x.nombre, usuario: x.nombre_usuario })),
    yoId,
  ));
}

export async function listarOpciones(ctx) {
  await exigirAdministracion(ctx);
  const [grupos, personas] = await Promise.all([
    consultar(ctx.pool, 'SELECT id_publico, nombre FROM iam.dmt_grupo ORDER BY nombre', [], { signal: ctx.signal }),
    consultar(
      ctx.pool,
      `SELECT u.id_publico, u.nombre, u.nombre_usuario FROM iam.dmt_usuario u
        WHERE ${ES_PERSONA} AND u.habilitado ORDER BY lower(u.nombre), u.id`,
      [],
      { signal: ctx.signal },
    ),
  ]);
  respuestaJson(ctx.res, 200, {
    secciones: SECCIONES.map((s) => ({
      codigo: s.codigo,
      texto: s.texto,
      asignable: !s.soloAdministrador,
    })),
    grupos: grupos.rows.map((f) => ({ id: f.id_publico, nombre: f.nombre })),
    personas: personas.rows.map((f) => ({ id: f.id_publico, nombre: f.nombre, usuario: f.nombre_usuario })),
  });
}

export async function listarCuentasPanel(ctx) {
  await exigirAdministracion(ctx);
  const datos = await cargar(ctx.pool, ctx.usuario.id, { todas: true });
  respuestaJson(ctx.res, 200, { datos, total: datos.length });
}

export async function obtenerCuentaPanel(ctx) {
  await exigirAdministracion(ctx);
  const [cuenta] = await cargar(ctx.pool, ctx.usuario.id, { valor: ctx.params.id });
  if (!cuenta) throw noEncontrado('La cuenta de panel no existe.');
  respuestaJson(ctx.res, 200, { cuenta });
}

function nombreObligatorio(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') throw datosInvalidos('El campo nombre es obligatorio.');
  if (valor.trim().length > 200) throw datosInvalidos('El campo nombre supera 200 caracteres.');
  return valor.trim();
}

export async function crearCuentaPanel(ctx) {
  await exigirAdministracion(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 16384);
  const nombre = nombreObligatorio(cuerpo.nombre);
  const usuario = usuarioObligatorio(cuerpo.usuario);
  const credencial = crearCredencial(claveObligatoria(cuerpo.clave));
  const tipo = tipoValido(cuerpo.tipo);
  const secciones = cuerpo.secciones === undefined ? null : seccionesValidas(cuerpo.secciones);
  const grupoIds = listaIds(cuerpo.grupoIds, 'grupoIds') ?? [];
  const personaIds = listaIds(cuerpo.personaIds, 'personaIds') ?? [];

  const id = await enTransaccion(ctx.pool, async (cliente) => {
    // Distingue mayúsculas: Santiago y santiago son cuentas distintas.
    const repetido = await cliente.query('SELECT 1 FROM iam.dmt_usuario WHERE nombre_usuario = $1', [usuario]);
    if (repetido.rowCount > 0) throw conflicto(`El usuario ${usuario} ya existe.`);
    const grupos = await resolverGrupos(cliente, grupoIds);
    const personas = await resolverPersonas(cliente, personaIds);
    const atributos = { sistema: true, ...(secciones ? { panel: { secciones } } : {}) };
    const { rows } = await cliente.query(
      `INSERT INTO iam.dmt_usuario
         (nombre_usuario, nombre, hash_clave, sal, administrador, solo_lectura, habilitado, atributos)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7::jsonb) RETURNING id`,
      [usuario, nombre, credencial.hash, credencial.sal, tipo === 'administrador', tipo === 'solo_lectura',
        JSON.stringify(atributos)],
    );
    const nuevo = Number(rows[0].id);
    await sincronizarRol(cliente, nuevo, tipo);
    await reemplazar(cliente, 'dmt_panel_grupo', 'grupo_id', nuevo, grupos);
    await reemplazar(cliente, 'dmt_panel_persona', 'persona_id', nuevo, personas);
    return nuevo;
  });
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario.id,
    accion: 'crear_cuenta_panel',
    entidad: 'usuario',
    entidadId: id,
    descripcion: `Cuenta de panel ${usuario} creada (${tipo}).`,
    datos: { tipo, secciones, grupos: grupoIds.length, personas: personaIds.length },
    req: ctx.req,
  });
  const [cuenta] = await cargar(ctx.pool, ctx.usuario.id, { valor: id });
  respuestaJson(ctx.res, 201, { cuenta });
}

export async function actualizarCuentaPanel(ctx) {
  await exigirAdministracion(ctx);
  const c = await leerCuerpoJson(ctx.req, 16384);
  const nombre = c.nombre === undefined ? undefined : nombreObligatorio(c.nombre);
  const tipo = c.tipo === undefined ? undefined : tipoValido(c.tipo);
  const secciones = c.secciones === undefined ? undefined : seccionesValidas(c.secciones);
  const grupoIds = listaIds(c.grupoIds, 'grupoIds');
  const personaIds = listaIds(c.personaIds, 'personaIds');
  if (c.habilitado !== undefined && typeof c.habilitado !== 'boolean') {
    throw datosInvalidos('El campo habilitado debe ser booleano.');
  }
  const habilitado = c.habilitado;
  const credencial = c.clave === undefined || c.clave === '' ? null : crearCredencial(claveObligatoria(c.clave));
  const desbloquear = c.desbloquear === true;
  const campos = Object.entries({ nombre, tipo, secciones, grupoIds, personaIds, habilitado })
    .filter(([, v]) => v !== undefined).map(([k]) => k);
  if (credencial) campos.push('clave');
  if (desbloquear) campos.push('desbloquear');
  if (campos.length === 0) throw datosInvalidos('No se enviaron cambios.');

  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT ${CAMPOS} FROM iam.dmt_usuario u
        WHERE ${ES_DE_PANEL} AND (u.id_publico::text = $1 OR u.id::text = $1) FOR UPDATE`,
      [String(ctx.params.id)],
    );
    const actual = rows[0];
    if (!actual) throw noEncontrado('La cuenta de panel no existe.');
    const propia = Number(actual.id) === Number(ctx.usuario.id);
    if (propia) {
      if (habilitado === false) throw datosInvalidos('No puedes deshabilitar tu propia cuenta.');
      if (tipo !== undefined && tipo !== tipoDe(actual)) throw datosInvalidos('No puedes cambiar tu propio tipo de cuenta.');
      if (secciones !== undefined || grupoIds !== undefined || personaIds !== undefined) {
        throw datosInvalidos('No puedes cambiar tus propios permisos.');
      }
    }
    const tipoNuevo = tipo ?? tipoDe(actual);
    const pierdeAdministracion = actual.administrador && actual.habilitado
      && (tipoNuevo !== 'administrador' || habilitado === false);
    if (pierdeAdministracion && (await contarAdministradoresActivos(cliente)) <= 1) {
      throw datosInvalidos('No se puede quitar la administración ni deshabilitar a la última cuenta administradora.');
    }
    const atributos = { ...actual.atributos };
    if (secciones !== undefined) atributos.panel = { ...atributos.panel, secciones };
    await cliente.query(
      `UPDATE iam.dmt_usuario SET
         nombre = $2, administrador = $3, solo_lectura = $4, habilitado = $5, atributos = $6::jsonb,
         hash_clave = COALESCE($7, hash_clave), sal = COALESCE($8, sal),
         intentos_fallidos = CASE WHEN $9 THEN 0 ELSE intentos_fallidos END,
         bloqueado_hasta = CASE WHEN $9 THEN NULL ELSE bloqueado_hasta END,
         actualizado_en = now()
       WHERE id = $1`,
      [actual.id, nombre ?? actual.nombre, tipoNuevo === 'administrador', tipoNuevo === 'solo_lectura',
        habilitado ?? actual.habilitado, JSON.stringify(atributos),
        credencial?.hash ?? null, credencial?.sal ?? null, desbloquear],
    );
    if (tipo !== undefined) await sincronizarRol(cliente, actual.id, tipoNuevo);
    if (grupoIds !== undefined) {
      await reemplazar(cliente, 'dmt_panel_grupo', 'grupo_id', actual.id, await resolverGrupos(cliente, grupoIds));
    }
    if (personaIds !== undefined) {
      await reemplazar(cliente, 'dmt_panel_persona', 'persona_id', actual.id, await resolverPersonas(cliente, personaIds));
    }
    // Una clave nueva o una baja cierran las sesiones abiertas de esa cuenta.
    if (credencial || habilitado === false) {
      await revocarSesiones(cliente, actual.id, propia ? ctx.sesion?.sesionId : null);
    }
    return { id: Number(actual.id), usuario: actual.nombre_usuario };
  });
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario.id,
    accion: 'actualizar_cuenta_panel',
    entidad: 'usuario',
    entidadId: resultado.id,
    descripcion: `Cuenta de panel ${resultado.usuario} actualizada.`,
    datos: { campos, tipo, habilitado, secciones },
    req: ctx.req,
  });
  const [cuenta] = await cargar(ctx.pool, ctx.usuario.id, { valor: resultado.id });
  respuestaJson(ctx.res, 200, { cuenta });
}
