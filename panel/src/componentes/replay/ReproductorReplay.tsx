import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as EventoRaton, ReactNode, RefObject } from 'react';
import { Marker, Popup } from 'maplibre-gl';
import type { GeoJSONSource, Map as TipoMapa, MapMouseEvent } from 'maplibre-gl';
import { useQuery } from '@tanstack/react-query';
import { CategoryScale, Chart as ChartJS, Filler, LineElement, LinearScale, PointElement } from 'chart.js';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { FeatureCollection, Point } from 'geojson';
import type { Dispositivo, Hueco, Posicion } from '@contratos';
import { bateria, duracion, fecha, GUION, velocidad } from '@/dominio/formatoBase';
import { FastForward, Maximize2, Minimize2, SkipBack, SkipForward } from 'lucide-react';
import Icono from './Icono';
import { esPreciso, puntoCercanoEnLineas, puntoEnLineas } from './flechas';
import type { Vertice } from './flechas';
import { BLANCO, gradienteHasta, prepararGuia, progresoEn } from './guia';
import { colorToken, useTema } from '@/lib/tema';
import { traerDireccion } from '@/dominio/datos';
import { distanciaM, etiquetaRol } from '@/dominio/dia';
import type { ResumenDia, RolParada } from '@/dominio/dia';
import { globoDeCorte, globoDePunto, globoHoverDe } from './globos';
import {
  ETIQUETA_MODO_REAL,
  estadoDePunto,
  fechaHoraCorta,
  horaCorta,
  indiceBateriaConocida,
  duracionCorta,
  indiceMasCercano,
  indicePorInstante,
  milisegundos,
  puntoEnInstante,
  serieBateria,
} from '@/dominio/replay';
import type { EstadoUnidad, Microparada, Parada, TramoReconstruido } from '@/dominio/replay';

// Chart.js exige registrar las piezas que se dibujan. El gráfico del
// reproductor es una línea con relleno, sin ejes, sin leyenda y sin tooltip:
// solo se registran escala, línea, punto y relleno.
ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler);

