// Dominio replay: recorridos disponibles y recorrido detallado por ventana.
// Lee tracking.dmt_posicion por rango (indice dispositivo_id, registrado_en).

import { consultar } from '../base/db.js';
import { aDispositivo, aPosicion } from '../base/dto.js';
import { datosInvalidos, noEncontrado } from '../base/errores.js';
import { leerOrden, leerPaginacion, leerRango, respuestaJson } from '../base/http.js';
import { PREDICADO_PERMISO, buscarDispositivo, permisoDe } from '../equipos/flota.js';
import { UMBRAL_HUECO_SEGUNDOS, calcularHuecos, resumirRecorrido, sumarDistanciasKm } from './geo.js';
import { TIPOS_EVENTO_CAUSA, causaDeHueco } from './causas.js';
import { TIPOS as TIPOS_EVENTO } from './eventos.js';
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

// El trazo del día: lo que el replay dibuja, antes de reconstruir tramos. Lo
// usan el replay y el Excel de Marketing (su encendido es el primer punto de
// este trazo y su apagado el último), para que las horas del reporte sean
// siempre las que se ven en el mapa. Lanza ErrorApi 404 si no hay trazo.
export async function trazoDelRango(ctx, dispositivo, rango) {
  const { preDesde, preHasta } = preFiltro(rango);
  const { rows } = await consultar(
    ctx.pool,
    `SELECT p.id, p.dispositivo_id, p.latitud, p.longitud, p.altitud_m,
            p.velocidad_kmh, p.rumbo_grados, p.precision_m,
            coalesce(p.bateria_pct, (p.atributos->>'batteryLevel')::real) AS bateria_pct,
            coalesce(p.fijado_en, p.registrado_en) AS registrado_en,
            p.recibido_en, p.valida,
            (p.atributos->>'mock') = 'true' AS simulada,
            p.atributos->>'activity' AS actividad,
            CASE WHEN (p.atributos->>'steps') ~ '^[0-9]+$' THEN (p.atributos->>'steps')::bigint END AS pasos,
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
  // El iPhone es un caso aparte: no tiene jornadas (su app no las avisa), así
  // que se traza todo lo que mandó y cada día va por separado. El panel marca
  // el primer punto del día como "App activada" y el último como "App
  // desactivada".
  const ios = dispositivo.atributos?.plataforma === 'ios';
  const diaLocal = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.entorno.zonaHoraria });
  const jornadaDe = new Map();
  const enJornada = ios ? rows : rows.filter((fila) => fila.jornada_id != null);
  for (const fila of enJornada) {
    jornadaDe.set(Number(fila.id), ios ? diaLocal.format(fila.registrado_en) : String(fila.jornada_id));
  }
  if (enJornada.length === 0) {
    throw noEncontrado('No hubo jornada en la ventana pedida: sin jornada no se traza recorrido.');
  }
  // La ubicación simulada (GPS falso) no es recorrido: no forma la línea, ni
  // las paradas, ni las distancias, ni el primer y último punto del Excel. Se
  // devuelve aparte y queda marcada; ningún punto se borra de la base.
  const mapeadas = enJornada.map(aPosicion);
  const simuladas = mapeadas.filter((p) => p.simulada);
  const { conservadas, calidad, imprecisos } = depurarPosiciones(mapeadas.filter((p) => !p.simulada));
  let posiciones = conservadas;
  if (posiciones.length === 0 && simuladas.length === 0) {
    throw noEncontrado('No hay recorrido válido del dispositivo en la ventana pedida.');
  }
  // El teléfono encendido antes de iniciar la jornada: su primer punto del día
  // (uno solo, no una ruta) es el primer punto del trazo, como en el Excel.
  if (!ios && posiciones.length > 0) {
    const primera = new Date(posiciones[0].registradoEn).getTime();
    const previa = rows.find(
      (fila) => fila.jornada_id == null && !fila.simulada && fila.valida === true && fila.registrado_en.getTime() < primera,
    );
    if (previa) {
      jornadaDe.set(Number(previa.id), 'previo');
      posiciones = [aPosicion(previa), ...posiciones];
    }
  }
  return { posiciones, simuladas, calidad, imprecisos, jornadaDe, ios };
}

// Clave de jornada de un punto: un número (id de jornada), el día (iPhone) o
// "previo" (primer punto del día antes de iniciar la jornada).
const esJornadaReal = (clave) => Number.isFinite(Number(clave));

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
  const { posiciones, simuladas, calidad, imprecisos, jornadaDe, ios } = await trazoDelRango(ctx, dispositivo, rango);
  if (posiciones.length === 0) {
    // Solo hubo ubicación simulada: no hay recorrido que trazar, pero se
    // devuelve lo recibido para que el panel lo avise.
    return respuestaJson(ctx.res, 200, {
      dispositivo: aDispositivo(dispositivo, ctx.usuario),
      desde: rango.desde.toISOString(),
      hasta: rango.hasta.toISOString(),
      posiciones: simuladas,
      huecos: [],
      imprecisos: [],
      avisos: [],
      reconstruidos: [],
      resumen: {
        inicio: simuladas[0].registradoEn,
        fin: simuladas.at(-1).registradoEn,
        totalPosiciones: 0,
        totalHuecos: 0,
        distanciaKm: 0,
        duracionMin: 0,
        velocidadPromedioKmh: null,
        velocidadMaximaKmh: null,
        bateriaInicialPct: null,
        bateriaFinalPct: null,
        pasos: null,
      },
      calidad,
      cierres: [],
      generadoEn: new Date().toISOString(),
    });
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
    const anterior = i > 0 ? grupos[i - 1].posiciones.at(-1) : null;
    // Cerrar y volver a abrir la jornada en menos de 2 min (un toque de más)
    // no es un tramo fuera de jornada: no se marca como corte.
    if (anterior && new Date(grupo[0].registradoEn) - new Date(anterior.registradoEn) > 2 * 60_000) {
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
  const { cortes: cortesAlCierre, cierres } = ios ? { cortes: [], cierres: [] } : await finesDeJornada(ctx, dispositivo.id, grupos, rango);
  huecos.push(...cortesAlCierre);
  huecos.sort((a, b) => new Date(a.desde) - new Date(b.desde));
  // Entre dos jornadas, lo fuera de jornada termina donde empieza el corte
  // del inicio de la siguiente: no se enciman.
  for (const fuera of huecos.filter((h) => h.motivo === 'FUERA_DE_JORNADA')) {
    const corte = huecos.find((h) => h.motivo === 'SIN_SENAL' && h.hasta === fuera.hasta && h !== fuera);
    if (!corte) continue;
    fuera.hasta = corte.desde;
    fuera.duracionSegundos = Math.max(0, Math.round((new Date(fuera.hasta) - new Date(fuera.desde)) / 1000));
  }
  await explicarHuecos(ctx, dispositivo.id, huecos);
  const sinSenal = huecos.filter((h) => h.motivo !== 'FUERA_DE_JORNADA').length;
  const resumen = resumirRecorrido(posiciones, sinSenal);
  resumen.pasos = ios ? null : await pasosDeJornadas(ctx, [...new Set(jornadaDe.values())].filter(esJornadaReal));
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
    // El trazo y, aparte pero en la misma lista, la ubicación simulada (marcada
    // `simulada`): el panel la quita de la línea y la avisa.
    posiciones: [...posiciones, ...simuladas].sort((a, b) => new Date(a.registradoEn) - new Date(b.registradoEn)),
    huecos,
    // Tramos con ubicación imprecisa pero seguida: se vio, no es corte.
    imprecisos,
    avisos: await avisosDelTelefono(ctx, dispositivo.id, rango),
    reconstruidos,
    resumen,
    calidad,
    cierres,
    generadoEn: new Date().toISOString(),
  });
}

// Cómo terminó cada jornada del recorrido, para rotular el último punto:
// lo primero que hizo el teléfono después de ese punto (finalizó la jornada,
// apagó el GPS o el teléfono, quitó el permiso). "Sin señal" solo si no hubo
// nada de eso. Además, si el GPS se apagó y la jornada se cerró horas
// después (o sigue abierta), ese final sin puntos no estaba entre dos puntos
// y no salía como corte: va desde el último punto hasta el fin de la jornada.
const MOTIVO_CIERRE = {
  mobileJourneyEnded: 'JORNADA_FINALIZADA',
  mobileGpsDisabled: 'GPS_APAGADO',
  mobilePowerOff: 'TELEFONO_APAGADO',
  mobilePermissionLost: 'PERMISO_QUITADO',
};

const HORA_LOCAL = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false });
// La app parte la jornada a las 23:59:59 y la siguiente empieza a las 00:00.
function esMedianoche(instante) {
  return HORA_LOCAL.format(new Date(instante)) >= '23:59';
}

async function finesDeJornada(ctx, dispositivoId, grupos, rango) {
  const ids = [...new Set(grupos.map((g) => g.jornada))].map(Number).filter(Number.isFinite);
  if (ids.length === 0) return { cortes: [], cierres: [] };
  try {
    const tope = Math.min(Date.now(), rango.hasta.getTime());
    const [jornadas, eventos] = await Promise.all([
      consultar(ctx.pool, 'SELECT id, inicio_en, fin_en FROM operations.dmt_jornada WHERE id = ANY($1::bigint[])', [ids], {
        signal: ctx.signal,
      }),
      consultar(
        ctx.pool,
        `SELECT tipo, ocurrido_en FROM tracking.dmt_evento
          WHERE dispositivo_id = $1 AND ocurrido_en BETWEEN $2 AND $3 AND tipo = ANY($4)
          ORDER BY ocurrido_en`,
        [
          Number(dispositivoId),
          new Date(new Date(grupos[0].posiciones[0].registradoEn).getTime() - 2 * 60_000),
          new Date(tope),
          [...Object.keys(MOTIVO_CIERRE), 'mobileSilent', 'mobilePowerOn', 'mobileBatterySaverOn'],
        ],
        { signal: ctx.signal },
      ),
    ]);
    const finDe = new Map(jornadas.rows.map((f) => [String(f.id), f.fin_en ? new Date(f.fin_en).getTime() : null]));
    const inicioDe = new Map(jornadas.rows.map((f) => [String(f.id), new Date(f.inicio_en).getTime()]));
    const lista = eventos.rows.map((f) => ({ tipo: f.tipo, en: new Date(f.ocurrido_en).getTime() }));
    const AHORRO_ANTES_MS = 15 * 60_000;
    const cortes = [];
    const cierres = [];
    for (const grupo of grupos) {
      if (!esJornadaReal(grupo.jornada)) continue;
      // Del inicio de la jornada al primer punto también es ruta perdida
      // (Israel 21/10: inició 07:58, primer punto 12:02 con el GPS apagado).
      const inicio = Math.max(inicioDe.get(String(grupo.jornada)) ?? Infinity, rango.desde.getTime());
      const primero = new Date(grupo.posiciones[0].registradoEn).getTime();
      if ((primero - inicio) / 1000 >= UMBRAL_HUECO_SEGUNDOS) {
        cortes.push({
          desde: new Date(inicio).toISOString(),
          hasta: grupo.posiciones[0].registradoEn,
          duracionSegundos: Math.round((primero - inicio) / 1000),
          motivo: 'SIN_SENAL',
        });
      }
      const ultimo = grupo.posiciones.at(-1);
      const desde = new Date(ultimo.registradoEn).getTime();
      const cerrada = finDe.get(String(grupo.jornada)) ?? null;
      const fin = Math.min(cerrada ?? tope, tope);
      const enVentana = lista.filter((e) => e.en >= desde - 2 * 60_000 && e.en <= fin + 60_000);
      const causa = enVentana.find((e) => MOTIVO_CIERRE[e.tipo]);
      const silencio = enVentana.find((e) => e.tipo === 'mobileSilent');
      const encendido = enVentana.find((e) => e.tipo === 'mobilePowerOn');
      if (causa) {
        const hora = new Date(causa.en).toISOString();
        const ahorro = causa.tipo === 'mobileGpsDisabled' && enVentana.some((e) => e.tipo === 'mobileBatterySaverOn' && e.en <= causa.en && causa.en - e.en <= AHORRO_ANTES_MS);
        const motivo = causa.tipo === 'mobileJourneyEnded' && esMedianoche(causa.en) ? 'MEDIANOCHE' : MOTIVO_CIERRE[causa.tipo];
        cierres.push({ en: ultimo.registradoEn, motivo, hora, ...(ahorro ? { ahorro: true } : {}) });
      } else if (cerrada != null) {
        const motivo = esMedianoche(cerrada) ? 'MEDIANOCHE' : 'JORNADA_FINALIZADA';
        cierres.push({ en: ultimo.registradoEn, motivo, hora: new Date(cerrada).toISOString() });
      } else if (encendido && (silencio || (fin - desde) / 1000 >= UMBRAL_HUECO_SEGUNDOS)) {
        cierres.push({ en: ultimo.registradoEn, motivo: 'REINICIO', hora: new Date(encendido.en).toISOString() });
      } else if (silencio || (fin - desde) / 1000 >= UMBRAL_HUECO_SEGUNDOS) {
        cierres.push({ en: ultimo.registradoEn, motivo: 'SIN_SENAL', hora: ultimo.registradoEn });
      }
      if ((fin - desde) / 1000 < UMBRAL_HUECO_SEGUNDOS) continue;
      cortes.push({
        desde: new Date(desde).toISOString(),
        hasta: new Date(fin).toISOString(),
        duracionSegundos: Math.round((fin - desde) / 1000),
        motivo: 'SIN_SENAL',
      });
    }
    return { cortes, cierres };
  } catch (error) {
    ctx.log?.warn?.(`replay: no se pudo leer el fin de las jornadas: ${error.message}`);
    return { cortes: [], cierres: [] };
  }
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

// Lo que la persona hizo en el teléfono durante el recorrido (apagó o
// reactivó el GPS, quitó o devolvió un permiso, las notificaciones, el ahorro
// de batería, la hora): el panel lo marca sobre el trazado. El silencio y la
// jornada no entran: ya se ven como cortes y como inicio y fin.
const TIPOS_AVISO = Object.entries(TIPOS_EVENTO)
  .filter(([tipo, t]) => (t.categoria === 'alerta' || t.categoria === 'recuperacion') && tipo !== 'mobileSilent' && tipo !== 'mobileResumed')
  .map(([tipo]) => tipo);

async function avisosDelTelefono(ctx, dispositivoId, rango) {
  try {
    const { rows } = await consultar(
      ctx.pool,
      `SELECT tipo, ocurrido_en FROM tracking.dmt_evento
        WHERE dispositivo_id = $1 AND ocurrido_en >= $2 AND ocurrido_en < $3 AND tipo = ANY($4)
        ORDER BY ocurrido_en`,
      [Number(dispositivoId), rango.desde, rango.hasta, TIPOS_AVISO],
      { signal: ctx.signal },
    );
    return rows.map((f) => ({
      tipo: f.tipo,
      texto: TIPOS_EVENTO[f.tipo].texto,
      categoria: TIPOS_EVENTO[f.tipo].categoria,
      en: new Date(f.ocurrido_en).toISOString(),
    }));
  } catch (error) {
    ctx.log?.warn?.(`replay: no se pudieron leer los avisos del teléfono: ${error.message}`);
    return [];
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
