// Recorrido guiado: lo ya recorrido se pinta con el color de su hora y lo que
// falta queda atenuado. Cada línea con hora se dibuja con un degradado que
// depende del avance (`line-progress`): para mostrar hasta el marcador solo
// se mueve el corte del degradado, así el final de la línea sólida coincide
// con el círculo en cada cuadro, sin pedirle datos nuevos al mapa.
//
// Sin imports del panel para poder probarlo con node.

export interface PuntoGuia {
  lon: number;
  lat: number;
  t: number;
}

export interface LineaGuia {
  // Distancia acumulada hasta cada vértice (m) y total.
  acumulada: number[];
  total: number;
  // Color de la hora en puntos repartidos de la línea: [avance 0-1, color].
  colores: [number, string][];
}

const TRANSPARENTE = 'rgba(0,0,0,0)';
const BLANCO = '#ffffff';
const MAX_COLORES = 48;
// Separación mínima entre dos cortes del degradado: las paradas deben crecer.
const EPS = 1e-6;

// Tono de la hora: claro al empezar el día, oscuro al terminar (mismo que
// COLOR_POR_HORA del mapa).
const RAMPA: [number, [number, number, number]][] = [
  [0, [0x5b, 0x8f, 0xd0]],
  [0.5, [0x2c, 0x5b, 0x99]],
  [1, [0x0b, 0x25, 0x45]],
];

export function colorDeHora(f: number): string {
  const x = Math.min(Math.max(f, 0), 1);
  const k = x <= RAMPA[1][0] ? 0 : 1;
  const [a, ca] = RAMPA[k];
  const [b, cb] = RAMPA[k + 1];
  const u = (x - a) / (b - a);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function metros(a: PuntoGuia, b: PuntoGuia): number {
  const dLat = (b.lat - a.lat) * 111320;
  const dLon = (b.lon - a.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

export function prepararGuia(linea: PuntoGuia[], primero: number, ultimo: number): LineaGuia {
  const acumulada = [0];
  for (let k = 1; k < linea.length; k += 1) acumulada.push(acumulada[k - 1] + metros(linea[k - 1], linea[k]));
  const total = acumulada[acumulada.length - 1];
  const fraccion = (t: number) => (ultimo > primero ? (t - primero) / (ultimo - primero) : 1);
  const paso = Math.max(1, Math.ceil(linea.length / MAX_COLORES));
  const colores: [number, string][] = [];
  for (let k = 0; k < linea.length; k += paso) pushColor(colores, total > 0 ? acumulada[k] / total : 0, colorDeHora(fraccion(linea[k].t)));
  pushColor(colores, 1, colorDeHora(fraccion(linea[linea.length - 1].t)));
  return { acumulada, total, colores };
}

function pushColor(lista: [number, string][], p: number, color: string): void {
  const ultimo = lista[lista.length - 1];
  if (ultimo && p <= ultimo[0]) return;
  lista.push([p, color]);
}

// Avance (0 a 1) de la línea en el instante t: 0 si aún no empieza, 1 si ya
// terminó, y la distancia recorrida sobre el total entre medias.
export function progresoEn(linea: PuntoGuia[], guia: LineaGuia, t: number): number {
  if (t <= linea[0].t) return 0;
  if (t >= linea[linea.length - 1].t) return 1;
  if (!(guia.total > 0)) return 1;
  let bajo = 0;
  let alto = linea.length - 1;
  while (bajo < alto - 1) {
    const medio = (bajo + alto) >> 1;
    if (linea[medio].t <= t) bajo = medio;
    else alto = medio;
  }
  const a = linea[bajo];
  const b = linea[alto];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return (guia.acumulada[bajo] + (guia.acumulada[alto] - guia.acumulada[bajo]) * f) / guia.total;
}

// Degradado (expresión de `line-gradient`) con color hasta el avance p y
// transparente desde ahí. `solido` pinta todo el recorrido hecho de un color
// (el borde blanco de la línea).
export function gradienteHasta(guia: LineaGuia, p: number, solido?: string): unknown[] {
  const cabeza = ['interpolate', ['linear'], ['line-progress']] as unknown[];
  if (p <= 0) return [...cabeza, 0, TRANSPARENTE, 1, TRANSPARENTE];
  const colores: [number, string][] = solido ? [[0, solido], [1, solido]] : guia.colores;
  if (p >= 1) return [...cabeza, ...colores.flat()];
  const salida: [number, string][] = colores.filter(([q]) => q < p);
  const siguiente = colores.find(([q]) => q >= p) ?? colores[colores.length - 1];
  const previo = salida[salida.length - 1] ?? colores[0];
  salida.push([p, solido ?? (previo ? interpolar(previo, siguiente, p) : siguiente[1])]);
  salida.push([Math.min(p + EPS, 1 - EPS / 2), TRANSPARENTE]);
  salida.push([1, TRANSPARENTE]);
  return [...cabeza, ...salida.flat()];
}

// Color entre dos paradas del degradado (sirve para no saltar de tono en el corte).
function interpolar(a: [number, string], b: [number, string], p: number): string {
  if (b[0] <= a[0]) return b[1];
  const u = Math.min(Math.max((p - a[0]) / (b[0] - a[0]), 0), 1);
  const ca = a[1].match(/\d+/g)!.map(Number);
  const cb = b[1].match(/\d+/g)!.map(Number);
  return `rgb(${ca.map((v, i) => Math.round(v + (cb[i] - v) * u)).join(',')})`;
}

export { BLANCO };
