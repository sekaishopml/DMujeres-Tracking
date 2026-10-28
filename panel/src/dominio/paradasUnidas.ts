import type { Hueco } from '@contratos';
import type { Parada } from './replay';
import { caminando } from './depuracion.ts';

// Estancias: varias paradas seguidas en el mismo lugar son una sola si entre
// ellas la persona no salió. Bajo techo el GPS rebota cientos de metros (a
// veces kilómetros) con "buena precisión", y eso no es una salida.
//
// Salir de verdad (salioDeVerdad) exige al menos SALIDA_MIN_PUNTOS puntos
// precisos a más de SALIDA_M, con un trazo físicamente posible: sin saltos de
// más de SALTO_KMH entre puntos seguidos (un viaje largo tolera
// SALTOS_TOLERADOS de tropiezos), sin ir y volver más rápido de
// VUELTA_MEDIA_KMH de promedio y sin dar vueltas (el rebote recorre
// más de ENREDO_MAX veces lo que se aleja; un viaje de ida y vuelta no).
// Además, cuando la persona estaba a pie en el lugar (entre dos paradas o
// dentro de una): estuvo lejos SALIDA_MIN_MS o más (ir y volver toma
// minutos) y, si el contador de pasos funciona ese día, dio PASOS_SALIDA
// pasos o más (nadie va al carro y vuelve sin caminar). Si el contador no
// funciona pero el teléfono reporta su actividad, tuvo que detectarla en
// movimiento (en vehículo, en bicicleta, a pie) en ACTIVIDAD_MIN_PUNTOS
// puntos o más: durante el rebote bajo techo dice "quieto" o nada (Diego,
// Israel, Jeremy 26/10); en un viaje real dice "en vehículo" (Miguel 23/10,
// 95 %). En los bordes (recién
// llegada o a punto de irse) puede seguir en el carro y el sensor tarda en
// notar una maniobra lenta: ahí decide solo la física (Nadia 26/10
// buscando estacionamiento, que el sensor marcó "quieto").
const MISMO_LUGAR_M = 150;
const SALIDA_M = 150;
const SALIDA_MIN_PUNTOS = 3;
const SALTO_KMH = 130;
const SALTOS_TOLERADOS = 0.05;
const SALIDA_MIN_MS = 2 * 60_000;
const VUELTA_MEDIA_KMH = 40;
const ENREDO_MAX = 2.5;
const PASOS_SALIDA = 30;
// Ir en carro no suma pasos (el contador a veces ni se mueve de la casa al
// carro): si el propio GPS reporta VEHICULO_KMH o más en VEHICULO_PUNTOS
// lecturas precisas, los pasos no descartan la salida.
const VEHICULO_KMH = 15;
const VEHICULO_PUNTOS = 3;
const MARGEN_PASOS_MS = 5 * 60_000;
const PRECISION_SALIDA_M = 30;
const ACTIVIDAD_MIN_PUNTOS = 3;
const EN_MOVIMIENTO = new Set(['IN_VEHICLE', 'ON_BICYCLE', 'ON_FOOT', 'WALKING', 'RUNNING']);
// La actividad sirve si el teléfono la reportó en la mayoría de sus puntos
// (sin el permiso de actividad física no llega nunca).
const ACTIVIDAD_DIA_MIN = 0.5;
// Un contador que casi no avanza en el día (sensor apagado o que actualiza
// cada tanto) no sirve para decidir.
const PASOS_DIA_MIN = 100;
const PASOS_VALORES_MIN = 20;
// Sin puntos ni cortes registrados no se puede decir que se quedó.
const OBSERVADO_MAX_MS = 10 * 60_000;
// Con un corte (sin señal, GPS apagado) entre las dos: se unen si quedan a
// 60 m o menos y el corte cubre casi todo el lapso, o el lapso es corto.
const DISTANCIA_MISMO_LUGAR_M = 60;
const CORTE_CORTO_MS = 5 * 60_000;
const COBERTURA_MIN = 0.8;
// Bordes: la estancia dura hasta el último punto a BORDE_M del lugar antes de
// alejarse LEJOS_M (el rebote antes de arrancar), y empieza en el primero a
// BORDE_M después de llegar.
const BORDE_M = 80;
const LEJOS_M = 400;

