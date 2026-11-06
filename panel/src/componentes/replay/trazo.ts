import type { Hueco, Posicion, TramoImpreciso } from '@contratos';
import { actividadReportada, contadorDePasosFiable, salidasDuranteParada } from '../../dominio/paradasUnidas.ts';
import { milisegundos, RECTA_SEGUIDA_SEGUNDOS, RECTA_SIN_OBSERVAR_M, segmentosDeRecorrido, VISTO_PAUSA_MAX_SEGUNDOS } from '../../dominio/replay.ts';
import type { Parada, SegmentoRecorrido, TramoReconstruido } from '../../dominio/replay.ts';

// Reglas de dibujo del trazo. Solo cambian el dibujo: las posiciones, la
// ficha del punto y los reportes quedan igual.

// Color por hora: claro al empezar el día, oscuro al terminar. Cuando la
// persona pasa dos veces por la misma calle, la ida y la vuelta se distinguen
// por el tono.
export const COLOR_HORA_TEMPRANO = '#5b8fd0';
export const COLOR_HORA_MEDIO = '#2c5b99';
export const COLOR_HORA_TARDE = '#0b2545';
export const COLOR_POR_HORA = [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'f'], 1],
  0,
  COLOR_HORA_TEMPRANO,
  0.5,
  COLOR_HORA_MEDIO,
  1,
  COLOR_HORA_TARDE,
] as const;

export function fraccionDelDia(t: number, desde: number, hasta: number): number {
  if (!(hasta > desde)) return 1;
  return Math.min(Math.max((t - desde) / (hasta - desde), 0), 1);
}

