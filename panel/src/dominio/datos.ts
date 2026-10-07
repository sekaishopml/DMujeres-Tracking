import type { QueryClient } from '@tanstack/react-query';
import { api, consulta } from '@/lib/api';
import type { OpcionesPeticion } from '@/lib/api';
import type { Bateria, Dispositivo, Pagina, Posicion, PosicionesVivas, Replay, ReporteParada } from '@contratos';
import type { RespuestaJornadasFlota, RespuestaSalud } from '@contratos';
import type {
  EntradaEsquemaAjustes,
  GrupoPlataforma,
  UsuarioPlataforma,
} from '@contratos';

// La flota la consumen Inicio, En vivo, Historial, Replay y Detalle: una sola
// clave de caché mantiene los datos coherentes entre páginas.
export const CLAVE_FLOTA = ['flota'] as const;

// Consultas de revisión (repetición de ruta, paradas, jornadas, reportes):
// traen rangos completos que no cambian. 30 s evita volver a pedirlas al ir y
// venir entre pantallas. Los sondeos de Inicio, En vivo, Detalle y Sistema no
// dependen de esto.
export const CACHE_AUDITORIA_MS = 30_000;

// Defensa en profundidad: el servidor ya omite los equipos dados de baja
// (habilitado=false) en /fleet, pero la caché puede conservar una respuesta
// anterior al dar de baja una cuenta y los endpoints vivos podrían devolver un
// equipo recién deshabilitado. Todo listado, selector o marcador que parta de
// la flota pasa por aquí para que un equipo deshabilitado nunca se muestre.
export function equiposHabilitados(dispositivos: Dispositivo[]): Dispositivo[] {
  return dispositivos.filter((equipo) => equipo.habilitado !== false);
}

// Borra la caché de equipos (CLAVE_FLOTA). Se usa al crear una cuenta con
// equipo, para que el equipo nuevo aparezca enseguida en todo el panel.
export function invalidarFlota(cliente: QueryClient): Promise<void> {
  return cliente.invalidateQueries({ queryKey: CLAVE_FLOTA });
}

export function traerFlota(opciones?: OpcionesPeticion): Promise<Pagina<Dispositivo>> {
  return api.get<Pagina<Dispositivo>>(`/api/v1/fleet${consulta({ tamano: 200 })}`, opciones);
}

export function traerPosicionesVivas(opciones?: OpcionesPeticion): Promise<PosicionesVivas> {
  return api.get<PosicionesVivas>('/api/v1/positions/live', opciones);
}

export function traerDispositivo(id: string, opciones?: OpcionesPeticion): Promise<Dispositivo> {
  return api.get<Dispositivo>(`/api/v1/fleet/${encodeURIComponent(id)}`, opciones);
}

export function traerUltimaPosicion(id: string, opciones?: OpcionesPeticion): Promise<Posicion> {
  return api.get<Posicion>(`/api/v1/fleet/${encodeURIComponent(id)}/position`, opciones);
}

// Respuesta de GET /api/v1/replay/{id}: `reconstruidos` trae los tramos con
// método y versión de mapa; `estimados` es la forma anterior y se acepta
// igual.
export interface RespuestaReplay extends Replay {
  estimados?: { desde: string; hasta: string; trazado: [number, number][] }[];
}

export function traerReplay(id: string, desde: string, hasta: string): Promise<RespuestaReplay> {
  return api.get<RespuestaReplay>(`/api/v1/replay/${encodeURIComponent(id)}${consulta({ desde, hasta })}`);
}

export interface Jornada {
  inicioEn: string;
  // El fin es nulo mientras la jornada sigue abierta; duracionMin también
  // puede faltar en ese caso.
  finEn: string | null;
  duracionMin: number | null;
  abierta: boolean;
}

export interface RespuestaJornadas {
  jornadas: Jornada[];
  total: number;
}

// Jornadas de un equipo en el rango. Si la consulta falla, Repetición de ruta
// lo toma como "sin dato" y el resto de la pantalla sigue.
export function traerJornadas(idPublico: string, desde: string, hasta: string): Promise<RespuestaJornadas> {
  return api.get<RespuestaJornadas>(
    `/api/v1/fleet/${encodeURIComponent(idPublico)}/journeys${consulta({ desde, hasta })}`,
  );
}

// Jornadas de todos los equipos en el rango, para Historial. Total 0 no es
// error: ese día no hubo jornadas.
export function traerJornadasFlota(
  desde: string,
  hasta: string,
  dispositivoId?: string,
  opciones?: OpcionesPeticion,
): Promise<RespuestaJornadasFlota> {
  return traerTodasLasJornadas(desde, hasta, dispositivoId, opciones);
}

// La API devuelve como máximo 200 por página: se piden todas para que las
// cifras de Historial no se corten.
const TAMANO_PAGINA_JORNADAS = 200;
const MAX_PAGINAS_JORNADAS = 50;

