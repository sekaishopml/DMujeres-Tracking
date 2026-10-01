// Cliente de la API /api/v1, sin dependencias. La sesión va en una cookie
// HttpOnly: el navegador no ve credenciales. Un 401 lleva al inicio de sesión;
// las consultas de fondo no redirigen, solo quedan con error.

export interface ErrorApi {
  codigo: string;
  mensaje: string;
}

export interface OpcionesPeticion {
  // En false, un 401 no lleva al inicio de sesión. Es para las consultas de
  // fondo: si no, la sesión vencida echaría a la persona sin aviso y la
  // página se recargaría en cada vuelta.
  redirigir401?: boolean;
}

// Navegación SPA al login que registra el marco (Disposicion) con useNavigate.
// Sin manejador se conserva el reemplazo completo como respaldo.
let manejadorNoAutorizado: (() => void) | null = null;

export function alNoAutorizado(manejador: (() => void) | null): void {
  manejadorNoAutorizado = manejador;
}

export class ApiError extends Error {
  codigo: string;
  estado: number;

  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, opciones: OpcionesPeticion = {}): Promise<T> {
  const res = await fetch(ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!res.ok) {
    const error: ErrorApi = datos?.error ?? { codigo: 'ERROR_INTERNO', mensaje: `No se pudo completar la operación (código ${res.status}).` };
    if (res.status === 401 && !ruta.endsWith('/auth/login') && !ruta.endsWith('/auth/me')) {
      if (opciones.redirigir401 !== false) {
        if (manejadorNoAutorizado) manejadorNoAutorizado();
        else window.location.href = '/login';
      }
    }
    throw new ApiError(res.status, error.codigo, error.mensaje);
  }
  return datos as T;
}

export const api = {
  get: <T>(ruta: string, opciones?: OpcionesPeticion) => pedir<T>('GET', ruta, undefined, opciones),
  post: <T>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion) => pedir<T>('POST', ruta, cuerpo, opciones),
  put: <T>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion) => pedir<T>('PUT', ruta, cuerpo, opciones),
  patch: <T>(ruta: string, cuerpo?: unknown, opciones?: OpcionesPeticion) =>
    pedir<T>('PATCH', ruta, cuerpo, opciones),
  borrar: <T>(ruta: string, opciones?: OpcionesPeticion) => pedir<T>('DELETE', ruta, undefined, opciones),
};

// Construye querystrings solo con parámetros definidos.
export function consulta(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== '') {
      q.set(clave, String(valor));
    }
  }
  const texto = q.toString();
  return texto ? `?${texto}` : '';
}
