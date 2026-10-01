import { GUION } from './formatoBase';

// Funciones de formato que no están en formatoBase.ts. Si falta el dato
// devuelven GUION; nunca inventan valores.

export function coordenadas(lat?: number | null, lon?: number | null): string {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return GUION;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function metros(valor?: number | null): string {
  return valor == null || !Number.isFinite(valor) ? GUION : `${Math.round(valor)} m`;
}

export function grados(valor?: number | null): string {
  return valor == null || !Number.isFinite(valor) ? GUION : `${Math.round(valor)}°`;
}

export function entero(valor?: number | null): string {
  return valor == null || !Number.isFinite(valor) ? GUION : String(Math.trunc(valor));
}

export function siNo(valor?: boolean | null): string {
  if (valor == null) return GUION;
  return valor ? 'Sí' : 'No';
}
