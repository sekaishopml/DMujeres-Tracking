import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LngLatBounds, Marker } from 'maplibre-gl';
import type { Map as MapaMaplibre } from 'maplibre-gl';
import type { Dispositivo, Posicion } from '@contratos';
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  FileText,
  Focus,
  Route,
  Search,
  X,
} from 'lucide-react';
import MapaBase from '@/componentes/mapa/MapaBase';
import { Avatar, colorDeNombre, iniciales } from '@/componentes/ui/Avatar';
import { ChipEstado } from '@/componentes/ui/ChipEstado';
import { BotonIcono, claseBoton } from '@/componentes/ui/Boton';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { cn } from '@/lib/cn';
import {
  CACHE_AUDITORIA_MS,
  CLAVE_FLOTA,
  equiposHabilitados,
  traerBateriaEquipo,
  traerFlota,
  traerJornadas,
  traerParadas,
  traerPosicionesVivas,
  traerReplay,
} from '@/dominio/datos';
import { claveEstado, colorEstado } from '@/dominio/estado';
import { bateria, hace, hora, velocidad, GUION } from '@/dominio/formatoBase';
import { fechaHoyLocal, finDeDia, inicioDeDia, sumarDias } from '@/dominio/rango';
import { TIPOS, traerCronograma } from '@/dominio/cronograma';
import { api } from '@/lib/api';
import { mensajeError } from '@/dominio/errores';
import { construirBitacora, resumenBitacora } from '@/dominio/bitacora';
import { urlExpediente, urlReplay } from '@/dominio/enlaces';

const REFRESCO_MS = 5000;
const ZOOM_PERSONA = 15.5;

// Filtros: "sin señal" junta SIN_SENAL, SEÑAL_DÉBIL y DESCONOCIDO porque en
// los tres hay que revisar el equipo. Los equipos dados de baja no aparecen.
type Filtro = 'todas' | 'enLinea' | 'detenido' | 'sinSenal' | 'deshabilitado';

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'enLinea', etiqueta: 'En ruta' },
  { valor: 'detenido', etiqueta: 'Detenidas' },
  { valor: 'sinSenal', etiqueta: 'Sin señal' },
  { valor: 'deshabilitado', etiqueta: 'Fuera de jornada' },
];

function grupoDe(clave: string): Exclude<Filtro, 'todas'> {
  if (clave === 'enLinea' || clave === 'detenido' || clave === 'deshabilitado') return clave;
  return 'sinSenal';
}

function IconoBateria({ pct, cargando }: { pct: number | null; cargando: boolean | null }) {
  const Icono = cargando ? BatteryCharging : pct == null ? BatteryMedium : pct <= 15 ? BatteryLow : pct >= 70 ? BatteryFull : BatteryMedium;
  return (
    <Icono
      className={cn(
        'size-4',
        cargando ? 'text-movimiento' : pct != null && pct <= 15 ? 'text-peligro' : 'text-texto-3',
      )}
    />
  );
}

// Marcador de persona: sus iniciales sobre su color, con un aro del color del
// estado. MapLibre ubica el elemento externo con su propio transform, así que
// el realce (escala) va en el botón interno y nunca en el externo.
function crearElementoMarcador(equipo: Dispositivo): HTMLElement {
  const externo = document.createElement('div');
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.setAttribute('aria-label', equipo.nombre);
  boton.className =
    'grid size-11 cursor-pointer place-items-center rounded-full border-[3px] border-white font-display text-[13px] font-semibold text-white shadow-[0_6px_16px_rgb(12_31_61/0.35)] outline-[3px] outline-solid transition-transform duration-200';
  boton.textContent = iniciales(equipo.nombre);
  boton.style.background = colorDeNombre(equipo.nombre);
  externo.append(boton);
  return externo;
}

function pintarMarcador(externo: HTMLElement, equipo: Dispositivo, seleccionado: boolean) {
  const boton = externo.firstElementChild as HTMLElement | null;
  if (!boton) return;
  boton.style.outlineColor = seleccionado ? '#eb0045' : colorEstado(equipo);
  boton.style.transform = seleccionado ? 'scale(1.2)' : '';
  boton.title = equipo.nombre;
  externo.style.zIndex = seleccionado ? '2' : '1';
}

