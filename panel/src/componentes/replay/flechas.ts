import type { Feature, FeatureCollection, Point } from 'geojson';
import type { Posicion } from '@contratos';
import { milisegundos } from '@/dominio/replay';
import type { SegmentoRecorrido, TramoReconstruido } from '@/dominio/replay';

// Trazado con hora: la línea que se dibuja (GPS o ajustada a calles) con la
// hora de paso en cada vértice. Es la única geometría del reproductor: las
// flechas, el marcador, el aro del punto elegido, el globo y el centrado se
// ubican sobre ella, así nunca hay un círculo fuera de la línea ni dos
// círculos para el mismo instante.

export interface Vertice {
  lon: number;
  lat: number;
  t: number;
}

// Precisión máxima para dibujar trazo (igual que el servidor, ruteo.js): por
// encima el fix viene de antenas o wifi y se muestra como ubicación aproximada.
export const PRECISION_MAX_TRAZO_M = 50;

export function esPreciso(posicion: Posicion): boolean {
  const precision = posicion.precisionM;
  return precision == null || !Number.isFinite(precision) || precision <= PRECISION_MAX_TRAZO_M;
}

const PASO_M = 10;
const INICIO_FLECHA_M = 14;
const NIVEL_MIN = 12;
const NIVEL_MAX = 19;
// Media base del rumbo, a lo largo del trazo: suaviza los quiebres cortos.
const MEDIA_BASE_M = 12;
// Tolerancia para unir tramos consecutivos en una sola línea.
const UNION_M = 25;
// Pico: ida y vuelta corta en el ajuste a calles (entra a una esquina y
// regresa). Se quita el vértice si el giro supera 150° y alguno de
// sus dos lados mide menos de 35 m.
const PICO_GIRO_GRADOS = 150;
const PICO_LADO_M = 35;

