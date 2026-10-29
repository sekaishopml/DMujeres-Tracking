import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, consulta } from '@/lib/api';
import { sumarDias } from '@/dominio/rango';

// Cronograma de actividades que cada persona carga en la app. `enHora` es lo
// que muestra el recorrido a la hora declarada; `registro`, cuándo y (con
// jornada iniciada) dónde se cargó.

export type TipoActividad = 'visita' | 'almuerzo' | 'permiso_medico' | 'vacaciones' | 'permiso' | 'novedad';

export interface Actividad {
  id: string;
  dispositivoId: string;
  nombre: string;
  fecha: string;
  hora: string;
  // Hora de fin; null en las actividades viejas.
  horaFin?: string | null;
  tipo: TipoActividad;
  lugar: string | null;
  nota: string | null;
  registro: {
    en: string;
    conJornada: boolean;
    latitud: number | null;
    longitud: number | null;
    direccion: string | null;
  };
  enHora: {
    latitud: number;
    longitud: number;
    desfaseMin: number;
    detenida: boolean;
    paradaDesde: string | null;
    paradaHasta: string | null;
    // Con rango declarado: qué parte del horario cubre esa parada (0–100).
    coberturaPct?: number | null;
    direccion: string | null;
  } | null;
  // Cliente de la lista, si se eligió uno.
  cliente?: { id: number; nombre: string; direccion: string | null; lat: number | null; lon: number | null } | null;
  // Lo que dice el recorrido a esa hora (no importa cuándo se cargó).
  respaldo?: { estado: EstadoRespaldo; distanciaM: number | null };
}

export type EstadoRespaldo = 'GPS' | 'LEJOS' | 'EN_CAMINO' | 'SIN_RECORRIDO' | 'NO_APLICA';

export const TIPOS: Record<TipoActividad, { etiqueta: string; clase: string }> = {
  visita: { etiqueta: 'Visita', clase: 'bg-marino-100 text-marino-800' },
  almuerzo: { etiqueta: 'Almuerzo', clase: 'bg-sin-senal-suave text-sin-senal' },
  permiso_medico: { etiqueta: 'Permiso médico', clase: 'bg-peligro-suave text-peligro' },
  vacaciones: { etiqueta: 'Vacaciones', clase: 'bg-movimiento-suave text-movimiento' },
  permiso: { etiqueta: 'Permiso', clase: 'bg-detenido-suave text-detenido' },
  novedad: { etiqueta: 'Novedad', clase: 'bg-marca-suave text-marca' },
};

// Jornada de un día: cómo empezó y cómo terminó (con la nota si se cerró en
// horario laboral). Las versiones viejas de la app no mandan el cómo.
export interface JornadaDia {
  dispositivoId: string;
  fecha: string;
  inicio: string;
  fin: string | null;
  abierta: boolean;
  comoInicio: 'manual' | 'actividad' | 'cronograma' | 'medianoche' | null;
  comoFin: 'manual' | 'medianoche' | 'sesion' | 'sinDatos' | null;
  notaFin: string | null;
}

const COMO_INICIO: Record<string, string> = {
  manual: 'A mano',
  actividad: 'Al iniciar una actividad',
  cronograma: 'Automática por el cronograma',
  medianoche: 'Seguía abierta del día anterior',
};
const COMO_FIN: Record<string, string> = {
  manual: 'A mano',
  medianoche: 'No la cerró (corte de medianoche)',
  sesion: 'Al cerrar la sesión',
  sinDatos: 'La cerró el servidor (sin datos)',
};

const horaLocal = (iso: string) =>
  new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

// Sin el dato, el corte de medianoche se reconoce por la hora (00:00 / 23:59).
export function comoInicio(j: JornadaDia): string | null {
  const como = j.comoInicio ?? (horaLocal(j.inicio) === '00:00' ? 'medianoche' : null);
  return como ? COMO_INICIO[como] : null;
}

export function comoFin(j: JornadaDia): string | null {
  if (j.abierta) return 'En curso';
  const como = j.comoFin ?? (j.fin && horaLocal(j.fin) === '23:59' ? 'medianoche' : null);
  return como ? COMO_FIN[como] : null;
}

export async function traerCronograma(desde: string, hasta: string, dispositivoId?: string) {
  return api.get<{ desde: string; hasta: string; datos: Actividad[]; jornadas?: JornadaDia[] }>(
    `/api/v1/cronograma${consulta({ desde, hasta, dispositivoId: dispositivoId || undefined })}`,
  );
}

// Semana de lunes a domingo que contiene la fecha (YYYY-MM-DD).
export function lunesDe(fecha: string): string {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

export function diasDeSemana(lunes: string): string[] {
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

export function primeroDeMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

export function ultimoDeMes(fecha: string): string {
  const [a, m] = fecha.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${fecha.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`;
}

export function sumarMeses(fecha: string, meses: number): string {
  const [a, m] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + meses, 1));
  return d.toISOString().slice(0, 10);
}

const NOMBRE_DIA = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
const NOMBRE_MES = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', month: 'long', year: 'numeric' });
export const etiquetaDia = (f: string) => NOMBRE_DIA.format(new Date(`${f}T12:00:00Z`));
export const etiquetaMes = (f: string) => NOMBRE_MES.format(new Date(`${f}T12:00:00Z`));

// Lo que explica una ausencia (vacaciones, permisos) o pide revisar (novedad),
// cargado para hoy: la de más peso por persona (clave idPublico). Inicio y
// Seguimiento comparten la consulta del cronograma de hoy.
export const PESO_AUSENCIA: Partial<Record<TipoActividad, number>> = { novedad: 1, permiso: 2, permiso_medico: 3, vacaciones: 4 };

export function useAusenciasDeHoy(hoy: string, refrescoMs: number) {
  const actividades = useQuery({
    queryKey: ['inicio', 'cronograma', hoy],
    queryFn: () => traerCronograma(hoy, hoy),
    refetchInterval: () => (document.hidden ? false : refrescoMs),
    retry: false,
  });
  const ausencias = useMemo(() => {
    const mapa = new Map<string, Actividad>();
    for (const a of actividades.data?.datos ?? []) {
      const peso = PESO_AUSENCIA[a.tipo];
      const previa = mapa.get(a.dispositivoId);
      if (peso && (!previa || peso > (PESO_AUSENCIA[previa.tipo] ?? 0))) mapa.set(a.dispositivoId, a);
    }
    return mapa;
  }, [actividades.data]);
  return { actividades, ausencias };
}