type Punto = {
  registradoEn: string;
  latitud: number;
  longitud: number;
  precisionM?: number | null;
  pasos?: number | null;
  actividad?: string | null;
  velocidadKmh?: number | null;
};

// `lugarConocido`: la parada cae en una geocerca. Ahí una caminata corta es
// una visita (recorrer un centro comercial) y se conserva.
export function unirParadasSinSalir(paradas: Parada[], huecos: Hueco[], posiciones: Punto[] = [], lugarConocido: (parada: Parada) => boolean = () => false): Parada[] {
  // Una "parada" corta en la que el contador de pasos sube a ritmo de caminata
  // es una caminata en poco espacio (ver caminando): no se muestra como parada.
  const ordenadas = [...paradas]
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
    .filter((p) => lugarConocido(p) || !caminando(posiciones.filter((q) => Date.parse(q.registradoEn) >= Date.parse(p.inicio) && Date.parse(q.registradoEn) <= Date.parse(p.fin))));
  const pasosFiables = contadorDePasosFiable(posiciones);
  const actividadFiable = actividadReportada(posiciones);
  const salida: Parada[] = [];
  for (const parada of sinIntercaladas(ordenadas, posiciones, pasosFiables)) {
    const previa = salida[salida.length - 1];
    const mismoLugar = previa && seQuedo(previa, parada, huecos, posiciones, pasosFiables, actividadFiable);
    if (previa && mismoLugar) {
      salida[salida.length - 1] = {
        ...previa,
        fin: parada.fin,
        duracionMin: (Date.parse(parada.fin) - Date.parse(previa.inicio)) / 60000,
      };
    } else {
      salida.push(parada);
    }
  }
  const sinCola = recortarColas(ampliarBordes(salida, huecos, posiciones), huecos, posiciones);
  return marcarCortes(partirPorViajes(sinCola, posiciones, pasosFiables, actividadFiable), huecos);
}

// Dos paradas seguidas en el mismo lugar son una sola estadía si entre ellas
// no hubo salida: o no hay datos (corte de señal, GPS apagado) o los datos no
// prueban que se fue. Otra jornada de por medio siempre las separa.
function seQuedo(previa: Parada, parada: Parada, huecos: Hueco[], posiciones: Punto[], pasosFiables: boolean, actividadFiable: boolean): boolean {
  const desde = Date.parse(previa.fin);
  const hasta = Date.parse(parada.inicio);
  if (huecos.some((h) => h.motivo === 'FUERA_DE_JORNADA' && Date.parse(h.hasta) > desde && Date.parse(h.desde) < hasta)) return false;
  const distancia = distanciaM(previa, parada);
  if (distancia > MISMO_LUGAR_M) return false;
  const entre = posiciones.filter((p) => Date.parse(p.registradoEn) > desde && Date.parse(p.registradoEn) < hasta);
  if (salioDeVerdad(entre, previa, desde, hasta, { todas: posiciones, pasosFiables, actividadFiable, aPie: true, bordesEnLugar: true })) return false;
  if (distancia <= DISTANCIA_MISMO_LUGAR_M && sinSalida(previa, parada, huecos)) return true;
  return observado(entre, desde, hasta, pasosFiables ? huecos : []);
}

function sinSalida(previa: Parada, parada: Parada, huecos: Hueco[]): boolean {
  const desde = Date.parse(previa.fin);
  const hasta = Date.parse(parada.inicio);
  const lapso = hasta - desde;
  const cortes = huecos.filter((h) => Date.parse(h.hasta) > desde && Date.parse(h.desde) < hasta);
  if (cortes.some((h) => h.motivo === 'FUERA_DE_JORNADA')) return false;
  if (lapso <= CORTE_CORTO_MS) return true;
  const cubierto = cortes.reduce(
    (suma, h) => suma + Math.max(0, Math.min(Date.parse(h.hasta), hasta) - Math.max(Date.parse(h.desde), desde)),
    0,
  );
  return cubierto >= COBERTURA_MIN * lapso;
}

