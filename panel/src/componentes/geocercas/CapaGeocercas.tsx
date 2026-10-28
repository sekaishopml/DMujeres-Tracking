import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Building2, Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Marker } from 'maplibre-gl';
import type { GeoJSONSource, IControl, Map as TipoMapa, MapLayerMouseEvent, MapMouseEvent } from 'maplibre-gl';
import { toast } from 'sonner';
import { mensajeError } from '@/dominio/errores';
import { useGeocercas, useGuardarGeocerca } from '@/dominio/geocercas';
import { useSesion } from '@/lib/sesion';
import { Boton } from '@/componentes/ui/Boton';
import FichaGeocerca from './FichaGeocerca';
import FormularioGeocerca from './FormularioGeocerca';
import type { DatosFormulario } from './FormularioGeocerca';
import { colorTipo, errorDePuntos, esMismoPunto, puntoEnPoligono } from './logica';
import type { Geocerca, Punto } from './logica';

// Dibujo en curso: sin id es una geocerca nueva; con id, la que se modifica.
// Con `cerrado` el polígono ya está completo y sus vértices se arrastran.
interface Dibujo {
  id: number | null;
  puntos: Punto[];
  cerrado: boolean;
}

const RADIO_CIERRE_PX = 10;
const ZOOM_NOMBRES = 12;
type Coleccion = GeoJSON.FeatureCollection;
const VACIA: Coleccion = { type: 'FeatureCollection', features: [] };

// Botones propios en el grupo de controles de abajo a la derecha. Se agregan
// después del zoom, y maplibre apila los nuevos arriba: quedan sobre + y −.
class ControlBoton implements IControl {
  private contenedor = document.createElement('div');
  private boton = document.createElement('button');
  private raiz: Root | null = null;
  private titulo: string;
  private icono: ReactNode;
  private alPulsar: () => void;
  constructor(titulo: string, icono: ReactNode, alPulsar: () => void) {
    this.titulo = titulo;
    this.icono = icono;
    this.alPulsar = alPulsar;
  }
  onAdd(): HTMLElement {
    this.contenedor.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.boton.type = 'button';
    this.boton.style.color = 'var(--color-texto)';
    this.boton.style.display = 'grid';
    this.boton.style.placeItems = 'center';
    this.boton.onclick = () => this.alPulsar();
    this.contenedor.append(this.boton);
    this.raiz = createRoot(this.boton);
    this.poner(this.titulo, this.icono);
    return this.contenedor;
  }
  onRemove(): void {
    const raiz = this.raiz;
    this.raiz = null;
    // Se desmonta fuera del render en curso.
    if (raiz) setTimeout(() => raiz.unmount());
    this.contenedor.remove();
  }
  poner(titulo: string, icono: ReactNode): void {
    this.boton.title = titulo;
    this.boton.setAttribute('aria-label', titulo);
    this.raiz?.render(icono);
  }
  marcar(activo: boolean): void {
    this.boton.setAttribute('aria-pressed', String(activo));
    this.boton.style.background = activo ? 'var(--color-marca)' : '';
    this.boton.style.color = activo ? '#fff' : 'var(--color-texto)';
  }
}

// Lo que el ojo deja oculto en el mapa; se recuerda en este navegador.
const CLAVE_OCULTAS = 'dmj.mapa.ocultas';
function ocultasGuardadas(): string[] {
  try {
    const lista: unknown = JSON.parse(localStorage.getItem(CLAVE_OCULTAS) ?? '[]');
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface CapaDeVista {
  clave: string;
  texto: string;
}

const SIN_CAPAS: readonly CapaDeVista[] = [];

function aColeccionBase(lista: readonly Geocerca[], seleccion: number | null, ocultar: number | null): Coleccion {
  return {
    type: 'FeatureCollection',
    features: lista
      .filter((g) => g.id !== ocultar && g.puntos.length >= 3)
      .map((g) => ({
        type: 'Feature',
        properties: { id: g.id, color: colorTipo(g.tipo), sel: g.id === seleccion ? 1 : 0 },
        geometry: { type: 'Polygon', coordinates: [[...g.puntos, g.puntos[0]]] },
      })),
  };
}

function aColeccionBorrador(d: Dibujo | null): { borrador: Coleccion; vertices: Coleccion } {
  if (!d || d.puntos.length === 0) return { borrador: VACIA, vertices: VACIA };
  const anillo = d.cerrado || d.puntos.length >= 3 ? [...d.puntos, d.puntos[0]] : d.puntos;
  const borrador: Coleccion = {
    type: 'FeatureCollection',
    features: [
      ...(d.puntos.length >= 3
        ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [anillo] } }]
        : []),
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: d.cerrado ? anillo : d.puntos } },
    ],
  };
  const vertices: Coleccion = {
    type: 'FeatureCollection',
    features: d.puntos.map((p, i) => ({
      type: 'Feature',
      properties: { i, primero: i === 0 && !d.cerrado ? 1 : 0 },
      geometry: { type: 'Point', coordinates: p },
    })),
  };
  return { borrador, vertices };
}

