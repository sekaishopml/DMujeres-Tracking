// Novedades que se marcan en rojo sobre el trazado, para que quien audita las
// vea sin leer tablas: dónde se cortó el recorrido (y por qué) y dónde volvió,
// y desde dónde el teléfono guardó puntos sin internet.
//
// Sin imports del panel para poder probarlo con node.

interface Punto {
  latitud: number;
  longitud: number;
  registradoEn: string;
  recibidoEn?: string | null;
  bateriaPct?: number | null;
}

interface Corte {
  desde: string;
  hasta: string;
  motivo?: string | null;
}

export interface Novedad {
  lon: number;
  lat: number;
  // Índice del punto en el recorrido (para elegirlo al pulsar).
  indice: number;
  titulo: string;
  detalle: string;
}

const ms = (iso: string) => new Date(iso).getTime();

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Guayaquil' });

function metros(a: Punto, b: Punto): number {
  const dLat = (b.latitud - a.latitud) * 111320;
  const dLon = (b.longitud - a.longitud) * 111320 * Math.cos(((a.latitud + b.latitud) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

function duracion(segundos: number): string {
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  return min % 60 === 0 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

const QUE_PASO: Record<string, string> = {
  APAGADO: 'Apagó el teléfono',
  GPS_APAGADO: 'Apagó la ubicación',
  SIN_PERMISO: 'Quitó el permiso de ubicación',
  SIN_CONTACTO: 'App detenida o sin datos',
  SIN_SENAL: 'Sin señal GPS',
};

// Con esta batería o menos antes de un apagado, se dice "sin batería".
const BATERIA_AGOTADA_PCT = 5;
// Si al volver está a esta distancia o más, se marcan los dos lugares.
const SEPARADOS_M = 150;
// Puntos que llegaron al servidor con este atraso o más: no tenía internet.
const ATRASO_SIN_INTERNET_MS = 15 * 60_000;

function indiceAntes(posiciones: Punto[], instante: number): number {
  let i = 0;
  while (i + 1 < posiciones.length && ms(posiciones[i + 1].registradoEn) <= instante) i += 1;
  return i;
}

export function novedadesDelRecorrido(posiciones: Punto[], cortes: Corte[]): Novedad[] {
  const novedades: Novedad[] = [];
  for (const corte of cortes) {
    if (corte.motivo === 'FUERA_DE_JORNADA') continue;
    const i = indiceAntes(posiciones, ms(corte.desde));
    const antes = posiciones[i];
    const despues = posiciones[i + 1];
    if (!antes || !despues) continue;
    const agotada = antes.bateriaPct != null && antes.bateriaPct <= BATERIA_AGOTADA_PCT;
    const motivo = corte.motivo ?? 'SIN_SENAL';
    const que = agotada && (motivo === 'APAGADO' || motivo === 'SIN_CONTACTO') ? 'Se quedó sin batería' : QUE_PASO[motivo] ?? QUE_PASO.SIN_SENAL;
    const lapso = `${hora(antes.registradoEn)} a ${hora(despues.registradoEn)} · ${duracion((ms(despues.registradoEn) - ms(antes.registradoEn)) / 1000)}`;
    if (metros(antes, despues) < SEPARADOS_M) {
      novedades.push({ lon: antes.longitud, lat: antes.latitud, indice: i, titulo: que, detalle: lapso });
      continue;
    }
    novedades.push({ lon: antes.longitud, lat: antes.latitud, indice: i, titulo: `${que} aquí`, detalle: lapso });
    novedades.push({ lon: despues.longitud, lat: despues.latitud, indice: i + 1, titulo: 'Aquí volvió', detalle: lapso });
  }
  // Tramos guardados sin internet: se marca dónde empezó cada uno.
  for (let i = 0; i < posiciones.length; i += 1) {
    const p = posiciones[i];
    if (!p.recibidoEn || ms(p.recibidoEn) - ms(p.registradoEn) < ATRASO_SIN_INTERNET_MS) continue;
    const previo = posiciones[i - 1];
    if (previo?.recibidoEn && ms(previo.recibidoEn) - ms(previo.registradoEn) >= ATRASO_SIN_INTERNET_MS) continue;
    let j = i;
    while (posiciones[j + 1]?.recibidoEn && ms(posiciones[j + 1].recibidoEn!) - ms(posiciones[j + 1].registradoEn) >= ATRASO_SIN_INTERNET_MS) j += 1;
    novedades.push({
      lon: p.longitud,
      lat: p.latitud,
      indice: i,
      titulo: 'Sin internet desde aquí',
      detalle: `${hora(p.registradoEn)} a ${hora(posiciones[j].registradoEn)} · los puntos llegaron a las ${hora(posiciones[j].recibidoEn!)}`,
    });
  }
  return novedades;
}
