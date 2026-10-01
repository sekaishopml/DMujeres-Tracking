import { ApiError } from '@/lib/api';

// La API siempre manda un mensaje legible; cualquier otro fallo (red, JSON) se
// resume sin mostrar detalles técnicos. ApiError hereda de Error, así que el
// texto va en `message`.
export function mensajeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name === 'AbortError') return 'Se canceló la consulta.';
  return 'No hubo respuesta del servidor. Inténtalo de nuevo en unos momentos.';
}

// Un 404 en replay/posición no es un fallo: significa que no hay datos en la
// ventana pedida, y se muestra como estado vacío.
export function esNoEncontrado(error: unknown): boolean {
  return error instanceof ApiError && error.estado === 404;
}