export default function EnVivo() {
  const [mapa, setMapa] = useState<MapaMaplibre | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [seleccionado, setSeleccionado] = useState<number | null>(null);
  const marcadores = useRef(new Map<number, Marker>());
  const seleccionarRef = useRef<(id: number) => void>(() => {});
  const encuadrado = useRef(false);

  // Se consulta cada 5 s mientras la pestaña está visible; un 401 aquí no
  // redirige (eso lo decide el marco).
  const flota = useQuery({
    queryKey: CLAVE_FLOTA,
    queryFn: () => traerFlota({ redirigir401: false }),
    refetchInterval: () => (document.hidden ? false : REFRESCO_MS),
  });
  const vivas = useQuery({
    queryKey: ['posiciones-vivas'],
    queryFn: () => traerPosicionesVivas({ redirigir401: false }),
    refetchInterval: () => (document.hidden ? false : REFRESCO_MS),
  });

  const equipos = useMemo(() => equiposHabilitados(flota.data?.datos ?? []), [flota.data]);
  const ids = useMemo(() => new Set(equipos.map((e) => e.id)), [equipos]);
  const posiciones = useMemo(
    () =>
      new Map(
        (vivas.data?.datos ?? []).filter((p) => ids.has(p.dispositivoId)).map((p) => [p.dispositivoId, p] as const),
      ),
    [vivas.data, ids],
  );
  const seleccion = seleccionado != null && ids.has(seleccionado) ? equipos.find((e) => e.id === seleccionado) ?? null : null;

  const { refetch: refrescarFlota } = flota;
  const { refetch: refrescarVivas } = vivas;
  useEffect(() => {
    const alVolver = () => {
      if (!document.hidden) {
        void refrescarFlota();
        void refrescarVivas();
      }
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [refrescarFlota, refrescarVivas]);

  // Marcadores: se crean una vez por persona y se actualizan en sitio en cada
  // sondeo (recrearlos haría parpadear el mapa).
  useEffect(() => {
    if (!mapa) {
      for (const m of marcadores.current.values()) m.remove();
      marcadores.current.clear();
      encuadrado.current = false;
      return;
    }
    const vigentes = new Set<number>();
    for (const equipo of equipos) {
      const posicion = posiciones.get(equipo.id);
      if (!posicion) continue;
      vigentes.add(equipo.id);
      let marcador = marcadores.current.get(equipo.id);
      if (!marcador) {
        const elemento = crearElementoMarcador(equipo);
        elemento.addEventListener('click', (evento) => {
          evento.stopPropagation();
          seleccionarRef.current(equipo.id);
        });
        marcador = new Marker({ element: elemento, anchor: 'center' }).setLngLat([posicion.longitud, posicion.latitud]).addTo(mapa);
        marcadores.current.set(equipo.id, marcador);
      } else {
        marcador.setLngLat([posicion.longitud, posicion.latitud]);
      }
      pintarMarcador(marcador.getElement(), equipo, equipo.id === seleccion?.id);
    }
    for (const [id, marcador] of marcadores.current) {
      if (!vigentes.has(id)) {
        marcador.remove();
        marcadores.current.delete(id);
      }
    }
    // Primer encuadre automático cuando llegan las posiciones; después el
    // encuadre solo cambia por orden de la persona que supervisa.
    if (!encuadrado.current && posiciones.size > 0) {
      encuadrado.current = true;
      mapa.resize();
      encuadrar(mapa, [...posiciones.values()]);
    }
  }, [mapa, equipos, posiciones, seleccion?.id]);

  useEffect(() => {
    seleccionarRef.current = seleccionar;
  });

  useEffect(() => {
    if (!mapa) return;
    const alClic = () => setSeleccionado(null);
    mapa.on('click', alClic);
    return () => {
      mapa.off('click', alClic);
    };
  }, [mapa]);

  function encuadrar(destino: MapaMaplibre, lista: Posicion[]) {
    if (lista.length === 0) return;
    const primero: [number, number] = [lista[0].longitud, lista[0].latitud];
    const limites = lista.reduce((caja, p) => caja.extend([p.longitud, p.latitud]), new LngLatBounds(primero, primero));
    destino.fitBounds(limites, { padding: { top: 80, bottom: 80, left: 60, right: 60 }, maxZoom: 15, duration: 0 });
  }

  function seleccionar(id: number) {
    setSeleccionado(id);
    const posicion = posiciones.get(id);
    if (!mapa || !posicion) return;
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const centro: [number, number] = [posicion.longitud, posicion.latitud];
    // Desplazado hacia arriba para que la ficha flotante no tape el marcador.
    if (reducido) mapa.jumpTo({ center: centro, zoom: ZOOM_PERSONA, padding: { bottom: 180, top: 0, left: 0, right: 0 } });
    else mapa.flyTo({ center: centro, zoom: ZOOM_PERSONA, padding: { bottom: 180, top: 0, left: 0, right: 0 }, duration: 900, curve: 1.42 });
  }

  function verTodas() {
    setSeleccionado(null);
    if (mapa) encuadrar(mapa, [...posiciones.values()]);
  }

  const conteos = useMemo(() => {
    const c = { todas: equipos.length, enLinea: 0, detenido: 0, sinSenal: 0, deshabilitado: 0 };
    for (const e of equipos) c[grupoDe(claveEstado(e))] += 1;
    return c;
  }, [equipos]);

  const texto = busqueda.trim().toLowerCase();
  const listado = useMemo(
    () =>
      equipos.filter((e) => {
        if (filtro !== 'todas' && grupoDe(claveEstado(e)) !== filtro) return false;
        return !texto || `${e.nombre} ${e.identificadorUnico}`.toLowerCase().includes(texto);
      }),
    [equipos, filtro, texto],
  );

  const error = flota.error ?? vivas.error;

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-5 lg:flex-row">
      <AccionesPagina>
        <span className="text-[12px] text-texto-3">
          {vivas.dataUpdatedAt ? `Actualizado ${hace(new Date(vivas.dataUpdatedAt).toISOString())}` : 'Conectando…'}
        </span>
      </AccionesPagina>

      {/* Lista de personas */}
      <aside className="flex max-h-[45dvh] w-full flex-none flex-col gap-3 lg:max-h-none lg:w-[380px]">
        <div className="grid grid-cols-5 gap-1 rounded-[14px] border border-borde bg-superficie p-1">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className={cn(
                'flex min-w-0 cursor-pointer flex-col items-center rounded-[10px] px-1 py-1.5 text-[11px] leading-tight font-medium transition-colors',
                filtro === f.valor ? 'bg-marca text-white' : 'text-texto-2 hover:bg-fondo',
              )}
            >
              <span className="font-display text-[15px] font-semibold cifras">{conteos[f.valor]}</span>
              <span className="w-full truncate text-center">{f.etiqueta}</span>
            </button>
          ))}
        </div>

        <label className="flex h-10 items-center gap-2 rounded-[12px] border border-borde bg-superficie px-3.5 focus-within:border-marca">
          <Search className="size-4 text-texto-3" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar persona…"
            aria-label="Buscar persona"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-texto-3"
          />
        </label>

        {error && <ErrorCarga mensaje={mensajeError(error)} alReintentar={() => void refrescarFlota()} />}

        <ul className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 pb-1">
          {flota.isPending && <Cargando />}
          {listado.map((equipo) => {
            const posicion = posiciones.get(equipo.id);
            const activa = seleccion?.id === equipo.id;
            return (
              <li key={equipo.id}>
                <button
                  type="button"
                  onClick={() => seleccionar(equipo.id)}
                  aria-pressed={activa}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-[14px] border bg-superficie px-3.5 py-3 text-left transition-[border-color,box-shadow]',
                    activa ? 'border-marca shadow-[0_0_0_3px_var(--color-marca-suave)]' : 'border-borde hover:border-borde-fuerte',
                  )}
                >
                  <Avatar nombre={equipo.nombre} estado={claveEstado(equipo)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-marino-900">{equipo.nombre}</span>
                    <span className="block truncate text-[12px] text-texto-3">
                      {posicion ? hace(posicion.registradoEn) : 'Sin posición'}
                      {' · '}
                      {equipo.jornadaActiva ? 'en jornada' : 'jornada cerrada'}
                    </span>
                  </span>
                  <span className="flex flex-none flex-col items-end gap-1">
                    <ChipEstado equipo={equipo} />
                    <span className="flex items-center gap-1 text-[11.5px] text-texto-2 cifras">
                      <IconoBateria pct={equipo.bateriaPct} cargando={equipo.cargando} />
                      {bateria(equipo.bateriaPct)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {!flota.isPending && listado.length === 0 && (
            <Vacio titulo="Sin coincidencias">Ninguna persona coincide con el filtro o la búsqueda.</Vacio>
          )}
        </ul>
      </aside>

      {/* Mapa */}
      <section className="relative min-h-[420px] flex-1 overflow-hidden rounded-tarjeta border border-borde shadow-tarjeta">
        <MapaBase alListo={setMapa} selectorIzquierda zoomAbajoDerecha />
        <button
          type="button"
          onClick={verTodas}
          disabled={posiciones.size === 0}
          className={cn(claseBoton('secundario', 'sm'), 'absolute top-14 left-3 z-[5] shadow-flotante sm:top-3 sm:right-3 sm:left-auto')}
        >
          <Focus className="size-3.5" />
          Ver todas
        </button>
        {seleccion && (
          <FichaPersona
            equipo={seleccion}
            posicion={posiciones.get(seleccion.id)}
            alCerrar={() => setSeleccionado(null)}
          />
        )}
      </section>
    </div>
  );
}

// Ficha flotante de la persona elegida: estado actual y los hitos de hoy
// (inicio de jornada, salida, llegada, cortes, cierre) desde la bitácora.
function FichaPersona({
  equipo,
  posicion,
  alCerrar,
}: {
  equipo: Dispositivo;
  posicion?: Posicion;
  alCerrar: () => void;
}) {
  const hoy = fechaHoyLocal();
  const desde = inicioDeDia(hoy);
  const hasta = finDeDia(hoy);
  const id = equipo.idPublico;
  const opciones = { staleTime: CACHE_AUDITORIA_MS, retry: 0 } as const;
  // Jornadas de los últimos 7 días: una jornada abierta antes de hoy y sin
  // terminar cuenta como la de hoy, desde que empezó.
  const desdeJornadas = inicioDeDia(sumarDias(hoy, -7));
  const jornadas = useQuery({
    queryKey: ['jornadas', id, 'ficha', hoy],
    queryFn: () => traerJornadas(id, desdeJornadas, hasta),
    ...opciones,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const version = useQuery({
    queryKey: ['sistema', 'version'],
    queryFn: () => api.get<{ versionApp?: string | null }>('/api/v1/version', { redirigir401: false }),
    staleTime: 10 * 60_000,
  });
  const actividades = useQuery({
    queryKey: ['cronograma', hoy, hoy, id],
    queryFn: () => traerCronograma(hoy, hoy, id),
    staleTime: 60_000,
    retry: 0,
  });
  const replay = useQuery({ queryKey: ['replay', id, hoy, hoy], queryFn: () => traerReplay(id, desde, hasta), ...opciones });
  const paradas = useQuery({ queryKey: ['paradas', id, hoy, hoy], queryFn: () => traerParadas(id, desde, hasta), ...opciones });
  const muestras = useQuery({ queryKey: ['bateria', id, hoy], queryFn: () => traerBateriaEquipo(id, desde, hasta), ...opciones });

  const resumen = useMemo(
    () =>
      resumenBitacora(
        construirBitacora({
          jornadas: jornadas.data?.jornadas,
          posiciones: replay.data?.posiciones,
          huecos: replay.data?.huecos,
          paradas: paradas.data?.datos,
          muestrasBateria: muestras.data?.muestras,
        }),
      ),
    [jornadas.data, replay.data, paradas.data, muestras.data],
  );
  const cargando = jornadas.isPending || replay.isPending || paradas.isPending;

  // Jornada del día: la abierta (aunque haya empezado antes) o la última que
  // empezó hoy. El tiempo corre mientras está abierta y se congela al cerrar.
  const jornada = useMemo(() => {
    const lista = [...(jornadas.data?.jornadas ?? [])].sort((a, b) => b.inicioEn.localeCompare(a.inicioEn));
    return lista.find((j) => !j.finEn) ?? lista.find((j) => j.inicioEn >= desde) ?? null;
  }, [jornadas.data, desde]);
  const ahora = useReloj(jornada && !jornada.finEn ? 1000 : null);
  const inicioMs = jornada ? new Date(jornada.inicioEn).getTime() : null;
  const finMs = jornada?.finEn ? new Date(jornada.finEn).getTime() : ahora;
  const tiempoJornada = inicioMs != null && finMs > inicioMs ? reloj((finMs - inicioMs) / 1000) : GUION;
  // Primera salida tras iniciar la jornada (deja su primera parada).
  const salida = (replay.data?.posiciones ?? []).length
    ? resumen.primeraSalida && inicioMs != null && new Date(resumen.primeraSalida.instante).getTime() >= inicioMs - 60_000
      ? resumen.primeraSalida
      : null
    : null;
  const diaInicio = jornada ? fechaLocalDe(jornada.inicioEn) : null;

  const hitos: { etiqueta: string; valor: string; detalle?: string; vivo?: boolean }[] = [
    {
      etiqueta: 'Inició jornada',
      valor: jornada ? hora(jornada.inicioEn) : GUION,
      detalle: diaInicio && diaInicio !== hoy ? `el ${diaInicio.slice(8, 10)}/${diaInicio.slice(5, 7)}` : undefined,
    },
    { etiqueta: 'Primera salida', valor: salida ? hora(salida.instante) : GUION },
    { etiqueta: 'Tiempo de jornada', valor: tiempoJornada, vivo: Boolean(jornada && !jornada.finEn) },
    { etiqueta: 'Finalizó', valor: jornada?.finEn ? hora(jornada.finEn) : jornada ? 'En curso' : GUION },
  ];

  // Actividad en curso: la última del cronograma de hoy cuya hora ya pasó.
  const actividad = useMemo(() => {
    const ahoraHM = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    return [...(actividades.data?.datos ?? [])].filter((a) => a.hora <= ahoraHM).sort((a, b) => b.hora.localeCompare(a.hora))[0] ?? null;
  }, [actividades.data]);

  const publicada = version.data?.versionApp ?? null;
  const estadoApp =
    !equipo.versionApp || !publicada
      ? null
      : compararVersiones(equipo.versionApp, publicada) >= 0
        ? { texto: 'Última versión', clase: 'bg-movimiento-suave text-movimiento' }
        : { texto: `Desactualizada (hay ${publicada})`, clase: 'bg-sin-senal-suave text-sin-senal' };

  return (
    <div className="absolute inset-x-3 bottom-3 z-[6] animate-entrar rounded-tarjeta border border-borde bg-superficie shadow-flotante md:inset-x-4 md:bottom-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar nombre={equipo.nombre} estado={claveEstado(equipo)} tamano="lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-[16px] font-semibold text-marino-900">{equipo.nombre}</p>
            <p className="truncate text-[12px] text-texto-3">
              {posicion ? `Reportó ${hace(posicion.registradoEn)} · ${velocidad(posicion.velocidadKmh)}` : 'Sin posición conocida'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[12px]">
          <span>
            <span className="block text-texto-3">Batería</span>
            <span className="flex items-center gap-1 font-semibold text-marino-900 cifras">
              <IconoBateria pct={equipo.bateriaPct} cargando={equipo.cargando} />
              {bateria(equipo.bateriaPct)}
            </span>
          </span>
          <span>
            <span className="block text-texto-3">App</span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-marino-900">{equipo.plataforma === 'ios' ? 'iPhone (Traccar Client)' : (equipo.versionApp ?? GUION)}</span>
              {estadoApp && <span className={cn('rounded-full px-1.5 text-[10.5px] font-semibold', estadoApp.clase)}>{estadoApp.texto}</span>}
            </span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ChipEstado equipo={equipo} />
          <BotonIcono icono={X} etiqueta="Cerrar ficha" onClick={alCerrar} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-borde bg-borde sm:grid-cols-4">
        {hitos.map((h) => (
          <div key={h.etiqueta} className="bg-superficie px-5 py-2.5">
            <p className="flex items-center gap-1.5 text-[11.5px] text-texto-3">
              {h.vivo && <span className="size-1.5 animate-pulse rounded-full bg-movimiento motion-reduce:animate-none" />}
              {h.etiqueta}
            </p>
            <p className="font-display text-[15px] font-semibold text-marino-900 cifras">
              {cargando && !jornadas.data ? '…' : h.valor}
              {h.detalle && <span className="ml-1 text-[12px] font-normal text-texto-3">{h.detalle}</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <p className="mr-auto min-w-0 truncate text-[12.5px] text-texto-2">
          {actividad ? (
            <>
              <span className="text-texto-3">Actividad en curso: </span>
              <b className="font-semibold text-marino-900">{TIPOS[actividad.tipo]?.etiqueta ?? actividad.tipo}</b>
              {actividad.lugar ? ` · ${actividad.lugar}` : ''} <span className="text-texto-3 cifras">desde las {actividad.hora}</span>
            </>
          ) : actividades.isPending ? (
            'Leyendo el cronograma…'
          ) : (
            <span className="text-texto-3">Sin actividad cargada en el cronograma.</span>
          )}
        </p>
        <Link to={urlExpediente(equipo.idPublico, hoy)} className={claseBoton('secundario', 'sm')}>
          <FileText className="size-3.5" />
          Expediente
        </Link>
        <Link to={urlReplay(equipo.idPublico, hoy)} className={claseBoton('principal', 'sm')}>
          <Route className="size-3.5" />
          Replay de hoy
        </Link>
      </div>
    </div>
  );
}

// Reloj que avanza cada `pasoMs` (null = detenido): el tiempo de jornada
// en curso sube solo y se congela al finalizar.
function useReloj(pasoMs: number | null): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (pasoMs == null) return;
    setAhora(Date.now());
    const t = window.setInterval(() => setAhora(Date.now()), pasoMs);
    return () => window.clearInterval(t);
  }, [pasoMs]);
  return ahora;
}

function reloj(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sg = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sg).padStart(2, '0')}`;
}

function fechaLocalDe(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date(iso));
}

function compararVersiones(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
