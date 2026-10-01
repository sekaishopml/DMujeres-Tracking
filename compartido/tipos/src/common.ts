export type CodigoError =
  | "NO_AUTENTICADO"
  | "SIN_PERMISO"
  | "NO_ENCONTRADO"
  | "DATOS_INVALIDOS"
  | "ERROR_INTERNO"
  | "SERVICIO_NO_DISPONIBLE";

export interface ApiError {
  codigo: CodigoError;
  mensaje: string;
}

export interface ErrorRespuesta {
  error: ApiError;
}

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  tamano: number;
}

export interface Rango {
  desde?: string;
  hasta?: string;
}

export interface ParametrosPaginacion {
  pagina?: number;
  tamano?: number;
  orden?: string;
}

export interface PuntoGeo {
  latitud: number;
  longitud: number;
}

export type Entorno = "desarrollo" | "pruebas" | "produccion";
