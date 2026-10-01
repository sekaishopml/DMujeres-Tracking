// Reconstrucción por calles de los tramos que quedan "a saltos" en la
// Repetición de ruta. El servicio local de ruteo (GraphHopper con el mapa de
// Ecuador) devuelve el camino por las vías entre dos puntos. Se usa en:
//  - huecos de más de 10 min sin señal (hasta 4 h);
//  - tramos sueltos (de 45 s a 10 min entre puntos) que cortan esquinas;
//  - ventanas con muchos puntos, que se ajustan a la vía con /match para que
//    el temblor del GPS no se dibuje punto a punto.
// MATCHED: hubo puntos suficientes y el ajuste pasó la validación.
// ESTIMATED: se pidió /route de A a B sin puntos intermedios.
// Si el ruteo no responde no hay tramo: nunca se inventa. Los puntos
// guardados no cambian.
// Caché en memoria (aciertos 7 días, fallos 1 min, hasta 2000). Ninguna
// función lanza error.

const URL_RUTEO = process.env.DMJ_RUTEO_URL ?? 'http://127.0.0.1:8992';
const TIEMPO_LIMITE_MS = 2500;
const TTL_ACIERTO_MS = 7 * 24 * 60 * 60 * 1000;
const TTL_FALLO_MS = 60 * 1000;
const MAX_ENTRADAS = 2000;

// Solo se reconstruyen tramos con desplazamiento real: menos de 150 m es el
// vehículo parado con jitter y el ruteo devolvería vueltas absurdas.
export const MIN_DISTANCIA_RUTEO_M = 150;
// Desde 45 s entre fixes el trazo recto ya corta esquinas; la cadencia fina
// (10 s) se ajusta por ventanas densas en vez de tramo a tramo.
export const MIN_SEPARACION_RUTEO_SEGUNDOS = 45;
// Tope para candidatos a reconstrucción (el /match con intermedios puede
// cubrir huecos largos si hay observaciones que lo sostengan).
export const MAX_TRAMO_RUTEO_SEGUNDOS = 4 * 60 * 60;
// Cuándo se acepta un tramo ESTIMATED (de A a B sin puntos en el medio): solo
// si la calle es la única explicación razonable del salto:
//  - el hueco dura 5 min o menos (con más tiempo pudo parar, desviarse o
//    volver);
//  - el camino por calles mide como máximo max(1.35 x recta, recta + 60 m);
//    un rodeo mayor sería una ruta inventada;
//  - la velocidad que exige ese camino es de 130 km/h o menos.
// Si no se cumple, el panel muestra el salto como "sin observación".
export const MAX_ESTIMADO_SEGUNDOS = 5 * 60;
export const MAX_ESTIMADO_RAZON = 1.35;
export const MAX_ESTIMADO_HOLGURA_M = 60;
export const MAX_ESTIMADO_VELOCIDAD_KMH = 130;
// Topes por carga del Replay: más allá, los tramos sobrantes quedan rectos.
const MAX_TRAMOS_ESTIMADOS = 200;
const TANDA = 8;
const PRESUPUESTO_MS = 3000;
// Ventanas para ajustar a la vía: hasta 100 puntos o 5 min cada una (cada
// ventana responde en menos de 100 ms). Lo que pasa dentro de una parada no
// entra, y los saltos imposibles se apartan. Un hueco de 45 s o más corta la
// ventana, salvo que sea corto (150 s o menos y menos de 50 m): así un
// recorrido en la ciudad con semáforos queda ajustado a la vía en vez de
// partirse en muchas rectas. Ventanas que avanzan menos de 25 m se descartan.
const MAX_PUNTOS_VENTANA_DENSA = 100;
const MAX_DURACION_VENTANA_DENSA_MS = 5 * 60 * 1000;
const MIN_PUNTOS_VENTANA_DENSA = 3;
const MIN_DESPLAZAMIENTO_VENTANA_M = 25;
const VELOCIDAD_PARADA_KMH = 2;
const DURACION_PARADA_CORTE_MS = 60 * 1000;
const MAX_VENTANAS_DENSAS = 200;
const TANDA_DENSAS = 4;
// Un hueco entre puntos se une si dura 150 s o menos y no hubo movimiento real
// (menos de 50 m): paradas cortas y avance lento. Moverse entre calles sin
// puntos corta el tramo.
const PUENTE_HUECO_MAX_SEGUNDOS = 150;
const PUENTE_HUECO_MAX_DESPLAZAMIENTO_M = 50;
// Puntos que se apartan antes de /match (los guardados no cambian): los que
// exigen más de 120 km/h desde el anterior válido, o un pico aislado de mala
// precisión (más de 25 m con los dos vecinos por debajo de 13 m). Si quedan
// menos de 3 puntos, la ventana se descarta.
const VELOCIDAD_MAX_TELEPORT_KMH = 120;
const PRECISION_PICO_M = 25;
const PRECISION_VECINA_FIABLE_M = 13;
// El trazo MATCHED solo se usa si su largo queda entre 0.75 y 1.25 veces el
// original, ningún punto original queda a más de max(35, 2 × precisión
// mediana + 15) m del trazo, y no más del 30 % de los puntos tiene precisión
// peor que 25 m. Si no, la ventana queda como vino.
const AJUSTE_RAZON_MIN = 0.75;
const AJUSTE_RAZON_MAX = 1.25;
const AJUSTE_DESVIACION_MIN_M = 35;
const AJUSTE_DESVIACION_FACTOR_PRECISION = 2;
const AJUSTE_DESVIACION_MARGEN_M = 15;
const AJUSTE_RUIDO_PRECISION_M = 25;
const AJUSTE_RUIDO_MAX_FRACCION = 0.3;

