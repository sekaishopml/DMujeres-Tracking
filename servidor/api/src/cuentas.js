// Cuentas: GET/POST/PATCH/DELETE /api/v1/usuarios.
// El login es `usuario` (único). La contraseña se guarda con hash y nunca sale.
// Cada cuenta trae sus grupos, sus roles y su configApp. La baja es lógica
// (habilitado=false) y se puede revertir.
// Con `crearEquipo`, el POST crea también el equipo de la persona (nombre =
// nombre de la persona, identificador = usuario en minúsculas) y su
// asignación; 409 si el identificador ya existe. Responde {usuario, equipo}.

import { consultar, enTransaccion } from './db.js';
import { datosInvalidos, noEncontrado, conflicto } from './errores.js';
import {
  leerCuerpoJson,
  leerOrden,
  leerPaginacion,
  respuestaJson,
  respuestaSinContenido,
} from './http.js';
import { auditar, SUBCONSULTA_DISPOSITIVOS } from './sesiones.js';
import { crearCredencial } from './auth.js';
import { exigirOperativo } from './permisos.js';
import {
  CLAVES_CONFIG_APP,
  CONFIG_POR_DEFECTO,
  configAppDe,
} from './esquema.js';
import { motivoRechazoEliminacion } from './usuarios.js';

const CAMPOS_CUENTA = `u.id, u.id_publico, u.nombre_usuario, u.nombre, u.correo,
  u.telefono, u.cargo, u.administrador, u.solo_lectura, u.habilitado,
  u.atributos, u.ultimo_acceso_en`;

const ORDEN_CUENTAS = {
  id: 'u.id',
  nombre: 'u.nombre',
  usuario: 'u.nombre_usuario',
  habilitado: 'u.habilitado',
  ultimoAcceso: 'u.ultimo_acceso_en',
};

