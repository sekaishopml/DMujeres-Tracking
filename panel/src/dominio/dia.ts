// El día de una persona contado como lo vive: qué lugares visita y cuánto del
// recorrido se vio. Todo sale de lo
// registrado (paradas, puntos y cortes de señal); lo que no se puede afirmar
// queda en null y el panel lo muestra como "—".
//
// Sin imports del panel para poder probarlo con node.

export interface ParadaDia {
  inicio: string;
  fin: string;
  duracionMin: number;
  latitud: number;
  longitud: number;
  direccion?: string | null;
}

export interface HuecoDia {
  desde: string;
  hasta: string;
  duracionSegundos: number;
  motivo?: string | null;
}

export interface FixDia {
  registradoEn: string;
  latitud: number;
  longitud: number;
}

export interface ResumenDia {
  // Número de visita (1, 2, 3…) de cada parada, en el orden en que se pasaron.
  numeroVisita: (number | null)[];
  visitas: number;
  cobertura: Cobertura;
}

export interface Cobertura {
  // 0 a 100; null si no hay tiempo que medir.
  porcentaje: number | null;
  cortes: number;
  sinSenalSegundos: number;
  mayorCorteSegundos: number;
}

// Dos paradas seguidas a menos de esto cuentan como la misma visita.
export const RADIO_MISMA_VISITA_M = 150;

const ms = (iso: string) => new Date(iso).getTime();

export function distanciaM(a: { latitud: number; longitud: number }, b: { latitud: number; longitud: number }): number {
  const dLat = (b.latitud - a.latitud) * 111320;
  const dLon = (b.longitud - a.longitud) * 111320 * Math.cos(((a.latitud + b.latitud) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

export function coberturaDe(posiciones: readonly FixDia[], huecos: readonly HuecoDia[]): Cobertura {
  const vacia: Cobertura = { porcentaje: null, cortes: 0, sinSenalSegundos: 0, mayorCorteSegundos: 0 };
  if (posiciones.length < 2) return vacia;
  const desde = ms(posiciones[0].registradoEn);
  const hasta = ms(posiciones[posiciones.length - 1].registradoEn);
  let fuera = 0;
  let sinSenal = 0;
  let cortes = 0;
  let mayor = 0;
  for (const hueco of huecos) {
    const a = Math.max(ms(hueco.desde), desde);
    const b = Math.min(ms(hueco.hasta), hasta);
    if (!(b > a)) continue;
    const segundos = (b - a) / 1000;
    // Entre dos jornadas no se registra a propósito: no es un corte.
    if (hueco.motivo === 'FUERA_DE_JORNADA') {
      fuera += segundos;
      continue;
    }
    sinSenal += segundos;
    cortes += 1;
    mayor = Math.max(mayor, segundos);
  }
  const medible = (hasta - desde) / 1000 - fuera;
  if (!(medible > 0)) return vacia;
  const porcentaje = Math.min(100, Math.max(0, (1 - sinSenal / medible) * 100));
  return { porcentaje, cortes, sinSenalSegundos: Math.round(sinSenal), mayorCorteSegundos: Math.round(mayor) };
}

export function resumenDia(entrada: {
  posiciones: readonly FixDia[];
  paradas: readonly ParadaDia[];
  huecos: readonly HuecoDia[];
}): ResumenDia {
  const { posiciones, paradas, huecos } = entrada;
  const cobertura = coberturaDe(posiciones, huecos);
  if (posiciones.length === 0 || paradas.length === 0) {
    return { numeroVisita: paradas.map(() => null), visitas: 0, cobertura };
  }
  // Paradas seguidas en el mismo lugar (el GPS corta una estancia larga en
  // varias) son una sola visita.
  const numeroVisita: (number | null)[] = [];
  let visitas = 0;
  paradas.forEach((parada, i) => {
    const anterior = i > 0 ? paradas[i - 1] : null;
    numeroVisita.push(anterior && distanciaM(parada, anterior) <= RADIO_MISMA_VISITA_M ? numeroVisita[i - 1] : (visitas += 1));
  });
  return { numeroVisita, visitas, cobertura };
}

// Cómo se nombra cada parada en la lista, el mapa y la pista.
export function etiquetaVisita(numeroVisita: number | null): string {
  return numeroVisita != null ? `Visita ${numeroVisita}` : 'Visita';
}
