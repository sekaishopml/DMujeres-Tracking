import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Map as MapaMaplibre, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import type { MapOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cn } from '@/lib/cn';
// Maplibre busca su worker con una ruta relativa a su propio paquete, y Vite
// no copia ese archivo. Con ?worker&url Vite lo empaqueta y aquí se le pasa la
// URL; sin esto el mapa no procesa las fuentes GeoJSON.
import urlTrabajador from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(urlTrabajador);

// Capas de mapa por URL directa, sin clave: Google (mapa, satélite, híbrido) y
// OpenStreetMap como opción libre. Las cuatro están en el mismo estilo y solo
// cambia cuál se ve, así que cambiar de capa no recrea el mapa ni pierde el
// encuadre.
const SUFIJOS_GOOGLE = ['mt0', 'mt1', 'mt2', 'mt3'];
const tilesGoogle = (lyrs: string) =>
  SUFIJOS_GOOGLE.map((host) => `https://${host}.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`);

export const CAPAS_MAPA = [
  { id: 'google-mapa', nombre: 'GMaps', tiles: tilesGoogle('m'), attribution: '© Google' },
  { id: 'google-satelite', nombre: 'Satélite', tiles: tilesGoogle('s'), attribution: '© Google' },
  { id: 'google-hibrido', nombre: 'Híbrido', tiles: tilesGoogle('y'), attribution: '© Google' },
  {
    id: 'osm',
    nombre: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap',
  },
] as const;

export type IdCapa = (typeof CAPAS_MAPA)[number]['id'];
// Replay ofrece las mismas cuatro capas que Seguimiento y abre en GMaps: las
// calles con nombre se leen mejor para auditar el recorrido.
export const CAPAS_REPLAY = CAPAS_MAPA.map((capa) => capa.id);
export const CAPA_INICIAL_REPLAY: IdCapa = 'google-mapa';
// Orden completo; es constante para que memo() siga evitando redibujos.
const IDS_CAPAS: readonly IdCapa[] = CAPAS_MAPA.map((capa) => capa.id);

// Duración del fundido entre capas, tomada de --dmj-mov-media; con movimiento
// reducido el cambio es instantáneo.
function duracionFundidoMs(): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const valor = getComputedStyle(document.documentElement).getPropertyValue('--dmj-mov-media').trim();
  const numero = Number.parseFloat(valor);
  if (!Number.isFinite(numero)) return 180;
  return valor.endsWith('ms') ? numero : numero * 1000;
}

// El estilo se arma por instancia porque la transición global de pintura usa
// la duración del token: con ella, cambiar la opacidad de una capa con
// setPaintProperty funde el cambio sin agregar ni quitar capas.
function estiloMapa(duracionFundido: number, capaInicial: IdCapa): NonNullable<MapOptions['style']> {
  return {
    version: 8,
    transition: { duration: duracionFundido, delay: 0 },
    sources: Object.fromEntries(
      CAPAS_MAPA.map((capa) => [
        capa.id,
        { type: 'raster', tiles: [...capa.tiles], tileSize: 256, maxzoom: 20, attribution: capa.attribution },
      ]),
    ),
    layers: CAPAS_MAPA.map((capa) => ({
      id: capa.id,
      type: 'raster',
      source: capa.id,
      layout: { visibility: capa.id === capaInicial ? 'visible' : 'none' },
    })),
  };
}

const CENTRO_INICIAL: [number, number] = [-78.4678, -0.1807];

interface Props {
  clase?: string;
  centro?: [number, number];
  zoom?: number;
  // El callback recibe null al desmontar el mapa para que quien guarde la
  // instancia (marcadores, capas) sepa que ya no sirve.
  alListo?: (mapa: MapaMaplibre | null) => void;
  // Ids visibles en el selector, en el orden del panel. Por defecto, las
  // cuatro con Mapa al frente.
  capas?: readonly IdCapa[];
  // Capa con la que abre; si falta, la primera de `capas`.
  capaInicial?: IdCapa;
  // Replay pide el zoom abajo a la derecha: la esquina superior queda libre
  // para el selector de capas pegado al top bar.
  zoomAbajoDerecha?: boolean;
  // En vivo pide el selector a la izquierda para dejar libre el zoom.
  selectorIzquierda?: boolean;
  // Replay lo pide pegado a la esquina superior derecha, sin margen, contra
  // la barra superior del panel.
  selectorPegado?: boolean;
}

