import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Marker, Popup } from 'maplibre-gl';
import type { GeoJSONSource, Map as TipoMapa, MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { Dispositivo, Hueco, Posicion } from '@contratos';
import { bateria, fecha, GUION, velocidad } from '@/dominio/formatoBase';
import { esPreciso, puntoCercanoEnLineas, puntoEnLineas } from './flechas';
import type { Vertice } from './flechas';
import { BLANCO, gradienteHasta, prepararGuia, progresoEn } from './guia';
import type { ResumenDia } from '@/dominio/dia';
import { globoDeCorte, globoDePunto, globoHoverDe } from './globos';
import { novedadesDelRecorrido } from './novedades';
import {
  ETIQUETA_MODO_REAL,
  estadoDePunto,
  fechaHoraCorta,
  indiceMasCercano,
  indicePorInstante,
  milisegundos,
  puntoEnInstante,
} from '@/dominio/replay';
import type { Microparada, Parada, TramoReconstruido } from '@/dominio/replay';
import {
  SIN_PARADAS,
  SIN_LINEAS,
  horaConSegundos,
  SIN_MICROPARADAS,
  VELOCIDADES,
  INTERVALO_PINTADO_MS,
  ZOOM_PARADA_MIN,
  ZOOM_PARADA_MAX,
  DURACION_VUELO_PARADA_MS,
  CURVA_VUELO_PARADA,
  indiceCercano,
  desplazamientoVisible,
  ALTO_FICHA_PARADA_PX,
  aislarDelMapa,
  movimientoReducido,
  INTERVALO_GUIA_MS,
  OPACIDAD_POR_RECORRER,
  TRANSICION_GUIA_MS,
  ESPERA_MAX_MS,
  MAX_ETIQUETAS_CORTE,
  FACTOR_ESPERA,
  factorBase,
  CLASE_ESTADO,
  ETIQUETA_ESTADO_PUNTO,
} from './reproductorComun';
import {
  type Reproductor,
  ContextoReproductor,
  useReproductor,
  useDireccionConCarga,
} from './contextoReproductor';


export { ListaParadas } from './ListaParadas';
export { InsigniasParadas } from './InsigniasParadas';
export { LineaTiempoReplay } from './LineaTiempoReplay';

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
  // Número de visita de cada parada.
  resumen?: ResumenDia | null;
  // Cambia cuando Replay rehace las capas del recorrido guiado.
  versionGuia?: number;
  children: ReactNode;
}

