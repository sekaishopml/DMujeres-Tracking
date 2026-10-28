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
import { milisegundos as ms } from './replay.ts';

const RADIO_ESTANCIA_M = 60; // igual que servidor/api/src/recorrido/paradas.js
const DURACION_ESTANCIA_MS = 2 * 60_000;
// Desde esta precisión, un punto no alcanza para sacar a alguien de una estancia.
const PRECISION_DUDOSA_M = 80;
const PRECISION_ANTENA_M = 100;
const ANTENA_TOPE_M = 250;
const PICO_MIN_M = 60;
const PICO_VELOCIDAD_KMH = 90;
// Velocidad reportada con la que una lectura del borde ya es movimiento.
const VELOCIDAD_BORDE_KMH = 5;
// Centro de la estancia (igual que RADIO_NUCLEO_M y MIN_FIXES_BORDE de
// servidor/api/src/recorrido/paradas.js): llegar o irse caminando despacio cae dentro
// de los 60 m y la caminata se llevaba al centro. Si en un extremo hay al
// menos MIN_FIXES_BORDE lecturas seguidas a más de RADIO_NUCLEO_M del centro,
// son la llegada o la salida y conservan su lugar.
const RADIO_NUCLEO_M = 30;
const MIN_FIXES_BORDE = 3;

// La depuración pone en 0 la velocidad de los puntos de una estancia (los
// cálculos de quietud la usan), pero lo que se muestra es lo que reportó el
// teléfono: un 0 inventado no se muestra como dato.
type ConReportada = Posicion & { velocidadReportadaKmh?: number | null };

export function velocidadMostrada(p: Posicion): number | null | undefined {
  const reportada = (p as ConReportada).velocidadReportadaKmh;
  return reportada !== undefined ? reportada : p.velocidadKmh;
}

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

// Entre edificios el rebote puede durar 2 o 3 lecturas seguidas (Israel 26/10
// 13:01: 270 m al norte y de vuelta, yendo en carro): se prueba quitar hasta
// PICO_MAX_PUNTOS juntos.
const PICO_MAX_PUNTOS = 3;

function quitarPicos(posiciones: Posicion[]): Posicion[] {
  if (posiciones.length < 3) return posiciones;
  const salida: Posicion[] = [posiciones[0]];
  for (let i = 1; i < posiciones.length - 1; ) {
    const anterior = salida[salida.length - 1];
    const actual = posiciones[i];
    let saltar = 0;
    for (let k = 1; k <= PICO_MAX_PUNTOS && i + k < posiciones.length && saltar === 0; k += 1) {
      const siguiente = posiciones[i + k];
      const ida = metros(anterior, actual);
      const vuelta = metros(posiciones[i + k - 1], siguiente);
      let rodeo = ida + vuelta;
      for (let j = i + 1; j < i + k; j += 1) rodeo += metros(posiciones[j - 1], posiciones[j]);
      const directo = metros(anterior, siguiente);
      const horas = Math.max(ms(siguiente.registradoEn) - ms(anterior.registradoEn), 1000) / 3_600_000;
      const limite = k === 1 ? 0.4 * Math.min(ida, vuelta) : 0.4 * rodeo;
      if (ida > PICO_MIN_M && vuelta > PICO_MIN_M && directo < limite && rodeo / 1000 / horas > PICO_VELOCIDAD_KMH) saltar = k;
    }
    const dudoso = (actual.precisionM ?? 0) > PRECISION_DUDOSA_M * 2 && metros(anterior, posiciones[i + 1]) < metros(anterior, actual);
    if (saltar === 0 && !dudoso) salida.push(actual);
    i += Math.max(saltar, 1);
  }
  if (salida[salida.length - 1] !== posiciones[posiciones.length - 1]) salida.push(posiciones[posiciones.length - 1]);
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

// Un rato corto en que el contador de pasos sube a ritmo de caminata no es
// una estancia aunque la persona no salga de un radio chico: camina en la
// esquina o da la vuelta a la manzana (Diego 26/10 18:21-18:26, 110 pasos por
// minuto). Una visita larga sí puede ser caminando (un centro comercial).
const CAMINATA_PASOS_MIN = 60;
const CAMINATA_MAX_MS = 10 * 60_000;

export function caminando(puntos: readonly { registradoEn: string; pasos?: number | null }[]): boolean {
  const conPasos = puntos.filter((p) => p.pasos != null);
  if (conPasos.length < 2) return false;
  const duracion = ms(conPasos[conPasos.length - 1].registradoEn) - ms(conPasos[0].registradoEn);
  if (duracion < 60_000 || duracion > CAMINATA_MAX_MS) return false;
  // Solo lo que sube: al empezar otra jornada el contador vuelve a cero.
  let pasos = 0;
  for (let k = 1; k < conPasos.length; k += 1) pasos += Math.max(0, (conPasos[k].pasos ?? 0) - (conPasos[k - 1].pasos ?? 0));
  return pasos / (duracion / 60_000) >= CAMINATA_PASOS_MIN;
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
      // Un fix de antena (100 m o más de precisión) no dice dónde está la
      // persona: basta que su círculo de error toque el radio de la estancia.
      // Así el vaivén entre dos puntos de antena a 200 m no parte la estancia.
      const precision = salida[j].precisionM ?? 0;
      const radio =
        precision >= PRECISION_ANTENA_M
          ? RADIO_ESTANCIA_M + Math.min(precision, ANTENA_TOPE_M)
          : Math.max(RADIO_ESTANCIA_M, Math.min(precision, PRECISION_DUDOSA_M));
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
    if (hasta > desde && ms(salida[hasta].registradoEn) - ms(salida[desde].registradoEn) >= DURACION_ESTANCIA_MS && !caminando(salida.slice(desde, hasta + 1))) {
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
      salida[k] = { ...salida[k], latitud, longitud, velocidadKmh: 0, velocidadReportadaKmh: velocidadMostrada(salida[k]) } as ConReportada;
    }
    return { inicio: salida[desde].registradoEn, fin: salida[hasta].registradoEn, latitud, longitud, desde, hasta };
  });
  return { posiciones: salida, estancias };
}