const CLAVE_MINIMA = 8;
const CLAVE_MAXIMA = 200;
const USUARIO_VALIDO = /^[A-Za-z0-9._-]{2,40}$/;
const MINIMOS_ENTERO = {
  intervalSeconds: 5,
  min_interval_seconds: 5,
  distanceMeters: 0,
  angleDegrees: 0,
  bufferMax: 100,
  ackTimeoutSeconds: 5,
  maxRetries: 0,
  l1_max_update_delay_ms: 5000,
};
const MAXIMOS_ENTERO = {
  intervalSeconds: 3600,
  min_interval_seconds: 3600,
  distanceMeters: 10000,
  angleDegrees: 180,
  bufferMax: 20000,
  ackTimeoutSeconds: 120,
  maxRetries: 100,
  l1_max_update_delay_ms: 300000,
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

function textoOpcional(valor, campo, maximo = 200) {
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

function usuarioObligatorio(valor) {
  const limpio = textoObligatorio(valor, 'usuario', 40);
  if (!USUARIO_VALIDO.test(limpio)) {
    throw datosInvalidos('El campo usuario solo admite letras, números, punto, guion y guion bajo (2 a 40).');
  }
  return limpio;
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

function booleanoOpcional(valor, campo) {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== 'boolean') {
    throw datosInvalidos(`El campo ${campo} debe ser booleano.`);
  }
  return valor;
}

function listaIds(valor, campo) {
  if (valor === undefined || valor === null) return undefined;
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

function validarConfigApp(valor) {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    throw datosInvalidos('El campo configApp debe ser un objeto.');
  }
  const limpio = {};
  for (const [clave, dato] of Object.entries(valor)) {
    if (!CLAVES_CONFIG_APP.includes(clave)) {
      throw datosInvalidos(`La clave ${clave} no es configurable. Permitidas: ${CLAVES_CONFIG_APP.join(', ')}.`);
    }
    const defecto = CONFIG_POR_DEFECTO[clave];
    if (typeof defecto === 'boolean') {
      if (typeof dato !== 'boolean') {
        throw datosInvalidos(`El valor de ${clave} debe ser booleano.`);
      }
    } else if (typeof defecto === 'number') {
      if (typeof dato !== 'number' || !Number.isFinite(dato)) {
        throw datosInvalidos(`El valor de ${clave} debe ser un número.`);
      }
      const minimo = MINIMOS_ENTERO[clave];
      const maximo = MAXIMOS_ENTERO[clave];
      if ((minimo !== undefined && dato < minimo) || (maximo !== undefined && dato > maximo)) {
        throw datosInvalidos(`El valor de ${clave} debe estar entre ${minimo} y ${maximo}.`);
      }
    } else {
      if (typeof dato !== 'string') {
        throw datosInvalidos(`El valor de ${clave} debe ser texto.`);
      }
      if (dato.length > 500) {
        throw datosInvalidos(`El valor de ${clave} supera 500 caracteres.`);
      }
    }
    limpio[clave] = dato;
  }
  return limpio;
}

async function resolverGrupos(cliente, ids) {
  if (ids.length === 0) return [];
  const { rows } = await cliente.query(
    `SELECT id, id_publico, nombre
       FROM iam.dmt_grupo
      WHERE id_publico::text = ANY($1) OR id::text = ANY($1) OR nombre = ANY($1)`,
    [ids],
  );
  const porId = new Map();
  const porPublico = new Map();
  const porNombre = new Map();
  for (const fila of rows) {
    porId.set(String(fila.id), fila);
    porPublico.set(String(fila.id_publico), fila);
    porNombre.set(fila.nombre, fila);
  }
  const resueltos = [];
  const vistos = new Set();
  for (const id of ids) {
    const fila = porId.get(id) ?? porPublico.get(id) ?? porNombre.get(id);
    if (!fila) throw datosInvalidos(`El grupo ${id} no existe.`);
    if (vistos.has(String(fila.id))) continue;
    vistos.add(String(fila.id));
    resueltos.push(fila);
  }
  return resueltos;
}

async function resolverRoles(cliente, ids) {
  if (ids.length === 0) return [];
  const { rows } = await cliente.query(
    `SELECT id, id_publico, codigo, nombre
       FROM iam.dmt_rol
      WHERE id_publico::text = ANY($1) OR id::text = ANY($1) OR codigo = ANY($1)`,
    [ids],
  );
  const porId = new Map();
  const porPublico = new Map();
  const porCodigo = new Map();
  for (const fila of rows) {
    porId.set(String(fila.id), fila);
    porPublico.set(String(fila.id_publico), fila);
    porCodigo.set(fila.codigo, fila);
  }
  const resueltos = [];
  const vistos = new Set();
  for (const id of ids) {
    const fila = porId.get(id) ?? porPublico.get(id) ?? porCodigo.get(id);
    if (!fila) throw datosInvalidos(`El rol ${id} no existe.`);
    if (vistos.has(String(fila.id))) continue;
    vistos.add(String(fila.id));
    resueltos.push(fila);
  }
  return resueltos;
}

async function gruposDe(poolOCiente, usuarioId) {
  const { rows } = await poolOCiente.query(
    `SELECT g.id, g.id_publico, g.nombre
       FROM iam.dmt_usuario_grupo ug
       JOIN iam.dmt_grupo g ON g.id = ug.grupo_id
      WHERE ug.usuario_id = $1
      ORDER BY g.nombre, g.id`,
    [Number(usuarioId)],
  );
  return rows.map((fila) => ({
    id: Number(fila.id),
    idPublico: fila.id_publico,
    nombre: fila.nombre,
  }));
}

async function rolesDe(poolOCiente, usuarioId) {
  const { rows } = await poolOCiente.query(
    `SELECT r.id, r.id_publico, r.codigo, r.nombre
       FROM iam.dmt_usuario_rol ur
       JOIN iam.dmt_rol r ON r.id = ur.rol_id
      WHERE ur.usuario_id = $1
      ORDER BY r.id`,
    [Number(usuarioId)],
  );
  return rows.map((fila) => ({
    id: Number(fila.id),
    idPublico: fila.id_publico,
    codigo: fila.codigo,
    nombre: fila.nombre,
  }));
}

// Equipos del usuario: asignaciones activas y vigentes sobre equipos
// habilitados (el mismo criterio que Seguimiento y Repetición de ruta).
// Ordenados por nombre.
function aEquipo(fila) {
  return {
    id: Number(fila.id),
    idPublico: fila.id_publico,
    nombre: fila.nombre,
    identificador: fila.identificador ?? null,
  };
}

async function equiposDe(poolOCliente, usuarioId) {
  const { rows } = await poolOCliente.query(
    `SELECT d.id, d.id_publico, d.nombre, d.identificador
       FROM operations.dmt_asignacion a
       JOIN tracking.dmt_dispositivo d ON d.id = a.dispositivo_id
      WHERE a.usuario_id = $1 AND a.activa
        AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())
        AND d.habilitado
      ORDER BY d.nombre, d.id`,
    [Number(usuarioId)],
  );
  return rows.map(aEquipo);
}

// El panel envía la lista completa de equipos; cada uno puede venir como id
// interno, id público, identificador o id anterior. Se ignoran repetidos.
function listaDispositivosObligatoria(valor) {
  if (valor === undefined || valor === null) {
    throw datosInvalidos('El campo dispositivoIds es obligatorio.');
  }
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

// Busca cada equipo pedido. 404 si no existe o está deshabilitado (no se dice
// cuál de las dos cosas).
async function resolverDispositivos(cliente, ids) {
  if (ids.length === 0) return [];
  const { rows } = await cliente.query(
    `SELECT id, id_legado, id_publico, nombre, identificador, habilitado
       FROM tracking.dmt_dispositivo
      WHERE id_publico::text = ANY($1) OR id::text = ANY($1)
         OR identificador = ANY($1) OR id_legado::text = ANY($1)`,
    [ids],
  );
  const porId = new Map();
  const porPublico = new Map();
  const porIdentificador = new Map();
  const porLegado = new Map();
  for (const fila of rows) {
    porId.set(String(fila.id), fila);
    porPublico.set(String(fila.id_publico), fila);
    if (fila.identificador) porIdentificador.set(fila.identificador, fila);
    if (fila.id_legado !== null && fila.id_legado !== undefined) {
      porLegado.set(String(fila.id_legado), fila);
    }
  }
  const resueltos = [];
  const vistos = new Set();
  for (const id of ids) {
    const fila = porId.get(id) ?? porPublico.get(id) ?? porIdentificador.get(id) ?? porLegado.get(id);
    if (!fila) throw noEncontrado(`El equipo ${id} no existe.`);
    if (fila.habilitado !== true) throw noEncontrado(`El equipo ${fila.nombre} no está habilitado.`);
    if (vistos.has(String(fila.id))) continue;
    vistos.add(String(fila.id));
    resueltos.push(fila);
  }
  return resueltos;
}

function aCuenta(fila, grupos, roles, dispositivoIds) {
  return {
    id: Number(fila.id),
    idPublico: fila.id_publico,
    usuario: fila.nombre_usuario,
    nombre: fila.nombre,
    correo: fila.correo ?? null,
    telefono: fila.telefono ?? null,
    cargo: fila.cargo ?? null,
    habilitado: fila.habilitado === true,
    administrador: fila.administrador === true,
    soloLectura: fila.solo_lectura === true,
    grupos: grupos ?? [],
    roles: roles ?? [],
    configApp: configAppDe(fila.atributos),
    dispositivoIds: Array.isArray(dispositivoIds ?? fila.dispositivo_ids)
      ? (dispositivoIds ?? fila.dispositivo_ids).map(String)
      : [],
  };
}

async function cargarCuenta(pool, id) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS_CUENTA}, ${SUBCONSULTA_DISPOSITIVOS}
       FROM iam.dmt_usuario u
      WHERE u.id = $1`,
    [Number(id)],
  );
  if (rows.length === 0) return null;
  const fila = rows[0];
  const [grupos, roles] = await Promise.all([gruposDe(pool, fila.id), rolesDe(pool, fila.id)]);
  return aCuenta(fila, grupos, roles);
}

async function buscarCuentaInterna(cliente, valor) {
  const texto = String(valor);
  const { rows } = await cliente.query(
    `SELECT ${CAMPOS_CUENTA}
       FROM iam.dmt_usuario u
      WHERE u.id_publico::text = $1 OR u.id::text = $1 OR u.nombre_usuario = $1
      LIMIT 1
      FOR UPDATE`,
    [texto],
  );
  return rows[0] ?? null;
}

async function contarAdministradoresActivos(cliente) {
  const { rows } = await cliente.query(
    'SELECT count(*)::int AS total FROM iam.dmt_usuario WHERE administrador AND habilitado',
  );
  return rows[0].total;
}

async function sincronizarGrupos(cliente, usuarioId, grupos) {
  // Una persona pertenece a un solo grupo.
  if (grupos.length > 1) throw datosInvalidos('Una persona solo puede estar en un grupo.');
  await cliente.query('DELETE FROM iam.dmt_usuario_grupo WHERE usuario_id = $1', [Number(usuarioId)]);
  for (const grupo of grupos) {
    await cliente.query(
      'INSERT INTO iam.dmt_usuario_grupo (usuario_id, grupo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [Number(usuarioId), Number(grupo.id)],
    );
  }
}

async function sincronizarRoles(cliente, usuarioId, roles) {
  await cliente.query('DELETE FROM iam.dmt_usuario_rol WHERE usuario_id = $1', [Number(usuarioId)]);
  for (const rol of roles) {
    await cliente.query(
      'INSERT INTO iam.dmt_usuario_rol (usuario_id, rol_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [Number(usuarioId), Number(rol.id)],
    );
  }
}

export async function listarCuentas(ctx) {
  await exigirOperativo(ctx);
  const { pagina, tamano, desplazamiento } = leerPaginacion(ctx.url);
  // Orden del plantel: activas primero y al final las dadas de baja, cada
  // bloque en orden alfabético (misma regla que muestra el panel).
  const orden = leerOrden(ctx.url, ORDEN_CUENTAS, 'u.habilitado DESC, lower(u.nombre) ASC');
  const { rows } = await consultar(
    ctx.pool,
    `SELECT ${CAMPOS_CUENTA}, ${SUBCONSULTA_DISPOSITIVOS},
            count(*) OVER() AS total_filas
       FROM iam.dmt_usuario u
       ORDER BY ${orden.sql}, u.id
       LIMIT $1 OFFSET $2`,
    [tamano, desplazamiento],
    { signal: ctx.signal },
  );
  const datos = [];
  for (const fila of rows) {
    const [grupos, roles] = await Promise.all([gruposDe(ctx.pool, fila.id), rolesDe(ctx.pool, fila.id)]);
    datos.push(aCuenta(fila, grupos, roles));
  }
  respuestaJson(ctx.res, 200, {
    datos,
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}

export async function obtenerCuenta(ctx) {
  await exigirOperativo(ctx);
  const texto = String(ctx.params.id);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT ${CAMPOS_CUENTA}, ${SUBCONSULTA_DISPOSITIVOS}
       FROM iam.dmt_usuario u
      WHERE u.id_publico::text = $1 OR u.id::text = $1 OR u.nombre_usuario = $1
      LIMIT 1`,
    [texto],
    { signal: ctx.signal },
  );
  if (rows.length === 0) throw noEncontrado('El usuario no existe.');
  const fila = rows[0];
  const [grupos, roles] = await Promise.all([gruposDe(ctx.pool, fila.id), rolesDe(ctx.pool, fila.id)]);
  respuestaJson(ctx.res, 200, { usuario: aCuenta(fila, grupos, roles) });
}

