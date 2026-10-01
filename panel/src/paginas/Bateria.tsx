import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Battery, BatteryCharging, BatteryLow, CircleHelp, ExternalLink, Search } from 'lucide-react';
import { CLAVE_FLOTA, equiposHabilitados, traerBateriaEquipo, traerFlota } from '@/dominio/datos';
import { BATERIA_BAJA_PCT } from '@/dominio/bitacora';
import { mensajeError } from '@/dominio/errores';
import { GUION, bateria, fechaHora, hace } from '@/dominio/formatoBase';
import { claveEstado } from '@/dominio/estado';
import { Avatar } from '@/componentes/ui/Avatar';
import { cn } from '@/lib/cn';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { Segmentado } from '@/componentes/ui/Segmentado';
import { Tarjeta, CabeceraTarjeta } from '@/componentes/ui/Tarjeta';
import { Cargando, ErrorCarga, Esqueleto, Vacio } from '@/componentes/ui/Estados';
import { claseBoton } from '@/componentes/ui/Boton';
import { CurvaBateria } from '@/componentes/bateria/CurvaBateria';
import { calcularTendencia, CLASE_FONDO_NIVEL, nivelBateria } from '@/componentes/bateria/nivel';

// 60 s antes de volver a pedir los equipos al navegar entre pantallas.
const CACHE_FLOTA_MS = 60_000;

const RANGOS = [
  { valor: '24', etiqueta: '24 h' },
  { valor: '168', etiqueta: '7 días' },
  { valor: '720', etiqueta: '30 días' },
] as const;
type Horas = (typeof RANGOS)[number]['valor'];
type Filtro = 'todas' | 'riesgo' | 'cargando' | 'sinDato';

function rangoDeHoras(horas: number) {
  const hasta = new Date();
  return { desde: new Date(hasta.getTime() - horas * 3_600_000).toISOString(), hasta: hasta.toISOString() };
}

