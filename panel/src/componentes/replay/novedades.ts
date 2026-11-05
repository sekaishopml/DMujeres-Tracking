// Novedades que se marcan en rojo sobre el trazado, para que quien audita las
// vea sin leer tablas: dónde se cortó el recorrido (y por qué) y dónde volvió,
// desde dónde el teléfono guardó puntos sin internet, y dónde la persona apagó
// o reactivó el GPS, un permiso o las notificaciones.
//
// Solo importa con ruta y extensión completas, para poder probarlo con node.
import { milisegundos } from '../../dominio/replay.ts';

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

interface Aviso {
  tipo: string;
  texto: string;
  en: string;
  categoria?: string;
}

export interface Novedad {
  lon: number;
  lat: number;
  // Índice del punto en el recorrido (para elegirlo al pulsar).
  indice: number;
  titulo: string;
  detalle: string;
  // Vuelta a la normalidad (GPS reactivado, red recuperada): se pinta en verde.
  recuperacion?: boolean;
}

const ms = milisegundos;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Guayaquil' });

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
  REINICIO_SIN_APP: 'Reinició el teléfono y la app no volvió',
  GPS_APAGADO: 'Apagó la ubicación',
  SIN_PERMISO: 'Quitó el permiso de ubicación',
  SIN_CONTACTO: 'App detenida o sin datos',
  SIN_SENAL: 'Sin señal GPS',
};

// Al iniciar la jornada no "apagó": ya estaba así.
const QUE_PASO_AL_INICIO: Record<string, string> = {
  APAGADO: 'teléfono apagado',
  REINICIO_SIN_APP: 'app sin volver tras reiniciar',
  GPS_APAGADO: 'ubicación apagada',
  SIN_PERMISO: 'sin permiso de ubicación',
  SIN_CONTACTO: 'app detenida o sin datos',
  SIN_SENAL: 'sin señal GPS',
};

// Con esta batería o menos antes de un apagado, se dice "sin batería".
const BATERIA_AGOTADA_PCT = 5;
// Si al volver está a esta distancia o más, se marcan los dos lugares.
const SEPARADOS_M = 150;
// Puntos que llegaron al servidor con este atraso o más: no tenía internet.
const ATRASO_SIN_INTERNET_MS = 15 * 60_000;

// Avisos que ya explican un corte: si caen dentro de uno con esa causa, el
// corte ya lo dice y no se repite.
const CAUSA_DE_AVISO: Record<string, string> = {
  mobileGpsDisabled: 'GPS_APAGADO',
  mobilePermissionLost: 'SIN_PERMISO',
  mobilePowerOff: 'APAGADO',
  mobileShutdown: 'APAGADO',
};
const MARGEN_CORTE_MS = 2 * 60_000;

function indiceAntes(posiciones: Punto[], instante: number): number {
  let i = 0;
  while (i + 1 < posiciones.length && ms(posiciones[i + 1].registradoEn) <= instante) i += 1;
  return i;
}

// Con más cortes seguidos en el mismo sitio, se leen como una sola señal débil.
const MIN_CORTES_SENAL_DEBIL = 4;

interface CorteUbicado {
  corte: Corte;
  i: number;
  antes: Punto;
  despues: Punto;
}

function novedadesDeCorte({ corte, i, antes, despues }: CorteUbicado): Novedad[] {
  const agotada = antes.bateriaPct != null && antes.bateriaPct <= BATERIA_AGOTADA_PCT;
  const motivo = corte.motivo ?? 'SIN_SENAL';
  const que = agotada && (motivo === 'APAGADO' || motivo === 'SIN_CONTACTO') ? 'Se quedó sin batería' : QUE_PASO[motivo] ?? QUE_PASO.SIN_SENAL;
  const lapso = `${hora(antes.registradoEn)} a ${hora(despues.registradoEn)} · ${duracion((ms(despues.registradoEn) - ms(antes.registradoEn)) / 1000)}`;
  if (metros(antes, despues) < SEPARADOS_M) {
    return [{ lon: antes.longitud, lat: antes.latitud, indice: i, titulo: que, detalle: lapso }];
  }
  return [
    { lon: antes.longitud, lat: antes.latitud, indice: i, titulo: `${que} aquí`, detalle: lapso },
    { lon: despues.longitud, lat: despues.latitud, indice: i + 1, titulo: 'Aquí volvió', detalle: lapso },
  ];
}

