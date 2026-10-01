import type { Rango } from "./common";

export interface MuestraBateria {
  registradoEn: string;
  bateriaPct: number | null;
  cargando: boolean | null;
}

export interface Bateria {
  dispositivoId: number;
  actual: number | null;
  cargando: boolean | null;
  muestras: MuestraBateria[];
}

export interface BateriaResumen {
  dispositivoId: number;
  idPublico: string;
  nombre: string;
  actual: number | null;
  cargando: boolean | null;
  actualizadoEn: string | null;
}

export interface FiltroBateria extends Rango {
  dispositivoId?: string;
}