// Por encima de esta precisión el punto viene de antenas o wifi (error de 90 a
// 270 m) y no entra al ajuste ni a las estimaciones; el panel lo muestra como
// "ubicación aproximada". Solo se aparta del trazo.
export const PRECISION_MAX_TRAZO_M = 50;

export function esPrecisoParaTrazo(posicion) {
  const precision = leerPrecisionM(posicion);
  return precision == null || precision <= PRECISION_MAX_TRAZO_M;
}

// Caminando no se ajusta a la vía: el ajuste saltaba entre las dos calzadas
// de una avenida y el GPS a pie sigue mejor la vereda. Una ventana es a pie si
// avanza más lento que VELOCIDAD_A_PIE_KMH.
export const VELOCIDAD_A_PIE_KMH = 8;

export function esVentanaAPie(ventana) {
  try {
    if (!Array.isArray(ventana) || ventana.length < 2) return false;
    const primero = ventana[0];
    const ultimo = ventana[ventana.length - 1];
    const segundos = (instanteMs(ultimo) - instanteMs(primero)) / 1000;
    if (!(segundos > 0)) return false;
    return (distanciaM(primero, ultimo) / segundos) * 3.6 < VELOCIDAD_A_PIE_KMH;
  } catch {
    return false;
  }
}

const cache = new Map();

function claveRuta(a, b) {
  const punto = (p) => `${p.latitud.toFixed(5)},${p.longitud.toFixed(5)}`;
  return `R:${punto(a)}>${punto(b)}`;
}

function claveMatch(puntos) {
  return `M:${puntos.map((p) => `${p.longitud.toFixed(5)},${p.latitud.toFixed(5)}`).join('|')}`;
}

