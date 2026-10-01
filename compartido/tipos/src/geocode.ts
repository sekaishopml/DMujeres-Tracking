/** Parámetros de GET /api/v1/geocode/reverse. */
export interface ParametrosGeocodificacion {
  lat: number;
  lon: number;
}

/** Respuesta de GET /api/v1/geocode/reverse. */
export interface RespuestaDireccion {
  /** Dirección corta en español; `null` si no se pudo resolver. */
  direccion: string | null;
}