// Cortes seguidos y en el mismo lugar: si son muchos, una sola "Señal débil".
function novedadesDeCortes(posiciones: Punto[], cortes: Corte[]): Novedad[] {
  const ubicados: CorteUbicado[] = [];
  const novedadesInicio: Novedad[] = [];
  for (const corte of cortes) {
    if (corte.motivo === 'FUERA_DE_JORNADA') continue;
    // Corte desde el inicio de la jornada hasta el primer punto: se marca en
    // el primer punto con su lapso.
    if (posiciones.length > 0 && ms(corte.desde) < ms(posiciones[0].registradoEn)) {
      const que = QUE_PASO_AL_INICIO[corte.motivo ?? 'SIN_SENAL'] ?? QUE_PASO_AL_INICIO.SIN_SENAL;
      novedadesInicio.push({
        lon: posiciones[0].longitud,
        lat: posiciones[0].latitud,
        indice: 0,
        titulo: `Inició la jornada sin ruta: ${que}`,
        detalle: `${hora(corte.desde)} a ${hora(corte.hasta)} · ${duracion((ms(corte.hasta) - ms(corte.desde)) / 1000)}`,
      });
      continue;
    }
    const i = indiceAntes(posiciones, ms(corte.desde));
    const antes = posiciones[i];
    const despues = posiciones[i + 1];
    if (!antes || !despues) continue;
    ubicados.push({ corte, i, antes, despues });
  }
  const grupos: CorteUbicado[][] = [];
  for (const u of ubicados) {
    const grupo = grupos[grupos.length - 1];
    const primero = grupo?.[0];
    const seguido =
      primero != null &&
      (grupo[grupo.length - 1].corte.motivo ?? 'SIN_SENAL') === 'SIN_SENAL' &&
      (u.corte.motivo ?? 'SIN_SENAL') === 'SIN_SENAL' &&
      metros(primero.antes, u.antes) < SEPARADOS_M;
    if (seguido) grupo.push(u);
    else grupos.push([u]);
  }
  return novedadesInicio.concat(grupos.flatMap((grupo) => {
    if (grupo.length < MIN_CORTES_SENAL_DEBIL) return grupo.flatMap(novedadesDeCorte);
    const primero = grupo[0];
    const ultimo = grupo[grupo.length - 1];
    return [
      {
        lon: primero.antes.longitud,
        lat: primero.antes.latitud,
        indice: primero.i,
        titulo: 'Señal débil',
        detalle: `${hora(primero.antes.registradoEn)} a ${hora(ultimo.despues.registradoEn)} · ${duracion((ms(ultimo.despues.registradoEn) - ms(primero.antes.registradoEn)) / 1000)}`,
      },
    ];
  }));
}

// Corte desde el inicio de la jornada hasta el primer punto (si lo hay): la
// línea de tiempo empieza en él y la lectura del primer punto lo dice, para
// que el primer punto no parezca el inicio del día.
export function corteAlInicio(posiciones: Punto[], cortes: Corte[]): Corte | null {
  if (posiciones.length === 0) return null;
  const primero = ms(posiciones[0].registradoEn);
  let elegido: Corte | null = null;
  for (const c of cortes) {
    if (c.motivo === 'FUERA_DE_JORNADA' || ms(c.desde) >= primero) continue;
    if (!elegido || ms(c.desde) < ms(elegido.desde)) elegido = c;
  }
  return elegido;
}

export function textoCorteAlInicio(corte: Corte): string {
  return `Sin ruta: ${QUE_PASO_AL_INICIO[corte.motivo ?? 'SIN_SENAL'] ?? QUE_PASO_AL_INICIO.SIN_SENAL}`;
}

export function novedadesDelRecorrido(posiciones: Punto[], cortes: Corte[], avisos: Aviso[] = []): Novedad[] {
  const novedades: Novedad[] = novedadesDeCortes(posiciones, cortes);
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
  // Avisos del teléfono: se marcan donde estaba la persona a esa hora.
  for (const aviso of avisos) {
    if (posiciones.length === 0) break;
    const instante = ms(aviso.en);
    const causa = CAUSA_DE_AVISO[aviso.tipo];
    const yaDicho = cortes.some(
      (c) => causa != null && c.motivo === causa && instante >= ms(c.desde) - MARGEN_CORTE_MS && instante <= ms(c.hasta),
    );
    if (yaDicho) continue;
    const i = indiceAntes(posiciones, instante);
    novedades.push({
      lon: posiciones[i].longitud,
      lat: posiciones[i].latitud,
      indice: i,
      titulo: aviso.texto,
      detalle: `A las ${hora(aviso.en)}`,
      recuperacion: aviso.categoria === 'recuperacion',
    });
  }
  return novedades;
}