function metros(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * 111320;
  const dLon = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

// Caminata: a pie el GPS oscila 5 a 15 m a los lados y la línea se veía como
// un fideo. Para dibujar, cada lectura a pie se promedia con sus dos vecinas
// (si están a menos de 30 s y 40 m). No se aplica en paradas ni en vehículo,
// donde el GPS ya es estable y las esquinas no se deben redondear.
const VELOCIDAD_A_PIE_KMH = 8;
const VECINO_MAX_MS = 30_000;
const VECINO_MAX_M = 40;

export function suavizarCaminata(posiciones: Posicion[], paradas: Parada[]): Posicion[] {
  const ventanas = paradas.map((p) => [milisegundos(p.inicio), milisegundos(p.fin)] as const);
  const enParada = (t: number) => ventanas.some(([a, b]) => t >= a && t <= b);
  return posiciones.map((p, i) => {
    const antes = posiciones[i - 1];
    const despues = posiciones[i + 1];
    if (!antes || !despues) return p;
    const t = milisegundos(p.registradoEn);
    if (enParada(t) || (p.velocidadKmh ?? 0) >= VELOCIDAD_A_PIE_KMH) return p;
    const aqui: [number, number] = [p.longitud, p.latitud];
    const a: [number, number] = [antes.longitud, antes.latitud];
    const b: [number, number] = [despues.longitud, despues.latitud];
    if (
      t - milisegundos(antes.registradoEn) > VECINO_MAX_MS ||
      milisegundos(despues.registradoEn) - t > VECINO_MAX_MS ||
      metros(aqui, a) > VECINO_MAX_M ||
      metros(aqui, b) > VECINO_MAX_M
    ) {
      return p;
    }
    return { ...p, longitud: (a[0] + 2 * aqui[0] + b[0]) / 4, latitud: (a[1] + 2 * aqui[1] + b[1]) / 4 };
  });
}

// La línea llega al borde de la parada y no la cruza: el ajuste a calles
// podía terminar en la calle de atrás y dibujar una línea por encima del
// círculo. Se recorta lo que queda a menos de RADIO_PARADA_M de una parada
// cercana en el tiempo.
const RADIO_PARADA_M = 25;
const MARGEN_PARADA_MS = 5 * 60_000;

function cortarCirculo(dentro: [number, number], fuera: [number, number], centro: [number, number]): [number, number] {
  // Búsqueda binaria del punto del tramo que cae en el borde del círculo.
  let a = dentro;
  let b = fuera;
  for (let k = 0; k < 16; k += 1) {
    const medio: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (metros(medio, centro) < RADIO_PARADA_M) a = medio;
    else b = medio;
  }
  return b;
}

function recortarCoordenadas(coords: [number, number][], centros: [number, number][]): [number, number][][] {
  if (centros.length === 0) return [coords];
  const centroDe = (p: [number, number]) => centros.find((c) => metros(p, c) < RADIO_PARADA_M) ?? null;
  // Un par cuyos dos extremos caen en círculos distintos (de una parada a la
  // siguiente, pegadas) no tiene punto "fuera" por donde empezar la pieza y se
  // perdía entero: se recorta en los dos bordes y queda el tramo del medio.
  if (coords.length === 2) {
    const [c0, c1] = [centroDe(coords[0]), centroDe(coords[1])];
    if (c0 && c1 && c0 !== c1) {
      const pieza: [number, number][] = [cortarCirculo(coords[0], coords[1], c0), cortarCirculo(coords[1], coords[0], c1)];
      return metros(pieza[0], pieza[1]) > 1 ? [pieza] : [];
    }
  }
  const piezas: [number, number][][] = [];
  let actual: [number, number][] = [];
  for (let k = 0; k < coords.length; k += 1) {
    const p = coords[k];
    const centro = centroDe(p);
    const previo = coords[k - 1];
    if (!centro) {
      if (previo && actual.length === 0) {
        const centroPrevio = centroDe(previo);
        if (centroPrevio) actual.push(cortarCirculo(previo, p, centroPrevio));
      }
      actual.push(p);
    } else if (actual.length > 0) {
      actual.push(cortarCirculo(p, actual[actual.length - 1], centro));
      piezas.push(actual);
      actual = [];
    }
  }
  if (actual.length > 0) piezas.push(actual);
  return piezas.filter((pieza) => pieza.length >= 2 && metros(pieza[0], pieza[pieza.length - 1]) > 1);
}

export function recortarEnParadas(
  segmentos: SegmentoRecorrido[],
  paradas: Parada[],
  finDe: (segmento: SegmentoRecorrido) => number,
): SegmentoRecorrido[] {
  const lista = paradas.map((p) => ({
    desde: milisegundos(p.inicio) - MARGEN_PARADA_MS,
    hasta: milisegundos(p.fin) + MARGEN_PARADA_MS,
    centro: [p.longitud, p.latitud] as [number, number],
  }));
  return segmentos.flatMap((segmento) => {
    if (segmento.tipo === 'hueco' || segmento.coordenadas.length < 2) return [segmento];
    const inicio = segmento.instante ?? 0;
    const fin = finDe(segmento);
    const centros = lista.filter((p) => inicio <= p.hasta && fin >= p.desde).map((p) => p.centro);
    return recortarCoordenadas(segmento.coordenadas, centros).map((coordenadas) => ({ ...segmento, coordenadas }));
  });
}

// Tramos ajustados a calles que empiezan o terminan dentro de una parada: el
// ajuste pegaba a la calle los minutos en que la persona seguía quieta y la
// línea arrancaba con una colita detrás de la primera flecha. Se corta donde
// cae el primer punto al salir (o el último al llegar).
// El trazo puede pasar dos veces junto al punto (el rebote antes de salir y la
// salida real): al salir se toma el paso más tardío y al llegar el más temprano.
const PROYECCION_HOLGURA_M = 20;

function proyeccionEnTrazado(coords: [number, number][], punto: [number, number], ultimo = false): { k: number; p: [number, number] } {
  const candidatos: { k: number; p: [number, number]; d: number }[] = [];
  const escala = Math.cos(punto[1] * (Math.PI / 180));
  for (let k = 0; k < coords.length - 1; k += 1) {
    const a = coords[k];
    const b = coords[k + 1];
    const dx = (b[0] - a[0]) * escala;
    const dy = b[1] - a[1];
    const largo2 = dx * dx + dy * dy;
    const f = largo2 > 0 ? Math.min(Math.max((((punto[0] - a[0]) * escala) * dx + (punto[1] - a[1]) * dy) / largo2, 0), 1) : 0;
    const p: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    candidatos.push({ k, p, d: metros(p, punto) });
  }
  if (candidatos.length === 0) return { k: 0, p: coords[0] };
  const minimo = Math.min(...candidatos.map((c) => c.d));
  const cerca = candidatos.filter((c) => c.d <= minimo + PROYECCION_HOLGURA_M);
  const elegido = ultimo ? cerca[cerca.length - 1] : cerca[0];
  return { k: elegido.k, p: elegido.p };
}

export function cortarTramosEnParadas(
  segmentos: SegmentoRecorrido[],
  paradas: Parada[],
  posiciones: Posicion[],
  finDe: (segmento: SegmentoRecorrido) => number,
): SegmentoRecorrido[] {
  const tiempos = posiciones.map((p) => milisegundos(p.registradoEn));
  return segmentos.map((segmento) => {
    if (segmento.tipo !== 'matched' || segmento.coordenadas.length < 2) return segmento;
    let coords = segmento.coordenadas;
    const inicio = segmento.instante ?? 0;
    const fin = finDe(segmento);
    for (const parada of paradas) {
      const pi = milisegundos(parada.inicio);
      const pf = milisegundos(parada.fin);
      if (inicio < pf && fin > pf && inicio >= pi - 1000) {
        // Sale de la parada dentro del tramo: se corta antes del primer punto de salida.
        const k = tiempos.findIndex((t) => t > pf);
        if (k >= 0) {
          const { k: tramo, p } = proyeccionEnTrazado(coords, [posiciones[k].longitud, posiciones[k].latitud], true);
          coords = [p, ...coords.slice(tramo + 1)];
        }
      }
      if (inicio < pi && fin > pi && fin <= pf + 1000) {
        // Llega a la parada dentro del tramo: se corta después del último fix al llegar.
        let k = -1;
        for (let j = tiempos.length - 1; j >= 0; j -= 1) {
          if (tiempos[j] < pi) {
            k = j;
            break;
          }
        }
        if (k >= 0) {
          const { k: tramo, p } = proyeccionEnTrazado(coords, [posiciones[k].longitud, posiciones[k].latitud]);
          coords = [...coords.slice(0, tramo + 1), p];
        }
      }
    }
    return coords === segmento.coordenadas ? segmento : { ...segmento, coordenadas: coords };
  });
}

// Une cada parada con su recorrido: del centro de la parada (bajo la
// insignia) al punto donde empieza la línea al salir, y del final de la línea
// al llegar hasta el centro. Así la línea nace en la parada. Solo si ese
// extremo está cerca en tiempo y distancia; si no, es un hueco.
const CONEXION_MAX_M = 400;
const CONEXION_MAX_MS = 10 * 60_000;

// Punto que no está ni en la parada ni donde empieza el trazo: hubo camino
// por otro lado y una recta entre los dos cortaría manzanas.
const DESVIO_M = 40;

// Una unión sólida solo si se vio el camino: cerca de la parada, o a poca
// distancia con puntos a cadencia normal. Si no se vio pero es corta (entrar
// o salir de un local), se marca como caminata estimada: trazo fino punteado.
// Más larga no se dibuja: sería una recta por encima de las manzanas.
const UNION_SEGUIDA_M = 60;
const UNION_INTERIOR_M = 150;
const observada = (metrosUnion: number, msUnion: number) =>
  metrosUnion <= RECTA_SIN_OBSERVAR_M || (msUnion <= RECTA_SEGUIDA_SEGUNDOS * 1000 && metrosUnion <= UNION_SEGUIDA_M);

export function conectarParadas(
  segmentos: SegmentoRecorrido[],
  paradas: Parada[],
  finDe: (segmento: SegmentoRecorrido) => number,
  posiciones: Posicion[] = [],
): SegmentoRecorrido[] {
  const hayDesvio = (desde: number, hasta: number, a: [number, number], b: [number, number]) =>
    posiciones.some((p) => {
      const t = milisegundos(p.registradoEn);
      if (t <= desde || t >= hasta) return false;
      const q: [number, number] = [p.longitud, p.latitud];
      return metros(q, a) > DESVIO_M && metros(q, b) > DESVIO_M;
    });
  const dibujados = segmentos.filter(
    (s) => (s.tipo === 'matched' || (s.tipo === 'ruta' && s.modo !== 'quieto')) && s.coordenadas.length >= 2,
  );
  const conexiones: SegmentoRecorrido[] = [];
  for (const parada of paradas) {
    const pi = milisegundos(parada.inicio);
    const pf = milisegundos(parada.fin);
    const centro: [number, number] = [parada.longitud, parada.latitud];
    // Al salir: el primer trazo que termina después de la parada y empezó en
    // ella o después (un tramo ajustado puede empezar dentro y ya viene
    // cortado en el primer fix al salir).
    const salida = dibujados
      .filter((s) => finDe(s) > pf && (s.instante ?? 0) >= pi - 1000 && (s.instante ?? 0) - pf <= CONEXION_MAX_MS)
      .sort((a, b) => (a.instante ?? 0) - (b.instante ?? 0))[0];
    const llegada = dibujados
      .filter((s) => (s.instante ?? 0) < pi && finDe(s) <= pf + 1000 && pi - finDe(s) <= CONEXION_MAX_MS)
      .sort((a, b) => finDe(b) - finDe(a))[0];
    if (salida) {
      const punto = salida.coordenadas[0];
      const d = metros(centro, punto);
      const vista = observada(d, (salida.instante ?? pf) - pf);
      if ((vista || d <= UNION_INTERIOR_M) && d > 1 && d <= CONEXION_MAX_M && !hayDesvio(pf, salida.instante ?? pf, centro, punto)) {
        // Un segundo antes del trazo de salida: así se une con él en una
        // sola línea y la primera flecha queda al nacer de la parada.
        conexiones.push({
          tipo: vista ? 'ruta' : 'estimated',
          modo: salida.modo === 'caminata' ? 'caminata' : 'vehiculo',
          coordenadas: [centro, punto],
          instante: (salida.instante ?? pf) - 1000,
        });
      }
    }
    if (llegada) {
      const punto = llegada.coordenadas[llegada.coordenadas.length - 1];
      const d = metros(centro, punto);
      const vista = observada(d, pi - finDe(llegada));
      if ((vista || d <= UNION_INTERIOR_M) && d > 1 && d <= CONEXION_MAX_M && !hayDesvio(finDe(llegada), pi, punto, centro)) {
        conexiones.push({
          tipo: vista ? 'ruta' : 'estimated',
          modo: llegada.modo === 'caminata' ? 'caminata' : 'vehiculo',
          coordenadas: [punto, centro],
          instante: finDe(llegada),
        });
      }
    }
  }
  return conexiones;
}

// Un ajuste a calles que se aparta de lecturas GPS precisas no es el camino de
// la persona (el ajuste escogió otra calle): se descarta y el tramo se
// dibuja con el GPS tal como llegó. Es la misma regla del servidor
// (ruteo.js); aquí cubre tramos guardados antes de ella. Cuenta el percentil 90 de la distancia de
// las lecturas de 5 m o menos al trazado.
const AJUSTE_PRECISO_M = 5;
const AJUSTE_MIN_PRECISOS = 5;
const AJUSTE_DESVIO_P90_M = 12;

function distanciaAPolilinea(p: [number, number], poli: [number, number][]): number {
  let minimo = Infinity;
  const escala = Math.cos(p[1] * (Math.PI / 180));
  for (let k = 0; k < poli.length - 1; k += 1) {
    const [a, b] = [poli[k], poli[k + 1]];
    const dx = (b[0] - a[0]) * escala;
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const f = l2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * escala * dx + (p[1] - a[1]) * dy) / l2, 0), 1) : 0;
    minimo = Math.min(minimo, metros(p, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]));
  }
  return minimo;
}