// memo: las páginas con mapa se redibujan en cada sondeo (cada 5 o 10 s) y
// sus props no cambian, así que el contenedor del mapa no se vuelve a dibujar.
export default memo(function MapaRaster({
  clase = 'h-full w-full',
  centro = CENTRO_INICIAL,
  zoom = 6,
  alListo,
  capas = IDS_CAPAS,
  capaInicial,
  zoomAbajoDerecha = false,
  selectorIzquierda = false,
  selectorPegado = false,
}: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const instancia = useRef<MapaMaplibre | null>(null);
  const avisoListo = useRef(alListo);
  const [capaActiva, setCapaActiva] = useState<IdCapa>(() => capaInicial ?? capas[0] ?? 'google-mapa');
  // Estado del fundido: duración vigente, capa pedida mientras el estilo aún
  // carga y temporizador que retira las capas salientes al terminar.
  const duracionFundido = useRef(180);
  const cargado = useRef(false);
  const capaDestino = useRef<IdCapa>(capaInicial ?? capas[0] ?? 'google-mapa');
  const temporizadorCapa = useRef<number | null>(null);
  // Sin WebGL2 (PC vieja o aceleración apagada) maplibre falla al crearse: se
  // muestra un aviso en el lugar del mapa y el resto del panel sigue andando.
  const [sinMapa, setSinMapa] = useState(false);

  useEffect(() => {
    avisoListo.current = alListo;
  }, [alListo]);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    duracionFundido.current = duracionFundidoMs();
    cargado.current = false;
    let mapa: MapaMaplibre;
    try {
      mapa = new MapaMaplibre({
        container: nodo,
        style: estiloMapa(duracionFundido.current, capaDestino.current),
        center: centro,
        zoom,
        attributionControl: { compact: true },
      });
    } catch {
      setSinMapa(true);
      return;
    }
    instancia.current = mapa;
    // Rueda más lenta que el valor por defecto: en un panel de flota el zoom
    // brusco desorienta y hace perder el encuadre de la unidad.
    mapa.scrollZoom.setZoomRate(1 / 450);
    mapa.scrollZoom.setWheelZoomRate(1 / 450);
    // En Repetición de ruta el zoom va abajo a la derecha para que el selector
    // de capas no lo tape.
    mapa.addControl(new NavigationControl({ showCompass: false }), zoomAbajoDerecha ? 'bottom-right' : 'top-right');
    mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    // El mapa se entrega con el estilo ya cargado: maplibre falla si se le
    // agregan fuentes o capas antes.
    let montado = true;
    mapa.once('load', () => {
      if (!montado) return;
      cargado.current = true;
      // Una capa pedida antes de cargar el estilo se aplica sin fundido.
      aplicarCapa(capaDestino.current, false);
      avisoListo.current?.(mapa);
    });
    return () => {
      montado = false;
      if (temporizadorCapa.current != null) {
        window.clearTimeout(temporizadorCapa.current);
        temporizadorCapa.current = null;
      }
      cargado.current = false;
      avisoListo.current?.(null);
      instancia.current = null;
      mapa.remove();
    };
    // centro y zoom son el encuadre inicial y el lado del control de zoom es de
    // creación: si cambiaran, el mapa se recrea. Las páginas los dejan por
    // defecto y reencuadran al llegar los datos.
  }, [centro, zoom, zoomAbajoDerecha]);

  // Cambia la capa base: la nueva aparece desde opacidad 0 y las otras se
  // apagan. No agrega ni quita capas, solo cambia opacidad y visibilidad.
  function aplicarCapa(id: IdCapa, fundir: boolean) {
    const mapa = instancia.current;
    if (!mapa || !cargado.current) return;
    const visibles = CAPAS_MAPA.filter((capa) => mapa.getLayoutProperty(capa.id, 'visibility') !== 'none');
    // Misma capa ya visible (o clic repetido): no hay nada que fundir.
    if (visibles.length === 1 && visibles[0].id === id) return;
    if (temporizadorCapa.current != null) {
      window.clearTimeout(temporizadorCapa.current);
      temporizadorCapa.current = null;
    }
    const salientes = visibles.filter((capa) => capa.id !== id);
    if (!fundir) {
      for (const capa of salientes) {
        mapa.setLayoutProperty(capa.id, 'visibility', 'none');
        mapa.setPaintProperty(capa.id, 'raster-opacity', 1);
      }
      mapa.setLayoutProperty(id, 'visibility', 'visible');
      mapa.setPaintProperty(id, 'raster-opacity', 1);
      return;
    }
    // La entrante arranca en 0 y sube a 1 con la transición global del estilo;
    // las salientes bajan a 0 y recién al terminar salen del render.
    mapa.setPaintProperty(id, 'raster-opacity', 0);
    mapa.setLayoutProperty(id, 'visibility', 'visible');
    mapa.setPaintProperty(id, 'raster-opacity', 1);
    for (const capa of salientes) mapa.setPaintProperty(capa.id, 'raster-opacity', 0);
    const retirar = () => {
      for (const capa of salientes) {
        mapa.setLayoutProperty(capa.id, 'visibility', 'none');
        mapa.setPaintProperty(capa.id, 'raster-opacity', 1);
      }
    };
    if (duracionFundido.current <= 0) {
      retirar();
      return;
    }
    temporizadorCapa.current = window.setTimeout(() => {
      temporizadorCapa.current = null;
      retirar();
    }, duracionFundido.current + 40);
  }

  function cambiarCapa(id: IdCapa) {
    setCapaActiva(id);
    capaDestino.current = id;
    aplicarCapa(id, true);
  }

  // Selector en el orden del panel, restringido al set vigente. El estilo
  // define siempre las cuatro capas; aquí solo se ofrecen las pedidas.
  const definiciones = useMemo(() => CAPAS_MAPA.filter((capa) => capas.includes(capa.id)), [capas]);
  // Píldora que se desliza bajo la capa activa (posición y ancho del botón).
  const botonesCapa = useRef(new Map<IdCapa, HTMLButtonElement>());
  const [pildora, setPildora] = useState<{ x: number; ancho: number } | null>(null);
  useLayoutEffect(() => {
    const boton = botonesCapa.current.get(capaActiva);
    if (boton) setPildora({ x: boton.offsetLeft, ancho: boton.offsetWidth });
  }, [capaActiva, definiciones]);

  return (
    <div className={cn('relative overflow-hidden bg-marino-100', clase)}>
      {/* Estilo en línea a propósito: maplibre-gl.css pone position: relative a
          .maplibregl-map y, al no estar en una capa, le gana a la utilidad
          "absolute" de Tailwind; el contenedor quedaba con alto 0. */}
      {/* zoom inverso al de la interfaz (--zoom-ui): el lienzo de MapLibre
          queda a escala 1 y los clics caen donde se ven. */}
      <div ref={contenedor} style={{ position: 'absolute', inset: 0, zoom: 'calc(1 / var(--zoom-ui))' }} />
      {sinMapa && (
        <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-tarjeta bg-superficie/95 p-4 text-center text-[13px] text-texto-2 shadow-flotante">
          Este navegador no puede dibujar el mapa (necesita aceleración gráfica WebGL2). Activa la aceleración por
          hardware en la configuración del navegador o abre el panel en Chrome o Edge actualizados.
        </p>
      )}
      <div
        role="group"
        aria-label="Capa del mapa"
        className={cn(
          'absolute z-[5] flex border-borde bg-superficie/95 p-0.5 shadow-flotante backdrop-blur [isolation:isolate]',
          selectorPegado
            ? 'top-0 right-0 rounded-bl-control border-b border-l'
            : cn('top-3 rounded-control border', selectorIzquierda ? 'left-3' : 'right-3'),
        )}
      >
        {pildora && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 left-0 rounded-[6px] bg-tinta-2 shadow-sm transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: pildora.ancho, transform: `translateX(${pildora.x}px)` }}
          />
        )}
        {definiciones.map((capa) => (
          <button
            key={capa.id}
            ref={(nodo) => {
              if (nodo) botonesCapa.current.set(capa.id, nodo);
              else botonesCapa.current.delete(capa.id);
            }}
            type="button"
            onClick={() => cambiarCapa(capa.id)}
            aria-pressed={capa.id === capaActiva}
            className={cn(
              'relative h-7 cursor-pointer rounded-[6px] px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors duration-300',
              capa.id === capaActiva ? 'text-white' : 'text-texto-2 hover:text-marino-900',
              !pildora && capa.id === capaActiva && 'bg-tinta-2',
            )}
          >
            {capa.nombre}
          </button>
        ))}
      </div>
    </div>
  );
});