async function traerTodasLasJornadas(
  desde: string,
  hasta: string,
  dispositivoId: string | undefined,
  opciones: OpcionesPeticion | undefined,
): Promise<RespuestaJornadasFlota> {
  const pedir = (pagina: number) =>
    api.get<RespuestaJornadasFlota>(
      `/api/v1/journeys${consulta({ desde, hasta, dispositivoId, tamano: TAMANO_PAGINA_JORNADAS, pagina })}`,
      opciones,
    );
  const primera = await pedir(1);
  const datos = [...primera.datos];
  const total = primera.total ?? datos.length;
  for (let pagina = 2; datos.length < total && pagina <= MAX_PAGINAS_JORNADAS; pagina++) {
    const siguiente = await pedir(pagina);
    if (siguiente.datos.length === 0) break;
    datos.push(...siguiente.datos);
  }
  return { ...primera, datos };
}

// Paradas del servidor: segmentación precisa de la plataforma (>= 3 min y por
// debajo de 5 km/h), con dirección resuelta cuando existe. Replay la usa como
// fuente principal y solo cae al helper local si esta consulta falla.
export function traerParadas(idPublico: string, desde: string, hasta: string): Promise<Pagina<ReporteParada>> {
  return api.get<Pagina<ReporteParada>>(
    `/api/v1/reports/stops${consulta({ dispositivoId: idPublico, desde, hasta, tamano: 200 })}`,
  );
}

// Salud por equipo (GET /api/v1/salud): el estado lo calcula el servidor, con
// su causa. Si la ruta no existe, se muestra "sin dato".

// Sondeo de fondo: un 401 aquí no redirige, solo deja el estado de error para
// que la comprobación de sesión decida.
export function traerSalud(): Promise<RespuestaSalud> {
  return api.get<RespuestaSalud>('/api/v1/salud', { redirigir401: false });
}

// --- Usuarios, grupos, roles y ajustes ---
//
// Cada función pide su ruta (/api/v1/usuarios, /api/v1/grupos,
// /api/v1/roles, /api/v1/configuracion/esquema). Si falla, la pantalla
// muestra el error sin afectar al resto del panel. La lista de usuarios se
// acepta como arreglo o como página {datos}.
function comoArreglo<T>(respuesta: T[] | { datos?: T[] } | null | undefined): T[] {
  if (Array.isArray(respuesta)) return respuesta;
  if (respuesta && Array.isArray((respuesta as { datos?: T[] }).datos)) {
    return (respuesta as { datos: T[] }).datos;
  }
  return [];
}

export async function traerUsuariosPlataforma(opciones?: OpcionesPeticion): Promise<UsuarioPlataforma[]> {
  // tamano 200 (máximo del API): por defecto son 25 y con 50 personas el
  // panel solo veía la mitad (lista de usuarios y diálogo de grupos).
  const respuesta = await api.get<UsuarioPlataforma[] | { datos: UsuarioPlataforma[] }>(
    `/api/v1/usuarios${consulta({ tamano: 200 })}`,
    opciones,
  );
  return comoArreglo(respuesta);
}

export async function traerGrupos(opciones?: OpcionesPeticion): Promise<GrupoPlataforma[]> {
  const respuesta = await api.get<GrupoPlataforma[] | { datos: GrupoPlataforma[] }>(
    `/api/v1/grupos${consulta({ tamano: 200 })}`,
    opciones,
  );
  return comoArreglo(respuesta);
}

export async function traerEsquemaAjustes(opciones?: OpcionesPeticion): Promise<EntradaEsquemaAjustes[]> {
  const respuesta = await api.get<EntradaEsquemaAjustes[] | { datos: EntradaEsquemaAjustes[] }>(
    '/api/v1/configuracion/esquema',
    opciones,
  );
  return comoArreglo(respuesta);
}

export interface RespuestaDireccion {
  direccion: string | null;
  direccionAproximada?: boolean;
}

// Caché de direcciones por coordenada redondeada a 5 decimales (~1 m). El
// geocodificador inverso es un servicio externo y una misma parada se consulta
// al abrir la lista y al seleccionarla: el caché evita repetir la llamada.
const direccionesPorCoordenada = new Map<string, string | null>();

// La precisión del fix va al servidor: con precisión mala devuelve "Cerca de …"
// en lugar de afirmar una calle. Forma parte de la clave porque la misma
// coordenada puede resolverse distinto según cuánto se fíe del punto.
export async function traerDireccion(
  lat: number,
  lon: number,
  precisionM: number | null = null,
): Promise<RespuestaDireccion> {
  const clave = `${lat.toFixed(5)},${lon.toFixed(5)},${precisionM == null ? '' : Math.round(precisionM)}`;
  const cacheada = direccionesPorCoordenada.get(clave);
  if (cacheada !== undefined) return { direccion: cacheada };
  const respuesta = await api.get<RespuestaDireccion>(
    `/api/v1/geocode/reverse${consulta({ lat, lon, precision: precisionM ?? undefined })}`,
  );
  const direccion = respuesta?.direccion ?? null;
  // Se guarda lo que respondió el servicio, aunque sea null. Un fallo de red
  // no se guarda, para poder reintentar.
  direccionesPorCoordenada.set(clave, direccion);
  return { direccion };
}

// Muestras de batería de un equipo en la ventana (máximo 31 días): alimentan
// la curva de batería y los eventos de carga de la bitácora.
export function traerBateriaEquipo(idPublico: string, desde: string, hasta: string): Promise<Bateria> {
  return api.get<Bateria>(`/api/v1/battery/${encodeURIComponent(idPublico)}${consulta({ desde, hasta })}`);
}
