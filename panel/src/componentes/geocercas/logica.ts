// Lógica de geocercas sin dependencias del panel, para probarla sin navegador.
// Los tipos siguen el contrato de /api/v1/geocercas.

import type { Geocerca, TipoGeocerca, VisitasGeocerca } from '@contratos';
import type { EntradaHistorialGeocerca as EntradaHistorial } from '@contratos';
import { milisegundos } from '../../dominio/replay.ts';

// Los tipos vienen del contrato; aquí solo se reexportan para los componentes.
export type { EntradaHistorialGeocerca as EntradaHistorial, Geocerca, TipoGeocerca, VisitaGeocerca, VisitasGeocerca } from '@contratos';
export type Punto = [number, number]; // [lon, lat]

export const TIPOS: readonly { valor: TipoGeocerca; etiqueta: string; color: string }[] = [
  { valor: 'casa', etiqueta: 'Casa', color: '#16a34a' },
  { valor: 'cliente', etiqueta: 'Cliente', color: '#2563eb' },
  { valor: 'oficina', etiqueta: 'Oficina', color: '#d97706' },
  { valor: 'cc', etiqueta: 'C.C.', color: '#9333ea' },
  { valor: 'pdv', etiqueta: 'PDV', color: '#db2777' },
  { valor: 'na', etiqueta: 'N/A', color: '#64748b' },
];

export function etiquetaTipo(tipo: string): string {
  return TIPOS.find((t) => t.valor === tipo)?.etiqueta ?? '—';
}

export function colorTipo(tipo: string): string {
  return TIPOS.find((t) => t.valor === tipo)?.color ?? '#64748b';
}

const ACCIONES: Record<EntradaHistorial['accion'], string> = {
  crear: 'Creó',
  editar: 'Editó',
  eliminar: 'Dio de baja',
  restaurar: 'Restauró',
};

export function etiquetaAccion(accion: string): string {
  return ACCIONES[accion as EntradaHistorial['accion']] ?? '—';
}

