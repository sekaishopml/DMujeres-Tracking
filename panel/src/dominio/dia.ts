// El día de una persona contado como lo vive: de dónde sale, cuándo llega a la
// oficina, qué lugares visita y cuánto del recorrido se vio. Todo sale de lo
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

export interface LugarOficina {
  latitud: number;
  longitud: number;
  radioM: number;
}

// Qué es cada parada del día.
//  - casa: donde empezó el registro (la estancia de partida).
//  - regreso: vuelve a ese mismo lugar después de haber salido.
//  - oficina: dentro del radio de la oficina.
//  - visita: cualquier otro lugar.
export type RolParada = 'casa' | 'regreso' | 'oficina' | 'visita';

export interface ResumenDia {
  // Un rol por parada, en el mismo orden en que se pasaron.
  roles: RolParada[];
  // Número de visita (1, 2, 3…) de cada parada; null si no es una visita.
  numeroVisita: (number | null)[];
  salidaCasa: string | null;
  llegadaOficina: string | null;
  salidaOficina: string | null;
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

// La partida cuenta como "casa" si el registro empieza dentro de las primeras
// paradas y esa estancia dura al menos esto: un teléfono que arranca en plena
// calle no es una casa.
export const CASA_MIN_MINUTOS = 10;
// Volver a "casa" es volver a menos de esto del lugar de partida.
export const RADIO_CASA_M = 150;
// Dos paradas seguidas a menos de esto cuentan como la misma visita.
export const RADIO_MISMA_VISITA_M = 150;
// Una parada que sigue abierta al final de los datos no tiene salida todavía.
const SIGUE_ALLI_MS = 60_000;

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
  oficina: LugarOficina | null;
}): ResumenDia {
  const { posiciones, paradas, huecos, oficina } = entrada;
  const cobertura = coberturaDe(posiciones, huecos);
  const vacio: ResumenDia = {
    roles: paradas.map(() => 'visita'),
    numeroVisita: paradas.map(() => null),
    salidaCasa: null,
    llegadaOficina: null,
    salidaOficina: null,
    visitas: 0,
    cobertura,
  };
  if (posiciones.length === 0 || paradas.length === 0) return vacio;

  const ultimoFix = ms(posiciones[posiciones.length - 1].registradoEn);
  const enOficina = (p: ParadaDia) => oficina != null && distanciaM(p, oficina) <= oficina.radioM;

  const casa = null as ParadaDia | null; // la casa no está definida

  const roles: RolParada[] = [];
  const numeroVisita: (number | null)[] = [];
  let visitas = 0;
  paradas.forEach((parada, i) => {
    let rol: RolParada = 'visita';
    if (casa && i === 0) rol = 'casa';
    else if (enOficina(parada)) rol = 'oficina';
    else if (casa && distanciaM(parada, casa) <= RADIO_CASA_M) rol = 'regreso';
    roles.push(rol);
    if (rol !== 'visita') {
      numeroVisita.push(null);
      return;
    }
    // Paradas seguidas en el mismo lugar (el GPS corta una estancia larga en
    // varias) son una sola visita.
    const anterior = i > 0 && roles[i - 1] === 'visita' ? paradas[i - 1] : null;
    numeroVisita.push(anterior && distanciaM(parada, anterior) <= RADIO_MISMA_VISITA_M ? numeroVisita[i - 1] : (visitas += 1));
  });

  const sigueAlli = (p: ParadaDia) => ms(p.fin) >= ultimoFix - SIGUE_ALLI_MS;
  const deOficina = paradas.filter((_, i) => roles[i] === 'oficina');
  const ultimaOficina = deOficina[deOficina.length - 1];
  return {
    roles,
    numeroVisita,
    salidaCasa: casa && !sigueAlli(casa) ? casa.fin : null,
    llegadaOficina: deOficina[0]?.inicio ?? null,
    salidaOficina: ultimaOficina && !sigueAlli(ultimaOficina) ? ultimaOficina.fin : null,
    visitas,
    cobertura,
  };
}

// Cómo se nombra cada parada en la lista, el mapa y la pista.
export function etiquetaRol(rol: RolParada, numeroVisita: number | null, nombreOficina = 'Oficina'): string {
  switch (rol) {
    case 'casa':
      return 'Casa';
    case 'regreso':
      return 'Regreso';
    case 'oficina':
      return nombreOficina;
    default:
      return numeroVisita != null ? `Visita ${numeroVisita}` : 'Visita';
  }
}