export function descartarAjustesLejanos(posiciones: Posicion[], reconstruidos: TramoReconstruido[], paradas: Parada[]): TramoReconstruido[] {
  const ventanas = paradas.map((p) => [milisegundos(p.inicio), milisegundos(p.fin)] as const);
  const precisas = posiciones
    .filter((p) => p.precisionM != null && p.precisionM <= AJUSTE_PRECISO_M)
    .map((p) => ({ t: milisegundos(p.registradoEn), c: [p.longitud, p.latitud] as [number, number] }))
    .filter(({ t }) => !ventanas.some(([a, b]) => t >= a && t <= b));
  return reconstruidos.filter((tramo) => {
    if (tramo.metodo !== 'MATCHED' || !Array.isArray(tramo.trazado) || tramo.trazado.length < 2) return true;
    const [desde, hasta] = [milisegundos(tramo.desde), milisegundos(tramo.hasta)];
    const distancias = precisas
      .filter(({ t }) => t >= desde && t <= hasta)
      .map(({ c }) => distanciaAPolilinea(c, tramo.trazado as [number, number][]))
      .sort((x, y) => x - y);
    if (distancias.length < AJUSTE_MIN_PRECISOS) return true;
    return distancias[Math.floor(0.9 * (distancias.length - 1))] <= AJUSTE_DESVIO_P90_M;
  });
}