export function contadorDePasosFiable(posiciones: Punto[]): boolean {
  const pasos = posiciones.map((p) => p.pasos).filter((n): n is number => n != null);
  if (pasos.length === 0) return false;
  const [menor, mayor] = pasos.reduce(([a, b], n) => [Math.min(a, n), Math.max(b, n)], [Infinity, -Infinity]);
  return mayor - menor >= PASOS_DIA_MIN && new Set(pasos).size >= PASOS_VALORES_MIN;
}

export function actividadReportada(posiciones: Punto[]): boolean {
  if (posiciones.length === 0) return false;
  return posiciones.filter((p) => p.actividad).length / posiciones.length >= ACTIVIDAD_DIA_MIN;
}

function pasosEn(posiciones: Punto[], t: number): number | null {
  let ultimo: number | null = null;
  for (const p of posiciones) {
    if (Date.parse(p.registradoEn) > t) break;
    if (p.pasos != null) ultimo = p.pasos;
  }
  return ultimo;
}

export interface ContextoSalida {
  // Recorrido completo, para leer los pasos en los bordes.
  todas: Punto[];
  // El contador de pasos funciona ese día (contadorDePasosFiable).
  pasosFiables: boolean;
  // El teléfono reporta su actividad ese día (actividadReportada).
  actividadFiable: boolean;
  // Estaba a pie en el lugar (entre dos paradas o dentro de una): cuentan los
  // pasos y el tiempo mínimo lejos. En los bordes puede seguir en el carro.
  aPie: boolean;
  // desde y hasta son momentos en que estaba en el lugar (bordes de parada):
  // el salto desde ahí también cuenta. En una ventana cualquiera, no.
  bordesEnLugar: boolean;
}

function condujo(entre: Punto[], todas: Punto[], desde: number, hasta: number): boolean {
  // Bajo techo el GPS también inventa velocidad (Sonnia 26/10 de noche: 10 a
  // 80 km/h en su casa): si el teléfono dice que está quieto, no condujo.
  if (quietoPorActividad(todas, desde, hasta)) return false;
  return entre.filter((p) => (p.precisionM ?? 0) <= PRECISION_SALIDA_M && (p.velocidadKmh ?? 0) >= VEHICULO_KMH).length >= VEHICULO_PUNTOS;
}

// Según el reconocimiento de actividad, el teléfono no se movió entre desde y
// hasta: lo reportó quieto y nunca en movimiento. Google deja de avisar cuando
// el teléfono lleva rato quieto y vuelve al moverse, así que un lapso sin
// lecturas después de "quieto" sigue siendo quieto.
function quietoPorActividad(todas: Punto[], desde: number, hasta: number): boolean {
  const lecturas = todas.filter((p) => {
    const t = Date.parse(p.registradoEn);
    return t >= desde && t <= hasta && p.actividad != null && p.actividad !== 'UNKNOWN';
  });
  if (lecturas.some((p) => EN_MOVIMIENTO.has(p.actividad as string))) return false;
  if (lecturas.length > 0) return true;
  const previa = todas.filter((p) => Date.parse(p.registradoEn) < desde && p.actividad != null && p.actividad !== 'UNKNOWN').at(-1);
  return previa?.actividad === 'STILL';
}

// Paradas cortas entre dos estancias en el mismo lugar, sin pasos ni actividad
// de movimiento en todo ese rato: el GPS se clavó en otro sitio bajo techo
// (Sonnia 26/10 03:12, "calle" a 200 m de su casa). Se quitan y las estancias
// se unen. Sin sensores no se sabe y se dejan.
const INTERCALADA_MAX_PARADAS = 3;
const INTERCALADA_MAX_MS = 60 * 60_000;
function sinIntercaladas(paradas: Parada[], posiciones: Punto[], pasosFiables: boolean): Parada[] {
  const salida = [...paradas];
  for (let i = 1; i < salida.length - 1; i += 1) {
    const previa = salida[i - 1];
    for (let j = i + 1; j <= Math.min(i + INTERCALADA_MAX_PARADAS, salida.length - 1); j += 1) {
      if (distanciaM(previa, salida[j]) > MISMO_LUGAR_M) continue;
      const desde = Date.parse(previa.fin);
      const hasta = Date.parse(salida[j].inicio);
      if (hasta - desde > INTERCALADA_MAX_MS) break;
      const antes = pasosEn(posiciones, desde);
      const despues = pasosEn(posiciones, hasta);
      const sinPasos = pasosFiables && antes != null && despues != null && despues >= antes && despues - antes < PASOS_SALIDA;
      if (quietoPorActividad(posiciones, desde, hasta) && (!pasosFiables || sinPasos)) {
        salida.splice(i, j - i);
        i -= 1;
      }
      break;
    }
  }
  return salida;
}

