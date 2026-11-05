// Bitácora de una persona en un rango (por lo general un día): lo que la
// supervisión quiere saber. ¿A qué hora empezó? ¿Cuándo salió y a dónde
// llegó? ¿Cuándo dejó de reportar y por qué? ¿Volvió con el teléfono cargado?
// ¿A qué hora terminó?
//
// Todo sale de lo registrado (jornadas, posiciones, huecos, paradas y
// batería); nada se interpola. Si no se sabe la causa de un hueco se dice
// "sin señal" y se muestra la última batería conocida.
import type { AvisoTelefono, Hueco, MuestraBateria, Posicion, ReporteParada } from '@contratos';
import type { Actividad } from './cronograma';
import type { Jornada } from './datos';
import { distanciaM, resumenDia } from './dia.ts';

export type TipoEvento =
  | 'jornadaInicio'
  | 'jornadaFin'
  | 'salida'
  | 'llegada'
  // Se fue o llegó, pero no hay registro de la hora: no se da una.
  | 'salidaSinHora'
  | 'llegadaSinHora'
  | 'sinSenal'
  | 'sinBateria'
  | 'retomo'
  | 'cargaInicio'
  | 'cargaFin'
  | 'bateriaBaja'
  | 'aviso'
  | 'recuperacion'
  | 'cronograma';

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
  // Lo marcó el sistema y no la persona: el inicio que continúa la jornada
  // del día anterior o un cierre que ella no hizo.
  automatico?: boolean;
}