const VIAJE_LEJOS_M = 150;
const SALTO_MIN_M = 20;
const SALTO_IMPOSIBLE_KMH = 130;
// Una pausa corta fuera de una parada (un semáforo, cruzar la calle) no es
// detención: si se deja "quieta" la línea queda cortada a trozos.
const PAUSA_CORTA_MS = 2 * 60_000;
const VIAJE_PRECISION_M = 30;

// Trazo que se dibuja en Repetición de ruta, a partir del recorrido depurado:
// paradas sin telaraña, caminata suavizada, ajustes a calles cortados en las
// paradas, línea recortada en su borde y unida a su centro.
export function segmentosParaDibujar(
  posiciones: Posicion[],
  huecos: Hueco[],
  reconstruidos: TramoReconstruido[],
  paradas: Parada[],
  imprecisos: TramoImpreciso[] = [],
): SegmentoRecorrido[] {
  const ventanasParada = paradas.map((p) => [milisegundos(p.inicio), milisegundos(p.fin), [p.longitud, p.latitud] as [number, number]] as const);
  const finTramo = new Map(reconstruidos.map((tramo) => [milisegundos(tramo.desde), milisegundos(tramo.hasta)]));
  // Solo para dibujar: la caminata suavizada (sin "fideo") y, después, la
  // línea recortada en el borde de cada parada.
  const trazables = suavizarCaminata(posiciones, paradas);
  const siguiente = new Map(trazables.slice(0, -1).map((p, i) => [milisegundos(p.registradoEn), milisegundos(trazables[i + 1].registradoEn)]));
  const precision = new Map(trazables.map((p) => [milisegundos(p.registradoEn), p.precisionM ?? 0]));
  // Un trazo que empieza antes del último punto de la parada y termina dentro
  // de ella es temblor. Pero si lo recorrió con buena precisión y se aleja
  // más de VIAJE_LEJOS_M del centro, es un viaje corto que la parada tapaba.
  // Un trazo que sale lejos de la parada solo es viaje si cae en una salida
  // real (misma regla que une las paradas: pasos, actividad y un trazo posible).
  const pasosFiables = contadorDePasosFiable(trazables);
  const actividadFiable = actividadReportada(trazables);
  const salidas = new Map(paradas.map((p) => [milisegundos(p.inicio), salidasDuranteParada(p, trazables, pasosFiables, actividadFiable)]));
  const enSalida = (desde: number, hasta: number, inicio: number) =>
    (salidas.get(inicio) ?? []).some(([a, b]) => desde < b && hasta > a);
  const dentroDeParada = (desde: number, hasta: number, coordenadas?: [number, number][], fiable = false) =>
    ventanasParada.some(
      ([inicio, fin, centro]) =>
        desde >= inicio &&
        hasta <= fin &&
        desde < fin &&
        !(fiable && coordenadas?.some((c) => metros(c, centro) > VIAJE_LEJOS_M) && enSalida(desde, hasta, inicio)),
    );
  const fiablePar = (t: number) => (precision.get(t) ?? 99) <= VIAJE_PRECISION_M && (precision.get(siguiente.get(t) ?? -1) ?? 99) <= VIAJE_PRECISION_M;
  // Un viaje que sale de una parada sin que los pasos ni la actividad del
  // teléfono lo respalden (ese día no funcionan) no se puede distinguir de un
  // rebote del GPS: se dibuja como estimado (punteado), no como camino visto.
  const hayPrueba = pasosFiables || actividadFiable;
  const sinPrueba = (segmento: SegmentoRecorrido) => {
    if (hayPrueba || !(segmento.tipo === 'matched' || (segmento.tipo === 'ruta' && segmento.modo !== 'quieto'))) return false;
    const t = segmento.instante ?? 0;
    const hasta = (segmento.tipo === 'matched' ? finTramo.get(t) : siguiente.get(t)) ?? t;
    return ventanasParada.some(([inicio, fin, centro]) => t >= inicio && hasta <= fin && segmento.coordenadas.some((c) => metros(c, centro) > VIAJE_LEJOS_M));
  };
  // Un par de lecturas que implica más de SALTO_IMPOSIBLE_KMH no es un camino
  // recorrido (salto del GPS): se dibuja punteado y no como trazo sólido.
  const saltoImposible = (segmento: SegmentoRecorrido) => {
    if (segmento.tipo !== 'ruta' || segmento.modo === 'quieto' || segmento.coordenadas.length !== 2) return false;
    const t = segmento.instante ?? 0;
    const fin = siguiente.get(t);
    if (fin == null || fin <= t) return false;
    const d = metros(segmento.coordenadas[0], segmento.coordenadas[1]);
    return d >= SALTO_MIN_M && d / 1000 / ((fin - t) / 3_600_000) > SALTO_IMPOSIBLE_KMH;
  };
  const crudos = segmentosDeRecorrido(trazables, huecos, reconstruidos, imprecisos).flatMap((segmento) => {
    const t = segmento.instante ?? 0;
    // Dentro de una parada todo trazo es temblor del GPS (bajo techo salta 100
    // a 200 m): no se dibujan líneas ni flechas; la parada se ve con su halo y
    // sus puntos.
    if (segmento.tipo === 'matched' && dentroDeParada(t, finTramo.get(t) ?? Infinity, segmento.coordenadas, true)) return [];
    // El corte se evalúa por su fin: el salto que SALE de la parada empieza
    // dentro de ella y termina fuera.
    if (segmento.tipo === 'hueco') return dentroDeParada(t, siguiente.get(t) ?? t, segmento.coordenadas, fiablePar(t)) ? [] : [segmento];
    if (segmento.tipo === 'ruta' && dentroDeParada(t, t, segmento.coordenadas, fiablePar(t))) return [{ ...segmento, modo: 'quieto' as const }];
    // Los fixes de antena llegan con velocidad 0 aunque la persona avance, y
    // el par quedaba "quieto" (sin línea): la ruta se veía cortada. Un par
    // quieto que se desplazó 40 m o más fuera de una parada es movimiento.
    if (segmento.tipo !== 'ruta' || segmento.modo !== 'quieto' || segmento.coordenadas.length < 2) return [segmento];
    const [a, b] = [segmento.coordenadas[0], segmento.coordenadas[segmento.coordenadas.length - 1]];
    const dLat = (b[1] - a[1]) * 111320;
    const dLon = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
    return [Math.hypot(dLat, dLon) >= 40 ? { ...segmento, modo: 'vehiculo' as const } : segmento];
  })
    .map((segmento) => (sinPrueba(segmento) ? { ...segmento, tipo: 'estimated' as const } : segmento))
    .map((segmento) => (saltoImposible(segmento) ? { ...segmento, tipo: 'estimated' as const } : segmento));
  const finDe = (segmento: SegmentoRecorrido) => {
    const t = segmento.instante ?? 0;
    return (segmento.tipo === 'ruta' ? siguiente.get(t) : finTramo.get(t) ?? siguiente.get(t)) ?? t;
  };
  const enParada = (t: number) => ventanasParada.some(([inicio, fin]) => t >= inicio && t <= fin);
  const quieto = (s: SegmentoRecorrido) => s.tipo === 'ruta' && s.modo === 'quieto';
  for (let i = 0; i < crudos.length; ) {
    if (!quieto(crudos[i])) { i += 1; continue; }
    let j = i;
    while (j + 1 < crudos.length && quieto(crudos[j + 1])) j += 1;
    const inicio = crudos[i].instante ?? 0;
    if (finDe(crudos[j]) - inicio < PAUSA_CORTA_MS && !enParada(inicio) && !enParada(finDe(crudos[j]))) {
      for (let k = i; k <= j; k += 1) crudos[k] = { ...crudos[k], modo: 'caminata' };
    }
    i = j + 1;
  }
  // Lo visto pero impreciso, fuera de las paradas, va punteado.
  const marcados = crudos.map((s) => (s.dudoso && s.tipo === 'ruta' && s.modo !== 'quieto' ? { ...s, tipo: 'estimated' as const } : s));
  const cortados = cortarTramosEnParadas(marcados, paradas, trazables, finDe);
  const recortados = recortarEnParadas(cortados, paradas, finDe);
  // Cada parada se une, desde su centro, con el punto donde empieza la
  // línea al salir y donde termina al llegar.
  const unidos = [...recortados, ...conectarParadas(recortados, paradas, finDe, trazables)];
  return coser(unirCortes(unidos, paradas, finDe, (t) => siguiente.get(t) ?? t), paradas, finDe, trazables);
}