export async function crearCuenta(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 16384);
  const usuario = usuarioObligatorio(cuerpo.usuario);
  const clave = claveObligatoria(cuerpo.clave);
  const nombre = textoObligatorio(cuerpo.nombre, 'nombre');
  const telefono = textoOpcional(cuerpo.telefono, 'telefono', 40);
  const cargo = textoOpcional(cuerpo.cargo, 'cargo', 200);
  const grupoIds = listaIds(cuerpo.grupoIds, 'grupoIds') ?? [];
  const rolIds = listaIds(cuerpo.rolIds, 'rolIds') ?? [];
  const configApp = validarConfigApp(cuerpo.configApp) ?? null;
  // Si no se indica, una persona de campo nace con su equipo; una cuenta de
  // administración no (no se rastrea).
  const crearEquipoSolicitado = booleanoOpcional(cuerpo.crearEquipo, 'crearEquipo');
  // iPhone: el equipo usa Traccar Client y se identifica con el ID que esa
  // app trae (se copia de su pantalla), no con el usuario.
  const ios = cuerpo.plataforma === 'ios';
  if (cuerpo.plataforma != null && !['android', 'ios'].includes(cuerpo.plataforma)) {
    throw datosInvalidos('plataforma debe ser android o ios.');
  }
  const idTraccar = ios ? textoObligatorio(cuerpo.identificadorEquipo, 'identificadorEquipo', 64) : null;
  if (idTraccar != null && !/^[A-Za-z0-9._-]+$/.test(idTraccar)) {
    throw datosInvalidos('El ID del iPhone solo admite letras, números, punto, guion y guion bajo.');
  }
  const credencial = crearCredencial(clave);

  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const duplicado = await cliente.query(
      'SELECT 1 FROM iam.dmt_usuario WHERE lower(nombre_usuario) = lower($1) LIMIT 1',
      [usuario],
    );
    if (duplicado.rowCount > 0) {
      throw conflicto(`El usuario ${usuario} ya existe.`);
    }
    const grupos = await resolverGrupos(cliente, grupoIds);
    const roles = await resolverRoles(cliente, rolIds);
    const codigos = roles.map((rol) => rol.codigo);
    // Si se pide administrador y el rol existe, se asigna; si el rol no
    // existe, manda la bandera.
    const pideAdministrador = cuerpo.administrador === true;
    if (pideAdministrador && !codigos.includes('administrador')) {
      const rolAdmin = await cliente.query(
        "SELECT id, codigo, nombre FROM iam.dmt_rol WHERE codigo = 'administrador' LIMIT 1",
      );
      if (rolAdmin.rows[0]) {
        roles.push(rolAdmin.rows[0]);
        codigos.push(rolAdmin.rows[0].codigo);
      }
    }
    const administrador = pideAdministrador || codigos.includes('administrador');
    const soloLectura = !administrador && codigos.includes('solo_lectura');
    const crearEquipo = crearEquipoSolicitado ?? !administrador;
    const atributos = configApp && Object.keys(configApp).length > 0
      ? JSON.stringify({ configApp })
      : '{}';
    const { rows } = await cliente.query(
      `INSERT INTO iam.dmt_usuario
         (nombre_usuario, nombre, telefono, cargo, hash_clave, sal,
          administrador, solo_lectura, habilitado, atributos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9::jsonb)
       RETURNING id`,
      [usuario, nombre, telefono, cargo, credencial.hash, credencial.sal,
        administrador, soloLectura, atributos],
    );
    const id = Number(rows[0].id);
    await sincronizarGrupos(cliente, id, grupos);
    await sincronizarRoles(cliente, id, roles);
    // Equipo propio de la persona de campo (misma transacción: si el
    // identificador ya existe todo se deshace, sin usuario a medias). El
    // equipo nace habilitado y con asignación activa vigente para que la
    // persona aparezca en replay/en vivo.
    let equipo = null;
    if (crearEquipo) {
      const identificador = (idTraccar ?? usuario).toLowerCase();
      const ocupado = await cliente.query(
        'SELECT 1 FROM tracking.dmt_dispositivo WHERE identificador = $1 LIMIT 1',
        [identificador],
      );
      if (ocupado.rowCount > 0) {
        throw conflicto(`El identificador de equipo ${identificador} ya existe.`);
      }
      let filaEquipo;
      try {
        const insertado = await cliente.query(
          `INSERT INTO tracking.dmt_dispositivo (nombre, identificador, habilitado, atributos)
           VALUES ($1, $2, true, $3::jsonb)
           RETURNING id, id_publico, nombre, identificador`,
          [nombre, identificador, JSON.stringify({ plataforma: ios ? 'ios' : 'android' })],
        );
        filaEquipo = insertado.rows[0];
      } catch (error) {
        if (error?.code === '23505') {
          throw conflicto(`El identificador de equipo ${identificador} ya existe.`);
        }
        throw error;
      }
      await cliente.query(
        `INSERT INTO operations.dmt_asignacion (usuario_id, dispositivo_id, activa, desde_en)
         VALUES ($1, $2, true, now())`,
        [id, filaEquipo.id],
      );
      equipo = {
        id: Number(filaEquipo.id),
        idPublico: filaEquipo.id_publico,
        nombre: filaEquipo.nombre,
        identificador: filaEquipo.identificador,
      };
    }
    return { id, grupos: grupos.map((grupo) => grupo.nombre), roles: codigos, equipo, crearEquipo };
  });

  const cuenta = await cargarCuenta(ctx.pool, resultado.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'crear_usuario',
    entidad: 'usuario',
    entidadId: cuenta.id,
    descripcion: `Usuario ${usuario} creado.`,
    datos: { usuario, grupos: resultado.grupos, roles: resultado.roles, crearEquipo: resultado.crearEquipo, equipo: resultado.equipo },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 201, { usuario: cuenta, equipo: resultado.equipo ?? null });
}

