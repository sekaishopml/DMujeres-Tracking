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
//  - RÁFAGA AL DESPERTAR: tras un rato dormido el teléfono manda unos segundos
//    de puntos que saltan hasta 150 m mientras él mismo dice que está quieto,
//    y vuelve a callar. Es un solo lugar: queda el último punto.

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
// Hasta 10 min si la racha es de puntos por red (mediana de 100 m o más): al
// perder el GPS manejando, el teléfono da puntos de 50 a 200 m cada 20 s y la
// ruta se volvía un zigzag (Jeremy 27/10 07:31-07:35).
const RED_RACHA_MAX_MS = 10 * 60_000;
const RED_PRECISION_M = 100;

// Excursión: se aleja 25 m o más del último punto bueno, a más de 3 veces la
// velocidad reportada + 20 km/h, y en 60 s vuelve a quedar cerca de donde
// estaba. Si no vuelve, es un movimiento real y se conserva.
const EXCURSION_MIN_M = 25;
const EXCURSION_VENTANA_MS = 60_000;
const EXCURSION_FACTOR = 3;
const EXCURSION_MARGEN_KMH = 20;
const EXCURSION_REGRESO_M = 15;
// La vuelta puede tardar más (Jeremy 27/10 18:51: 600 m en 17 s y de vuelta
// en 76 s, caminando a 4 km/h): hasta 3 min, si ese regreso tampoco cuadra
// con la velocidad que reporta el teléfono. Un viaje real reporta la suya.
const EXCURSION_VUELTA_LENTA_MS = 3 * 60_000;
const CAMINATA_KMH = 6;
const CAMINATA_TOPE_KMH = 20;
// Bajo techo el GPS también salta kilómetros con la velocidad "coherente"
// (Diego 26/10 08:22: 2,8 km a 55 km/h y de vuelta en 3 min). Si se alejó
// 1 km o más y volvió en 5 min sin dar un solo paso, no salió.
const SALTO_SIN_PASOS_MIN_M = 1000;
const SALTO_SIN_PASOS_VENTANA_MS = 5 * 60_000;
const SALTO_SIN_PASOS_REGRESO_M = 150;
// Solo si el contador de pasos funciona ese día (avanza y cambia seguido).
const PASOS_DIA_MIN = 100;
const PASOS_VALORES_MIN = 20;

function contadorDePasosFiable(posiciones) {
  const pasos = posiciones.map((p) => p.pasos).filter((n) => n != null);
  if (pasos.length === 0) return false;
  const [menor, mayor] = pasos.reduce(([a, b], n) => [Math.min(a, n), Math.max(b, n)], [Infinity, -Infinity]);
  return mayor - menor >= PASOS_DIA_MIN && new Set(pasos).size >= PASOS_VALORES_MIN;
}

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

// Salto hacia afuera y de vuelta: una lectura lejos (150 m o más) a más de 60
// km/h, mientras el siguiente punto vuelve a ser lento desde el anterior. Un
// viaje real sigue a la misma velocidad y no se toca.
const PICO_VELOCIDAD_M = 150;
const PICO_VELOCIDAD_KMH = 60;
function esPicoDeVelocidad(anterior, actual, siguiente) {
  const v = velocidadKmh(anterior, actual);
  return (
    distanciaKm(anterior.latitud, anterior.longitud, actual.latitud, actual.longitud) * 1000 >= PICO_VELOCIDAD_M
    && v > PICO_VELOCIDAD_KMH
    && velocidadKmh(anterior, siguiente) < v / 2
  );
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
    const lapso = antes && despues ? ms(despues) - ms(antes) : Infinity;
    const precisiones = posiciones.slice(i, j).map((p) => p.precisionM).sort((a, b) => a - b);
    const deRed = precisiones[Math.floor(precisiones.length / 2)] >= RED_PRECISION_M;
    const corta = lapso <= IMPRECISO_RACHA_MAX_MS || (deRed && lapso <= RED_RACHA_MAX_MS);
    if (!corta) salida.push(...posiciones.slice(i, j));
    i = j;
  }
  return salida;
}

