// Equipos: lista, detalle y configuración.
// En el predicado de permisos, $1 es el usuario; NULL significa administrador.

import { consultar } from './db.js';
import { aDispositivo, CLAVES_CONFIGURABLES } from './dto.js';
import { datosInvalidos, noEncontrado, sinPermiso } from './errores.js';
import { esSoloLectura } from './permisos.js';
import { leerCuerpoJson, leerOrden, leerPaginacion, leerRango, respuestaJson } from './http.js';
import { auditar } from './sesiones.js';

export const SELECT_DISPOSITIVO = `
  SELECT d.id, d.id_publico, d.nombre, d.identificador, d.habilitado, d.atributos,
         CASE
           WHEN NOT d.habilitado THEN 'DESHABILITADO'
           WHEN d.atributos ? 'mobile.journeyId' AND NOT ja.activa THEN 'DESHABILITADO'
           -- Contacto: la última vez que el teléfono respondió, con un punto o
           -- con el diagnóstico que manda cada 10 min aunque esté quieto.
           --   más de 60 min sin responder (o nunca): SIN_SENAL
           --   más de 15 min (30 si estaba quieto, que reporta menos): SENAL_DEBIL
           --   responde y su último punto (de menos de 3 min) tiene
           --   velocidad: EN_LINEA; si no, DETENIDO
           WHEN ct.contacto IS NULL OR ct.contacto < now() - interval '60 minutes' THEN 'SIN_SENAL'
           WHEN ct.contacto < now() - CASE WHEN pa.atributos->>'motion' = 'STATIONARY'
                                           THEN interval '30 minutes' ELSE interval '15 minutes' END THEN 'SENAL_DEBIL'
           WHEN pa.registrado_en > now() - interval '3 minutes' AND pa.velocidad_kmh >= 1.852 THEN 'EN_LINEA'
           ELSE 'DETENIDO'
         END AS estado,
         ct.contacto AS ultimo_contacto,
         d.ultima_conexion_en,
         pa.atributos->>'motion' AS movimiento,
         d.atributos->>'mobile.appVersion' AS version_app,
         d.atributos->>'mobile.pending' AS pendientes,
         ja.activa AS jornada_activa,
         dep.nombre AS departamento,
         -- La batería más reciente entre la telemetría y el último punto
         -- (algunos teléfonos solo la mandan junto con el punto).
         CASE
           WHEN pa.bateria_pct IS NOT NULL
                AND (bat.registrado_en IS NULL OR pa.registrado_en > bat.registrado_en)
             THEN pa.bateria_pct
           ELSE bat.porcentaje
         END AS bateria_pct,
         CASE
           WHEN pa.bateria_pct IS NOT NULL
                AND (bat.registrado_en IS NULL OR pa.registrado_en > bat.registrado_en)
             THEN (pa.atributos->>'charging')::boolean
           ELSE bat.cargando
         END AS cargando,
         count(*) OVER() AS total_filas
  FROM tracking.dmt_dispositivo d
  LEFT JOIN tracking.dmt_posicion_actual pa ON pa.dispositivo_id = d.id
  LEFT JOIN LATERAL (
    SELECT GREATEST(
      d.ultima_conexion_en,
      CASE WHEN d.atributos->>'lastDiagnosticsAt' ~ '^[0-9]{12,14}$'
           THEN to_timestamp((d.atributos->>'lastDiagnosticsAt')::bigint / 1000.0) END
    ) AS contacto
  ) ct ON TRUE
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM operations.dmt_jornada j
      WHERE j.dispositivo_id = d.id AND j.estado = 'abierta'
    ) AS activa
  ) ja ON TRUE
  -- Departamento: el grupo de la persona asignada al equipo (si tiene varios,
  -- el primero por nombre) o, sin persona con grupo, el grupo del propio equipo.
  LEFT JOIN LATERAL (
    SELECT coalesce(
      (SELECT g.nombre
         FROM operations.dmt_asignacion a
         JOIN iam.dmt_usuario_grupo ug ON ug.usuario_id = a.usuario_id
         JOIN iam.dmt_grupo g ON g.id = ug.grupo_id
        WHERE a.dispositivo_id = d.id AND a.activa
          AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())
        ORDER BY g.nombre
        LIMIT 1),
      (SELECT g.nombre FROM iam.dmt_grupo g WHERE g.id = d.grupo_id)
    ) AS nombre
  ) dep ON TRUE
  LEFT JOIN LATERAL (
    SELECT b.porcentaje, b.cargando, b.registrado_en
    FROM telemetry.dmt_bateria b
    WHERE b.dispositivo_id = d.id
    ORDER BY b.registrado_en DESC
    LIMIT 1
  ) bat ON TRUE
`;

