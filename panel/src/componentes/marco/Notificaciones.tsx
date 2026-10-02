import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BatteryWarning, Bell, CirclePlay, CircleStop, SignalHigh, WifiOff } from 'lucide-react';
import type { Dispositivo } from '@contratos';
import { CLAVE_FLOTA, traerFlota } from '@/dominio/datos';
import { api, consulta } from '@/lib/api';
import { claveEstado } from '@/dominio/estado';
import { hace, hora } from '@/dominio/formatoBase';
import { fechaHoyLocal, finDeDia, inicioDeDia } from '@/dominio/rango';
import { cn } from '@/lib/cn';

// Notificaciones del día, solo lo que la supervisión necesita:
//  - quién empezó y quién terminó la jornada;
//  - a quién se le apagó el teléfono o se quedó sin señal, y por qué: con 5 %
//    de batería o menos se atribuye a la batería; si no, se dice que se apagó
//    o perdió cobertura (la app no avisa de un apagado manual, así que no se
//    afirma);
//  - cuando ese teléfono vuelve a reportar, la MISMA notificación pasa a
//    "Recuperó señal" con la hora, en vez de sumar otra.
// Los cortes y lo leído se guardan en este navegador (localStorage).

type Tipo = 'inicio' | 'fin' | 'corte';

interface Notificacion {
  id: string;
  tipo: Tipo;
  idPublico: string;
  nombre: string;
  instante: string;
  titulo: string;
  detalle: string;
  recuperada?: string | null;
  porBateria?: boolean;
}

interface Corte {
  idPublico: string;
  nombre: string;
  desde: string;
  bateria: number | null;
  recuperada: string | null;
}

const CLAVE_CORTES = 'dmj.panel.cortes';
const CLAVE_LEIDO = 'dmj.panel.avisosLeidos';
const BATERIA_AGOTADA_PCT = 5;