// Cuántos puntos desde i forman una excursión desde el ancla (0 si no la hay).
function largoExcursion(ancla, lista, i, pasosFiables) {
  const actual = lista[i];
  const sinPasos = pasosFiables ? largoSaltoSinPasos(ancla, lista, i) : 0;
  if (sinPasos > 0) return sinPasos;
  const lejos = metros(ancla, actual);
  if (lejos < EXCURSION_MIN_M || ms(actual) - ms(ancla) > EXCURSION_VENTANA_MS) return 0;
  const reportada = Math.max(ancla.velocidadKmh, actual.velocidadKmh);
  if (!Number.isFinite(reportada)) return 0;
  if (!(velocidadKmh(ancla, actual) > EXCURSION_FACTOR * reportada + EXCURSION_MARGEN_KMH)) return 0;
  for (let j = i + 1; j < lista.length && ms(lista[j]) - ms(ancla) <= EXCURSION_VUELTA_LENTA_MS; j += 1) {
    if (metros(ancla, lista[j]) > Math.max(EXCURSION_REGRESO_M, lejos / 3)) continue;
    if (ms(lista[j]) - ms(ancla) <= EXCURSION_VENTANA_MS) return j - i;
    const vuelta = Math.max(lista[j - 1].velocidadKmh, lista[j].velocidadKmh);
    // A paso de caminata (menos de 6 km/h reportados) volver a más de 20 km/h
    // ya no cuadra.
    const tope = vuelta < CAMINATA_KMH ? CAMINATA_TOPE_KMH : EXCURSION_FACTOR * vuelta + EXCURSION_MARGEN_KMH;
    return Number.isFinite(vuelta) && velocidadKmh(lista[j - 1], lista[j]) > tope ? j - i : 0;
  }
  return 0;
}

function largoSaltoSinPasos(ancla, lista, i) {
  if (ancla.pasos == null || metros(ancla, lista[i]) < SALTO_SIN_PASOS_MIN_M) return 0;
  for (let j = i + 1; j < lista.length && ms(lista[j]) - ms(ancla) <= SALTO_SIN_PASOS_VENTANA_MS; j += 1) {
    if (lista[j].pasos != null && lista[j].pasos !== ancla.pasos) return 0;
    if (metros(ancla, lista[j]) <= SALTO_SIN_PASOS_REGRESO_M) return lista[j].pasos === ancla.pasos ? j - i : 0;
  }
  return 0;
}

// Ráfaga al despertar: puntos entre dos silencios, en menos de un minuto,
// que se desplazan aunque la velocidad que reportan es de estar quieta.
const RAFAGA_SILENCIO_MS = 120_000;
const RAFAGA_MAX_MS = 60_000;
const RAFAGA_QUIETA_KMH = 5;
const RAFAGA_DESPLAZAMIENTO_KM = 0.03;

export function sinRafagasQuietas(posiciones) {
  const ms = (p) => new Date(p.registradoEn).getTime();
  const grupos = [];
  for (const p of posiciones) {
    const grupo = grupos[grupos.length - 1];
    if (grupo && ms(p) - ms(grupo[grupo.length - 1]) < RAFAGA_SILENCIO_MS) grupo.push(p);
    else grupos.push([p]);
  }
  const lista = [];
  let quitadas = 0;
  grupos.forEach((grupo, i) => {
    const entreSilencios = i > 0 && i < grupos.length - 1;
    const corta = ms(grupo[grupo.length - 1]) - ms(grupo[0]) <= RAFAGA_MAX_MS;
    if (!entreSilencios || !corta || grupo.length < 2) {
      lista.push(...grupo);
      return;
    }
    const velocidades = grupo.map((p) => Number(p.velocidadKmh)).filter(Number.isFinite).sort((a, b) => a - b);
    const mediana = velocidades.length > 0 ? velocidades[Math.floor(velocidades.length / 2)] : Infinity;
    const seDesplaza = grupo.some(
      (p) => distanciaKm(grupo[0].latitud, grupo[0].longitud, p.latitud, p.longitud) > RAFAGA_DESPLAZAMIENTO_KM,
    );
    if (mediana < RAFAGA_QUIETA_KMH && seDesplaza) {
      lista.push(grupo[grupo.length - 1]);
      quitadas += grupo.length - 1;
    } else {
      lista.push(...grupo);
    }
  });
  return { lista, quitadas };
}

// Escapada fantasma: estando en un sitio, el GPS da de golpe un tramo de
// puntos seguidos a cientos de metros, "avanza" un poco y la persona aparece
// otra vez donde estaba. Si hubiera ido de verdad, la app habría guardado la
// ida y la vuelta (estaba guardando un punto por segundo): sin ellas, ese
// tramo no ocurrió (Norelys 15/10 16:40, 1,6 km de la oficina y de vuelta).
const ESCAPADA_SILENCIO_MS = 60_000;
const ESCAPADA_SALTO_M = 300;
const ESCAPADA_MAX_MS = 3 * 60_000;
const ESCAPADA_MIN_PUNTOS = 5;
const ESCAPADA_REGRESO_M = 50;