export interface EntradasBitacora {
  jornadas?: Jornada[];
  posiciones?: Posicion[];
  huecos?: Hueco[];
  paradas?: ReporteParada[];
  muestrasBateria?: MuestraBateria[];
  // Lo que la persona hizo en el teléfono: GPS, permisos, notificaciones, ahorro.
  avisos?: AvisoTelefono[];
  actividades?: Actividad[];
  // Solo entran las actividades cargadas dentro de este rango.
  desde?: string;
  hasta?: string;
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

// Aquí y no desde cronograma.ts: ese módulo carga el cliente de la API.
const ETIQUETA_ACTIVIDAD: Record<string, string> = {
  visita: 'Visita',
  almuerzo: 'Almuerzo',
  permiso_medico: 'Permiso médico',
  vacaciones: 'Vacaciones',
  permiso: 'Permiso',
  novedad: 'Novedad',
};

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

// Salir y llegar se afirman solo con prueba: un punto preciso fuera del lugar
// poco después (o antes) y sin un rato sin registro entre medio. Sin prueba no
// se da hora: un apagón o un corte de señal no es una salida (Ana Troya 22/10,
// Paola 28/10) y quien vuelve a aparecer en el mismo sitio no llegó de nuevo.
export const PRECISION_PRUEBA_M = 50;
export const FUERA_M = 80;
export const PLAZO_PRUEBA_MS = 15 * 60_000;
export const PAUSA_MAX_MS = 5 * 60_000;
export const MISMO_LUGAR_M = 100;

// Primer índice con hora mayor que t (posiciones ordenadas).
function indiceTras(posiciones: Posicion[], t: number): number {
  let bajo = 0;
  let alto = posiciones.length;
  while (bajo < alto) {
    const medio = (bajo + alto) >> 1;
    if (ms(posiciones[medio].registradoEn) <= t) bajo = medio + 1;
    else alto = medio;
  }
  return bajo;
}

// Busca la prueba desde `desde` hacia adelante (paso 1) o hacia atrás (-1).
function hayPrueba(posiciones: Posicion[], lugar: { latitud: number; longitud: number }, desde: number, paso: 1 | -1): boolean {
  let previo = desde;
  for (let k = paso > 0 ? indiceTras(posiciones, desde) : indiceTras(posiciones, desde - 1) - 1; k >= 0 && k < posiciones.length; k += paso) {
    const p = posiciones[k];
    const t = ms(p.registradoEn);
    if (Math.abs(t - desde) > PLAZO_PRUEBA_MS || Math.abs(t - previo) > PAUSA_MAX_MS) return false;
    if (p.precisionM != null && p.precisionM <= PRECISION_PRUEBA_M && distanciaM(lugar, p) > FUERA_M) {
      return !vuelveAlLugar(posiciones, lugar, k, paso);
    }
    previo = t;
  }
  return false;
}

// Un punto fuera no prueba nada si en los REBOTE_MS siguientes (o anteriores,
// para la llegada) hay otro preciso dentro del lugar: es el GPS que saltó
// (David López 23/10 14:20, 110-160 m con "2 m" de precisión y los pasos
// quietos, y a los 60 s otra vez adentro).
const REBOTE_MS = 10 * 60_000;
function vuelveAlLugar(posiciones: Posicion[], lugar: { latitud: number; longitud: number }, desde: number, paso: 1 | -1): boolean {
  const t0 = ms(posiciones[desde].registradoEn);
  for (let k = desde + paso; k >= 0 && k < posiciones.length; k += paso) {
    const p = posiciones[k];
    if (Math.abs(ms(p.registradoEn) - t0) > REBOTE_MS) return false;
    if (p.precisionM != null && p.precisionM <= PRECISION_PRUEBA_M && distanciaM(lugar, p) <= DENTRO_M) return true;
  }
  return false;
}

const salioDe = (posiciones: Posicion[], p: ReporteParada) => hayPrueba(posiciones, p, ms(p.fin), 1);

// Caminó de una parada a otra cercana: es otro sitio y eso prueba la salida y
// la llegada (Ana Troya 22/10: salió de la oficina a pie y se quedó al lado).
// La misma regla que el servidor (paradas.js, cambioDeSitio): en la pausa el
// contador sube a ritmo de marcha y en la segunda casi todas las lecturas
// precisas quedan fuera del radio de la primera 5 min o más. Sin pasos no
// prueba nada.
const CAMINATA_PASOS_MIN = 60;
const CAMBIO_MIN_MS = 5 * 60_000;
function caminoA(posiciones: Posicion[], previa: ReporteParada | undefined, siguiente: ReporteParada | undefined): boolean {
  if (!previa || !siguiente || distanciaM(previa, siguiente) <= DENTRO_M) return false;
  const entre = (a: number, b: number) => posiciones.filter((p) => ms(p.registradoEn) >= a && ms(p.registradoEn) <= b);
  const conPasos = entre(ms(previa.fin) - 30_000, ms(siguiente.inicio) + 30_000).filter((p) => p.pasos != null);
  if (conPasos.length < 2) return false;
  const duracion = Math.max(60_000, ms(conPasos[conPasos.length - 1].registradoEn) - ms(conPasos[0].registradoEn));
  if (duracion > 10 * 60_000) return false;
  let pasos = 0;
  for (let k = 1; k < conPasos.length; k += 1) pasos += Math.max(0, (conPasos[k].pasos ?? 0) - (conPasos[k - 1].pasos ?? 0));
  if (pasos / (duracion / 60_000) < CAMINATA_PASOS_MIN) return false;
  const lecturas = entre(ms(siguiente.inicio), ms(siguiente.fin)).filter((p) => p.precisionM != null && p.precisionM <= 30);
  if (lecturas.length < 3 || ms(lecturas[lecturas.length - 1].registradoEn) - ms(lecturas[0].registradoEn) < CAMBIO_MIN_MS) return false;
  return lecturas.filter((p) => distanciaM(previa, p) > DENTRO_M).length >= 0.9 * lecturas.length;
}

// La parada del servidor se corta donde empieza un rato sin registro. Si al
// volver sigue en el lugar (puntos precisos a DENTRO_M o menos), estuvo ahí
// hasta el último de ellos (Ariel 28/10: sin señal 14:37, dentro a las 15:01).
// Sin rato sin registro el borde es el del servidor.
const DENTRO_M = 60;
function bordeTrasHueco(posiciones: Posicion[], lugar: { latitud: number; longitud: number }, desde: number, paso: 1 | -1, limite: number): number {
  let k = paso > 0 ? indiceTras(posiciones, desde) : indiceTras(posiciones, desde - 1) - 1;
  if (k < 0 || k >= posiciones.length || Math.abs(ms(posiciones[k].registradoEn) - desde) <= PAUSA_MAX_MS) return desde;
  let borde = desde;
  for (; k >= 0 && k < posiciones.length; k += paso) {
    const p = posiciones[k];
    const t = ms(p.registradoEn);
    if (paso > 0 ? t >= limite : t <= limite) break;
    if (p.precisionM == null || p.precisionM > PRECISION_PRUEBA_M) continue;
    const d = distanciaM(lugar, p);
    if (d > FUERA_M) break;
    if (d <= DENTRO_M) borde = t;
  }
  return borde;
}

// Tramos seguidos de puntos simulados (se cortan con 15 min sin uno).
function tramosSimulados(posiciones: Posicion[]): { desde: string; hasta: string; puntos: number }[] {
  const tramos: { desde: string; hasta: string; puntos: number }[] = [];
  for (const p of posiciones) {
    if (!p.simulada) continue;
    const ultimo = tramos.at(-1);
    if (ultimo && ms(p.registradoEn) - ms(ultimo.hasta) <= PLAZO_PRUEBA_MS) {
      ultimo.hasta = p.registradoEn;
      ultimo.puntos += 1;
    } else {
      tramos.push({ desde: p.registradoEn, hasta: p.registradoEn, puntos: 1 });
    }
  }
  return tramos;
}

// Segundos sin registro (cortes de señal o batería) dentro de un tramo.
function sinRegistroEntre(huecos: Hueco[], desde: number, hasta: number): number {
  let total = 0;
  for (const h of huecos) {
    if (h.motivo === 'FUERA_DE_JORNADA') continue;
    const a = Math.max(ms(h.desde), desde);
    const b = Math.min(ms(h.hasta), hasta);
    if (b > a) total += (b - a) / 1000;
  }
  return total;
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

// La app parte la jornada a las 23:59:59 y la siguiente arranca a las 00:00:
// no es una persona que finaliza ni que inicia.
const HORA_GUAYAQUIL = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const esMedianoche = (instante: number) => HORA_GUAYAQUIL.format(new Date(instante)) >= '23:59';
const esCortePrevio = (instante: number) => HORA_GUAYAQUIL.format(new Date(instante)) === '00:00';

export function construirBitacora(entradas: EntradasBitacora): EventoBitacora[] {
  const eventos: EventoBitacora[] = [];
  const todas = [...(entradas.posiciones ?? [])].sort((a, b) => ms(a.registradoEn) - ms(b.registradoEn));
  // La ubicación simulada (GPS falso) no prueba salidas ni llegadas: se
  // muestra aparte como aviso.
  const posiciones = todas.filter((p) => !p.simulada);
  for (const tramo of tramosSimulados(todas)) {
    eventos.push({
      id: `simulada-${tramo.desde}`,
      tipo: 'aviso',
      instante: tramo.desde,
      titulo: 'Ubicación simulada (GPS falso)',
      detalle: `${tramo.puntos} ${tramo.puntos === 1 ? 'punto marcado' : 'puntos marcados'} por el teléfono como simulados; no cuentan como recorrido.`,
      duracionSegundos: (ms(tramo.hasta) - ms(tramo.desde)) / 1000,
      atencion: true,
    });
  }

  for (const j of entradas.jornadas ?? []) {
    const inicio = ms(j.inicioEn);
    const continua = !j.soloApp && (j.continua === true || esCortePrevio(inicio));
    eventos.push({
      id: `jornada-inicio-${j.inicioEn}`,
      tipo: 'jornadaInicio',
      instante: j.inicioEn,
      titulo: j.soloApp ? 'App activada' : continua ? 'Continúa la jornada' : 'Inició jornada',
      detalle: j.soloApp
        ? 'Primer punto del día.'
        : continua
          ? 'Venía abierta del día anterior: no es una hora de entrada.'
          : 'Activó el registro en la app.',
      lugar: lugarDe(posicionCercana(posiciones, inicio)),
      bateriaPct: bateriaDespues(entradas, inicio),
      ...(continua ? { automatico: true } : {}),
    });
    if (j.finEn) {
      const fin = ms(j.finEn);
      const medianoche = !j.soloApp && esMedianoche(fin);
      const automatico = !j.soloApp && (medianoche || j.cierreAutomatico === true);
      eventos.push({
        id: `jornada-fin-${j.finEn}`,
        tipo: 'jornadaFin',
        instante: j.finEn,
        titulo: j.soloApp
          ? 'App sin cobertura'
          : medianoche
            ? 'Corte de medianoche'
            : automatico
              ? 'No cerró la jornada'
              : 'Finalizó jornada',
        detalle: automatico && !medianoche
          ? 'Último punto registrado. La jornada quedó abierta: la cortó el sistema.'
          : j.duracionMin != null
            ? `${j.soloApp ? 'App activa' : 'Jornada de'} ${duracionTexto(j.duracionMin * 60)}.${j.notaFin ? ` Motivo: ${j.notaFin}` : ''}`
            : undefined,
        lugar: lugarDe(posicionCercana(posiciones, fin)),
        bateriaPct: bateriaAntes(entradas, fin),
        ...(automatico ? { automatico: true } : {}),
      });
    }
  }

  // Paradas del servidor, juntas por estancia: dos paradas seguidas en el
  // mismo lugar sin prueba de que salió entre ellas son una sola (el corte
  // fue un apagón o un rato sin señal). La llegada es el inicio de la
  // estancia y la salida su fin, cada una con hora solo si hay prueba.
  const paradas = [...(entradas.paradas ?? [])].sort((a, b) => ms(a.inicio) - ms(b.inicio));
  const ultimaPosicion = posiciones.at(-1);
  const huecos = entradas.huecos ?? [];
  const dia = resumenDia({ posiciones, paradas, huecos });
  const estancias: { indice: number; paradas: ReporteParada[] }[] = [];
  for (const [i, p] of paradas.entries()) {
    const actual = estancias.at(-1);
    const previa = actual?.paradas.at(-1);
    if (actual && previa && distanciaM(previa, p) <= MISMO_LUGAR_M && !salioDe(posiciones, previa) && !caminoA(posiciones, previa, p)) {
      actual.paradas.push(p);
    } else {
      estancias.push({ indice: i, paradas: [p] });
    }
  }
  for (const [n, e] of estancias.entries()) {
    const primera = e.paradas[0];
    const ultima = e.paradas.at(-1)!;
    const principal = e.paradas.reduce((a, b) => (b.duracionMin > a.duracionMin ? b : a));
    const lugar = { latitud: principal.latitud, longitud: principal.longitud, direccion: principal.direccion };
    const direccion = principal.direccion;
    const visita = dia.numeroVisita[e.indice];
    const anterior = estancias[n - 1]?.paradas.at(-1);
    const siguiente = estancias[n + 1]?.paradas[0];
    const inicio = bordeTrasHueco(posiciones, primera, ms(primera.inicio), -1, anterior ? ms(anterior.fin) : -Infinity);
    const fin = bordeTrasHueco(posiciones, ultima, ms(ultima.fin), 1, siguiente ? ms(siguiente.inicio) : Infinity);
    const segundos = (fin - inicio) / 1000;
    const sinRegistro = sinRegistroEntre(huecos, inicio, fin);
    const detenido = `Detenido ${duracionTexto(segundos)}${sinRegistro > 0 ? `, ${duracionTexto(sinRegistro)} de ellos sin registro` : ''}.`;
    // La primera parada que arranca con la jornada no es una "llegada": es
    // donde estaba al encender.
    const esOrigen = n === 0 && posiciones.length > 0 && inicio - ms(posiciones[0].registradoEn) < 2 * 60_000;
    if (!esOrigen) {
      const conHora = hayPrueba(posiciones, primera, inicio, -1) || caminoA(posiciones, anterior, primera);
      const prefijo = visita != null ? `Visita ${visita}: ` : '';
      eventos.push({
        id: `llegada-${primera.id}`,
        tipo: conHora ? 'llegada' : 'llegadaSinHora',
        instante: new Date(inicio).toISOString(),
        titulo: conHora
          ? direccion
            ? frase(`${prefijo}llegó a`, `${prefijo}llegó cerca de`, direccion)
            : `${prefijo}llegó y se detuvo`
          : direccion
            ? frase(`${prefijo}primer punto preciso en`, `${prefijo}primer punto preciso cerca de`, direccion)
            : `${prefijo}primer punto preciso en este lugar`,
        detalle: conHora ? detenido : `No se registró la hora de llegada. ${detenido}`,
        lugar,
        duracionSegundos: segundos,
      });
    }
    const sigueAhi = ultimaPosicion && fin >= ms(ultimaPosicion.registradoEn) - 60_000;
    if (!sigueAhi) {
      const conHora = hayPrueba(posiciones, ultima, fin, 1) || caminoA(posiciones, ultima, siguiente);
      eventos.push({
        id: `salida-${ultima.id}`,
        tipo: conHora ? 'salida' : 'salidaSinHora',
        instante: new Date(fin).toISOString(),
        titulo: conHora
          ? direccion ? frase('Salió de', 'Salió de la zona de', direccion) : 'Salió'
          : direccion ? frase('Último punto preciso en', 'Último punto preciso cerca de', direccion) : 'Último punto preciso en el lugar',
        detalle: [
          esOrigen ? `Estuvo ${duracionTexto(segundos)} en el punto de inicio.` : '',
          conHora ? '' : 'No se registró la hora de salida.',
        ].filter(Boolean).join(' ') || undefined,
        lugar,
      });
    }
  }

  // Huecos: dejó de reportar. Si la batería ya estaba agotada se atribuye a
  // eso; al volver, se compara el nivel para saber si cargó el teléfono.
  // Entre dos jornadas no se registra a propósito: no es un corte.
  for (const h of huecos) {
    if (h.motivo === 'FUERA_DE_JORNADA') continue;
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

  for (const a of entradas.avisos ?? []) {
    const alerta = a.categoria === 'alerta';
    eventos.push({
      id: `aviso-${a.tipo}-${a.en}`,
      tipo: alerta ? 'aviso' : 'recuperacion',
      instante: a.en,
      titulo: a.texto,
      lugar: lugarDe(posicionCercana(posiciones, ms(a.en))),
      bateriaPct: bateriaAntes(entradas, ms(a.en)),
      atencion: alerta,
    });
  }

  // Actividades del cronograma, a la hora en que se cargaron desde la app.
  const [desde, hasta] = [entradas.desde ? ms(entradas.desde) : -Infinity, entradas.hasta ? ms(entradas.hasta) : Infinity];
  for (const a of entradas.actividades ?? []) {
    const cargada = ms(a.registro.en);
    if (!(cargada >= desde && cargada <= hasta)) continue;
    const horario = a.horaFin ? `${a.hora.slice(0, 5)} a ${a.horaFin.slice(0, 5)}` : a.hora.slice(0, 5);
    eventos.push({
      id: `cronograma-${a.id}`,
      tipo: 'cronograma',
      instante: a.registro.en,
      titulo: `Subió al cronograma: ${ETIQUETA_ACTIVIDAD[a.tipo] ?? a.tipo}${a.lugar ? ` en ${a.lugar}` : ''}`,
      detalle: `Para el ${a.fecha.split('-').reverse().join('/')}, ${horario}.${a.nota ? ` ${a.nota}` : ''}`,
      lugar:
        a.registro.latitud != null && a.registro.longitud != null
          ? { latitud: a.registro.latitud, longitud: a.registro.longitud, direccion: a.registro.direccion }
          : undefined,
    });
  }

  return eventos.sort((a, b) => ms(a.instante) - ms(b.instante) || a.id.localeCompare(b.id));
}

// Hitos del día para la ficha de una persona: primera salida, primera llegada,
// cierre de jornada y cuánto tiempo pasó sin registro.
export function resumenBitacora(eventos: EventoBitacora[]) {
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
  // La primera salida o llegada del día puede no tener hora: entonces se
  // muestra así y no la siguiente que sí la tenga.
  const primeraDe = (conHora: TipoEvento, sinHora: TipoEvento) => eventos.find((e) => e.tipo === conHora || e.tipo === sinHora);
  return {
    // La entrada es el primer inicio de la persona; el corte de medianoche no lo es.
    inicioJornada: eventos.find((e) => e.tipo === 'jornadaInicio' && !e.automatico),
    continuaJornada: eventos.some((e) => e.tipo === 'jornadaInicio' && e.automatico),
    primeraSalida: primeraDe('salida', 'salidaSinHora'),
    primeraLlegada: primeraDe('llegada', 'llegadaSinHora'),
    finJornada,
    sinBateria: eventos.filter((e) => e.tipo === 'sinBateria').length,
    cortes: eventos.filter((e) => e.tipo === 'sinSenal' || e.tipo === 'sinBateria').length,
    sinRegistroS,
    atenciones: eventos.filter((e) => e.atencion).length,
  };
}