// ¿Salió del lugar entre desde y hasta? `entre` son los puntos de ese lapso.
export function salioDeVerdad(
  entre: Punto[],
  lugar: { latitud: number; longitud: number },
  desde: number,
  hasta: number,
  { todas, pasosFiables, actividadFiable, aPie, bordesEnLugar }: ContextoSalida,
): boolean {
  if (aPie && pasosFiables) {
    // Se camina al carro antes de salir y desde el carro al volver.
    const antes = pasosEn(todas, desde - MARGEN_PASOS_MS);
    const despues = pasosEn(todas, hasta + MARGEN_PASOS_MS);
    // Al empezar otra jornada el contador vuelve a cero: ahí no se sabe.
    if (antes != null && despues != null && despues >= antes && despues - antes < PASOS_SALIDA && !condujo(entre, todas, desde, hasta)) return false;
  }
  // Solo cuando no hay pasos: el sensor tampoco nota un vehículo lento
  // (Joselyn 26/10 17:13, 270 m a 15 km/h marcados "quieto"), así que es la
  // última prueba que queda, no la primera.
  // Sin pasos, el teléfono que se reportó quieto todo el rato no salió,
  // aunque la actividad no llegue en la mitad de los puntos del día.
  if (aPie && !pasosFiables && quietoPorActividad(todas, desde, hasta)) return false;
  if (aPie && actividadFiable && !pasosFiables) {
    const enMovimiento = todas.filter((p) => {
      const t = Date.parse(p.registradoEn);
      return t >= desde && t <= hasta && p.actividad != null && EN_MOVIMIENTO.has(p.actividad);
    });
    if (enMovimiento.length < ACTIVIDAD_MIN_PUNTOS) return false;
  }
  const precisos = entre.filter((p) => (p.precisionM ?? 0) <= PRECISION_SALIDA_M);
  if (precisos.filter((p) => distanciaM(lugar, p) > SALIDA_M).length < SALIDA_MIN_PUNTOS) return false;
  // Cada racha de puntos lejos, con el punto cercano de antes y de después.
  let inicio = -1;
  for (let k = 0; k <= precisos.length; k += 1) {
    const fuera = k < precisos.length && distanciaM(lugar, precisos[k]) > SALIDA_M;
    if (fuera && inicio < 0) inicio = k;
    if (fuera || inicio < 0) continue;
    const racha = precisos.slice(inicio, k);
    // En los bordes de la ventana la persona estaba en el lugar: el salto
    // desde ahí también cuenta.
    const enLugar = (t: number): Punto => ({ ...lugar, registradoEn: new Date(t).toISOString() });
    const camino = [
      ...(bordesEnLugar && inicio === 0 ? [enLugar(desde)] : []),
      ...precisos.slice(Math.max(0, inicio - 1), k + 1),
      ...(bordesEnLugar && k === precisos.length ? [enLugar(hasta)] : []),
    ];
    const recorrido = camino.reduce((suma, p, i) => (i ? suma + distanciaM(camino[i - 1], p) : 0), 0);
    const alejado = Math.max(...racha.map((p) => distanciaM(lugar, p)));
    // Un viaje largo aguanta algún tropiezo del GPS; un rebote corto, ninguno.
    const saltos = camino.filter((p, i) => i > 0 && velocidadKmh(camino[i - 1], p) > SALTO_KMH).length;
    const continuo = saltos <= Math.floor(camino.length * SALTOS_TOLERADOS);
    const t0 = inicio > 0 ? Date.parse(precisos[inicio - 1].registradoEn) : desde;
    const t1 = k < precisos.length ? Date.parse(precisos[k].registradoEn) : hasta;
    const duro = !aPie || t1 - t0 >= SALIDA_MIN_MS;
    // Ida y vuelta con media vuelta incluida: en ciudad no promedia más de
    // VUELTA_MEDIA_KMH (Israel 26/10 17:04: 330 m en 20 s, rebote).
    const volvio = k < precisos.length || bordesEnLugar;
    const camino0 = Date.parse(camino[0].registradoEn);
    const media = (recorrido / Math.max((Date.parse(camino[camino.length - 1].registradoEn) - camino0) / 1000, 1)) * 3.6;
    const posible = !volvio || media <= VUELTA_MEDIA_KMH;
    if (racha.length >= SALIDA_MIN_PUNTOS && continuo && posible && duro && recorrido <= ENREDO_MAX * 2 * alejado) return true;
    inicio = -1;
  }
  return false;
}

