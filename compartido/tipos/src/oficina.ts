// GET/PUT/DELETE /api/v1/oficina: el lugar de trabajo común del equipo.

export interface Oficina {
  nombre: string;
  latitud: number;
  longitud: number;
  /** Radio dentro del cual una parada cuenta como estar en la oficina. */
  radioM: number;
}

/** Lugar donde más personas distintas se detuvieron en 30 días. */
export interface OficinaSugerida {
  latitud: number;
  longitud: number;
  radioM: number;
  personas: number;
  dias: number;
}

export interface RespuestaOficina {
  /** La fijada por un administrador. */
  oficina: Oficina | null;
  /** Solo viene cuando no hay una fijada. */
  sugerida: OficinaSugerida | null;
}
