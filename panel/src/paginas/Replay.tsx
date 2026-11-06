import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, FileDown } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Marker } from 'maplibre-gl';
import type { GeoJSONSource, Map as TipoMapa } from 'maplibre-gl';
import { GUION } from '@/dominio/formatoBase';
import type { Cobertura } from '@/dominio/dia';
import Icono from '@/componentes/replay/Icono';
import MapaRaster, { CAPAS_REPLAY, CAPA_INICIAL_REPLAY } from '@/componentes/mapa/MapaBase';
import CapaGeocercas from '@/componentes/geocercas/CapaGeocercas';
import { etiquetaCierre, horaLocalCsv } from '@/componentes/replay/reproductorComun';
import SeccionGeocercas from '@/componentes/geocercas/SeccionGeocercas';
import ReporteDelDia from '@/componentes/replay/ReporteDelDia';
import { ubicarEnGeocerca, etiquetaTipo } from '@/componentes/geocercas/logica';
import { useGeocercas } from '@/dominio/geocercas';
import { GruposEnLugar } from '@/componentes/replay/GruposEnLugar';
import ReproductorReplay, {
  InsigniasParadas,
  LineaTiempoReplay,
  ListaParadas,
  PanelPuntoSeleccionado,
} from '@/componentes/replay/ReproductorReplay';
import { etiquetaCorte } from '@/componentes/replay/globos';
import FiltroReplay from '@/componentes/replay/FiltroReplay';
import { flechasDeLineas, lineasDeRecorrido, puntoCercanoEnLineas, sinPicos } from '@/componentes/replay/flechas';
import {
  COLOR_POR_HORA,
  fraccionDelDia,
  descartarAjustesLejanos,
  segmentosParaDibujar,
} from '@/componentes/replay/trazo';
import { depurarRecorrido } from '@/dominio/depuracion';
import { traerFlota, traerJornadas, traerParadas, traerReplay, CLAVE_FLOTA, equiposHabilitados } from '@/dominio/datos';
import { ordenarPorDepartamento } from '@/dominio/departamentos';
import { unirParadasSinSalir } from '@/dominio/paradasUnidas';
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
} from '@/dominio/replay';
import type { Parada, TramoReconstruido } from '@/dominio/replay';
import { fechaAyerLocal, fechaHoyLocal, finDeDia, inicioDeDia } from '@/dominio/rango';
import '@/componentes/replay/replay.css';

// Zoom de calle al abrir un recorrido en su punto de inicio.
const ZOOM_INICIO = 16;
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
  const apartados =
    (calidad?.descartadasFueraDeZona ?? 0) +
    (calidad?.descartadasSalto ?? 0) +
    (calidad?.descartadasImprecisas ?? 0) +
    (calidad?.descartadasExcursion ?? 0);
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
      {cortes.some((c) => c.motivo !== 'SIN_SENAL') && (
        <p className="replay-nota">Causas: {causasDeCortes(cortes)}.</p>
      )}
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

const CAPAS_DE_VISTA = [
  { clave: 'trazado', texto: 'Trazado' },
  { clave: 'eventos', texto: 'Eventos' },
  { clave: 'paradas', texto: 'Paradas e inicio' },
];