// Distancia aproximada en metros entre dos fixes (haversine).
function distanciaM(a, b) {
  const radioTierra = 6371000;
  const dLat = ((b.latitud - a.latitud) * Math.PI) / 180;
  const dLon = ((b.longitud - a.longitud) * Math.PI) / 180;
  const lat1 = (a.latitud * Math.PI) / 180;
  const lat2 = (b.latitud * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radioTierra * Math.asin(Math.sqrt(h));
}

// Instante en ms del fix, o NaN si el campo no trae fecha válida.
function instanteMs(posicion) {
  const instante = new Date(posicion?.registradoEn).getTime();
  return Number.isFinite(instante) ? instante : NaN;
}

function coordenadasValidas(posicion) {
  return Number.isFinite(posicion?.latitud) && Number.isFinite(posicion?.longitud);
}

// Velocidad para detectar paradas: la reportada manda; si falta se estima
// contra el fix anterior (distancia/tiempo). Un duplicado por retransmisión
// (mismo instante, misma coordenada) cuenta como parado.
function velocidadParaParada(actual, anterior) {
  const reportada = actual?.velocidadKmh;
  if (typeof reportada === 'number' && Number.isFinite(reportada)) {
    // Apps viejas reportan 0 en marcha: el desplazamiento fiable (>= 30 m,
    // mayor que la precisión, en <= 5 min) manda si es mayor.
    if (!anterior) return reportada;
    try {
      const segundos = (instanteMs(actual) - instanteMs(anterior)) / 1000;
      const metros = distanciaM(anterior, actual);
      const umbral = Math.max(30, Number(actual?.precisionM) || 0);
      if (segundos > 0 && segundos <= 300 && metros >= umbral) {
        return Math.max(reportada, (metros / segundos) * 3.6);
      }
    } catch {
      return reportada;
    }
    return reportada;
  }
  if (!anterior) return null;
  const desde = instanteMs(anterior);
  const hasta = instanteMs(actual);
  const horas = (hasta - desde) / 3600000;
  if (!(horas > 0)) {
    try {
      return distanciaM(anterior, actual) <= 1 ? 0 : null;
    } catch {
      return null;
    }
  }
  try {
    return distanciaM(anterior, actual) / 1000 / horas;
  } catch {
    return null;
  }
}

// Rachas de menos de 2 km/h que duran 60 s o más (el mismo umbral de
// detenido del panel). Lo que cae en estas rachas no se manda a /match, que
// devolvería vueltas absurdas sobre la misma manzana. Un punto suelto en
// movimiento no corta la racha (suele ser un error de velocidad): hacen falta
// dos seguidos.
function detectarParadasProlongadas(posiciones) {
  const paradas = [];
  let inicioRacha = -1;
  let seguidosEnMovimiento = 0;
  const cerrarRacha = (fin) => {
    if (inicioRacha >= 0 && fin >= inicioRacha) {
      const desde = instanteMs(posiciones[inicioRacha]);
      const hasta = instanteMs(posiciones[fin]);
      if (Number.isFinite(desde) && Number.isFinite(hasta) && hasta - desde >= DURACION_PARADA_CORTE_MS) {
        paradas.push({ inicio: inicioRacha, fin });
      }
    }
    inicioRacha = -1;
    seguidosEnMovimiento = 0;
  };
  for (let i = 0; i < posiciones.length; i += 1) {
    const anterior = i > 0 ? posiciones[i - 1] : null;
    let velocidad = null;
    try {
      velocidad = velocidadParaParada(posiciones[i], anterior);
    } catch {
      velocidad = null;
    }
    const detenida =
      typeof velocidad === 'number' && Number.isFinite(velocidad) && velocidad < VELOCIDAD_PARADA_KMH;
    if (detenida) {
      if (inicioRacha < 0) inicioRacha = i;
      seguidosEnMovimiento = 0;
      continue;
    }
    if (inicioRacha < 0) continue;
    seguidosEnMovimiento += 1;
    if (seguidosEnMovimiento >= 2) cerrarRacha(i - 2);
  }
  if (inicioRacha >= 0) cerrarRacha(posiciones.length - 1 - seguidosEnMovimiento);
  return paradas;
}

// Precisión del punto en metros, o null. Acepta el formato de la API
// (precisionM) y la fila de la base (precision_m).
function leerPrecisionM(posicion) {
  try {
    const valor = posicion?.precisionM ?? posicion?.precision_m;
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
  } catch {
    return null;
  }
}

// Velocidad en km/h entre dos puntos (distancia/tiempo), o null si el tiempo
// no sirve.
function velocidadImplicitaKmh(anterior, actual) {
  try {
    const desde = instanteMs(anterior);
    const hasta = instanteMs(actual);
    const segundos = (hasta - desde) / 1000;
    if (!(Number.isFinite(segundos) && segundos > 0)) return null;
    const metros = distanciaM(anterior, actual);
    if (!Number.isFinite(metros)) return null;
    return (metros / segundos) * 3.6;
  } catch {
    return null;
  }
}

// Devuelve una lista nueva sin los saltos imposibles, para /match:
//  - más de 120 km/h desde el anterior válido;
//  - pico aislado de precisión peor que 30 m con los dos vecinos por debajo
//    de 15 m.
// La velocidad se compara con el último punto conservado, para no descartar
// el punto bueno que vuelve después del salto.
function filtrarOutliersTeleport(ventana) {
  try {
    if (!Array.isArray(ventana) || ventana.length === 0) return [];
    // Paso 1: velocidad implícita excesiva.
    const sinSaltos = [];
    let anteriorValido = null;
    for (const fix of ventana) {
      try {
        if (!coordenadasValidas(fix)) {
          continue;
        }
        if (!anteriorValido) {
          sinSaltos.push(fix);
          anteriorValido = fix;
          continue;
        }
        const velocidad = velocidadImplicitaKmh(anteriorValido, fix);
        if (
          typeof velocidad === 'number' &&
          Number.isFinite(velocidad) &&
          velocidad > VELOCIDAD_MAX_TELEPORT_KMH
        ) {
          continue;
        }
        sinSaltos.push(fix);
        anteriorValido = fix;
      } catch {
        continue;
      }
    }
    // Paso 2: pico aislado de precisión (solo interiores con ambos vecinos).
    if (sinSaltos.length < 3) return sinSaltos;
    const sinPicos = [sinSaltos[0]];
    for (let i = 1; i < sinSaltos.length - 1; i += 1) {
      try {
        const previa = leerPrecisionM(sinSaltos[i - 1]);
        const actual = leerPrecisionM(sinSaltos[i]);
        const siguiente = leerPrecisionM(sinSaltos[i + 1]);
        if (
          actual !== null &&
          previa !== null &&
          siguiente !== null &&
          actual > PRECISION_PICO_M &&
          previa < PRECISION_VECINA_FIABLE_M &&
          siguiente < PRECISION_VECINA_FIABLE_M
        ) {
          continue;
        }
        sinPicos.push(sinSaltos[i]);
      } catch {
        sinPicos.push(sinSaltos[i]);
      }
    }
    sinPicos.push(sinSaltos[sinSaltos.length - 1]);
    return sinPicos;
  } catch {
    try {
      return Array.isArray(ventana) ? ventana.slice() : [];
    } catch {
      return [];
    }
  }
}

// Distancia máxima desde el primer punto de la ventana, o NaN. Se usa el
// máximo y no la distancia entre extremos para no descartar recorridos que
// vuelven cerca del inicio.
function desplazamientoMaximoM(ventana) {
  try {
    let maximo = 0;
    for (let i = 1; i < ventana.length; i += 1) {
      const desplazamiento = distanciaM(ventana[0], ventana[i]);
      if (desplazamiento > maximo) maximo = desplazamiento;
    }
    return maximo;
  } catch {
    return NaN;
  }
}

// Un hueco entre puntos se une si dura 150 s o menos y se avanzó menos de
// 50 m: las paradas cortas y el avance lento quedan en la misma ventana.
// Moverse entre calles sin puntos (50 m o más) o parar más de 150 s corta, y
// ese hueco se trata como ESTIMATED.
function puenteHuecoCorto(posiciones, prevIdx, curIdx) {
  try {
    const prevMs = instanteMs(posiciones[prevIdx]);
    const curMs = instanteMs(posiciones[curIdx]);
    if (!Number.isFinite(prevMs) || !Number.isFinite(curMs)) return false;
    if ((curMs - prevMs) / 1000 > PUENTE_HUECO_MAX_SEGUNDOS) return false;
    return distanciaM(posiciones[prevIdx], posiciones[curIdx]) < PUENTE_HUECO_MAX_DESPLAZAMIENTO_M;
  } catch {
    return false;
  }
}

// Parte el recorrido en ventanas para /match: hasta 100 puntos o 5 min,
// cortando en huecos de 45 s o más salvo paradas cortas (120 s o menos). Lo
// que pasa dentro de una parada no entra. Después se apartan los saltos
// imposibles. Devuelve las listas de puntos ya limpias.
export function partirVentanasDensas(posiciones) {
  const ventanas = [];
  try {
    if (!Array.isArray(posiciones) || posiciones.length < MIN_PUNTOS_VENTANA_DENSA) return ventanas;
    let paradas = [];
    try {
      paradas = detectarParadasProlongadas(posiciones);
    } catch {
      paradas = [];
    }
    // Todos los índices que caen dentro de una parada larga: nunca van a
    // /match.
    const enParada = new Set();
    try {
      for (const parada of paradas) {
        if (!parada || !Number.isInteger(parada.inicio) || !Number.isInteger(parada.fin)) continue;
        for (let i = parada.inicio; i <= parada.fin; i += 1) enParada.add(i);
      }
    } catch {
      // Sin conjunto tampoco se rompe: se sigue con partición por huecos.
    }
    // Índices conservados (sin interior de parada) y cortes por hueco: un
    // hueco >=45 s corta el tramo salvo que lo cubra una parada corta
    // (puente). Las paradas largas nunca se puentean.
    const tramosLibres = [];
    try {
      const conservados = [];
      for (let i = 0; i < posiciones.length; i += 1) {
        if (!enParada.has(i)) conservados.push(i);
      }
      let actual = [];
      for (let k = 0; k < conservados.length; k += 1) {
        const idx = conservados[k];
        if (actual.length > 0) {
          const prevIdx = conservados[k - 1];
          const prevMs = instanteMs(posiciones[prevIdx]);
          const actualMs = instanteMs(posiciones[idx]);
          if (Number.isFinite(prevMs) && Number.isFinite(actualMs)) {
            const segundos = (actualMs - prevMs) / 1000;
            if (
              segundos >= MIN_SEPARACION_RUTEO_SEGUNDOS
              && !puenteHuecoCorto(posiciones, prevIdx, idx)
            ) {
              tramosLibres.push(actual);
              actual = [];
            }
          }
        }
        actual.push(posiciones[idx]);
      }
      if (actual.length > 0) tramosLibres.push(actual);
    } catch {
      return ventanas;
    }
    for (const tramo of tramosLibres) {
      let inicio = 0;
      const cerrar = (fin) => {
        if (fin >= inicio) ventanas.push(tramo.slice(inicio, fin + 1));
        inicio = fin + 1;
      };
      for (let i = 1; i < tramo.length; i += 1) {
        if (i - inicio + 1 > MAX_PUNTOS_VENTANA_DENSA) {
          cerrar(i - 1);
          continue;
        }
        const inicioMs = instanteMs(tramo[inicio]);
        const actualMs = instanteMs(tramo[i]);
        if (
          Number.isFinite(inicioMs) &&
          Number.isFinite(actualMs) &&
          actualMs - inicioMs > MAX_DURACION_VENTANA_DENSA_MS
        ) {
          cerrar(i - 1);
        }
      }
      cerrar(tramo.length - 1);
    }
  } catch {
    return ventanas;
  }
  // Solo ventanas con movimiento real: al menos 3 fixes, coordenadas finitas
  // y tiempo creciente, con algún fix a >=25 m del primero. Tras apartar
  // outliers se reexige >=3 fixes y >=25 m: una ventana que solo pasaba el
  // gate gracias al salto (deriva parada + teleport) queda descartada.
  const utiles = [];
  try {
    for (const ventana of ventanas) {
      if (ventana.length < MIN_PUNTOS_VENTANA_DENSA) continue;
      if (!ventana.every(coordenadasValidas)) continue;
      const desde = instanteMs(ventana[0]);
      const hasta = instanteMs(ventana[ventana.length - 1]);
      if (!(Number.isFinite(desde) && Number.isFinite(hasta) && hasta > desde)) continue;
      const maxDesplazamiento = desplazamientoMaximoM(ventana);
      if (!(maxDesplazamiento >= MIN_DESPLAZAMIENTO_VENTANA_M)) continue;
      let limpia = ventana;
      try {
        limpia = filtrarOutliersTeleport(ventana);
      } catch {
        limpia = ventana;
      }
      if (limpia.length < MIN_PUNTOS_VENTANA_DENSA) continue;
      if (!limpia.every(coordenadasValidas)) continue;
      const desdeLimpio = instanteMs(limpia[0]);
      const hastaLimpio = instanteMs(limpia[limpia.length - 1]);
      if (!(Number.isFinite(desdeLimpio) && Number.isFinite(hastaLimpio) && hastaLimpio > desdeLimpio)) {
        continue;
      }
      const maxLimpio = desplazamientoMaximoM(limpia);
      if (!(maxLimpio >= MIN_DESPLAZAMIENTO_VENTANA_M)) continue;
      utiles.push(limpia);
      if (utiles.length >= MAX_VENTANAS_DENSAS) break;
    }
  } catch {
    return utiles;
  }
  return utiles;
}

function leerCache(clave) {
  const entrada = cache.get(clave);
  if (!entrada) return undefined;
  const ttl = entrada.trazado ? TTL_ACIERTO_MS : TTL_FALLO_MS;
  if (Date.now() - entrada.guardadoEn > ttl) {
    cache.delete(clave);
    return undefined;
  }
  return entrada;
}

function guardarCache(clave, valor) {
  cache.delete(clave);
  cache.set(clave, { ...valor, guardadoEn: Date.now() });
  while (cache.size > MAX_ENTRADAS) {
    const masAntigua = cache.keys().next().value;
    if (masAntigua === undefined) break;
    cache.delete(masAntigua);
  }
}

function peticionConLimite(signal) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);
  const abortar = () => controlador.abort();
  signal?.addEventListener('abort', abortar, { once: true });
  return {
    signal: controlador.signal,
    liberar: () => {
      clearTimeout(temporizador);
      signal?.removeEventListener('abort', abortar);
    },
  };
}