// Salidas reales durante una parada (la parada del servidor puede tapar un
// viaje corto): cada vez que se alejó más de SALIDA_M, desde el último punto
// cerca hasta el primero de vuelta, si salioDeVerdad lo confirma.
export function salidasDuranteParada(parada: Parada, posiciones: Punto[], pasosFiables: boolean, actividadFiable: boolean): [number, number][] {
  const inicio = Date.parse(parada.inicio);
  const fin = Date.parse(parada.fin);
  const precisos = posiciones.filter((p) => {
    const t = Date.parse(p.registradoEn);
    return t >= inicio && t <= fin && (p.precisionM ?? 0) <= PRECISION_SALIDA_M;
  });
  const contexto: ContextoSalida = { todas: posiciones, pasosFiables, actividadFiable, aPie: true, bordesEnLugar: true };
  const salidas: [number, number][] = [];
  let desde = inicio;
  let lejos = false;
  for (let k = 0; k <= precisos.length; k += 1) {
    const cerca = k === precisos.length || distanciaM(parada, precisos[k]) <= SALIDA_M;
    const t = k === precisos.length ? fin : Date.parse(precisos[k].registradoEn);
    if (!cerca) {
      lejos = true;
      continue;
    }
    if (lejos) {
      const entre = precisos.filter((p) => Date.parse(p.registradoEn) > desde && Date.parse(p.registradoEn) < t);
      if (salioDeVerdad(entre, parada, desde, t, contexto)) salidas.push([desde, t]);
      lejos = false;
    }
    desde = t;
  }
  return salidas;
}

function velocidadKmh(a: Punto, b: Punto): number {
  const s = (Date.parse(b.registradoEn) - Date.parse(a.registradoEn)) / 1000;
  return s > 0 ? (distanciaM(a, b) / s) * 3.6 : Infinity;
}

// Hubo datos todo el lapso. Un corte de señal cuenta si los pasos sirven:
// el contador siguió contando y dice que no caminó.
function observado(entre: Punto[], desde: number, hasta: number, cortes: Hueco[]): boolean {
  const tiempos = [desde, ...entre.map((p) => Date.parse(p.registradoEn)), hasta];
  return tiempos.every((t, i) => {
    if (i === 0) return true;
    const a = tiempos[i - 1];
    const cubierto = cortes.reduce((suma, h) => suma + Math.max(0, Math.min(Date.parse(h.hasta), t) - Math.max(Date.parse(h.desde), a)), 0);
    return t - a - cubierto <= OBSERVADO_MAX_MS;
  });
}

