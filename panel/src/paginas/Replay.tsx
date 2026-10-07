import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LngLatBounds, Marker } from 'maplibre-gl';
import type { GeoJSONSource, Map as TipoMapa } from 'maplibre-gl';
import { GUION } from '@/dominio/formatoBase';
import type { Cobertura } from '@/dominio/dia';
import Icono from '@/componentes/replay/Icono';
import MapaRaster, { CAPAS_REPLAY, CAPA_INICIAL_REPLAY } from '@/componentes/mapa/MapaBase';
import ReproductorReplay, {
  InsigniasParadas,
  LineaTiempoReplay,
  ListaParadas,
  PanelPuntoSeleccionado,
} from '@/componentes/replay/ReproductorReplay';
import FiltroReplay from '@/componentes/replay/FiltroReplay';
import { flechasDeLineas, lineasDeRecorrido, sinPicos } from '@/componentes/replay/flechas';
import {
  COLOR_POR_HORA,
  fraccionDelDia,
  segmentosParaDibujar,
} from '@/componentes/replay/trazo';
import { depurarRecorrido } from '@/dominio/depuracion';
import { traerFlota, traerJornadas, traerParadas, traerReplay, CACHE_AUDITORIA_MS, CLAVE_FLOTA, equiposHabilitados } from '@/dominio/datos';
import { ordenarPorDepartamento } from '@/dominio/departamentos';
import { coberturaDe, resumenDia } from '@/dominio/dia';
import { esNoEncontrado, mensajeError } from '@/dominio/errores';
import {
  aColeccion,
  aColeccionHalos,
  detencionesDeRecorrido,
  halosDeParadas,
  horaCorta,
  indiceCercaDeInstante,
  microparadasDeRecorrido,
  milisegundos,
  normalizarReconstruidos,
  puntosQuietos,
} from '@/dominio/replay';
import type { Parada, TramoReconstruido } from '@/dominio/replay';
import { fechaHoyLocal, finDeDia, inicioDeDia } from '@/dominio/rango';
import '@/componentes/replay/replay.css';
import type { Hueco, ReplayCalidad } from '@contratos';

// Lectura de auditoría del recorrido: cuánto es observado y qué se apartó.
// El trazado sólido es GPS registrado; lo ajustado a vía sigue calles solo
// entre observaciones; lo estimado se limita a saltos cortos coherentes y el
// resto queda punteado como "sin observación". Aquí se dice en una línea.
function IntegridadRecorrido({
  totalFixes,
  simuladas,
  huecos,
  reconstruidos,
  calidad,
}: {
  totalFixes: number;
  simuladas: number;
  huecos: Hueco[];
  reconstruidos: TramoReconstruido[];
  calidad?: ReplayCalidad;
}) {
  const cortes = huecos.filter((hueco) => hueco.motivo !== 'FUERA_DE_JORNADA');
  const minutosSinSenal = Math.round(cortes.reduce((suma, hueco) => suma + hueco.duracionSegundos, 0) / 60);
  const estimados = reconstruidos.filter((tramo) => tramo.metodo === 'ESTIMATED').length;
  const apartados = (calidad?.descartadasFueraDeZona ?? 0) + (calidad?.descartadasSalto ?? 0);
  const sinSenal =
    cortes.length === 0
      ? 'sin cortes de señal'
      : `${cortes.length} ${cortes.length === 1 ? 'corte' : 'cortes'} de señal (${formatoMinutos(minutosSinSenal)})`;
  return (
    <section className="replay-integridad" aria-label="Integridad del recorrido">
      <p>
        <strong>{totalFixes.toLocaleString('es-EC')}</strong> puntos GPS · {sinSenal}
        {estimados > 0 && ` · ${estimados} ${estimados === 1 ? 'salto estimado' : 'saltos estimados'} por calle`}
      </p>
      {apartados > 0 && (
        <p className="replay-nota">
          {apartados} {apartados === 1 ? 'punto imposible apartado' : 'puntos imposibles apartados'} del trazado
          {calidad?.descartadasFueraDeZona ? ` (${calidad.descartadasFueraDeZona} fuera de zona)` : ''}.
        </p>
      )}
      {simuladas > 0 && (
        <p className="replay-alerta">
          {simuladas} {simuladas === 1 ? 'punto fue marcado' : 'puntos fueron marcados'} por el teléfono como ubicación
          simulada (GPS falso).
        </p>
      )}
      {calidad?.posibleOrigenMultiple && (
        <p className="replay-alerta">
          La posición alterna entre sitios a varios kilómetros: probablemente hay otra sesión abierta con esta cuenta
          en un segundo teléfono.
        </p>
      )}
    </section>
  );
}

function formatoMinutos(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

// Botón de información sobre el mapa (abajo a la derecha): abre la lectura de
// auditoría del recorrido y la cobertura de señal.
function InfoRecorrido({
  totalFixes,
  simuladas,
  huecos,
  reconstruidos,
  calidad,
  cobertura,
}: {
  totalFixes: number;
  simuladas: number;
  huecos: Hueco[];
  reconstruidos: TramoReconstruido[];
  calidad?: ReplayCalidad;
  cobertura: Cobertura;
}) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="replay-info maplibregl-ctrl-bottom-right">
      {abierta && (
        <section className="replay-info-panel" aria-label="Información del recorrido">
          <h3>Información del recorrido</h3>
          <p className="replay-info-cobertura">
            <span>Cobertura</span>
            <strong>{cobertura.porcentaje == null ? GUION : `${Math.round(cobertura.porcentaje)} %`}</strong>
          </p>
          <IntegridadRecorrido totalFixes={totalFixes} simuladas={simuladas} huecos={huecos} reconstruidos={reconstruidos} calidad={calidad} />
        </section>
      )}
      {/* Mismo control y mismo aspecto que el botón de atribución del mapa,
          que aquí se oculta: ocupa su lugar. */}
      <details className="maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact info-recorrido">
        <summary
          className="maplibregl-ctrl-attrib-button"
          onClick={(evento) => {
            evento.preventDefault();
            setAbierta((v) => !v);
          }}
          title="Información del recorrido"
          aria-label="Información del recorrido"
          aria-expanded={abierta}
        />
      </details>
    </div>
  );
}

