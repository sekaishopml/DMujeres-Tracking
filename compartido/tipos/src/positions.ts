import type { Rango } from "./common";

export interface Posicion {
  id: number;
  dispositivoId: number;
  latitud: number;
  longitud: number;
  altitudM: number | null;
  velocidadKmh: number | null;
  rumboGrados: number | null;
  precisionM: number | null;
  bateriaPct: number | null;
  registradoEn: string;
  recibidoEn: string;
  valida: boolean;
}

export interface PosicionesVivas {
  datos: Posicion[];
  generadoEn: string;
  intervaloRefrescoSegundos: number;
}

export interface FiltroPosiciones extends Rango {
  dispositivoId?: string;
}