function ampliarBordes(paradas: Parada[], huecos: Hueco[], posiciones: Punto[]): Parada[] {
  const otraJornada = huecos.filter((h) => h.motivo === 'FUERA_DE_JORNADA');
  const precisos = posiciones.filter((p) => (p.precisionM ?? 0) <= PRECISION_SALIDA_M);
  const entre = (a: number, b: number) => precisos.filter((p) => Date.parse(p.registradoEn) > a && Date.parse(p.registradoEn) < b);
  const enBorde: ContextoSalida = { todas: posiciones, pasosFiables: false, actividadFiable: false, aPie: false, bordesEnLugar: true };
  return paradas.map((parada, i) => {
    let inicio = Date.parse(parada.inicio);
    let fin = Date.parse(parada.fin);
    const limiteAntes = Math.max(i > 0 ? Date.parse(paradas[i - 1].fin) : -Infinity, ...otraJornada.map((h) => Date.parse(h.hasta)).filter((t) => t <= inicio));
    const limiteDespues = Math.min(i < paradas.length - 1 ? Date.parse(paradas[i + 1].inicio) : Infinity, ...otraJornada.map((h) => Date.parse(h.desde)).filter((t) => t >= fin));
    // Salida: el último punto cerca antes del primero lejos.
    const despues = entre(fin, limiteDespues);
    const lejosDespues = despues.findIndex((p) => distanciaM(parada, p) > LEJOS_M);
    const cercaAlSalir = despues.slice(0, Math.max(lejosDespues, 0)).filter((p) => distanciaM(parada, p) <= BORDE_M).at(-1);
    if (cercaAlSalir) {
      const t = Date.parse(cercaAlSalir.registradoEn);
      if (!salioDeVerdad(entre(fin, t), parada, fin, t, enBorde)) fin = t;
    }
    // Llegada: el primer punto cerca después del último lejos.
    const antes = entre(limiteAntes, inicio);
    const ultimoLejos = antes.findLastIndex((p) => distanciaM(parada, p) > LEJOS_M);
    const cercaAlLlegar = ultimoLejos >= 0 ? antes.slice(ultimoLejos + 1).find((p) => distanciaM(parada, p) <= BORDE_M) : undefined;
    if (cercaAlLlegar) {
      const t = Date.parse(cercaAlLlegar.registradoEn);
      if (!salioDeVerdad(entre(t, inicio), parada, t, inicio, enBorde)) inicio = t;
    }
    if (inicio === Date.parse(parada.inicio) && fin === Date.parse(parada.fin)) return parada;
    return { ...parada, inicio: new Date(inicio).toISOString(), fin: new Date(fin).toISOString(), duracionMin: (fin - inicio) / 60000 };
  });
}