// Nombre de archivo sin caracteres problemáticos (mismo criterio que
// Historial).
function nombreArchivo(id: string): string {
  return id.replace(/[^\w.-]+/g, '_');
}

// Lienzo nativo de la flecha: 64 px registrados con pixelRatio 2 (32 px
// lógicos). Se dibuja a resolución nativa y se muestra reducido por icon-size,
// así que la punta conserva el filo en pantallas densas.
const LADO_FLECHA = 64;
const PIXEL_RATIO_FLECHA = 2;
// Núcleo claro de la flecha: se lee sobre la línea azul y sobre satélite.
const NUCLEO_FLECHA = '#ffffff';
// Trazado: una sola línea azul marino con borde blanco, que se lee igual sobre
// calles y satélite. Lo estimado va punteado en el mismo azul y la falta de señal en
// ámbar con guiones: nunca se confunden con GPS registrado.
const COLOR_RUTA = '#17365d';
const COLOR_BORDE = '#ffffff';
const COLOR_SIN_SENAL = '#c46a00';
const ID_FLECHA = 'dir-ruta';
const MIN_PARADA_MS = 3 * 60_000;
const REFRESCO_VIVO_MS = 15_000;
const REFRESCO_VIVO_PARADAS_MS = 60_000;
// Punta de flecha blanca hacia el norte, registrada como imagen del mapa. El
// disco de color (según la hora) lo dibuja la capa replay-flechas-disco debajo;
// la capa replay-flechas gira la punta con el rumbo de cada tramo.
function imagenDireccion(nucleo: string): ImageData | null {
  const lienzo = document.createElement('canvas');
  lienzo.width = LADO_FLECHA;
  lienzo.height = LADO_FLECHA;
  const contexto = lienzo.getContext('2d');
  if (!contexto) return null;
  const c = LADO_FLECHA / 2;
  contexto.beginPath();
  contexto.moveTo(c, 14);
  contexto.lineTo(c + 13, 44);
  contexto.lineTo(c, 36);
  contexto.lineTo(c - 13, 44);
  contexto.closePath();
  contexto.fillStyle = nucleo;
  contexto.fill();
  return contexto.getImageData(0, 0, LADO_FLECHA, LADO_FLECHA);
}

// Posición de la etiqueta respecto del pin. Cuando dos extremos caen en el
// mismo lugar (ida y vuelta, jornada que empieza y termina en el mismo sitio)
// sus etiquetas se pisaban: cada una prueba primero su lado y, si está
// ocupado, se corre hasta encontrar lugar. Nunca quedan dos textos encimados.
type UbicacionEtiqueta = 'derecha' | 'izquierda' | 'arriba' | 'abajo';

// Orden de lados por tipo: el extremo del recorrido cuelga a la derecha y el
// de la jornada a la izquierda, de modo que un pin compartido quede flanqueado.
const ORDEN_UBICACIONES: Record<string, UbicacionEtiqueta[]> = {
  inicio: ['derecha', 'arriba', 'abajo', 'izquierda'],
  fin: ['derecha', 'abajo', 'arriba', 'izquierda'],
  'jornada-inicio': ['izquierda', 'arriba', 'abajo', 'derecha'],
  'jornada-fin': ['izquierda', 'abajo', 'arriba', 'derecha'],
};

// Cascada de separación: la primera pasada cuelga a la altura del pin; las
// siguientes apilan la píldora una fila arriba/abajo (34 px = píldora + aire).
// El inicio prefiere subir y el fin bajar, como en una lista.
const DESPLAZAMIENTOS_INICIO = [0, -34, 34, -68, 68];
const DESPLAZAMIENTOS_FIN = [0, 34, -34, 68, -68];

// El choque se mide en píxeles de pantalla, no en metros: con zoom de ciudad
// dos pines a más de un kilómetro pueden encimar sus etiquetas. Las medidas
// salen de operacion.css (el ancho se calcula un poco de más).
const ALTO_ETIQUETA = 26;
const FUERA_HORIZONTAL = 5;
const FUERA_VERTICAL = 6;

function anchoEtiqueta(texto: string): number {
  return 12 + texto.length * 6.4;
}

interface RanuraEtiqueta {
  ubicacion: UbicacionEtiqueta;
  desplazamiento: number;
}

interface CajaEtiqueta {
  izquierda: number;
  arriba: number;
  derecha: number;
  abajo: number;
}

function cajaRanura(ranura: RanuraEtiqueta, x: number, y: number, ancho: number): CajaEtiqueta {
  const { ubicacion, desplazamiento } = ranura;
  switch (ubicacion) {
    case 'izquierda':
      return {
        izquierda: x - FUERA_HORIZONTAL - ancho,
        arriba: y - ALTO_ETIQUETA / 2 + desplazamiento,
        derecha: x - FUERA_HORIZONTAL,
        abajo: y + ALTO_ETIQUETA / 2 + desplazamiento,
      };
    case 'arriba':
      return {
        izquierda: x - ancho / 2 + desplazamiento,
        arriba: y - FUERA_VERTICAL - ALTO_ETIQUETA,
        derecha: x + ancho / 2 + desplazamiento,
        abajo: y - FUERA_VERTICAL,
      };
    case 'abajo':
      return {
        izquierda: x - ancho / 2 + desplazamiento,
        arriba: y + FUERA_VERTICAL,
        derecha: x + ancho / 2 + desplazamiento,
        abajo: y + FUERA_VERTICAL + ALTO_ETIQUETA,
      };
    default:
      return {
        izquierda: x + FUERA_HORIZONTAL,
        arriba: y - ALTO_ETIQUETA / 2 + desplazamiento,
        derecha: x + FUERA_HORIZONTAL + ancho,
        abajo: y + ALTO_ETIQUETA / 2 + desplazamiento,
      };
  }
}

