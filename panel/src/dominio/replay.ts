import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { Hueco, MetodoReconstruccion, Posicion, TramoReconstruido } from '@contratos';
import { GUION } from './formatoBase';

export type { MetodoReconstruccion, TramoReconstruido } from '@contratos';

export interface SegmentoRecorrido {
  tipo: 'ruta' | 'hueco' | 'matched' | 'estimated';
  coordenadas: [number, number][];
  // Solo en los tramos de ruta: 0 a 4 según la velocidad del punto que cierra
  // el par, para colorear tramo a tramo. Los tramos reconstruidos no llevan
  // banda: tienen su propio estilo y nunca se pintan como GPS registrado.
  banda?: number;
  // Modo de desplazamiento del par (solo ruta): el corredor corporativo dibuja
  // vehículo con casing ancho, caminata con línea fina del mismo idioma y
  // quieto sin línea (la dispersión se muestra como halo de puntos).
  modo?: ModoReal;
  // Instante (ms) en que empieza el tramo: ubica el tramo en su viaje para
  // resaltar un viaje y atenuar el resto del día.
  instante?: number;
}

// Cómo se desplazaba en un punto o par registrado; sale solo de la velocidad.
export type ModoReal = 'vehiculo' | 'caminata' | 'quieto';

export const ETIQUETA_METODO_TRAMO: Record<MetodoReconstruccion, string> = {
  MATCHED: 'Ajustado a vía',
  ESTIMATED: 'Tramo estimado',
};

// Forma anterior de los tramos (`estimados`, sin método): une dos puntos con
// un trazado por calles.
interface EstimadoHeredado {
  desde: string;
  hasta: string;
  trazado: [number, number][];
}

// Tramo como puede llegar de la API (desde, hasta, metodo, mapaVersion,
// trazado). Si trae campos de más, se ignoran.
type TramoCrudo = Record<string, unknown>;

function esParCoordenada(valor: unknown): valor is [number, number] {
  return (
    Array.isArray(valor) &&
    typeof valor[0] === 'number' &&
    typeof valor[1] === 'number' &&
    Number.isFinite(valor[0]) &&
    Number.isFinite(valor[1])
  );
}

// Limpia un tramo de la API para dibujarlo. Devuelve null si no se puede ubicar
// (sin desde/hasta) o dibujar (menos de dos puntos válidos). Sin método, o con
// uno desconocido, queda ESTIMATED (punteado gris): un tramo reconstruido
// nunca se dibuja como GPS registrado.
function sanearTramo(tramo: unknown): TramoReconstruido | null {
  if (!tramo || typeof tramo !== 'object') return null;
  const crudo = tramo as TramoCrudo;
  if (typeof crudo.desde !== 'string' || typeof crudo.hasta !== 'string') return null;
  if (!Array.isArray(crudo.trazado)) return null;
  const trazado = (crudo.trazado as unknown[])
    .filter(esParCoordenada)
    .map(([lon, lat]) => [lon, lat] as [number, number]);
  if (trazado.length < 2) return null;
  const metodo: MetodoReconstruccion = crudo.metodo === 'MATCHED' ? 'MATCHED' : 'ESTIMATED';
  const mapaVersion = typeof crudo.mapaVersion === 'string' ? crudo.mapaVersion : null;
  return { desde: crudo.desde, hasta: crudo.hasta, metodo, mapaVersion, trazado };
}

// Pasa la respuesta del servidor a la lista de tramos reconstruidos. Usa
// `reconstruidos` (con método y versión de mapa); si llega la forma anterior,
// `estimados`, sus tramos se toman como ESTIMATED.
export function normalizarReconstruidos(respuesta: {
  reconstruidos?: unknown;
  estimados?: EstimadoHeredado[] | null;
} | null | undefined): TramoReconstruido[] {
  if (!respuesta) return [];
  if (Array.isArray(respuesta.reconstruidos)) {
    const saneados: TramoReconstruido[] = [];
    for (const tramo of respuesta.reconstruidos) {
      const saneado = sanearTramo(tramo);
      if (saneado) saneados.push(saneado);
    }
    return saneados;
  }
  const heredados = Array.isArray(respuesta.estimados) ? respuesta.estimados : [];
  const saneados: TramoReconstruido[] = [];
  for (const tramo of heredados) {
    const saneado = sanearTramo({ ...tramo, metodo: 'ESTIMATED', mapaVersion: null });
    if (saneado) saneados.push(saneado);
  }
  return saneados;
}

// Método del tramo reconstruido que une dos instantes, si existe.
export function metodoDeTramo(
  reconstruidos: TramoReconstruido[],
  desde: string,
  hasta: string,
): TramoReconstruido | null {
  return reconstruidos.find((tramo) => tramo.desde === desde && tramo.hasta === hasta) ?? null;
}

// Tramo reconstruido que toca el punto indicado (par anterior o siguiente).
// Al hacer clic sobre un trazado se elige el punto más cercano, que es un
// extremo del tramo. Los tramos ajustados a la vía cubren varios puntos: para
// un punto del medio se busca el tramo que contiene su hora (si hay varios,
// manda MATCHED).
export function tramoDeIndice(
  posiciones: Posicion[],
  reconstruidos: TramoReconstruido[],
  indice: number,
): TramoReconstruido | null {
  const actual = posiciones[indice];
  if (!actual) return null;
  const anterior = indice > 0 ? posiciones[indice - 1] : null;
  const siguiente = indice < posiciones.length - 1 ? posiciones[indice + 1] : null;
  if (anterior) {
    const tramo = metodoDeTramo(reconstruidos, anterior.registradoEn, actual.registradoEn);
    if (tramo) return tramo;
  }
  if (siguiente) {
    const tramo = metodoDeTramo(reconstruidos, actual.registradoEn, siguiente.registradoEn);
    if (tramo) return tramo;
  }
  const instante = milisegundos(actual.registradoEn);
  if (Number.isFinite(instante)) {
    let estimado: TramoReconstruido | null = null;
    for (const tramo of reconstruidos) {
      const desde = milisegundos(tramo.desde);
      const hasta = milisegundos(tramo.hasta);
      if (!Number.isFinite(desde) || !Number.isFinite(hasta)) continue;
      const inicio = Math.min(desde, hasta);
      const fin = Math.max(desde, hasta);
      if (instante < inicio || instante > fin) continue;
      if (tramo.metodo === 'MATCHED') return tramo;
      estimado ??= tramo;
    }
    if (estimado) return estimado;
  }
  return null;
}

// Una parada del recorrido. Se usa la lista del servidor (/reports/stops), con
// su dirección cuando ya está; el cálculo local devuelve la misma forma con
// direccion null.
export interface Parada {
  inicio: string;
  fin: string;
  duracionMin: number;
  latitud: number;
  longitud: number;
  direccion: string | null;
  // Coordenada y precisión con las que el servidor resuelve la dirección.
  latitudRepresentativa?: number;
  longitudRepresentativa?: number;
  precisionM?: number | null;
}

// Estado operativo del fix actual, para el marcador del reproductor.
export type EstadoUnidad = 'movimiento' | 'detencion' | 'sinSenal';

// Por debajo de 2 km/h no se distingue avance real; 3 minutos dejan fuera los
// semáforos.
export const VELOCIDAD_DETENCION_KMH = 2;
export const DURACION_DETENCION_MIN = 3;
// Caminata sostenida por debajo de 8 km/h: separa el tramo a pie (2-8 km/h)
// del tramo en moto (10-17 km/h) de la jornada de referencia. La deriva con el
// equipo parado (±25 m) queda bajo el umbral de detención y se trata como
// quieto, nunca como caminata.
export const UMBRAL_CAMINATA_KMH = 8;
// Radio de parada para el halo de dispersión: cubre la deriva parada (±25 m)
// con margen para lecturas con precisión pobre.
export const RADIO_PARADA_M = 60;
// El servidor corta los huecos a los 10 min; para el marcador, más de 5 min
// sin el punto siguiente ya es sin señal.
export const ANTIGUEDAD_SIN_SENAL_MS = 5 * 60 * 1000;

export function milisegundos(iso: string): number {
  return new Date(iso).getTime();
}

// Hora en 24 h para la lectura del reproductor y las etiquetas del mapa:
// util/formato.hora añade "a. m./p. m." y alarga la franja compacta y los
// rótulos. horaCorta se queda solo con la hora y fechaHoraCorta (abajo) con el
// día, para la ficha del punto.
const HORA_CORTA = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false });

export function horaCorta(valor?: string | null): string {
  return valor ? HORA_CORTA.format(new Date(valor)) : GUION;
}

// Fecha y hora en 24 h para la ficha del punto (formato propio, con dos
// dígitos y año corto, para que la fila no crezca).
const FECHA_HORA_CORTA = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function fechaHoraCorta(valor?: string | null): string {
  return valor ? FECHA_HORA_CORTA.format(new Date(valor)) : GUION;
}

