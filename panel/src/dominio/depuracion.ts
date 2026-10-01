// Limpieza del recorrido antes de dibujarlo.
//
// El GPS de un teléfono quieto "camina": 20 a 80 m de temblor y puntos de
// antena a cientos de metros que vuelven enseguida. Dibujado tal cual, una
// parada de dos horas era una maraña de líneas. Aquí:
//  1. Se quitan los picos: un punto que se aleja y el siguiente vuelve, con
//     una velocidad imposible para ese ir y volver.
//  2. Se agrupan las estancias: los puntos que se quedan dentro de un radio
//     al menos DURACION_ESTANCIA_MS forman una parada y se llevan a su centro
//     (mediana), así la línea entra al círculo de la parada y sale de él.
// No se inventan puntos: solo se quitan picos y se mueven los de una
// estancia a su centro. Hora, batería y velocidad no cambian.
import type { Posicion } from '@contratos';

const RADIO_ESTANCIA_M = 60; // igual que servidor/api/src/paradas.js
const DURACION_ESTANCIA_MS = 2 * 60_000;
// Desde esta precisión, un punto no alcanza para sacar a alguien de una estancia.
const PRECISION_DUDOSA_M = 80;
const PICO_MIN_M = 60;
const PICO_VELOCIDAD_KMH = 90;
// Velocidad reportada con la que una lectura del borde ya es movimiento.
const VELOCIDAD_BORDE_KMH = 5;
// Centro de la estancia (igual que RADIO_NUCLEO_M y MIN_FIXES_BORDE de
// servidor/api/src/paradas.js): llegar o irse caminando despacio cae dentro
// de los 60 m y la caminata se llevaba al centro. Si en un extremo hay al
// menos MIN_FIXES_BORDE lecturas seguidas a más de RADIO_NUCLEO_M del centro,
// son la llegada o la salida y conservan su lugar.
const RADIO_NUCLEO_M = 30;
const MIN_FIXES_BORDE = 3;

export interface Estancia {
  inicio: string;
  fin: string;
  latitud: number;
  longitud: number;
  // Índices [desde, hasta] en el recorrido depurado.
  desde: number;
  hasta: number;
}