export async function actualizarCuenta(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 16384);
  const nombre = cuerpo.nombre === undefined ? undefined : textoObligatorio(cuerpo.nombre, 'nombre');
  const telefono = cuerpo.telefono === undefined ? undefined : textoOpcional(cuerpo.telefono, 'telefono', 40);
  const cargo = cuerpo.cargo === undefined ? undefined : textoOpcional(cuerpo.cargo, 'cargo', 200);
  const habilitado = booleanoOpcional(cuerpo.habilitado, 'habilitado');
  const clave = cuerpo.clave === undefined || cuerpo.clave === null || cuerpo.clave === ''
    ? null
    : claveObligatoria(cuerpo.clave);
  const grupoIds = listaIds(cuerpo.grupoIds, 'grupoIds');
  const rolIds = listaIds(cuerpo.rolIds, 'rolIds');
  const configApp = cuerpo.configApp === undefined ? undefined : validarConfigApp(cuerpo.configApp);
  if (
    nombre === undefined && telefono === undefined && cargo === undefined
    && habilitado === undefined && clave === null && grupoIds === undefined
    && rolIds === undefined && configApp === undefined
  ) {
    throw datosInvalidos('No se enviaron cambios: indique nombre, telefono, cargo, clave, habilitado, grupoIds, rolIds y/o configApp.');
  }

  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const actual = await buscarCuentaInterna(cliente, ctx.params.id);
    if (!actual) throw noEncontrado('El usuario no existe.');
    const grupos = grupoIds === undefined ? null : await resolverGrupos(cliente, grupoIds);
    const roles = rolIds === undefined ? null : await resolverRoles(cliente, rolIds);
    let administrador = actual.administrador;
    let soloLectura = actual.solo_lectura;
    if (roles !== null) {
      const codigos = roles.map((rol) => rol.codigo);
      administrador = codigos.includes('administrador');
      soloLectura = codigos.includes('solo_lectura');
    }
    if (administrador === false && actual.administrador && actual.habilitado) {
      const administradores = await contarAdministradoresActivos(cliente);
      if (administradores <= 1) {
        throw datosInvalidos('No se puede quitar el rol de administrador al último administrador activo.');
      }
    }
    const deshabilita = habilitado === false && actual.habilitado;
    const habilita = habilitado === true && !actual.habilitado;
    if (deshabilita && actual.administrador) {
      const administradores = await contarAdministradoresActivos(cliente);
      if (administradores <= 1) {
        throw datosInvalidos('No se puede deshabilitar al último administrador activo.');
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
    if (nombre !== undefined) agregar('nombre', nombre);
    if (telefono !== undefined) agregar('telefono', telefono);
    if (cargo !== undefined) agregar('cargo', cargo);
    if (habilitado !== undefined) agregar('habilitado', habilitado);
    if (roles !== null) {
      agregar('administrador', administrador);
      agregar('solo_lectura', soloLectura);
    }
    if (clave !== null) {
      const credencial = crearCredencial(clave);
      agregar('hash_clave', credencial.hash);
      agregar('sal', credencial.sal);
    }
    if (configApp !== undefined) {
      if (configApp === null || Object.keys(configApp).length === 0) {
        columnas.push(`atributos = atributos - 'configApp'`);
      } else {
        columnas.push(`atributos = atributos || jsonb_build_object('configApp', $${indice}::jsonb)`);
        valores.push(JSON.stringify(configApp));
        indice += 1;
      }
    }
    if (columnas.length > 0) {
      columnas.push('actualizado_en = now()');
      await cliente.query(
        `UPDATE iam.dmt_usuario SET ${columnas.join(', ')} WHERE id = $${indice}`,
        [...valores, actual.id],
      );
    }
    if (grupos !== null) await sincronizarGrupos(cliente, actual.id, grupos);
    if (roles !== null) await sincronizarRoles(cliente, actual.id, roles);
    let sesionesRevocadas = 0;
    if (deshabilita) {
      const revocadas = await cliente.query(
        `UPDATE iam.dmt_sesion
            SET revocada_en = now(), actualizado_en = now()
          WHERE usuario_id = $1 AND revocada_en IS NULL`,
        [actual.id],
      );
      sesionesRevocadas = revocadas.rowCount;
      await cliente.query(
        `UPDATE operations.dmt_asignacion
            SET activa = false, hasta_en = now(), actualizado_en = now()
          WHERE usuario_id = $1 AND activa`,
        [actual.id],
      );
      // El equipo de la persona también se da de baja: deja de verse en
      // Seguimiento y en Repetición de ruta.
      await cliente.query(
        `UPDATE tracking.dmt_dispositivo
            SET habilitado = false, actualizado_en = now()
          WHERE identificador = lower($1)`,
        [actual.nombre_usuario],
      );
    }
    if (habilita) {
      // Al reactivar la cuenta vuelve también su equipo.
      await cliente.query(
        `UPDATE tracking.dmt_dispositivo
            SET habilitado = true, actualizado_en = now()
          WHERE identificador = lower($1)`,
        [actual.nombre_usuario],
      );
      const reactivadas = await cliente.query(
        `UPDATE operations.dmt_asignacion
            SET activa = true, desde_en = now(), hasta_en = NULL, actualizado_en = now()
          WHERE usuario_id = $1
            AND dispositivo_id IN (
              SELECT id FROM tracking.dmt_dispositivo WHERE identificador = lower($2)
            )
          RETURNING dispositivo_id`,
        [actual.id, actual.nombre_usuario],
      );
      if (reactivadas.rowCount === 0) {
        await cliente.query(
          `INSERT INTO operations.dmt_asignacion (usuario_id, dispositivo_id, activa, desde_en)
           SELECT $1, d.id, true, now()
             FROM tracking.dmt_dispositivo d
            WHERE d.identificador = lower($2)
              AND NOT EXISTS (
                SELECT 1 FROM operations.dmt_asignacion a
                 WHERE a.usuario_id = $1 AND a.dispositivo_id = d.id AND a.activa)`,
          [actual.id, actual.nombre_usuario],
        );
      }
    }
    const campos = [];
    if (nombre !== undefined) campos.push('nombre');
    if (telefono !== undefined) campos.push('telefono');
    if (cargo !== undefined) campos.push('cargo');
    if (habilitado !== undefined) campos.push('habilitado');
    if (clave !== null) campos.push('clave');
    if (grupoIds !== undefined) campos.push('grupoIds');
    if (rolIds !== undefined) campos.push('rolIds');
    if (configApp !== undefined) campos.push('configApp');
    return { id: Number(actual.id), campos, sesionesRevocadas };
  });

  const cuenta = await cargarCuenta(ctx.pool, resultado.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'editar_usuario',
    entidad: 'usuario',
    entidadId: cuenta.id,
    descripcion: `Usuario ${cuenta.usuario} actualizado.`,
    datos: { campos: resultado.campos, sesionesRevocadas: resultado.sesionesRevocadas },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { usuario: cuenta });
}

