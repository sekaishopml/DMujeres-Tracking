import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { EntradaHistorial, Geocerca, Punto, TipoGeocerca, VisitasGeocerca } from '@/componentes/geocercas/logica';

const CLAVE = ['geocercas'] as const;

export function useGeocercas(todas = false) {
  return useQuery({
    queryKey: [...CLAVE, todas ? 'todas' : 'activas'],
    queryFn: () => api.get<{ datos: Geocerca[] }>(`/api/v1/geocercas${todas ? '?todas=1' : ''}`),
    staleTime: 30_000,
  });
}

export function useHistorialGeocerca(id: number | null) {
  return useQuery({
    queryKey: [...CLAVE, 'historial', id],
    queryFn: () => api.get<{ datos: EntradaHistorial[] }>(`/api/v1/geocercas/${id}/historial`),
    enabled: id != null,
  });
}

export function useVisitasGeocercas(dispositivoId: string, desde: string, hasta: string, activo: boolean) {
  return useQuery({
    queryKey: [...CLAVE, 'visitas', dispositivoId, desde, hasta],
    queryFn: () =>
      api.get<{ datos: VisitasGeocerca[] }>(
        `/api/v1/geocercas/visitas?dispositivoId=${encodeURIComponent(dispositivoId)}&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
      ),
    enabled: activo && dispositivoId !== '',
    retry: false,
    staleTime: 60_000,
  });
}

export interface CambiosGeocerca {
  nombre?: string;
  tipo?: TipoGeocerca;
  puntos?: Punto[];
  activo?: boolean;
  quien: string;
}

// Crea (sin id) o edita (con id); en ambos casos refresca listas e historiales.
export function useGuardarGeocerca() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cambios }: { id?: number; cambios: CambiosGeocerca & { nombre?: string } }) =>
      id == null
        ? api.post<{ geocerca: Geocerca }>('/api/v1/geocercas', cambios)
        : api.patch<{ geocerca: Geocerca }>(`/api/v1/geocercas/${id}`, cambios),
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE }),
  });
}

// El último nombre usado en "Quién editó" se recuerda en este navegador.
const CLAVE_QUIEN = 'dmj-geocercas-quien';
export function quienGuardado(): string {
  try {
    return localStorage.getItem(CLAVE_QUIEN) ?? '';
  } catch {
    return '';
  }
}
export function recordarQuien(nombre: string): void {
  try {
    localStorage.setItem(CLAVE_QUIEN, nombre.trim());
  } catch {
    /* sin almacenamiento: se vuelve a escribir la próxima vez */
  }
}
