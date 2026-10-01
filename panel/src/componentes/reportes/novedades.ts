import { api } from '@/lib/api';

// Avisos del cronograma: actividades cargadas o editadas en la app después de
// la última vez que esta cuenta abrió el cronograma de cada persona. El menú
// muestra el total en "Reportes" y la lista de personas un círculo con las
// nuevas de cada una. Abrir el cronograma de una persona la marca como vista.

export interface NovedadPersona {
  dispositivoId: string;
  nombre: string;
  nuevas: number;
  ultimaEn: string;
}

export interface NovedadesCronograma {
  total: number;
  personas: NovedadPersona[];
}

export const CLAVE_NOVEDADES_CRONOGRAMA = ['cronograma', 'novedades'] as const;
export const REFRESCO_NOVEDADES_MS = 60_000;

export function traerNovedadesCronograma(): Promise<NovedadesCronograma> {
  return api.get<NovedadesCronograma>('/api/v1/cronograma/novedades');
}

export function marcarCronogramaVisto(dispositivoId: string): Promise<unknown> {
  return api.post('/api/v1/cronograma/visto', { dispositivoId });
}