function metros(a: { latitud: number; longitud: number }, b: { latitud: number; longitud: number }): number {
  const dLat = (b.latitud - a.latitud) * 111320;
  const dLon = (b.longitud - a.longitud) * 111320 * Math.cos(((a.latitud + b.latitud) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

const ms = (iso: string) => new Date(iso).getTime();

function mediana(valores: number[]): number {
  const orden = [...valores].sort((x, y) => x - y);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

// Lecturas repetidas en el mismo segundo (la app a veces envía dos): se
// queda la primera. Con dos puntos iguales, "siguiente punto" no avanzaba.
function sinRepetidos(posiciones: Posicion[]): Posicion[] {
  return posiciones.filter(
    (p, i) => i === 0 || Math.floor(ms(p.registradoEn) / 1000) !== Math.floor(ms(posiciones[i - 1].registradoEn) / 1000),
  );
}

function recortarNucleo(posiciones: Posicion[], desde: number, hasta: number): [number, number] {
  const c = centro(posiciones.slice(desde, hasta + 1));
  const fuera = (k: number) => metros(c, posiciones[k]) > RADIO_NUCLEO_M;
  let k = desde;
  while (k < hasta && fuera(k)) k += 1;
  const inicio = k - desde >= MIN_FIXES_BORDE ? k : desde;
  k = hasta;
  while (k > inicio && fuera(k)) k -= 1;
  const fin = hasta - k >= MIN_FIXES_BORDE ? k : hasta;
  return [inicio, fin];
}

function quitarPicos(posiciones: Posicion[]): Posicion[] {
  if (posiciones.length < 3) return posiciones;
  const salida: Posicion[] = [posiciones[0]];
  for (let i = 1; i < posiciones.length - 1; i += 1) {
    const anterior = salida[salida.length - 1];
    const actual = posiciones[i];
    const siguiente = posiciones[i + 1];
    const ida = metros(anterior, actual);
    const vuelta = metros(actual, siguiente);
    const directo = metros(anterior, siguiente);
    const horas = Math.max(ms(siguiente.registradoEn) - ms(anterior.registradoEn), 1000) / 3_600_000;
    const esPico =
      ida > PICO_MIN_M && vuelta > PICO_MIN_M && directo < 0.4 * Math.min(ida, vuelta) && (ida + vuelta) / 1000 / horas > PICO_VELOCIDAD_KMH;
    const dudoso = (actual.precisionM ?? 0) > PRECISION_DUDOSA_M * 2 && directo < ida;
    if (!esPico && !dudoso) salida.push(actual);
  }
  salida.push(posiciones[posiciones.length - 1]);
  return salida;
}

// 3. Se unen estancias vecinas. En una parada larga el GPS sale a 60-100 m un
//    par de veces y vuelve; cada salida partía la estancia y la línea dibujaba
//    una estrella alrededor de la parada. Dos estancias se unen si sus centros
//    están cerca, las separa poco tiempo y ninguna lectura del medio se aleja
//    más de FUSION_EXCURSION_M: eso es temblor, no un viaje.
const FUSION_CENTROS_M = 80;
const FUSION_EXCURSION_M = 130;
const FUSION_SEPARACION_MS = 6 * 60_000;

function centro(grupo: Posicion[]): { latitud: number; longitud: number } {
  return { latitud: mediana(grupo.map((p) => p.latitud)), longitud: mediana(grupo.map((p) => p.longitud)) };
}

function fundirEstancias(posiciones: Posicion[], grupos: [number, number][]): [number, number][] {
  const fundidos: [number, number][] = [];
  for (const grupo of grupos) {
    const previo = fundidos[fundidos.length - 1];
    if (previo) {
      const centroPrevio = centro(posiciones.slice(previo[0], previo[1] + 1));
      const centroActual = centro(posiciones.slice(grupo[0], grupo[1] + 1));
      const separacion = ms(posiciones[grupo[0]].registradoEn) - ms(posiciones[previo[1]].registradoEn);
      const intermedias = posiciones.slice(previo[1] + 1, grupo[0]);
      if (
        separacion <= FUSION_SEPARACION_MS &&
        metros(centroPrevio, centroActual) <= FUSION_CENTROS_M &&
        intermedias.every((p) => metros(centroPrevio, p) <= FUSION_EXCURSION_M)
      ) {
        previo[1] = grupo[1];
        continue;
      }
    }
    fundidos.push([grupo[0], grupo[1]]);
  }
  return fundidos;
}

export function depurarRecorrido(originales: Posicion[]): { posiciones: Posicion[]; estancias: Estancia[] } {
  const posiciones = quitarPicos(sinRepetidos(originales));
  const salida = posiciones.map((p) => ({ ...p }));
  const grupos: [number, number][] = [];
  let i = 0;
  while (i < salida.length) {
    // La estancia crece mientras los puntos sigan dentro del radio; un punto
    // de precisión dudosa no la corta por sí solo.
    let sumaLat = salida[i].latitud;
    let sumaLon = salida[i].longitud;
    let n = 1;
    let j = i + 1;
    while (j < salida.length) {
      const centro = { latitud: sumaLat / n, longitud: sumaLon / n };
      const d = metros(centro, salida[j]);
      const radio = Math.max(RADIO_ESTANCIA_M, Math.min(salida[j].precisionM ?? 0, PRECISION_DUDOSA_M));
      if (d > radio) break;
      sumaLat += salida[j].latitud;
      sumaLon += salida[j].longitud;
      n += 1;
      j += 1;
    }
    // Los bordes del grupo pueden ser el vehículo frenando o arrancando dentro
    // del radio: no son estancia y, llevados al centro, simulaban una llegada
    // recta. Primero se mira el centro (con toda la estancia) y después los
    // bordes en movimiento.
    let [desde, hasta] = j - 1 > i ? recortarNucleo(salida, i, j - 1) : [i, j - 1];
    while (desde < hasta && (salida[desde].velocidadKmh ?? 0) >= VELOCIDAD_BORDE_KMH) desde += 1;
    while (hasta > desde && (salida[hasta].velocidadKmh ?? 0) >= VELOCIDAD_BORDE_KMH) hasta -= 1;
    if (hasta > desde && ms(salida[hasta].registradoEn) - ms(salida[desde].registradoEn) >= DURACION_ESTANCIA_MS) {
      grupos.push([desde, hasta]);
      i = hasta + 1;
    } else {
      i += 1;
    }
  }
  // Cada estancia (ya fundida) lleva todas sus lecturas, también las de la
  // excursión absorbida, a la mediana del grupo: la mediana ignora esas
  // salidas y el centro queda donde la persona estuvo.
  const estancias: Estancia[] = fundirEstancias(posiciones, grupos).map(([desde, hasta]) => {
    const { latitud, longitud } = centro(posiciones.slice(desde, hasta + 1));
    for (let k = desde; k <= hasta; k += 1) {
      salida[k] = { ...salida[k], latitud, longitud, velocidadKmh: 0 };
    }
    return { inicio: salida[desde].registradoEn, fin: salida[hasta].registradoEn, latitud, longitud, desde, hasta };
  });
  return { posiciones: salida, estancias };
}