const SIN_PARADAS: Parada[] = [];
const SIN_LINEAS: Vertice[][] = [];
const HORA_SEGUNDOS = new Intl.DateTimeFormat('es-EC', {
  timeZone: 'America/Guayaquil',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function horaConSegundos(valor: string): string {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? GUION : HORA_SEGUNDOS.format(d);
}
// Deben coincidir con --eje-bateria y --eje-velocidad de replay.css.
const ANCHO_EJE_BATERIA_PX = 42;
const ANCHO_EJE_VELOCIDAD_PX = 58;
const SIN_MICROPARADAS: Microparada[] = [];
const VELOCIDADES = [1, 2, 4, 6, 8, 16];

// El marcador se mueve en cada cuadro, pero el resto (gráfico, barra, lectura)
// se actualiza 5 veces por segundo: redibujar el gráfico a 60 Hz con miles de
// puntos pesa mucho y no se nota la diferencia. El reloj sigue igual porque
// vive en instanteRef.
const INTERVALO_PINTADO_MS = 200;

// Al elegir una parada el mapa vuela a zoom de ciudad (15-16) en unos 900 ms.
// Si ya está más cerca, no se aleja. Con movimiento reducido, salta directo.
const ZOOM_PARADA_MIN = 15;
const ZOOM_PARADA_MAX = 16;
const DURACION_VUELO_PARADA_MS = 900;
const CURVA_VUELO_PARADA = 1.42;

// Fix más próximo en el tiempo al instante dado (posiciones en orden).
function indiceCercano(posiciones: Posicion[], instante: number): number {
  let bajo = 0;
  let alto = posiciones.length - 1;
  while (bajo < alto) {
    const medio = (bajo + alto) >> 1;
    if (milisegundos(posiciones[medio].registradoEn) < instante) bajo = medio + 1;
    else alto = medio;
  }
  if (bajo > 0 && instante - milisegundos(posiciones[bajo - 1].registradoEn) < milisegundos(posiciones[bajo].registradoEn) - instante) {
    return bajo - 1;
  }
  return bajo;
}

// Cuánto hay que correr el centro del mapa para que lo elegido quede en la parte
// que no tapan el panel lateral ni la franja de abajo.
function desplazamientoVisible(mapa: TipoMapa): [number, number] {
  const lienzo = mapa.getContainer().getBoundingClientRect();
  let izquierda = lienzo.left;
  let abajo = lienzo.bottom;
  const panel = document.querySelector('.replay-panel:not(.colapsado)')?.getBoundingClientRect();
  if (panel && panel.right > lienzo.left && panel.width < lienzo.width / 2) izquierda = panel.right;
  const franja = document.querySelector('.replay-timeline')?.getBoundingClientRect();
  if (franja && franja.top > lienzo.top + lienzo.height / 2 && franja.top < lienzo.bottom) abajo = franja.top;
  return [(izquierda + lienzo.right) / 2 - (lienzo.left + lienzo.right) / 2, (lienzo.top + abajo) / 2 - (lienzo.top + lienzo.bottom) / 2];
}

// La ficha de una parada se abre encima de ella: la parada queda un poco por
// debajo del centro visible para que la ficha quepa entera.
const ALTO_FICHA_PARADA_PX = 150;

// Los marcadores (paradas, microparadas, cortes) van sobre la línea del mapa: si
// el clic sigue de largo, el mapa lo toma también como un clic en la línea y
// elige un punto suelto, que deshace la parada recién elegida. Por eso se
// cortan aquí los eventos antes de que lleguen al mapa.
function aislarDelMapa(elemento: HTMLElement): void {
  for (const tipo of ['mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'pointerdown', 'pointerup']) {
    elemento.addEventListener(tipo, (evento) => evento.stopPropagation());
  }
}

function movimientoReducido(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Velocidad base: la ruta completa se recorre en unos 150 s a 1×, con un
// mínimo de 1× y un máximo de 120×, para que una ruta larga no sea eterna ni
// una de varios días un parpadeo.
const FACTOR_MINIMO = 1;
const FACTOR_MAXIMO = 120;
// Cada cuánto se actualiza la guía del recorrido al reproducir.
const INTERVALO_GUIA_MS = 0;
// Opacidad de la parte del recorrido que todavía no se reproduce.
const OPACIDAD_POR_RECORRER = 0.22;
// Un corte lleva etiqueta en el mapa si dejó un salto de al menos esto, y se
// rotulan como mucho los primeros de la lista para no llenar el mapa.
const SALTO_ETIQUETA_M = 150;
const MAX_ETIQUETAS_CORTE = 12;
// Cuánto más rápido corre el reloj dentro de una parada o un corte de señal.
const FACTOR_ESPERA = 24;
const SEGUNDOS_OBJETIVO = 150;

function factorBase(posiciones: Posicion[]): number {
  if (posiciones.length < 2) return FACTOR_MINIMO;
  const duracionMs =
    milisegundos(posiciones[posiciones.length - 1].registradoEn) - milisegundos(posiciones[0].registradoEn);
  if (!(duracionMs > 0)) return FACTOR_MINIMO;
  const factor = duracionMs / (SEGUNDOS_OBJETIVO * 1000);
  return Math.min(Math.max(factor, FACTOR_MINIMO), FACTOR_MAXIMO);
}

// Color del marcador según el estado del punto (reemplaza el azul de base).
const CLASE_ESTADO: Record<EstadoUnidad, string> = {
  movimiento: 'estado-movimiento',
  detencion: 'estado-detencion',
  sinSenal: 'estado-sin-senal',
};

// Etiqueta legible del estado del fix para la ficha del punto seleccionado.
const ETIQUETA_ESTADO_PUNTO: Record<EstadoUnidad, string> = {
  movimiento: 'En movimiento',
  detencion: 'Detenido',
  sinSenal: 'Sin señal',
};

// Línea fina, sin puntos, relleno suave y sin ejes: la batería acompaña al
// recorrido. El eje Y fijo de 0 a 100 deja la misma escala en todos los
// equipos.
const OPCIONES_BATERIA: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  // El valor bajo el cursor se muestra con una etiqueta propia (HTML): el
  // tooltip de Chart.js se recorta dentro de un lienzo de 36 px de alto.
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, max: 100 },
  },
  elements: {
    line: { borderWidth: 1.5 },
    point: { radius: 0 },
  },
};

interface Props {
  mapa: TipoMapa | null;
  posiciones: Posicion[];
  huecos: Hueco[];
  reconstruidos: TramoReconstruido[];
  // Trazado con hora (flechas.ts): marcador, aro, globo y centrado van sobre él.
  lineas?: Vertice[][];
  dispositivo: Dispositivo | null;
  // Fin del rango consultado (ISO): referencia del estado del último fix.
  finRango?: string;
  paradas?: Parada[];
  microparadas?: Microparada[];
  // Qué es cada parada (casa, oficina, visita) y cómo se llama la oficina.
  resumen?: ResumenDia | null;
  nombreOficina?: string;
  // Cambia cuando Replay rehace las capas del recorrido guiado.
  versionGuia?: number;
  children: ReactNode;
}

interface Reproductor {
  finRangoMs: number | null;
  paradas: Parada[];
  microparadas: Microparada[];
  resumen: ResumenDia | null;
  nombreOficina: string;
  // Al reproducir, las paradas y los cortes de señal pasan rápido: solo se ve
  // el recorrido.
  saltarEsperas: boolean;
  alternarSaltarEsperas: () => void;
  // Lleva el reloj al inicio de la parada anterior o siguiente.
  irAParada: (direccion: 1 | -1) => void;
  posiciones: Posicion[];
  huecos: Hueco[];
  reconstruidos: TramoReconstruido[];
  dispositivo: Dispositivo | null;
  indice: number;
  punto: Posicion | null;
  // Estado del fix en curso (movimiento, detenido, sin señal).
  estado: EstadoUnidad;
  reproduciendo: boolean;
  velocidad: number;
  seguir: boolean;
  seleccionado: number | null;
  // Parada elegida en la lista o en su insignia del mapa: la fila y la
  // insignia se resaltan juntas.
  paradaSeleccionada: number | null;
  // La barra de tiempo no la controla React: el reproductor escribe su valor y
  // su relleno en cada cuadro, así el avance se ve continuo.
  sliderRef: RefObject<HTMLInputElement | null>;
  alternar: () => void;
  alternarSeguir: () => void;
  // Paso a paso por el recorrido: ±1 punto reproducible por pulsación.
  moverPunto: (direccion: 1 | -1) => void;
  cambiarVelocidad: (valor: number) => void;
  mover: (indice: number) => void;
  pausar: () => void;
  // Salto a un instante de la línea de tiempo pedido desde fuera (paradas).
  irA: (instante: number) => void;
  // Selección de una parada: pausa, ubica el reloj, selecciona su fix, marca
  // la parada y lleva el mapa hasta ella con un vuelo suave (salto directo con
  // movimiento reducido), igual que elegir un colaborador en En vivo.
  // Con indiceParada null (microparada) hace lo mismo sin resaltar parada.
  seleccionarParada: (indiceParada: number | null, latitud: number, longitud: number, instante: number) => void;
  // Selección de un fix al pulsar la ruta: pausa y ubica el reproductor.
  seleccionar: (indice: number) => void;
  quitarSeleccion: () => void;
}

const ContextoReproductor = createContext<Reproductor | null>(null);

// Contenedor de la reproducción: guarda el estado (reloj, punto actual,
// selección, saltos de hueco) y lo comparte con los bloques que Replay ubica
// en el panel flotante y en la franja inferior. El clic sobre la ruta se toma
// de la capa que agrega Replay; aquí se busca el punto más cercano.
export default function ReproductorReplay({ mapa, posiciones, huecos, reconstruidos, lineas = SIN_LINEAS, dispositivo, finRango, paradas = SIN_PARADAS, microparadas = SIN_MICROPARADAS, resumen = null, nombreOficina = 'Oficina', versionGuia = 0, children }: Props) {
  const finRangoMs = finRango ? milisegundos(finRango) : null;
  const [indice, setIndice] = useState(0);
  const reproduciendoRef = useRef(false);
  const [reproduciendo, setReproduciendo] = useState(false);
  reproduciendoRef.current = reproduciendo;
  const [velocidadReproduccion, setVelocidadReproduccion] = useState(1);
  // Las esperas (paradas y cortes de señal) pasan rápido al reproducir. Se
  // recuerda entre visitas: es una preferencia de quien revisa.
  const [saltarEsperas, setSaltarEsperas] = useState(() => {
    try {
      return localStorage.getItem('dmj.replay.saltarEsperas') !== '0';
    } catch {
      return true;
    }
  });
  // Seguir apagado por defecto: el encuadre inicial del recorrido manda hasta
  // que el usuario pida acompañar el marcador.
  const [seguir, setSeguir] = useState(false);
  // El clic en el mapa pide el globo del punto (ver efecto del globo).
  const globoPedido = useRef(false);
  // Posición sobre la línea donde se hizo clic: el aro y el globo se muestran
  // ahí (el fix crudo puede quedar a decenas de metros de la calle).
  const [puntoClic, setPuntoClic] = useState<[number, number] | null>(null);
  // Dónde se muestra el punto i:
  //  1. Dentro de una parada, en su centro (donde está la insignia): el
  //     temblor del GPS bajo techo no es otro lugar.
  //  2. Si no, en el punto de la línea más cercano a su GPS.
  //  3. Si la línea queda lejos, en su hora sobre la línea o, sin línea, en
  //     su coordenada.
  const enLinea = useCallback(
    (i: number): [number, number] | null => {
      const fix = posiciones[i];
      if (!fix) return null;
      const t = milisegundos(fix.registradoEn);
      const parada = paradas.find((p) => t >= milisegundos(p.inicio) && t <= milisegundos(p.fin));
      if (parada) return [parada.longitud, parada.latitud];
      return (
        puntoCercanoEnLineas(lineas, t, fix.longitud, fix.latitud) ??
        puntoEnLineas(lineas, t) ?? [fix.longitud, fix.latitud]
      );
    },
    [posiciones, lineas, paradas],
  );
  // El primer punto del recorrido queda seleccionado por defecto: la ficha
  // abre con el detalle del arranque y el mapa lo refleja con su aro, sin
  // vuelo (el encuadre inicial del recorrido manda hasta que el usuario pida
  // otra cosa).
  const [seleccionado, setSeleccionado] = useState<number | null>(posiciones.length > 0 ? 0 : null);
  const [paradaSeleccionada, setParadaSeleccionada] = useState<number | null>(null);
  const marcadorActual = useRef<Marker | null>(null);
  // El reloj y el índice viven en refs para que el bucle de animación no se
  // reinicie en cada avance. `indiceRef` es el valor real; `indicePintadoRef`
  // es el último que se mandó a pantalla.
  const indiceRef = useRef(0);
  const indicePintadoRef = useRef(0);
  const instanteRef = useRef(posiciones.length > 0 ? milisegundos(posiciones[0].registradoEn) : 0);
  // La barra está en la franja inferior, pero la maneja este contenedor.
  const sliderRef = useRef<HTMLInputElement | null>(null);

  // Pone en la barra la hora del reloj (valor y relleno). Se usa al moverla a
  // mano, al cambiar de recorrido y en cada cuadro.
  const sincronizarSlider = useCallback(
    (instante: number) => {
      const nodo = sliderRef.current;
      const primera = posiciones[0];
      const ultima = posiciones[posiciones.length - 1];
      if (!nodo || !primera || !ultima) return;
      const inicio = milisegundos(primera.registradoEn);
      const total = Math.max(0, milisegundos(ultima.registradoEn) - inicio);
      const posicion = Math.min(Math.max(instante - inicio, 0), total);
      nodo.value = String(posicion);
      // El riel de la pista (hermano del slider) dibuja el progreso: se
      // escribe en el contenedor para que lo herede.
      (nodo.parentElement ?? nodo).style.setProperty('--progreso', total > 0 ? `${(posicion / total) * 100}%` : '0%');
    },
    [posiciones],
  );

  // Al cambiar de equipo o de fechas se reinician el punto, la reproducción y
  // la selección, y el reloj vuelve al primer punto del recorrido nuevo.
  //
  // En vivo (hoy se refresca cada 15 s) llega el MISMO recorrido con puntos
  // nuevos al final: no se reinicia nada. Si se estaba mirando el último
  // punto, se sigue al nuevo último.
  const [recorrido, setRecorrido] = useState(posiciones);
  const extensionDe = (previo: Posicion[], nuevo: Posicion[]) =>
    previo.length > 0 && nuevo.length >= previo.length && nuevo[0]?.registradoEn === previo[0]?.registradoEn;
  const esExtension = recorrido !== posiciones && extensionDe(recorrido, posiciones);
  const seguirAlFinal = esExtension && !reproduciendo && indice >= recorrido.length - 1;
  if (recorrido !== posiciones) {
    setRecorrido(posiciones);
    if (esExtension) {
      if (seguirAlFinal) {
        setIndice(posiciones.length - 1);
        if (seleccionado === recorrido.length - 1) setSeleccionado(posiciones.length - 1);
      }
    } else {
      setIndice(0);
      setReproduciendo(false);
      setSeleccionado(posiciones.length > 0 ? 0 : null);
      setParadaSeleccionada(null);
    }
  }

  const ultimoRecorrido = useRef<Posicion[]>(posiciones);
  useLayoutEffect(() => {
    const previo = ultimoRecorrido.current;
    ultimoRecorrido.current = posiciones;
    if (previo !== posiciones && extensionDe(previo, posiciones)) {
      // Misma ruta con más puntos: el reloj sigue donde estaba (o pasa al nuevo
      // final si estaba en el último).
      if (!reproduciendoRef.current && indiceRef.current >= previo.length - 1) {
        indiceRef.current = posiciones.length - 1;
        indicePintadoRef.current = posiciones.length - 1;
        instanteRef.current = milisegundos(posiciones[posiciones.length - 1].registradoEn);
      }
      sincronizarSlider(instanteRef.current);
      return;
    }
    indiceRef.current = 0;
    indicePintadoRef.current = 0;
    instanteRef.current = posiciones.length > 0 ? milisegundos(posiciones[0].registradoEn) : 0;
    sincronizarSlider(instanteRef.current);
  }, [posiciones, sincronizarSlider]);

  const indiceAcotado = posiciones.length === 0 ? 0 : Math.min(indice, posiciones.length - 1);
  const punto = posiciones[indiceAcotado] ?? null;

  // Estado del fix actual: alimenta el color del marcador. La antigüedad se
  // evalúa contra Date.now(), pero solo manda en el último fix del recorrido;
  // en los intermedios la señal la decide el salto al fix siguiente.
  const estadoUnidad = useMemo(
    () => estadoDePunto(posiciones, huecos, indiceAcotado, Date.now(), finRangoMs),
    [posiciones, huecos, indiceAcotado, finRangoMs],
  );

  useEffect(() => {
    if (!mapa) {
      marcadorActual.current?.remove();
      marcadorActual.current = null;
      return;
    }
    const primero = posiciones[0];
    // Sin posiciones (otra persona u otra fecha vacía) se quita el marcador
    // anterior.
    if (!primero) {
      marcadorActual.current?.remove();
      marcadorActual.current = null;
      return;
    }
    if (!marcadorActual.current) {
      const elemento = document.createElement('div');
      elemento.className = `marcador-actual ${CLASE_ESTADO[estadoUnidad]}`;
      // maplibre pide la posición antes de addTo.
      marcadorActual.current = new Marker({ element: elemento, anchor: 'center' })
        .setLngLat([primero.longitud, primero.latitud])
        .addTo(mapa);
    }
  }, [mapa, posiciones, estadoUnidad]);

  useEffect(() => {
    const elemento = marcadorActual.current?.getElement();
    if (elemento) elemento.className = `marcador-actual ${CLASE_ESTADO[estadoUnidad]}`;
  }, [estadoUnidad, mapa, posiciones]);

  useEffect(() => {
    // Mientras se reproduce, el marcador lo mueve el bucle de animación; esto
    // solo atiende los cambios a mano (barra, saltos, selección).
    if (reproduciendo) return;
    const i = Math.min(indice, posiciones.length - 1);
    // El punto elegido con clic manda: marcador, aro y globo en el mismo sitio.
    const lugar = puntoClic && seleccionado === i ? puntoClic : enLinea(i);
    if (!lugar) return;
    marcadorActual.current?.setLngLat(lugar);
    // setCenter sin animación: el acompañamiento es un salto sólido al punto;
    // una transición por frame pelearía con el siguiente.
    if (seguir && mapa) mapa.setCenter(lugar, { duration: 0 });
  }, [indice, posiciones, mapa, seguir, reproduciendo, puntoClic, seleccionado, enLinea]);

  // Con la reproducción detenida el slider se sincroniza con el fix actual:
  // cubre el arrastre, los saltos, la selección y el fin del recorrido.
  useEffect(() => {
    if (reproduciendo) return;
    sincronizarSlider(punto ? milisegundos(punto.registradoEn) : 0);
  }, [reproduciendo, punto, sincronizarSlider]);

  // Factor base del reloj simulado: cambia con el recorrido cargado, así que se
  // memoiza y el bucle lo captura en sus dependencias.
  const factor = useMemo(() => factorBase(posiciones), [posiciones]);
  // Ventanas de espera [desde, hasta) en ms: paradas y cortes de señal.
  const esperas = useMemo<[number, number][]>(
    () => [
      ...paradas.map((p) => [milisegundos(p.inicio), milisegundos(p.fin)] as [number, number]),
      ...huecos.map((h) => [milisegundos(h.desde), milisegundos(h.hasta)] as [number, number]),
    ],
    [paradas, huecos],
  );

  useEffect(() => {
    if (!reproduciendo || posiciones.length < 2) return;
    let cuadro = 0;
    let anteriorFrame = performance.now();
    let ultimoPintado = 0;
    let ultimaGuia = 0;
    aplicarProgreso.current(instanteRef.current);
    const avanzar = (ahora: number) => {
      // El reloj avanza con el tiempo real entre cuadros: a 4× el recorrido
      // dura la cuarta parte. Al pausar o cambiar de velocidad la posición se
      // conserva en instanteRef.
      const avance = (ahora - anteriorFrame) * velocidadReproduccion * factor;
      const espera = saltarEsperas ? esperas.find(([desde, hasta]) => instanteRef.current >= desde && instanteRef.current < hasta) : undefined;
      // Dentro de una espera el reloj corre más rápido, pero sin pasar de su
      // final: el trayecto que sigue se ve a la velocidad elegida.
      instanteRef.current = espera
        ? Math.min(instanteRef.current + avance * FACTOR_ESPERA, Math.max(espera[1], instanteRef.current + avance))
        : instanteRef.current + avance;
      anteriorFrame = ahora;
      // El slider (valor y relleno) se escribe en cada frame: la barra de
      // progreso avanza continua aunque React repinte a 5 Hz.
      sincronizarSlider(instanteRef.current);
      const siguiente = indicePorInstante(posiciones, instanteRef.current);
      if (siguiente >= posiciones.length - 1) {
        indiceRef.current = posiciones.length - 1;
        indicePintadoRef.current = posiciones.length - 1;
        sincronizarSlider(milisegundos(posiciones[posiciones.length - 1].registradoEn));
        setIndice(posiciones.length - 1);
        setReproduciendo(false);
        return;
      }
      indiceRef.current = siguiente;
      if (ahora - ultimaGuia >= INTERVALO_GUIA_MS) {
        ultimaGuia = ahora;
        aplicarProgreso.current(instanteRef.current);
      }
      if (siguiente !== indicePintadoRef.current && ahora - ultimoPintado >= INTERVALO_PINTADO_MS) {
        indicePintadoRef.current = siguiente;
        ultimoPintado = ahora;
        setIndice(siguiente);
      }
      // Sobre el trazado dibujado; fuera de él (paradas), la interpolación
      // entre fixes de siempre.
      const interpolado = puntoEnInstante(posiciones, huecos, instanteRef.current, reconstruidos);
      const lugar: [number, number] | null =
        puntoEnLineas(lineas, instanteRef.current) ?? (interpolado ? [interpolado.longitud, interpolado.latitud] : null);
      if (lugar) {
        marcadorActual.current?.setLngLat(lugar);
        if (seguir && mapa) mapa.setCenter(lugar, { duration: 0 });
      }
      cuadro = window.requestAnimationFrame(avanzar);
    };
    cuadro = window.requestAnimationFrame(avanzar);
    return () => window.cancelAnimationFrame(cuadro);
  }, [reproduciendo, velocidadReproduccion, posiciones, huecos, reconstruidos, lineas, factor, seguir, mapa, sincronizarSlider, saltarEsperas, esperas]);

  // Recorrido guiado: al reproducir o arrastrar, lo ya recorrido se ve con su
  // color de siempre y lo que falta, atenuado. Lo recorrido se dibuja con las
  // mismas líneas con hora por las que va el marcador, así que el final de
  // la línea sólida coincide con el círculo; el tramo en curso se corta en su
  // posición exacta. Sin guía (t null) todo se ve igual que antes.
  const primerFix = posiciones.length > 0 ? milisegundos(posiciones[0].registradoEn) : 0;
  const ultimoFix = posiciones.length > 0 ? milisegundos(posiciones[posiciones.length - 1].registradoEn) : 0;
  const guiado = useRef(false);
  const guias = useMemo(() => lineas.map((linea) => prepararGuia(linea, primerFix, ultimoFix)), [lineas, primerFix, ultimoFix]);
  // Último avance puesto en cada línea: solo se toca el mapa cuando cambia.
  const avanceAplicado = useRef<number[]>([]);
  useEffect(() => {
    avanceAplicado.current = [];
  }, [guias, versionGuia]);
  const aplicarProgreso = useRef<(t: number | null) => void>(() => {});
  aplicarProgreso.current = (t) => {
    if (!mapa) return;
    const activo = t != null;
    if (activo !== guiado.current) {
      guiado.current = activo;
      for (const id of ['replay-borde', 'replay-linea', 'replay-caminata', 'replay-estimated']) {
        if (mapa.getLayer(id)) mapa.setPaintProperty(id, 'line-opacity', activo ? OPACIDAD_POR_RECORRER : 1);
      }
    }
    guias.forEach((guia, i) => {
      const avance = activo ? progresoEn(lineas[i], guia, t) : 0;
      if (avanceAplicado.current[i] === avance || !mapa.getLayer(`replay-hecho-linea-${i}`)) return;
      avanceAplicado.current[i] = avance;
      mapa.setPaintProperty(`replay-hecho-linea-${i}`, 'line-gradient', gradienteHasta(guia, avance) as never);
      mapa.setPaintProperty(`replay-hecho-borde-${i}`, 'line-gradient', gradienteHasta(guia, avance, BLANCO) as never);
    });
  };
  // En pausa (tras arrastrar o elegir un punto) la guía sigue al reloj; en el
  // primer punto y al final todo se ve completo.
  useEffect(() => {
    if (reproduciendo) return;
    const enMedio = indice > 0 && indice < posiciones.length - 1;
    aplicarProgreso.current(enMedio ? instanteRef.current : null);
  }, [mapa, reproduciendo, indice, posiciones, lineas, versionGuia]);

  // Resaltado del punto seleccionado. La superficie de selección es la capa de
  // acierto de línea que agrega Replay junto a la ruta; aquí solo vive el aro
  // del fix elegido. La capa se agrega una sola vez por mapa y Replay la sube
  // sobre la ruta al terminar de construir sus propias capas.
  useEffect(() => {
    if (!mapa) return;
    if (!mapa.getSource('replay-punto-sel')) {
      mapa.addSource('replay-punto-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!mapa.getLayer('replay-punto-activo')) {
      mapa.addLayer({
        id: 'replay-punto-activo',
        type: 'circle',
        source: 'replay-punto-sel',
        // Halo del punto elegido, bajo el marcador (mismo sitio): un solo
        // punto seleccionado, sin un segundo círculo de otro color.
        paint: {
          'circle-radius': 14,
          'circle-color': '#17365d',
          'circle-opacity': 0.18,
          'circle-stroke-color': '#17365d',
          'circle-stroke-opacity': 0.55,
          'circle-stroke-width': 1.5,
        },
      });
    }
  }, [mapa]);

  const coleccionSeleccion = useMemo<FeatureCollection<Point>>(() => {
    const fijado = seleccionado != null ? posiciones[seleccionado] ?? null : null;
    if (!fijado) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: puntoClic ?? enLinea(seleccionado!) ?? [fijado.longitud, fijado.latitud] },
        },
      ],
    };
  }, [posiciones, seleccionado, puntoClic, enLinea]);

  useEffect(() => {
    if (!mapa) return;
    mapa.getSource<GeoJSONSource>('replay-punto-sel')?.setData(coleccionSeleccion);
  }, [mapa, coleccionSeleccion]);

  // Selección de un fix concreto: pausa, ubica el reloj y deja el punto
  // resaltado. Va en useCallback porque el manejador de clic del mapa se
  // suscribe una vez por instancia de mapa.
  const seleccionar = useCallback(
    (nuevoIndice: number) => {
      if (posiciones.length === 0) return;
      const acotado = Math.min(Math.max(nuevoIndice, 0), posiciones.length - 1);
      const fix = posiciones[acotado];
      indiceRef.current = acotado;
      indicePintadoRef.current = acotado;
      if (fix) instanteRef.current = milisegundos(fix.registradoEn);
      sincronizarSlider(instanteRef.current);
      setReproduciendo(false);
      setIndice(acotado);
      setSeleccionado(acotado);
      setPuntoClic(null);
      // Un punto suelto de la ruta ya no es la parada elegida.
      setParadaSeleccionada(null);
    },
    [posiciones, sincronizarSlider],
  );

  const quitarSeleccion = useCallback(() => setSeleccionado(null), []);

  // Selección de parada desde la lista o desde su insignia en el mapa: pausa,
  // ubica el reloj en el inicio de la parada, resalta la fila y la insignia y
  // vuela el mapa hasta ella. El vuelo mantiene el zoom actual si ya está en la
  // banda urbana (15-16); con movimiento reducido el encuadre es instantáneo.
  const seleccionarParada = useCallback(
    (indiceParada: number | null, latitud: number, longitud: number, instante: number) => {
      if (posiciones.length === 0) return;
      seleccionar(indicePorInstante(posiciones, instante));
      setParadaSeleccionada(indiceParada);
      if (!mapa) return;
      const zoom = Math.min(Math.max(mapa.getZoom(), ZOOM_PARADA_MIN), ZOOM_PARADA_MAX);
      const centro: [number, number] = [longitud, latitud];
      const [dx, dy] = desplazamientoVisible(mapa);
      const offset: [number, number] = [dx, dy + (indiceParada != null ? ALTO_FICHA_PARADA_PX / 2 : 0)];
      if (movimientoReducido()) {
        mapa.easeTo({ center: centro, zoom, offset, duration: 0 });
        return;
      }
      mapa.flyTo({
        center: centro,
        zoom,
        offset,
        duration: DURACION_VUELO_PARADA_MS,
        curve: CURVA_VUELO_PARADA,
        essential: true,
      });
    },
    [posiciones, mapa, seleccionar],
  );

  useEffect(() => {
    if (!mapa) return;
    // Clic en el recorrido: sobre una flecha se elige ese punto; sobre la
    // línea, el más cercano. El mapa se centra en el punto y el globo muestra
    // fecha, hora y batería. El evento de 'replay-linea-hit' se puede
    // registrar antes de que exista la capa.
    // El centro se calcula sobre la parte del mapa que queda libre entre el
    // panel lateral y la franja de abajo.
    const centrar = (lon: number, lat: number) => {
      mapa.easeTo({
        center: [lon, lat],
        offset: desplazamientoVisible(mapa),
        duration: movimientoReducido() ? 0 : 450,
        essential: true,
      });
    };
    // Flecha más cercana al clic (en píxeles), aunque con ese zoom no se
    // dibuje: cualquier punto del trazo da una posición y su hora de paso.
    const flechaEn = (evento: MapMouseEvent, radioPx: number): { lon: number; lat: number; t: number } | null => {
      if (!mapa.getSource('replay-flechas')) return null;
      let mejor: { lon: number; lat: number; t: number } | null = null;
      let mejorPx = radioPx;
      for (const flecha of mapa.querySourceFeatures('replay-flechas')) {
        if (flecha.geometry.type !== 'Point') continue;
        const [lon, lat] = flecha.geometry.coordinates;
        const px = mapa.project([lon, lat]);
        const d = Math.hypot(px.x - evento.point.x, px.y - evento.point.y);
        if (d < mejorPx) {
          mejorPx = d;
          mejor = { lon, lat, t: Number(flecha.properties?.t) };
        }
      }
      return mejor;
    };
    const alPulsar = (evento: MapMouseEvent) => {
      globoPedido.current = true;
      const flecha = flechaEn(evento, 24);
      if (flecha && Number.isFinite(flecha.t)) {
        seleccionar(indiceCercano(posiciones, flecha.t));
        setPuntoClic([flecha.lon, flecha.lat]);
        centrar(flecha.lon, flecha.lat);
        return;
      }
      const indice = indiceMasCercano(posiciones, evento.lngLat.lng, evento.lngLat.lat);
      if (indice == null) return;
      seleccionar(indice);
      const lugar = enLinea(indice);
      if (lugar) centrar(lugar[0], lugar[1]);
    };
    const alEntrar = () => {
      mapa.getCanvas().style.cursor = 'pointer';
    };
    const alSalir = () => {
      mapa.getCanvas().style.cursor = '';
    };
    mapa.on('mouseenter', 'replay-flechas', alEntrar);
    mapa.on('mouseleave', 'replay-flechas', alSalir);
    mapa.on('click', ['replay-linea-hit', 'replay-flechas'], alPulsar);
    mapa.on('mouseenter', 'replay-linea-hit', alEntrar);
    mapa.on('mouseleave', 'replay-linea-hit', alSalir);
    return () => {
      mapa.off('mouseenter', 'replay-flechas', alEntrar);
      mapa.off('mouseleave', 'replay-flechas', alSalir);
      mapa.off('click', ['replay-linea-hit', 'replay-flechas'], alPulsar);
      mapa.off('mouseenter', 'replay-linea-hit', alEntrar);
      mapa.off('mouseleave', 'replay-linea-hit', alSalir);
    };
  }, [mapa, posiciones, seleccionar, enLinea]);

  // Al pasar el cursor por el recorrido: hora, velocidad y batería del punto.
  // Sobre un salto sin observar dice cuánto duró y cuánto se alejó.
  useEffect(() => {
    if (!mapa) return;
    const hover = globoHoverDe(mapa);
    let cuadro = 0;
    let ultimo: (MapMouseEvent & { features?: { properties?: Record<string, unknown> | null }[] }) | null = null;
    const pintar = () => {
      cuadro = 0;
      const evento = ultimo;
      if (!evento || hover.ocupado) return;
      // Si bajo el cursor hay un corte de señal (aunque otra pasada lo cubra),
      // se habla del corte: es lo que no se ve a simple vista.
      const propiedades = (evento.features?.find((f) => f.properties?.tipo === 'hueco') ?? evento.features?.[0])?.properties ?? {};
      let contenido: HTMLElement | null = null;
      if (propiedades.tipo === 'hueco') {
        const i = indicePorInstante(posiciones, Number(propiedades.instante));
        const antes = posiciones[i];
        const despues = posiciones[i + 1];
        if (antes && despues) contenido = globoDeCorte(antes, despues);
      } else {
        // Punto registrado más cercano al cursor: hora, velocidad y batería.
        const indice = indiceMasCercano(posiciones, evento.lngLat.lng, evento.lngLat.lat);
        const fix = indice == null ? null : posiciones[indice];
        const modo = propiedades.modo as keyof typeof ETIQUETA_MODO_REAL | undefined;
        if (fix) {
          contenido = globoDePunto(
            [horaConSegundos(fix.registradoEn), fix.velocidadKmh == null ? null : velocidad(fix.velocidadKmh)].filter(Boolean).join(' · '),
            [
              ...(modo && ETIQUETA_MODO_REAL[modo] ? [{ etiqueta: 'Desplazamiento', valor: ETIQUETA_MODO_REAL[modo] }] : []),
              ...(fix.simulada ? [{ etiqueta: 'GPS', valor: 'Ubicación simulada' }] : []),
              { etiqueta: 'Batería', valor: bateria(fix.bateriaPct) },
            ],
          );
        }
      }
      if (!contenido) {
        hover.ocultar();
        return;
      }
      hover.mostrar(contenido, [evento.lngLat.lng, evento.lngLat.lat]);
    };
    const alMover = (evento: MapMouseEvent) => {
      ultimo = evento as typeof ultimo;
      // Un globo por cuadro: el cursor genera muchos eventos y armar el DOM en
      // cada uno haría pesado el mapa.
      if (cuadro === 0) cuadro = window.requestAnimationFrame(pintar);
    };
    const alSalir = () => {
      ultimo = null;
      hover.ocultar();
    };
    mapa.on('mousemove', 'replay-linea-hit', alMover);
    mapa.on('mouseleave', 'replay-linea-hit', alSalir);
    return () => {
      mapa.off('mousemove', 'replay-linea-hit', alMover);
      mapa.off('mouseleave', 'replay-linea-hit', alSalir);
      window.cancelAnimationFrame(cuadro);
      hover.quitar();
    };
  }, [mapa, posiciones]);

  // Cada corte de señal que dejó un salto en el mapa lleva una etiqueta en el
  // medio de su línea de guiones, con lo que duró. Los cortes sin movimiento
  // (el teléfono quieto adentro) se leen en la pista de tiempo, no aquí.
  useEffect(() => {
    if (!mapa) return;
    const marcadores: Marker[] = [];
    const hover = globoHoverDe(mapa);
    const cortes = huecos.filter((h) => h.motivo !== 'FUERA_DE_JORNADA');
    for (const hueco of cortes.slice(0, MAX_ETIQUETAS_CORTE)) {
      const i = indicePorInstante(posiciones, milisegundos(hueco.desde));
      const antes = posiciones[i];
      const despues = posiciones[i + 1];
      if (!antes || !despues || distanciaM(antes, despues) < SALTO_ETIQUETA_M) continue;
      const elemento = document.createElement('button');
      elemento.type = 'button';
      elemento.className = 'marcador-corte';
      aislarDelMapa(elemento);
      elemento.textContent = `Sin señal · ${duracion(hueco.duracionSegundos)}`;
      const centro: [number, number] = [(antes.longitud + despues.longitud) / 2, (antes.latitud + despues.latitud) / 2];
      elemento.addEventListener('mouseenter', () => hover.entrar(globoDeCorte(antes, despues), centro, 16));
      elemento.addEventListener('mouseleave', () => hover.salir());
      elemento.addEventListener('click', () => seleccionar(i));
      marcadores.push(new Marker({ element: elemento, anchor: 'center' }).setLngLat(centro).addTo(mapa));
    }
    return () => {
      for (const marcador of marcadores) marcador.remove();
      hover.quitar();
    };
  }, [mapa, huecos, posiciones, seleccionar]);

  // Globo sobre el punto elegido: fecha, hora y batería. Solo aparece después
  // de un clic en el mapa.
  const globo = useRef<Popup | null>(null);
  useEffect(() => {
    globoPedido.current = false;
  }, [posiciones]);
  useEffect(() => {
    const fix = seleccionado != null ? posiciones[seleccionado] ?? null : null;
    if (!mapa || !fix || !globoPedido.current || paradaSeleccionada != null) {
      globo.current?.remove();
      globo.current = null;
      return;
    }
    const contenido = document.createElement('div');
    contenido.className = 'globo-fix';
    const filas: [string, string][] = [
      ['Fecha', fecha(fix.registradoEn)],
      ['Hora', horaConSegundos(fix.registradoEn)],
      ['Batería', bateria(fix.bateriaPct)],
    ];
    if (!esPreciso(fix) && fix.precisionM != null) {
      filas.push(['Ubicación', `aproximada ±${Math.round(fix.precisionM)} m`]);
    }
    for (const [etiqueta, valor] of filas) {
      const fila = document.createElement('p');
      const e = document.createElement('span');
      e.textContent = etiqueta;
      const v = document.createElement('strong');
      v.textContent = valor;
      fila.append(e, v);
      contenido.append(fila);
    }
    if (!globo.current) {
      globo.current = new Popup({ anchor: 'bottom', offset: 14, closeButton: false, closeOnClick: false, className: 'replay-globo' });
    }
    globo.current
      .setLngLat(puntoClic ?? enLinea(seleccionado!) ?? [fix.longitud, fix.latitud])
      .setDOMContent(contenido)
      .addTo(mapa);
  }, [mapa, posiciones, seleccionado, puntoClic, enLinea, paradaSeleccionada]);
  useEffect(
    () => () => {
      globo.current?.remove();
    },
    [],
  );

  function moverA(nuevoIndice: number) {
    if (posiciones.length === 0) return;
    const acotado = Math.min(Math.max(nuevoIndice, 0), posiciones.length - 1);
    indiceRef.current = acotado;
    indicePintadoRef.current = acotado;
    setIndice(acotado);
    const fix = posiciones[acotado];
    if (fix) instanteRef.current = milisegundos(fix.registradoEn);
    sincronizarSlider(instanteRef.current);
  }

  function alternarReproduccion() {
    if (posiciones.length < 2) return;
    if (reproduciendo) {
      pausar();
      return;
    }
    // Si ya terminó, volver a reproducir arranca desde el principio.
    if (indiceRef.current >= posiciones.length - 1) moverA(0);
    setReproduciendo(true);
  }

  // Al pausar se alinea el punto de la pantalla con el reloj (puede ir un
  // poco atrasado); sin esto el marcador retrocedería. El reloj no se toca
  // para seguir exactamente desde ahí.
  function pausar() {
    setReproduciendo(false);
    indicePintadoRef.current = indiceRef.current;
    setIndice(indiceRef.current);
  }

  // Paso a paso: cada toque avanza o retrocede exactamente un punto. Pausa y
  // actualiza la ficha, el mapa, el reloj y la barra a la vez; en los extremos
  // se queda en el primero o el último.
  function moverPunto(direccion: 1 | -1) {
    if (posiciones.length === 0) return;
    const destino = Math.min(Math.max(indiceRef.current + direccion, 0), posiciones.length - 1);
    seleccionar(destino);
  }

  // Al saltar desde la lista de paradas se pausa, porque la idea es mirar la
  // parada. indicePorInstante da el último punto anterior a esa hora.
  function irAInstante(instante: number) {
    if (posiciones.length === 0) return;
    pausar();
    moverA(indicePorInstante(posiciones, instante));
  }

  // Parada anterior o siguiente respecto del reloj. Estando dentro de una
  // parada, "anterior" va a la de antes y no a su propio inicio.
  const irAParada = useCallback(
    (direccion: 1 | -1) => {
      const ahora = instanteRef.current;
      const margen = 1000;
      const lista = paradas.map((parada, i) => ({ parada, i, inicio: milisegundos(parada.inicio) }));
      const destino =
        direccion === 1
          ? lista.find((p) => p.inicio > ahora + margen)
          : [...lista].reverse().find((p) => p.inicio < ahora - margen);
      if (destino) seleccionarParada(destino.i, destino.parada.latitud, destino.parada.longitud, destino.inicio);
    },
    [paradas, seleccionarParada],
  );

  // Atajos de teclado: Espacio reproduce o pausa; ← y → avanzan un punto (con
  // Mayús, diez); N y P saltan a la parada siguiente o anterior; + y - cambian
  // la velocidad. No actúan sobre campos, botones ni la barra de tiempo, que ya
  // responden al teclado por sí mismos.
  const atajos = useRef<(evento: KeyboardEvent) => void>(() => {});
  atajos.current = (evento) => {
    if (evento.defaultPrevented || evento.ctrlKey || evento.metaKey || evento.altKey) return;
    const objetivo = evento.target as HTMLElement | null;
    if (objetivo?.closest('input, select, textarea, button, a, [contenteditable="true"]')) return;
    if (posiciones.length < 2) return;
    const paso = evento.shiftKey ? 10 : 1;
    switch (evento.key) {
      case ' ':
        alternarReproduccion();
        break;
      case 'ArrowRight':
        seleccionar(indiceRef.current + paso);
        break;
      case 'ArrowLeft':
        seleccionar(indiceRef.current - paso);
        break;
      case 'n':
      case 'N':
        irAParada(1);
        break;
      case 'p':
      case 'P':
        irAParada(-1);
        break;
      case '+':
      case '=':
      case '-':
      case '_': {
        const actual = Math.max(0, VELOCIDADES.indexOf(velocidadReproduccion));
        const siguiente = VELOCIDADES[Math.min(VELOCIDADES.length - 1, Math.max(0, actual + (evento.key === '-' || evento.key === '_' ? -1 : 1)))];
        setVelocidadReproduccion(siguiente);
        break;
      }
      default:
        return;
    }
    evento.preventDefault();
  };
  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => atajos.current(evento);
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  function alternarSaltarEsperas() {
    setSaltarEsperas((valor) => {
      try {
        localStorage.setItem('dmj.replay.saltarEsperas', valor ? '0' : '1');
      } catch {
        // Sin almacenamiento solo se pierde la preferencia.
      }
      return !valor;
    });
  }

  const estado: Reproductor = {
    posiciones,
    huecos,
    reconstruidos,
    dispositivo,
    finRangoMs,
    paradas,
    microparadas,
    resumen,
    nombreOficina,
    saltarEsperas,
    alternarSaltarEsperas,
    irAParada,
    indice: indiceAcotado,
    punto,
    estado: estadoUnidad,
    reproduciendo,
    velocidad: velocidadReproduccion,
    seguir,
    seleccionado,
    paradaSeleccionada,
    sliderRef,
    alternar: alternarReproduccion,
    alternarSeguir: () => setSeguir((activo) => !activo),
    moverPunto,
    cambiarVelocidad: (valor) => setVelocidadReproduccion(valor),
    mover: moverA,
    pausar,
    irA: irAInstante,
    seleccionarParada,
    seleccionar,
    quitarSeleccion,
  };

  return <ContextoReproductor.Provider value={estado}>{children}</ContextoReproductor.Provider>;
}