export const PREDICADO_PERMISO = `(
  $1::bigint IS NULL OR EXISTS (
    SELECT 1 FROM operations.dmt_asignacion a
    WHERE a.dispositivo_id = d.id AND a.usuario_id = $1 AND a.activa
      AND a.desde_en <= now() AND (a.hasta_en IS NULL OR a.hasta_en > now())
  )
)`;

export function permisoDe(usuario) {
  return usuario && usuario.administrador ? null : usuario?.id ?? null;
}

// El administrador puede abrir por id un equipo dado de baja (posiciones,
// repetición de ruta, jornadas, batería) para no perder lo que registró. Nunca
// en listas ni para modificarlo; las demás cuentas reciben 404.
export function puedeVerDeshabilitado(usuario) {
  return usuario?.administrador === true;
}

const ORDEN_FLOTA = {
  id: 'd.id',
  nombre: 'd.nombre',
  identificadorUnico: 'd.identificador',
  habilitado: 'd.habilitado',
  estado: 'estado',
  ultimaConexion: 'd.ultima_conexion_en',
  bateriaPct: 'bat.porcentaje',
};

export async function listarFlota(ctx) {
  const { url } = ctx;
  const { pagina, tamano, desplazamiento } = leerPaginacion(url);
  const orden = leerOrden(url, ORDEN_FLOTA, 'd.ultima_conexion_en DESC NULLS LAST');
  const rango = leerRango(url, { porDefecto: null, maxDias: 366 });
  const valores = [permisoDe(ctx.usuario)];
  const condiciones = ['d.habilitado', PREDICADO_PERMISO];
  const dispositivoId = url.searchParams.get('dispositivoId');
  if (dispositivoId) {
    valores.push(dispositivoId);
    condiciones.push(`(d.id_publico::text = $${valores.length} OR d.id_legado::text = $${valores.length} OR d.id::text = $${valores.length})`);
  }
  if (rango.desde) {
    valores.push(rango.desde);
    condiciones.push(`d.ultima_conexion_en >= $${valores.length}`);
    valores.push(rango.hasta);
    condiciones.push(`d.ultima_conexion_en < $${valores.length}`);
  }
  valores.push(tamano, desplazamiento);
  const { rows } = await consultar(
    ctx.pool,
    `${SELECT_DISPOSITIVO}
     WHERE ${condiciones.join(' AND ')}
     ORDER BY ${orden.sql}, d.id
     LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
    valores,
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map((fila) => aDispositivo(fila, ctx.usuario)),
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}

export async function obtenerDispositivo(ctx) {
  const fila = await buscarDispositivo(ctx.pool, ctx.usuario, ctx.params.id, ctx.signal, {
    incluirDeshabilitado: true,
  });
  if (!fila) throw noEncontrado('El dispositivo no existe o no está visible para la cuenta.');
  respuestaJson(ctx.res, 200, aDispositivo(fila, ctx.usuario));
}

// Solo acepta las claves configurables y con el tipo correcto, para que el
// panel no pueda escribir atributos internos del equipo.
function validarConfiguracion(valor) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw datosInvalidos('El campo configuracion debe ser un objeto con claves mobile.* permitidas.');
  }
  const entradas = Object.entries(valor);
  if (entradas.length === 0) {
    throw datosInvalidos('El campo configuracion no puede estar vacío.');
  }
  const limpias = {};
  for (const [clave, dato] of entradas) {
    if (!CLAVES_CONFIGURABLES.includes(clave)) {
      throw datosInvalidos(
        `La clave ${clave} no es configurable. Permitidas: ${CLAVES_CONFIGURABLES.join(', ')}.`,
      );
    }
    const tipo = typeof dato;
    if (tipo !== 'string' && tipo !== 'number' && tipo !== 'boolean') {
      throw datosInvalidos(`El valor de ${clave} debe ser texto, número o booleano.`);
    }
    if (tipo === 'number' && !Number.isFinite(dato)) {
      throw datosInvalidos(`El valor de ${clave} debe ser un número finito.`);
    }
    if (tipo === 'string' && dato.length > 500) {
      throw datosInvalidos(`El valor de ${clave} supera 500 caracteres.`);
    }
    limpias[clave] = dato;
  }
  return limpias;
}

function validarNombreDispositivo(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw datosInvalidos('El campo nombre debe ser un texto no vacío.');
  }
  const nombre = valor.trim();
  if (nombre.length > 200) throw datosInvalidos('El campo nombre supera 200 caracteres.');
  return nombre;
}

// PUT /fleet/{id}: administradores o quien tenga el equipo asignado. La cuenta
// de solo lectura recibe 403. Se mezclan los atributos sin pisar los internos.
export async function actualizarDispositivo(ctx) {
  // Solo lectura (flag o rol) bloquea toda escritura.
  if (await esSoloLectura(ctx.pool, ctx.usuario)) {
    throw sinPermiso('La cuenta de solo lectura no puede hacer cambios.');
  }
  const cuerpo = await leerCuerpoJson(ctx.req, 32768);
  const tieneNombre = cuerpo.nombre !== undefined;
  const tieneConfiguracion = cuerpo.configuracion !== undefined;
  if (!tieneNombre && !tieneConfiguracion) {
    throw datosInvalidos('Indique nombre y/o configuracion.');
  }
  const nombre = tieneNombre ? validarNombreDispositivo(cuerpo.nombre) : null;
  const configuracion = tieneConfiguracion ? validarConfiguracion(cuerpo.configuracion) : {};
  const fila = await buscarDispositivo(ctx.pool, ctx.usuario, ctx.params.id, ctx.signal);
  if (!fila) throw noEncontrado('El dispositivo no existe o no está visible para la cuenta.');
  await consultar(
    ctx.pool,
    `UPDATE tracking.dmt_dispositivo
     SET nombre = coalesce($2, nombre),
         atributos = atributos || $3::jsonb,
         actualizado_en = now()
     WHERE id = $1`,
    [Number(fila.id), nombre, JSON.stringify(configuracion)],
    { signal: ctx.signal },
  );
  const actualizado = await buscarDispositivo(ctx.pool, ctx.usuario, ctx.params.id, ctx.signal);
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'editar_dispositivo',
    entidad: 'dispositivo',
    entidadId: actualizado.id,
    descripcion: `Dispositivo ${actualizado.nombre} actualizado.`,
    datos: {
      nombreCambiado: tieneNombre,
      clavesConfiguradas: Object.keys(configuracion),
    },
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { dispositivo: aDispositivo(actualizado, ctx.usuario) });
}

// Lectura por id (interno, público o anterior). `incluirDeshabilitado` solo
// vale para administradores; listas y escrituras siempre filtran los
// deshabilitados.
export async function buscarDispositivo(pool, usuario, valor, signal, { incluirDeshabilitado = false } = {}) {
  const visibilidad =
    incluirDeshabilitado && puedeVerDeshabilitado(usuario) ? 'TRUE' : 'd.habilitado';
  const { rows } = await consultar(
    pool,
    `${SELECT_DISPOSITIVO}
     WHERE ${visibilidad} AND ${PREDICADO_PERMISO}
       AND (d.id_publico::text = $2 OR d.id_legado::text = $2 OR d.id::text = $2)
     LIMIT 1`,
    [permisoDe(usuario), String(valor)],
    { signal },
  );
  return rows[0] ?? null;
}
