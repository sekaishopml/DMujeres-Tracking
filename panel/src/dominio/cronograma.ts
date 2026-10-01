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
}

export const TIPOS: Record<TipoActividad, { etiqueta: string; clase: string }> = {
  visita: { etiqueta: 'Visita', clase: 'bg-marino-100 text-marino-800' },
  almuerzo: { etiqueta: 'Almuerzo', clase: 'bg-sin-senal-suave text-sin-senal' },
  permiso_medico: { etiqueta: 'Permiso médico', clase: 'bg-peligro-suave text-peligro' },
  vacaciones: { etiqueta: 'Vacaciones', clase: 'bg-movimiento-suave text-movimiento' },
  permiso: { etiqueta: 'Permiso', clase: 'bg-detenido-suave text-detenido' },
  novedad: { etiqueta: 'Novedad', clase: 'bg-marca-suave text-marca' },
};

export async function traerCronograma(desde: string, hasta: string, dispositivoId?: string) {
  return api.get<{ desde: string; hasta: string; datos: Actividad[] }>(
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
const DIA_LARGO = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

export const etiquetaDia = (f: string) => NOMBRE_DIA.format(new Date(`${f}T12:00:00Z`));
export const etiquetaMes = (f: string) => NOMBRE_MES.format(new Date(`${f}T12:00:00Z`));
export const etiquetaDiaLargo = (f: string) => DIA_LARGO.format(new Date(`${f}T12:00:00Z`));
