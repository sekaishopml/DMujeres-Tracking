import type { LugarOficina } from './dia';

export interface OficinaActiva {
  lugar: LugarOficina | null;
  nombre: string;
  detectada: boolean;
}

// Por ahora no hay oficina definida: el día no habla de casa ni de oficina.
const SIN_OFICINA: OficinaActiva = { lugar: null, nombre: 'Oficina', detectada: false };

export function useOficina(): OficinaActiva {
  return SIN_OFICINA;
}