function cajasCruzan(a: CajaEtiqueta, b: CajaEtiqueta): boolean {
  return a.izquierda < b.derecha && b.izquierda < a.derecha && a.arriba < b.abajo && b.arriba < a.abajo;
}

interface EtiquetaExtremo {
  clave: string;
  caja: CajaEtiqueta;
}

// Prueba cada posición del tipo y se queda con la primera que no choca con
// otra ya puesta. Si todas chocan (no pasa con cuatro extremos), usa la
// natural.
function elegirRanura(
  registro: { current: EtiquetaExtremo[] },
  mapa: TipoMapa,
  clase: string,
  texto: string,
  latitud: number,
  longitud: number,
): RanuraEtiqueta {
  const lados = ORDEN_UBICACIONES[clase] ?? ORDEN_UBICACIONES.inicio;
  const desplazamientos = clase.endsWith('fin') ? DESPLAZAMIENTOS_FIN : DESPLAZAMIENTOS_INICIO;
  const candidatas: RanuraEtiqueta[] = lados.flatMap((ubicacion) =>
    desplazamientos.map((desplazamiento) => ({ ubicacion, desplazamiento })),
  );
  const punto = mapa.project([longitud, latitud]);
  const ancho = anchoEtiqueta(texto);
  const elegida =
    candidatas.find((ranura) =>
      registro.current.every(
        (etiqueta) => !cajasCruzan(cajaRanura(ranura, punto.x, punto.y, ancho), etiqueta.caja),
      ),
    ) ?? candidatas[0];
  registro.current = registro.current.filter((etiqueta) => etiqueta.clave !== clase);
  registro.current.push({ clave: clase, caja: cajaRanura(elegida, punto.x, punto.y, ancho) });
  return elegida;
}

// Libera las ranuras de los extremos retirados (cambio de recorrido o de
// mapa) para que el siguiente encuadre reparta desde cero.
function liberarUbicaciones(registro: { current: EtiquetaExtremo[] }, claves: string[]): void {
  registro.current = registro.current.filter((etiqueta) => !claves.includes(etiqueta.clave));
}

// Marcador de extremo con etiqueta ("Inicio 08:12"): el punto queda en la
// coordenada y la etiqueta cuelga de la posición asignada sin mover el
// punto. El corrimiento se aplica como margen.
function marcadorExtremo(
  mapa: TipoMapa,
  clase: string,
  texto: string,
  latitud: number,
  longitud: number,
  ranura: RanuraEtiqueta,
): Marker {
  const elemento = document.createElement('div');
  elemento.className = `marcador-extremo ${clase} etiqueta-${ranura.ubicacion}`;
  const punto = document.createElement('span');
  punto.className = 'extremo-punto';
  const etiqueta = document.createElement('span');
  etiqueta.className = 'extremo-etiqueta';
  etiqueta.textContent = texto;
  if (ranura.desplazamiento !== 0) {
    if (ranura.ubicacion === 'derecha' || ranura.ubicacion === 'izquierda') {
      etiqueta.style.marginTop = `${ranura.desplazamiento}px`;
    } else {
      etiqueta.style.marginLeft = `${ranura.desplazamiento}px`;
    }
  }
  elemento.append(punto, etiqueta);
  return new Marker({ element: elemento, anchor: 'center' }).setLngLat([longitud, latitud]).addTo(mapa);
}

