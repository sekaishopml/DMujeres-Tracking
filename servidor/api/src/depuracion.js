// Limpia puntos imposibles antes de dibujar la Repetición de ruta. La base no
// se toca: solo se apartan del trazo, de las distancias y de la
// reconstrucción, y la respuesta dice cuántos y por qué.
//
//  - FUERA_DE_ZONA: puntos lejos del área de trabajo (37.422,-122.084 es la
//    ubicación por defecto de un emulador; un solo punto así sumaba 6.400 km).
//  - SALTO: ir y volver a más de 180 km/h. Pasa cuando dos teléfonos reportan
//    con la misma cuenta y los puntos alternan entre dos sitios. Se conserva
//    la secuencia coherente y, si se repite, se avisa.
//  - IMPRECISO: al salir de un lugar cerrado el teléfono da ubicaciones de
//    wifi o antenas (20 a 100 m de error) hasta que el GPS engancha; dibujadas
//    hacen zigzag. Se quitan si hay puntos precisos a menos de 5 min.
//  - EXCURSIÓN: el GPS se va unos metros y vuelve en segundos, a una velocidad
//    que no cuadra con la que él mismo reporta (54 m en 1 s diciendo 7 km/h).

import { LAT_MAX_OP, LAT_MIN_OP, LON_MAX_OP, LON_MIN_OP } from './segmentos.js';
import { VELOCIDAD_IMPOSIBLE_KMH, distanciaKm } from './geo.js';

// Saltos de más de 2 km repetidos 3 o más veces: no es error del GPS (que es
// de decenas o cientos de metros), son dos equipos alternando.
const SALTO_ORIGEN_MULTIPLE_KM = 2;
const MIN_SALTOS_ORIGEN_MULTIPLE = 3;

// Posición vieja: al perder señal el GPS repite lugares de segundos atrás con
// una precisión que parece buena. Se nota porque el siguiente punto, mucho más
// preciso, queda a más de 150 m a más de 120 km/h. Entonces se quitan los
// puntos de los 30 s anteriores cuya precisión sea 3 veces peor (y de 12 m o
// más) que la del punto que llega.
const ANTIGUO_VELOCIDAD_KMH = 120;
const ANTIGUO_DISTANCIA_KM = 0.15;
const ANTIGUO_VENTANA_MS = 30_000;
const ANTIGUO_FACTOR_PRECISION = 3;
const ANTIGUO_PRECISION_MIN_M = 12;

// Pico con la persona quieta: un fix aislado que reporta 15 km/h o más, a 40 m
// o más de los dos vecinos, cuando estos van a 6 km/h o menos y quedan a 30 m o
// menos entre sí. Es el GPS de un teléfono parado, no un viaje de ida y vuelta.
const PICO_QUIETO_VELOCIDAD_KMH = 15;
const PICO_QUIETO_VECINOS_KMH = 6;
const PICO_QUIETO_DISTANCIA_KM = 0.04;
const PICO_QUIETO_ENTRE_VECINOS_KM = 0.03;

// Imprecisión: una racha de puntos de más de 20 m entre dos puntos precisos que
// están a 5 min o menos uno del otro se quita entera (es la salida o la
// llegada a un lugar cerrado). Si la racha dura más o no tiene punto preciso a
// un lado, se conserva: es lo único que hay de ese momento.
// Con 20 m (no 30) salen también los de 24 a 26 m que, al dejar una parada,
// caen dentro de la manzana del frente y desvían el trazo.
const IMPRECISO_M = 20;
const IMPRECISO_RACHA_MAX_MS = 5 * 60_000;

// Excursión: se aleja 25 m o más del último punto bueno, a más de 3 veces la
// velocidad reportada + 20 km/h, y en 60 s vuelve a quedar cerca de donde
// estaba. Si no vuelve, es un movimiento real y se conserva.
const EXCURSION_MIN_M = 25;
const EXCURSION_VENTANA_MS = 60_000;
const EXCURSION_FACTOR = 3;
const EXCURSION_MARGEN_KMH = 20;
const EXCURSION_REGRESO_M = 15;

function enZona(p) {
  return (
    Number.isFinite(p.latitud) && Number.isFinite(p.longitud)
    && p.latitud >= LAT_MIN_OP && p.latitud <= LAT_MAX_OP
    && p.longitud >= LON_MIN_OP && p.longitud <= LON_MAX_OP
  );
}

function velocidadKmh(a, b) {
  const km = distanciaKm(a.latitud, a.longitud, b.latitud, b.longitud);
  const horas = (new Date(b.registradoEn).getTime() - new Date(a.registradoEn).getTime()) / 3600000;
  if (!(horas > 0)) return km > 0.05 ? Infinity : 0;
  return km / horas;
}