function leer<T>(clave: string, porDefecto: T): T {
  try {
    const texto = localStorage.getItem(clave);
    return texto ? (JSON.parse(texto) as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function guardar(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento: la notificación vive hasta recargar.
  }
}

const ms = (iso: string) => new Date(iso).getTime();

// Actualiza el registro de cortes con el estado actual de la flota: abre un
// corte cuando un equipo en jornada queda sin señal y lo cierra cuando vuelve.
function actualizarCortes(previos: Corte[], equipos: Dispositivo[]): Corte[] {
  const hoy = inicioDeDia(fechaHoyLocal());
  const lista = previos.filter((c) => c.desde >= hoy);
  for (const equipo of equipos) {
    if (!equipo.habilitado) continue;
    const abierto = lista.find((c) => c.idPublico === equipo.idPublico && c.recuperada == null);
    const sinSenal = claveEstado(equipo) === 'sinSenal' && equipo.jornadaActiva;
    if (sinSenal && !abierto && equipo.ultimaConexion) {
      if (!lista.some((c) => c.idPublico === equipo.idPublico && c.desde === equipo.ultimaConexion)) {
        lista.push({
          idPublico: equipo.idPublico,
          nombre: equipo.nombre,
          desde: equipo.ultimaConexion,
          bateria: equipo.bateriaPct ?? null,
          recuperada: null,
        });
      }
    } else if (!sinSenal && abierto && equipo.ultimaConexion && ms(equipo.ultimaConexion) > ms(abierto.desde)) {
      abierto.recuperada = equipo.ultimaConexion;
    }
  }
  return lista.slice(-60);
}

// Eventos de jornada del día (/api/v1/eventos): llegan con la hora exacta en
// que la persona inició o finalizó, aunque la jornada haya empezado otro día.
interface EventoJornada {
  categoria: string;
  en: string;
  dispositivoId: string;
  nombre: string;
}

// La app renueva la jornada cerrándola y abriendo otra en el mismo minuto:
// ese cierre y esa apertura no son hechos de la persona y no se notifican.
const RENOVACION_MS = 2 * 60_000;

function desdeEventos(eventos: EventoJornada[]): Notificacion[] {
  const jornada = eventos.filter((e) => e.categoria === 'inicio_jornada' || e.categoria === 'fin_jornada');
  const esRenovacion = (e: EventoJornada) =>
    jornada.some(
      (o) =>
        o.dispositivoId === e.dispositivoId &&
        o.categoria !== e.categoria &&
        Math.abs(ms(o.en) - ms(e.en)) <= RENOVACION_MS &&
        // fin seguido de inicio, no al revés
        (e.categoria === 'fin_jornada' ? ms(o.en) >= ms(e.en) : ms(o.en) <= ms(e.en)),
    );
  return jornada
    .filter((e) => !esRenovacion(e))
    .map((e) => {
      const inicio = e.categoria === 'inicio_jornada';
      return {
        id: `${inicio ? 'ini' : 'fin'}-${e.dispositivoId}-${e.en}`,
        tipo: inicio ? 'inicio' : 'fin',
        idPublico: e.dispositivoId,
        nombre: e.nombre,
        instante: e.en,
        titulo: inicio ? 'Inició la jornada' : 'Finalizó la jornada',
        detalle: `${inicio ? 'Activó' : 'Desactivó'} el registro a las ${hora(e.en)}`,
      };
    });
}

function desdeCortes(cortes: Corte[]): Notificacion[] {
  return cortes.map((c) => {
    const porBateria = c.bateria != null && c.bateria <= BATERIA_AGOTADA_PCT;
    return {
      id: `corte-${c.idPublico}-${c.desde}`,
      tipo: 'corte',
      idPublico: c.idPublico,
      nombre: c.nombre,
      // Una recuperación reciente vuelve a subir la notificación y cuenta como nueva.
      instante: c.recuperada ?? c.desde,
      titulo: porBateria ? 'Teléfono apagado por batería agotada' : 'Teléfono apagado o sin señal',
      detalle: porBateria
        ? `Último reporte a las ${hora(c.desde)} con ${Math.round(c.bateria ?? 0)} % de batería`
        : `Último reporte a las ${hora(c.desde)}${c.bateria != null ? ` con ${Math.round(c.bateria)} % de batería` : ''}`,
      recuperada: c.recuperada,
      porBateria,
    };
  });
}

const ICONOS: Record<Tipo, typeof Bell> = { inicio: CirclePlay, fin: CircleStop, corte: WifiOff };

export function Notificaciones() {
  const navegar = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [leido, setLeido] = useState(() => leer<number>(CLAVE_LEIDO, 0));
  const [cortes, setCortes] = useState<Corte[]>(() => leer<Corte[]>(CLAVE_CORTES, []));
  const caja = useRef<HTMLDivElement>(null);

  const flota = useQuery({ queryKey: CLAVE_FLOTA, queryFn: () => traerFlota({ redirigir401: false }), refetchInterval: 30_000 });
  const hoy = fechaHoyLocal();
  // Con el canal en vivo abierto se actualiza al instante; esto es el respaldo.
  const eventos = useQuery({
    queryKey: ['notificaciones', 'eventos', hoy],
    queryFn: () =>
      api.get<{ datos: EventoJornada[] }>(`/api/v1/eventos${consulta({ desde: inicioDeDia(hoy), hasta: finDeDia(hoy) })}`, {
        redirigir401: false,
      }),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const equipos = flota.data?.datos;
    if (!equipos) return;
    setCortes((previos) => {
      const siguientes = actualizarCortes(previos.map((c) => ({ ...c })), equipos);
      guardar(CLAVE_CORTES, siguientes);
      return siguientes;
    });
  }, [flota.data]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  const lista = useMemo(
    () =>
      [...desdeEventos(eventos.data?.datos ?? []), ...desdeCortes(cortes)].sort(
        (a, b) => ms(b.instante) - ms(a.instante),
      ),
    [eventos.data, cortes],
  );
  const nuevas = lista.filter((n) => ms(n.instante) > leido).length;

  function alternar() {
    setAbierto((v) => {
      if (!v) {
        // Al abrir, todo lo visible queda leído y el contador desaparece.
        const ahora = Date.now();
        setLeido(ahora);
        guardar(CLAVE_LEIDO, ahora);
      }
      return !v;
    });
  }

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={alternar}
        aria-label={nuevas > 0 ? `Notificaciones, ${nuevas} nuevas` : 'Notificaciones'}
        aria-expanded={abierto}
        title="Notificaciones"
        className={cn(
          'relative grid size-10 cursor-pointer place-items-center rounded-full border border-borde text-texto-2 transition-colors hover:bg-fondo hover:text-marino-900',
          abierto && 'bg-fondo text-marino-900',
        )}
      >
        <Bell className={cn('size-[18px]', nuevas > 0 && 'animate-[campana_1.2s_ease-in-out_1]')} key={nuevas} />
        {nuevas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-[18px] min-w-[18px] overflow-hidden rounded-full bg-marca px-1 text-[10px] leading-[18px] font-bold text-white ring-2 ring-superficie">
            {/* Contador que baja de arriba hacia abajo al cambiar el número. */}
            <span key={nuevas} className="block animate-[contador_380ms_cubic-bezier(0.34,1.4,0.64,1)] text-center">
              {nuevas > 99 ? '99+' : nuevas}
            </span>
          </span>
        )}
      </button>
      {abierto && (
        <div className="absolute top-12 right-0 z-50 w-[min(380px,calc(100vw-32px))] origin-top-right animate-[desplegar_220ms_cubic-bezier(0.16,1,0.3,1)] overflow-hidden rounded-tarjeta border border-borde bg-superficie shadow-flotante">
          <div className="flex items-baseline justify-between border-b border-borde px-4 py-3">
            <p className="font-display text-[14px] font-semibold text-marino-900">Notificaciones</p>
            <p className="text-[11.5px] text-texto-3">Hoy</p>
          </div>
          <ul className="max-h-[420px] overflow-y-auto p-1.5">
            {lista.map((n, i) => {
              const Icono = n.recuperada ? SignalHigh : n.porBateria ? BatteryWarning : ICONOS[n.tipo];
              return (
                <li key={n.id} className="animate-[aparecer_260ms_ease_both]" style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAbierto(false);
                      navegar(`/unidad/${n.idPublico}`);
                    }}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-control px-2.5 py-2.5 text-left transition-colors hover:bg-fondo"
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid size-8 flex-none place-items-center rounded-full',
                        n.tipo === 'inicio' && 'bg-movimiento-suave text-movimiento',
                        n.tipo === 'fin' && 'bg-deshabilitado-suave text-deshabilitado',
                        n.tipo === 'corte' && !n.recuperada && (n.porBateria ? 'bg-peligro-suave text-peligro' : 'bg-sin-senal-suave text-sin-senal'),
                        n.tipo === 'corte' && n.recuperada && 'bg-movimiento-suave text-movimiento',
                      )}
                    >
                      <Icono className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-marino-900">{n.nombre}</span>
                        <span className="flex-none text-[11px] text-texto-3">{hace(n.instante)}</span>
                      </span>
                      <span className="block text-[12.5px] text-texto">{n.titulo}</span>
                      <span className="block text-[11.5px] text-texto-3">{n.detalle}</span>
                      {n.recuperada && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-movimiento-suave px-2 py-0.5 text-[11px] font-semibold text-movimiento">
                          Recuperó señal a las {hora(n.recuperada)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {lista.length === 0 && (
              <li className="px-2 py-10 text-center text-[12.5px] text-texto-3">Sin novedades hoy.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
