// Dominio posiciones: ultima posicion por dispositivo y panel en vivo.
// Lee tracking.dmt_posicion_actual (una fila por dispositivo), nunca MAX().

import { consultar } from './db.js';
import { aPosicion } from './dto.js';
import { noEncontrado } from './errores.js';
import { leerRango, respuestaJson } from './http.js';
import { PREDICADO_PERMISO, buscarDispositivo, permisoDe, puedeVerDeshabilitado } from './flota.js';

export const SELECT_POSICION_ACTUAL = `
  SELECT coalesce(pa.posicion_id, pa.id) AS id,
         pa.dispositivo_id, pa.latitud, pa.longitud, pa.altitud_m,
         pa.velocidad_kmh, pa.rumbo_grados, pa.precision_m,
         coalesce(pa.bateria_pct, (pa.atributos->>'batteryLevel')::real) AS bateria_pct,
         pa.registrado_en, pa.recibido_en, pa.valida
  FROM tracking.dmt_posicion_actual pa
  JOIN tracking.dmt_dispositivo d ON d.id = pa.dispositivo_id
`;

export async function listarPosicionesVivas(ctx) {
  const { url } = ctx;
  const rango = leerRango(url, { porDefecto: null, maxDias: 7, zonaHoraria: ctx.entorno.zonaHoraria });
  const valores = [permisoDe(ctx.usuario)];
  const condiciones = ['d.habilitado', PREDICADO_PERMISO];
  const dispositivoId = url.searchParams.get('dispositivoId');
  if (dispositivoId) {
    valores.push(dispositivoId);
    condiciones.push(`(d.id_publico::text = $${valores.length} OR d.id_legado::text = $${valores.length} OR d.id::text = $${valores.length})`);
  }
  if (rango.desde) {
    valores.push(rango.desde);
    condiciones.push(`pa.registrado_en >= $${valores.length}`);
    valores.push(rango.hasta);
    condiciones.push(`pa.registrado_en < $${valores.length}`);
  }
  const { rows } = await consultar(
    ctx.pool,
    `${SELECT_POSICION_ACTUAL}
     WHERE ${condiciones.join(' AND ')}
     ORDER BY pa.dispositivo_id`,
    valores,
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map(aPosicion),
    generadoEn: new Date().toISOString(),
    intervaloRefrescoSegundos: ctx.entorno.intervaloRefrescoSegundos,
  });
}

export async function obtenerPosicionDispositivo(ctx) {
  const dispositivo = await buscarDispositivo(ctx.pool, ctx.usuario, ctx.params.id, ctx.signal, {
    incluirDeshabilitado: true,
  });
  if (!dispositivo) throw noEncontrado('El dispositivo no existe o no está visible para la cuenta.');
  // Los permisos ya los revisó buscarDispositivo; el administrador puede ver
  // un equipo dado de baja.
  const visibilidad = puedeVerDeshabilitado(ctx.usuario) ? 'TRUE' : 'd.habilitado';
  const { rows } = await consultar(
    ctx.pool,
    `${SELECT_POSICION_ACTUAL}
     WHERE ${visibilidad} AND pa.dispositivo_id = $2 AND ${PREDICADO_PERMISO}
     LIMIT 1`,
    [permisoDe(ctx.usuario), Number(dispositivo.id)],
    { signal: ctx.signal },
  );
  if (rows.length === 0) throw noEncontrado('El dispositivo no tiene posición conocida.');
  respuestaJson(ctx.res, 200, aPosicion(rows[0]));
}