function distanciaM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLon = (b.lon - a.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

function rumbo(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function giro(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Trazado ajustado sin picos de ida y vuelta ni vértices repetidos.
export function sinPicos(trazado: [number, number][]): [number, number][] {
  const puntos = trazado
    .map(([lon, lat]) => ({ lon, lat }))
    .filter((p, k, lista) => k === 0 || distanciaM(lista[k - 1], p) > 0.5);
  let cambio = true;
  while (cambio && puntos.length >= 3) {
    cambio = false;
    for (let k = 1; k < puntos.length - 1; k += 1) {
      const antes = distanciaM(puntos[k - 1], puntos[k]);
      const despues = distanciaM(puntos[k], puntos[k + 1]);
      const angulo = giro(rumbo(puntos[k - 1], puntos[k]), rumbo(puntos[k], puntos[k + 1]));
      if (angulo >= PICO_GIRO_GRADOS && Math.min(antes, despues) < PICO_LADO_M) {
        puntos.splice(k, 1);
        cambio = true;
        break;
      }
    }
  }
  return puntos.map((p) => [p.lon, p.lat]);
}

// Proyección de p sobre el tramo a-b: fracción [0,1] y distancia en metros.
function proyectar(p: Vertice | Posicion, a: Vertice, b: Vertice): { f: number; d: number } {
  const lat = 'lat' in p ? p.lat : p.latitud;
  const lon = 'lon' in p ? p.lon : p.longitud;
  const k = Math.cos(lat * (Math.PI / 180));
  const ax = a.lon * k;
  const bx = b.lon * k;
  const px = lon * k;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const largo2 = dx * dx + dy * dy;
  const f = largo2 > 0 ? Math.min(Math.max(((px - ax) * dx + (lat - a.lat) * dy) / largo2, 0), 1) : 0;
  const d = distanciaM({ lat, lon }, { lat: a.lat + dy * f, lon: a.lon + (b.lon - a.lon) * f });
  return { f, d };
}

// Horas de un trazado ajustado: cada fix del tramo se proyecta sobre la línea
// avanzando siempre hacia adelante; la hora de cada vértice sale de esas
// anclas. Así, si la persona estuvo quieta al inicio del tramo, la hora se
// acumula ahí y no se reparte pareja por toda la línea.
function horasDeTrazado(coords: [number, number][], desde: number, hasta: number, fixes: Posicion[]): Vertice[] {
  const v: Vertice[] = coords.map(([lon, lat]) => ({ lon, lat, t: desde }));
  const acumulada = [0];
  for (let k = 1; k < v.length; k += 1) acumulada.push(acumulada[k - 1] + distanciaM(v[k - 1], v[k]));
  const total = acumulada[acumulada.length - 1];
  const anclas: { s: number; t: number }[] = [{ s: 0, t: desde }];
  let tramo = 0;
  for (const fix of fixes) {
    const t = milisegundos(fix.registradoEn);
    if (!(t > desde && t < hasta)) continue;
    let mejor = { k: tramo, f: 0, d: Infinity };
    for (let k = tramo; k < v.length - 1; k += 1) {
      const { f, d } = proyectar(fix, v[k], v[k + 1]);
      if (d < mejor.d) mejor = { k, f, d };
    }
    const s = acumulada[mejor.k] + (acumulada[mejor.k + 1] - acumulada[mejor.k]) * mejor.f;
    const previa = anclas[anclas.length - 1];
    if (s >= previa.s) {
      anclas.push({ s, t });
      tramo = mejor.k;
    }
  }
  anclas.push({ s: total, t: hasta });
  let j = 0;
  for (let k = 0; k < v.length; k += 1) {
    const s = acumulada[k];
    while (j < anclas.length - 2 && anclas[j + 1].s < s) j += 1;
    const a = anclas[j];
    const b = anclas[j + 1];
    // Con varias anclas en el mismo punto (persona quieta) el vértice toma la
    // última hora que pasó por ahí.
    const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 1;
    v[k].t = a.t + (b.t - a.t) * Math.min(Math.max(f, 0), 1);
  }
  return v;
}

// Líneas continuas con hora en cada vértice, en orden de tiempo.
export function lineasDeRecorrido(
  precisas: Posicion[],
  segmentos: SegmentoRecorrido[],
  reconstruidos: TramoReconstruido[],
): Vertice[][] {
  // Las horas se leen una sola vez: con miles de puntos, leer la fecha por
  // cada tramo dejaba el panel congelado.
  const tiempos = precisas.map((p) => milisegundos(p.registradoEn));
  const siguienteFix = new Map<number, number>();
  for (let i = 0; i + 1 < precisas.length; i += 1) siguienteFix.set(tiempos[i], tiempos[i + 1]);
  const finReconstruido = new Map(reconstruidos.map((tramo) => [milisegundos(tramo.desde), milisegundos(tramo.hasta)]));

  const dibujados = segmentos
    .filter((s) => ((s.tipo === 'ruta' && s.modo !== 'quieto') || s.tipo === 'matched') && s.coordenadas.length >= 2)
    .sort((a, b) => (a.instante ?? 0) - (b.instante ?? 0));

  const lineas: Vertice[][] = [];
  for (const segmento of dibujados) {
    const inicio = segmento.instante;
    if (inicio == null) continue;
    // Una conexión con su parada no empieza en un fix: dura 1 s, lo justo para
    // ordenarse y unirse con el trazo vecino.
    const fin =
      segmento.tipo === 'matched' ? finReconstruido.get(inicio) : siguienteFix.get(inicio) ?? inicio + 1000;
    if (fin == null || fin < inicio) continue;
    const vertices =
      segmento.tipo === 'matched'
        ? horasDeTrazado(
            segmento.coordenadas,
            inicio,
            fin,
            precisas.filter((_, i) => tiempos[i] > inicio && tiempos[i] < fin),
          )
        : [
            { lon: segmento.coordenadas[0][0], lat: segmento.coordenadas[0][1], t: inicio },
            { lon: segmento.coordenadas[1][0], lat: segmento.coordenadas[1][1], t: fin },
          ];
    const ultima = lineas[lineas.length - 1];
    const cola = ultima?.[ultima.length - 1];
    if (cola && distanciaM(cola, vertices[0]) <= UNION_M && vertices[0].t >= cola.t) ultima.push(...vertices.slice(1));
    else lineas.push(vertices);
  }
  return lineas.filter((linea) => linea.length >= 2);
}

// Posición sobre el trazado en el instante t (null si t cae fuera de toda
// línea: parada, deriva quieta o tramo sin trazo).
export function puntoEnLineas(lineas: Vertice[][], t: number): [number, number] | null {
  for (const linea of lineas) {
    if (t < linea[0].t || t > linea[linea.length - 1].t) continue;
    for (let k = 0; k < linea.length - 1; k += 1) {
      const a = linea[k];
      const b = linea[k + 1];
      if (t < a.t || t > b.t) continue;
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];
    }
  }
  return null;
}

// Punto de la línea más cercano al punto elegido, buscando solo en los tramos
// recorridos cerca de esa hora (±2 min). Repartir la hora a lo largo del
// trazado fallaba cuando la persona estuvo quieta y después caminó de ida y
// vuelta. Si queda a más de 40 m de la línea, null.
const VENTANA_PROYECCION_MS = 2 * 60_000;
const MAX_DISTANCIA_PROYECCION_M = 40;

// Punto del trazo dibujado más cercano a (lon, lat), sin mirar la hora. Sirve
// para asentar una microparada sobre la línea. Null si ningún trazo está a
// menos de `maxM` metros.
export function puntoSobreTrazo(lineas: Vertice[][], lon: number, lat: number, maxM = 60): [number, number] | null {
  const fix: Vertice = { lon, lat, t: 0 };
  let mejor: { punto: [number, number]; d: number } | null = null;
  for (const linea of lineas) {
    for (let k = 0; k < linea.length - 1; k += 1) {
      const a = linea[k];
      const b = linea[k + 1];
      const { f, d } = proyectar(fix, a, b);
      if (!mejor || d < mejor.d) mejor = { punto: [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f], d };
    }
  }
  return mejor && mejor.d <= maxM ? mejor.punto : null;
}

export function puntoCercanoEnLineas(lineas: Vertice[][], t: number, lon: number, lat: number): [number, number] | null {
  const fix: Vertice = { lon, lat, t };
  let mejor: { punto: [number, number]; d: number } | null = null;
  for (const linea of lineas) {
    if (t < linea[0].t - VENTANA_PROYECCION_MS || t > linea[linea.length - 1].t + VENTANA_PROYECCION_MS) continue;
    for (let k = 0; k < linea.length - 1; k += 1) {
      const a = linea[k];
      const b = linea[k + 1];
      if (t < a.t - VENTANA_PROYECCION_MS || t > b.t + VENTANA_PROYECCION_MS) continue;
      const { f, d } = proyectar(fix, a, b);
      if (!mejor || d < mejor.d) mejor = { punto: [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f], d };
    }
  }
  return mejor && mejor.d <= MAX_DISTANCIA_PROYECCION_M ? mejor.punto : null;
}

// Nivel de la flecha número m (a m·PASO_M metros del inicio de su línea).
// Anidados: a zoom 12 una cada 1,28 km; cada nivel duplica la cantidad hasta
// una cada 10 m a zoom 19. Lo que se ve a un zoom sigue al acercar.
function nivelDe(m: number): number {
  let z = NIVEL_MAX;
  let paso = 2;
  while (z > NIVEL_MIN && m % paso === 0) {
    z -= 1;
    paso *= 2;
  }
  return z;
}

// Flechas cada PASO_M metros de trazado, apuntando a lo largo de la línea.
// Cada una lleva t (hora de paso), r (rumbo) y n (zoom desde el que aparece).
export function flechasDeLineas(lineas: Vertice[][]): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  for (const linea of lineas) {
    const acumulada = [0];
    for (let k = 1; k < linea.length; k += 1) acumulada.push(acumulada[k - 1] + distanciaM(linea[k - 1], linea[k]));
    const total = acumulada[acumulada.length - 1];
    const puntoEn = (s: number): Vertice => {
      // Búsqueda binaria del tramo: una línea larga tiene miles de vértices.
      let k = 0;
      let alto = linea.length - 2;
      while (k < alto) {
        const medio = (k + alto) >> 1;
        if (acumulada[medio + 1] < s) k = medio + 1;
        else alto = medio;
      }
      const largo = acumulada[k + 1] - acumulada[k];
      const f = largo > 0 ? Math.min(Math.max((s - acumulada[k]) / largo, 0), 1) : 0;
      const a = linea[k];
      const b = linea[k + 1];
      return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, t: a.t + (b.t - a.t) * f };
    };
    // Toda línea empieza con una flecha, visible a cualquier zoom: la primera
    // va a INICIO_FLECHA_M del arranque (fuera de la insignia de la parada) y
    // no deja una colita de línea sin sentido detrás.
    const inicioFlecha = Math.min(INICIO_FLECHA_M, total / 2);
    for (let m = 0; inicioFlecha + m * PASO_M <= total; m += 1) {
      const s = inicioFlecha + m * PASO_M;
      const aqui = puntoEn(s);
      const atras = puntoEn(Math.max(s - MEDIA_BASE_M, 0));
      const adelante = puntoEn(Math.min(s + MEDIA_BASE_M, total));
      if (distanciaM(atras, adelante) < 1) continue;
      features.push({
        type: 'Feature',
        properties: { t: Math.round(aqui.t), r: Math.round(rumbo(atras, adelante)), n: m === 0 ? NIVEL_MIN : nivelDe(m) },
        geometry: { type: 'Point', coordinates: [aqui.lon, aqui.lat] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
