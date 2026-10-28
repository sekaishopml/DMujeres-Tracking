// El DTO entrega estados en MAYÚSCULAS (EN_LINEA, SIN_SENAL...) mientras que
// util/formato.ts nombra etiquetas, colores y clases CSS en camelCase.
// Traducir en un solo sitio evita que cada página repita el mapa y se
// desincronice cuando el contrato gane estados nuevos.
import type { Dispositivo } from '@contratos';
import { COLOR_ESTADO, ETIQUETA_ESTADO, ETIQUETA_ESTADO_IPHONE } from './formatoBase';

const CLAVE_POR_ESTADO: Record<string, string> = {
  EN_LINEA: 'enLinea',
  DETENIDO: 'detenido',
  SIN_SENAL: 'sinSenal',
  SENAL_DEBIL: 'senalDebil',
  DESHABILITADO: 'deshabilitado',
  DESCONOCIDO: 'desconocido',
};

export type EstadoOperativo = Pick<Dispositivo, 'estado' | 'habilitado'> &
  Partial<Pick<Dispositivo, 'plataforma' | 'alertaActiva'>>;

export function claveEstado(dispositivo: EstadoOperativo): string {
  // Un equipo deshabilitado no trabaja aunque figure conectado.
  if (!dispositivo.habilitado) return 'deshabilitado';
  return CLAVE_POR_ESTADO[dispositivo.estado] ?? 'desconocido';
}

export function etiquetaEstado(dispositivo: EstadoOperativo): string {
  const etiquetas = dispositivo.plataforma === 'ios' ? ETIQUETA_ESTADO_IPHONE : ETIQUETA_ESTADO;
  return etiquetas[claveEstado(dispositivo)] ?? 'Sin estado';
}

export function colorEstado(dispositivo: EstadoOperativo): string {
  return COLOR_ESTADO[claveEstado(dispositivo)] ?? COLOR_ESTADO.deshabilitado;
}

/** Clave de color: la alerta en jornada manda sobre el estado (se ve en rojo). */
export function claveVisual(dispositivo: EstadoOperativo): string {
  return dispositivo.alertaActiva ? 'alerta' : claveEstado(dispositivo);
}

export function colorEquipo(dispositivo: EstadoOperativo): string {
  return COLOR_ESTADO[claveVisual(dispositivo)] ?? COLOR_ESTADO.deshabilitado;
}