function useReproductor(): Reproductor {
  const reproductor = useContext(ContextoReproductor);
  if (!reproductor) {
    throw new Error('Los bloques de Replay van dentro de ReproductorReplay.');
  }
  return reproductor;
}

// Dirección a pedido, por coordenada redondeada; react-query no repite
// consultas y la caché de datos.ts evita pedir dos veces la misma parada.
function useDireccion(
  lat: number | null,
  lon: number | null,
  habilitada: boolean,
  precisionM: number | null = null,
): string | null {
  const consulta = useQuery({
    queryKey: [
      'geocode',
      lat == null ? null : lat.toFixed(5),
      lon == null ? null : lon.toFixed(5),
      precisionM == null ? null : Math.round(precisionM),
    ],
    queryFn: async () => {
      if (lat == null || lon == null) return { direccion: null };
      return traerDireccion(lat, lon, precisionM);
    },
    enabled: habilitada && lat != null && lon != null,
    retry: false,
    staleTime: Infinity,
  });
  return consulta.data?.direccion ?? null;
}

// Gráfico de la franja inferior: batería con un punto en la posición actual.
// Ampliado suma la velocidad en su propio eje. Las paradas se marcan en la
// línea de tiempo, no aquí.
function GraficoBateria({ ampliada }: { ampliada: boolean }) {
  const { posiciones, indice, pausar, mover } = useReproductor();
  const [bajoCursor, setBajoCursor] = useState<{ indice: number; x: number } | null>(null);
  const serie = useMemo(() => serieBateria(posiciones), [posiciones]);
  const velocidades = useMemo(
    () => posiciones.map((p) => (p.velocidadKmh != null && Number.isFinite(p.velocidadKmh) ? p.velocidadKmh : null)),
    [posiciones],
  );
  const instantes = useMemo(() => posiciones.map((p) => milisegundos(p.registradoEn)), [posiciones]);
  const hayBateria = useMemo(() => serie.some((valor) => valor != null), [serie]);
  const tema = useTema((e) => e.tema);

  // Eje X en tiempo real: una parada de horas ocupa su ancho verdadero, igual
  // que en la pista de tiempo de abajo.
  const datos = useMemo<ChartData<'line', { x: number; y: number | null }[]>>(() => {
    const linea = colorToken('marino-600');
    const relleno = tema === 'oscuro' ? 'rgba(147, 176, 214, .12)' : 'rgba(10, 37, 64, .1)';
    const indicePunto = indiceBateriaConocida(serie, indice);
    const punto = instantes[indicePunto];
    const conjuntos: ChartData<'line', { x: number; y: number | null }[]>['datasets'] = [
      {
        data: serie.map((valor, i) => ({ x: instantes[i], y: valor })),
        borderColor: linea,
        backgroundColor: relleno,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        spanGaps: true,
        yAxisID: 'y',
      },
      {
        data: punto != null ? [{ x: punto, y: serie[indicePunto] }] : [],
        borderColor: linea,
        backgroundColor: linea,
        pointRadius: 3.5,
        pointHoverRadius: 3.5,
        showLine: false,
        yAxisID: 'y',
      },
    ];
    if (ampliada) {
      conjuntos.push({
        data: velocidades.map((valor, i) => ({ x: instantes[i], y: valor })),
        borderColor: colorToken('movimiento'),
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        spanGaps: false,
        yAxisID: 'velocidad',
      });
    }
    return { datasets: conjuntos };
  }, [serie, velocidades, instantes, indice, tema, ampliada]);

  const opciones = useMemo<ChartOptions<'line'>>(() => {
    const ticks = { font: { size: 10 }, color: colorToken('texto-3') };
    return {
      ...OPCIONES_BATERIA,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      parsing: false,
      onClick: (_evento, elementos) => {
        const elemento = elementos.find((e) => e.datasetIndex === 0);
        if (!elemento) return;
        pausar();
        mover(elemento.index);
      },
      onHover: (evento, elementos) => {
        const destino = evento.native?.target as HTMLElement | null;
        const elemento = elementos.find((e) => e.datasetIndex === 0);
        if (destino) destino.style.cursor = elemento ? 'pointer' : '';
        setBajoCursor(elemento ? { indice: elemento.index, x: elemento.element.x } : null);
      },
      scales: {
        x: { type: 'linear', display: false, min: instantes[0], max: instantes[instantes.length - 1] },
        y: ampliada
          ? {
              display: true,
              min: 0,
              max: 100,
              ticks: { ...ticks, stepSize: 50, callback: (v) => `${v}%` },
              grid: { color: colorToken('borde') },
              border: { display: false },
              // Ancho fijo de los ejes: la pista de tiempo de abajo usa los
              // mismos márgenes (replay.css) y así cada parada queda debajo
              // de su tramo de la gráfica.
              afterFit: (escala) => {
                escala.width = ANCHO_EJE_BATERIA_PX;
              },
            }
          : { display: false, min: 0, max: 100 },
        velocidad: {
          display: ampliada,
          position: 'right',
          min: 0,
          suggestedMax: 40,
          ticks: { ...ticks, maxTicksLimit: 3, callback: (v) => `${v} km/h` },
          grid: { display: false },
          border: { display: false },
          afterFit: (escala) => {
            if (ampliada) escala.width = ANCHO_EJE_VELOCIDAD_PX;
          },
        },
      },
    };
  }, [mover, pausar, ampliada, instantes]);
  if (!hayBateria) return null;
  const bajo = bajoCursor ? posiciones[bajoCursor.indice] : null;
  const valorBajo = bajoCursor ? serie[bajoCursor.indice] : null;
  return (
    <div className="replay-bateria" onMouseLeave={() => setBajoCursor(null)}>
      <Line data={datos} options={opciones} />
      {bajo && valorBajo != null && bajoCursor && (
        <span className="bateria-etiqueta" style={{ left: bajoCursor.x }} role="status">
          <strong>{Math.round(valorBajo)}%</strong> · {horaCorta(bajo.registradoEn)}
          {ampliada && bajo.velocidadKmh != null && ` · ${velocidad(bajo.velocidadKmh)}`}
        </span>
      )}
    </div>
  );
}

