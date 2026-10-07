// Bitácora de una persona en un rango (por lo general un día): lo que la
// supervisión quiere saber. ¿A qué hora empezó? ¿Cuándo salió y a dónde
// llegó? ¿Cuándo dejó de reportar y por qué? ¿Volvió con el teléfono cargado?
// ¿A qué hora terminó?
//
// Todo sale de lo registrado (jornadas, posiciones, huecos, paradas y
// batería); nada se interpola. Si no se sabe la causa de un hueco se dice
// "sin señal" y se muestra la última batería conocida.
import type { Hueco, MuestraBateria, Posicion, ReporteParada } from '@contratos';
import type { Jornada } from './datos';
import { resumenDia } from './dia';

export type TipoEvento =
  | 'jornadaInicio'
  | 'jornadaFin'
  | 'salida'
  | 'llegada'
  | 'sinSenal'
  | 'sinBateria'
  | 'retomo'
  | 'cargaInicio'
  | 'cargaFin'
  | 'bateriaBaja';

export interface EventoBitacora {
  id: string;
  tipo: TipoEvento;
  instante: string;
  titulo: string;
  detalle?: string;
  // Dónde ocurrió, si hay un fix registrado cerca del instante.
  lugar?: { latitud: number; longitud: number; direccion?: string | null };
  duracionSegundos?: number;
  bateriaPct?: number | null;
  // Los eventos que exigen revisión (sin batería, sin señal larga) se marcan
  // para resaltarlos en la línea de tiempo y en el mapa.
  atencion?: boolean;
}

export interface EntradasBitacora {
  jornadas?: Jornada[];
  posiciones?: Posicion[];
  huecos?: Hueco[];
  paradas?: ReporteParada[];
  muestrasBateria?: MuestraBateria[];
}

// Por debajo de este nivel, un hueco que empieza se atribuye a batería agotada.
export const BATERIA_AGOTADA_PCT = 5;
// Umbral del aviso de batería baja durante la jornada.
export const BATERIA_BAJA_PCT = 15;
// Subida mínima entre el antes y el después de un hueco para decir que cargó.
const SUBIDA_CARGA_PCT = 5;
// Un hueco más largo que esto se resalta aunque no sea por batería.
const HUECO_LARGO_S = 15 * 60;

const ms = (iso: string) => new Date(iso).getTime();

// Con precisión mala el servidor devuelve "Cerca de …": la frase del evento se
// adapta para no decir "Llegó a Cerca de …".
const PREFIJO_CERCA = /^cerca de /i;
function frase(exacta: string, aproximada: string, direccion: string): string {
  return PREFIJO_CERCA.test(direccion)
    ? `${aproximada} ${direccion.replace(PREFIJO_CERCA, '')}`
    : `${exacta} ${direccion}`;
}