// Capa de geocercas para los mapas de Seguimiento y Repetición de ruta: botón
// de dibujo, polígonos con su nombre, ficha, edición e historial.
// capas: otras cosas del mapa que el ojo también puede ocultar (en Repetición
// de ruta, el trazado, los eventos y las paradas). Sin ellas, el ojo solo
// muestra u oculta las geocercas.
export default function CapaGeocercas({
  mapa,
  capas = SIN_CAPAS,
  alCambiarOcultas,
}: {
  mapa: TipoMapa | null;
  capas?: readonly CapaDeVista[];
  alCambiarOcultas?: (ocultas: readonly string[]) => void;
}) {
  const soloLectura = useSesion((s) => s.usuario?.soloLectura === true);
  const consulta = useGeocercas();
  // El ojo las oculta del mapa sin borrarlas; se recuerda en este navegador.
  const [ocultas, setOcultas] = useState(ocultasGuardadas);
  const [menuVista, setMenuVista] = useState(false);
  const ver = !ocultas.includes('geocercas');
  const alternar = useCallback((clave: string) => {
    setOcultas((lista) => {
      const nueva = lista.includes(clave) ? lista.filter((x) => x !== clave) : [...lista, clave];
      try {
        localStorage.setItem(CLAVE_OCULTAS, JSON.stringify(nueva));
      } catch {
        /* sin almacenamiento solo no se recuerda */
      }
      return nueva;
    });
  }, []);
  const geocercas = useMemo(() => (ver ? consulta.data?.datos ?? [] : []), [consulta.data, ver]);
  const guardar = useGuardarGeocerca();

  const [dibujo, setDibujoEstado] = useState<Dibujo | null>(null);
  const dibujoRef = useRef<Dibujo | null>(null);
  const geocercasRef = useRef<Geocerca[]>([]);
  geocercasRef.current = geocercas;
  const [formAbierto, setFormAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState<number | null>(null);
  const [bajaDe, setBajaDe] = useState<Geocerca | null>(null);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sobreCierre, setSobreCierre] = useState(false);
  const control = useRef<ControlBoton | null>(null);

  // El ref se actualiza junto al estado: clic y doble clic llegan seguidos y
  // el segundo debe ver lo que dejó el primero.
  const poner = useCallback((d: Dibujo | null) => {
    dibujoRef.current = d;
    setDibujoEstado(d);
  }, []);

  const cancelar = useCallback(() => {
    poner(null);
    setFormAbierto(false);
    setAviso(null);
    setErrorGuardar(null);
  }, [poner]);

  const cerrar = useCallback(() => {
    const d = dibujoRef.current;
    if (!d || d.cerrado) return;
    const problema = errorDePuntos(d.puntos);
    if (problema) {
      setAviso(problema);
      return;
    }
    setAviso(null);
    poner({ ...d, cerrado: true });
    if (d.id == null) setFormAbierto(true);
  }, [poner]);

  // Botón de edificio.
  useEffect(() => {
    if (!mapa || soloLectura) return;
    const c = new ControlBoton('Dibujar una geocerca', <Building2 size={16} strokeWidth={2} />, () => {
      if (dibujoRef.current) cancelar();
      else {
        setSeleccion(null);
        poner({ id: null, puntos: [], cerrado: false });
      }
    });
    control.current = c;
    mapa.addControl(c, 'bottom-right');
    return () => {
      control.current = null;
      try {
        mapa.removeControl(c);
      } catch {
        /* el mapa ya se desmontó */
      }
    };
  }, [mapa, soloLectura, cancelar, poner]);
  useEffect(() => control.current?.marcar(dibujo != null), [dibujo, mapa]);

  // Ojo: va encima del edificio porque se agrega después. Con más capas abre
  // un menú; solo con geocercas, las muestra u oculta de una vez.
  const ojo = useRef<ControlBoton | null>(null);
  const conMenu = capas.length > 0;
  useEffect(() => {
    if (!mapa) return;
    const c = new ControlBoton('Qué se ve en el mapa', <Eye size={16} strokeWidth={2} />, () => {
      if (conMenu) setMenuVista((v) => !v);
      else alternar('geocercas');
    });
    ojo.current = c;
    mapa.addControl(c, 'bottom-right');
    return () => {
      ojo.current = null;
      try {
        mapa.removeControl(c);
      } catch {
        /* el mapa ya se desmontó */
      }
    };
  }, [mapa, conMenu, alternar]);
  const visibles = useMemo(() => ['geocercas', ...capas.map((c) => c.clave)], [capas]);
  const algoOculto = ocultas.some((c) => visibles.includes(c));
  useEffect(() => {
    ojo.current?.poner(
      conMenu ? 'Qué se ve en el mapa' : ver ? 'Ocultar geocercas' : 'Mostrar geocercas',
      algoOculto ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />,
    );
    ojo.current?.marcar(menuVista);
  }, [ver, algoOculto, conMenu, menuVista, mapa]);
  // Los marcadores se ocultan con estilos según este dato; las capas del
  // mapa, las apaga la página que las dibuja.
  useEffect(() => {
    if (!mapa) return;
    const activas = ocultas.filter((c) => visibles.includes(c));
    mapa.getContainer().dataset.ocultar = activas.join(' ');
    alCambiarOcultas?.(activas);
  }, [mapa, ocultas, visibles, alCambiarOcultas]);
  // El menú se abre al lado del ojo.
  const ubicarMenu = useCallback(
    (caja: HTMLDivElement | null) => {
      const boton = mapa?.getContainer().querySelector<HTMLElement>('button[aria-label="Qué se ve en el mapa"]');
      const marco = caja?.offsetParent as HTMLElement | null;
      if (!caja || !boton || !marco) return;
      const m = marco.getBoundingClientRect();
      const b = boton.getBoundingClientRect();
      const escala = m.width / marco.offsetWidth || 1;
      caja.style.right = `${(m.right - b.left) / escala + 8}px`;
      caja.style.bottom = `${(m.bottom - b.bottom) / escala}px`;
    },
    [mapa],
  );

  // Fuentes y capas.
  useEffect(() => {
    if (!mapa) return;
    mapa.addSource('geocercas', { type: 'geojson', data: VACIA });
    mapa.addSource('geocerca-borrador', { type: 'geojson', data: VACIA });
    mapa.addSource('geocerca-vertices', { type: 'geojson', data: VACIA });
    mapa.addLayer({ id: 'geocercas-relleno', type: 'fill', source: 'geocercas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } });
    mapa.addLayer({
      id: 'geocercas-borde',
      type: 'line',
      source: 'geocercas',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 4, 2] },
    });
    mapa.addLayer({ id: 'borrador-relleno', type: 'fill', source: 'geocerca-borrador', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#eb0045', 'fill-opacity': 0.15 } });
    mapa.addLayer({
      id: 'borrador-linea',
      type: 'line',
      source: 'geocerca-borrador',
      filter: ['==', '$type', 'LineString'],
      paint: { 'line-color': '#eb0045', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
    });
    mapa.addLayer({
      id: 'borrador-vertices',
      type: 'circle',
      source: 'geocerca-vertices',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'primero'], 1], 7, 5],
        'circle-color': ['case', ['==', ['get', 'primero'], 1], '#eb0045', '#ffffff'],
        'circle-stroke-color': '#eb0045',
        'circle-stroke-width': 2,
      },
    });
    return () => {
      try {
        for (const id of ['borrador-vertices', 'borrador-linea', 'borrador-relleno', 'geocercas-borde', 'geocercas-relleno']) mapa.removeLayer(id);
        for (const id of ['geocerca-vertices', 'geocerca-borrador', 'geocercas']) mapa.removeSource(id);
      } catch {
        /* el mapa ya se desmontó */
      }
    };
  }, [mapa]);

  // Datos de las capas.
  useEffect(() => {
    if (!mapa) return;
    const poner = (id: string, datos: Coleccion) => (mapa.getSource(id) as GeoJSONSource | undefined)?.setData(datos);
    poner('geocercas', aColeccionBase(geocercas, seleccion, dibujo?.id ?? null));
    const { borrador, vertices } = aColeccionBorrador(dibujo);
    poner('geocerca-borrador', borrador);
    poner('geocerca-vertices', vertices);
  }, [mapa, geocercas, seleccion, dibujo]);

  // Nombres sobre cada polígono; solo desde cierto zoom para no saturar.
  useEffect(() => {
    if (!mapa) return;
    const marcas = geocercas
      .filter((g) => g.id !== dibujo?.id)
      .map((g) => {
        const el = document.createElement('div');
        el.textContent = g.nombre;
        el.style.cssText = `pointer-events:none;white-space:nowrap;font:600 11px/1 system-ui,sans-serif;color:${colorTipo(g.tipo)};text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff`;
        return { el, marca: new Marker({ element: el }).setLngLat([g.centro.lon, g.centro.lat]).addTo(mapa) };
      });
    const ajustar = () => {
      const ver = mapa.getZoom() >= ZOOM_NOMBRES;
      for (const m of marcas) m.el.style.display = ver ? '' : 'none';
    };
    ajustar();
    mapa.on('zoom', ajustar);
    return () => {
      mapa.off('zoom', ajustar);
      for (const m of marcas) m.marca.remove();
    };
  }, [mapa, geocercas, dibujo?.id]);

  // Clic, doble clic y arrastre de vértices.
  useEffect(() => {
    if (!mapa) return;
    let arrastrando: number | null = null;
    const alClic = (e: MapMouseEvent) => {
      const d = dibujoRef.current;
      if (!d) {
        const f = mapa.queryRenderedFeatures(e.point, { layers: ['geocercas-relleno'] })[0];
        setSeleccion(f ? Number(f.properties?.id) : null);
        return;
      }
      if (d.cerrado) return;
      const primero = d.puntos[0];
      if (primero && d.puntos.length >= 3 && esMismoPunto(mapa.project(primero), e.point, RADIO_CIERRE_PX)) {
        cerrar();
        return;
      }
      const ultimo = d.puntos[d.puntos.length - 1];
      // El segundo clic de un doble clic cae en el mismo punto: no es otro vértice.
      if (ultimo && esMismoPunto(mapa.project(ultimo), e.point, 4)) return;
      // Dos geocercas no se pisan: un punto dentro de otra no se agrega.
      const otra = geocercasRef.current.find(
        (g) => g.id !== d.id && puntoEnPoligono(e.lngLat.lng, e.lngLat.lat, g.puntos),
      );
      if (otra) {
        setAviso(`Ese punto cae dentro de «${otra.nombre}». Marque fuera de ella.`);
        return;
      }
      setAviso(null);
      poner({ ...d, puntos: [...d.puntos, [e.lngLat.lng, e.lngLat.lat]] });
    };
    const alDobleClic = (e: MapMouseEvent) => {
      const d = dibujoRef.current;
      if (!d || d.cerrado) return;
      e.preventDefault();
      cerrar();
    };
    const alPulsarVertice = (e: MapLayerMouseEvent) => {
      const d = dibujoRef.current;
      const f = e.features?.[0];
      if (!d?.cerrado || !f) return;
      e.preventDefault();
      arrastrando = Number(f.properties?.i);
      mapa.dragPan.disable();
    };
    const alMover = (e: MapMouseEvent) => {
      const d = dibujoRef.current;
      if (arrastrando == null || !d) return;
      const puntos = d.puntos.slice();
      puntos[arrastrando] = [e.lngLat.lng, e.lngLat.lat];
      poner({ ...d, puntos });
    };
    const alSoltar = () => {
      if (arrastrando == null) return;
      arrastrando = null;
      mapa.dragPan.enable();
    };
    // Sobre el primer punto, con la forma ya cerrable: mano y punto más grande,
    // para que se vea que ahí se pulsa para cerrar.
    const marcarCierre = (activo: boolean) => {
      if (!mapa.getLayer('borrador-vertices')) return;
      mapa.setPaintProperty('borrador-vertices', 'circle-radius', ['case', ['==', ['get', 'primero'], 1], activo ? 11 : 7, 5]);
      setSobreCierre(activo);
    };
    const entra = (e: MapLayerMouseEvent) => {
      const d = dibujoRef.current;
      if (d?.cerrado) {
        mapa.getCanvas().style.cursor = 'move';
      } else if (d && d.puntos.length >= 3 && e.features?.some((f) => f.properties?.primero === 1)) {
        mapa.getCanvas().style.cursor = 'pointer';
        marcarCierre(true);
      }
    };
    const sale = () => {
      mapa.getCanvas().style.cursor = dibujoRef.current && !dibujoRef.current.cerrado ? 'crosshair' : '';
      marcarCierre(false);
    };
    const entraGeocerca = () => {
      if (!dibujoRef.current) mapa.getCanvas().style.cursor = 'pointer';
    };
    mapa.on('click', alClic);
    mapa.on('dblclick', alDobleClic);
    mapa.on('mousedown', 'borrador-vertices', alPulsarVertice);
    mapa.on('mousemove', alMover);
    mapa.on('mouseup', alSoltar);
    mapa.on('mouseenter', 'borrador-vertices', entra);
    mapa.on('mouseleave', 'borrador-vertices', sale);
    mapa.on('mouseenter', 'geocercas-relleno', entraGeocerca);
    mapa.on('mouseleave', 'geocercas-relleno', sale);
    return () => {
      mapa.off('click', alClic);
      mapa.off('dblclick', alDobleClic);
      mapa.off('mousedown', 'borrador-vertices', alPulsarVertice);
      mapa.off('mousemove', alMover);
      mapa.off('mouseup', alSoltar);
      mapa.off('mouseenter', 'borrador-vertices', entra);
      mapa.off('mouseleave', 'borrador-vertices', sale);
      mapa.off('mouseenter', 'geocercas-relleno', entraGeocerca);
      mapa.off('mouseleave', 'geocercas-relleno', sale);
      mapa.dragPan.enable();
    };
  }, [mapa, cerrar, poner]);

  // El cuadro de ayuda cuelga del selector de mapas: mismo ancho y justo debajo.
  const alinearConSelector = useCallback((caja: HTMLDivElement | null) => {
    const selector = caja?.parentElement?.querySelector<HTMLElement>('[aria-label="Capa del mapa"]');
    if (!caja || !selector) return;
    caja.style.width = `${selector.offsetWidth}px`;
    caja.style.top = `${selector.offsetTop + selector.offsetHeight}px`;
  }, []);

  // Mientras se marcan puntos: cursor de mira y sin zoom por doble clic.
  const marcando = dibujo != null && !dibujo.cerrado;
  useEffect(() => {
    if (!mapa || !marcando) return;
    mapa.doubleClickZoom.disable();
    mapa.getCanvas().style.cursor = 'crosshair';
    // Aviso para Repetición de ruta: sus clics sobre el recorrido no cuentan ahora.
    mapa.getContainer().dataset.dibujando = '1';
    return () => {
      mapa.doubleClickZoom.enable();
      mapa.getCanvas().style.cursor = '';
      delete mapa.getContainer().dataset.dibujando;
    };
  }, [mapa, marcando]);

  // Esc cancela el dibujo (si el formulario está abierto, Esc lo cierra él).
  useEffect(() => {
    if (!dibujo || formAbierto) return;
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelar();
    };
    window.addEventListener('keydown', alTecla);
    return () => window.removeEventListener('keydown', alTecla);
  }, [dibujo, formAbierto, cancelar]);

  const editada = dibujo?.id != null ? geocercas.find((g) => g.id === dibujo.id) : undefined;
  const elegida = seleccion != null ? geocercas.find((g) => g.id === seleccion) : undefined;

  function alGuardar(datos: DatosFormulario) {
    if (!dibujo) return;
    setErrorGuardar(null);
    guardar.mutate(
      { id: dibujo.id ?? undefined, cambios: { ...datos, puntos: dibujo.puntos } },
      {
        onSuccess: (r) => {
          toast.success(dibujo.id == null ? 'Geocerca guardada.' : 'Cambios guardados.');
          cancelar();
          setSeleccion(r.geocerca.id);
        },
        onError: (error) => setErrorGuardar(mensajeError(error)),
      },
    );
  }

  function alCambiarEstado(datos: DatosFormulario) {
    if (!bajaDe) return;
    setErrorGuardar(null);
    guardar.mutate(
      { id: bajaDe.id, cambios: { activo: !bajaDe.activo, quien: datos.quien } },
      {
        onSuccess: () => {
          toast.success(bajaDe.activo ? 'Geocerca dada de baja.' : 'Geocerca restaurada.');
          setBajaDe(null);
          setSeleccion(null);
        },
        onError: (error) => setErrorGuardar(mensajeError(error)),
      },
    );
  }

  return (
    <>
      {menuVista && conMenu && (
        <div
          ref={ubicarMenu}
          role="group"
          aria-label="Qué se ve en el mapa"
          className="absolute right-14 bottom-24 z-[6] w-[200px] rounded-tarjeta border border-borde bg-superficie/95 p-2.5 text-[12.5px] shadow-flotante backdrop-blur"
        >
          <p className="mb-1 font-semibold">Ver en el mapa</p>
          {[...capas, { clave: 'geocercas', texto: 'Geocercas' }].map((c) => (
            <label key={c.clave} className="flex cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={!ocultas.includes(c.clave)}
                onChange={() => alternar(c.clave)}
                style={{ width: 16, height: 16, flex: 'none', margin: 0, padding: 0 }}
              />
              <span className="flex-1 text-left">{c.texto}</span>
            </label>
          ))}
        </div>
      )}
      {dibujo && !formAbierto && (
        <div
          ref={alinearConSelector}
          className="absolute top-10 right-0 z-[6] w-[320px] max-w-full rounded-bl-tarjeta border-b border-l border-borde bg-superficie/95 p-3 text-[12.5px] shadow-flotante backdrop-blur"
        >
          {!dibujo.cerrado ? (
            <>
              <p>
                <strong>Dibujar geocerca.</strong> Pulsa en el mapa para marcar cada esquina. Ciérrala con doble clic o
                pulsando el primer punto (mínimo 3). Esc cancela.
              </p>
              <p className={sobreCierre ? 'mt-1 font-semibold text-marca' : 'mt-1 text-texto-2'}>
                {sobreCierre ? 'Haz clic en el punto rojo para cerrar la geocerca.' : `Puntos marcados: ${dibujo.puntos.length}`}
              </p>
              {aviso && <p className="mt-1 font-medium text-peligro">{aviso}</p>}
              <div className="mt-2 flex gap-2">
                <Boton tamano="sm" disabled={dibujo.puntos.length === 0} onClick={() => poner({ ...dibujo, puntos: dibujo.puntos.slice(0, -1) })}>
                  Quitar último
                </Boton>
                <Boton tamano="sm" variante="fantasma" onClick={cancelar}>
                  Cancelar
                </Boton>
              </div>
            </>
          ) : (
            <>
              <p>
                <strong>Modificar la forma.</strong> Arrastra los puntos para ajustarla, o redibújala desde cero.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Boton tamano="sm" variante="principal" onClick={() => setFormAbierto(true)}>
                  Continuar
                </Boton>
                <Boton tamano="sm" onClick={() => poner({ ...dibujo, puntos: [], cerrado: false })}>
                  Redibujar
                </Boton>
                <Boton tamano="sm" variante="fantasma" onClick={cancelar}>
                  Cancelar
                </Boton>
              </div>
            </>
          )}
        </div>
      )}

      {!dibujo && elegida && (
        <FichaGeocerca
          geocerca={elegida}
          puedeEditar={!soloLectura}
          alCerrar={() => setSeleccion(null)}
          alEditar={() => poner({ id: elegida.id, puntos: elegida.puntos.map((p) => [...p] as Punto), cerrado: true })}
          alCambiarEstado={() => setBajaDe(elegida)}
        />
      )}

      <FormularioGeocerca
        abierto={formAbierto && dibujo != null}
        titulo={dibujo?.id == null ? 'Nueva geocerca' : 'Editar geocerca'}
        inicial={editada ? { nombre: editada.nombre, tipo: editada.tipo } : undefined}
        guardando={guardar.isPending}
        error={errorGuardar}
        alGuardar={alGuardar}
        alCancelar={() => (dibujo?.id == null ? cancelar() : setFormAbierto(false))}
      />

      <FormularioGeocerca
        abierto={bajaDe != null}
        soloQuien
        titulo={bajaDe?.activo ? `Dar de baja “${bajaDe.nombre}”` : `Restaurar “${bajaDe?.nombre ?? ''}”`}
        inicial={bajaDe ? { nombre: bajaDe.nombre, tipo: bajaDe.tipo } : undefined}
        guardando={guardar.isPending}
        error={errorGuardar}
        alGuardar={alCambiarEstado}
        alCancelar={() => {
          setBajaDe(null);
          setErrorGuardar(null);
        }}
      />
    </>
  );
}

