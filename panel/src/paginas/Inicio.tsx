import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Map as MapaIcono, Route } from 'lucide-react';
import type { Dispositivo, ResumenReporte } from '@contratos';
import { api, consulta } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Avatar } from '@/componentes/ui/Avatar';
import { Tarjeta } from '@/componentes/ui/Tarjeta';
import { ErrorCarga, Esqueleto } from '@/componentes/ui/Estados';
import '@/componentes/inicio/inicio.css';
import { claseBoton } from '@/componentes/ui/Boton';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { bateria, duracion, hace, hora, GUION } from '@/dominio/formatoBase';
import { traerFlota, traerJornadasFlota, traerSalud, CLAVE_FLOTA, equiposHabilitados } from '@/dominio/datos';
import { mensajeError } from '@/dominio/errores';
import { etiquetaEstado, claveEstado } from '@/dominio/estado';
import { finDeDia, fechaHoyLocal, inicioDeDia, sumarDias } from '@/dominio/rango';
import { traerCronograma } from '@/dominio/cronograma';
import { CLAVE_NOVEDADES_CRONOGRAMA, REFRESCO_NOVEDADES_MS, traerNovedadesCronograma } from '@/componentes/reportes/novedades';

// Inicio: el tablero del día. Arriba, cómo está el equipo ahora y las cifras
// del día; al centro, una fila por persona con lo de hoy (estado, jornada,
// recorrido, cronograma, batería y app); a la derecha, lo que hay que revisar
// y las últimas actividades cargadas.

const REFRESCO_MS = 15_000;
const REFRESCO_DIA_MS = 60_000;
const BATERIA_BAJA_PCT = 15;
const JORNADA_LARGA_H = 16;

type FiltroPersonas = 'todas' | 'jornada' | 'revisar' | 'senal';
const FILTROS: { valor: FiltroPersonas; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'jornada', etiqueta: 'En jornada' },
  { valor: 'revisar', etiqueta: 'Para revisar' },
  { valor: 'senal', etiqueta: 'Sin señal' },
];

const PUNTO_ESTADO: Record<string, string> = {
  enLinea: 'bg-movimiento',
  detenido: 'bg-detenido',
  sinSenal: 'bg-sin-senal',
  desconocido: 'bg-sin-senal',
  deshabilitado: 'bg-deshabilitado',
};