// La ruta nunca queda partida: donde un trazo termina y el siguiente empieza
// en otro sitio, se unen. Si entre los dos hubo una parada, la unión pasa por
// su centro. Unos metros se cierran con la misma línea; más, con la raya de
// corte (no se vio por dónde fue). Si en ese rato el teléfono siguió dando
// ubicación al menos cada 30 s (quieta, o imprecisa), la unión se vio: va
// punteada.
const COSTURA_MIN_M = 3;

export function coser(
  segmentos: SegmentoRecorrido[],
  paradas: Parada[],
  finDe: (segmento: SegmentoRecorrido) => number,
  posiciones: Posicion[] = [],
): SegmentoRecorrido[] {
  const tiempos = posiciones.map((p) => milisegundos(p.registradoEn));
  const vistoEntre = (desde: number, hasta: number) => {
    if (tiempos.length === 0) return false;
    let k = 0;
    let hi = tiempos.length;
    while (k < hi) {
      const medio = (k + hi) >> 1;
      if (tiempos[medio] <= desde) k = medio + 1;
      else hi = medio;
    }
    let previo = desde;
    for (; k < tiempos.length && tiempos[k] < hasta; k += 1) {
      if (tiempos[k] - previo > VISTO_PAUSA_MAX_SEGUNDOS * 1000) return false;
      previo = tiempos[k];
    }
    return hasta - previo <= VISTO_PAUSA_MAX_SEGUNDOS * 1000;
  };
  const visibles = segmentos
    .filter((s) => s.coordenadas.length >= 2 && !(s.tipo === 'ruta' && s.modo === 'quieto'))
    .sort((a, b) => (a.instante ?? 0) - (b.instante ?? 0));
  const costuras: SegmentoRecorrido[] = [];
  for (let i = 1; i < visibles.length; i += 1) {
    const previo = visibles[i - 1];
    const actual = visibles[i];
    const a = previo.coordenadas[previo.coordenadas.length - 1];
    const b = actual.coordenadas[0];
    if (metros(a, b) <= COSTURA_MIN_M) continue;
    const desde = finDe(previo);
    const hasta = actual.instante ?? desde;
    const parada = paradas.find((p) => milisegundos(p.inicio) <= hasta && milisegundos(p.fin) >= desde);
    const centro: [number, number] | null = parada ? [parada.longitud, parada.latitud] : null;
    const puntos = centro && metros(a, centro) > COSTURA_MIN_M && metros(centro, b) > COSTURA_MIN_M ? [a, centro, b] : [a, b];
    for (let k = 1; k < puntos.length; k += 1) {
      const corta = metros(puntos[k - 1], puntos[k]) <= RECTA_SIN_OBSERVAR_M;
      const tipo = corta ? 'ruta' : vistoEntre(desde, hasta) ? 'estimated' : 'hueco';
      costuras.push({
        tipo,
        ...(tipo !== 'hueco' ? { modo: previo.modo === 'caminata' || actual.modo === 'caminata' ? 'caminata' : 'vehiculo' } : {}),
        coordenadas: [puntos[k - 1], puntos[k]],
        // Al salir de una parada, la unión va con la salida y no con la llegada.
        instante: centro && metros(puntos[k - 1], centro) <= COSTURA_MIN_M ? hasta - 1000 : desde,
      });
    }
  }
  return [...segmentos, ...costuras];
}