function distanciaM(a: { latitud: number; longitud: number }, b: { latitud: number; longitud: number }): number {
  const dLat = (b.latitud - a.latitud) * 111320;
  const dLon = (b.longitud - a.longitud) * 111320 * Math.cos(((a.latitud + b.latitud) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

// Una parada no puede seguir contando cuando la persona ya se fue: si el último
// tramo (o el primero) está a más de BORDE_M del centro real de la parada, con
// puntos precisos, al menos COLA_MIN_PUNTOS lecturas, COLA_MIN_MS de duración, llega a
// COLA_LEJOS_M y es un trazo posible (sin saltos imposibles ni vueltas), la parada
// termina (empieza) en el último (primer) punto cerca. El rebote bajo techo
// de 100-200 m no llega a COLA_LEJOS_M y no recorta nada. Con contador de
// pasos o actividad, también deben decir que se movió.
const COLA_MIN_PUNTOS = 3;
const COLA_MIN_MS = 60_000;
const COLA_LEJOS_M = 200;
const COLA_MIRA_MS = 15 * 60_000;
const COLA_MIN_PASOS = 10;
// Quien se va llega a COLA_LEJOS_M en pocos minutos; el que da vueltas por un
// centro comercial a 100 m de su centro lleva horas lejos y no se va.
const COLA_RAPIDEZ_MS = 10 * 60_000;
// Si lleva más de esto lejos del centro y todavía dentro de la parada, no se
// fue: cambió de sitio y se quedó (dos estancias a 150 m); no se recorta.
const COLA_MAX_DENTRO_MS = 30 * 60_000;
const CAMINATA_MIRA_MS = 5 * 60_000;

function mediana(v: number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

function colaSostenida(lejos: Punto[], cercano: Punto, centro: { latitud: number; longitud: number }, todas: Punto[], saliendo: boolean): boolean {
  if (lejos.length < COLA_MIN_PUNTOS) return false;
  const tiempos = lejos.map((p) => Date.parse(p.registradoEn));
  const t0 = Math.min(...tiempos);
  const t1 = Math.max(...tiempos);
  if (t1 - t0 < COLA_MIN_MS) return false;
  const alejado = Math.max(...lejos.map((p) => distanciaM(centro, p)));
  // Caminando (pasos a ritmo de marcha) no hace falta alejarse tanto: el
  // rebote bajo techo no da pasos (Diego 26/10 18:21, a la parada del bus a 120 m).
  // Se miran los primeros minutos (al salir) o los últimos (al llegar): después
  // puede subir a un bus o esperar quieto.
  const [w0, w1] = saliendo ? [t0, t0 + CAMINATA_MIRA_MS] : [t1 - CAMINATA_MIRA_MS, t1];
  const andando = caminando(todas.filter((p) => { const t = Date.parse(p.registradoEn); return t >= w0 && t <= w1; }));
  const lejosMin = andando ? BORDE_M : COLA_LEJOS_M;
  if (alejado < lejosMin) return false;
  // Saliendo: desde el primer punto lejos hasta el primero a COLA_LEJOS_M;
  // llegando: desde el último a COLA_LEJOS_M hasta el último lejos.
  const ordenados = [...lejos].sort((a, b) => Date.parse(a.registradoEn) - Date.parse(b.registradoEn));
  const lejanos = ordenados.filter((p) => distanciaM(centro, p) >= lejosMin);
  const tramo = saliendo ? Date.parse(lejanos[0].registradoEn) - t0 : t1 - Date.parse(lejanos[lejanos.length - 1].registradoEn);
  if (tramo > COLA_RAPIDEZ_MS) return false;
  const camino = [cercano, ...lejos].sort((a, b) => Date.parse(a.registradoEn) - Date.parse(b.registradoEn));
  const recorrido = camino.reduce((suma, p, i) => (i ? suma + distanciaM(camino[i - 1], p) : 0), 0);
  const saltos = camino.filter((p, i) => i > 0 && velocidadKmh(camino[i - 1], p) > SALTO_KMH).length;
  if (saltos > Math.floor(camino.length * SALTOS_TOLERADOS) || recorrido > ENREDO_MAX * 2 * alejado) return false;
  // Sensores del propio teléfono (si ese día sirven): no se fue con el teléfono quieto.
  const ventana = todas.filter((p) => { const t = Date.parse(p.registradoEn); return t >= t0 - 60_000 && t <= t1 + 60_000; });
  const enMovimiento = ventana.filter((p) => p.actividad != null && EN_MOVIMIENTO.has(p.actividad)).length;
  const antes = pasosEn(todas, t0 - 60_000);
  const despues = pasosEn(todas, t1 + 60_000);
  const pasos = antes != null && despues != null && despues >= antes ? despues - antes : null;
  if (contadorDePasosFiable(todas)) return (pasos != null && pasos >= COLA_MIN_PASOS) || enMovimiento >= 2;
  if (actividadReportada(todas)) return enMovimiento >= 2 || ventana.some((p) => (p.velocidadKmh ?? 0) > 5);
  return true;
}

function recortarColas(paradas: Parada[], huecos: Hueco[], posiciones: Punto[]): Parada[] {
  const otraJornada = huecos.filter((h) => h.motivo === 'FUERA_DE_JORNADA');
  const precisos = posiciones.filter((p) => (p.precisionM ?? 0) <= PRECISION_SALIDA_M);
  const t = (p: Punto) => Date.parse(p.registradoEn);
  return paradas.map((parada, i) => {
    let inicio = Date.parse(parada.inicio);
    let fin = Date.parse(parada.fin);
    const propios = precisos.filter((p) => t(p) >= inicio && t(p) <= fin);
    if (propios.length < 3) return parada;
    const centro = { latitud: mediana(propios.map((p) => p.latitud)), longitud: mediana(propios.map((p) => p.longitud)) };
    const tope = Math.min(i < paradas.length - 1 ? Date.parse(paradas[i + 1].inicio) : Infinity, fin + COLA_MIRA_MS, ...otraJornada.map((h) => Date.parse(h.desde)).filter((x) => x >= fin));
    const piso = Math.max(i > 0 ? Date.parse(paradas[i - 1].fin) : -Infinity, inicio - COLA_MIRA_MS, ...otraJornada.map((h) => Date.parse(h.hasta)).filter((x) => x <= inicio));
    const lejosDe = (p: Punto) => distanciaM(centro, p) > BORDE_M;
    // Salida: de afuera hacia adentro desde el fin.
    const dentroS = [...propios].reverse();
    const kS = dentroS.findIndex((p) => !lejosDe(p));
    if (kS > 0) {
      const fuera = precisos.filter((p) => t(p) > fin && t(p) < tope);
      const jS = fuera.findIndex((p) => !lejosDe(p));
      const lejos = [...dentroS.slice(0, kS), ...(jS < 0 ? fuera : fuera.slice(0, jS))];
      if (fin - t(dentroS[kS]) <= COLA_MAX_DENTRO_MS && colaSostenida(lejos, dentroS[kS], centro, posiciones, true)) fin = t(dentroS[kS]);
    }
    // Llegada: de afuera hacia adentro desde el inicio.
    const kL = propios.findIndex((p) => !lejosDe(p));
    if (kL > 0) {
      const fuera = precisos.filter((p) => t(p) < inicio && t(p) > piso).reverse();
      const jL = fuera.findIndex((p) => !lejosDe(p));
      const lejos = [...propios.slice(0, kL), ...(jL < 0 ? fuera : fuera.slice(0, jL))];
      if (t(propios[kL]) - inicio <= COLA_MAX_DENTRO_MS && colaSostenida(lejos, propios[kL], centro, posiciones, false)) inicio = t(propios[kL]);
    }
    if (fin - inicio < SALIDA_MIN_MS || (inicio === Date.parse(parada.inicio) && fin === Date.parse(parada.fin))) return parada;
    return { ...parada, inicio: new Date(inicio).toISOString(), fin: new Date(fin).toISOString(), duracionMin: (fin - inicio) / 60000 };
  });
}

// Una "salida" de más de esto dentro de una parada es casi seguro cambiar de
// sitio y quedarse (dos estancias a 150 m), no un viaje: se deja la parada entera.
const VIAJE_TAPADO_MAX_MS = 30 * 60_000;

// La parada del servidor puede tapar un viaje de ida y vuelta (salidasDuranteParada,
// la misma regla que dibuja el viaje): se parte en dos. Los pedazos de menos de
// SALIDA_MIN_MS se descartan.
function partirPorViajes(paradas: Parada[], posiciones: Punto[], pasosFiables: boolean, actividadFiable: boolean): Parada[] {
  return paradas.flatMap((parada) => {
    const salidas = salidasDuranteParada(parada, posiciones, pasosFiables, actividadFiable).filter(([a, b]) => b - a <= VIAJE_TAPADO_MAX_MS);
    if (salidas.length === 0) return [parada];
    const trozos: Parada[] = [];
    let desde = Date.parse(parada.inicio);
    for (const [a, b] of [...salidas, [Date.parse(parada.fin), -1] as [number, number]]) {
      if (a - desde >= SALIDA_MIN_MS) trozos.push({ ...parada, inicio: new Date(desde).toISOString(), fin: new Date(a).toISOString(), duracionMin: (a - desde) / 60000 });
      if (b > 0) desde = b;
    }
    return trozos.length > 0 ? trozos : [parada];
  });
}

// Minutos sin datos dentro de la parada o pegados a sus bordes (un corte que
// termina donde empieza, o empieza donde termina): la duración los incluye.
const CORTE_BORDE_MS = 2 * 60_000;
function marcarCortes(paradas: Parada[], huecos: Hueco[]): Parada[] {
  const cortes = huecos.filter((h) => h.motivo !== 'FUERA_DE_JORNADA');
  return paradas.map((p) => {
    const a = Date.parse(p.inicio);
    const b = Date.parse(p.fin);
    const suma = cortes.reduce((s, h) => {
      const d = Date.parse(h.desde);
      const f = Date.parse(h.hasta);
      const toca = f > a - CORTE_BORDE_MS && d < b + CORTE_BORDE_MS;
      return toca ? s + Math.max(0, Math.min(f, b + CORTE_BORDE_MS) - Math.max(d, a - CORTE_BORDE_MS)) : s;
    }, 0);
    return suma >= 60_000 ? { ...p, cortesMin: Math.round(suma / 60_000) } : p;
  });
}
