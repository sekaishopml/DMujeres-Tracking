// Traduccion de filas SQL a los DTO del contrato (campos en español).
// Nunca devuelve columnas internas ni nombres de tablas.

// Configuración del equipo que se edita desde el panel. Solo estas claves de
// los atributos salen en la respuesta y se aceptan al guardar; el resto
// (jornada, diagnóstico, versiones) no se expone ni se pisa.
export const CLAVES_CONFIGURABLES = [
  'mobile.intervalSeconds',
  'mobile.minIntervalSeconds',
  'mobile.distanceMeters',
  'mobile.angleDegrees',
  'mobile.accuracy',
  'mobile.bufferEnabled',
  'mobile.bufferMax',
  'mobile.bufferPolicy',
  'mobile.ackTimeoutSeconds',
  'mobile.maxRetries',
];

function esValorConfigurable(valor) {
  return (
    typeof valor === 'string' ||
    typeof valor === 'boolean' ||
    (typeof valor === 'number' && Number.isFinite(valor))
  );
}

// Devuelve solo las claves configurables presentes, o null si no hay ninguna.
export function configuracionDeAtributos(atributos) {
  if (!atributos || typeof atributos !== 'object' || Array.isArray(atributos)) return null;
  const configuracion = {};
  for (const clave of CLAVES_CONFIGURABLES) {
    if (esValorConfigurable(atributos[clave])) configuracion[clave] = atributos[clave];
  }
  return Object.keys(configuracion).length > 0 ? configuracion : null;
}

export function iso(valor) {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha.toISOString() : null;
}

export function numeroONulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export function enteroONulo(valor) {
  const numero = numeroONulo(valor);
  return numero === null ? null : Math.trunc(numero);
}

// El estado operativo lo calcula la consulta de flota (CASE en SQL) con las
// mismas reglas de la App: deshabilitado por jornada, sin señal >5 min,
// GPS débil >80 m, detenido <1 nudo. Aquí solo se sanea el valor.
const ESTADOS_VALIDOS = new Set([
  'DESHABILITADO', 'SIN_SENAL', 'SENAL_DEBIL', 'DETENIDO', 'EN_LINEA',
]);

function estadoDto(fila) {
  return ESTADOS_VALIDOS.has(fila.estado) ? fila.estado : 'DESCONOCIDO';
}

export function aUsuario(fila, dispositivoIds) {
  const ids = dispositivoIds ?? fila.dispositivo_ids ?? [];
  return {
    id: Number(fila.id),
    idPublico: fila.id_publico,
    nombre: fila.nombre,
    correo: fila.correo ?? null,
    administrador: fila.administrador === true,
    soloLectura: fila.solo_lectura === true,
    habilitado: fila.habilitado === true,
    dispositivoIds: Array.isArray(ids) ? ids.map(String) : [],
  };
}

export function aPosicion(fila) {
  return {
    id: Number(fila.id),
    dispositivoId: Number(fila.dispositivo_id),
    latitud: Number(fila.latitud),
    longitud: Number(fila.longitud),
    altitudM: numeroONulo(fila.altitud_m),
    velocidadKmh: numeroONulo(fila.velocidad_kmh),
    rumboGrados: numeroONulo(fila.rumbo_grados),
    precisionM: numeroONulo(fila.precision_m),
    bateriaPct: numeroONulo(fila.bateria_pct),
    registradoEn: iso(fila.registrado_en),
    recibidoEn: iso(fila.recibido_en),
    valida: fila.valida === true,
    // El teléfono avisó que esta ubicación es simulada, no del GPS.
    simulada: fila.simulada === true,
  };
}

// `usuario` es opcional: la configuración del equipo solo la ven los
// administradores; el resto recibe null.
export function aDispositivo(fila, usuario) {
  return {
    id: Number(fila.id),
    idPublico: fila.id_publico,
    nombre: fila.nombre,
    identificadorUnico: fila.identificador,
    habilitado: fila.habilitado === true,
    estado: estadoDto(fila),
    // Última respuesta del teléfono (punto GPS o diagnóstico), la misma que decide el estado.
    ultimaConexion: iso(fila.ultimo_contacto ?? fila.ultima_conexion_en),
    versionApp: fila.version_app ?? null,
    plataforma: fila.atributos?.plataforma === 'ios' ? 'ios' : 'android',
    jornadaActiva: fila.jornada_activa === true,
    departamento: fila.departamento ?? null,
    bateriaPct: numeroONulo(fila.bateria_pct),
    cargando: fila.cargando === null || fila.cargando === undefined ? null : fila.cargando === true,
    pendientes: enteroONulo(fila.pendientes),
    configuracion: usuario?.administrador ? configuracionDeAtributos(fila.atributos) : null,
  };
}