// La raya de corte nace en el punto crudo, y la línea de al lado termina en
// otro sitio (ajustada a la calle o recortada): quedaba suelta. Cada extremo
// se lleva al centro de la parada o a la punta del trazo vecino.
const UNION_CORTE_MAX_M = 150;
const UNION_CORTE_MAX_MS = 5 * 60_000;

export function unirCortes(
  segmentos: SegmentoRecorrido[],
  paradas: Parada[],
  finDe: (segmento: SegmentoRecorrido) => number,
  finDeCorte: (inicio: number) => number,
): SegmentoRecorrido[] {
  const dibujados = segmentos.filter(
    (s) =>
      (s.tipo === 'matched' || (s.tipo === 'ruta' && s.modo !== 'quieto')) &&
      s.coordenadas.length >= 2 &&
      // Los pasos de un par de metros no se ven: la punta visible es la del trazo largo.
      metros(s.coordenadas[0], s.coordenadas[s.coordenadas.length - 1]) >= 5,
  );
  const centroEn = (t: number): [number, number] | null => {
    const parada = paradas.find((p) => t >= milisegundos(p.inicio) && t <= milisegundos(p.fin));
    return parada ? [parada.longitud, parada.latitud] : null;
  };
  const cerca = (punto: [number, number], crudo: [number, number]) =>
    metros(punto, crudo) <= UNION_CORTE_MAX_M ? punto : crudo;
  return segmentos.map((segmento) => {
    if (segmento.tipo !== 'hueco' || segmento.coordenadas.length < 2) return segmento;
    const t0 = segmento.instante ?? 0;
    const t1 = finDeCorte(t0);
    const [a, b] = [segmento.coordenadas[0], segmento.coordenadas[segmento.coordenadas.length - 1]];
    const previo = dibujados
      .filter((s) => finDe(s) <= t0 + 1000 && t0 - finDe(s) <= UNION_CORTE_MAX_MS)
      .sort((x, y) => finDe(y) - finDe(x))[0];
    const posterior = dibujados
      .filter((s) => (s.instante ?? 0) >= t1 - 1000 && (s.instante ?? 0) - t1 <= UNION_CORTE_MAX_MS)
      .sort((x, y) => (x.instante ?? 0) - (y.instante ?? 0))[0];
    const inicio = centroEn(t0) ?? (previo ? cerca(previo.coordenadas[previo.coordenadas.length - 1], a) : a);
    const fin = centroEn(t1) ?? (posterior ? cerca(posterior.coordenadas[0], b) : b);
    return { ...segmento, coordenadas: [inicio, fin] };
  });
}
