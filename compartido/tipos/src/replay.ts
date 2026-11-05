import type { Dispositivo } from "./fleet";
import type { Posicion } from "./positions";

// Por qué no hay puntos: SIN_SENAL (la app seguía viva sin posición),
// GPS_APAGADO, SIN_PERMISO, APAGADO (teléfono), SIN_CONTACTO (app detenida o
// sin datos móviles) o FUERA_DE_JORNADA (entre dos jornadas).
export type MotivoHueco =
  | "SIN_SENAL"
  | "SIN_DATOS"
  | "PAUSA"
  | "APAGADO"
  | "REINICIO_SIN_APP"
  | "GPS_APAGADO"
  | "SIN_PERMISO"
  | "SIN_CONTACTO"
  | "FUERA_DE_JORNADA";

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
  /** Pasos que contó el teléfono en las jornadas del recorrido; null si no hay dato. */
  pasos?: number | null;
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
  /** Ubicaciones de wifi o antenas (más de 30 m) entre puntos precisos. */
  descartadasImprecisas?: number;
  /** Idas y vueltas del GPS en segundos que no cuadran con su velocidad. */
  descartadasExcursion?: number;
  posibleOrigenMultiple: boolean;
}

/** Algo que la persona hizo en el teléfono durante el recorrido (GPS, permisos, notificaciones). */
export interface AvisoTelefono {
  tipo: string;
  texto: string;
  categoria: 'alerta' | 'recuperacion';
  en: string;
}

export interface Replay {
  dispositivo: Dispositivo;
  desde: string;
  hasta: string;
  posiciones: Posicion[];
  huecos: Hueco[];
  avisos?: AvisoTelefono[];
  reconstruidos: TramoReconstruido[];
  resumen: ReplayResumen;
  calidad?: ReplayCalidad;
  /** Cómo terminó cada jornada del recorrido (último punto de cada una). */
  cierres?: CierreJornada[];
  generadoEn: string;
}

export type MotivoCierre =
  | 'JORNADA_FINALIZADA'
  | 'MEDIANOCHE'
  | 'GPS_APAGADO'
  | 'TELEFONO_APAGADO'
  | 'PERMISO_QUITADO'
  | 'REINICIO'
  | 'SIN_SENAL';

export interface CierreJornada {
  /** registradoEn del último punto de la jornada. */
  en: string;
  motivo: MotivoCierre;
  /** Hora del hecho (fin de jornada, GPS apagado, etc.). */
  hora: string;
  /** El GPS se apagó porque el ahorro de batería del sistema estaba activo. */
  ahorro?: boolean;
}

export interface ReplayDisponible {
  dispositivoId: number;
  idPublico: string;
  nombre: string;
  desde: string;
  hasta: string;
  totalPosiciones: number;
}