// Ficha del punto elegido en el mapa: hora, dirección, velocidad y batería;
// si estaba en movimiento, detenida o sin señal; cómo se armó el tramo cuando
// el punto toca uno reconstruido (ajustado a vía o estimado, con la versión
// del mapa), y si el equipo está habilitado. Trae botones para volver al
// punto o soltarlo.
export function PanelPuntoSeleccionado() {
  const { posiciones, huecos, dispositivo, seleccionado, finRangoMs } = useReproductor();
  const punto = seleccionado != null ? posiciones[seleccionado] ?? null : null;
  const estado = useMemo(
    () => (seleccionado == null ? null : estadoDePunto(posiciones, huecos, seleccionado, Date.now(), finRangoMs)),
    [posiciones, huecos, seleccionado, finRangoMs],
  );
  // El clic sobre un trazado reconstruido selecciona su fix más cercano, que
  const direccion = useDireccion(punto?.latitud ?? null, punto?.longitud ?? null, punto != null, punto?.precisionM ?? null);
  if (!punto || seleccionado == null) {
    return (
      <section className="replay-punto">
        <h3>Detalle del punto</h3>
        <p className="replay-nota">Pulsa un punto del recorrido o una parada para ver su detalle.</p>
      </section>
    );
  }
  return (
    <section className="replay-punto">
      <h3>Detalle del punto</h3>
      <dl className="replay-ficha">
        <dt>Hora</dt>
        <dd>{fechaHoraCorta(punto.registradoEn)}</dd>
        <dt>Dirección</dt>
        <dd>{direccion ?? GUION}</dd>
        <dt>Velocidad</dt>
        <dd>{velocidad(punto.velocidadKmh)}</dd>
        <dt>Batería</dt>
        <dd>{bateria(punto.bateriaPct)}</dd>
        <dt>Estado</dt>
        <dd>{estado ? ETIQUETA_ESTADO_PUNTO[estado] : GUION}</dd>
        <dt>Equipo</dt>
        <dd>{dispositivo ? (dispositivo.habilitado ? 'Activo' : 'Dado de baja') : GUION}</dd>
      </dl>
    </section>
  );
}

