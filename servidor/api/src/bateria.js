// Dominio bateria: resumen por dispositivo y serie de muestras.
// Fuente: telemetry.dmt_bateria (indice dispositivo_id, registrado_en DESC).

import { consultar } from './db.js';
import { iso, numeroONulo } from './dto.js';
import { noEncontrado } from './errores.js';
import { leerOrden, leerPaginacion, leerRango, respuestaJson } from './http.js';
import { PREDICADO_PERMISO, buscarDispositivo, permisoDe } from './flota.js';

export const LIMITE_MUESTRAS = 2000;

const ORDEN_BATERIA = {
  dispositivoId: 'd.id',
  nombre: 'd.nombre',
  actual: 'bat.porcentaje',
  actualizadoEn: 'bat.registrado_en',
};

function aResumen(fila) {
  return {
    dispositivoId: Number(fila.id),
    idPublico: fila.id_publico,
    nombre: fila.nombre,
    actual: numeroONulo(fila.porcentaje),
    cargando: fila.cargando === null || fila.cargando === undefined ? null : fila.cargando === true,
    actualizadoEn: iso(fila.registrado_en),
  };
}

export async function listarBateriaFlota(ctx) {
  const { url } = ctx;
  const { pagina, tamano, desplazamiento } = leerPaginacion(url);
  const orden = leerOrden(url, ORDEN_BATERIA, 'd.nombre ASC');
  const valores = [permisoDe(ctx.usuario)];
  const condiciones = ['d.habilitado', PREDICADO_PERMISO];
  const dispositivoId = url.searchParams.get('dispositivoId');
  if (dispositivoId) {
    valores.push(dispositivoId);
    condiciones.push(`(d.id_publico::text = $${valores.length} OR d.id_legado::text = $${valores.length} OR d.id::text = $${valores.length})`);
  }
  valores.push(tamano, desplazamiento);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT d.id, d.id_publico, d.nombre,
            bat.porcentaje, bat.cargando, bat.registrado_en,
            count(*) OVER() AS total_filas
     FROM tracking.dmt_dispositivo d
     LEFT JOIN LATERAL (
       SELECT b.porcentaje, b.cargando, b.registrado_en
       FROM telemetry.dmt_bateria b
       WHERE b.dispositivo_id = d.id
       ORDER BY b.registrado_en DESC
       LIMIT 1
     ) bat ON TRUE
     WHERE ${condiciones.join(' AND ')}
     ORDER BY ${orden.sql}, d.id
     LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
    valores,
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map(aResumen),
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}

export async function obtenerBateriaDispositivo(ctx) {
  const dispositivo = await buscarDispositivo(ctx.pool, ctx.usuario, ctx.params.deviceId, ctx.signal, {
    incluirDeshabilitado: true,
  });
  if (!dispositivo) throw noEncontrado('El dispositivo no existe o no está visible para la cuenta.');
  const rango = leerRango(ctx.url, {
    porDefecto: 'ultimas24h',
    maxDias: 31,
    zonaHoraria: ctx.entorno.zonaHoraria,
  });
  const dispositivoId = Number(dispositivo.id);
  const [ultima, muestras] = await Promise.all([
    consultar(
      ctx.pool,
      `SELECT porcentaje, cargando, registrado_en
       FROM telemetry.dmt_bateria
       WHERE dispositivo_id = $1
       ORDER BY registrado_en DESC
       LIMIT 1`,
      [dispositivoId],
      { signal: ctx.signal },
    ),
    consultar(
      ctx.pool,
      `SELECT * FROM (
         SELECT registrado_en, porcentaje, cargando
         FROM telemetry.dmt_bateria
         WHERE dispositivo_id = $1 AND registrado_en >= $2 AND registrado_en < $3
         ORDER BY registrado_en DESC
         LIMIT ${LIMITE_MUESTRAS}
       ) reciente
       ORDER BY registrado_en`,
      [dispositivoId, rango.desde, rango.hasta],
      { signal: ctx.signal },
    ),
  ]);
  respuestaJson(ctx.res, 200, {
    dispositivoId,
    actual: ultima.rows.length > 0 ? numeroONulo(ultima.rows[0].porcentaje) : null,
    cargando:
      ultima.rows.length === 0 || ultima.rows[0].cargando === null
        ? null
        : ultima.rows[0].cargando === true,
    muestras: muestras.rows.map((fila) => ({
      registradoEn: iso(fila.registrado_en),
      bateriaPct: numeroONulo(fila.porcentaje),
      cargando: fila.cargando === null ? null : fila.cargando === true,
    })),
  });
}