// Fecha local de ayer (YYYY-MM-DD): alimenta el rango por defecto de Replay y
// los botones rápidos del filtro. rango.ts solo expone hoy; se retrocede un día
// con los componentes locales (Date normaliza el desborde de mes o año) y se
// compensa la zona para leer la fecha con toISOString, el mismo criterio local
// que usa fechaHoyLocal.
export { fechaAyerLocal } from './rango';

const RADIO_TIERRA_KM = 6371;

// Punto geográfico mínimo para medir distancias; Posicion lo cumple sin
// conversión, y así los helpers de selección pueden medir contra el clic.
interface Coordenada {
  latitud: number;
  longitud: number;
}

// Distancia haversine, igual que en la API: hace falta para estimar la
// velocidad cuando el equipo no la informa.
function distanciaKm(a: Coordenada, b: Coordenada): number {
  const dLat = ((b.latitud - a.latitud) * Math.PI) / 180;
  const dLon = ((b.longitud - a.longitud) * Math.PI) / 180;
  const suma =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitud * Math.PI) / 180) * Math.cos((b.latitud * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return RADIO_TIERRA_KM * 2 * Math.asin(Math.sqrt(suma));
}

// Velocidad de un punto: manda la informada; si viene vacía se calcula con el
// anterior (distancia/tiempo). Además, si el desplazamiento real contra el
// anterior es confiable (30 m o más, mayor que la precisión y en 5 min o
// menos), se usa la mayor de las dos: hay teléfonos que informan 0 en
// marcha. Mismo criterio que las paradas del servidor (segmentos.js).
const DESPLAZAMIENTO_FIABLE_M = 30;
const INTERVALO_VELOCIDAD_MAX_H = 5 / 60;

function velocidadEfectivaKmh(posicion: Posicion, anterior: Posicion | null): number | null {
  const reportada =
    posicion.velocidadKmh != null && Number.isFinite(posicion.velocidadKmh) ? posicion.velocidadKmh : null;
  if (!anterior) return reportada;
  const horas = (milisegundos(posicion.registradoEn) - milisegundos(anterior.registradoEn)) / 3600000;
  if (!(horas > 0)) return reportada;
  const metros = distanciaKm(anterior, posicion) * 1000;
  const umbral = Math.max(DESPLAZAMIENTO_FIABLE_M, posicion.precisionM ?? 0);
  const implicita = metros / 1000 / horas;
  if (reportada == null) return implicita;
  if (metros >= umbral && horas <= INTERVALO_VELOCIDAD_MAX_H) return Math.max(reportada, implicita);
  return reportada;
}

// Bandas de color por velocidad: turquesa <10, verde <25, amarillo <45,
// naranja <70 y rojo desde 70. Sin dato cae en la banda lenta: no se pinta de
// rojo algo que no se sabe.
function bandaVelocidad(velocidadKmh: number | null): number {
  if (velocidadKmh == null || !Number.isFinite(velocidadKmh) || velocidadKmh < 10) return 0;
  if (velocidadKmh < 25) return 1;
  if (velocidadKmh < 45) return 2;
  if (velocidadKmh < 70) return 3;
  return 4;
}

// Serie de velocidades efectivas alineada con las posiciones: la reportada
// manda y, si falta, se estima contra el fix anterior. Null sin evidencia.
function velocidadesEfectivas(posiciones: Posicion[]): (number | null)[] {
  return posiciones.map((posicion, i) => velocidadEfectivaKmh(posicion, i > 0 ? posiciones[i - 1] : null));
}

// Índices de fixes detenidos en rachas de al menos 3 seguidos bajo el umbral.
// Exigir racha evita que un único fix lento de caminata (2-8 km/h con un valle
// bajo 2) se lea como parada y rompa la línea a pie con un hueco de halo.
function indicesQuietos(posiciones: Posicion[]): Set<number> {
  const velocidades = velocidadesEfectivas(posiciones);
  const detenido = velocidades.map((v) => v != null && Number.isFinite(v) && v < VELOCIDAD_DETENCION_KMH);
  const quietos = new Set<number>();
  let inicio = -1;
  const cerrar = (fin: number) => {
    if (inicio >= 0 && fin - inicio + 1 >= 3) {
      for (let i = inicio; i <= fin; i += 1) quietos.add(i);
    }
    inicio = -1;
  };
  for (let i = 0; i < detenido.length; i += 1) {
    if (detenido[i]) {
      if (inicio < 0) inicio = i;
    } else {
      if (inicio >= 0) cerrar(i - 1);
    }
  }
  if (inicio >= 0) cerrar(detenido.length - 1);
  return quietos;
}

// Modo de un punto: quieto si está en una racha detenida, caminata si él y un
// vecino van a menos de 8 km/h, vehículo en el resto (sin dato no se supone
// caminata).
export function modoDePunto(posiciones: Posicion[], indice: number): ModoReal {
  const velocidades = velocidadesEfectivas(posiciones);
  const quietos = indicesQuietos(posiciones);
  if (quietos.has(indice)) return 'quieto';
  const actual = velocidades[indice];
  if (actual == null || !Number.isFinite(actual) || actual >= UMBRAL_CAMINATA_KMH) return 'vehiculo';
  const anterior = indice > 0 ? velocidades[indice - 1] : null;
  const siguiente = indice < velocidades.length - 1 ? velocidades[indice + 1] : null;
  const vecinoBajo =
    (anterior != null && Number.isFinite(anterior) && anterior < UMBRAL_CAMINATA_KMH) ||
    (siguiente != null && Number.isFinite(siguiente) && siguiente < UMBRAL_CAMINATA_KMH);
  return vecinoBajo ? 'caminata' : 'vehiculo';
}

// Modo del par (manda el punto que lo cierra; el vecino confirma la
// caminata). El par es quieto solo si sus dos puntos están en la misma racha
// detenida.
function modoDePar(quietos: Set<number>, velocidades: (number | null)[], i: number): ModoReal {
  if (quietos.has(i - 1) && quietos.has(i)) return 'quieto';
  const actual = velocidades[i];
  if (actual == null || !Number.isFinite(actual) || actual >= UMBRAL_CAMINATA_KMH) return 'vehiculo';
  const anterior = i > 0 ? velocidades[i - 1] : null;
  const siguiente = i < velocidades.length - 1 ? velocidades[i + 1] : null;
  const vecinoBajo =
    (anterior != null && Number.isFinite(anterior) && anterior < UMBRAL_CAMINATA_KMH) ||
    (siguiente != null && Number.isFinite(siguiente) && siguiente < UMBRAL_CAMINATA_KMH);
  return vecinoBajo ? 'caminata' : 'vehiculo';
}

export const ETIQUETA_MODO_REAL: Record<ModoReal, string> = {
  vehiculo: 'En vehículo',
  caminata: 'A pie',
  quieto: 'Detenido',
};

// Halo de dispersión de una parada: centro de la parada, radio observado
// (máxima distancia de sus fixes al centro, acotada a 15-80 m) y ventana
// temporal. El halo se dibuja como círculo sutil y los fixes quietos como
// nube de puntos: se muestra la dispersión real sin unirla con líneas.
export interface HaloParada {
  indice: number;
  latitud: number;
  longitud: number;
  radioM: number;
  inicio: string;
  fin: string;
  duracionMin: number;
}

export function halosDeParadas(posiciones: Posicion[], paradas: Parada[]): HaloParada[] {
  return paradas
    .map((parada, indice) => {
      if (!Number.isFinite(parada.latitud) || !Number.isFinite(parada.longitud)) return null;
      const inicio = milisegundos(parada.inicio);
      const fin = milisegundos(parada.fin);
      if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
      const desde = Math.min(inicio, fin);
      const hasta = Math.max(inicio, fin);
      let maxDistM = 0;
      let fixes = 0;
      for (const posicion of posiciones) {
        if (!Number.isFinite(posicion.latitud) || !Number.isFinite(posicion.longitud)) continue;
        const instante = milisegundos(posicion.registradoEn);
        if (!Number.isFinite(instante) || instante < desde || instante > hasta) continue;
        fixes += 1;
        maxDistM = Math.max(
          maxDistM,
          distanciaKm({ latitud: parada.latitud, longitud: parada.longitud }, posicion) * 1000,
        );
      }
      // Sin fixes en la ventana (parada del servidor fuera del rango cargado)
      // se conserva un halo de referencia de 25 m: la insignia sigue anclada a
      // la parada sin inventar dispersión.
      const radioM = fixes === 0 ? 25 : Math.min(Math.max(maxDistM, 15), 80);
      return { indice, latitud: parada.latitud, longitud: parada.longitud, radioM, inicio: parada.inicio, fin: parada.fin, duracionMin: parada.duracionMin };
    })
    .filter((halo): halo is HaloParada => halo != null);
}

// Rumbo (0 = norte) entre dos puntos; lo usan los puntos y las flechas de los
// tramos estimados.
function rumboEntrePuntos(latA: number, lonA: number, latB: number, lonB: number): number {
  const lat1 = (latA * Math.PI) / 180;
  const lat2 = (latB * Math.PI) / 180;
  const dLon = ((lonB - lonA) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function rumboEntre(a: Posicion, b: Posicion): number {
  return rumboEntrePuntos(a.latitud, a.longitud, b.latitud, b.longitud);
}

// La API marca cada hueco con los dos puntos que lo rodean, y ahí se corta la
// línea. Cada par de puntos es una Feature propia porque cada tramo lleva su
// color por velocidad.
// Los tramos reconstruidos se dibujan con su propio estilo (MATCHED o
// ESTIMATED) y los pares que cubren ya no dibujan su recta. Un tramo ajustado
// a la vía cubre varios puntos: su trazado reemplaza las rectas del medio
// para no dibujar dos veces la misma ruta. Solo quedan las rectas que entran
// y salen de él.

// Ventana de un tramo MATCHED: los puntos entre desde y hasta, sin contar los
// extremos, que quedan como anclas de la entrada y la salida.
interface VentanaMatched {
  inicio: number;
  fin: number;
}

function ventanasMatched(reconstruidos: TramoReconstruido[]): VentanaMatched[] {
  const ventanas: VentanaMatched[] = [];
  for (const tramo of reconstruidos) {
    if (tramo.metodo !== 'MATCHED') continue;
    const desde = milisegundos(tramo.desde);
    const hasta = milisegundos(tramo.hasta);
    if (!Number.isFinite(desde) || !Number.isFinite(hasta)) continue;
    ventanas.push({ inicio: Math.min(desde, hasta), fin: Math.max(desde, hasta) });
  }
  return ventanas;
}

// Verdadero cuando el instante cae estrictamente dentro de una ventana MATCHED:
// el trazado ajustado ya cubre ese tramo y la recta cruda sobra.
function enVentanaMatched(ventanas: VentanaMatched[], instante: number): boolean {
  for (const ventana of ventanas) {
    if (instante > ventana.inicio && instante < ventana.fin) return true;
  }
  return false;
}

// Redondea las esquinas del trazado reconstruido (MATCHED y ESTIMATED) para
// que no se vean como cortes rectos al acercar el mapa. Cada vértice del medio
// se reemplaza por un arco tangente a sus dos lados:
//   φ = cuánto quiebra en el vértice (0° recto, 180° vuelta en U)
//   R = radio, con estos topes:
//       min(fracción · lado más corto, 10 m)
//       desviación del vértice ≤ desplazamientoMax: R ≤ max / (sec(φ/2) − 1)
//       2.5 m en vueltas cerradas (φ > 150°)
//       el arco debe caber en el lado: R ≤ 0.45 · lado / tan(φ/2)
//   t = R · tan(φ/2), distancia del vértice a cada punto de tangencia
// El arco se arma con 2 a 5 puntos según lo cerrado de la esquina.
// Se respeta siempre:
//  - los extremos no se mueven; quiebres menores a 2° o datos raros quedan
//    como están;
//  - ningún punto nuevo se aleja más de 10 m del vértice original;
//  - dos esquinas vecinas no pueden cruzarse;
//  - si una cuerda nueva cruzara el trazado o a otra cuerda, la esquina queda
//    como estaba (nunca aparecen rulos en vueltas en U o redondelas);
//  - el largo solo puede achicarse.
// Es solo para mostrar: el GPS registrado y los huecos rectos no pasan por
// aquí y los datos no cambian.
export const SUAVIZADO_FRACCION = 0.35;
export const SUAVIZADO_DESPLAZAMIENTO_MAX_M = 10;
export const SUAVIZADO_RADIO_MAX_M = 10;
// Con menos de 2° de quiebre el arco no se nota: la esquina queda como está.
export const SUAVIZADO_ANGULO_MIN_GRADOS = 2;
// Vuelta cerrada: con más de 150° el radio se achica para no meterse entre
// los dos brazos; si igual no cabe, la esquina queda como está.
export const SUAVIZADO_ANGULO_HORQUILLA_GRADOS = 150;
export const SUAVIZADO_RADIO_HORQUILLA_M = 2.5;
// Radio mínimo: un arco más chico no se nota y solo agrega puntos.
const SUAVIZADO_RADIO_MIN_M = 0.1;
// Tangencia mínima: por debajo el arco no se nota.
const SUAVIZADO_TANGENTE_MIN_M = 0.15;
// La tangencia nunca pasa de esta fracción del lado: dos vértices vecinos
// pueden cortar el mismo lado (0.45 + 0.45 < 1) sin cruzarse entre sí.
const SUAVIZADO_FRACCION_LADO = 0.45;
// Metros por grado de latitud con la misma esfera que distanciaKm: el plano
// local del arco comparte escala con las longitudes en metros.
const SUAVIZADO_METROS_POR_GRADO = (2 * Math.PI * 6371000) / 360;
// Rejilla espacial de la regla anti-cruce: celdas de 32 m (el arco se aparta
// ≤ 10 m del vértice, así que la consulta por bbox ve todo lo cercano). Un
// segmento que cubre demasiadas celdas pasa a una lista corta que se revisa
// siempre; si el plano se vuelve patológico, el suavizado se rinde y devuelve
// el trazado crudo.
const SUAVIZADO_CELDA_M = 32;
const SUAVIZADO_CELDAS_POR_SEGMENTO = 256;
const SUAVIZADO_CANDIDATOS_MAX = 600;
const SUAVIZADO_LARGOS_MAX = 256;

// ¿Se cruzan dos segmentos? Tocarse en un extremo no cuenta. Con NaN, no.
function segmentosCruzan(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const lado = (p: [number, number], q: [number, number], r: [number, number]): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = lado(c, d, a);
  const d2 = lado(c, d, b);
  const d3 = lado(a, b, c);
  const d4 = lado(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function suavizarTrazado(
  coordenadas: [number, number][],
  desplazamientoMaxM = SUAVIZADO_DESPLAZAMIENTO_MAX_M,
  fraccion = SUAVIZADO_FRACCION,
): [number, number][] {
  const desvioMaxM = Math.min(desplazamientoMaxM, SUAVIZADO_DESPLAZAMIENTO_MAX_M);
  if (coordenadas.length < 3 || !(desvioMaxM > 0) || !(fraccion > 0)) return coordenadas;
  // Una sola proyección equirectangular para toda la traza: arcos y rejilla
  // comparten plano y escala; a ≤ 10 m de desvío el error es despreciable.
  let refLon = 0;
  let refLat = 0;
  let hayReferencia = false;
  for (const [lon, lat] of coordenadas) {
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      refLon = lon;
      refLat = lat;
      hayReferencia = true;
      break;
    }
  }
  if (!hayReferencia) return coordenadas;
  const cosRef = Math.cos((refLat * Math.PI) / 180);
  if (!(cosRef > 1e-6)) return coordenadas;
  const xy: [number, number][] = coordenadas.map(([lon, lat]) =>
    Number.isFinite(lon) && Number.isFinite(lat)
      ? [(lon - refLon) * SUAVIZADO_METROS_POR_GRADO * cosRef, (lat - refLat) * SUAVIZADO_METROS_POR_GRADO]
      : [NaN, NaN],
  );
  const rejillaOriginal = new Map<string, number[]>();
  const originalesLargos: number[] = [];
  const cuerdasGeneradas: [[number, number], [number, number]][] = [];
  const rejillaGenerada = new Map<string, number[]>();
  const generadosLargos: number[] = [];
  // Celdas que cubre la caja del segmento; null si son demasiadas (segmento
  // largo). La inserción por caja es un superconjunto: cualquier cruce cae en
  // una celda de la caja del otro segmento y por tanto se encuentra.
  const celdasDe = (a: [number, number], b: [number, number]): string[] | null => {
    const ix0 = Math.floor(Math.min(a[0], b[0]) / SUAVIZADO_CELDA_M);
    const ix1 = Math.floor(Math.max(a[0], b[0]) / SUAVIZADO_CELDA_M);
    const iy0 = Math.floor(Math.min(a[1], b[1]) / SUAVIZADO_CELDA_M);
    const iy1 = Math.floor(Math.max(a[1], b[1]) / SUAVIZADO_CELDA_M);
    const celdas: string[] = [];
    for (let ix = ix0; ix <= ix1; ix += 1) {
      for (let iy = iy0; iy <= iy1; iy += 1) {
        if (celdas.length >= SUAVIZADO_CELDAS_POR_SEGMENTO) return null;
        celdas.push(`${ix},${iy}`);
      }
    }
    return celdas;
  };
  const insertar = (
    rejilla: Map<string, number[]>,
    largos: number[],
    a: [number, number],
    b: [number, number],
    indice: number,
  ): void => {
    if (!Number.isFinite(a[0]) || !Number.isFinite(b[0])) return;
    const celdas = celdasDe(a, b);
    if (!celdas) {
      largos.push(indice);
      return;
    }
    for (const celda of celdas) {
      const lista = rejilla.get(celda);
      if (lista) lista.push(indice);
      else rejilla.set(celda, [indice]);
    }
  };
  // Segmentos en las celdas de la caja de p-q (con una celda de margen). null
  // si son demasiados: entonces esa esquina no se redondea.
  const candidatosCerca = (
    rejilla: Map<string, number[]>,
    largos: number[],
    p: [number, number],
    q: [number, number],
  ): number[] | null => {
    const oeste = Math.floor(Math.min(p[0], q[0]) / SUAVIZADO_CELDA_M) - 1;
    const este = Math.floor(Math.max(p[0], q[0]) / SUAVIZADO_CELDA_M) + 1;
    const sur = Math.floor(Math.min(p[1], q[1]) / SUAVIZADO_CELDA_M) - 1;
    const norte = Math.floor(Math.max(p[1], q[1]) / SUAVIZADO_CELDA_M) + 1;
    if ((este - oeste + 1) * (norte - sur + 1) > 64) return null;
    const lista: number[] = [...largos];
    const vistos = new Set<number>(largos);
    for (let ix = oeste; ix <= este; ix += 1) {
      for (let iy = sur; iy <= norte; iy += 1) {
        const vecinos = rejilla.get(`${ix},${iy}`);
        if (!vecinos) continue;
        for (const indice of vecinos) {
          if (vistos.has(indice)) continue;
          vistos.add(indice);
          lista.push(indice);
          if (lista.length > SUAVIZADO_CANDIDATOS_MAX) return null;
        }
      }
    }
    return lista;
  };
  for (let i = 1; i < xy.length; i += 1) {
    insertar(rejillaOriginal, originalesLargos, xy[i - 1], xy[i], i - 1);
    if (originalesLargos.length > SUAVIZADO_LARGOS_MAX) return coordenadas;
  }
  // Espolones de ida y vuelta sobre la misma vía: si un vértice repite la
  // coordenada de otro punto del trazado (mismo punto a 10 cm), el arco
  // cruzaría la copia de la vía; se conserva el vértice y queda el pliegue.
  const cuantizada = (p: [number, number]): string =>
    `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const vecesPunto = new Map<string, number>();
  for (const punto of xy) {
    if (!Number.isFinite(punto[0]) || !Number.isFinite(punto[1])) continue;
    const clave = cuantizada(punto);
    vecesPunto.set(clave, (vecesPunto.get(clave) ?? 0) + 1);
  }
  const salida: [number, number][] = [coordenadas[0]];
  for (let i = 1; i < coordenadas.length - 1; i += 1) {
    const [lonB, latB] = coordenadas[i];
    const [bx, by] = xy[i];
    if (![xy[i - 1][0], xy[i - 1][1], bx, by, xy[i + 1][0], xy[i + 1][1]].every((valor) => Number.isFinite(valor))) {
      salida.push([lonB, latB]);
      continue;
    }
    if ((vecesPunto.get(cuantizada(xy[i])) ?? 0) > 1) {
      salida.push([lonB, latB]);
      continue;
    }
    // Vectores locales alrededor de B: u = A→B, v = B→C.
    const ux = bx - xy[i - 1][0];
    const uy = by - xy[i - 1][1];
    const vx = xy[i + 1][0] - bx;
    const vy = xy[i + 1][1] - by;
    const ladoAM = Math.hypot(ux, uy);
    const ladoBM = Math.hypot(vx, vy);
    if (!(ladoAM > 0) || !(ladoBM > 0)) {
      salida.push([lonB, latB]);
      continue;
    }
    const seno = Math.abs(ux * vy - uy * vx) / (ladoAM * ladoBM);
    const coseno = Math.min(Math.max((ux * vx + uy * vy) / (ladoAM * ladoBM), -1), 1);
    const anguloRad = Math.atan2(seno, coseno);
    const anguloGrados = (anguloRad * 180) / Math.PI;
    if (anguloGrados < SUAVIZADO_ANGULO_MIN_GRADOS) {
      salida.push([lonB, latB]);
      continue;
    }
    const minLadoM = Math.min(ladoAM, ladoBM);
    const tanMitad = Math.tan(anguloRad / 2);
    const secMitad = 1 / Math.cos(anguloRad / 2);
    // Radio adaptativo: fracción del lado más corto, acotado por desviación
    // (s = R·(sec(φ/2)−1) ≤ desvioMax), por horquilla y por tangencia.
    let radioM = Math.min(fraccion * minLadoM, SUAVIZADO_RADIO_MAX_M);
    const factorDesvio = secMitad - 1;
    if (factorDesvio > 0) radioM = Math.min(radioM, desvioMaxM / factorDesvio);
    if (anguloGrados > SUAVIZADO_ANGULO_HORQUILLA_GRADOS) {
      radioM = Math.min(radioM, SUAVIZADO_RADIO_HORQUILLA_M);
    }
    if (tanMitad > 0) radioM = Math.min(radioM, (SUAVIZADO_FRACCION_LADO * minLadoM) / tanMitad);
    const tangenteM = radioM * tanMitad;
    if (!(radioM >= SUAVIZADO_RADIO_MIN_M) || !(tangenteM >= SUAVIZADO_TANGENTE_MIN_M)) {
      salida.push([lonB, latB]);
      continue;
    }
    // Direcciones unitarias B→A y B→C y bisectriz interior (centro del arco).
    const ax = -ux / ladoAM;
    const ay = -uy / ladoAM;
    const cx = vx / ladoBM;
    const cy = vy / ladoBM;
    let wx = ax + cx;
    let wy = ay + cy;
    const normaW = Math.hypot(wx, wy);
    if (!(normaW > 1e-9)) {
      // φ = 180° exacto: la bisectriz no está definida y no hay arco posible.
      salida.push([lonB, latB]);
      continue;
    }
    wx /= normaW;
    wy /= normaW;
    const centroM = radioM * secMitad;
    const ox = wx * centroM;
    const oy = wy * centroM;
    const t1x = ax * tangenteM;
    const t1y = ay * tangenteM;
    const t2x = cx * tangenteM;
    const t2y = cy * tangenteM;
    // Barrido con signo desde la tangencia T1 hasta T2 (= φ, con el sentido
    // del giro): interpolar el vector radial por ese ángulo da el arco.
    const r1x = t1x - ox;
    const r1y = t1y - oy;
    const r2x = t2x - ox;
    const r2y = t2y - oy;
    const barrido = Math.atan2(r1x * r2y - r1y * r2x, r1x * r2x + r1y * r2y);
    const puntos = Math.min(5, Math.max(2, Math.floor(anguloGrados / 30) + 2));
    const generados: [number, number][] = [];
    let finito = true;
    for (let k = 0; k < puntos; k += 1) {
      const avance = barrido * (k / (puntos - 1));
      const cosAvance = Math.cos(avance);
      const senAvance = Math.sin(avance);
      const gx = bx + ox + r1x * cosAvance - r1y * senAvance;
      const gy = by + oy + r1x * senAvance + r1y * cosAvance;
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
        finito = false;
        break;
      }
      generados.push([gx, gy]);
    }
    // Ninguna cuerda nueva puede cruzar el trazado original (sin contar sus
    // dos lados) ni las cuerdas ya aceptadas. Si cruza, la esquina queda igual.
    let cruza = !finito || generados.length < 2;
    for (let k = 1; k < generados.length && !cruza; k += 1) {
      const p = generados[k - 1];
      const q = generados[k];
      const cercanos = candidatosCerca(rejillaOriginal, originalesLargos, p, q);
      if (!cercanos) {
        cruza = true;
        break;
      }
      for (const indice of cercanos) {
        if (indice === i - 1 || indice === i) continue;
        if (segmentosCruzan(p, q, xy[indice], xy[indice + 1])) {
          cruza = true;
          break;
        }
      }
      if (cruza) break;
      const cercanosGenerados = candidatosCerca(rejillaGenerada, generadosLargos, p, q);
      if (!cercanosGenerados) {
        cruza = true;
        break;
      }
      for (const indice of cercanosGenerados) {
        if (segmentosCruzan(p, q, cuerdasGeneradas[indice][0], cuerdasGeneradas[indice][1])) {
          cruza = true;
          break;
        }
      }
    }
    if (cruza) {
      salida.push([lonB, latB]);
      continue;
    }
    for (let k = 1; k < generados.length; k += 1) {
      const cuerdas = cuerdasGeneradas.length;
      cuerdasGeneradas.push([generados[k - 1], generados[k]]);
      insertar(rejillaGenerada, generadosLargos, generados[k - 1], generados[k], cuerdas);
    }
    for (const [gx, gy] of generados) {
      salida.push([
        refLon + gx / (SUAVIZADO_METROS_POR_GRADO * cosRef),
        refLat + gy / SUAVIZADO_METROS_POR_GRADO,
      ]);
    }
  }
  salida.push(coordenadas[coordenadas.length - 1]);
  return salida;
}

// Salto sin observación: más de 2 min y 150 m entre dos puntos sin tramo
// reconstruido. Una recta sólida mostraría un camino que nadie vio (cortando
// manzanas), así que se dibuja como hueco punteado. También es salto un par
// que exigiría más de 180 km/h (GPS errático o dos teléfonos con la misma
// cuenta).
export const SALTO_SIN_OBSERVAR_SEGUNDOS = 120;
export const SALTO_SIN_OBSERVAR_M = 150;
export const VELOCIDAD_IMPOSIBLE_KMH = 180;

function esSaltoSinObservar(anterior: Posicion, actual: Posicion): boolean {
  const segundos = (milisegundos(actual.registradoEn) - milisegundos(anterior.registradoEn)) / 1000;
  const metros = distanciaKm(anterior, actual) * 1000;
  if (metros > 50 && !(segundos > 0 && (metros / segundos) * 3.6 <= VELOCIDAD_IMPOSIBLE_KMH)) return true;
  return segundos > SALTO_SIN_OBSERVAR_SEGUNDOS && metros >= SALTO_SIN_OBSERVAR_M;
}

export function segmentosDeRecorrido(
  posiciones: Posicion[],
  huecos: Hueco[],
  reconstruidos: TramoReconstruido[],
): SegmentoRecorrido[] {
  const paresReconstruidos = new Map(reconstruidos.map((tramo) => [`${tramo.desde}|${tramo.hasta}`, tramo]));
  const paresHueco = new Set(
    huecos
      .filter((hueco) => !paresReconstruidos.has(`${hueco.desde}|${hueco.hasta}`))
      .map((hueco) => `${hueco.desde}|${hueco.hasta}`),
  );
  // Entre dos jornadas no hay recorrido: ese tramo no se dibuja.
  const fueraDeJornada = new Set(
    huecos.filter((hueco) => hueco.motivo === 'FUERA_DE_JORNADA').map((hueco) => `${hueco.desde}|${hueco.hasta}`),
  );
  const segmentos: SegmentoRecorrido[] = [];
  // Las rectas del medio de un tramo ajustado a la vía no se dibujan. El modo
  // (vehículo, caminata, quieto) se calcula una vez para todo el recorrido.
  const ventanas = ventanasMatched(reconstruidos);
  const velocidades = velocidadesEfectivas(posiciones);
  const quietos = indicesQuietos(posiciones);
  for (const tramo of reconstruidos) {
    // Se descartan pares no finitos para que un punto malo no tumbe el tramo.
    // Un método desconocido se dibuja como estimado.
    const trazado = Array.isArray(tramo.trazado)
      ? tramo.trazado.filter(
          (par): par is [number, number] =>
            Array.isArray(par) && Number.isFinite(par[0]) && Number.isFinite(par[1]),
        )
      : [];
    if (trazado.length >= 2) {
      segmentos.push({
        tipo: tramo.metodo === 'MATCHED' ? 'matched' : 'estimated',
        // Solo presentación: el trazado ajustado a vía y el estimado se
        // redondean; el GPS registrado y los huecos rectos quedan crudos.
        // Sin suavizar: el marcador del reproductor recorre este mismo
        // trazado, y con el redondeo se salía de la línea en las esquinas.
        coordenadas: trazado.map(([lon, lat]) => [lon, lat] as [number, number]),
        instante: milisegundos(tramo.desde),
      });
    }
  }
  for (let i = 1; i < posiciones.length; i += 1) {
    const anterior = posiciones[i - 1];
    const actual = posiciones[i];
    // El tramo reconstruido ya dibuja este par: la recta quedaría encima del
    // trazado con otro estilo y se vería doble.
    if (paresReconstruidos.has(`${anterior.registradoEn}|${actual.registradoEn}`)) continue;
    if (fueraDeJornada.has(`${anterior.registradoEn}|${actual.registradoEn}`)) continue;
    // Tramo MATCHED: su trazado es la única línea de esa parte. Las rectas que
    // entran y salen sí se dibujan y empalman con su inicio y su fin.
    if (
      enVentanaMatched(ventanas, milisegundos(anterior.registradoEn)) ||
      enVentanaMatched(ventanas, milisegundos(actual.registradoEn))
    ) {
      continue;
    }
    const coordenadas: [number, number][] = [
      [anterior.longitud, anterior.latitud],
      [actual.longitud, actual.latitud],
    ];
    if (paresHueco.has(`${anterior.registradoEn}|${actual.registradoEn}`) || esSaltoSinObservar(anterior, actual)) {
      segmentos.push({ tipo: 'hueco', coordenadas, instante: milisegundos(anterior.registradoEn) });
      continue;
    }
    segmentos.push({
      tipo: 'ruta',
      banda: bandaVelocidad(velocidadEfectivaKmh(actual, anterior)),
      modo: modoDePar(quietos, velocidades, i),
      coordenadas,
      instante: milisegundos(anterior.registradoEn),
    });
  }
  return segmentos;
}

// Flechas de dirección cada unos 150 m, no una por punto. Solo en movimiento
// real (vehículo o caminata) y con un par de 12 m o más, porque con menos el
// GPS inventa el rumbo. Quieta no lleva flecha, y tampoco el borde de un hueco
// (el salto después de perder señal no es una dirección vista). Los tramos
// MATCHED llevan flechas sobre su trazado con su propio color; los ESTIMATED
// no llevan (la línea punteada gris ya los distingue).
//
// Un tramo corto (menos de dos separaciones) daría una flecha o ninguna. Para
// que también se lea hacia dónde fue, se pone una sola flecha en el medio del
// tramo, sobre el par confiable más cercano al centro, siempre que el tramo
// supere el umbral de movimiento (el temblor junto a una parada casi no
// avanza).
export const DISTANCIA_FLECHAS_M = 150;
export const RUMBO_FIABLE_MIN_M = 12;

// Par válido de un tramo real en curso: índices y extremos para poder medir el
// centro del tramo y emitir la marca centrada más adelante.
interface ParReal {
  indice: number;
  anterior: Posicion;
  actual: Posicion;
  metros: number;
}

export function flechasEspaciadas(
  posiciones: Posicion[],
  huecos: Hueco[],
  reconstruidos: TramoReconstruido[],
  cadaMetros = DISTANCIA_FLECHAS_M,
): FeatureCollection<Point> {
  const features: Feature<Point>[] = [];
  const paresHueco = new Set(huecos.map((hueco) => `${hueco.desde}|${hueco.hasta}`));
  const paresReconstruidos = new Set(reconstruidos.map((tramo) => `${tramo.desde}|${tramo.hasta}`));
  // Dentro de un tramo MATCHED no van flechas crudas: ahí manda el trazado
  // ajustado.
  const ventanas = ventanasMatched(reconstruidos);
  const velocidades = velocidadesEfectivas(posiciones);
  const quietos = indicesQuietos(posiciones);
  const marcaReal = (par: ParReal, longitud: number, latitud: number): Feature<Point> => ({
    type: 'Feature',
    properties: {
      bearing: rumboEntre(par.anterior, par.actual),
      banda: bandaVelocidad(velocidadEfectivaKmh(par.actual, par.anterior)),
      origen: 'real',
      indice: par.indice,
      instante: milisegundos(par.anterior.registradoEn),
    },
    geometry: { type: 'Point', coordinates: [longitud, latitud] },
  });
  // Cierra el tramo en curso: reparte las flechas por distancia; si es corto
  // y hay un par confiable cerca del centro, pone una sola flecha en el medio.
  const cerrarTramo = (pares: ParReal[], metrosTramo: number) => {
    if (pares.length === 0) return;
    const normales: Feature<Point>[] = [];
    let acumuladoM = 0;
    for (const par of pares) {
      acumuladoM += par.metros;
      if (acumuladoM >= cadaMetros && par.metros >= RUMBO_FIABLE_MIN_M) {
        acumuladoM = 0;
        normales.push(marcaReal(par, par.actual.longitud, par.actual.latitud));
      }
    }
    if (metrosTramo >= 2 * cadaMetros) {
      features.push(...normales);
      return;
    }
    // Tramo corto y lento: el temblor junto a una parada larga puede superar
    // el umbral de a pares sin mover el equipo. Se mide el avance neto entre
    // los extremos sobre el tiempo y se descarta con el umbral de detenido.
    const primera = pares[0].anterior;
    const ultima = pares[pares.length - 1].actual;
    const duracionHoras =
      (milisegundos(ultima.registradoEn) - milisegundos(primera.registradoEn)) / 3600000;
    const velocidadTramoKmh = duracionHoras > 0 ? distanciaKm(primera, ultima) / duracionHoras : 0;
    if (velocidadTramoKmh < VELOCIDAD_DETENCION_KMH) {
      features.push(...normales);
      return;
    }
    // Par fiable cuyo centro cae más cerca del centro del tramo.
    const centroTramoM = metrosTramo / 2;
    let inicioParM = 0;
    let elegido: ParReal | null = null;
    let distanciaCentro = Infinity;
    for (const par of pares) {
      if (par.metros >= RUMBO_FIABLE_MIN_M) {
        const centroParM = inicioParM + par.metros / 2;
        const distancia = Math.abs(centroParM - centroTramoM);
        if (distancia < distanciaCentro) {
          distanciaCentro = distancia;
          elegido = par;
        }
      }
      inicioParM += par.metros;
    }
    if (!elegido) {
      features.push(...normales);
      return;
    }
    const longitud = (elegido.anterior.longitud + elegido.actual.longitud) / 2;
    const latitud = (elegido.anterior.latitud + elegido.actual.latitud) / 2;
    const marca = marcaReal(elegido, longitud, latitud);
    features.push({ ...marca, properties: { ...marca.properties, puntoMedio: true } });
  };
  let paresTramo: ParReal[] = [];
  let metrosTramo = 0;
  for (let i = 1; i < posiciones.length; i += 1) {
    const anterior = posiciones[i - 1];
    const actual = posiciones[i];
    if (
      !Number.isFinite(anterior.latitud) ||
      !Number.isFinite(anterior.longitud) ||
      !Number.isFinite(actual.latitud) ||
      !Number.isFinite(actual.longitud)
    ) {
      cerrarTramo(paresTramo, metrosTramo);
      paresTramo = [];
      metrosTramo = 0;
      continue;
    }
    const clave = `${anterior.registradoEn}|${actual.registradoEn}`;
    if (paresHueco.has(clave) || paresReconstruidos.has(clave) || esSaltoSinObservar(anterior, actual)) {
      cerrarTramo(paresTramo, metrosTramo);
      paresTramo = [];
      metrosTramo = 0;
      continue;
    }
    if (
      enVentanaMatched(ventanas, milisegundos(anterior.registradoEn)) ||
      enVentanaMatched(ventanas, milisegundos(actual.registradoEn))
    ) {
      cerrarTramo(paresTramo, metrosTramo);
      paresTramo = [];
      metrosTramo = 0;
      continue;
    }
    if (modoDePar(quietos, velocidades, i) === 'quieto') {
      cerrarTramo(paresTramo, metrosTramo);
      paresTramo = [];
      metrosTramo = 0;
      continue;
    }
    const tramoM = distanciaKm(anterior, actual) * 1000;
    if (!(tramoM > 0)) continue;
    paresTramo.push({ indice: i, anterior, actual, metros: tramoM });
    metrosTramo += tramoM;
  }
  cerrarTramo(paresTramo, metrosTramo);
  let indiceTrazado = posiciones.length;
  for (const tramo of reconstruidos) {
    if (tramo.metodo !== 'MATCHED') continue;
    const trazado = Array.isArray(tramo.trazado)
      ? tramo.trazado.filter(
          (par): par is [number, number] =>
            Array.isArray(par) && Number.isFinite(par[0]) && Number.isFinite(par[1]),
        )
      : [];
    if (trazado.length < 2) continue;
    let acumuladoTrazadoM = 0;
    for (let i = 1; i < trazado.length; i += 1) {
      const [lonA, latA] = trazado[i - 1];
      const [lonB, latB] = trazado[i];
      const tramoM =
        distanciaKm({ latitud: latA, longitud: lonA }, { latitud: latB, longitud: lonB }) * 1000;
      if (!(tramoM > 0)) continue;
      acumuladoTrazadoM += tramoM;
      if (acumuladoTrazadoM >= cadaMetros && tramoM >= RUMBO_FIABLE_MIN_M) {
        acumuladoTrazadoM = 0;
        features.push({
          type: 'Feature',
          properties: {
            bearing: rumboEntrePuntos(latA, lonA, latB, lonB),
            banda: 0,
            origen: 'matched',
            indice: indiceTrazado,
            instante: milisegundos(tramo.desde),
          },
          geometry: { type: 'Point', coordinates: [lonB, latB] },
        });
        indiceTrazado += 1;
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

// Nube de puntos estando quieta: un punto por cada lectura detenida, para
// mostrar el temblor del GPS como un halo y no como líneas.
export function puntosQuietos(posiciones: Posicion[]): FeatureCollection<Point> {
  const quietos = indicesQuietos(posiciones);
  const features: Feature<Point>[] = [];
  for (const indice of quietos) {
    const posicion = posiciones[indice];
    if (!posicion || !Number.isFinite(posicion.latitud) || !Number.isFinite(posicion.longitud)) continue;
    features.push({
      type: 'Feature',
      properties: { indice },
      geometry: { type: 'Point', coordinates: [posicion.longitud, posicion.latitud] },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function aColeccionHalos(halos: HaloParada[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: halos.map((halo) => ({
      type: 'Feature',
      properties: { indice: halo.indice, radioM: halo.radioM },
      geometry: { type: 'Point', coordinates: [halo.longitud, halo.latitud] },
    })),
  };
}

// Cuántas flechas saltear según el zoom: al alejar se muestran menos para no
// saturar. 0 = sin flechas. Los pasos son chicos para que el cambio sea suave.
export function pasoFlechas(zoom: number): number {
  if (zoom < 9) return 0;
  if (zoom < 10) return 32;
  if (zoom < 11) return 20;
  if (zoom < 12) return 12;
  if (zoom < 13) return 8;
  if (zoom < 14) return 5;
  if (zoom < 15) return 3;
  if (zoom < 16) return 2;
  return 1;
}

// Deja menos flechas según el zoom. Se usa `indice` (número de punto
// original) como referencia. El primer y el último punto se dejan siempre. La
// flecha en el medio de un tramo corto es la única de su tramo y no se quita.
export function flechasPorZoom(puntos: FeatureCollection<Point>, zoom: number): FeatureCollection<Point> {
  const paso = pasoFlechas(zoom);
  if (paso === 0) return { type: 'FeatureCollection', features: [] };
  if (paso === 1) return puntos;
  const features = puntos.features.filter((punto) => {
    if (punto.properties?.puntoMedio === true) return true;
    const indice = punto.properties?.indice;
    return typeof indice !== 'number' || indice % paso === 0;
  });
  const ultimo = puntos.features[puntos.features.length - 1];
  if (ultimo && !features.includes(ultimo)) features.push(ultimo);
  return { type: 'FeatureCollection', features };
}

// Calcula las paradas con el recorrido ya cargado, sin llamar a la API. Se
// usa si /reports/stops falla. Una racha es una serie de puntos por debajo del
// umbral de velocidad.
//  - Un punto sin velocidad usa la calculada con el anterior.
//  - Una racha con un hueco adentro se descarta: no se sabe qué pasó en el
//    hueco, así que ese tiempo no se cuenta como parada.
// La duración va del primer al último punto lento: tiempo visto, sin
// estirarlo.
export function detencionesDeRecorrido(posiciones: Posicion[], huecos: Hueco[]): Parada[] {
  const paresHueco = new Set(huecos.map((h) => `${h.desde}|${h.hasta}`));
  const detenciones: Parada[] = [];
  let primera: Posicion | null = null;
  let ultima: Posicion | null = null;
  let contaminada = false;

  const cerrarRacha = () => {
    if (primera && ultima && !contaminada) {
      const duracionMin = (milisegundos(ultima.registradoEn) - milisegundos(primera.registradoEn)) / 60000;
      if (duracionMin >= DURACION_DETENCION_MIN) {
        detenciones.push({
          inicio: primera.registradoEn,
          fin: ultima.registradoEn,
          duracionMin,
          // El marcador se ancla al primer fix detenido: es el punto donde el
          // equipo se detuvo. El promedio de la racha podría caer en otra calle
          // si las lecturas derivan durante la parada.
          latitud: primera.latitud,
          longitud: primera.longitud,
          direccion: null,
        });
      }
    }
    primera = null;
    ultima = null;
    contaminada = false;
  };

  for (let i = 0; i < posiciones.length; i += 1) {
    const posicion = posiciones[i];
    const anterior = i > 0 ? posiciones[i - 1] : null;
    // El hueco anula la racha en curso, no la siguiente: una parada después
    // de recuperar la señal sí se ve.
    if (anterior && primera && paresHueco.has(`${anterior.registradoEn}|${posicion.registradoEn}`)) contaminada = true;
    const velocidad = velocidadEfectivaKmh(posicion, anterior);
    const detenido = velocidad != null && Number.isFinite(velocidad) && velocidad < VELOCIDAD_DETENCION_KMH;
    if (!detenido) {
      cerrarRacha();
      continue;
    }
    if (!primera) primera = posicion;
    ultima = posicion;
  }
  cerrarRacha();
  return detenciones;
}

// Microparada: detención corta (40 s a 3 min) en medio de un trayecto, por
// debajo del umbral de parada. No corta viajes ni se numera: se marca aparte,
// más discreta.
export interface Microparada {
  inicio: string;
  fin: string;
  duracionS: number;
  latitud: number;
  longitud: number;
}

export const MICROPARADA_MIN_S = 40;
// Las lecturas de la detención quedan en un círculo chico alrededor de su
// centro; la precisión del fix suma holgura hasta un tope.
const RADIO_MICROPARADA_M = 20;
const HOLGURA_PRECISION_MICRO_M = 15;
// La mediana de velocidad separa una detención de una caminata lenta que por
// su corto avance cabe en el círculo (4 km/h en 40 s son 44 m).
const VELOCIDAD_MICROPARADA_KMH = 3;
// Un silencio más largo es falta de señal, no detención.
const MAX_SEPARACION_MICRO_MS = 2 * 60_000;

// Agrupa lecturas seguidas que no salen del círculo; si el grupo dura lo
// suficiente, va despacio y no está dentro de una parada, es una microparada.
// La duración va del primer al último punto del grupo.
export function microparadasDeRecorrido(posiciones: Posicion[], paradas: Parada[]): Microparada[] {
  const velocidades = velocidadesEfectivas(posiciones);
  const ventanas = paradas.map((p) => [milisegundos(p.inicio), milisegundos(p.fin)] as const);
  const resultado: Microparada[] = [];
  let i = 0;
  while (i < posiciones.length) {
    let sumaLat = posiciones[i].latitud;
    let sumaLon = posiciones[i].longitud;
    let n = 1;
    let j = i + 1;
    while (j < posiciones.length) {
      const centro = { latitud: sumaLat / n, longitud: sumaLon / n };
      const radio = RADIO_MICROPARADA_M + Math.min(posiciones[j].precisionM ?? 0, HOLGURA_PRECISION_MICRO_M);
      const separacion = milisegundos(posiciones[j].registradoEn) - milisegundos(posiciones[j - 1].registradoEn);
      if (separacion > MAX_SEPARACION_MICRO_MS || distanciaKm(centro, posiciones[j]) * 1000 > radio) break;
      sumaLat += posiciones[j].latitud;
      sumaLon += posiciones[j].longitud;
      n += 1;
      j += 1;
    }
    // Se quitan los bordes con velocidad de marcha: frenar o arrancar entra en
    // el círculo pero no es estar detenido.
    let desde = i;
    let hasta = j - 1;
    const enMarcha = (k: number) => (posiciones[k].velocidadKmh ?? 0) >= VELOCIDAD_MICROPARADA_KMH;
    while (desde < hasta && enMarcha(desde)) desde += 1;
    while (hasta > desde && enMarcha(hasta)) hasta -= 1;
    const inicio = milisegundos(posiciones[desde].registradoEn);
    const fin = milisegundos(posiciones[hasta].registradoEn);
    const duracionS = (fin - inicio) / 1000;
    const grupo = posiciones.slice(desde, hasta + 1);
    const conocidas = velocidades
      .slice(desde + 1, hasta + 1)
      .filter((v): v is number => v != null && Number.isFinite(v))
      .sort((a, b) => a - b);
    const mediana = conocidas.length > 0 ? conocidas[Math.floor(conocidas.length / 2)] : null;
    const enParada = ventanas.some(([desdeP, hastaP]) => inicio <= hastaP && desdeP <= fin);
    if (
      hasta > desde &&
      duracionS >= MICROPARADA_MIN_S &&
      duracionS < DURACION_DETENCION_MIN * 60 &&
      mediana != null &&
      mediana < VELOCIDAD_MICROPARADA_KMH &&
      !enParada
    ) {
      resultado.push({
        inicio: posiciones[desde].registradoEn,
        fin: posiciones[hasta].registradoEn,
        duracionS,
        latitud: grupo.reduce((suma, p) => suma + p.latitud, 0) / grupo.length,
        longitud: grupo.reduce((suma, p) => suma + p.longitud, 0) / grupo.length,
      });
      i = hasta + 1;
    } else {
      i += 1;
    }
  }
  return resultado;
}

// Duración corta legible: "45 s", "1 min 20 s". duracion() de formatoBase
// redondea a minutos y una microparada de 50 s saldría "0 min".
export function duracionCorta(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

// Velocidad derivada del punto seleccionado: distancia/tiempo entre el fix
// anterior y el siguiente. Con ambos extremos el cálculo queda centrado en el
// punto y filtra mejor el ruido del GPS; en los extremos del recorrido solo
// existe un segmento posible.
export function velocidadDerivadaKmh(posiciones: Posicion[], indice: number): number | null {
  const actual = posiciones[indice];
  if (!actual) return null;
  const anterior = indice > 0 ? posiciones[indice - 1] : null;
  const siguiente = indice < posiciones.length - 1 ? posiciones[indice + 1] : null;
  const desde = anterior ?? actual;
  const hasta = siguiente ?? actual;
  if (desde === hasta) return null;
  const horas = (milisegundos(hasta.registradoEn) - milisegundos(desde.registradoEn)) / 3600000;
  if (!(horas > 0)) return null;
  return distanciaKm(desde, hasta) / horas;
}

// Batería alineada con las posiciones: null donde el punto no trae porcentaje,
// para que el gráfico deje el hueco en vez de inventar valores.
export function serieBateria(posiciones: Posicion[]): (number | null)[] {
  return posiciones.map((posicion) =>
    posicion.bateriaPct == null || !Number.isFinite(posicion.bateriaPct) ? null : posicion.bateriaPct,
  );
}

// Índice del último valor de batería conocido hasta el pedido. El punto del
// reproductor se ancla ahí para no despegarse de la línea; -1 si no hay dato.
export function indiceBateriaConocida(serie: (number | null)[], indice: number): number {
  for (let i = Math.min(indice, serie.length - 1); i >= 0; i -= 1) {
    if (serie[i] != null) return i;
  }
  return -1;
}

export function aColeccion(segmentos: SegmentoRecorrido[]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: segmentos.map((segmento) => ({
      type: 'Feature',
      properties: {
        tipo: segmento.tipo,
        ...(segmento.banda == null ? {} : { banda: segmento.banda }),
        ...(segmento.modo == null ? {} : { modo: segmento.modo }),
        ...(segmento.instante == null ? {} : { instante: segmento.instante }),
      },
      geometry: { type: 'LineString', coordinates: segmento.coordenadas },
    })),
  };
}

// Búsqueda binaria: índice del último punto cuya hora no pasa la pedida. Así
// la reproducción no recorre todas las posiciones en cada paso.
export function indicePorInstante(posiciones: Posicion[], instante: number): number {
  let bajo = 0;
  let alto = posiciones.length - 1;
  while (bajo < alto) {
    const medio = Math.ceil((bajo + alto) / 2);
    if (milisegundos(posiciones[medio].registradoEn) <= instante) bajo = medio;
    else alto = medio - 1;
  }
  return bajo;
}

// Distancia máxima para que un clic cuente sobre la ruta; más lejos es un clic
// en el mapa. 250 m cubre toda la franja pulsable de la línea.
const RADIO_SELECCION_M = 250;

// Punto más cercano al lugar pulsado sobre la ruta. El clic cae entre dos
// puntos y se elige el más próximo; si ninguno está cerca, null.
export function indiceMasCercano(posiciones: Posicion[], lng: number, lat: number): number | null {
  let mejorIndice: number | null = null;
  let mejorDistanciaKm = Infinity;
  for (let i = 0; i < posiciones.length; i += 1) {
    const posicion = posiciones[i];
    if (!Number.isFinite(posicion.latitud) || !Number.isFinite(posicion.longitud)) continue;
    const distancia = distanciaKm({ latitud: lat, longitud: lng }, posicion);
    if (distancia < mejorDistanciaKm) {
      mejorDistanciaKm = distancia;
      mejorIndice = i;
    }
  }
  if (mejorIndice == null || mejorDistanciaKm * 1000 > RADIO_SELECCION_M) return null;
  return mejorIndice;
}

// Punto más cercano en el tiempo a una hora, si esa hora cae dentro del tramo
// cargado. Los marcadores de jornada solo traen hora; fuera del tramo no hay
// coordenada y se devuelve null.
export function indiceCercaDeInstante(posiciones: Posicion[], instante: number): number | null {
  if (posiciones.length === 0) return null;
  const inicio = milisegundos(posiciones[0].registradoEn);
  const fin = milisegundos(posiciones[posiciones.length - 1].registradoEn);
  if (instante < inicio || instante > fin) return null;
  const indice = indicePorInstante(posiciones, instante);
  const anterior = posiciones[indice];
  const siguiente = posiciones[indice + 1];
  if (!siguiente) return indice;
  const distanciaAnterior = instante - milisegundos(anterior.registradoEn);
  const distanciaSiguiente = milisegundos(siguiente.registradoEn) - instante;
  return distanciaSiguiente < distanciaAnterior ? indice + 1 : indice;
}

// Posición del marcador para cualquier momento: se interpola entre el punto
// anterior y el siguiente para que la reproducción se vea fluida. En los
// huecos (o saltos de más de 5 min, o tramos reconstruidos) se queda en el
// último punto conocido: una recta inventaría el recorrido.
// Punto del trazado de un tramo según el tiempo transcurrido (a velocidad
// pareja).
function puntoSobreTrazado(tramo: TramoReconstruido, instante: number): { latitud: number; longitud: number } | null {
  const puntos = tramo.trazado.filter(
    (par): par is [number, number] => Array.isArray(par) && Number.isFinite(par[0]) && Number.isFinite(par[1]),
  );
  if (puntos.length < 2) return null;
  const inicio = milisegundos(tramo.desde);
  const fin = milisegundos(tramo.hasta);
  const fraccion = fin > inicio ? Math.min(Math.max((instante - inicio) / (fin - inicio), 0), 1) : 0;
  const largos: number[] = [];
  let total = 0;
  for (let i = 1; i < puntos.length; i += 1) {
    const largo = distanciaKm(
      { latitud: puntos[i - 1][1], longitud: puntos[i - 1][0] },
      { latitud: puntos[i][1], longitud: puntos[i][0] },
    );
    largos.push(largo);
    total += largo;
  }
  if (!(total > 0)) return { latitud: puntos[0][1], longitud: puntos[0][0] };
  let objetivo = fraccion * total;
  for (let i = 0; i < largos.length; i += 1) {
    if (objetivo <= largos[i] || i === largos.length - 1) {
      const t = largos[i] > 0 ? Math.min(objetivo / largos[i], 1) : 0;
      const [lonA, latA] = puntos[i];
      const [lonB, latB] = puntos[i + 1];
      return { latitud: latA + (latB - latA) * t, longitud: lonA + (lonB - lonA) * t };
    }
    objetivo -= largos[i];
  }
  return null;
}

export function puntoEnInstante(
  posiciones: Posicion[],
  huecos: Hueco[],
  instante: number,
  reconstruidos: TramoReconstruido[] = [],
): { latitud: number; longitud: number } | null {
  // Dentro de un tramo reconstruido (ajustado a calles o estimado) el marcador
  // avanza sobre su trazado, que es lo que se dibuja: interpolar recto entre
  // los fixes crudos lo sacaba de la línea.
  const tramo = reconstruidos.find(
    (t) =>
      Array.isArray(t.trazado) &&
      t.trazado.length >= 2 &&
      milisegundos(t.desde) <= instante &&
      instante <= milisegundos(t.hasta),
  );
  if (tramo) {
    const enTrazado = puntoSobreTrazado(tramo, instante);
    if (enTrazado) return enTrazado;
  }
  const indice = indicePorInstante(posiciones, instante);
  const actual = posiciones[indice];
  if (!actual) return null;
  const siguiente = posiciones[indice + 1] ?? null;
  if (!siguiente) return { latitud: actual.latitud, longitud: actual.longitud };
  const desde = milisegundos(actual.registradoEn);
  const hasta = milisegundos(siguiente.registradoEn);
  const esHueco = huecos.some((hueco) => hueco.desde === actual.registradoEn && hueco.hasta === siguiente.registradoEn);
  if (esHueco || hasta - desde > ANTIGUEDAD_SIN_SENAL_MS || !(hasta > desde)) {
    return { latitud: actual.latitud, longitud: actual.longitud };
  }
  const fraccion = Math.min(Math.max((instante - desde) / (hasta - desde), 0), 1);
  return {
    latitud: actual.latitud + (siguiente.latitud - actual.latitud) * fraccion,
    longitud: actual.longitud + (siguiente.longitud - actual.longitud) * fraccion,
  };
}

// Estado del punto actual para el color del marcador, en este orden:
//  1. Cae dentro de un hueco: sin señal.
//  2. El siguiente punto llega más de 5 min después: sin señal.
//  3. Es el último y tiene más de 5 min contra la hora real: sin señal.
//  4. Va más lento que el umbral: detenido; si no, en movimiento.
export function estadoDePunto(
  posiciones: Posicion[],
  huecos: Hueco[],
  indice: number,
  ahora = Date.now(),
  finRangoMs: number | null = null,
): EstadoUnidad {
  // Para un día pasado, "ahora" es el fin del rango; si no, el último punto
  // de cualquier día viejo saldría siempre "Sin señal".
  const referencia = finRangoMs != null ? Math.min(ahora, finRangoMs) : ahora;
  const posicion = posiciones[indice];
  if (!posicion) return 'sinSenal';
  const instante = milisegundos(posicion.registradoEn);
  if (huecos.some((hueco) => instante > milisegundos(hueco.desde) && instante < milisegundos(hueco.hasta))) {
    return 'sinSenal';
  }
  const siguiente = posiciones[indice + 1] ?? null;
  if (siguiente) {
    if (milisegundos(siguiente.registradoEn) - instante > ANTIGUEDAD_SIN_SENAL_MS) return 'sinSenal';
  } else if (referencia - instante > ANTIGUEDAD_SIN_SENAL_MS) {
    return 'sinSenal';
  }
  const anterior = indice > 0 ? posiciones[indice - 1] : null;
  const velocidad = velocidadEfectivaKmh(posicion, anterior);
  if (velocidad != null && Number.isFinite(velocidad) && velocidad < VELOCIDAD_DETENCION_KMH) return 'detencion';
  return 'movimiento';
}

// Viaje: el tramo del día entre dos paradas. El Replay lista los viajes y al
// elegir uno lo resalta y atenúa el resto; así un día con decenas de idas y
// vueltas por las mismas calles se lee de a un viaje.
export interface Viaje {
  indice: number;
  inicio: string;
  fin: string;
  distanciaKm: number;
  puntos: number;
}

// Viajes entre paradas seguidas (y antes de la primera o después de la
// última, si hay puntos). Un intervalo sin puntos no es un viaje.
export function viajesEntreParadas(posiciones: Posicion[], paradas: Parada[]): Viaje[] {
  if (posiciones.length < 2) return [];
  const ordenadas = [...paradas].sort((a, b) => milisegundos(a.inicio) - milisegundos(b.inicio));
  const primero = milisegundos(posiciones[0].registradoEn);
  const ultimo = milisegundos(posiciones[posiciones.length - 1].registradoEn);
  const intervalos: [number, number][] = [];
  let cursor = primero;
  for (const parada of ordenadas) {
    const inicio = milisegundos(parada.inicio);
    if (inicio > cursor) intervalos.push([cursor, inicio]);
    cursor = Math.max(cursor, milisegundos(parada.fin));
  }
  if (ultimo > cursor) intervalos.push([cursor, ultimo]);
  const viajes: Viaje[] = [];
  for (const [desde, hasta] of intervalos) {
    let metros = 0;
    let puntos = 0;
    let anterior: Posicion | null = null;
    for (const posicion of posiciones) {
      const instante = milisegundos(posicion.registradoEn);
      if (instante < desde || instante > hasta) continue;
      if (anterior) metros += distanciaKm(anterior, posicion) * 1000;
      anterior = posicion;
      puntos += 1;
    }
    // Menos de 100 m o de 2 puntos es temblor junto a la parada, no un viaje.
    if (puntos < 2 || metros < 100) continue;
    viajes.push({
      indice: viajes.length,
      inicio: new Date(desde).toISOString(),
      fin: new Date(hasta).toISOString(),
      distanciaKm: metros / 1000,
      puntos,
    });
  }
  return viajes;
}

// Índice del viaje que contiene el instante, o -1 si cae en una parada.
export function viajeDeInstante(viajes: Viaje[], instante: number): number {
  for (const viaje of viajes) {
    if (instante >= milisegundos(viaje.inicio) && instante < milisegundos(viaje.fin)) return viaje.indice;
  }
  return -1;
}