export async function eliminarCuenta(ctx) {
  await exigirOperativo(ctx);
  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const actual = await buscarCuentaInterna(cliente, ctx.params.id);
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
      return { id: Number(actual.id), usuario: actual.nombre_usuario, yaEliminado: true };
    }
    // Baja lógica: se conserva la fila por el historial y las asignaciones.
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
    // El equipo de la persona también queda de baja.
    const { rows: equiposDadosDeBaja } = await cliente.query(
      `UPDATE tracking.dmt_dispositivo
          SET habilitado = false, actualizado_en = now()
        WHERE identificador = lower($1) AND habilitado
        RETURNING id`,
      [actual.nombre_usuario],
    );
    return {
      id: Number(actual.id),
      usuario: actual.nombre_usuario,
      yaEliminado: false,
      sesionesRevocadas,
      asignacionesDesactivadas: desasignadas.length,
      equiposDadosDeBaja: equiposDadosDeBaja.length,
    };
  });

  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'eliminar_usuario',
    entidad: 'usuario',
    entidadId: resultado.id,
    descripcion: `Usuario ${resultado.usuario ?? resultado.id} dado de baja.`,
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

// GET /api/v1/usuarios/:id/equipos: equipos asignados del usuario.
// :id puede ser el id interno, el público o el nombre de usuario.
export async function obtenerEquiposCuenta(ctx) {
  await exigirOperativo(ctx);
  const texto = String(ctx.params.id);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT u.id
       FROM iam.dmt_usuario u
      WHERE u.id_publico::text = $1 OR u.id::text = $1 OR u.nombre_usuario = $1
      LIMIT 1`,
    [texto],
    { signal: ctx.signal },
  );
  if (rows.length === 0) throw noEncontrado('El usuario no existe.');
  const equipos = await equiposDe(ctx.pool, rows[0].id);
  respuestaJson(ctx.res, 200, { datos: equipos });
}

// PUT /api/v1/usuarios/:id/equipos: reemplaza todas las asignaciones.
// Cuerpo {dispositivoIds: []} (vacío deja al usuario sin equipos). Las que
// salen se desactivan conservando el historial; las que entran se crean o
// reactivan. Todo en una transacción. Responde la lista final como el GET.
export async function reemplazarEquiposCuenta(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 16384);
  const dispositivoIds = listaDispositivosObligatoria(cuerpo.dispositivoIds);

  const resultado = await enTransaccion(ctx.pool, async (cliente) => {
    const actual = await buscarCuentaInterna(cliente, ctx.params.id);
    if (!actual) throw noEncontrado('El usuario no existe.');
    const equipos = await resolverDispositivos(cliente, dispositivoIds);
    const deseados = equipos.map((equipo) => Number(equipo.id));
    const { rows: vigentes } = await cliente.query(
      `SELECT dispositivo_id
         FROM operations.dmt_asignacion
        WHERE usuario_id = $1 AND activa`,
      [actual.id],
    );
    const enUso = new Set(vigentes.map((fila) => Number(fila.dispositivo_id)));
    const deseadosSet = new Set(deseados);
    const aDesactivar = [...enUso].filter((id) => !deseadosSet.has(id));
    if (aDesactivar.length > 0) {
      await cliente.query(
        `UPDATE operations.dmt_asignacion
            SET activa = false, hasta_en = now(), actualizado_en = now()
          WHERE usuario_id = $1 AND dispositivo_id = ANY($2::bigint[]) AND activa`,
        [actual.id, aDesactivar],
      );
    }
    if (deseados.length > 0) {
      // Repara la vigencia de las que quedan (activa con hasta_en vencido).
      await cliente.query(
        `UPDATE operations.dmt_asignacion
            SET hasta_en = NULL, actualizado_en = now()
          WHERE usuario_id = $1 AND dispositivo_id = ANY($2::bigint[]) AND activa
            AND hasta_en IS NOT NULL AND hasta_en <= now()`,
        [actual.id, deseados],
      );
    }
    const aCrear = deseados.filter((id) => !enUso.has(id));
    for (const dispositivoId of aCrear) {
      await cliente.query(
        `INSERT INTO operations.dmt_asignacion (usuario_id, dispositivo_id, desde_en, hasta_en, activa)
         VALUES ($1, $2, now(), NULL, true)`,
        [actual.id, dispositivoId],
      );
    }
    return { id: Number(actual.id), usuario: actual.nombre_usuario };
  });

  const equipos = await equiposDe(ctx.pool, resultado.id);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'asignar_equipos',
    entidad: 'usuario',
    entidadId: resultado.id,
    descripcion: `Equipos de ${resultado.usuario} reemplazados (${equipos.length}).`,
    datos: { totalEquipos: equipos.length },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { datos: equipos });
}
