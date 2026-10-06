export type EstadoDispositivo =
  | "EN_LINEA"
  | "DETENIDO"
  | "SENAL_DEBIL"
  | "SIN_SENAL"
  | "DESHABILITADO"
  | "DESCONOCIDO";

export type ValorConfiguracionDispositivo = string | number | boolean;

export interface Dispositivo {
  id: number;
  idPublico: string;
  nombre: string;
  identificadorUnico: string;
  habilitado: boolean;
  estado: EstadoDispositivo;
  ultimaConexion: string | null;
  versionApp: string | null;
  /** `ios` usa Traccar Client (sin app propia: sin versión ni cronograma). */
  plataforma: "android" | "ios";
  jornadaActiva: boolean;
  /** Grupo de la persona asignada (null si no tiene grupo). */
  departamento: string | null;
  bateriaPct: number | null;
  cargando: boolean | null;
  pendientes: number | null;
  /**
   * Whitelist `mobile.*` de configuración del equipo. Solo los
   * administradores la reciben; el resto recibe `null`.
   */
  configuracion: Record<string, ValorConfiguracionDispositivo> | null;
}

/** Claves aceptadas por PUT /api/v1/fleet/{id}. */
export const CLAVES_CONFIGURABLES = [
  "mobile.intervalSeconds",
  "mobile.minIntervalSeconds",
  "mobile.distanceMeters",
  "mobile.angleDegrees",
  "mobile.accuracy",
  "mobile.bufferEnabled",
  "mobile.bufferMax",
  "mobile.bufferPolicy",
  "mobile.ackTimeoutSeconds",
  "mobile.maxRetries",
] as const;

export type ClaveConfigurable = (typeof CLAVES_CONFIGURABLES)[number];

/** Cuerpo de PUT /api/v1/fleet/{id} (administrador o equipo asignado). */
export interface ActualizacionDispositivo {
  nombre?: string;
  /** Hace merge en los atributos; nunca pisa claves fuera de la whitelist. */
  configuracion?: Partial<Record<ClaveConfigurable, ValorConfiguracionDispositivo>>;
}

export interface RespuestaDispositivo {
  dispositivo: Dispositivo;
}
