/** Jornada (encendido/apagado) de un equipo, para el replay. */
export interface Jornada {
  id: number;
  /** Instante de encendido/inicio de jornada (ISO-8601). */
  inicioEn: string;
  /** Instante de apagado/fin de jornada; `null` si sigue abierta. */
  finEn: string | null;
  /** Duración en minutos; si está abierta se calcula hasta el momento de la consulta. */
  duracionMin: number;
  abierta: boolean;
  /** iPhone: no es una jornada marcada, es del primer al último punto del día. */
  soloApp?: boolean;
}

/** Respuesta de GET /api/v1/fleet/{id}/journeys. */
export interface RespuestaJornadas {
  jornadas: Jornada[];
  total: number;
}

/** Jornada con la unidad a la que pertenece; alimenta la auditoría de la flota. */
export interface JornadaFlota extends Jornada {
  dispositivoId: number;
  idPublico: string;
  nombre: string;
}

/** Respuesta paginada de GET /api/v1/journeys. */
export interface RespuestaJornadasFlota {
  datos: JornadaFlota[];
  total: number;
  pagina: number;
  tamano: number;
}

export interface FiltroJornadasFlota {
  /** ISO-8601 con zona; se piden junto con `hasta`. */
  desde?: string;
  hasta?: string;
  /** `idPublico` (UUID) o el id numérico anterior. */
  dispositivoId?: string;
}