export default function Replay() {
  const [parametros] = useSearchParams();
  const [dispositivoId, setDispositivoId] = useState(parametros.get('dispositivo') ?? '');
  // Por defecto se muestra el día anterior completo: lo que se revisa es lo
  // que pasó ayer. La dirección o el filtro lo pueden cambiar.
  const [desde, setDesde] = useState(parametros.get('desde') ?? fechaHoyLocal());
  const [hasta, setHasta] = useState(parametros.get('hasta') ?? fechaHoyLocal());
  const [mapa, setMapa] = useState<TipoMapa | null>(null);
  const [panelRecogido, setPanelRecogido] = useState(false);
  // Posiciones ocupadas por las etiquetas de los extremos, para que dos pines
  // juntos no encimen sus textos. Va en un ref para no redibujar por él.
  const etiquetasExtremos = useRef<EtiquetaExtremo[]>([]);

  const flota = useQuery({ queryKey: CLAVE_FLOTA, queryFn: () => traerFlota() });
  // Solo los equipos habilitados aparecen en el selector y en las consultas.
  const equipos = useMemo(
    () => ordenarPorDepartamento(equiposHabilitados(flota.data?.datos ?? []), (e) => e.departamento),
    [flota.data],
  );
  // La selección es válida solo si apunta a un equipo de la flota habilitada.
  // Una URL o un estado previo hacia un equipo deshabilitado se resuelve a la
  // primera unidad disponible sin disparar consultas del equipo dado de baja.
  const seleccionado = useMemo(
    () =>
      equipos.some((equipo) => equipo.idPublico === dispositivoId)
        ? dispositivoId
        : equipos[0]?.idPublico ?? '',
    [dispositivoId, equipos],
  );
  const rangoValido = desde !== '' && hasta !== '' && desde <= hasta;

  // Si el equipo elegido dejó de ser válido (dado de baja o lista vacía), la
  // selección se corrige para no apuntar a un equipo que no está.
  useEffect(() => {
    if (!flota.data || dispositivoId === seleccionado) return;
    setDispositivoId(seleccionado);
  }, [flota.data, dispositivoId, seleccionado]);

  // En vivo: si el rango llega a hoy, el recorrido se vuelve a pedir cada
  // 15 s y la ruta se va dibujando sola. Los días pasados no se refrescan.
  const enVivo = rangoValido && hasta === fechaHoyLocal();
  const replay = useQuery({
    queryKey: ['replay', seleccionado, desde, hasta],
    queryFn: () => traerReplay(seleccionado, inicioDeDia(desde), finDeDia(hasta)),
    enabled: seleccionado !== '' && rangoValido,
    staleTime: enVivo ? 0 : CACHE_AUDITORIA_MS,
    refetchInterval: enVivo ? REFRESCO_VIVO_MS : false,
    refetchIntervalInBackground: false,
  });

  // Paradas del servidor, en paralelo. Si fallan se usan las calculadas aquí
  // y se avisa; mientras cargan se muestran sin aviso.
  const paradasConsulta = useQuery({
    queryKey: ['paradas', seleccionado, desde, hasta],
    queryFn: () => traerParadas(seleccionado, inicioDeDia(desde), finDeDia(hasta)),
    enabled: seleccionado !== '' && rangoValido,
    staleTime: enVivo ? 0 : CACHE_AUDITORIA_MS,
    refetchInterval: enVivo ? REFRESCO_VIVO_PARADAS_MS : false,
  });

  // Jornadas del equipo en ese rango, para marcar inicio y fin en el mapa. Si
  // no hay dato o hay error se muestra "—", sin avisos ni reintentos.
  const jornadasConsulta = useQuery({
    queryKey: ['jornadas', seleccionado, desde, hasta],
    queryFn: () => traerJornadas(seleccionado, inicioDeDia(desde), finDeDia(hasta)),
    enabled: seleccionado !== '' && rangoValido,
    retry: false,
    staleTime: enVivo ? 0 : CACHE_AUDITORIA_MS,
    refetchInterval: enVivo ? REFRESCO_VIVO_PARADAS_MS : false,
  });

  const { posiciones, estancias } = useMemo(() => {
    const lista = [...(replay.data?.posiciones ?? [])];
    // La API ya ordena por hora del fix; se reordena como defensa para que la
    // línea y la reproducción nunca retrocedan si el orden cambia.
    lista.sort((a, b) => milisegundos(a.registradoEn) - milisegundos(b.registradoEn));
    // Sin picos de ruido y con cada estancia llevada a su centro: la línea, el
    // marcador, las flechas y el slider trabajan sobre el mismo recorrido.
    return depurarRecorrido(lista);
  }, [replay.data]);

  const huecos = useMemo(() => replay.data?.huecos ?? [], [replay.data]);
  // Tramos reconstruidos por el servidor (`reconstruidos`, con método; la
  // forma anterior `estimados` se toma como ESTIMATED en replay.ts). Se quitan
  // los picos de ida y vuelta del ajuste a calles: ese pedacito nunca se
  // recorrió.
  const reconstruidos = useMemo<TramoReconstruido[]>(
    () => normalizarReconstruidos(replay.data).map((tramo) => ({ ...tramo, trazado: sinPicos(tramo.trazado) })),
    [replay.data],
  );
  const paradasServidor = useMemo<Parada[] | null>(() => {
    const datos = paradasConsulta.data?.datos;
    if (!datos) return null;
    // Se filtra por el id numérico del recorrido, porque cada fila trae el id
    // público de la parada y no el del equipo.
    const dispositivo = replay.data?.dispositivo.id ?? null;
    return datos
      .filter((parada) => dispositivo == null || parada.dispositivoId === dispositivo)
      .map((parada) => ({
        inicio: parada.inicio,
        fin: parada.fin,
        duracionMin: parada.duracionMin,
        latitud: parada.latitud,
        longitud: parada.longitud,
        direccion: parada.direccion,
        latitudRepresentativa: parada.latitudRepresentativa,
        longitudRepresentativa: parada.longitudRepresentativa,
        precisionM: parada.precisionM,
      }))
      .filter((parada) => Number.isFinite(parada.latitud) && Number.isFinite(parada.longitud))
      // El API ordena por inicio descendente; la lista se lee en orden de
      // recorrido para que la primera parada sea la del inicio de la jornada.
      .sort((a, b) => milisegundos(a.inicio) - milisegundos(b.inicio));
  }, [paradasConsulta.data, replay.data]);

  // Respaldo local: las detenciones necesitan los huecos para descartar rachas
  // que cruzan una pérdida de señal; sin ellos vuelven las duraciones absurdas
  // (1 h 54 min).
  const paradasLocales = useMemo(() => detencionesDeRecorrido(posiciones, huecos), [posiciones, huecos]);
  // Paradas: las del servidor más las estancias de 3 min o más que el
  // servidor no vio (su regla es por velocidad y el temblor del GPS la
  // confunde). Cada parada va en el centro de su estancia, por donde pasa la
  // línea.
  const paradas = useMemo(() => {
    const base = paradasServidor ?? paradasLocales;
    const solapa = (a: { inicio: string; fin: string }, b: { inicio: string; fin: string }) =>
      milisegundos(a.inicio) <= milisegundos(b.fin) && milisegundos(b.inicio) <= milisegundos(a.fin);
    const ubicadas = base.map((parada) => {
      const estancia = estancias.find((e) => solapa(e, parada));
      return estancia ? { ...parada, latitud: estancia.latitud, longitud: estancia.longitud } : parada;
    });
    const nuevas: Parada[] = estancias
      .filter((e) => milisegundos(e.fin) - milisegundos(e.inicio) >= MIN_PARADA_MS)
      .filter((e) => !base.some((parada) => solapa(e, parada)))
      .map((e) => ({
        inicio: e.inicio,
        fin: e.fin,
        duracionMin: Math.round((milisegundos(e.fin) - milisegundos(e.inicio)) / 6000) / 10,
        latitud: e.latitud,
        longitud: e.longitud,
        direccion: null,
      }));
    return [...ubicadas, ...nuevas].sort((a, b) => milisegundos(a.inicio) - milisegundos(b.inicio));
  }, [paradasServidor, paradasLocales, estancias]);
  const paradasLocalesEnUso = paradasServidor == null && paradasConsulta.isError;
  // El día contado como lo vive la persona: de dónde sale, cuándo llega a la
  // oficina, qué visita y cuánto se vio. Solo con un día; en un rango largo las
  // estancias de cada noche se mezclarían.
  const resumen = useMemo(
    () => (desde === hasta ? resumenDia({ posiciones, paradas, huecos }) : null),
    [desde, hasta, posiciones, paradas, huecos],
  );
  // Detenciones de 40 s a 3 min (semáforo largo, entrega rápida) que no
  // llegan a parada: se marcan aparte.
  const microparadas = useMemo(() => microparadasDeRecorrido(posiciones, paradas), [posiciones, paradas]);

  // Tramos por modo (vehículo, caminata, quieto). Quieto no dibuja línea: se
  // muestra como un halo con puntos, para no hacer una maraña.
  const segmentos = useMemo(
    () => segmentosParaDibujar(posiciones, huecos, reconstruidos, paradas),
    [posiciones, huecos, reconstruidos, paradas],
  );
  // Hora del día de cada trazo (0 = primer fix, 1 = último): da el tono.
  const [primerMs, ultimoMs] = useMemo(
    () =>
      posiciones.length > 0
        ? [milisegundos(posiciones[0].registradoEn), milisegundos(posiciones[posiciones.length - 1].registradoEn)]
        : [0, 0],
    [posiciones],
  );
  const coleccion = useMemo(() => {
    const base = aColeccion(segmentos);
    return {
      ...base,
      features: base.features.map((f) => ({
        ...f,
        properties: { ...f.properties, f: fraccionDelDia(Number(f.properties?.instante ?? ultimoMs), primerMs, ultimoMs) },
      })),
    };
  }, [segmentos, primerMs, ultimoMs]);
  // Flechas de sentido sobre la línea, según el zoom y con su hora de paso
  // (ver flechas.ts). La línea pasa por todos los puntos, también los
  // aproximados (antena o wifi); el globo del punto avisa "Ubicación
  // aproximada ±N m".
  const lineas = useMemo(() => lineasDeRecorrido(posiciones, segmentos, reconstruidos), [posiciones, segmentos, reconstruidos]);
  const direccion = useMemo(() => {
    const base = flechasDeLineas(lineas);
    return {
      ...base,
      features: base.features.map((f) => ({
        ...f,
        properties: { ...f.properties, f: fraccionDelDia(Number(f.properties?.t), primerMs, ultimoMs) },
      })),
    };
  }, [lineas, primerMs, ultimoMs]);
  // Halos de parada (círculo sutil por insignia) y nube de fixes quietos: la
  // dispersión real sin líneas que la unan.
  const halos = useMemo(() => halosDeParadas(posiciones, paradas), [posiciones, paradas]);
  const coleccionHalos = useMemo(() => aColeccionHalos(halos), [halos]);
  const coleccionQuietos = useMemo(() => puntosQuietos(posiciones), [posiciones]);

  const jornadas = useMemo(() => {
    const lista = [...(jornadasConsulta.data?.jornadas ?? [])];
    // Se ordenan por inicio para que "primera" y "última" sean las del rango.
    lista.sort((a, b) => milisegundos(a.inicioEn) - milisegundos(b.inicioEn));
    return lista;
  }, [jornadasConsulta.data]);

  useEffect(() => {
    if (!mapa) return;
    // Cada bloque se agrega solo si falta: si el mapa se recrea, el estilo
    // arranca vacío y las guardas por id evitan fuentes, capas e imágenes
    // duplicadas.
    if (!mapa.getSource('replay-recorrido')) {
      mapa.addSource('replay-recorrido', { type: 'geojson', tolerance: 0, data: { type: 'FeatureCollection', features: [] } });
    }
    if (!mapa.getSource('replay-flechas')) {
      mapa.addSource('replay-flechas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!mapa.getSource('replay-halos')) {
      mapa.addSource('replay-halos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!mapa.getSource('replay-quieto')) {
      mapa.addSource('replay-quieto', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    // Si el mapa se reutiliza, se quitan capas de versiones anteriores para no
    // duplicar la ruta.
    for (const vieja of [
      'replay-linea-base', 'replay-casing-vehiculo', 'replay-casing-caminata', 'replay-casing-matched',
      'replay-casing-estimated', 'replay-linea-vehiculo', 'replay-filete-vehiculo', 'replay-matched',
    ]) {
      if (mapa.getLayer(vieja)) mapa.removeLayer(vieja);
    }
    const trazo = ['in', ['get', 'tipo'], ['literal', ['ruta', 'matched', 'estimated']]];
    // Cada tramo se corre a la derecha de su sentido de marcha al acercar el
    // zoom: la ida y la vuelta por la misma calle se ven como dos líneas.
    const desplazamiento = ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 2.5, 18, 5];
    const noQuieto = ['!=', ['get', 'modo'], 'quieto'];
    // Superficie de acierto: toda la traza, casi transparente.
    if (!mapa.getLayer('replay-linea-hit')) {
      mapa.addLayer({
        id: 'replay-linea-hit',
        type: 'line',
        source: 'replay-recorrido',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0.01 },
      });
    }
    if (!mapa.getLayer('replay-halo')) {
      mapa.addLayer({
        id: 'replay-halo',
        type: 'circle',
        source: 'replay-halos',
        paint: {
          'circle-color': COLOR_RUTA,
          'circle-opacity': 0.08,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 18],
        },
      });
    }
    // Borde blanco bajo la línea: la separa del mapa sin inventar colores.
    if (!mapa.getLayer('replay-borde')) {
      mapa.addLayer({
        id: 'replay-borde',
        type: 'line',
        source: 'replay-recorrido',
        filter: ['all', trazo, noQuieto] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLOR_BORDE,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 14, 8, 17, 11],
          'line-offset': desplazamiento as never,
        },
      });
    }
    if (!mapa.getLayer('replay-linea')) {
      mapa.addLayer({
        id: 'replay-linea',
        type: 'line',
        source: 'replay-recorrido',
        filter: ['all', ['in', ['get', 'tipo'], ['literal', ['ruta', 'matched']]], noQuieto, ['!=', ['get', 'modo'], 'caminata']] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLOR_POR_HORA as never,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 17, 7.5],
          'line-offset': desplazamiento as never,
        },
      });
    }
    if (!mapa.getLayer('replay-caminata')) {
      mapa.addLayer({
        id: 'replay-caminata',
        type: 'line',
        source: 'replay-recorrido',
        filter: ['all', ['==', ['get', 'tipo'], 'ruta'], ['==', ['get', 'modo'], 'caminata']] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // A pie, un poco más fina que en vehículo pero con borde blanco.
        paint: {
          'line-color': COLOR_POR_HORA as never,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 14, 3.8, 17, 5.5],
          'line-offset': desplazamiento as never,
        },
      });
    }
    if (!mapa.getLayer('replay-estimated')) {
      mapa.addLayer({
        id: 'replay-estimated',
        type: 'line',
        source: 'replay-recorrido',
        filter: ['==', ['get', 'tipo'], 'estimated'],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': COLOR_POR_HORA as never,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 16, 4],
          'line-offset': desplazamiento as never,
          'line-dasharray': [1.2, 1.2],
        },
      });
    }
    // Con `tolerance: 0` el mapa no descarta los tramos cortos al alejar el zoom:
    // con poco zoom cada par de puntos mide menos de un píxel y desaparecía.
    // Corte de señal: lo que no se vio. Una raya ámbar con borde blanco y
    // guiones largos se distingue del GPS registrado (línea sólida azul) y de
    // lo estimado por calles (punteado del color de la hora).
    if (!mapa.getLayer('replay-hueco-borde')) {
      mapa.addLayer({
        id: 'replay-hueco-borde',
        type: 'line',
        source: 'replay-recorrido',
        filter: ['==', ['get', 'tipo'], 'hueco'],
        layout: { 'line-cap': 'butt' },
        paint: {
          'line-color': COLOR_BORDE,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 16, 7],
          'line-opacity': 0.85,
        },
      });
    }
    if (!mapa.getLayer('replay-hueco')) {
      mapa.addLayer({
        id: 'replay-hueco',
        type: 'line',
        source: 'replay-recorrido',
        filter: ['==', ['get', 'tipo'], 'hueco'],
        layout: { 'line-cap': 'butt' },
        paint: {
          'line-color': COLOR_SIN_SENAL,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 4],
          'line-dasharray': [1.6, 1.4],
        },
      });
    }
    // Nube de fixes quietos: la deriva parada como puntos, sin líneas.
    if (!mapa.getLayer('replay-quieto')) {
      mapa.addLayer({
        id: 'replay-quieto',
        type: 'circle',
        source: 'replay-quieto',
        paint: {
          'circle-color': COLOR_RUTA,
          'circle-opacity': 0.16,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 3],
        },
      });
    }
    // Capa de una versión anterior (se quita).
    if (mapa.getLayer('replay-aproximado')) mapa.removeLayer('replay-aproximado');
    // Flechas de sentido: punta blanca con filo del color de su línea.
    // Disco del color de su hora (capa de círculos) y punta blanca encima.
    if (mapa.hasImage(ID_FLECHA)) mapa.removeImage(ID_FLECHA);
    const imagenFlecha = imagenDireccion(NUCLEO_FLECHA);
    if (imagenFlecha) mapa.addImage(ID_FLECHA, imagenFlecha, { pixelRatio: PIXEL_RATIO_FLECHA });
    if (!mapa.getLayer('replay-flechas-disco')) {
      mapa.addLayer({
        id: 'replay-flechas-disco',
        type: 'circle',
        source: 'replay-flechas',
        filter: ['<=', ['get', 'n'], ['zoom']] as never,
        paint: {
          'circle-color': COLOR_POR_HORA as never,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 15, 7.5, 18, 9.5],
          'circle-stroke-color': COLOR_BORDE,
          'circle-stroke-width': 1.5,
        },
      });
    }
    // Las flechas de versiones anteriores se reemplazan por una por punto.
    if (mapa.getLayer('replay-flechas') && mapa.getLayoutProperty('replay-flechas', 'symbol-placement') === 'line') {
      mapa.removeLayer('replay-flechas');
    }
    if (mapa.hasImage(ID_FLECHA) && !mapa.getLayer('replay-flechas')) {
      mapa.addLayer({
        id: 'replay-flechas',
        type: 'symbol',
        source: 'replay-flechas',
        // Zoom progresivo: cada flecha aparece desde su nivel (n).
        filter: ['<=', ['get', 'n'], ['zoom']] as never,
        layout: {
          'icon-image': ID_FLECHA,
          'icon-rotate': ['get', 'r'],
          'icon-rotation-alignment': 'map',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.42, 15, 0.52, 18, 0.66],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-padding': 0,
          'symbol-sort-key': ['get', 't'],
        },
      });
    }
    // El aro del punto elegido lo agrega ReproductorReplay antes que esto; se
    // sube para que quede encima de la ruta.
    if (mapa.getLayer('replay-punto-activo')) mapa.moveLayer('replay-punto-activo');
  }, [mapa]);

  useEffect(() => {
    if (!mapa) return;
    mapa.getSource<GeoJSONSource>('replay-recorrido')?.setData(coleccion);
  }, [mapa, coleccion]);

  useEffect(() => {
    if (!mapa) return;
    mapa.getSource<GeoJSONSource>('replay-halos')?.setData(coleccionHalos);
  }, [mapa, coleccionHalos]);

  useEffect(() => {
    if (!mapa) return;
    mapa.getSource<GeoJSONSource>('replay-quieto')?.setData(coleccionQuietos);
  }, [mapa, coleccionQuietos]);


  useEffect(() => {
    if (!mapa) return;
    mapa.getSource<GeoJSONSource>('replay-flechas')?.setData(direccion);
  }, [mapa, direccion]);

  // Recorrido guiado: una capa de degradado por cada línea con hora, encima de
  // la ruta atenuada (ver guia.ts). ReproductorReplay mueve el corte del
  // degradado al ritmo del marcador. Se rehacen cuando cambian las líneas.
  const [versionGuia, setVersionGuia] = useState(0);
  useEffect(() => {
    if (!mapa) return;
    if (!mapa.getSource('replay-hecho')) {
      mapa.addSource('replay-hecho', { type: 'geojson', tolerance: 0, lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    }
    for (const capa of mapa.getStyle().layers ?? []) {
      if (capa.id.startsWith('replay-hecho-')) mapa.removeLayer(capa.id);
    }
    const desplazamiento = ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 2.5, 18, 5];
    const antes = mapa.getLayer('replay-hueco-borde') ? 'replay-hueco-borde' : undefined;
    const sinAvance = ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];
    lineas.forEach((_, i) => {
      for (const [tipo, ancho] of [
        ['borde', ['interpolate', ['linear'], ['zoom'], 10, 5.5, 14, 8, 17, 11]],
        ['linea', ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 17, 7.5]],
      ] as const) {
        mapa.addLayer(
          {
            id: `replay-hecho-${tipo}-${i}`,
            type: 'line',
            source: 'replay-hecho',
            filter: ['==', ['id'], i],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-gradient': sinAvance as never, 'line-width': ancho as never, 'line-offset': desplazamiento as never },
          },
          antes,
        );
      }
    });
    mapa.getSource<GeoJSONSource>('replay-hecho')?.setData({
      type: 'FeatureCollection',
      features: lineas.map((linea, i) => ({
        type: 'Feature' as const,
        id: i,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: linea.map((v) => [v.lon, v.lat]) },
      })),
    });
    setVersionGuia((v) => v + 1);
  }, [mapa, lineas]);

  // Extremos del recorrido con su hora y encuadre inicial (margen 64 y zoom
  // máximo 14, para que una ruta corta no quede demasiado cerca). Solo se
  // encuadra al abrir un recorrido (persona o fechas): en vivo llegan puntos
  // cada 15 s y mover el mapa molestaría.
  const recorridoEncuadrado = useRef('');
  useEffect(() => {
    if (!mapa || posiciones.length === 0) return;
    const primera = posiciones[0];
    const ultima = posiciones[posiciones.length - 1];
    const claveRecorrido = `${seleccionado}|${desde}|${hasta}`;
    const encuadrar = recorridoEncuadrado.current !== claveRecorrido;
    recorridoEncuadrado.current = claveRecorrido;
    // Primero se encuadra y después se ponen los pines, para decidir las
    // etiquetas con la vista final. cameraForBounds + jumpTo aplica la cámara
    // al momento (fitBounds la deja para el siguiente cuadro).
    const limites = posiciones.reduce(
      (caja, posicion) => caja.extend([posicion.longitud, posicion.latitud] as [number, number]),
      new LngLatBounds([primera.longitud, primera.latitud], [primera.longitud, primera.latitud]),
    );
    if (encuadrar) {
      const camara = mapa.cameraForBounds(limites, { padding: 64, maxZoom: 14 });
      if (camara) mapa.jumpTo(camara);
    }
    const textoInicio = `Inicio ${horaCorta(primera.registradoEn)}`;
    const textoFin = `${enVivo ? 'Último' : 'Fin'} ${horaCorta(ultima.registradoEn)}`;
    const inicio = marcadorExtremo(
      mapa,
      'inicio',
      textoInicio,
      primera.latitud,
      primera.longitud,
      elegirRanura(etiquetasExtremos, mapa, 'inicio', textoInicio, primera.latitud, primera.longitud),
    );
    const fin = marcadorExtremo(
      mapa,
      'fin',
      textoFin,
      ultima.latitud,
      ultima.longitud,
      elegirRanura(etiquetasExtremos, mapa, 'fin', textoFin, ultima.latitud, ultima.longitud),
    );
    return () => {
      inicio.remove();
      fin.remove();
      liberarUbicaciones(etiquetasExtremos, ['inicio', 'fin']);
    };
  }, [mapa, posiciones, seleccionado, desde, hasta, enVivo]);

  // Inicio y fin de jornada. Solo se tienen las horas, así que cada uno se
  // ubica en el punto más cercano en el tiempo y solo si cae dentro del
  // recorrido cargado. Se marcan la primera y la última jornada; si la última
  // sigue abierta no hay fin. Usan las clases jornada-*.
  useEffect(() => {
    if (!mapa || jornadas.length === 0) return;
    const marcadores: Marker[] = [];
    const primera = jornadas[0];
    const ultima = jornadas[jornadas.length - 1];
    const agregar = (clase: string, texto: string, instante: string | null) => {
      if (instante == null) return;
      const indice = indiceCercaDeInstante(posiciones, milisegundos(instante));
      if (indice == null) return;
      const posicion = posiciones[indice];
      const ranura = elegirRanura(etiquetasExtremos, mapa, clase, texto, posicion.latitud, posicion.longitud);
      marcadores.push(marcadorExtremo(mapa, clase, texto, posicion.latitud, posicion.longitud, ranura));
    };
    agregar('jornada-inicio', 'Inicio jornada', primera.inicioEn);
    if (!ultima.abierta) agregar('jornada-fin', 'Fin jornada', ultima.finEn);
    return () => {
      for (const marcador of marcadores) marcador.remove();
      liberarUbicaciones(etiquetasExtremos, ['jornada-inicio', 'jornada-fin']);
    };
  }, [mapa, jornadas, posiciones]);

  const hayRecorrido = replay.data != null && posiciones.length > 0;

  // CSV armado en el navegador, como en Historial. Las columnas son fechas
  // ISO o números, así que no hace falta entrecomillar; el BOM evita que Excel
  // rompa los acentos.
  function exportarCsv() {
    const recorrido = replay.data;
    if (!recorrido || posiciones.length === 0) return;
    const encabezado = ['hora', 'latitud', 'longitud', 'velocidad_kmh', 'precision_m', 'bateria_pct'];
    const filas = posiciones.map((posicion) => [
      posicion.registradoEn,
      posicion.latitud.toFixed(6),
      posicion.longitud.toFixed(6),
      posicion.velocidadKmh == null ? '' : posicion.velocidadKmh.toFixed(1),
      posicion.precisionM == null ? '' : String(Math.round(posicion.precisionM)),
      posicion.bateriaPct == null ? '' : String(Math.round(posicion.bateriaPct)),
    ]);
    const contenido = [encabezado, ...filas].map((fila) => fila.join(',')).join('\n');
    const blob = new Blob([`\uFEFF${contenido}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `replay-${nombreArchivo(recorrido.dispositivo.identificadorUnico)}-${desde}_${hasta}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  function cuerpoPanel() {
    if (seleccionado === '') return <p className="vacio">No hay equipos asignados a esta cuenta.</p>;
    if (!rangoValido) return <p className="vacio">Revisa las fechas: el inicio no puede ser posterior al fin.</p>;
    if (replay.isPending) return <p className="vacio pulso">Cargando…</p>;
    if (replay.error) {
      if (esNoEncontrado(replay.error)) return <p className="vacio">Sin recorrido en el rango seleccionado.</p>;
      return <p className="vacio">{mensajeError(replay.error)}</p>;
    }
    if (!replay.data || posiciones.length === 0) return <p className="vacio">Sin recorrido en el rango seleccionado.</p>;
    return (
      <>
        <PanelPuntoSeleccionado />
        <ListaParadas
          paradas={paradas}
          origen={paradasLocalesEnUso ? 'local' : 'servidor'}
          total={paradasServidor != null ? paradasConsulta.data?.total : undefined}
        />
      </>
    );
  }

  return (
    <ReproductorReplay
      mapa={mapa}
      posiciones={posiciones}
      huecos={huecos}
      reconstruidos={reconstruidos}
      lineas={lineas}
      dispositivo={replay.data?.dispositivo ?? null}
      finRango={finDeDia(hasta)}
      paradas={paradas}
      microparadas={microparadas}
      resumen={resumen}
      versionGuia={versionGuia}
    >
      <section className="replay-pantalla">
        {/* El mapa ocupa la pantalla completa; panel y franja flotan encima
            con las clases que definen global.css y operacion.css. Replay pide
            el set de capas sin "Mapa" (Satélite inicial) y el zoom abajo a la
            derecha, con el selector pegado al top bar. */}
        <MapaRaster clase="mapa" alListo={setMapa} capas={CAPAS_REPLAY} capaInicial={CAPA_INICIAL_REPLAY} zoomAbajoDerecha selectorPegado />
        {hayRecorrido && replay.data && (
          <InfoRecorrido
            totalFixes={posiciones.length}
            simuladas={posiciones.filter((posicion) => posicion.simulada).length}
            huecos={huecos}
            reconstruidos={reconstruidos}
            calidad={replay.data.calidad}
            cobertura={coberturaDe(posiciones, huecos)}
          />
        )}
        {/* Insignias de parada sobre el mapa, dentro del proveedor del
            reproductor: comparten selección con la lista y llevan el mapa a la
            parada con un vuelo suave al pulsarlas. No pintan nada en el DOM. */}
        <InsigniasParadas mapa={mapa} paradas={paradas} />
        <aside className={`replay-panel${panelRecogido ? ' colapsado' : ''}`}>
          <div className="cuerpo-panel">
            <FiltroReplay
              compacto
              equipos={equipos}
              cargandoEquipos={flota.isPending}
              dispositivoId={seleccionado}
              alCambiarDispositivo={setDispositivoId}
              desde={desde}
              hasta={hasta}
              alCambiarDesde={setDesde}
              alCambiarHasta={setHasta}
              acciones={
                <span className="replay-acciones">
                  <button
                    type="button"
                    className="suave replay-csv"
                    onClick={exportarCsv}
                    disabled={!hayRecorrido}
                    title="Descargar el recorrido (CSV)"
                    aria-label="Descargar el recorrido (CSV)"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    className="suave icono-solo"
                    onClick={() => setPanelRecogido((valor) => !valor)}
                    title={panelRecogido ? 'Mostrar panel' : 'Ocultar panel'}
                    aria-label={panelRecogido ? 'Mostrar panel' : 'Ocultar panel'}
                    aria-expanded={!panelRecogido}
                  >
                    <Icono nombre={panelRecogido ? 'chevronDer' : 'chevronIzq'} />
                  </button>
                </span>
              }
            />
            {flota.error && <p className="vacio">{mensajeError(flota.error)}</p>}
            {cuerpoPanel()}
          </div>
        </aside>
        {hayRecorrido && (
          <div className="replay-timeline">
            <LineaTiempoReplay />
          </div>
        )}
      </section>
    </ReproductorReplay>
  );
}