// Camino [lon,lat] por /route entre dos puntos y la versión del mapa, o null
// si el ruteo no responde o no hay camino.
async function trazarPorRuta(desde, hasta, signal) {
  const clave = claveRuta(desde, hasta);
  const enCache = leerCache(clave);
  if (enCache !== undefined) return enCache.trazado ? enCache : null;
  const { signal: senal, liberar } = peticionConLimite(signal);
  try {
    const respuesta = await fetch(`${URL_RUTEO}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: [desde.longitud, desde.latitud],
        to: [hasta.longitud, hasta.latitud],
      }),
      signal: senal,
    });
    if (!respuesta.ok) {
      guardarCache(clave, { trazado: null, mapaVersion: null, metodo: 'ESTIMATED' });
      return null;
    }
    const datos = await respuesta.json();
    const trazado =
      Array.isArray(datos.points) && datos.points.length >= 2 ? datos.points : null;
    const resultado = {
      trazado,
      mapaVersion: typeof datos.mapaVersion === 'string' ? datos.mapaVersion : null,
      metodo: 'ESTIMATED',
      distanciaM: Number.isFinite(datos.distance) ? datos.distance : null,
    };
    guardarCache(clave, resultado);
    return trazado ? resultado : null;
  } catch {
    guardarCache(clave, { trazado: null, mapaVersion: null, metodo: 'ESTIMATED' });
    return null;
  } finally {
    liberar();
  }
}

// Reglas del ESTIMATED (ver MAX_ESTIMADO_*): hueco corto, sin rodeos y con
// una velocidad posible. Se exporta para las pruebas.
export function estimadoPlausible(anterior, actual, trazado, distanciaRutaM) {
  try {
    const segundos = (instanteMs(actual) - instanteMs(anterior)) / 1000;
    if (!(segundos > 0 && segundos <= MAX_ESTIMADO_SEGUNDOS)) return false;
    const recta = distanciaM(anterior, actual);
    const ruta = Number.isFinite(distanciaRutaM) ? distanciaRutaM : longitudTrazadoM(trazado);
    if (!(ruta > 0)) return false;
    if (ruta > Math.max(MAX_ESTIMADO_RAZON * recta, recta + MAX_ESTIMADO_HOLGURA_M)) return false;
    return (ruta / segundos) * 3.6 <= MAX_ESTIMADO_VELOCIDAD_KMH;
  } catch {
    return false;
  }
}

// Precisión mediana (m) de una ventana: viaja como `accuracy` al /match para
// que el snap sea más exigente con buena señal. Sin datos válidos: null.
function precisionMedianaM(puntos) {
  try {
    const valores = (Array.isArray(puntos) ? puntos : [])
      .map((p) => Number(p?.precisionM))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (valores.length === 0) return null;
    const medio = Math.floor(valores.length / 2);
    const mediana = valores.length % 2 === 0
      ? (valores[medio - 1] + valores[medio]) / 2
      : valores[medio];
    return Number.isFinite(mediana) ? mediana : null;
  } catch {
    return null;
  }
}

// Longitud acumulada de una polilínea [lon,lat], en metros.
function longitudTrazadoM(trazado) {
  let total = 0;
  for (let i = 1; i < trazado.length; i += 1) {
    total += distanciaM(
      { latitud: trazado[i - 1][1], longitud: trazado[i - 1][0] },
      { latitud: trazado[i][1], longitud: trazado[i][0] },
    );
  }
  return total;
}

// Longitud acumulada de los fixes crudos de una ventana, en metros.
function longitudCrudaM(puntos) {
  let total = 0;
  for (let i = 1; i < puntos.length; i += 1) total += distanciaM(puntos[i - 1], puntos[i]);
  return total;
}

// Distancia mínima del punto a la línea (a sus segmentos, no solo a los
// vértices), en metros, con una proyección local alrededor del punto.
function distanciaPuntoPolilineaM(punto, trazado) {
  const rad = Math.PI / 180;
  const aMetros = (lon, lat) => [
    (lon - punto.longitud) * rad * 6371000 * Math.cos(punto.latitud * rad),
    (lat - punto.latitud) * rad * 6371000,
  ];
  const [px, py] = aMetros(punto.longitud, punto.latitud);
  let minimo = Infinity;
  for (let i = 1; i < trazado.length; i += 1) {
    const [ax, ay] = aMetros(trazado[i - 1][0], trazado[i - 1][1]);
    const [bx, by] = aMetros(trazado[i][0], trazado[i][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const largo2 = dx * dx + dy * dy;
    let t = largo2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / largo2 : 0;
    t = Math.max(0, Math.min(1, t));
    const distancia = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (distancia < minimo) minimo = distancia;
  }
  return minimo;
}

// Revisa el ajuste de una ventana y lo descarta si el largo sale de 0.75 a
// 1.25 veces el original, si algún punto original queda a más de max(35,
// 2 × precisión mediana + 15) m del trazo, o si más del 30 % de los puntos
// tiene precisión peor que 25 m.
export function validarAjusteMatch(puntos, trazado) {
  try {
    if (!Array.isArray(puntos) || puntos.length < 2) {
      return { valida: false, motivo: 'invalido' };
    }
    if (!Array.isArray(trazado) || trazado.length < 2) {
      return { valida: false, motivo: 'invalido' };
    }
    const longCruda = longitudCrudaM(puntos);
    const longAjustada = longitudTrazadoM(trazado);
    const razon = longCruda > 0 ? longAjustada / longCruda : Infinity;
    const mediana = precisionMedianaM(puntos);
    const umbralDesviacionM = Math.max(
      AJUSTE_DESVIACION_MIN_M,
      mediana === null
        ? 0
        : AJUSTE_DESVIACION_FACTOR_PRECISION * mediana + AJUSTE_DESVIACION_MARGEN_M,
    );
    let desviacionMaxM = 0;
    for (const punto of puntos) {
      const distancia = distanciaPuntoPolilineaM(punto, trazado);
      if (distancia > desviacionMaxM) desviacionMaxM = distancia;
    }
    const ruidosos = puntos.filter(
      (p) => Number.isFinite(Number(p?.precisionM)) && Number(p.precisionM) > AJUSTE_RUIDO_PRECISION_M,
    ).length;
    const fraccionRuido = ruidosos / puntos.length;
    let motivo = null;
    if (!(razon >= AJUSTE_RAZON_MIN && razon <= AJUSTE_RAZON_MAX)) motivo = 'a';
    else if (desviacionMaxM > umbralDesviacionM) motivo = 'b';
    else if (fraccionRuido > AJUSTE_RUIDO_MAX_FRACCION) motivo = 'c';
    return {
      valida: motivo === null,
      motivo,
      razon,
      longCrudaM: longCruda,
      longAjustadaM: longAjustada,
      desviacionMaxM,
      umbralDesviacionM,
      fraccionRuido,
    };
  } catch {
    return { valida: false, motivo: 'invalido' };
  }
}

// Ajuste a la vía con /match usando los puntos del tramo. La precisión
// mediana se manda como `accuracy` para que el ruteo sepa cuánto confiar en
// cada punto. Devuelve {trazado, mapaVersion} o null.
async function trazarPorMatch(puntos, signal) {
  const accuracy = precisionMedianaM(puntos);
  const clave = `${claveMatch(puntos)}|a${accuracy === null ? 'na' : Math.round(accuracy)}`;
  const enCache = leerCache(clave);
  if (enCache !== undefined) return enCache.trazado ? enCache : null;
  const { signal: senal, liberar } = peticionConLimite(signal);
  try {
    const respuesta = await fetch(`${URL_RUTEO}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: puntos.map((p) => [p.longitud, p.latitud]),
        ...(accuracy === null ? {} : { accuracy }),
      }),
      signal: senal,
    });
    if (!respuesta.ok) {
      guardarCache(clave, { trazado: null, mapaVersion: null, metodo: 'MATCHED' });
      return null;
    }
    const datos = await respuesta.json();
    const trazado =
      Array.isArray(datos.matched) && datos.matched.length >= 2 ? datos.matched : null;
    const resultado = {
      trazado,
      mapaVersion: typeof datos.mapaVersion === 'string' ? datos.mapaVersion : null,
      metodo: 'MATCHED',
    };
    guardarCache(clave, resultado);
    return trazado ? resultado : null;
  } catch {
    guardarCache(clave, { trazado: null, mapaVersion: null, metodo: 'MATCHED' });
    return null;
  } finally {
    liberar();
  }
}

