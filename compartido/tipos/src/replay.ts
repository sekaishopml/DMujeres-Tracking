import type { Dispositivo } from "./fleet";
import type { Posicion } from "./positions";

export type MotivoHueco = "SIN_SENAL" | "SIN_DATOS" | "PAUSA" | "APAGADO" | "FUERA_DE_JORNADA";

export interface Hueco {
  desde: string;
  hasta: string;
  duracionSegundos: number;
  motivo: MotivoHueco;
}

/** Cómo se obtuvo el tramo reconstruido: ajustado a vía o estimado A→B. */
export type MetodoReconstruccion = "MATCHED" | "ESTIMATED";

/**
 * Tramo reconstruido por calles entre dos puntos muy separados. MATCHED trae
 * puntos intermedios ajustados a la vía (/match); ESTIMATED es la ruta de A a B
 * (/route). mapaVersion es el SHA-256 del mapa (null si no se sabe). Nunca se
 * muestra como GPS registrado: el panel lo dibuja distinto.
 */
export interface TramoReconstruido {
  desde: string;
  hasta: string;
  metodo: MetodoReconstruccion;
  mapaVersion: string | null;
  trazado: [number, number][];
}

export interface ReplayResumen {
  inicio: string;
  fin: string;
  totalPosiciones: number;
  totalHuecos: number;
  distanciaKm: number;
  duracionMin: number;
  velocidadPromedioKmh: number | null;
  velocidadMaximaKmh: number | null;
  bateriaInicialPct: number | null;
  bateriaFinalPct: number | null;
}

/**
 * Puntos apartados del trazo por imposibles (en la base no cambian): fuera del
 * área de trabajo (emulador) o picos de ida y vuelta a más de 180 km/h.
 * `posibleOrigenMultiple` avisa de saltos largos repetidos: dos teléfonos con
 * la misma cuenta.
 */
export interface ReplayCalidad {
  descartadasFueraDeZona: number;
  descartadasSalto: number;
  posibleOrigenMultiple: boolean;
}

export interface Replay {
  dispositivo: Dispositivo;
  desde: string;
  hasta: string;
  posiciones: Posicion[];
  huecos: Hueco[];
  reconstruidos: TramoReconstruido[];
  resumen: ReplayResumen;
  calidad?: ReplayCalidad;
  generadoEn: string;
}

export interface ReplayDisponible {
  dispositivoId: number;
  idPublico: string;
  nombre: string;
  desde: string;
  hasta: string;
  totalPosiciones: number;
}
