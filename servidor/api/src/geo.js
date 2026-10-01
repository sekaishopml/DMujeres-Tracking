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

export function sumarDistanciasKm(posiciones, { omitirImposibles = false } = {}) {
  let total = 0;
  for (let i = 1; i < posiciones.length; i += 1) {
    const km = distanciaKm(
      posiciones[i - 1].latitud,
      posiciones[i - 1].longitud,
      posiciones[i].latitud,
      posiciones[i].longitud,
    );
    if (omitirImposibles) {
      const horas =
        (new Date(posiciones[i].registradoEn).getTime() - new Date(posiciones[i - 1].registradoEn).getTime()) / 3600000;
      if (km > 0.05 && !(horas > 0 && km / horas <= VELOCIDAD_IMPOSIBLE_KMH)) continue;
    }
    total += km;
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

export function resumirRecorrido(posiciones, totalHuecos) {
  const primera = posiciones[0];
  const ultima = posiciones[posiciones.length - 1];
  const distanciaKm = sumarDistanciasKm(posiciones, { omitirImposibles: true });
  const duracionMin = (new Date(ultima.registradoEn).getTime() - new Date(primera.registradoEn).getTime()) / 60000;
  const velocidadMaxima = posiciones.reduce(
    (maximo, posicion) => (posicion.velocidadKmh !== null && posicion.velocidadKmh > maximo ? posicion.velocidadKmh : maximo),
    0,
  );
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