// Ray casting; el borde cuenta como dentro de forma indiferente.
export function puntoEnPoligono(lon: number, lat: number, puntos: readonly Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const [xi, yi] = puntos[i];
    const [xj, yj] = puntos[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// Geocerca donde cae una parada. Si varias la contienen gana la de centro más
// cercano (distancia plana: basta a escala de una manzana).
export function geocercaDeParada(
  parada: { latitud: number; longitud: number },
  geocercas: readonly Geocerca[],
): Geocerca | null {
  let mejor: Geocerca | null = null;
  let mejorD = Infinity;
  for (const g of geocercas) {
    if (!g.activo || !puntoEnPoligono(parada.longitud, parada.latitud, g.puntos)) continue;
    const d = (g.centro.lon - parada.longitud) ** 2 + (g.centro.lat - parada.latitud) ** 2;
    if (d < mejorD) {
      mejor = g;
      mejorD = d;
    }
  }
  return mejor;
}

const ms = (iso: string) => new Date(iso).getTime();
// Para rotular una parada: lecturas precisas adentro y fracción mínima de sus lecturas.
const MIN_PUNTOS_ROTULO = 3;
const FRACCION_ROTULO = 0.2;
const PRECISION_ROTULO_M = 50;

// El centro de una parada es el promedio de sus puntos: si el GPS se va a la
// calle buena parte del rato (bajo techo, en un centro comercial), cae fuera
// de la geocerca aunque la persona estuvo adentro. Cuenta como adentro si al
// menos una quinta parte de sus puntos cae en la geocerca, y la parada se
// muestra en el centro de esos puntos.
export function ubicarEnGeocerca<P extends { inicio: string; fin: string; latitud: number; longitud: number }>(
  parada: P,
  posiciones: readonly { registradoEn: string; latitud: number; longitud: number; precisionM?: number | null }[],
  geocercas: readonly Geocerca[],
): { parada: P; geocerca: Geocerca } | null {
  const directa = geocercaDeParada(parada, geocercas);
  // Las posiciones vienen en orden de hora: el tramo de la parada se busca por
  // bisección (con 25 000 puntos, recorrerlas todas por parada congelaba).
  const [a, b] = [ms(parada.inicio), ms(parada.fin)];
  let lo = 0;
  let hi = posiciones.length;
  while (lo < hi) {
    const medio = (lo + hi) >> 1;
    if (milisegundos(posiciones[medio].registradoEn) < a) lo = medio + 1;
    else hi = medio;
  }
  const puntos: typeof posiciones[number][] = [];
  for (let i = lo; i < posiciones.length && milisegundos(posiciones[i].registradoEn) <= b; i += 1) puntos.push(posiciones[i]);
  // Un rótulo afirma dónde estuvo: hacen falta lecturas con precisión usable
  // adentro (un centro que cae adentro con puras lecturas de antena no basta)
  // y, si el centro no cae, que sean una parte real de las lecturas.
  const respalda = (adentro: typeof puntos, conFraccion: boolean) => {
    const buenos = adentro.filter((p) => (p.precisionM ?? 0) <= PRECISION_ROTULO_M);
    return buenos.length >= MIN_PUNTOS_ROTULO && (!conFraccion || adentro.length >= FRACCION_ROTULO * puntos.length);
  };
  if (directa && (puntos.length === 0 || respalda(puntos.filter((p) => puntoEnPoligono(p.longitud, p.latitud, directa.puntos)), false))) return { parada, geocerca: directa };
  let mejor: { parada: P; geocerca: Geocerca; n: number } | null = null;
  for (const g of geocercas) {
    if (!g.activo) continue;
    const adentro = puntos.filter((p) => puntoEnPoligono(p.longitud, p.latitud, g.puntos));
    if (!respalda(adentro, true) || (mejor && adentro.length <= mejor.n)) continue;
    const latitud = adentro.reduce((s, p) => s + p.latitud, 0) / adentro.length;
    const longitud = adentro.reduce((s, p) => s + p.longitud, 0) / adentro.length;
    mejor = { parada: { ...parada, latitud, longitud }, geocerca: g, n: adentro.length };
  }
  return mejor && { parada: mejor.parada, geocerca: mejor.geocerca };
}

// Llegadas con la más reciente primero; salidas con la más temprana primero.
export function ordenarLlegadas(lista: readonly string[]): string[] {
  return [...lista].sort((a, b) => ms(b) - ms(a));
}
export function ordenarSalidas(lista: readonly string[]): string[] {
  return [...lista].sort((a, b) => ms(a) - ms(b));
}

export function resumenVisitas(v: VisitasGeocerca): { llegadas: string[]; salidas: string[]; salio: string | null; llego: string | null } {
  const llegadas = ordenarLlegadas(v.llegadas);
  const salidas = ordenarSalidas(v.salidas);
  return { llegadas, salidas, salio: salidas[0] ?? null, llego: llegadas[0] ?? null };
}

// Las visitas del servidor se leen junto con las paradas del recorrido:
//  - Bajo techo el GPS salta a la calle con buena precisión y la geocerca
//    contaba una salida y una vuelta. Si la parada siguió sin cortarse en
//    esta geocerca, no salió: las dos visitas son una.
//  - La parada marca cuándo se detuvo y cuándo arrancó; el borde de la
//    geocerca llega tarde si el GPS cae afuera al entrar. La llegada es la
//    más temprana de las dos y la salida la más tardía.
//  - Una parada en la geocerca sin visita del servidor es una visita.
type ParadaUbicada = { inicio: string; fin: string; latitud: number; longitud: number };
type Lectura = { registradoEn: string; latitud: number; longitud: number; precisionM?: number | null };

// Llegó/Salió dicen que estuvo en la geocerca: solo cuenta el rato de la
// parada con lecturas de 50 m o mejor dentro de ella o a 60 m de su borde (el
// GPS cae en la vereda al entrar). La parada de Quicentro Norte de Miriam
// (23/10) empezaba a las 13:57 y la primera lectura cerca fue a las 19:02.
const EVIDENCIA_PRECISION_M = 50;
const EVIDENCIA_BORDE_M = 60;

function distanciaAlBordeM(lon: number, lat: number, puntos: readonly Punto[]): number {
  if (puntoEnPoligono(lon, lat, puntos)) return 0;
  const escala = 111_320 * Math.cos((lat * Math.PI) / 180);
  let minimo = Infinity;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const [ax, ay] = [(puntos[j][0] - lon) * escala, (puntos[j][1] - lat) * 111_320];
    const [bx, by] = [(puntos[i][0] - lon) * escala, (puntos[i][1] - lat) * 111_320];
    const largo2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const f = largo2 > 0 ? Math.min(Math.max(-(ax * (bx - ax) + ay * (by - ay)) / largo2, 0), 1) : 0;
    minimo = Math.min(minimo, Math.hypot(ax + (bx - ax) * f, ay + (by - ay) * f));
  }
  return minimo;
}

function conEvidencia<P extends ParadaUbicada>(p: P, g: Geocerca, lecturas: readonly Lectura[] | undefined): P {
  if (!lecturas) return p;
  const [a, b] = [ms(p.inicio), ms(p.fin)];
  const cerca = lecturas.filter((q) => {
    const t = milisegundos(q.registradoEn);
    return t >= a && t <= b && (q.precisionM ?? 0) <= EVIDENCIA_PRECISION_M && distanciaAlBordeM(q.longitud, q.latitud, g.puntos) <= EVIDENCIA_BORDE_M;
  });
  if (cerca.length === 0) return p;
  return { ...p, inicio: cerca[0].registradoEn, fin: cerca[cerca.length - 1].registradoEn };
}
const minutos = (a: string | null, b: string | null) => (a && b ? Math.round((ms(b) - ms(a)) / 6000) / 10 : null);

export function visitasSegunParadas(
  v: VisitasGeocerca,
  paradas: readonly ParadaUbicada[],
  geocercas: readonly Geocerca[],
  lecturas?: readonly Lectura[],
): VisitasGeocerca {
  const g = geocercas.find((x) => x.id === v.geocercaId);
  const propias = paradas
    .filter((p) => geocercaDeParada(p, geocercas)?.id === v.geocercaId)
    .map((p) => (g ? conEvidencia(p, g, lecturas) : p));
  if (propias.length === 0) return v;
  const enParada = (a: string, b: string) => propias.some((p) => ms(p.inicio) <= ms(a) && ms(b) <= ms(p.fin));
  let visitas: VisitasGeocerca['visitas'] = [];
  for (const x of v.visitas) {
    const previa = visitas[visitas.length - 1];
    if (previa?.salida && x.llegada && enParada(previa.salida, x.llegada)) {
      visitas[visitas.length - 1] = { llegada: previa.llegada, salida: x.salida, duracionMin: minutos(previa.llegada, x.salida) };
    } else visitas.push({ ...x });
  }
  for (const p of propias) {
    const [a, b] = [ms(p.inicio), ms(p.fin)];
    const tocan = visitas.filter((x) => (x.llegada == null || ms(x.llegada) <= b) && (x.salida == null || ms(x.salida) >= a));
    if (tocan.length === 0) {
      visitas.push({ llegada: p.inicio, salida: p.fin, duracionMin: minutos(p.inicio, p.fin) });
      continue;
    }
    const [primera, ultima] = [tocan[0], tocan[tocan.length - 1]];
    if (primera.llegada && a < ms(primera.llegada)) primera.llegada = p.inicio;
    if (ultima.salida && b > ms(ultima.salida)) ultima.salida = p.fin;
  }
  visitas = visitas
    .map((x) => ({ ...x, duracionMin: minutos(x.llegada, x.salida) }))
    .sort((x, y) => (x.llegada == null ? -1 : y.llegada == null ? 1 : ms(x.llegada) - ms(y.llegada)));
  return {
    ...v,
    visitas,
    llegadas: ordenarLlegadas(visitas.flatMap((x) => (x.llegada ? [x.llegada] : []))),
    salidas: ordenarSalidas(visitas.flatMap((x) => (x.salida ? [x.salida] : []))),
  };
}

// Geocercas con paradas que el servidor no vio como visita (el GPS no llegó a
// entrar el rato que exige): salen solo de sus paradas.
export function geocercasSoloPorParadas(
  vistas: readonly VisitasGeocerca[],
  paradas: readonly ParadaUbicada[],
  geocercas: readonly Geocerca[],
  lecturas?: readonly Lectura[],
): VisitasGeocerca[] {
  const ids = new Set(vistas.map((v) => v.geocercaId));
  const nuevas = new Map<number, VisitasGeocerca>();
  for (const p of paradas) {
    const g = geocercaDeParada(p, geocercas);
    if (!g || ids.has(g.id) || nuevas.has(g.id)) continue;
    nuevas.set(g.id, visitasSegunParadas({ geocercaId: g.id, nombre: g.nombre, tipo: g.tipo, llegadas: [], salidas: [], visitas: [] }, paradas, geocercas, lecturas));
  }
  return [...nuevas.values()];
}

// Día visto desde el domicilio: la primera salida, la última llegada y las
// veces que volvió en el medio (a almorzar, por ejemplo). Estar adentro al
// empezar el día no es una llegada.
export function resumenDomicilio(v: VisitasGeocerca): {
  salio: string | null;
  llego: string | null;
  regresos: { llegada: string | null; salida: string | null; duracionMin: number | null }[];
} {
  const salio = ordenarSalidas(v.salidas)[0] ?? null;
  // Sin una salida vista (el teléfono no dio datos al salir) cuenta toda
  // llegada vista; con una, solo las posteriores a ella.
  const conLlegada = v.visitas.filter((x) => x.llegada != null);
  // Por hora y no por texto: unas llegan con "Z" y otras con "+00:00".
  const regresos = salio == null ? conLlegada : conLlegada.filter((x) => x.llegada != null && ms(x.llegada) > ms(salio));
  return { salio, llego: regresos.length > 0 ? regresos[regresos.length - 1].llegada : null, regresos };
}

export interface ErroresFormulario {
  nombre?: string;
  quien?: string;
  tipo?: string;
}

export function validarFormulario(f: { nombre: string; quien: string; tipo: string }): ErroresFormulario {
  const e: ErroresFormulario = {};
  const nombre = f.nombre.trim();
  if (!nombre) e.nombre = 'Escribe el nombre de la geocerca.';
  else if (nombre.length > 120) e.nombre = 'El nombre es muy largo (máximo 120 letras).';
  if (!f.quien.trim()) e.quien = 'Indica quién hace este cambio.';
  else if (f.quien.trim().length > 120) e.quien = 'El nombre es muy largo (máximo 120 letras).';
  if (!TIPOS.some((t) => t.valor === f.tipo)) e.tipo = 'Elige el tipo.';
  return e;
}

// Devuelve un mensaje si el polígono no sirve, o null si está bien.
export function errorDePuntos(puntos: readonly Punto[]): string | null {
  if (puntos.length < 3) return 'La geocerca necesita al menos 3 puntos.';
  if (puntos.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 90 || Math.abs(x) > 180))
    return 'Hay un punto con coordenadas inválidas.';
  let area = 0;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) area += puntos[j][0] * puntos[i][1] - puntos[i][0] * puntos[j][1];
  return Math.abs(area) < 1e-12 ? 'Los puntos están en línea: dibuja un área.' : null;
}

// Cuenta como "clic sobre el mismo punto" si queda a menos de `px` píxeles.
export function esMismoPunto(a: { x: number; y: number }, b: { x: number; y: number }, px: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < px;
}
