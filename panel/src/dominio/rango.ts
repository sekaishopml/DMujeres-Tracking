// El trabajo es en Ecuador continental (UTC-5 todo el año, sin horario de
// verano). "Hoy", "ayer", los rangos que se piden a la API y las horas que se
// muestran se calculan en esa zona y no en la del navegador.
export const ZONA_HORARIA = 'America/Guayaquil';
const DESFASE = '-05:00';

const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' });

// Día (YYYY-MM-DD) de un instante en la zona de la operación.
export function diaDe(instante: string | number | Date): string {
  return DIA.format(new Date(instante));
}

export function fechaHoyLocal(): string {
  return diaDe(Date.now());
}

// Suma días a una fecha YYYY-MM-DD sin pasar por la zona del navegador.
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function fechaHaceDias(dias: number): string {
  return sumarDias(fechaHoyLocal(), -dias);
}

export function fechaAyerLocal(): string {
  return fechaHaceDias(1);
}

export function inicioDeDia(fecha: string): string {
  return new Date(`${fecha}T00:00:00${DESFASE}`).toISOString();
}

export function finDeDia(fecha: string): string {
  return new Date(`${fecha}T23:59:59.999${DESFASE}`).toISOString();
}