// Contenedor de la reproducción: guarda el estado (reloj, punto actual,
// selección, saltos de hueco) y lo comparte con los bloques que Replay ubica
// en el panel flotante y en la franja inferior. El clic sobre la ruta se toma
// de la capa que agrega Replay; aquí se busca el punto más cercano.
export default function ReproductorReplay({ mapa, posiciones, huecos, reconstruidos, lineas = SIN_LINEAS, dispositivo, finRango, paradas = SIN_PARADAS, microparadas = SIN_MICROPARADAS, resumen = null, versionGuia = 0, children }: Props) {
  const finRangoMs = finRango ? milisegundos(finRango) : null;
  const [indice, setIndice] = useState(0);
  const reproduciendoRef = useRef(false);
  const [reproduciendo, setReproduciendo] = useState(false);
  reproduciendoRef.current = reproduciendo;
  const [velocidadReproduccion, setVelocidadReproduccion] = useState(1);
  // Al soltar en cualquier lado se deja de sostener.
  useEffect(() => {
    const soltar = () => setSosteniendo(false);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    return () => {
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
  }, []);
  // Clic sostenido en la ruta o en la barra: mientras dure, se ve lo recorrido
  // hasta ese punto y lo que falta atenuado.
  const [sosteniendo, setSosteniendo] = useState(false);
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
    if (elemento) elemento.className = `marcador-actual ${CLASE_ESTADO[estadoUnidad]}${sosteniendo ? ' sosteniendo' : ''}`;
  }, [sosteniendo, estadoUnidad, mapa, posiciones]);

  // Lugar del círculo en un instante: el centro de la parada si está en una;
  // si no, sobre la línea dibujada en ese instante (igual que al reproducir).
  const lugarEnInstante = (t: number, i: number): [number, number] | null => {
    if (paradas.some((p) => t >= milisegundos(p.inicio) && t <= milisegundos(p.fin))) return enLinea(i);
    const interpolado = puntoEnInstante(posiciones, huecos, t, reconstruidos);
    return puntoEnLineas(lineas, t) ?? (interpolado ? [interpolado.longitud, interpolado.latitud] : enLinea(i));
  };

  useEffect(() => {
    // Mientras se reproduce, el marcador lo mueve el bucle de animación; esto
    // solo atiende los cambios a mano (barra, saltos, selección).
    if (reproduciendo) return;
    const i = Math.min(indice, posiciones.length - 1);
    // El punto elegido con clic manda: marcador, aro y globo en el mismo sitio.
    // El punto elegido con clic queda bajo su aro; el resto, en el instante del
    // reloj (al soltar la barra no salta al punto guardado más cercano).
    const lugar =
      puntoClic && seleccionado === i ? puntoClic : seleccionado === i ? enLinea(i) : lugarEnInstante(instanteRef.current, i);
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
      const transcurrido = ahora - anteriorFrame;
      const avance = transcurrido * velocidadReproduccion * factor;
      const espera = saltarEsperas ? esperas.find(([desde, hasta]) => instanteRef.current >= desde && instanteRef.current < hasta) : undefined;
      // Dentro de una espera el reloj corre más rápido, pero sin pasar de su
      // final: el trayecto que sigue se ve a la velocidad elegida.
      // Una parada pasa en ESPERA_MAX_MS como mucho (a 1×), por larga que sea.
      const enEspera = espera
        ? Math.max(avance * FACTOR_ESPERA, ((espera[1] - espera[0]) * transcurrido * velocidadReproduccion) / ESPERA_MAX_MS)
        : 0;
      instanteRef.current = espera
        ? Math.min(instanteRef.current + enEspera, Math.max(espera[1], instanteRef.current + avance))
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

  // Recorrido guiado: al reproducir o mantener el clic (en la ruta o en la
  // barra), lo ya recorrido se ve con su color de siempre y lo que falta,
  // atenuado. El resto del tiempo la ruta se ve completa. Lo recorrido se dibuja con las
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
  const limpiarGuia = useRef(0);
  const pintarAvance = (t: number | null) => {
    if (!mapa) return;
    guias.forEach((guia, i) => {
      const avance = t != null ? progresoEn(lineas[i], guia, t) : 0;
      if (avanceAplicado.current[i] === avance || !mapa.getLayer(`replay-hecho-linea-${i}`)) return;
      avanceAplicado.current[i] = avance;
      mapa.setPaintProperty(`replay-hecho-linea-${i}`, 'line-gradient', gradienteHasta(guia, avance) as never);
      mapa.setPaintProperty(`replay-hecho-borde-${i}`, 'line-gradient', gradienteHasta(guia, avance, BLANCO) as never);
    });
  };
  aplicarProgreso.current = (t) => {
    if (!mapa) return;
    const activo = t != null;
    if (activo !== guiado.current) {
      guiado.current = activo;
      window.clearTimeout(limpiarGuia.current);
      for (const id of ['replay-borde', 'replay-linea', 'replay-caminata', 'replay-estimated']) {
        if (!mapa.getLayer(id)) continue;
        mapa.setPaintProperty(id, 'line-opacity-transition', { duration: TRANSICION_GUIA_MS, delay: 0 });
        mapa.setPaintProperty(id, 'line-opacity', activo ? OPACIDAD_POR_RECORRER : 1);
      }
      // Al soltar, lo que falta vuelve con un fundido; lo coloreado encima se
      // quita recién al terminar, así no parpadea.
      if (!activo) {
        limpiarGuia.current = window.setTimeout(() => pintarAvance(null), TRANSICION_GUIA_MS);
        return;
      }
    }
    if (activo) pintarAvance(t);
  };
  // En pausa la ruta se ve completa, salvo mientras se mantiene el clic.
  useEffect(() => {
    if (reproduciendo) return;
    aplicarProgreso.current(sosteniendo ? instanteRef.current : null);
  }, [mapa, reproduciendo, sosteniendo, indice, posiciones, lineas, versionGuia]);
  useEffect(() => () => window.clearTimeout(limpiarGuia.current), []);

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
  const cerrarParada = useCallback(() => setParadaSeleccionada(null), []);

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
      const zoom = indiceParada == null ? mapa.getZoom() : Math.min(Math.max(mapa.getZoom(), ZOOM_PARADA_MIN), ZOOM_PARADA_MAX);
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
    const RADIO_FLECHA_PX = 90;
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
    // Flecha visible más cercana al clic (en píxeles): el clic en la línea
    // cae siempre sobre una flecha, no en un punto suelto entre dos.
    const flechaEn = (evento: MapMouseEvent, radioPx: number): { lon: number; lat: number; t: number } | null => {
      if (!mapa.getSource('replay-flechas')) return null;
      const zoom = Math.floor(mapa.getZoom());
      let mejor: { lon: number; lat: number; t: number } | null = null;
      let mejorPx = radioPx;
      for (const flecha of mapa.querySourceFeatures('replay-flechas')) {
        if (flecha.geometry.type !== 'Point' || Number(flecha.properties?.n) > zoom) continue;
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
      const flecha = flechaEn(evento, RADIO_FLECHA_PX);
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
    // Mantener el clic sobre la ruta: se elige ese punto y se colorea hasta
    // ahí mientras no se suelte.
    const alSostener = (evento: MapMouseEvent) => {
      const flecha = flechaEn(evento, RADIO_FLECHA_PX);
      const indice =
        flecha && Number.isFinite(flecha.t)
          ? indiceCercano(posiciones, flecha.t)
          : indiceMasCercano(posiciones, evento.lngLat.lng, evento.lngLat.lat);
      if (indice == null) return;
      seleccionar(indice);
      setSosteniendo(true);
    };
    mapa.on('mousedown', ['replay-linea-hit', 'replay-flechas'], alSostener);
    mapa.on('touchstart', ['replay-linea-hit', 'replay-flechas'], alSostener as never);

    mapa.on('mouseenter', 'replay-linea-hit', alEntrar);
    mapa.on('mouseleave', 'replay-linea-hit', alSalir);
    return () => {
      mapa.off('mouseenter', 'replay-flechas', alEntrar);
      mapa.off('mouseleave', 'replay-flechas', alSalir);
      mapa.off('click', ['replay-linea-hit', 'replay-flechas'], alPulsar);
      mapa.off('mousedown', ['replay-linea-hit', 'replay-flechas'], alSostener);
      mapa.off('touchstart', ['replay-linea-hit', 'replay-flechas'], alSostener as never);

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
        const instante = Number(propiedades.instante);
        const hueco = huecos.find((h) => milisegundos(h.desde) <= instante + 1000 && instante <= milisegundos(h.hasta));
        if (antes && despues) contenido = globoDeCorte(antes, despues, hueco?.motivo);
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
    const alSalir = () => {
      ultimo = null;
      // Si el globo es de un marcador (parada, novedad), no es de la línea.
      if (!hover.ocupado) hover.ocultar();
    };
    const alMover = (evento: MapMouseEvent) => {
      // Sobre un marcador (parada, microparada, novedad) el mapa igual recibe
      // el movimiento: el globo de la línea de abajo aparecía y se iba sin
      // parar. Ahí no se muestra.
      if (evento.originalEvent.target !== mapa.getCanvas()) {
        alSalir();
        return;
      }
      ultimo = evento as typeof ultimo;
      // Un globo por cuadro: el cursor genera muchos eventos y armar el DOM en
      // cada uno haría pesado el mapa.
      if (cuadro === 0) cuadro = window.requestAnimationFrame(pintar);
    };
    mapa.on('mousemove', 'replay-linea-hit', alMover);
    mapa.on('mouseleave', 'replay-linea-hit', alSalir);
    return () => {
      mapa.off('mousemove', 'replay-linea-hit', alMover);
      mapa.off('mouseleave', 'replay-linea-hit', alSalir);
      window.cancelAnimationFrame(cuadro);
      hover.quitar();
    };
  }, [mapa, posiciones, huecos]);

  // Novedades en rojo sobre el trazado: dónde se cortó (y por qué), dónde
  // volvió y desde dónde guardó puntos sin internet. Al pulsar, se elige ese
  // punto.
  useEffect(() => {
    if (!mapa) return;
    const marcadores: Marker[] = [];
    const hover = globoHoverDe(mapa);
    // Pin chico con "!": varios en el mismo sitio no tapan la ruta ni las
    // etiquetas de inicio y fin. Al pasar el cursor se lee qué pasó.
    for (const [i, novedad] of novedadesDelRecorrido(posiciones, huecos).slice(0, MAX_ETIQUETAS_CORTE).entries()) {
      const elemento = document.createElement('button');
      elemento.dataset.novedad = String(i);
      elemento.type = 'button';
      elemento.className = 'marcador-novedad-pin';
      elemento.textContent = '!';
      elemento.setAttribute('aria-label', `${novedad.titulo}. ${novedad.detalle}`);
      aislarDelMapa(elemento);
      const lugar: [number, number] = [novedad.lon, novedad.lat];
      elemento.addEventListener('mouseenter', () =>
        hover.entrar(globoDePunto(novedad.titulo, [{ etiqueta: 'Cuándo', valor: novedad.detalle }]), lugar, 14),
      );
      elemento.addEventListener('mouseleave', () => hover.salir());
      elemento.addEventListener('click', () => seleccionar(novedad.indice));
      marcadores.push(new Marker({ element: elemento, anchor: 'center' }).setLngLat(lugar).addTo(mapa));
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
  // Arrastre de la barra: el reloj va al instante exacto y el círculo se
  // desliza sobre la línea, sin saltar de punto en punto.
  function deslizarA(instante: number) {
    if (posiciones.length === 0) return;
    if (reproduciendoRef.current) setReproduciendo(false);
    const t = Math.min(
      Math.max(instante, milisegundos(posiciones[0].registradoEn)),
      milisegundos(posiciones[posiciones.length - 1].registradoEn),
    );
    const i = indicePorInstante(posiciones, t);
    instanteRef.current = t;
    indiceRef.current = i;
    indicePintadoRef.current = i;
    sincronizarSlider(t);
    setIndice(i);
    setSeleccionado(null);
    const lugar = lugarEnInstante(t, i);
    if (lugar) {
      marcadorActual.current?.setLngLat(lugar);
      if (seguir && mapa) mapa.setCenter(lugar, { duration: 0 });
    }
    aplicarProgreso.current(t);
  }

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
    sostener: setSosteniendo,
    sosteniendo,
    deslizarA,
    alternar: alternarReproduccion,
    alternarSeguir: () => setSeguir((activo) => !activo),
    moverPunto,
    cambiarVelocidad: (valor) => setVelocidadReproduccion(valor),
    mover: moverA,
    pausar,
    irA: irAInstante,
    seleccionarParada,
    cerrarParada,
    seleccionar,
    quitarSeleccion,
  };

  return <ContextoReproductor.Provider value={estado}>{children}</ContextoReproductor.Provider>;
}

// Ficha del punto actual: va en sincronía con el círculo (hora, velocidad,
// batería, estado y equipo). La dirección cuesta una consulta por punto, así
// que mientras se reproduce o se arrastra muestra "cargando", salvo dentro de
// una parada (su dirección es fija). En pausa se pide la del punto actual.
export function PanelPuntoSeleccionado() {
  const { posiciones, paradas, dispositivo, punto, estado, reproduciendo, sosteniendo } = useReproductor();
  const moviendo = reproduciendo || sosteniendo;
  const t = punto ? milisegundos(punto.registradoEn) : null;
  const parada = t == null ? null : paradas.find((p) => t >= milisegundos(p.inicio) && t <= milisegundos(p.fin)) ?? null;
  const usarParada = parada != null && (moviendo || parada.direccion != null);
  const lugar = usarParada ? { lat: parada.latitud, lon: parada.longitud, precision: parada.precisionM ?? null } : punto ? { lat: punto.latitud, lon: punto.longitud, precision: punto.precisionM ?? null } : null;
  const pedir = lugar != null && (usarParada ? !parada.direccion : !moviendo);
  const consulta = useDireccionConCarga(lugar?.lat ?? null, lugar?.lon ?? null, pedir, lugar?.precision ?? null);
  const direccion = usarParada && parada.direccion ? parada.direccion : consulta.direccion;
  const cargando = (moviendo && !usarParada) || (pedir && consulta.cargando);
  if (!punto || posiciones.length === 0) {
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
        <dd>{cargando ? <span className="esqueleto" aria-label="Cargando dirección" /> : direccion ?? GUION}</dd>
        <dt>Velocidad</dt>
        <dd>{velocidad(punto.velocidadKmh)}</dd>
        <dt>Batería</dt>
        <dd>{bateria(punto.bateriaPct)}</dd>
        <dt>Estado</dt>
        <dd>{ETIQUETA_ESTADO_PUNTO[estado] ?? GUION}</dd>
        <dt>Equipo</dt>
        <dd>{dispositivo ? (dispositivo.habilitado ? 'Activo' : 'Dado de baja') : GUION}</dd>
      </dl>
    </section>
  );
}