// Fila de parada: desde/hasta, duración, extremo del recorrido y dirección. El
// geocode se pide solo para la primera fila (referencia de la zona) y para la
// seleccionada; el resto muestra la dirección que ya trajo el servidor.
function FilaParada({
  parada,
  indice,
  primera,
  ultima,
  activa,
  rol,
  etiquetaDelRol,
}: {
  parada: Parada;
  indice: number;
  primera: boolean;
  ultima: boolean;
  activa: boolean;
  rol: RolParada | null;
  etiquetaDelRol: string | null;
}) {
  const { seleccionarParada } = useReproductor();
  const pideDireccion = (primera || activa) && !parada.direccion;
  const geocodificada = useDireccion(
    pideDireccion ? (parada.latitudRepresentativa ?? parada.latitud) : null,
    pideDireccion ? (parada.longitudRepresentativa ?? parada.longitud) : null,
    pideDireccion,
    parada.precisionM ?? null,
  );
  const direccion = parada.direccion ?? geocodificada;
  const clases = [primera ? 'primera' : '', ultima ? 'ultima' : '', activa ? 'activa' : ''].filter(Boolean).join(' ');
  return (
    <li className={clases}>
      <button
        type="button"
        onClick={() => seleccionarParada(indice, parada.latitud, parada.longitud, milisegundos(parada.inicio))}
        title={`Desde ${horaCorta(parada.inicio)} hasta ${horaCorta(parada.fin)} (${duracion(parada.duracionMin * 60)})`}
      >
        <span className="parada-cabecera">
          <span className="parada-hora">
            Desde {horaCorta(parada.inicio)} hasta {horaCorta(parada.fin)}
          </span>
          {etiquetaDelRol ? (
            <span className={`parada-rol rol-${rol}`}>{etiquetaDelRol}</span>
          ) : (
            (primera || ultima) && <span className="parada-extremo">{primera ? 'Primera' : 'Última'}</span>
          )}
          <span className="parada-tiempo">{duracion(parada.duracionMin * 60)}</span>
        </span>
        {direccion && <span className="parada-direccion">{direccion}</span>}
      </button>
    </li>
  );
}

