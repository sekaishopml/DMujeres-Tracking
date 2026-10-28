// Geometria y agregados del replay calculados en memoria (una ventana a la vez).

const RADIO_TIERRA_KM = 6371;

export const UMBRAL_HUECO_SEGUNDOS = 600;

const aRadianes = (grados) => (grados * Math.PI) / 180;

export function distanciaKm(lat1, lon1, lat2, lon2) {
  const dLat = aRadianes(lat2 - lat1);
  const dLon = aRadianes(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aRadianes(lat1)) * Math.cos(aRadianes(lat2)) * Math.sin(dLon / 2) ** 2;
  return RADIO_TIERRA_KM * 2 * Math.asin(Math.sqrt(a));
}

export function redondear(valor, decimales = 1) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null;
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

// Un tramo que exigiría más de 180 km/h es un salto del GPS (o dos teléfonos
// con la misma cuenta): no suma distancia.
export const VELOCIDAD_IMPOSIBLE_KMH = 180;

// Quieto, el GPS tiembla unos metros en cada punto y la suma de esos pasos
// llegaba a 12 km en un día en el mismo sitio. Solo suma cuando el punto se
// aleja del último contado más de MIN_PASO_M o de su propia precisión.
export const MIN_PASO_M = 15;
const MAX_PRECISION_PASO_M = 100;

export function sumarDistanciasKm(posiciones, { omitirImposibles = false } = {}) {
  let total = 0;
  let ancla = posiciones[0];
  for (let i = 1; i < posiciones.length; i += 1) {
    const actual = posiciones[i];
    // Un punto de antena (precisión de cientos de metros) no es un lugar.
    if (Number(actual.precisionM) > MAX_PRECISION_PASO_M) continue;
    const km = distanciaKm(ancla.latitud, ancla.longitud, actual.latitud, actual.longitud);
    if (km * 1000 <= Math.max(MIN_PASO_M, Number(actual.precisionM) || 0)) continue;
    if (omitirImposibles) {
      // El tiempo se mide desde el punto anterior, no desde el ancla: tras
      // horas quieto, un salto de 13 km parecía posible.
      const horas = (new Date(actual.registradoEn).getTime() - new Date(posiciones[i - 1].registradoEn).getTime()) / 3600000;
      if (km > 0.05 && !(horas > 0 && km / horas <= VELOCIDAD_IMPOSIBLE_KMH)) continue;
    }
    total += km;
    ancla = actual;
  }
  return total;
}

export function calcularHuecos(posiciones, umbralSegundos = UMBRAL_HUECO_SEGUNDOS) {
  const huecos = [];
  for (let i = 1; i < posiciones.length; i += 1) {
    const anterior = new Date(posiciones[i - 1].registradoEn).getTime();
    const siguiente = new Date(posiciones[i].registradoEn).getTime();
    const segundos = (siguiente - anterior) / 1000;
    if (segundos > umbralSegundos) {
      huecos.push({
        desde: posiciones[i - 1].registradoEn,
        hasta: posiciones[i].registradoEn,
        duracionSegundos: Math.round(segundos),
        motivo: 'SIN_SENAL',
      });
    }
  }
  return huecos;
}

function primerValor(posiciones, campo) {
  for (const posicion of posiciones) {
    if (posicion[campo] !== null && posicion[campo] !== undefined) return posicion[campo];
  }
  return null;
}

function ultimoValor(posiciones, campo) {
  for (let i = posiciones.length - 1; i >= 0; i -= 1) {
    const valor = posiciones[i][campo];
    if (valor !== null && valor !== undefined) return valor;
  }
  return null;
}

// Velocidad máxima sostenida: la mayor que se mantuvo en 3 puntos seguidos
// (en 60 s o menos), contando en cada punto lo menor entre la velocidad que
// reporta el GPS y lo que avanzó desde el anterior. Un pico de uno o dos
// puntos (179 km/h caminando) no cuenta. Igual que en segmentos.js.
export const VELOCIDAD_PRECISION_M = 30;
export const VELOCIDAD_VENTANA_S = 60;

export function velocidadMaximaSostenidaKmh(posiciones) {
  const ms = (p) => new Date(p.registradoEn).getTime();
  const real = (k) => {
    const a = posiciones[k - 1];
    const b = posiciones[k];
    if (!a || !(Number(b.precisionM) <= VELOCIDAD_PRECISION_M)) return null;
    const segundos = (ms(b) - ms(a)) / 1000;
    if (!(segundos > 0)) return null;
    const avance = (distanciaKm(a.latitud, a.longitud, b.latitud, b.longitud) / segundos) * 3600;
    return Number.isFinite(b.velocidadKmh) ? Math.min(b.velocidadKmh, avance) : avance;
  };
  let maxima = 0;
  for (let i = 2; i + 1 < posiciones.length; i += 1) {
    if ((ms(posiciones[i + 1]) - ms(posiciones[i - 1])) / 1000 > VELOCIDAD_VENTANA_S) continue;
    const tres = [real(i - 1), real(i), real(i + 1)];
    if (tres.some((v) => v === null)) continue;
    maxima = Math.max(maxima, Math.min(...tres));
  }
  return maxima;
}

export function resumirRecorrido(posiciones, totalHuecos) {
  const primera = posiciones[0];
  const ultima = posiciones[posiciones.length - 1];
  const distanciaKm = sumarDistanciasKm(posiciones, { omitirImposibles: true });
  const duracionMin = (new Date(ultima.registradoEn).getTime() - new Date(primera.registradoEn).getTime()) / 60000;
  const velocidadMaxima = velocidadMaximaSostenidaKmh(posiciones);
  return {
    inicio: primera.registradoEn,
    fin: ultima.registradoEn,
    totalPosiciones: posiciones.length,
    totalHuecos,
    distanciaKm: redondear(distanciaKm, 3),
    duracionMin: redondear(duracionMin, 1),
    velocidadPromedioKmh: duracionMin > 0 ? redondear((distanciaKm / duracionMin) * 60, 1) : null,
    velocidadMaximaKmh: velocidadMaxima > 0 ? redondear(velocidadMaxima, 1) : null,
    bateriaInicialPct: redondear(primerValor(posiciones, 'bateriaPct'), 1),
    bateriaFinalPct: redondear(ultimoValor(posiciones, 'bateriaPct'), 1),
  };
}