function formatoMinutos(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

// "2 GPS apagado, 1 app detenida o sin datos": cuántos cortes hubo por causa.
function causasDeCortes(cortes: Hueco[]): string {
  const cuenta = new Map<string, number>();
  for (const corte of cortes) {
    const etiqueta = etiquetaCorte(corte.motivo);
    cuenta.set(etiqueta, (cuenta.get(etiqueta) ?? 0) + 1);
  }
  return [...cuenta].map(([etiqueta, n]) => `${n} ${etiqueta.charAt(0).toLowerCase()}${etiqueta.slice(1)}`).join(', ');
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
  alDescargarCsv,
}: {
  alDescargarCsv: () => void;
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
          <button type="button" className="suave replay-info-csv" onClick={alDescargarCsv}>
            <FileDown size={14} aria-hidden="true" />
            Descargar recorrido (CSV)
          </button>
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
const COLOR_SIN_SENAL = '#f08c00';
const ID_FLECHA = 'dir-ruta';
const MIN_PARADA_MS = 3 * 60_000;
const REFRESCO_VIVO_MS = 15_000;
// Una ruta grande pesa varios megas: pedirla entera cada 15 s traba la pantalla.
const REFRESCO_VIVO_GRANDE_MS = 60_000;
const RUTA_GRANDE_PUNTOS = 5000;
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
  // Centrada en el lienzo para que gire sobre la línea y no se corra.
  contexto.beginPath();
  contexto.moveTo(c, c - 17);
  contexto.lineTo(c + 13, c + 13);
  contexto.lineTo(c, c + 6);
  contexto.lineTo(c - 13, c + 13);
  contexto.closePath();
  contexto.fillStyle = nucleo;
  contexto.lineJoin = 'round';
  contexto.lineWidth = 6;
  contexto.strokeStyle = '#0b2545';
  contexto.stroke();
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
  // La persona elegida se recuerda en la pestaña: al salir y volver por el
  // menú se vuelve a ella (y su recorrido sale de la caché). El día no: abre
  // siempre en ayer.
  const [dispositivoId, setDispositivoId] = useState(() => {
    try {
      return parametros.get('dispositivo') ?? sessionStorage.getItem('replay.dispositivo') ?? '';
    } catch {
      return parametros.get('dispositivo') ?? '';
    }
  });
  useEffect(() => {
    try {
      if (dispositivoId) sessionStorage.setItem('replay.dispositivo', dispositivoId);
    } catch {
      // Sin almacenamiento no se recuerda; nada más.
    }
  }, [dispositivoId]);
  // Por defecto se muestra el día anterior completo: lo que se revisa es lo
  // que pasó ayer. La dirección o el filtro lo pueden cambiar.
  const [desde, setDesde] = useState(parametros.get('desde') ?? fechaAyerLocal());
  const [hasta, setHasta] = useState(parametros.get('hasta') ?? fechaAyerLocal());
  const [mapa, setMapa] = useState<TipoMapa | null>(null);
  const [panelRecogido, setPanelRecogido] = useState(false);
  const campoDia = useRef<HTMLInputElement>(null);
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
  // Un día pasado casi no cambia (solo puntos subidos tarde): se reusa 10 min
  // en vez de volver a bajar hasta 9 MB al volver a la misma persona.
  const CACHE_DIA_CERRADO_MS = 10 * 60_000;
  const replay = useQuery({
    queryKey: ['replay', seleccionado, desde, hasta],
    queryFn: () => traerReplay(seleccionado, inicioDeDia(desde), finDeDia(hasta)),
    enabled: seleccionado !== '' && rangoValido,
    staleTime: enVivo ? 0 : CACHE_DIA_CERRADO_MS,
    refetchInterval: (consulta) =>
      !enVivo
        ? false
        : (consulta.state.data?.posiciones.length ?? 0) > RUTA_GRANDE_PUNTOS
          ? REFRESCO_VIVO_GRANDE_MS
          : REFRESCO_VIVO_MS,
    refetchIntervalInBackground: false,
  });

  // Paradas del servidor, en paralelo. Si fallan se usan las calculadas aquí
  // y se avisa; mientras cargan se muestran sin aviso.
  const geocercasConsulta = useGeocercas();
  const paradasConsulta = useQuery({
    queryKey: ['paradas', seleccionado, desde, hasta],
    queryFn: () => traerParadas(seleccionado, inicioDeDia(desde), finDeDia(hasta)),
    enabled: seleccionado !== '' && rangoValido,
    staleTime: enVivo ? 0 : CACHE_DIA_CERRADO_MS,
    refetchInterval: enVivo ? REFRESCO_VIVO_PARADAS_MS : false,
  });

  // Jornadas del equipo en ese rango, para marcar inicio y fin en el mapa. Si
  // no hay dato o hay error se muestra "—", sin avisos ni reintentos.
  const jornadasConsulta = useQuery({
    queryKey: ['jornadas', seleccionado, desde, hasta],
    queryFn: () => traerJornadas(seleccionado, inicioDeDia(desde), finDeDia(hasta)),
    enabled: seleccionado !== '' && rangoValido,
    retry: false,
    staleTime: enVivo ? 0 : CACHE_DIA_CERRADO_MS,
    refetchInterval: enVivo ? REFRESCO_VIVO_PARADAS_MS : false,
  });

  // Depende solo de los puntos: cada refresco trae un objeto nuevo aunque no
  // haya llegado nada, y recalcular la ruta entera traba la pantalla.
  const puntosRecibidos = replay.data?.posiciones;
  const { posiciones, estancias } = useMemo(() => {
    const lista = [...(puntosRecibidos ?? [])];
    // La API ya ordena por hora del fix; se reordena como defensa para que la
    // línea y la reproducción nunca retrocedan si el orden cambia.
    lista.sort((a, b) => milisegundos(a.registradoEn) - milisegundos(b.registradoEn));
    // Sin picos de ruido y con cada estancia llevada a su centro: la línea, el
    // marcador, las flechas y el slider trabajan sobre el mismo recorrido.
    return depurarRecorrido(lista);
  }, [puntosRecibidos]);

  const huecos = useMemo(() => replay.data?.huecos ?? [], [replay.data]);
  const imprecisos = useMemo(() => replay.data?.imprecisos ?? [], [replay.data]);
  const avisos = useMemo(() => replay.data?.avisos ?? [], [replay.data]);
  const esIphone = replay.data?.dispositivo.plataforma === 'ios';
  // Tramos reconstruidos por el servidor (`reconstruidos`, con método; la
  // forma anterior `estimados` se toma como ESTIMATED en replay.ts). Se quitan
  // los picos de ida y vuelta del ajuste a calles: ese pedacito nunca se
  // recorrió.
  const tramosRecibidos = useMemo(
    () => ({ reconstruidos: replay.data?.reconstruidos, estimados: replay.data?.estimados }),
    [replay.data?.reconstruidos, replay.data?.estimados],
  );
  const reconstruidos = useMemo<TramoReconstruido[]>(
    () => normalizarReconstruidos(tramosRecibidos).map((tramo) => ({ ...tramo, trazado: sinPicos(tramo.trazado) })),
    [tramosRecibidos],
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
  const geocercas = useMemo(() => geocercasConsulta.data?.datos ?? [], [geocercasConsulta.data]);
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
    // Una parada dentro de una geocerca se rotula con su nombre y tipo en vez
    // de la dirección (lista y globo del mapa leen `direccion`).
    return unirParadasSinSalir([...ubicadas, ...nuevas], huecos, posiciones, (p) => ubicarEnGeocerca(p, puntosRecibidos ?? [], geocercas) != null)
      .map((parada) => {
        // Con los puntos tal como llegaron: los depurados de una estancia
        // están todos en su centro.
        const zona = ubicarEnGeocerca(parada, puntosRecibidos ?? [], geocercas);
        return zona
          ? { ...zona.parada, direccion: `${zona.geocerca.nombre} (${etiquetaTipo(zona.geocerca.tipo)})` }
          : parada;
      })
      .sort((a, b) => milisegundos(a.inicio) - milisegundos(b.inicio));
  }, [paradasServidor, paradasLocales, estancias, posiciones, puntosRecibidos, geocercas, huecos]);
  const paradasLocalesEnUso = paradasServidor == null && paradasConsulta.isError;
  // El día contado como lo vive la persona: de dónde sale, cuándo llega a la
  // oficina, qué visita y cuánto se vio. Solo con un día; en un rango largo las
  // estancias de cada noche se mezclarían.
  const resumen = useMemo(
    () => (desde === hasta ? resumenDia({ posiciones, paradas, huecos, crudas: puntosRecibidos }) : null),
    [desde, hasta, posiciones, paradas, huecos, puntosRecibidos],
  );
  // Tramos por modo (vehículo, caminata, quieto). Quieto no dibuja línea: se
  // muestra con el halo de su parada, para no hacer una maraña.
  // Ajustes a calles que no siguen al GPS preciso se dejan fuera para todo:
  // línea, marcador y cursor usan los mismos tramos.
  const tramos = useMemo(() => descartarAjustesLejanos(posiciones, reconstruidos, paradas), [posiciones, reconstruidos, paradas]);
  const segmentos = useMemo(
    () => segmentosParaDibujar(posiciones, huecos, tramos, paradas, imprecisos),
    [posiciones, huecos, tramos, paradas, imprecisos],
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
  const lineas = useMemo(() => lineasDeRecorrido(posiciones, segmentos, tramos), [posiciones, segmentos, tramos]);
  // Detenciones de 40 s a 3 min (semáforo largo, entrega rápida) que no
  // llegan a parada: se marcan aparte.
  const microparadasSuelta = useMemo(() => microparadasDeRecorrido(posiciones, paradas), [posiciones, paradas]);
  // La microparada se asienta sobre el trazo dibujado (el GPS crudo de una
  // parada corta se separa de la calle y queda "fantasma").
  const microparadas = useMemo(
    () =>
      microparadasSuelta.map((m) => {
        // Sobre el trazo de su hora: la misma calle pudo recorrerse a otra hora.
        const sobre = puntoCercanoEnLineas(lineas, milisegundos(m.inicio), m.longitud, m.latitud);
        return sobre ? { ...m, longitud: sobre[0], latitud: sobre[1] } : m;
      }),
    [microparadasSuelta, lineas],
  );
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
  // Halos de parada: círculo sutil por insignia.
  const halos = useMemo(() => halosDeParadas(posiciones, paradas), [posiciones, paradas]);
  const coleccionHalos = useMemo(() => aColeccionHalos(halos), [halos]);

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
      // Sin `tolerance` fija: el mapa simplifica la ruta según el zoom (su LOD
      // nativo) y no dibuja lo que queda fuera de pantalla. Con miles de puntos
      // eso quita el tirón al alejar o arrastrar. Los cortes van en su propia
      // fuente porque sí necesitan verse enteros de lejos (ver replay-huecos).
      mapa.addSource('replay-recorrido', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!mapa.getSource('replay-huecos')) {
      // Cortes de señal: pocos y cortos. Con `tolerance: 0` no se descartan al
      // alejar el zoom (cada tramo mide menos de un píxel y desaparecía).
      mapa.addSource('replay-huecos', { type: 'geojson', tolerance: 0, data: { type: 'FeatureCollection', features: [] } });
    }
    if (!mapa.getSource('replay-flechas')) {
      mapa.addSource('replay-flechas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!mapa.getSource('replay-halos')) {
      mapa.addSource('replay-halos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    // Si el mapa se reutiliza, se quitan capas de versiones anteriores para no
    // duplicar la ruta.
    for (const vieja of [
      'replay-linea-base', 'replay-hueco-borde', 'replay-hueco-rayas', 'replay-casing-vehiculo', 'replay-casing-caminata', 'replay-casing-matched',
      'replay-casing-estimated', 'replay-linea-vehiculo', 'replay-filete-vehiculo', 'replay-matched', 'replay-linea-hit',
    ]) {
      if (mapa.getLayer(vieja)) mapa.removeLayer(vieja);
    }
    const trazo = ['in', ['get', 'tipo'], ['literal', ['ruta', 'matched', 'estimated']]];
    const noQuieto = ['!=', ['get', 'modo'], 'quieto'];
    // Superficie de acierto: toda la traza, invisible. Con algo de opacidad,
    // miles de tramos encimados se sumaban en una sombra negra.
    if (!mapa.getLayer('replay-linea-hit')) {
      mapa.addLayer({
        id: 'replay-linea-hit',
        type: 'line',
        source: 'replay-recorrido',
        // Solo lo que se ve: el temblor quieto dentro de una parada no tiene
        // línea y el cursor no debe encontrar nada ahí.
        filter: noQuieto as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000000', 'line-width': 18, 'line-opacity': 0 },
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.6, 14, 5.2, 17, 7.2],
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.0, 14, 3.2, 17, 4.9],
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 2.5, 17, 3.6],
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
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 16, 2.6],
          'line-dasharray': [1.2, 1.2],
        },
      });
    }
    // Corte de señal: lo que no se vio. Naranja con rayas negras encima, sin
    // borde, para que no se confunda con el GPS registrado (línea sólida azul).
    // Va en la fuente replay-huecos (tolerance 0) para no desaparecer de lejos.
    if (!mapa.getLayer('replay-hueco')) {
      mapa.addLayer({
        id: 'replay-hueco',
        type: 'line',
        source: 'replay-huecos',
        filter: ['==', ['get', 'tipo'], 'hueco'],
        layout: { 'line-cap': 'butt' },
        // Algo transparente: es lo que no se vio, no debe tapar el mapa.
        paint: {
          'line-color': COLOR_SIN_SENAL,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.1, 16, 3.4],
          'line-opacity': 0.55,
        },
      });
    }
    if (!mapa.getLayer('replay-hueco-rayas')) {
      mapa.addLayer({
        id: 'replay-hueco-rayas',
        type: 'line',
        source: 'replay-huecos',
        filter: ['==', ['get', 'tipo'], 'hueco'],
        layout: { 'line-cap': 'butt' },
        paint: {
          'line-color': '#000000',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.1, 16, 3.4],
          'line-dasharray': [1, 1],
          'line-opacity': 0.4,
        },
      });
    }
    // Capas de versiones anteriores (se quitan). Los puntos quietos dentro de
    // una parada eran el rebote del GPS: manchas que no dicen nada.
    for (const vieja of ['replay-aproximado', 'replay-quieto']) if (mapa.getLayer(vieja)) mapa.removeLayer(vieja);
    // Flechas de sentido: punta blanca con filo del color de su línea.
    // Disco del color de su hora (capa de círculos) y punta blanca encima.
    if (mapa.hasImage(ID_FLECHA)) mapa.removeImage(ID_FLECHA);
    const imagenFlecha = imagenDireccion(NUCLEO_FLECHA);
    if (imagenFlecha) mapa.addImage(ID_FLECHA, imagenFlecha, { pixelRatio: PIXEL_RATIO_FLECHA });
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
          'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.46, 15, 0.58, 18, 0.74],
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
    // Los cortes van aparte: fuente sin simplificar para que no se pierdan.
    mapa.getSource<GeoJSONSource>('replay-huecos')?.setData({
      ...coleccion,
      features: coleccion.features.filter((f) => (f.properties as { tipo?: string })?.tipo === 'hueco'),
    });
  }, [mapa, coleccion]);

  useEffect(() => {
    if (!mapa) return;
    mapa.getSource<GeoJSONSource>('replay-halos')?.setData(coleccionHalos);
  }, [mapa, coleccionHalos]);



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
      mapa.addSource('replay-hecho', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    }
    for (const capa of mapa.getStyle().layers ?? []) {
      if (capa.id.startsWith('replay-hecho-')) mapa.removeLayer(capa.id);
    }
    const antes = mapa.getLayer('replay-hueco') ? 'replay-hueco' : undefined;
    const sinAvance = ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];
    lineas.forEach((_, i) => {
      for (const [tipo, ancho] of [
        ['borde', ['interpolate', ['linear'], ['zoom'], 10, 3.6, 14, 5.2, 17, 7.2]],
        ['linea', ['interpolate', ['linear'], ['zoom'], 10, 2.0, 14, 3.2, 17, 4.9]],
      ] as const) {
        mapa.addLayer(
          {
            id: `replay-hecho-${tipo}-${i}`,
            type: 'line',
            source: 'replay-hecho',
            filter: ['==', ['id'], i],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            // Opacidad 0 hasta que el recorrido guiado llega a ella: así el mapa
            // no la dibuja (ver pintarAvance en ReproductorReplay).
            paint: {
              'line-gradient': sinAvance as never,
              'line-width': ancho as never,
              'line-opacity': 0,
              'line-opacity-transition': { duration: 0, delay: 0 },
            },
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
    // Primero se centra y después se ponen los pines, para decidir las
    // etiquetas con la vista final. Al elegir persona o día el mapa abre en el
    // punto de inicio, de cerca: el día se recorre desde ahí.
    if (encuadrar) {
      // Centro en la parte del mapa que se ve: el panel tapa la izquierda
      // (escritorio) o la franja de arriba (media pantalla), y la barra de
      // reproducción el pie.
      const caja = mapa.getContainer().getBoundingClientRect();
      const panel = document.querySelector('.replay-panel:not(.colapsado)')?.getBoundingClientRect();
      const barra = document.querySelector('.replay-timeline')?.getBoundingClientRect();
      const arriba = panel && panel.width >= caja.width - 2 ? panel.bottom - caja.top : 0;
      const izquierda = panel && !arriba ? panel.right - caja.left : 0;
      const abajo = barra ? Math.max(0, caja.bottom - barra.top) : 0;
      const zoomUi = mapa.getContainer().clientWidth / Math.max(1, caja.width);
      mapa.jumpTo({
        center: [primera.longitud, primera.latitud],
        zoom: ZOOM_INICIO,
        padding: { top: arriba * zoomUi, left: izquierda * zoomUi, bottom: abajo * zoomUi, right: 0 },
      });
    }
    // El iPhone no tiene jornada: su día va de que se activa la app a que se
    // desactiva.
    // Si la jornada empezó 10 min o más antes del primer punto, se dicen las
    // dos horas: el primer punto no es el inicio (Israel 21/10: jornada 07:58,
    // primer punto 12:02 con la ubicación apagada).
    const inicioPrimero = milisegundos(primera.registradoEn);
    const jornadaPrimera = esIphone
      ? undefined
      : jornadas.find((j) => milisegundos(j.inicioEn) <= inicioPrimero && (j.finEn == null || milisegundos(j.finEn) >= inicioPrimero));
    const textoInicio = jornadaPrimera && inicioPrimero - milisegundos(jornadaPrimera.inicioEn) >= 10 * 60_000
      ? `Inicio jornada ${horaCorta(jornadaPrimera.inicioEn)} · 1.er punto ${horaCorta(primera.registradoEn)}`
      : `${esIphone ? 'App activada' : 'Inicio'} ${horaCorta(primera.registradoEn)}`;
    // El fin dice cómo terminó (finalizó la jornada, apagó el GPS o el
    // teléfono, quitó el permiso o se quedó sin señal) y a la hora de su
    // último punto, la misma que se ve al llegar al final de la línea.
    const cierre = replay.data?.cierres?.find((c) => c.en === ultima.registradoEn);
    const textoFin = cierre
      ? `${etiquetaCierre(cierre)} ${horaCorta(cierre.en)}`
      : `${enVivo ? 'Último' : esIphone ? 'App sin cobertura' : 'Fin'} ${horaCorta(ultima.registradoEn)}`;
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
  }, [mapa, posiciones, seleccionado, desde, hasta, enVivo, esIphone, replay.data?.cierres, jornadas]);

  // Inicio y fin de jornada. Solo se tienen las horas, así que cada uno se
  // ubica en el punto más cercano en el tiempo y solo si cae dentro del
  // recorrido cargado. Se marcan la primera y la última jornada; si la última
  // sigue abierta no hay fin. Usan las clases jornada-*.
  useEffect(() => {
    // El iPhone no tiene jornada: su burbuja ya dice "App activada" y "App
    // desactivada", y estas etiquetas solo se encimaban.
    if (!mapa || jornadas.length === 0 || esIphone) return;
    const marcadores: Marker[] = [];
    const primera = jornadas[0];
    const ultima = jornadas[jornadas.length - 1];
    const agregar = (clase: string, texto: string, instante: string | null) => {
      if (instante == null) return;
      const indice = indiceCercaDeInstante(posiciones, milisegundos(instante));
      // En el primer o el último punto ya está la etiqueta de inicio o de fin.
      if (indice == null || indice === 0 || indice === posiciones.length - 1) return;
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
  }, [mapa, jornadas, posiciones, esIphone]);

  // Lo que el ojo del mapa apaga: el trazado y los halos de parada son capas
  // del mapa. Se repasa en cada reposo porque el recorrido las vuelve a crear.
  const [ocultas, setOcultas] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!mapa) return;
    const aplicar = () => {
      for (const capa of mapa.getStyle().layers ?? []) {
        if (!capa.id.startsWith('replay-')) continue;
        const deParada = capa.id === 'replay-halo';
        const visible = ocultas.includes(deParada ? 'paradas' : 'trazado') ? 'none' : 'visible';
        if ((mapa.getLayoutProperty(capa.id, 'visibility') ?? 'visible') !== visible) {
          mapa.setLayoutProperty(capa.id, 'visibility', visible);
        }
      }
    };
    aplicar();
    mapa.on('idle', aplicar);
    return () => {
      mapa.off('idle', aplicar);
    };
  }, [mapa, ocultas]);

  const hayRecorrido = replay.data != null && posiciones.length > 0;

  // CSV armado en el navegador, como en Historial. Las columnas son fechas
  // ISO o números, así que no hace falta entrecomillar; el BOM evita que Excel
  // rompa los acentos.
  function exportarCsv() {
    const recorrido = replay.data;
    if (!recorrido || posiciones.length === 0) return;
    const encabezado = ['hora', 'latitud', 'longitud', 'velocidad_kmh', 'precision_m', 'bateria_pct'];
    // El GPS tal como llegó: la lista depurada mueve los puntos de una
    // estancia a su centro y quita rebotes, y el archivo es evidencia.
    const recibidos = [...(puntosRecibidos ?? [])].sort((a, b) => milisegundos(a.registradoEn) - milisegundos(b.registradoEn));
    const filas = recibidos.map((posicion) => [
      horaLocalCsv(posicion.registradoEn),
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
        <ReporteDelDia dispositivoId={seleccionado} dia={desde} />
        <SeccionGeocercas dispositivoId={seleccionado} desde={inicioDeDia(desde)} hasta={finDeDia(hasta)} activo={rangoValido} paradas={paradas} geocercas={geocercas} lecturas={puntosRecibidos} />
      </>
    );
  }

  return (
    <ReproductorReplay
      mapa={mapa}
      posiciones={posiciones}
      huecos={huecos}
      avisos={avisos}
      cierres={replay.data?.cierres}
      reconstruidos={tramos}
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
        <CapaGeocercas mapa={mapa} capas={CAPAS_DE_VISTA} alCambiarOcultas={setOcultas} />
        {hayRecorrido && replay.data && (
          <InfoRecorrido
            totalFixes={posiciones.length}
            simuladas={posiciones.filter((posicion) => posicion.simulada).length}
            huecos={huecos}
            reconstruidos={reconstruidos}
            calidad={replay.data.calidad}
            cobertura={coberturaDe(posiciones, huecos)}
            alDescargarCsv={exportarCsv}
          />
        )}
        {/* Insignias de parada sobre el mapa, dentro del proveedor del
            reproductor: comparten selección con la lista y llevan el mapa a la
            parada con un vuelo suave al pulsarlas. No pintan nada en el DOM. */}
        <InsigniasParadas mapa={mapa} paradas={paradas} />
        <GruposEnLugar mapa={mapa} enVivo={enVivo} />
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
              sinRango
              acciones={
                <span className="replay-acciones">
                  {/* Un solo día: el calendario abre en el que se ve (ayer al entrar). */}
                  <span className="replay-dia">
                    <button
                      type="button"
                      className="suave replay-csv"
                      onClick={() => {
                        try {
                          campoDia.current?.showPicker();
                        } catch {
                          campoDia.current?.focus();
                        }
                      }}
                      title="Elegir día"
                      aria-label={`Elegir día (${desde})`}
                    >
                      <CalendarDays size={14} aria-hidden="true" />
                      {`${desde.slice(8, 10)}/${desde.slice(5, 7)}`}
                    </button>
                    <input
                      ref={campoDia}
                      type="date"
                      tabIndex={-1}
                      aria-hidden="true"
                      className="replay-dia-campo"
                      value={desde}
                      max={fechaHoyLocal()}
                      onChange={(evento) => {
                        if (!evento.target.value) return;
                        setDesde(evento.target.value);
                        setHasta(evento.target.value);
                      }}
                    />
                  </span>
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
