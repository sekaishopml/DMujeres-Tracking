export type TipoGeocerca = 'casa' | 'cliente' | 'oficina' | 'cc' | 'pdv' | 'na';
export type AccionGeocerca = 'crear' | 'editar' | 'eliminar' | 'restaurar';

/** Geocerca de GET /api/v1/geocercas. `puntos` son pares [lon, lat], sin repetir el primero al final. */
export interface Geocerca {
  id: number;
  nombre: string;
  tipo: TipoGeocerca;
  puntos: [number, number][];
  centro: { lat: number; lon: number };
  activo: boolean;
  creadoPor: string;
  creadoEn: string;
  editadoPor: string | null;
  actualizadoEn: string;
}

/** Cuerpo de POST /api/v1/geocercas. */
export interface NuevaGeocerca {
  nombre: string;
  tipo: TipoGeocerca;
  puntos: [number, number][];
  quien: string;
}

/** Cuerpo de PATCH /api/v1/geocercas/:id; `quien` es siempre obligatorio. */
export interface CambioGeocerca {
  nombre?: string;
  tipo?: TipoGeocerca;
  puntos?: [number, number][];
  activo?: boolean;
  quien: string;
}

export interface EntradaHistorialGeocerca {
  id: number;
  accion: AccionGeocerca;
  quien: string;
  /** Nombre de la cuenta del panel con sesión; `null` si no hay. */
  usuario: string | null;
  ocurridoEn: string;
  /** Campos que cambiaron: `{ antes, despues }` (en `crear` solo `despues`). */
  cambios: { antes?: Record<string, unknown>; despues?: Record<string, unknown> };
}

export interface VisitaGeocerca {
  /** `null` si no se vio el paso (estaba adentro al empezar el rango). */
  llegada: string | null;
  /** `null` si al terminar el rango la persona seguía adentro. */
  salida: string | null;
  duracionMin: number | null;
}

/** Elemento de GET /api/v1/geocercas/visitas. */
export interface VisitasGeocerca {
  geocercaId: number;
  nombre: string;
  tipo: TipoGeocerca;
  /** La última llegada primero. */
  llegadas: string[];
  /** La primera salida primero. */
  salidas: string[];
  /** En orden de tiempo. */
  visitas: VisitaGeocerca[];
}
