// Clientes: los lugares que visitan los colaboradores. La app los ofrece al
// registrar una actividad (y deja agregar uno nuevo); el panel los administra.
//   GET   /api/v1/clientes              lista, con cuántas visitas tiene cada uno
//   POST  /api/v1/clientes              {clientes:[{nombre, direccion, lat, lon}]}
//                                       agrega uno o varios (pegados de Excel)
//   PATCH /api/v1/clientes/:id          {nombre, direccion, lat, lon, activo}

import { consultar } from './db.js';
import { datosInvalidos, noEncontrado } from './errores.js';
import { leerCuerpoJson, respuestaJson } from './http.js';
import { auditar } from './sesiones.js';
import { exigirOperativo } from './permisos.js';

const MAX_LOTE = 500;

function aCliente(f) {
  return {
    id: Number(f.id),
    nombre: f.nombre,
    direccion: f.direccion ?? null,
    lat: f.latitud === null ? null : Number(f.latitud),
    lon: f.longitud === null ? null : Number(f.longitud),
    activo: f.activo === true,
    visitas: Number(f.visitas ?? 0),
    creadoEnApp: f.creado_por_dispositivo !== null,
  };
}

// Coordenadas válidas o null; las dos o ninguna.
function coordenadas(lat, lon) {
  const a = Number(lat);
  const o = Number(lon);
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return null;
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) {
    throw datosInvalidos('La ubicación no es válida: latitud y longitud en grados (por ejemplo -2.19, -79.88).');
  }
  return { lat: a, lon: o };
}

function nombreValido(valor) {
  const nombre = typeof valor === 'string' ? valor.trim().slice(0, 120) : '';
  if (!nombre) throw datosInvalidos('Cada cliente necesita un nombre.');
  return nombre;
}

export async function listarClientes(ctx) {
  const { rows } = await consultar(
    ctx.pool,
    `SELECT c.*, (SELECT count(*) FROM operations.dmt_actividad a
                   WHERE a.cliente_lugar_id = c.id AND NOT a.eliminada) AS visitas
       FROM operations.dmt_cliente c
      ORDER BY c.activo DESC, lower(c.nombre)`,
    [],
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, { datos: rows.map(aCliente) });
}

export async function crearClientes(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 256 * 1024);
  const lista = Array.isArray(cuerpo.clientes) ? cuerpo.clientes : [];
  if (lista.length === 0 || lista.length > MAX_LOTE) throw datosInvalidos(`Envía de 1 a ${MAX_LOTE} clientes.`);
  const nuevos = lista.map((c) => ({
    nombre: nombreValido(c?.nombre),
    direccion: typeof c?.direccion === 'string' && c.direccion.trim() ? c.direccion.trim().slice(0, 300) : null,
    ubicacion: coordenadas(c?.lat, c?.lon),
  }));
  let creados = 0;
  for (const c of nuevos) {
    const { rowCount } = await ctx.pool.query(
      `INSERT INTO operations.dmt_cliente (nombre, direccion, latitud, longitud)
       SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (SELECT 1 FROM operations.dmt_cliente WHERE activo AND lower(nombre) = lower($1))`,
      [c.nombre, c.direccion, c.ubicacion?.lat ?? null, c.ubicacion?.lon ?? null],
    );
    creados += rowCount;
  }
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'crear_clientes',
    entidad: 'cliente',
    descripcion: `${creados} clientes agregados.`,
    req: ctx.req,
  });
  respuestaJson(ctx.res, 201, { creados, repetidos: nuevos.length - creados });
}

export async function actualizarCliente(ctx) {
  await exigirOperativo(ctx);
  const cuerpo = await leerCuerpoJson(ctx.req, 8192);
  const id = Number(ctx.params.id);
  const campos = [];
  const valores = [id];
  const poner = (columna, valor) => {
    valores.push(valor);
    campos.push(`${columna} = $${valores.length}`);
  };
  if (cuerpo.nombre !== undefined) poner('nombre', nombreValido(cuerpo.nombre));
  if (cuerpo.direccion !== undefined) {
    poner('direccion', typeof cuerpo.direccion === 'string' && cuerpo.direccion.trim() ? cuerpo.direccion.trim().slice(0, 300) : null);
  }
  if (cuerpo.lat !== undefined || cuerpo.lon !== undefined) {
    const ubicacion = coordenadas(cuerpo.lat, cuerpo.lon);
    poner('latitud', ubicacion?.lat ?? null);
    poner('longitud', ubicacion?.lon ?? null);
  }
  if (typeof cuerpo.activo === 'boolean') poner('activo', cuerpo.activo);
  if (campos.length === 0) throw datosInvalidos('No hay nada que cambiar.');
  const { rows } = await ctx.pool.query(
    `UPDATE operations.dmt_cliente SET ${campos.join(', ')}, actualizado_en = now()
      WHERE id = $1 RETURNING *`,
    valores,
  );
  if (!rows[0]) throw noEncontrado('El cliente no existe.');
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'editar_cliente',
    entidad: 'cliente',
    entidadId: id,
    descripcion: `Cliente ${rows[0].nombre} actualizado.`,
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { cliente: aCliente(rows[0]) });
}