// Compara versiones por partes ("2.4.0" es mayor que "2.1.73").
function compararVersion(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Inicio de jornada: solo la hora si fue hoy; "Ayer 15:03" o "28/09 08:10" si
// empezó antes y sigue abierta.
function inicioJornada(inicioEn: string, hoy: string): string {
  const dia = fechaLocal(inicioEn);
  if (dia === hoy) return hora(inicioEn);
  if (dia === sumarDias(hoy, -1)) return `Ayer ${hora(inicioEn)}`;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${hora(inicioEn)}`;
}

function fechaLocal(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date(iso));
}


type CategoriaEvento = 'inicio_jornada' | 'fin_jornada' | 'actividad' | 'alerta' | 'recuperacion';
interface EventoDia {
  categoria: CategoriaEvento;
  texto: string;
  detalle: string | null;
  en: string;
  dispositivoId: string;
  nombre: string;
}
interface RespuestaEventos {
  total: number;
  conteo: Record<CategoriaEvento, number>;
  datos: EventoDia[];
}

// Color de severidad de cada categoría en la línea de tiempo.
const COLOR_EVENTO: Record<CategoriaEvento, string> = {
  inicio_jornada: 'bg-movimiento',
  fin_jornada: 'bg-deshabilitado',
  actividad: 'bg-marino-700',
  alerta: 'bg-peligro',
  recuperacion: 'bg-detenido',
};

interface Revision {
  equipo: Dispositivo;
  motivos: string[];
  grave: boolean;
}

export default function Inicio() {
  const hoy = fechaHoyLocal();

  const flota = useQuery({
    queryKey: CLAVE_FLOTA,
    queryFn: () => traerFlota({ redirigir401: false }),
    refetchInterval: REFRESCO_MS,
  });
  // Últimos 7 días: una jornada que sigue abierta (aunque haya empezado antes)
  // es la de hoy, y se muestra desde cuándo está abierta.
  const desdeJornadas = sumarDias(hoy, -7);
  const jornadas = useQuery({
    queryKey: ['inicio', 'jornadas', hoy],
    queryFn: () => traerJornadasFlota(inicioDeDia(desdeJornadas), finDeDia(hoy), undefined, { redirigir401: false }),
    refetchInterval: () => (document.hidden ? false : REFRESCO_DIA_MS),
  });
  const resumen = useQuery({
    queryKey: ['inicio', 'resumen', hoy],
    queryFn: () =>
      api.get<ResumenReporte>(`/api/v1/reports/summary${consulta({ desde: inicioDeDia(hoy), hasta: finDeDia(hoy) })}`, {
        redirigir401: false,
      }),
    refetchInterval: () => (document.hidden ? false : REFRESCO_DIA_MS),
    retry: false,
  });
  const actividades = useQuery({
    queryKey: ['inicio', 'cronograma', hoy],
    queryFn: () => traerCronograma(hoy, hoy),
    refetchInterval: () => (document.hidden ? false : REFRESCO_DIA_MS),
    retry: false,
  });
  const novedades = useQuery({
    queryKey: CLAVE_NOVEDADES_CRONOGRAMA,
    queryFn: traerNovedadesCronograma,
    refetchInterval: REFRESCO_NOVEDADES_MS,
    retry: false,
  });
  // Eventos de hoy: se refrescan seguido, es lo que más cambia.
  const eventos = useQuery({
    queryKey: ['inicio', 'eventos', hoy],
    queryFn: () =>
      api.get<RespuestaEventos>(`/api/v1/eventos${consulta({ desde: inicioDeDia(hoy), hasta: finDeDia(hoy) })}`, {
        redirigir401: false,
      }),
    refetchInterval: () => (document.hidden ? false : REFRESCO_MS * 2),
    retry: false,
  });
  const salud = useQuery({
    queryKey: ['salud'],
    queryFn: traerSalud,
    refetchInterval: () => (document.hidden ? false : REFRESCO_DIA_MS),
    retry: false,
  });

  const equipos = useMemo(() => equiposHabilitados(flota.data?.datos ?? []), [flota.data]);

  // Versión de app más nueva vista en la flota: quien tenga una menor no
  // recibió la actualización.
  const versionMasNueva = useMemo(
    () =>
      equipos
        .map((e) => e.versionApp)
        .filter((v): v is string => Boolean(v))
        .sort(compararVersion)
        .at(-1) ?? null,
    [equipos],
  );


  const jornadaPorPersona = useMemo(() => {
    const mapa = new Map<string, { inicioEn: string; finEn: string | null; duracionMin: number | null }>();
    const lista = [...(jornadas.data?.datos ?? [])].sort((a, b) => b.inicioEn.localeCompare(a.inicioEn));
    // La más reciente de cada persona, si sigue abierta o se cerró hoy.
    const inicioHoy = new Date(inicioDeDia(hoy)).getTime();
    for (const j of lista) {
      if (mapa.has(j.idPublico)) continue;
      if (j.finEn == null || new Date(j.finEn).getTime() >= inicioHoy) mapa.set(j.idPublico, j);
    }
    return mapa;
  }, [jornadas.data, hoy]);
  const recorridoPorPersona = useMemo(
    () => new Map((resumen.data?.porDispositivo ?? []).map((r) => [r.idPublico, r])),
    [resumen.data],
  );
  const actividadesPorPersona = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const a of actividades.data?.datos ?? []) mapa.set(a.dispositivoId, (mapa.get(a.dispositivoId) ?? 0) + 1);
    return mapa;
  }, [actividades.data]);
  const nuevasPorPersona = useMemo(
    () => new Map((novedades.data?.personas ?? []).map((p) => [p.dispositivoId, p.nuevas])),
    [novedades.data],
  );

  const revisar = useMemo<Revision[]>(() => {
    const causaSalud = new Map(
      (salud.data?.datos ?? []).filter((s) => s.estado !== 'HEALTHY' && s.causa).map((s) => [s.dispositivoId, s.causa]),
    );
    const lista: Revision[] = [];
    for (const e of equipos) {
      const motivos: string[] = [];
      let grave = false;
      const clave = claveEstado(e);
      // El servidor ya decide: señal débil = más de 15 min sin responder,
      // sin señal = más de 60 min (ver flota.js).
      if (clave === 'sinSenal' || clave === 'desconocido') {
        motivos.push(
          e.ultimaConexion ? `${etiquetaEstado(e)}: no responde desde las ${hora(e.ultimaConexion)}` : 'Nunca ha respondido',
        );
        grave = grave || e.jornadaActiva;
      }
      if (e.bateriaPct != null && e.bateriaPct <= BATERIA_BAJA_PCT && !e.cargando) {
        motivos.push(`Batería ${bateria(e.bateriaPct)}`);
        grave = true;
      }
      if ((e.pendientes ?? 0) > 0) motivos.push(`${e.pendientes} puntos sin enviar`);
      // Jornada abierta de más de JORNADA_LARGA_H: casi siempre olvidó finalizar.
      const jornada = jornadaPorPersona.get(e.idPublico);
      if (jornada && !jornada.finEn) {
        const horas = (Date.now() - new Date(jornada.inicioEn).getTime()) / 3_600_000;
        if (horas > JORNADA_LARGA_H) motivos.push(`Jornada abierta hace ${Math.floor(horas)} h`);
      }
      if (versionMasNueva && e.versionApp && compararVersion(e.versionApp, versionMasNueva) < 0) {
        motivos.push(`App ${e.versionApp} (hay ${versionMasNueva})`);
      }
      const causa = causaSalud.get(e.id)?.replace(/^Último GPS hace [^.]*\.?\s*/, '').trim();
      if (causa && motivos.length === 0) motivos.push(causa);
      if (motivos.length > 0) lista.push({ equipo: e, motivos, grave });
    }
    return lista.sort((a, b) => Number(b.grave) - Number(a.grave) || a.equipo.nombre.localeCompare(b.equipo.nombre, 'es'));
  }, [equipos, salud.data, versionMasNueva, jornadaPorPersona]);
  const enRevision = useMemo(() => new Set(revisar.map((r) => r.equipo.id)), [revisar]);

  // Personas: primero quien está en jornada, después quien requiere revisión,
  // y por nombre.
  const ordenadas = useMemo(
    () =>
      [...equipos].sort(
        (a, b) =>
          Number(b.jornadaActiva) - Number(a.jornadaActiva) ||
          Number(enRevision.has(b.id)) - Number(enRevision.has(a.id)) ||
          a.nombre.localeCompare(b.nombre, 'es'),
      ),
    [equipos, enRevision],
  );
  // Con 50 personas la tabla se filtra y se busca: no crece sin límite.
  const [filtro, setFiltro] = useState<FiltroPersonas>('todas');
  const [busqueda, setBusqueda] = useState('');
  const cuentaFiltro: Record<FiltroPersonas, number> = {
    todas: equipos.length,
    jornada: equipos.filter((e) => e.jornadaActiva).length,
    revisar: enRevision.size,
    senal: equipos.filter((e) => ['sinSenal', 'desconocido'].includes(claveEstado(e))).length,
  };
  const filas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return ordenadas.filter((e) => {
      if (texto && !e.nombre.toLowerCase().includes(texto) && !e.identificadorUnico.toLowerCase().includes(texto)) return false;
      if (filtro === 'jornada') return e.jornadaActiva;
      if (filtro === 'revisar') return enRevision.has(e.id);
      if (filtro === 'senal') return ['sinSenal', 'desconocido'].includes(claveEstado(e));
      return true;
    });
  }, [ordenadas, busqueda, filtro, enRevision]);


  const actualizado = flota.dataUpdatedAt ? hace(new Date(flota.dataUpdatedAt).toISOString()) : null;

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <AccionesPagina>
        <span className="hidden text-[12px] text-texto-3 sm:inline">
          {actualizado ? `Actualizado ${actualizado}` : 'Sin datos todavía'}
          {flota.isFetching ? ' · actualizando…' : ''}
        </span>
        <Link to="/en-vivo" className={claseBoton('secundario')}>
          <MapaIcono className="size-4" />
          Mapa en vivo
        </Link>
      </AccionesPagina>

      {flota.isPending && <InicioEsqueleto />}
      {flota.error && <ErrorCarga mensaje={mensajeError(flota.error)} alReintentar={() => void flota.refetch()} />}

      {flota.data && (
        <>
          <Resumen
            personas={equipos.filter((e) => e.jornadaActiva)}
            total={equipos.length}
            jornadas={jornadaPorPersona}
            hoy={hoy}
            eventos={eventos.data ?? null}
            alVerTodas={() => setFiltro('jornada')}
          />

          <div className="grid gap-4 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Tarjeta className="flex min-w-0 flex-col overflow-hidden lg:min-h-0" id="tabla-personas">
              <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2.5">
                <h2 className="mr-auto text-[15px] font-semibold">Personal</h2>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar personas">
                  {FILTROS.map((f) => (
                    <button
                      key={f.valor}
                      type="button"
                      onClick={() => setFiltro(f.valor)}
                      aria-pressed={filtro === f.valor}
                      className={cn(
                        'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
                        filtro === f.valor ? 'border-tinta-2 bg-tinta-2 text-white' : 'border-borde text-texto-2 hover:border-marino-300 hover:text-marino-900',
                      )}
                    >
                      {f.etiqueta}
                      <span className={cn('cifras', filtro === f.valor ? 'text-white/80' : 'text-texto-3')}>{cuentaFiltro[f.valor]}</span>
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={busqueda}
                  onChange={(ev) => setBusqueda(ev.target.value)}
                  placeholder="Buscar persona"
                  aria-label="Buscar persona"
                  className="h-7 w-40 rounded-full border border-borde bg-superficie px-3 text-[12px] focus-visible:border-marca focus-visible:outline-none"
                />
              </div>
              <div className="inicio-scroll min-h-0 flex-1 overflow-auto max-lg:max-h-[560px]">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead className="sticky top-0 z-[2]">
                    <tr className="border-y border-borde bg-marino-50 text-left text-[12px] font-medium text-texto-2">
                      <th className="px-4 py-2">Persona</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Jornada</th>
                      <th className="px-3 py-2 text-right">Paradas hoy</th>
                      <th className="px-3 py-2 text-right">Actividades</th>
                      <th className="px-3 py-2">Batería</th>
                      <th className="px-3 py-2">App</th>
                      <th className="w-0 px-3 py-2" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {filas.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-[12.5px] text-texto-3">
                          Nadie coincide con el filtro.
                        </td>
                      </tr>
                    )}
                    {filas.map((e) => (
                      <FilaPersona
                        key={e.id}
                        equipo={e}
                        hoy={hoy}
                        jornada={jornadaPorPersona.get(e.idPublico) ?? null}
                        recorrido={recorridoPorPersona.get(e.idPublico) ?? null}
                        actividades={actividadesPorPersona.get(e.idPublico) ?? 0}
                        nuevas={nuevasPorPersona.get(e.idPublico) ?? 0}
                        versionMasNueva={versionMasNueva}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Tarjeta>

            <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
              <ParaRevisar revisar={revisar} />
              <LineaDeTiempo eventos={eventos.data ?? null} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}


function FilaPersona({
  equipo,
  hoy,
  jornada,
  recorrido,
  actividades,
  nuevas,
  versionMasNueva,
}: {
  equipo: Dispositivo;
  hoy: string;
  jornada: { inicioEn: string; finEn: string | null; duracionMin: number | null } | null;
  recorrido: { distanciaKm: number; paradas: number } | null;
  actividades: number;
  nuevas: number;
  versionMasNueva: string | null;
}) {
  const clave = claveEstado(equipo);
  const bajaBateria = equipo.bateriaPct != null && equipo.bateriaPct <= BATERIA_BAJA_PCT;
  const appVieja = Boolean(versionMasNueva && equipo.versionApp && compararVersion(equipo.versionApp, versionMasNueva) < 0);
  return (
    <tr className="border-b border-borde/70 last:border-b-0 hover:bg-fondo/60">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2.5">
          <Avatar nombre={equipo.nombre} estado={clave} tamano="sm" />
          <div className="min-w-0 leading-tight">
            <Link to={`/unidad/${equipo.idPublico}`} className="block truncate font-semibold text-marino-900 hover:text-marca">
              {equipo.nombre}
            </Link>
            <span className="block truncate text-[11px] text-texto-3">{equipo.identificadorUnico}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 text-marino-900">
          <span className={cn('size-2 rounded-full', PUNTO_ESTADO[clave] ?? 'bg-deshabilitado')} />
          {etiquetaEstado(equipo)}
        </span>
        <span className="block pl-3.5 text-[11px] text-texto-3">{equipo.ultimaConexion ? hace(equipo.ultimaConexion) : 'Sin reportes'}</span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap cifras">
        {jornada ? (
          <>
            <span className="text-marino-900">
              {inicioJornada(jornada.inicioEn, hoy)} –{' '}
              {jornada.finEn ? hora(jornada.finEn) : 'ahora'}
            </span>
            <span className="block text-[11px] text-texto-3">
              {jornada.duracionMin != null ? duracion(jornada.duracionMin * 60) : 'En curso'}
            </span>
          </>
        ) : (
          <span className="text-texto-3">Sin jornada</span>
        )}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap cifras">
        {recorrido && recorrido.paradas > 0 ? (
          <span className="text-marino-900">{recorrido.paradas}</span>
        ) : (
          <span className="text-texto-3">{recorrido ? 0 : GUION}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap cifras">
        <span className={actividades > 0 ? 'text-marino-900' : 'text-texto-3'}>{actividades}</span>
        {nuevas > 0 && (
          <span
            className="ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-marca px-1 align-[1px] text-[10px] font-bold text-white"
            title={`${nuevas} nuevas sin revisar`}
          >
            {nuevas}
          </span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-fondo" aria-hidden="true">
            <span
              className={cn('block h-full rounded-full', bajaBateria ? 'bg-peligro' : 'bg-marino-300')}
              style={{ width: `${Math.max(0, Math.min(100, equipo.bateriaPct ?? 0))}%` }}
            />
          </span>
          <span className={cn('cifras', bajaBateria ? 'font-semibold text-peligro' : 'text-texto-2')}>{bateria(equipo.bateriaPct)}</span>
        </span>
        {equipo.cargando && <span className="block text-[11px] text-movimiento">Cargando</span>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className={cn('cifras', appVieja ? 'font-semibold text-sin-senal' : 'text-texto-2')}
          title={appVieja ? `Desactualizada: la más reciente en la flota es ${versionMasNueva}` : undefined}
        >
          {equipo.versionApp ?? GUION}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5">
          <Link
            to={`/replay${consulta({ dispositivo: equipo.idPublico, desde: hoy, hasta: hoy })}`}
            title="Repetición de ruta de hoy"
            aria-label={`Repetición de ruta de hoy de ${equipo.nombre}`}
            className="grid size-7 place-items-center rounded-control text-texto-2 transition-colors hover:bg-fondo hover:text-marca"
          >
            <Route className="size-4" />
          </Link>
          <Link
            to={`/unidad/${equipo.idPublico}`}
            title="Expediente"
            aria-label={`Expediente de ${equipo.nombre}`}
            className="grid size-7 place-items-center rounded-control text-texto-2 transition-colors hover:bg-fondo hover:text-marca"
          >
            <FileText className="size-4" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function ListaEsqueleto({ filas = 3 }: { filas?: number }) {
  return (
    <div className="space-y-3 px-4 pt-1 pb-4" aria-hidden="true">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Esqueleto className="size-2 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Esqueleto className="h-3 w-1/2" />
            <Esqueleto className="h-2.5 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Esqueleto de toda la página mientras llega la flota: la misma forma que el
// tablero, sin saltos al cargar.
function InicioEsqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando inicio">
      <Tarjeta className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Esqueleto className="h-2.5 w-24" />
            <Esqueleto className="h-6 w-14" />
            <Esqueleto className="h-2.5 w-28" />
          </div>
        ))}
      </Tarjeta>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Tarjeta className="space-y-3 p-4">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Esqueleto className="size-8 rounded-full" />
              <Esqueleto className="h-3 w-32" />
              <Esqueleto className="ml-auto h-3 w-48" />
            </div>
          ))}
        </Tarjeta>
        <Tarjeta>
          <ListaEsqueleto filas={5} />
        </Tarjeta>
      </div>
    </div>
  );
}

// Quién está en jornada ahora y desde cuándo. Es la cifra que manda.

// Resumen del día en una sola franja: quién trabaja ahora y qué pasó hoy.
function Resumen({
  personas,
  total,
  jornadas,
  hoy,
  eventos,
  alVerTodas,
}: {
  personas: Dispositivo[];
  total: number;
  jornadas: Map<string, { inicioEn: string; finEn: string | null }>;
  hoy: string;
  eventos: RespuestaEventos | null;
  alVerTodas: () => void;
}) {
  const enRuta = personas.filter((p) => claveEstado(p) === 'enLinea').length;
  const detenidas = personas.filter((p) => claveEstado(p) === 'detenido').length;
  const sinSenal = personas.length - enRuta - detenidas;
  const primera = personas
    .map((p) => jornadas.get(p.idPublico)?.inicioEn)
    .filter((v): v is string => Boolean(v) && fechaLocal(v!) === hoy)
    .sort()[0];
  const cifra = (n: number | undefined) => (eventos == null ? GUION : (n ?? 0));
  const alertas = eventos?.conteo.alerta ?? 0;
  return (
    <Tarjeta className="flex flex-none flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
      <button type="button" onClick={alVerTodas} className="cursor-pointer text-left">
        <span className="block text-[13px] text-texto-2">En jornada</span>
        <span className="text-[26px] leading-tight font-semibold text-marino-900 cifras">
          {personas.length} <span className="text-[15px] font-normal text-texto-3">de {total}</span>
        </span>
      </button>
      <p className="text-[13px] leading-relaxed text-texto-2">
        {enRuta} en ruta, {detenidas} {detenidas === 1 ? 'detenida' : 'detenidas'}, {sinSenal} sin señal
        <br />
        Primera entrada: {primera ? hora(primera) : GUION}
      </p>
      <dl className="ml-auto flex gap-6 text-[13px]">
        <div>
          <dt className="text-texto-2">Inicios</dt>
          <dd className="text-[18px] font-semibold text-marino-900 cifras">{cifra(eventos?.conteo.inicio_jornada)}</dd>
        </div>
        <div>
          <dt className="text-texto-2">Cierres</dt>
          <dd className="text-[18px] font-semibold text-marino-900 cifras">{cifra(eventos?.conteo.fin_jornada)}</dd>
        </div>
        <div>
          <dt className="text-texto-2">Actividades</dt>
          <dd className="text-[18px] font-semibold text-marino-900 cifras">{cifra(eventos?.conteo.actividad)}</dd>
        </div>
        <div>
          <dt className="text-texto-2">Alertas</dt>
          <dd className={cn('text-[18px] font-semibold cifras', alertas > 0 ? 'text-peligro' : 'text-marino-900')}>{cifra(eventos?.conteo.alerta)}</dd>
        </div>
      </dl>
    </Tarjeta>
  );
}

// Lo que hay que revisar: lista compacta con su propio desplazamiento.
function ParaRevisar({ revisar }: { revisar: Revision[] }) {
  const urgentes = revisar.filter((r) => r.grave).length;
  return (
    <Tarjeta className="flex max-h-[240px] flex-none flex-col overflow-hidden">
      <div className="flex flex-none items-baseline justify-between px-4 pt-3 pb-1.5">
        <h2 className="text-[15px] font-semibold">Para revisar</h2>
        <span className={cn('text-[12px] font-semibold cifras', urgentes > 0 ? 'text-peligro' : 'text-texto-3')}>
          {revisar.length}
          {urgentes > 0 ? ` (${urgentes} ${urgentes === 1 ? 'urgente' : 'urgentes'})` : ''}
        </span>
      </div>
      {revisar.length === 0 ? (
        <p className="px-4 pb-3 text-[12.5px] text-texto-2">Nada pendiente: todos reportan y con batería.</p>
      ) : (
        <ul className="inicio-lista min-h-0 flex-1 divide-y divide-borde/70">
          {revisar.map(({ equipo, motivos, grave }) => (
            <li key={equipo.id}>
              <Link to={`/unidad/${equipo.idPublico}`} className="flex items-start gap-2 px-4 py-1.5 transition-colors hover:bg-fondo">
                <span className={cn('mt-1.5 size-1.5 flex-none rounded-full', grave ? 'bg-peligro' : 'bg-sin-senal')} />
                <span className="min-w-0 flex-1 truncate text-[13px] leading-snug">
                  <b className="font-semibold text-marino-900">{equipo.nombre}</b>
                  <span className="text-texto-2">: {motivos.join(', ')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

// Línea de tiempo del día, lo más reciente arriba; cada evento con su color.
function LineaDeTiempo({ eventos }: { eventos: RespuestaEventos | null }) {
  return (
    <Tarjeta className="flex min-w-0 flex-col overflow-hidden lg:min-h-0">
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
        <h2 className="text-[15px] font-semibold">Lo último de hoy</h2>
        <Link to="/reportes" className="text-[12px] font-medium text-texto-2 hover:text-marca">
          Cronograma
        </Link>
      </div>
      {eventos == null ? (
        <ListaEsqueleto filas={4} />
      ) : eventos.datos.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px] text-texto-2">Todavía no hay eventos hoy.</p>
      ) : (
        <ol className="inicio-lista relative min-h-0 flex-1 pb-2 before:absolute before:top-1 before:bottom-3 before:left-[68px] before:w-px before:bg-borde">
          {eventos.datos.slice(0, 80).map((e, i) => (
            <li key={`${e.en}-${e.dispositivoId}-${i}`} className="relative flex items-start gap-3 px-4 py-1.5">
              <span className="w-10 flex-none pt-px text-right text-[12px] font-semibold text-marino-900 cifras">{hora(e.en)}</span>
              <span className={cn('relative z-[1] mt-1.5 size-2 flex-none rounded-full ring-2 ring-superficie', COLOR_EVENTO[e.categoria])} />
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block truncate text-[13px] text-marino-900">
                  <b className="font-semibold">{e.nombre}</b>: {e.texto.toLowerCase()}
                </span>
                {e.detalle && <span className="block truncate text-[11.5px] text-texto-3">{e.detalle}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Tarjeta>
  );
}