export function sinEscapadasFantasma(posiciones) {
  const grupos = [];
  for (const p of posiciones) {
    const grupo = grupos[grupos.length - 1];
    if (grupo && ms(p) - ms(grupo[grupo.length - 1]) < ESCAPADA_SILENCIO_MS) grupo.push(p);
    else grupos.push([p]);
  }
  const lista = [];
  let quitadas = 0;
  grupos.forEach((grupo, i) => {
    const antes = lista[lista.length - 1];
    const despues = grupos[i + 1]?.[0];
    const fantasma =
      antes &&
      despues &&
      grupo.length >= ESCAPADA_MIN_PUNTOS &&
      ms(grupo[grupo.length - 1]) - ms(grupo[0]) <= ESCAPADA_MAX_MS &&
      metros(antes, grupo[0]) > ESCAPADA_SALTO_M &&
      metros(grupo[grupo.length - 1], despues) > ESCAPADA_SALTO_M &&
      metros(antes, despues) <= ESCAPADA_REGRESO_M;
    if (fantasma) quitadas += grupo.length;
    else lista.push(...grupo);
  });
  return { lista, quitadas };
}

// Despertar falso: tras un silencio (el teléfono quieto guarda un punto cada
// pocos minutos), el primer fix sale a cientos de metros con buena precisión
// y velocidad de quieto, y enseguida vuelve a donde estaba (Jeremy 27/10
// 11:08, 445 m de la oficina con ±11 m). Se quita ese tramo.
const DESPERTAR_SILENCIO_MS = 120_000;
const DESPERTAR_SALTO_M = 300;
const DESPERTAR_MAX_MS = 3 * 60_000;
const DESPERTAR_QUIETA_KMH = 5;
const DESPERTAR_REGRESO_M = 50;

export function sinDespertaresFalsos(posiciones) {
  const lista = [];
  let quitadas = 0;
  for (let i = 0; i < posiciones.length; i += 1) {
    const antes = lista[lista.length - 1];
    const p = posiciones[i];
    if (antes && ms(p) - ms(antes) >= DESPERTAR_SILENCIO_MS && metros(antes, p) > DESPERTAR_SALTO_M) {
      let j = i;
      while (j < posiciones.length && ms(posiciones[j]) - ms(p) <= DESPERTAR_MAX_MS && metros(antes, posiciones[j]) > DESPERTAR_REGRESO_M) j += 1;
      const tramo = posiciones.slice(i, j);
      const volvio = j < posiciones.length && ms(posiciones[j]) - ms(p) <= DESPERTAR_MAX_MS;
      const quieto = tramo.every((q) => Number.isFinite(q.velocidadKmh) && q.velocidadKmh < DESPERTAR_QUIETA_KMH);
      if (volvio && quieto) {
        quitadas += tramo.length;
        i = j - 1;
        continue;
      }
    }
    lista.push(p);
  }
  return { lista, quitadas };
}

export function depurarPosiciones(posiciones) {
  const dentro = [];
  let fueraDeZona = 0;
  for (const p of posiciones) {
    if (enZona(p)) dentro.push(p);
    else fueraDeZona += 1;
  }
  const enArea = sinImprecisos(dentro);
  const pasosFiables = contadorDePasosFiable(enArea);
  const imprecisas = dentro.length - enArea.length;
  const conservadas = [];
  let saltos = 0;
  let saltosLargos = 0;
  let excursiones = 0;
  for (let i = 0; i < enArea.length; i += 1) {
    const actual = enArea[i];
    const anterior = conservadas[conservadas.length - 1];
    const siguiente = enArea[i + 1];
    const excursion = anterior ? largoExcursion(anterior, enArea, i, pasosFiables) : 0;
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
    if (anterior && siguiente && esPicoDeVelocidad(anterior, actual, siguiente)) {
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
  const { lista: sinEscapadas, quitadas: enEscapadas } = sinEscapadasFantasma(conservadas);
  excursiones += enEscapadas;
  const { lista: despiertas, quitadas: enDespertares } = sinDespertaresFalsos(sinEscapadas);
  excursiones += enDespertares;
  const { lista: sinRafagas, quitadas: enRafagas } = sinRafagasQuietas(despiertas);
  return {
    conservadas: sinRafagas,
    calidad: {
      descartadasFueraDeZona: fueraDeZona,
      descartadasSalto: saltos + enRafagas,
      descartadasImprecisas: imprecisas,
      descartadasExcursion: excursiones,
      posibleOrigenMultiple: saltosLargos >= MIN_SALTOS_ORIGEN_MULTIPLE,
    },
  };
}