function esPicoQuieto(anterior, actual, siguiente) {
  if (!(actual.velocidadKmh >= PICO_QUIETO_VELOCIDAD_KMH)) return false;
  if (!(anterior.velocidadKmh <= PICO_QUIETO_VECINOS_KMH && siguiente.velocidadKmh <= PICO_QUIETO_VECINOS_KMH)) return false;
  const km = (a, b) => distanciaKm(a.latitud, a.longitud, b.latitud, b.longitud);
  return (
    km(anterior, actual) >= PICO_QUIETO_DISTANCIA_KM
    && km(actual, siguiente) >= PICO_QUIETO_DISTANCIA_KM
    && km(anterior, siguiente) <= PICO_QUIETO_ENTRE_VECINOS_KM
  );
}

const ms = (p) => new Date(p.registradoEn).getTime();
const esPreciso = (p) => !(p.precisionM > IMPRECISO_M);
const metros = (a, b) => distanciaKm(a.latitud, a.longitud, b.latitud, b.longitud) * 1000;

function sinImprecisos(posiciones) {
  const salida = [];
  let i = 0;
  while (i < posiciones.length) {
    if (esPreciso(posiciones[i])) {
      salida.push(posiciones[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < posiciones.length && !esPreciso(posiciones[j])) j += 1;
    const antes = posiciones[i - 1];
    const despues = posiciones[j];
    const corta = antes && despues && ms(despues) - ms(antes) <= IMPRECISO_RACHA_MAX_MS;
    if (!corta) salida.push(...posiciones.slice(i, j));
    i = j;
  }
  return salida;
}

// Cuántos puntos desde i forman una excursión desde el ancla (0 si no la hay).
function largoExcursion(ancla, lista, i) {
  const actual = lista[i];
  const lejos = metros(ancla, actual);
  if (lejos < EXCURSION_MIN_M || ms(actual) - ms(ancla) > EXCURSION_VENTANA_MS) return 0;
  const reportada = Math.max(ancla.velocidadKmh, actual.velocidadKmh);
  if (!Number.isFinite(reportada)) return 0;
  if (!(velocidadKmh(ancla, actual) > EXCURSION_FACTOR * reportada + EXCURSION_MARGEN_KMH)) return 0;
  for (let j = i + 1; j < lista.length && ms(lista[j]) - ms(ancla) <= EXCURSION_VENTANA_MS; j += 1) {
    if (metros(ancla, lista[j]) <= Math.max(EXCURSION_REGRESO_M, lejos / 3)) return j - i;
  }
  return 0;
}

export function depurarPosiciones(posiciones) {
  const dentro = [];
  let fueraDeZona = 0;
  for (const p of posiciones) {
    if (enZona(p)) dentro.push(p);
    else fueraDeZona += 1;
  }
  const enArea = sinImprecisos(dentro);
  const imprecisas = dentro.length - enArea.length;
  const conservadas = [];
  let saltos = 0;
  let saltosLargos = 0;
  let excursiones = 0;
  for (let i = 0; i < enArea.length; i += 1) {
    const actual = enArea[i];
    const anterior = conservadas[conservadas.length - 1];
    const siguiente = enArea[i + 1];
    const excursion = anterior ? largoExcursion(anterior, enArea, i) : 0;
    if (excursion > 0) {
      excursiones += excursion;
      i += excursion - 1;
      continue;
    }
    if (anterior && siguiente) {
      const ida = velocidadKmh(anterior, actual);
      const vuelta = velocidadKmh(actual, siguiente);
      const directo = velocidadKmh(anterior, siguiente);
      if (ida > VELOCIDAD_IMPOSIBLE_KMH && vuelta > VELOCIDAD_IMPOSIBLE_KMH && directo <= VELOCIDAD_IMPOSIBLE_KMH) {
        saltos += 1;
        if (distanciaKm(anterior.latitud, anterior.longitud, actual.latitud, actual.longitud) > SALTO_ORIGEN_MULTIPLE_KM) {
          saltosLargos += 1;
        }
        continue;
      }
    }
    if (anterior && siguiente && esPicoQuieto(anterior, actual, siguiente)) {
      saltos += 1;
      continue;
    }
    if (anterior && Number.isFinite(actual.precisionM)) {
      const km = distanciaKm(anterior.latitud, anterior.longitud, actual.latitud, actual.longitud);
      if (km > ANTIGUO_DISTANCIA_KM && velocidadKmh(anterior, actual) > ANTIGUO_VELOCIDAD_KMH) {
        const t = new Date(actual.registradoEn).getTime();
        for (let k = conservadas.length - 1; k >= 0; k -= 1) {
          const previo = conservadas[k];
          const peor = previo.precisionM >= Math.max(ANTIGUO_PRECISION_MIN_M, ANTIGUO_FACTOR_PRECISION * actual.precisionM);
          if (t - new Date(previo.registradoEn).getTime() > ANTIGUO_VENTANA_MS || !peor) break;
          conservadas.pop();
          saltos += 1;
        }
      }
    }
    conservadas.push(actual);
  }
  return {
    conservadas,
    calidad: {
      descartadasFueraDeZona: fueraDeZona,
      descartadasSalto: saltos,
      descartadasImprecisas: imprecisas,
      descartadasExcursion: excursiones,
      posibleOrigenMultiple: saltosLargos >= MIN_SALTOS_ORIGEN_MULTIPLE,
    },
  };
}