export default function Bateria() {
  const flotaQ = useQuery({ queryKey: CLAVE_FLOTA, queryFn: () => traerFlota(), staleTime: CACHE_FLOTA_MS });
  const [horas, setHoras] = useState<Horas>('24');
  const [rango, setRango] = useState(() => rangoDeHoras(24));
  const [seleccionManual, setSeleccionManual] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');

  // Menor carga primero; sin lectura (null) al final, nunca se lee como 0.
  const flota = useMemo(() => {
    const datos = equiposHabilitados(flotaQ.data?.datos ?? []);
    return [...datos].sort((a, b) => {
      if (a.bateriaPct == null && b.bateriaPct == null) return a.nombre.localeCompare(b.nombre, 'es');
      if (a.bateriaPct == null) return 1;
      if (b.bateriaPct == null) return -1;
      return a.bateriaPct - b.bateriaPct;
    });
  }, [flotaQ.data]);

  // Manda la persona elegida; si no hay, la más crítica.
  const seleccion = flota.some((d) => d.idPublico === seleccionManual) ? seleccionManual : (flota[0]?.idPublico ?? '');
  const persona = flota.find((d) => d.idPublico === seleccion) ?? null;

  const serie = useQuery({
    queryKey: ['bateria', seleccion, rango.desde, rango.hasta],
    enabled: seleccion !== '',
    queryFn: () => traerBateriaEquipo(seleccion, rango.desde, rango.hasta),
  });

  const muestras = useMemo(() => serie.data?.muestras ?? [], [serie.data]);
  const valores = muestras.flatMap((m) => (m.bateriaPct == null ? [] : [m.bateriaPct]));
  const minima = valores.length > 0 ? Math.min(...valores) : null;
  const tendencia = useMemo(() => calcularTendencia(muestras), [muestras]);
  const textoTendencia = !tendencia
    ? GUION
    : tendencia.direccion === 'estable'
      ? 'Estable'
      : `${tendencia.direccion === 'sube' ? 'Sube' : 'Baja'} ${Math.abs(tendencia.tasaPctHora).toFixed(1)} %/h`;

  const conDato = flota.filter((d) => d.bateriaPct != null);
  const promedio = conDato.length > 0 ? conDato.reduce((t, d) => t + (d.bateriaPct ?? 0), 0) / conDato.length : null;
  const enRiesgo = conDato.filter((d) => (d.bateriaPct ?? 100) <= BATERIA_BAJA_PCT).length;
  const cargando = flota.filter((d) => d.cargando).length;
  const sinDato = flota.length - conDato.length;

  const filtrada = flota.filter((d) => {
    if (filtro === 'riesgo' && !((d.bateriaPct ?? 101) <= BATERIA_BAJA_PCT)) return false;
    if (filtro === 'cargando' && !d.cargando) return false;
    if (filtro === 'sinDato' && d.bateriaPct != null) return false;
    const texto = busqueda.trim().toLowerCase();
    return !texto || d.nombre.toLowerCase().includes(texto) || d.identificadorUnico.toLowerCase().includes(texto);
  });
  const FILTROS: { valor: Filtro; etiqueta: string; cuenta: number }[] = [
    { valor: 'todas', etiqueta: 'Todas', cuenta: flota.length },
    { valor: 'riesgo', etiqueta: `≤${BATERIA_BAJA_PCT}%`, cuenta: enRiesgo },
    { valor: 'cargando', etiqueta: 'Cargando', cuenta: cargando },
    { valor: 'sinDato', etiqueta: 'Sin dato', cuenta: sinDato },
  ];

  return (
    <div className="space-y-4">
      <AccionesPagina>
        <Segmentado
          opciones={RANGOS}
          valor={horas}
          alCambiar={(v) => {
            setHoras(v);
            setRango(rangoDeHoras(Number(v)));
          }}
        />
      </AccionesPagina>

      {/* Resumen de la flota en una franja: con 50+ personas la lista manda. */}
      <Tarjeta className="grid grid-cols-2 divide-borde sm:grid-cols-4 sm:divide-x">
        <Resumen etiqueta="Promedio" valor={promedio == null ? GUION : `${Math.round(promedio)}%`} icono={Battery} />
        <Resumen etiqueta={`En riesgo (≤${BATERIA_BAJA_PCT}%)`} valor={enRiesgo} icono={BatteryLow} tono={enRiesgo > 0 ? 'text-peligro' : undefined} />
        <Resumen etiqueta="Cargando" valor={cargando} icono={BatteryCharging} tono="text-movimiento" />
        <Resumen etiqueta="Sin dato" valor={sinDato} icono={CircleHelp} />
      </Tarjeta>

      {flotaQ.error && <ErrorCarga mensaje={mensajeError(flotaQ.error)} alReintentar={() => void flotaQ.refetch()} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Tarjeta className="flex min-h-0 flex-col overflow-hidden xl:h-[calc(100dvh-240px)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-borde px-3 py-2.5">
            <label className="flex h-8 min-w-40 flex-1 items-center gap-2 rounded-control border border-borde bg-superficie px-2.5 focus-within:border-marca">
              <Search className="size-3.5 text-texto-3" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar persona"
                aria-label="Buscar persona"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-texto-3"
              />
            </label>
            <div className="flex gap-1">
              {FILTROS.map((f) => (
                <button
                  key={f.valor}
                  type="button"
                  onClick={() => setFiltro(f.valor)}
                  aria-pressed={filtro === f.valor}
                  className={cn(
                    'h-8 cursor-pointer rounded-control px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors',
                    filtro === f.valor ? 'bg-tinta-2 text-white' : 'text-texto-2 hover:bg-fondo',
                  )}
                >
                  {f.etiqueta} <span className="opacity-70 cifras">{f.cuenta}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_3.2rem_5.5rem] items-center gap-3 border-b border-borde bg-fondo px-4 py-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-texto-3 uppercase">
            <span>Persona</span>
            <span>Nivel</span>
            <span className="text-right">%</span>
            <span className="text-right">Lectura</span>
          </div>
          {flotaQ.isPending ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }, (_, i) => (
                <Esqueleto key={i} className="h-9" />
              ))}
            </div>
          ) : filtrada.length === 0 ? (
            <Vacio icono={Battery} titulo="Sin personas en este filtro" />
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {filtrada.map((d) => {
                const pct = d.bateriaPct;
                const nivel = nivelBateria(pct);
                const activa = d.idPublico === seleccion;
                return (
                  <li key={d.idPublico}>
                    <button
                      type="button"
                      onClick={() => setSeleccionManual(d.idPublico)}
                      aria-pressed={activa}
                      className={cn(
                        'grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_7.5rem_3.2rem_5.5rem] items-center gap-3 border-b border-borde/60 px-4 py-2 text-left transition-colors',
                        activa ? 'bg-marca-suave shadow-[inset_3px_0_0_var(--color-marca)]' : 'hover:bg-fondo',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar nombre={d.nombre} estado={claveEstado(d)} tamano="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-marino-900">{d.nombre}</span>
                          <span className="block truncate text-[11px] text-texto-3">{d.identificadorUnico}</span>
                        </span>
                      </span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-marino-100">
                        {pct != null && (
                          <span
                            className={cn('block h-full rounded-full', CLASE_FONDO_NIVEL[nivel])}
                            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                          />
                        )}
                      </span>
                      <span
                        className={cn(
                          'flex items-center justify-end gap-1 text-[13px] font-semibold cifras',
                          pct != null && pct <= BATERIA_BAJA_PCT ? 'text-peligro' : 'text-marino-900',
                        )}
                      >
                        {d.cargando && <BatteryCharging className="size-3.5 text-movimiento" aria-label="Cargando" />}
                        {pct == null ? GUION : `${Math.round(pct)}`}
                      </span>
                      <span className="text-right text-[11.5px] text-texto-3">{d.ultimaConexion ? hace(d.ultimaConexion) : GUION}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>

        {persona && (
          <Tarjeta className="self-start xl:sticky xl:top-0">
            <CabeceraTarjeta
              titulo={persona.nombre}
              detalle={persona.identificadorUnico}
              acciones={
                <Link to={`/unidad/${persona.idPublico}`} className={claseBoton('secundario', 'sm')}>
                  <ExternalLink className="size-3.5" /> Expediente
                </Link>
              }
            />
            <dl className="mx-5 mb-3 grid grid-cols-4 divide-x divide-borde rounded-control border border-borde">
              <Dato etiqueta="Actual" valor={bateria(serie.data?.actual)} />
              <Dato etiqueta="Mínima" valor={bateria(minima)} />
              <Dato etiqueta="Lecturas" valor={serie.data ? String(muestras.length) : GUION} />
              <Dato etiqueta="Tendencia" valor={textoTendencia} />
            </dl>
            <div className="px-5 pb-5">
              {serie.isPending && <Cargando texto="Cargando historial…" />}
              {serie.error && <ErrorCarga mensaje={mensajeError(serie.error)} alReintentar={() => void serie.refetch()} />}
              {serie.data && muestras.length === 0 && (
                <Vacio icono={Battery} titulo="Sin lecturas">No hay lecturas de batería en el rango.</Vacio>
              )}
              {serie.data && muestras.length > 0 && valores.length === 0 && (
                <Vacio icono={Battery} titulo="Sin porcentaje">Las lecturas del rango no traen porcentaje de batería.</Vacio>
              )}
              {valores.length > 0 && (
                <>
                  <p className="mb-2 text-[11.5px] text-texto-3">
                    {fechaHora(rango.desde)} — {fechaHora(rango.hasta)}
                  </p>
                  <CurvaBateria muestras={muestras} />
                </>
              )}
            </div>
          </Tarjeta>
        )}
      </div>
    </div>
  );
}

function Resumen({ etiqueta, valor, icono: Icono, tono }: { etiqueta: string; valor: ReactNode; icono: typeof Battery; tono?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icono className="size-4 flex-none text-texto-3" />
      <span className="min-w-0">
        <span className="block text-[11.5px] text-texto-2">{etiqueta}</span>
        <span className={cn('block font-display text-[18px] leading-tight font-semibold text-marino-900 cifras', tono)}>{valor}</span>
      </span>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="px-3 py-2">
      <dt className="text-[11px] text-texto-3">{etiqueta}</dt>
      <dd className="truncate text-[14px] font-semibold text-marino-900 cifras">{valor}</dd>
    </div>
  );
}
