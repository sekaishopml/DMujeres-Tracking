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
  simulada?: boolean;
  /** WALKING, IN_VEHICLE, STILL... según el reconocimiento de actividad del teléfono. */
  actividad?: string | null;
  /** Pasos acumulados de la jornada al capturar el punto. */
  pasos?: number | null;
}

export interface PosicionesVivas {
  datos: Posicion[];
  generadoEn: string;
  intervaloRefrescoSegundos: number;
}

export interface FiltroPosiciones extends Rango {
  dispositivoId?: string;
}
