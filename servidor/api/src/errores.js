// Errores normalizados del contrato /api/v1.
// Cuerpo: {"error":{"codigo":"...","mensaje":"..."}}.
// El mensaje es legible para el operador y nunca expone SQL, tablas ni trazas.

export class ErrorApi extends Error {
  constructor(codigo, mensaje, estado) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.estado = estado;
    // `responderError` compone el cuerpo del contrato con `mensaje`; sin esta
    // asignación el campo viajaba como undefined y el JSON salía sin él.
    this.mensaje = mensaje;
  }
}

export const noAutenticado = (mensaje = 'La sesión no existe o expiró.') =>
  new ErrorApi('NO_AUTENTICADO', mensaje, 401);

export const sinPermiso = (mensaje = 'La cuenta no tiene permiso sobre el recurso.') =>
  new ErrorApi('SIN_PERMISO', mensaje, 403);

export const noEncontrado = (mensaje = 'El recurso no existe.') =>
  new ErrorApi('NO_ENCONTRADO', mensaje, 404);

export const datosInvalidos = (mensaje = 'Los datos de la petición no son válidos.') =>
  new ErrorApi('DATOS_INVALIDOS', mensaje, 400);

export const conflicto = (mensaje = 'El recurso ya existe.') =>
  new ErrorApi('YA_EXISTE', mensaje, 409);

export const servicioNoDisponible = (mensaje = 'El servicio no está disponible.') =>
  new ErrorApi('SERVICIO_NO_DISPONIBLE', mensaje, 503);

export function esErrorApi(error) {
  return error instanceof ErrorApi;
}

export function responderError(res, error) {
  const estado = esErrorApi(error) ? error.estado : 500;
  const cuerpo = {
    error: {
      codigo: esErrorApi(error) ? error.codigo : 'ERROR_INTERNO',
      mensaje: esErrorApi(error) ? error.mensaje : 'Ocurrió un error interno.',
    },
  };
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(cuerpo));
}
