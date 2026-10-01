// Dominio replay: recorridos disponibles y recorrido detallado por ventana.
// Lee tracking.dmt_posicion por rango (indice dispositivo_id, registrado_en).

import { consultar } from './db.js';
import { aDispositivo, aPosicion } from './dto.js';
import { datosInvalidos, noEncontrado } from './errores.js';
import { leerOrden, leerPaginacion, leerRango, respuestaJson } from './http.js';
import { PREDICADO_PERMISO, SELECT_DISPOSITIVO, buscarDispositivo, permisoDe } from './flota.js';
import { calcularHuecos, resumirRecorrido } from './geo.js';
import { reconstruirTramos } from './ruteo.js';
import { depurarPosiciones } from './depuracion.js';

export const LIMITE_POSICIONES_REPLAY = 50000;

// El replay reconstruye la trayectoria por hora del fix GPS (fijado_en). Como
// el indice B-tree es (dispositivo_id, registrado_en DESC), se acota primero
// por registrado_en con un margen y luego se filtra por fijado_en.
const MARGEN_FIJADO_MS = 24 * 60 * 60 * 1000;

function preFiltro(rango) {
  return {
    preDesde: new Date(rango.desde.getTime() - MARGEN_FIJADO_MS),
    preHasta: new Date(rango.hasta.getTime() + MARGEN_FIJADO_MS),
  };
}

const ORDEN_DISPONIBLES = {
  dispositivoId: 'p.dispositivo_id',
  nombre: 'd.nombre',
  desde: 'min(coalesce(p.fijado_en, p.registrado_en))',
  hasta: 'max(coalesce(p.fijado_en, p.registrado_en))',
  totalPosiciones: 'count(*)',
};

export async function listarReplayDisponible(ctx) {
  const { url } = ctx;
  const { pagina, tamano, desplazamiento } = leerPaginacion(url);
  const orden = leerOrden(url, ORDEN_DISPONIBLES, 'max(p.registrado_en) DESC');
  const rango = leerRango(url, {
    porDefecto: 'hoy',
    maxDias: 31,
    zonaHoraria: ctx.entorno.zonaHoraria,
  });
  const { preDesde, preHasta } = preFiltro(rango);
  const valores = [permisoDe(ctx.usuario), rango.desde, rango.hasta, preDesde, preHasta];
  const condiciones = [
    'd.habilitado',
    PREDICADO_PERMISO,
    'p.registrado_en >= $4',
    'p.registrado_en < $5',
    'coalesce(p.fijado_en, p.registrado_en) >= $2',
    'coalesce(p.fijado_en, p.registrado_en) < $3',
  ];
  const dispositivoId = url.searchParams.get('dispositivoId');
  if (dispositivoId) {
    valores.push(dispositivoId);
    condiciones.push(`(d.id_publico::text = $${valores.length} OR d.id_legado::text = $${valores.length} OR d.id::text = $${valores.length})`);
  }
  valores.push(tamano, desplazamiento);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT p.dispositivo_id, d.id_publico, d.nombre,
            min(coalesce(p.fijado_en, p.registrado_en)) AS desde,
            max(coalesce(p.fijado_en, p.registrado_en)) AS hasta,
            count(*) AS total_posiciones, count(*) OVER() AS total_filas
     FROM tracking.dmt_posicion p
     JOIN tracking.dmt_dispositivo d ON d.id = p.dispositivo_id
     WHERE ${condiciones.join(' AND ')}
     GROUP BY p.dispositivo_id, d.id_publico, d.nombre
     ORDER BY ${orden.sql}, p.dispositivo_id
     LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
    valores,
    { signal: ctx.signal },
  );
  respuestaJson(ctx.res, 200, {
    datos: rows.map((fila) => ({
      dispositivoId: Number(fila.dispositivo_id),
      idPublico: fila.id_publico,
      nombre: fila.nombre,
      desde: fila.desde.toISOString(),
      hasta: fila.hasta.toISOString(),
      totalPosiciones: Number(fila.total_posiciones),
    })),
    total: rows.length > 0 ? Number(rows[0].total_filas) : 0,
    pagina,
    tamano,
  });
}

export async function obtenerReplay(ctx) {
  const dispositivo = await buscarDispositivo(ctx.pool, ctx.usuario, ctx.params.deviceId, ctx.signal, {
    incluirDeshabilitado: true,
  });
  if (!dispositivo) throw noEncontrado('El dispositivo no existe o no está visible para la cuenta.');
  const rango = leerRango(ctx.url, {
    porDefecto: 'hoy',
    maxDias: 31,
    zonaHoraria: ctx.entorno.zonaHoraria,
  });
  const { preDesde, preHasta } = preFiltro(rango);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT p.id, p.dispositivo_id, p.latitud, p.longitud, p.altitud_m,
            p.velocidad_kmh, p.rumbo_grados, p.precision_m,
            coalesce(p.bateria_pct, (p.atributos->>'batteryLevel')::real) AS bateria_pct,
            coalesce(p.fijado_en, p.registrado_en) AS registrado_en,
            p.recibido_en, p.valida
     FROM tracking.dmt_posicion p
     WHERE p.dispositivo_id = $1
       AND p.registrado_en >= $4 AND p.registrado_en < $5
       AND coalesce(p.fijado_en, p.registrado_en) >= $2
       AND coalesce(p.fijado_en, p.registrado_en) < $3
     ORDER BY coalesce(p.fijado_en, p.registrado_en)
     LIMIT ${LIMITE_POSICIONES_REPLAY + 1}`,
    [Number(dispositivo.id), rango.desde, rango.hasta, preDesde, preHasta],
    { signal: ctx.signal, timeoutMs: 20000 },
  );
  if (rows.length === 0) {
    throw noEncontrado('No hay recorrido del dispositivo en la ventana pedida.');
  }
  if (rows.length > LIMITE_POSICIONES_REPLAY) {
    throw datosInvalidos('La ventana tiene demasiadas posiciones; reduzca el rango horario.');
  }
  const { conservadas: posiciones, calidad } = depurarPosiciones(rows.map(aPosicion));
  if (posiciones.length === 0) {
    throw noEncontrado('No hay recorrido válido del dispositivo en la ventana pedida.');
  }
  const huecos = calcularHuecos(posiciones);
  // Tramos reconstruidos por calles (huecos o puntos muy separados). El panel
  // los dibuja por capas REAL/MATCHED/ESTIMATED. `estimados` queda por
  // compatibilidad con la forma anterior.
  const reconstruidos = await reconstruirTramos(posiciones, ctx.signal);
  respuestaJson(ctx.res, 200, {
    dispositivo: aDispositivo(dispositivo, ctx.usuario),
    desde: rango.desde.toISOString(),
    hasta: rango.hasta.toISOString(),
    posiciones,
    huecos,
    reconstruidos,
    resumen: resumirRecorrido(posiciones, huecos.length),
    calidad,
    generadoEn: new Date().toISOString(),
  });
}