// Devuelve los tramos reconstruidos: [{desde, hasta, metodo:'MATCHED' o
// 'ESTIMATED', mapaVersion, trazado}], con las horas ISO de los puntos que
// los cierran. replay.js los manda al panel, que dibuja MATCHED como línea
// continua ("ajustado a vía") y ESTIMATED punteado gris.
export async function estimarTramos(posiciones, signal) {
  return reconstruirTramos(posiciones, signal);
}

export async function reconstruirTramos(todas, signal) {
  if (!Array.isArray(todas) || todas.length === 0) return [];
  // Solo fixes precisos: los aproximados (antena/wifi) torcían el ajuste con
  // colas y picos que la persona nunca recorrió.
  const posiciones = todas.filter(esPrecisoParaTrazo);
  if (posiciones.length === 0) return [];
  const candidatos = [];
  for (let i = 1; i < posiciones.length && candidatos.length < MAX_TRAMOS_ESTIMADOS; i += 1) {
    const anterior = posiciones[i - 1];
    const actual = posiciones[i];
    const segundos = (new Date(actual.registradoEn).getTime() - new Date(anterior.registradoEn).getTime()) / 1000;
    if (!(segundos >= MIN_SEPARACION_RUTEO_SEGUNDOS && segundos <= MAX_TRAMO_RUTEO_SEGUNDOS)) continue;
    if (distanciaM(anterior, actual) < MIN_DISTANCIA_RUTEO_M) continue;
    // Puntos con hora estrictamente dentro del tramo; con una lista seguida
    // suelen ser cero, por eso el método queda en ESTIMATED.
    const desdeMs = new Date(anterior.registradoEn).getTime();
    const hastaMs = new Date(actual.registradoEn).getTime();
    const intermedios = posiciones.filter((p) => {
      const instante = new Date(p.registradoEn).getTime();
      return instante > desdeMs && instante < hastaMs;
    });
    candidatos.push({ anterior, actual, intermedios });
  }
  const inicio = Date.now();
  const reconstruidos = [];
  for (let i = 0; i < candidatos.length; i += TANDA) {
    if (Date.now() - inicio > PRESUPUESTO_MS) break;
    const tanda = candidatos.slice(i, i + TANDA);
    const resultados = await Promise.all(tanda.map(async ({ anterior, actual, intermedios }) => {
      if (intermedios.length >= 2) {
        const puntos = [anterior, ...intermedios, actual];
        const porMatch = await trazarPorMatch(puntos, signal);
        if (porMatch && validarAjusteMatch(puntos, porMatch.trazado).valida) {
          return { anterior, actual, ...porMatch };
        }
        if (porMatch) return null;
      }
      // Sin puntos intermedios: un hueco largo ni se consulta.
      if ((instanteMs(actual) - instanteMs(anterior)) / 1000 > MAX_ESTIMADO_SEGUNDOS) return null;
      const porRuta = await trazarPorRuta(anterior, actual, signal);
      if (porRuta && estimadoPlausible(anterior, actual, porRuta.trazado, porRuta.distanciaM)) {
        return { anterior, actual, ...porRuta };
      }
      return null;
    }));
    for (const resultado of resultados) {
      if (resultado?.trazado) {
        reconstruidos.push({
          desde: resultado.anterior.registradoEn,
          hasta: resultado.actual.registradoEn,
          metodo: resultado.metodo,
          mapaVersion: resultado.mapaVersion,
          trazado: resultado.trazado,
        });
      }
    }
  }
  // Ajuste a la vía de los tramos con muchos puntos, ventana por ventana. Si
  // el ruteo no responde o el ajuste no pasa la revisión, la ventana queda
  // como vino.
  try {
    let ventanas = [];
    try {
      ventanas = partirVentanasDensas(posiciones);
    } catch {
      ventanas = [];
    }
    const clavesCandidatas = new Set(
      candidatos.map(({ anterior, actual }) => `${anterior.registradoEn}|${actual.registradoEn}`),
    );
    ventanas = ventanas.filter(
      (ventana) =>
        !clavesCandidatas.has(`${ventana[0].registradoEn}|${ventana[ventana.length - 1].registradoEn}`)
        && !esVentanaAPie(ventana),
    );
    for (let i = 0; i < ventanas.length; i += TANDA_DENSAS) {
      if (Date.now() - inicio > PRESUPUESTO_MS) break;
      const tanda = ventanas.slice(i, i + TANDA_DENSAS);
      const resultados = await Promise.all(
        tanda.map(async (puntos) => {
          try {
            const porMatch = await trazarPorMatch(puntos, signal);
            if (!porMatch?.trazado || porMatch.trazado.length < 2) return null;
            if (!validarAjusteMatch(puntos, porMatch.trazado).valida) return null;
            return { puntos, ...porMatch };
          } catch {
            return null;
          }
        }),
      );
      for (const resultado of resultados) {
        if (resultado?.trazado) {
          reconstruidos.push({
            desde: resultado.puntos[0].registradoEn,
            hasta: resultado.puntos[resultado.puntos.length - 1].registradoEn,
            metodo: resultado.metodo,
            mapaVersion: resultado.mapaVersion,
            trazado: resultado.trazado,
          });
        }
      }
    }
  } catch {
    // Las ventanas densas son oportunistas: ante cualquier fallo se conserva
    // lo ya reconstruido por huecos y el resto queda crudo.
  }
  try {
    reconstruidos.sort((a, b) => new Date(a.desde).getTime() - new Date(b.desde).getTime());
  } catch {
    // Sin orden tampoco se rompe la web: solo pierde el orden cronológico.
  }
  return reconstruidos;
}