// Lista de paradas, abierta al cargar el recorrido. `origen` dice si vienen
// del servidor o del cálculo local, para avisar solo cuando el servidor
// falló. Se listan todas; el panel tiene su propio scroll.
export function ListaParadas({
  paradas,
  origen,
  total,
}: {
  paradas: Parada[];
  origen: 'servidor' | 'local';
  total?: number;
}) {
  const [abiertas, setAbiertas] = useState(true);
  const [microAbiertas, setMicroAbiertas] = useState(false);
  // La parada activa vive en el reproductor: elegirla desde su insignia del
  // mapa también resalta su fila, y viceversa.
  const { paradaSeleccionada, microparadas, seleccionarParada, resumen, nombreOficina } = useReproductor();
  if (paradas.length === 0 && microparadas.length === 0) return null;
  // El total del servidor puede superar las filas cargadas (tope de la
  // consulta): "y N más" cuenta lo que quedó fuera de la carga.
  const restantes = Math.max(total ?? paradas.length, paradas.length) - paradas.length;
  return (
    <section className="replay-paradas">
      <button
        type="button"
        className="replay-plegar-paradas"
        onClick={() => setAbiertas((valor) => !valor)}
        aria-expanded={abiertas}
      >
        Paradas ({paradas.length})
        <Icono nombre="flecha" />
      </button>
      {origen === 'local' && <p className="replay-nota">Calculadas con los datos del recorrido: el servidor no respondió.</p>}
      {abiertas && (
        <>
          <ul>
            {paradas.map((parada, posicion) => (
              <FilaParada
                key={`${parada.inicio}-${posicion}`}
                parada={parada}
                indice={posicion}
                primera={posicion === 0}
                ultima={posicion === paradas.length - 1}
                activa={paradaSeleccionada === posicion}
                rol={resumen?.roles[posicion] ?? null}
                etiquetaDelRol={resumen ? etiquetaRol(resumen.roles[posicion], resumen.numeroVisita[posicion], nombreOficina) : null}
              />
            ))}
          </ul>
          {restantes > 0 && <p className="replay-nota">y {restantes} más</p>}
        </>
      )}
      {/* Microparadas: detenciones de 40 s a 3 min en medio de un trayecto.
          Plegadas por defecto; no se numeran ni cortan viajes. */}
      {microparadas.length > 0 && (
        <>
          <button
            type="button"
            className="replay-plegar-paradas replay-plegar-micro"
            onClick={() => setMicroAbiertas((valor) => !valor)}
            aria-expanded={microAbiertas}
          >
            Microparadas ({microparadas.length})
            <Icono nombre="flecha" />
          </button>
          {microAbiertas && (
            <ul className="replay-microparadas">
              {microparadas.map((micro) => (
                <li key={micro.inicio}>
                  <button
                    type="button"
                    onClick={() => seleccionarParada(null, micro.latitud, micro.longitud, milisegundos(micro.inicio))}
                  >
                    <span className="parada-hora">
                      {horaCorta(micro.inicio)} – {horaCorta(micro.fin)}
                    </span>
                    <span className="parada-tiempo">{duracionCorta(micro.duracionS)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// Insignias numeradas de las paradas sobre el mapa. Se crean de nuevo solo al
// cambiar de recorrido; al elegir otra parada solo cambia cuál está activa.
// Tocar una insignia hace lo mismo que tocar su fila: pausa, ubica el reloj,
// resalta la parada y lleva el mapa hasta ella.
export function InsigniasParadas({ mapa, paradas }: { mapa: TipoMapa | null; paradas: Parada[] }) {
  const { paradaSeleccionada, seleccionarParada, microparadas, resumen, nombreOficina, posiciones } = useReproductor();
  const elementos = useRef<Map<number, HTMLDivElement>>(new Map());

  // Microparadas: punto chico sin número, debajo de las insignias. Pulsarlo
  // ubica el reloj y vuela el mapa hasta él, igual que una parada.
  useEffect(() => {
    if (!mapa) return;
    const marcadores = microparadas.map((micro) => {
      const elemento = document.createElement('div');
      elemento.className = 'marcador-microparada';
      aislarDelMapa(elemento);
      elemento.title = `Microparada: ${horaCorta(micro.inicio)} – ${horaCorta(micro.fin)} (${duracionCorta(micro.duracionS)})`;
      elemento.addEventListener('click', () => {
        seleccionarParada(null, micro.latitud, micro.longitud, milisegundos(micro.inicio));
      });
      return new Marker({ element: elemento, anchor: 'center' }).setLngLat([micro.longitud, micro.latitud]).addTo(mapa);
    });
    return () => {
      for (const marcador of marcadores) marcador.remove();
    };
  }, [mapa, microparadas, seleccionarParada]);

  useEffect(() => {
    if (!mapa) return;
    const almacen = elementos.current;
    const hover = globoHoverDe(mapa);
    const marcadores = paradas.map((parada, orden) => {
      const rol = resumen?.roles[orden] ?? 'visita';
      const nombre = etiquetaRol(rol, resumen?.numeroVisita[orden] ?? null, nombreOficina);
      const elemento = document.createElement('div');
      elemento.className = `marcador-parada rol-${rol}`;
      elemento.setAttribute('aria-label', `${nombre}: desde ${horaCorta(parada.inicio)} hasta ${horaCorta(parada.fin)}`);
      const insignia = document.createElement('span');
      insignia.className = 'parada-insignia';
      insignia.textContent = String(orden + 1);
      const etiqueta = document.createElement('span');
      etiqueta.className = 'parada-duracion';
      etiqueta.textContent = duracion(parada.duracionMin * 60);
      elemento.append(insignia, etiqueta);
      aislarDelMapa(elemento);
      // Al pasar el cursor, el mismo globo que da la línea (hora y batería del
      // punto) con lo de la parada: qué es, desde y hasta cuándo y su dirección.
      // Al pulsarla se abre la ficha completa y el globo sobra.
      elemento.addEventListener('mouseenter', () => {
        if (elemento.classList.contains('activa')) return;
        const indice = indiceMasCercano(posiciones, parada.longitud, parada.latitud);
        const fix = indice == null ? null : posiciones[indice];
        hover.entrar(
          globoDePunto(`${nombre} · Parada ${orden + 1}`, [
            { etiqueta: 'Desde', valor: horaCorta(parada.inicio) },
            { etiqueta: 'Hasta', valor: horaCorta(parada.fin) },
            { etiqueta: 'Duración', valor: duracion(parada.duracionMin * 60) },
            ...(parada.direccion ? [{ etiqueta: 'Dirección', valor: parada.direccion }] : []),
            ...(fix ? [{ etiqueta: 'Batería', valor: bateria(fix.bateriaPct) }] : []),
          ]),
          [parada.longitud, parada.latitud],
          18,
        );
      });
      elemento.addEventListener('mouseleave', () => hover.salir());
      elemento.addEventListener('click', () => {
        hover.quitar();
        seleccionarParada(orden, parada.latitud, parada.longitud, milisegundos(parada.inicio));
      });
      almacen.set(orden, elemento);
      return new Marker({ element: elemento, anchor: 'center' })
        .setLngLat([parada.longitud, parada.latitud])
        .addTo(mapa);
    });
    return () => {
      for (const marcador of marcadores) marcador.remove();
      hover.quitar();
      almacen.clear();
    };
  }, [mapa, paradas, posiciones, seleccionarParada, resumen, nombreOficina]);

  useEffect(() => {
    for (const [orden, elemento] of elementos.current) {
      elemento.classList.toggle('activa', orden === paradaSeleccionada);
    }
  }, [paradas, paradaSeleccionada, resumen, nombreOficina]);

  // Ficha desplegable de la parada elegida (desde, hasta, duración y
  // dirección), con apertura suave sobre la insignia. Se cierra al elegir un
  // punto u otra parada.
  const fichaParada = useRef<Popup | null>(null);
  useEffect(() => {
    const parada = paradaSeleccionada != null ? paradas[paradaSeleccionada] : undefined;
    if (!mapa || !parada || paradaSeleccionada == null) {
      fichaParada.current?.remove();
      fichaParada.current = null;
      return;
    }
    const contenido = document.createElement('div');
    contenido.className = 'ficha-parada';
    const titulo = document.createElement('p');
    titulo.className = 'ficha-parada-titulo';
    titulo.textContent = `Parada ${paradaSeleccionada + 1} · ${duracion(parada.duracionMin * 60)}`;
    const fila = (etiqueta: string, valor: string) => {
      const p = document.createElement('p');
      const e = document.createElement('span');
      e.textContent = etiqueta;
      const v = document.createElement('strong');
      v.textContent = valor;
      p.append(e, v);
      return { p, v };
    };
    const desde = fila('Desde', horaCorta(parada.inicio));
    const hasta = fila('Hasta', horaCorta(parada.fin));
    const direccion = fila('Dirección', parada.direccion || 'Buscando…');
    direccion.p.className = 'ficha-parada-direccion';
    const fixParada = indiceMasCercano(posiciones, parada.longitud, parada.latitud);
    const bat = fila('Batería', fixParada == null ? GUION : bateria(posiciones[fixParada].bateriaPct));
    contenido.append(titulo, desde.p, hasta.p, bat.p, direccion.p);
    let vigente = true;
    if (!parada.direccion) {
      traerDireccion(parada.latitud, parada.longitud, parada.precisionM ?? null)
        .then((r) => {
          if (vigente) direccion.v.textContent = r.direccion || GUION;
        })
        .catch(() => {
          if (vigente) direccion.v.textContent = GUION;
        });
    }
    fichaParada.current?.remove();
    fichaParada.current = new Popup({
      anchor: 'bottom',
      offset: 18,
      closeButton: false,
      closeOnClick: false,
      maxWidth: '260px',
      className: 'replay-globo replay-ficha-parada',
    })
      .setLngLat([parada.longitud, parada.latitud])
      .setDOMContent(contenido)
      .addTo(mapa);
    return () => {
      vigente = false;
    };
  }, [mapa, paradas, paradaSeleccionada, posiciones]);
  useEffect(
    () => () => {
      fichaParada.current?.remove();
    },
    [],
  );

  return null;
}

// Mandos del reproductor: transporte (play/pausa, seguir, paso a paso) y
// velocidades, como dos grupos que la rejilla de la franja ubica: compacta,
// en una fila sobre la pista; ampliada, a los lados de la pista.
function ControlesReplay() {
  const {
    posiciones,
    indice,
    reproduciendo,
    velocidad: velocidadReproduccion,
    seguir,
    alternar,
    alternarSeguir,
    moverPunto,
    cambiarVelocidad,
    irAParada,
    saltarEsperas,
    alternarSaltarEsperas,
    paradas,
  } = useReproductor();
  const unico = posiciones.length < 2;
  return (
    <>
      <div className="replay-transporte">
      <button
        type="button"
        className="suave icono-solo"
        onClick={alternar}
        disabled={unico}
        title={reproduciendo ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
        aria-label={reproduciendo ? 'Pausar' : 'Reproducir'}
      >
        <Icono nombre={reproduciendo ? 'pausa' : 'play'} />
      </button>
      <button
        type="button"
        className={`suave icono-solo${seguir ? ' seguir-activo' : ''}`}
        onClick={alternarSeguir}
        disabled={unico}
        title={seguir ? 'Dejar de seguir el punto' : 'Seguir el punto en el mapa'}
        aria-label={seguir ? 'Dejar de seguir el punto' : 'Seguir el punto en el mapa'}
        aria-pressed={seguir}
      >
        <Icono nombre="enVivo" />
      </button>
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => moverPunto(-1)}
        disabled={unico || indice <= 0}
        title="Punto anterior (←)"
        aria-label="Punto anterior"
      >
        <span className="voltear">
          <Icono nombre="flecha" />
        </span>
      </button>
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => moverPunto(1)}
        disabled={unico || indice >= posiciones.length - 1}
        title="Punto siguiente (→)"
        aria-label="Punto siguiente"
      >
        <Icono nombre="flecha" />
      </button>
      <span className="transporte-separador" aria-hidden="true" />
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => irAParada(-1)}
        disabled={unico || paradas.length === 0}
        title="Parada anterior (P)"
        aria-label="Parada anterior"
      >
        <SkipBack size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="suave icono-solo"
        onClick={() => irAParada(1)}
        disabled={unico || paradas.length === 0}
        title="Parada siguiente (N)"
        aria-label="Parada siguiente"
      >
        <SkipForward size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`suave icono-solo${saltarEsperas ? ' seguir-activo' : ''}`}
        onClick={alternarSaltarEsperas}
        disabled={unico}
        title={saltarEsperas ? 'Las paradas pasan rápido al reproducir (clic para verlas a tiempo real)' : 'Pasar rápido las paradas y los cortes de señal'}
        aria-label="Pasar rápido las paradas y los cortes de señal"
        aria-pressed={saltarEsperas}
      >
        <FastForward size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      </div>
      <div className="velocidades">
        {VELOCIDADES.map((valor) => (
          <button
            key={valor}
            type="button"
            className={`suave${velocidadReproduccion === valor ? ' velocidad-activa' : ''}`}
            onClick={() => cambiarVelocidad(valor)}
            title={`Velocidad ${valor}× (teclas + y -)`}
            aria-pressed={velocidadReproduccion === valor}
          >
            {valor}×
          </button>
        ))}
      </div>
    </>
  );
}

// Qué hay bajo el cursor en la pista: una parada, una microparada, un corte
// de señal o solo la hora.
type MarcaPista =
  | { tipo: 'parada'; indice: number; parada: Parada }
  | { tipo: 'micro'; micro: Microparada }
  | { tipo: 'hueco'; hueco: Hueco; indiceParada: number | null }
  | { tipo: 'hora' };

// Holgura en píxeles para acertar una microparada, que en la pista es una
// raya de 3 px.
const TOLERANCIA_MICRO_PX = 5;
// Margen de la pista a cada lado: medio pulgar del slider (12 px). El pulgar
// recorre [6 px, ancho - 6 px] y las marcas se dibujan en ese mismo tramo.
const MARGEN_PISTA_PX = 6;

// Pista de tiempo: el slider con su riel propio, donde se leen las paradas
// (bloques numerados como en la lista), las microparadas (rayas) y los cortes
// de señal (punteado). Al pasar el cursor, un globo dice qué hay en ese
// instante; al pulsar una parada o microparada se selecciona y el mapa vuela
// hasta ella, igual que desde la lista.
function PistaTiempo({ ampliada }: { ampliada: boolean }) {
  const {
    posiciones,
    huecos,
    paradas,
    microparadas,
    paradaSeleccionada,
    punto,
    sliderRef,
    mover,
    pausar,
    seleccionarParada,
    resumen,
    nombreOficina,
  } = useReproductor();
  const [bajo, setBajo] = useState<{ fraccion: number; instante: number; marca: MarcaPista } | null>(null);
  const primera = posiciones[0] ?? null;
  const ultima = posiciones[posiciones.length - 1] ?? null;
  const inicio = primera ? milisegundos(primera.registradoEn) : 0;
  const fin = ultima ? milisegundos(ultima.registradoEn) : 0;
  const total = Math.max(0, fin - inicio);
  const pct = (instante: number) => (total > 0 ? Math.min(Math.max(((instante - inicio) / total) * 100, 0), 100) : 0);
  const ahora = punto ? milisegundos(punto.registradoEn) : null;

  function marcaEn(instante: number, anchoUtil: number): MarcaPista {
    const indice = paradas.findIndex((p) => milisegundos(p.inicio) <= instante && instante <= milisegundos(p.fin));
    // Un corte de señal dentro de una parada (el teléfono no reportó mientras
    // estaba ahí) se dice primero: es lo que se busca al auditar la cobertura.
    const hueco = huecos.find((h) => milisegundos(h.desde) <= instante && instante <= milisegundos(h.hasta));
    if (hueco) return { tipo: 'hueco', hueco, indiceParada: indice >= 0 ? indice : null };
    if (indice >= 0) return { tipo: 'parada', indice, parada: paradas[indice] };
    const tolerancia = anchoUtil > 0 ? (TOLERANCIA_MICRO_PX / anchoUtil) * total : 0;
    const micro = microparadas.find(
      (m) => milisegundos(m.inicio) - tolerancia <= instante && instante <= milisegundos(m.fin) + tolerancia,
    );
    if (micro) return { tipo: 'micro', micro };
    return { tipo: 'hora' };
  }

  function alMover(evento: EventoRaton<HTMLDivElement>) {
    // La interfaz tiene zoom (--zoom-ui): la caja y el cursor vienen en píxeles
    // de pantalla y el margen en píxeles de diseño, así que se escala. El globo
    // se ubica por proporción.
    const caja = evento.currentTarget.getBoundingClientRect();
    const escala = evento.currentTarget.offsetWidth > 0 ? caja.width / evento.currentTarget.offsetWidth : 1;
    const margen = MARGEN_PISTA_PX * escala;
    const anchoUtil = caja.width - margen * 2;
    if (anchoUtil <= 0 || total <= 0) return;
    const fraccion = Math.min(Math.max((evento.clientX - caja.left - margen) / anchoUtil, 0), 1);
    const instante = inicio + fraccion * total;
    setBajo({ fraccion, instante, marca: marcaEn(instante, anchoUtil) });
  }

  // Soltar después de arrastrar la barra también dispara un "click": solo
  // cuenta como clic si el puntero casi no se movió.
  const inicioPulsacion = useRef<number | null>(null);
  function alPulsar(evento: EventoRaton<HTMLDivElement>) {
    const desde = inicioPulsacion.current;
    inicioPulsacion.current = null;
    if (desde == null || Math.abs(evento.clientX - desde) > 4) return;
    // Llevar el mapa a la parada solo con la franja ampliada: en la compacta un
    // clic en la barra solo mueve el reloj.
    if (!ampliada) return;
    const marca = bajo?.marca;
    if (marca?.tipo === 'parada' || (marca?.tipo === 'hueco' && marca.indiceParada != null)) {
      const indice = marca.tipo === 'parada' ? marca.indice : marca.indiceParada!;
      const parada = paradas[indice];
      seleccionarParada(indice, parada.latitud, parada.longitud, milisegundos(parada.inicio));
    } else if (marca?.tipo === 'micro') {
      const { micro } = marca;
      seleccionarParada(null, micro.latitud, micro.longitud, milisegundos(micro.inicio));
    }
  }

  // Un solo globo, siempre con la misma forma: arriba lo que marcaba el
  // teléfono en esa hora (igual que al pasar por la línea del mapa) y, si hay
  // algo ahí, abajo qué es. Así no cambia de color ni de tamaño al pasar de una
  // parada a la raya de al lado.
  function textoGlobo(marca: MarcaPista, instante: number): ReactNode {
    const fix = posiciones.length > 0 ? posiciones[indiceCercano(posiciones, instante)] : null;
    const rol = (indice: number) =>
      resumen ? etiquetaRol(resumen.roles[indice], resumen.numeroVisita[indice], nombreOficina) : null;
    let detalle: ReactNode = null;
    switch (marca.tipo) {
      case 'parada':
        detalle = (
          <>
            {rol(marca.indice) ? `${rol(marca.indice)} · ` : ''}Parada {marca.indice + 1} · {horaCorta(marca.parada.inicio)} –{' '}
            {horaCorta(marca.parada.fin)} · {duracion(marca.parada.duracionMin * 60)}
            {marca.parada.direccion && <span className="globo-linea">{marca.parada.direccion}</span>}
          </>
        );
        break;
      case 'micro':
        detalle = (
          <>
            Microparada · {horaCorta(marca.micro.inicio)} · {duracionCorta(marca.micro.duracionS)}
          </>
        );
        break;
      case 'hueco':
        detalle = (
          <>
            {marca.hueco.motivo === 'FUERA_DE_JORNADA' ? 'Fuera de jornada' : 'Sin señal'} · {horaCorta(marca.hueco.desde)} –{' '}
            {horaCorta(marca.hueco.hasta)} · {duracion(marca.hueco.duracionSegundos)}
          </>
        );
        break;
      default:
        break;
    }
    return (
      <>
        <strong>{horaCorta(new Date(instante).toISOString())}</strong>
        {fix && ` · ${velocidad(fix.velocidadKmh)} · ${bateria(fix.bateriaPct)}`}
        {detalle && <span className="globo-linea">{detalle}</span>}
      </>
    );
  }

  return (
    <div className="replay-pista">
      {ampliada && <span className="pista-hora">{horaCorta(primera?.registradoEn)}</span>}
      <div
        className={`pista-riel${ampliada && bajo && bajo.marca.tipo !== 'hora' ? ' sobre-marca' : ''}`}
        onMouseMove={alMover}
        onMouseLeave={() => setBajo(null)}
        onMouseDown={(evento) => {
          inicioPulsacion.current = evento.clientX;
        }}
        onClick={alPulsar}
      >
        <div className="pista-marcas" aria-hidden="true">
          <span className="pista-base" />
          <span className="pista-progreso" />
          {huecos.map((h, i) => (
            <span
              key={`h${i}`}
              className="pista-hueco"
              style={{ left: `${pct(milisegundos(h.desde))}%`, width: `${pct(milisegundos(h.hasta)) - pct(milisegundos(h.desde))}%` }}
            />
          ))}
          {paradas.map((p, i) => {
            const desde = milisegundos(p.inicio);
            const hasta = milisegundos(p.fin);
            const enCurso = ahora != null && desde <= ahora && ahora <= hasta;
            return (
              <span
                key={`p${i}`}
                className={`pista-parada${paradaSeleccionada === i ? ' activa' : ''}${enCurso ? ' en-curso' : ''}`}
                style={{ left: `${pct(desde)}%`, width: `${pct(hasta) - pct(desde)}%` }}
              />
            );
          })}
          {microparadas.map((m, i) => (
            <span key={`m${i}`} className="pista-micro" style={{ left: `${pct(milisegundos(m.inicio))}%` }} />
          ))}
        </div>
        <input
          ref={sliderRef}
          type="range"
          className="replay-slider"
          min={0}
          max={total}
          defaultValue={0}
          disabled={posiciones.length < 2}
          aria-label="Posición del recorrido"
          onChange={(evento) => {
            pausar();
            mover(indicePorInstante(posiciones, inicio + Number(evento.target.value)));
          }}
        />
        {bajo && (
          <span
            className="pista-globo"
            style={{ left: `calc(${MARGEN_PISTA_PX}px + ${bajo.fraccion} * (100% - ${MARGEN_PISTA_PX * 2}px))` }}
            role="status"
          >
            {textoGlobo(bajo.marca, bajo.instante)}
          </span>
        )}
      </div>
      {ampliada && <span className="pista-hora">{horaCorta(ultima?.registradoEn)}</span>}
    </div>
  );
}

// Lectura del instante en curso. Ampliada suma el estado y la parada en la
// que cae, para leer el punto sin mirar el panel.
function LecturaPunto({ ampliada }: { ampliada: boolean }) {
  const { punto, estado, paradas, microparadas } = useReproductor();
  const instante = punto ? milisegundos(punto.registradoEn) : null;
  const enParada =
    ampliada && instante != null
      ? paradas.findIndex((p) => milisegundos(p.inicio) <= instante && instante <= milisegundos(p.fin))
      : -1;
  const enMicro =
    ampliada && instante != null && enParada < 0
      ? microparadas.find((m) => milisegundos(m.inicio) <= instante && instante <= milisegundos(m.fin)) ?? null
      : null;
  return (
    <span className="replay-tiempos">
      <strong>{punto ? horaCorta(punto.registradoEn) : GUION}</strong> · {velocidad(punto?.velocidadKmh)} ·{' '}
      {bateria(punto?.bateriaPct)}
      {ampliada && punto && <span className={`lectura-estado ${CLASE_ESTADO[estado]}`}>{ETIQUETA_ESTADO_PUNTO[estado]}</span>}
      {enParada >= 0 && (
        <span className="lectura-parada">
          Parada {enParada + 1} · {duracion(paradas[enParada].duracionMin * 60)}
        </span>
      )}
      {enMicro && <span className="lectura-parada">Microparada · {duracionCorta(enMicro.duracionS)}</span>}
    </span>
  );
}

// Franja inferior: gráfico con la lectura del punto actual, los controles y la
// línea de tiempo con las paradas. Compacta es un bloque angosto; ampliada
// pone la lectura arriba, el gráfico a todo lo ancho y los controles en una
// fila.
export function LineaTiempoReplay() {
  const [ampliada, setAmpliada] = useState(false);
  return (
    <div className={`replay-linea${ampliada ? ' ampliada' : ''}`}>
      <button
        type="button"
        className="suave icono-solo replay-ampliar"
        onClick={() => setAmpliada((v) => !v)}
        title={ampliada ? 'Reducir' : 'Ampliar'}
        aria-label={ampliada ? 'Reducir la franja' : 'Ampliar la franja'}
        aria-pressed={ampliada}
      >
        {ampliada ? <Minimize2 size={13} strokeWidth={2.2} /> : <Maximize2 size={13} strokeWidth={2.2} />}
      </button>
      <div className="replay-lectura">
        <GraficoBateria ampliada={ampliada} />
        <LecturaPunto ampliada={ampliada} />
      </div>
      <div className="replay-controles">
        <ControlesReplay />
        <PistaTiempo ampliada={ampliada} />
      </div>
    </div>
  );
}