function duracionTexto(segundos: number): string {
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

// Posición registrada más cercana a un instante, dentro de una tolerancia.
function posicionCercana(posiciones: Posicion[], instante: number, toleranciaMs = 10 * 60_000): Posicion | undefined {
  let mejor: Posicion | undefined;
  let mejorDelta = Infinity;
  for (const p of posiciones) {
    const delta = Math.abs(ms(p.registradoEn) - instante);
    if (delta < mejorDelta) {
      mejor = p;
      mejorDelta = delta;
    }
  }
  return mejorDelta <= toleranciaMs ? mejor : undefined;
}

// Último nivel de batería conocido antes (o en) un instante, mirando a la vez
// posiciones y muestras de batería.
function bateriaAntes(entradas: EntradasBitacora, instante: number): number | null {
  let mejor: { t: number; pct: number } | null = null;
  for (const p of entradas.posiciones ?? []) {
    const t = ms(p.registradoEn);
    if (t <= instante && p.bateriaPct != null && (!mejor || t > mejor.t)) mejor = { t, pct: p.bateriaPct };
  }
  for (const m of entradas.muestrasBateria ?? []) {
    const t = ms(m.registradoEn);
    if (t <= instante && m.bateriaPct != null && (!mejor || t > mejor.t)) mejor = { t, pct: m.bateriaPct };
  }
  return mejor?.pct ?? null;
}

// Primer nivel de batería conocido desde un instante en adelante.
function bateriaDespues(entradas: EntradasBitacora, instante: number): number | null {
  let mejor: { t: number; pct: number } | null = null;
  for (const p of entradas.posiciones ?? []) {
    const t = ms(p.registradoEn);
    if (t >= instante && p.bateriaPct != null && (!mejor || t < mejor.t)) mejor = { t, pct: p.bateriaPct };
  }
  for (const m of entradas.muestrasBateria ?? []) {
    const t = ms(m.registradoEn);
    if (t >= instante && m.bateriaPct != null && (!mejor || t < mejor.t)) mejor = { t, pct: m.bateriaPct };
  }
  return mejor?.pct ?? null;
}

const lugarDe = (p?: Posicion) => (p ? { latitud: p.latitud, longitud: p.longitud } : undefined);

export function construirBitacora(entradas: EntradasBitacora): EventoBitacora[] {
  const eventos: EventoBitacora[] = [];
  const posiciones = [...(entradas.posiciones ?? [])].sort((a, b) => ms(a.registradoEn) - ms(b.registradoEn));

  for (const j of entradas.jornadas ?? []) {
    const inicio = ms(j.inicioEn);
    eventos.push({
      id: `jornada-inicio-${j.inicioEn}`,
      tipo: 'jornadaInicio',
      instante: j.inicioEn,
      titulo: 'Inició jornada',
      detalle: 'Activó el registro en la app.',
      lugar: lugarDe(posicionCercana(posiciones, inicio)),
      bateriaPct: bateriaDespues(entradas, inicio),
    });
    if (j.finEn) {
      const fin = ms(j.finEn);
      eventos.push({
        id: `jornada-fin-${j.finEn}`,
        tipo: 'jornadaFin',
        instante: j.finEn,
        titulo: 'Finalizó jornada',
        detalle: j.duracionMin != null ? `Jornada de ${duracionTexto(j.duracionMin * 60)}.` : undefined,
        lugar: lugarDe(posicionCercana(posiciones, fin)),
        bateriaPct: bateriaAntes(entradas, fin),
      });
    }
  }

  // Paradas del servidor: la llegada es el inicio de la parada y la salida su
  // fin. Una parada que sigue abierta al final de la ventana no tiene salida.
  const paradas = [...(entradas.paradas ?? [])].sort((a, b) => ms(a.inicio) - ms(b.inicio));
  const ultimaPosicion = posiciones.at(-1);
  const dia = resumenDia({ posiciones, paradas, huecos: entradas.huecos ?? [] });
  for (const [i, p] of paradas.entries()) {
    const lugar = { latitud: p.latitud, longitud: p.longitud, direccion: p.direccion };
    const visita = dia.numeroVisita[i];
    // La primera parada que arranca con la jornada no es una "llegada": es
    // donde estaba al encender.
    const esOrigen = i === 0 && posiciones.length > 0 && ms(p.inicio) - ms(posiciones[0].registradoEn) < 2 * 60_000;
    if (!esOrigen) {
      eventos.push({
        id: `llegada-${p.id}`,
        tipo: 'llegada',
        instante: p.inicio,
        titulo: p.direccion
          ? frase(visita != null ? `Visita ${visita}: llegó a` : 'Llegó a', 'Llegó cerca de', p.direccion)
          : visita != null
            ? `Visita ${visita}: llegó y se detuvo`
            : 'Llegó y se detuvo',
        detalle: `Detenido ${duracionTexto(p.duracionMin * 60)}.`,
        lugar,
        duracionSegundos: p.duracionMin * 60,
      });
    }
    const sigueAhi = ultimaPosicion && ms(p.fin) >= ms(ultimaPosicion.registradoEn) - 60_000;
    if (!sigueAhi) {
      eventos.push({
        id: `salida-${p.id}`,
        tipo: 'salida',
        instante: p.fin,
        titulo: p.direccion ? frase('Salió de', 'Salió de la zona de', p.direccion) : 'Salió',
        detalle: esOrigen ? `Estuvo ${duracionTexto(p.duracionMin * 60)} en el punto de inicio.` : undefined,
        lugar,
      });
    }
  }

  // Huecos: dejó de reportar. Si la batería ya estaba agotada se atribuye a
  // eso; al volver, se compara el nivel para saber si cargó el teléfono.
  for (const h of entradas.huecos ?? []) {
    const desde = ms(h.desde);
    const hasta = ms(h.hasta);
    const antes = bateriaAntes(entradas, desde);
    const despues = bateriaDespues(entradas, hasta);
    const agotada = antes != null && antes <= BATERIA_AGOTADA_PCT;
    eventos.push({
      id: `hueco-${h.desde}`,
      tipo: agotada ? 'sinBateria' : 'sinSenal',
      instante: h.desde,
      titulo: agotada ? 'Se quedó sin batería' : 'Dejó de reportar',
      detalle: agotada
        ? `Último nivel ${antes}%. Sin registro durante ${duracionTexto(h.duracionSegundos)}.`
        : `Sin registro durante ${duracionTexto(h.duracionSegundos)}${antes != null ? ` (batería ${antes}%)` : ''}.`,
      lugar: lugarDe(posicionCercana(posiciones, desde)),
      duracionSegundos: h.duracionSegundos,
      bateriaPct: antes,
      atencion: agotada || h.duracionSegundos >= HUECO_LARGO_S,
    });
    const cargo = antes != null && despues != null && despues - antes >= SUBIDA_CARGA_PCT;
    eventos.push({
      id: `retomo-${h.hasta}`,
      tipo: 'retomo',
      instante: h.hasta,
      titulo: 'Retomó el registro',
      detalle: cargo
        ? `Volvió con ${despues}% de batería: cargó el teléfono (${antes}% → ${despues}%).`
        : despues != null
          ? `Volvió con ${despues}% de batería.`
          : undefined,
      lugar: lugarDe(posicionCercana(posiciones, hasta)),
      bateriaPct: despues,
    });
  }

  // Cargador y batería baja, a partir de las muestras de batería.
  const muestras = [...(entradas.muestrasBateria ?? [])].sort((a, b) => ms(a.registradoEn) - ms(b.registradoEn));
  let cargandoPrevio: boolean | null = null;
  let avisadaBaja = false;
  for (const m of muestras) {
    if (m.cargando != null && cargandoPrevio != null && m.cargando !== cargandoPrevio) {
      eventos.push({
        id: `carga-${m.registradoEn}`,
        tipo: m.cargando ? 'cargaInicio' : 'cargaFin',
        instante: m.registradoEn,
        titulo: m.cargando ? 'Conectó el cargador' : 'Desconectó el cargador',
        lugar: lugarDe(posicionCercana(posiciones, ms(m.registradoEn))),
        bateriaPct: m.bateriaPct,
      });
    }
    if (m.cargando != null) cargandoPrevio = m.cargando;
    if (m.bateriaPct != null) {
      if (!avisadaBaja && m.bateriaPct <= BATERIA_BAJA_PCT && !m.cargando) {
        avisadaBaja = true;
        eventos.push({
          id: `bateria-baja-${m.registradoEn}`,
          tipo: 'bateriaBaja',
          instante: m.registradoEn,
          titulo: `Batería baja (${m.bateriaPct}%)`,
          lugar: lugarDe(posicionCercana(posiciones, ms(m.registradoEn))),
          bateriaPct: m.bateriaPct,
          atencion: true,
        });
      }
      if (m.bateriaPct > BATERIA_BAJA_PCT + 10) avisadaBaja = false;
    }
  }

  return eventos.sort((a, b) => ms(a.instante) - ms(b.instante) || a.id.localeCompare(b.id));
}

// Hitos del día para la ficha de una persona: primera salida, primera llegada,
// cierre de jornada y cuánto tiempo pasó sin registro.
export function resumenBitacora(eventos: EventoBitacora[]) {
  const primero = (tipo: TipoEvento) => eventos.find((e) => e.tipo === tipo);
  const ultimo = (tipo: TipoEvento) => eventos.findLast((e) => e.tipo === tipo);
  // Si tras cerrar una jornada abrió otra, la jornada vigente sigue en curso:
  // el cierre anterior no es el "Finalizó" del día.
  const cierre = ultimo('jornadaFin');
  const ultimoInicio = ultimo('jornadaInicio');
  const finJornada =
    cierre && ultimoInicio && new Date(ultimoInicio.instante).getTime() > new Date(cierre.instante).getTime()
      ? undefined
      : cierre;
  const sinRegistroS = eventos
    .filter((e) => e.tipo === 'sinSenal' || e.tipo === 'sinBateria')
    .reduce((total, e) => total + (e.duracionSegundos ?? 0), 0);
  return {
    inicioJornada: primero('jornadaInicio'),
    primeraSalida: primero('salida'),
    primeraLlegada: primero('llegada'),
    finJornada,
    sinBateria: eventos.filter((e) => e.tipo === 'sinBateria').length,
    cortes: eventos.filter((e) => e.tipo === 'sinSenal' || e.tipo === 'sinBateria').length,
    sinRegistroS,
    atenciones: eventos.filter((e) => e.atencion).length,
  };
}
