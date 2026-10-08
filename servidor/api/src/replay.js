// Dominio replay: recorridos disponibles y recorrido detallado por ventana.
// Lee tracking.dmt_posicion por rango (indice dispositivo_id, registrado_en).

import { consultar } from './db.js';
import { aDispositivo, aPosicion } from './dto.js';
import { datosInvalidos, noEncontrado } from './errores.js';
import { leerOrden, leerPaginacion, leerRango, respuestaJson } from './http.js';
import { PREDICADO_PERMISO, buscarDispositivo, permisoDe } from './flota.js';
import { calcularHuecos, resumirRecorrido, sumarDistanciasKm } from './geo.js';
import { TIPOS_EVENTO_CAUSA, causaDeHueco } from './causas.js';
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
            p.recibido_en, p.valida,
            (p.atributos->>'mock') = 'true' AS simulada,
            (SELECT j.id FROM operations.dmt_jornada j
              WHERE j.dispositivo_id = p.dispositivo_id AND j.estado <> 'anulada'
                AND coalesce(p.fijado_en, p.registrado_en) >= j.inicio_en
                AND coalesce(p.fijado_en, p.registrado_en) <= coalesce(j.fin_en, now())
              ORDER BY j.inicio_en DESC LIMIT 1) AS jornada_id
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
  // Solo se traza dentro de una jornada: fuera de ella la app manda puntos de
  // presencia, espaciados y poco precisos, que no son un recorrido.
  const jornadaDe = new Map();
  const enJornada = rows.filter((fila) => fila.jornada_id != null);
  for (const fila of enJornada) jornadaDe.set(Number(fila.id), String(fila.jornada_id));
  if (enJornada.length === 0) {
    throw noEncontrado('No hubo jornada en la ventana pedida: sin jornada no se traza recorrido.');
  }
  const { conservadas: posiciones, calidad } = depurarPosiciones(enJornada.map(aPosicion));
  if (posiciones.length === 0) {
    throw noEncontrado('No hay recorrido válido del dispositivo en la ventana pedida.');
  }
  // Cada jornada se reconstruye por separado: entre dos jornadas no se inventa
  // un trayecto; ese tramo va como hueco FUERA_DE_JORNADA y el panel no lo dibuja.
  const grupos = [];
  for (const posicion of posiciones) {
    const jornada = jornadaDe.get(posicion.id);
    if (grupos.length === 0 || grupos.at(-1).jornada !== jornada) grupos.push({ jornada, posiciones: [] });
    grupos.at(-1).posiciones.push(posicion);
  }
  const huecos = [];
  const reconstruidos = [];
  for (let i = 0; i < grupos.length; i += 1) {
    const grupo = grupos[i].posiciones;
    if (i > 0) {
      const anterior = grupos[i - 1].posiciones.at(-1);
      huecos.push({
        desde: anterior.registradoEn,
        hasta: grupo[0].registradoEn,
        duracionSegundos: Math.round((new Date(grupo[0].registradoEn) - new Date(anterior.registradoEn)) / 1000),
        motivo: 'FUERA_DE_JORNADA',
      });
    }
    huecos.push(...calcularHuecos(grupo));
    reconstruidos.push(...(await reconstruirTramos(grupo, ctx.signal)));
  }
  huecos.sort((a, b) => new Date(a.desde) - new Date(b.desde));
  await explicarHuecos(ctx, dispositivo.id, huecos);
  const sinSenal = huecos.filter((h) => h.motivo !== 'FUERA_DE_JORNADA').length;
  const resumen = resumirRecorrido(posiciones, sinSenal);
  resumen.pasos = await pasosDeJornadas(ctx, [...new Set(jornadaDe.values())]);
  if (grupos.length > 1) {
    // Distancia y tiempo solo dentro de las jornadas, sin el salto entre ellas.
    const km = grupos.reduce((t, g) => t + sumarDistanciasKm(g.posiciones, { omitirImposibles: true }), 0);
    const min = grupos.reduce((t, g) => t + (new Date(g.posiciones.at(-1).registradoEn) - new Date(g.posiciones[0].registradoEn)) / 60000, 0);
    resumen.distanciaKm = Math.round(km * 1000) / 1000;
    resumen.duracionMin = Math.round(min * 10) / 10;
    resumen.velocidadPromedioKmh = min > 0 ? Math.round((km / min) * 600) / 10 : null;
  }
  respuestaJson(ctx.res, 200, {
    dispositivo: aDispositivo(dispositivo, ctx.usuario),
    desde: rango.desde.toISOString(),
    hasta: rango.hasta.toISOString(),
    posiciones,
    huecos,
    reconstruidos,
    resumen,
    calidad,
    generadoEn: new Date().toISOString(),
  });
}

// Pone la causa a cada corte con señal perdida (ver causas.js). Si la consulta
// falla, el corte queda como SIN_SENAL, que es lo que se mostraba antes.
async function explicarHuecos(ctx, dispositivoId, huecos) {
  const cortes = huecos.filter((h) => h.motivo === 'SIN_SENAL');
  if (cortes.length === 0) return;
  const desde = new Date(new Date(cortes[0].desde).getTime() - 5 * 60_000);
  const hasta = new Date(cortes.reduce((m, h) => Math.max(m, new Date(h.hasta).getTime()), 0));
  try {
    const [eventos, diagnosticos] = await Promise.all([
      consultar(
        ctx.pool,
        `SELECT tipo, ocurrido_en FROM tracking.dmt_evento
          WHERE dispositivo_id = $1 AND ocurrido_en BETWEEN $2 AND $3 AND tipo = ANY($4)`,
        [Number(dispositivoId), desde, hasta, TIPOS_EVENTO_CAUSA],
        { signal: ctx.signal },
      ),
      consultar(
        ctx.pool,
        `SELECT registrado_en FROM telemetry.dmt_salud_dispositivo
          WHERE dispositivo_id = $1 AND registrado_en BETWEEN $2 AND $3`,
        [Number(dispositivoId), desde, hasta],
        { signal: ctx.signal },
      ),
    ]);
    const listaEventos = eventos.rows.map((f) => ({ tipo: f.tipo, en: new Date(f.ocurrido_en).getTime() }));
    const listaDiagnosticos = diagnosticos.rows.map((f) => new Date(f.registrado_en).getTime());
    for (const hueco of cortes) hueco.motivo = causaDeHueco(hueco, listaEventos, listaDiagnosticos);
  } catch (error) {
    ctx.log?.warn?.(`replay: no se pudo explicar los cortes: ${error.message}`);
  }
}

// Pasos que contó el teléfono en esas jornadas. null si ninguna los trae
// (sin permiso, sin sensor o una app vieja): "sin dato", nunca cero inventado.
async function pasosDeJornadas(ctx, ids) {
  if (ids.length === 0) return null;
  try {
    const { rows } = await consultar(
      ctx.pool,
      `SELECT atributos->>'pasos' AS pasos FROM operations.dmt_jornada WHERE id = ANY($1::bigint[])`,
      [ids.map(Number)],
      { signal: ctx.signal },
    );
    const con = rows.map((f) => Number(f.pasos)).filter((n) => Number.isFinite(n));
    return con.length > 0 ? con.reduce((a, b) => a + b, 0) : null;
  } catch (error) {
    ctx.log?.warn?.(`replay: no se pudieron leer los pasos: ${error.message}`);
    return null;
  }
}
