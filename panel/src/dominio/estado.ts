// El DTO entrega estados en MAYÚSCULAS (EN_LINEA, SIN_SENAL...) mientras que
// util/formato.ts nombra etiquetas, colores y clases CSS en camelCase.
// Traducir en un solo sitio evita que cada página repita el mapa y se
// desincronice cuando el contrato gane estados nuevos.
import type { Dispositivo } from '@contratos';
import { COLOR_ESTADO, ETIQUETA_ESTADO } from './formatoBase';

const CLAVE_POR_ESTADO: Record<string, string> = {
  EN_LINEA: 'enLinea',
  DETENIDO: 'detenido',
  SIN_SENAL: 'sinSenal',
  SENAL_DEBIL: 'senalDebil',
  DESHABILITADO: 'deshabilitado',
  DESCONOCIDO: 'desconocido',
};

export type EstadoOperativo = Pick<Dispositivo, 'estado' | 'habilitado'>;

export function claveEstado(dispositivo: EstadoOperativo): string {
  // Un equipo deshabilitado no trabaja aunque figure conectado.
  if (!dispositivo.habilitado) return 'deshabilitado';
  return CLAVE_POR_ESTADO[dispositivo.estado] ?? 'desconocido';
}

export function etiquetaEstado(dispositivo: EstadoOperativo): string {
  return ETIQUETA_ESTADO[claveEstado(dispositivo)] ?? 'Sin estado';
}

export function colorEstado(dispositivo: EstadoOperativo): string {
  return COLOR_ESTADO[claveEstado(dispositivo)] ?? COLOR_ESTADO.deshabilitado;
}

// Prioridad de lista: primero lo que exige atención de la operadora
// (sin señal, estado desconocido, detenido) y al final lo que fluye.
const PRIORIDAD: Record<string, number> = {
  sinSenal: 0,
  desconocido: 1,
  detenido: 2,
  enLinea: 3,
  deshabilitado: 4,
};

export function prioridadEstado(dispositivo: EstadoOperativo): number {
  return PRIORIDAD[claveEstado(dispositivo)] ?? 9;
}
