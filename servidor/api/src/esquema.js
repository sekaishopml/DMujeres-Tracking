// Ajustes de la app que se pueden cambiar desde el panel: son las claves que
// devuelve GET /api/mobile/v1/config (servidor/tracking/src/movil.js). Si se
// agrega o quita una allá, se cambia aquí también. Cada persona puede tener
// los suyos en atributos.configApp.

import { respuestaJson } from './http.js';

// Valores por defecto. Deben coincidir con los de servidor/tracking/src/movil.js.
export const CONFIG_POR_DEFECTO = {
  intervalSeconds: 10,
  bufferMax: 5000,
  bufferPolicy: 'drop_oldest',
  ackTimeoutSeconds: 15,
  maxRetries: 30,
  distanceMeters: 10,
  angleDegrees: 15,
  accuracy: 'high',
  bufferEnabled: true,
  l1_pending_intent_enabled: false,
  store_all_enabled: false,
  l1_max_update_delay_ms: 60000,
  min_interval_seconds: 10,
};

export const CLAVES_CONFIG_APP = Object.keys(CONFIG_POR_DEFECTO);

// Descripción de cada clave para la pantalla de ajustes (español humano, sin
// jerga). `tipo` es entero, texto o booleano; min/max solo en enteros.
export const ESQUEMA_CONFIG_APP = [
  {
    clave: 'intervalSeconds',
    etiqueta: 'Cada cuánto envía su posición',
    descripcion: 'Segundos entre cada envío de posición cuando el equipo está en movimiento.',
    tipo: 'entero',
    min: 5,
    max: 3600,
  },
  {
    clave: 'min_interval_seconds',
    etiqueta: 'Espera mínima entre envíos',
    descripcion: 'Aunque haya movimiento, la app espera al menos estos segundos antes de volver a enviar.',
    tipo: 'entero',
    min: 5,
    max: 3600,
  },
  {
    clave: 'distanceMeters',
    etiqueta: 'Distancia para volver a enviar',
    descripcion: 'La app envía una posición nueva cuando el equipo se mueve estos metros.',
    tipo: 'entero',
    min: 0,
    max: 10000,
  },
  {
    clave: 'angleDegrees',
    etiqueta: 'Giro para volver a enviar',
    descripcion: 'Si el equipo gira estos grados, la app envía su posición aunque no haya pasado el tiempo.',
    tipo: 'entero',
    min: 0,
    max: 180,
  },
  {
    clave: 'accuracy',
    etiqueta: 'Precisión del GPS',
    descripcion: 'Cuánta precisión le pide la app al teléfono. La precisión alta gasta más batería.',
    tipo: 'texto',
  },
  {
    clave: 'bufferEnabled',
    etiqueta: 'Guardar cuando no hay señal',
    descripcion: 'Si el equipo se queda sin internet, guarda las posiciones y las envía al recuperar la señal.',
    tipo: 'booleano',
  },
  {
    clave: 'bufferMax',
    etiqueta: 'Cuántas posiciones guarda sin señal',
    descripcion: 'Tope de posiciones que el teléfono guarda hasta recuperar la señal.',
    tipo: 'entero',
    min: 100,
    max: 20000,
  },
  {
    clave: 'bufferPolicy',
    etiqueta: 'Qué se borra cuando se llena',
    descripcion: 'Cómo hace lugar el teléfono cuando se llena sin señal. Lo habitual es borrar lo más viejo.',
    tipo: 'texto',
  },
  {
    clave: 'ackTimeoutSeconds',
    etiqueta: 'Cuánto espera la confirmación',
    descripcion: 'Segundos que espera el teléfono a que el servidor confirme cada envío antes de reintentar.',
    tipo: 'entero',
    min: 5,
    max: 120,
  },
  {
    clave: 'maxRetries',
    etiqueta: 'Cuántas veces reintenta',
    descripcion: 'Veces que el teléfono vuelve a intentar un envío antes de dejarlo por perdido.',
    tipo: 'entero',
    min: 0,
    max: 100,
  },
  {
    clave: 'l1_pending_intent_enabled',
    etiqueta: 'Mantener el rastreo en segundo plano',
    descripcion: 'Deja que el sistema mantenga la app de rastreo funcionando aunque no esté en pantalla.',
    tipo: 'booleano',
  },
  {
    clave: 'store_all_enabled',
    etiqueta: 'Guardar copia en el teléfono',
    descripcion: 'Guarda en el teléfono una copia de cada posición además de enviarla al servidor.',
    tipo: 'booleano',
  },
  {
    clave: 'l1_max_update_delay_ms',
    etiqueta: 'Espera máxima para juntar envíos',
    descripcion: 'Milisegundos que el teléfono puede juntar posiciones antes de enviarlas todas juntas.',
    tipo: 'entero',
    min: 5000,
    max: 300000,
  },
];

function tipoValido(clave, valor) {
  const defecto = CONFIG_POR_DEFECTO[clave];
  if (typeof defecto === 'boolean') return typeof valor === 'boolean';
  if (typeof defecto === 'number') return typeof valor === 'number' && Number.isFinite(valor);
  return typeof valor === 'string' && valor.length <= 500;
}

// Limpia el configApp de una persona: solo claves conocidas y del tipo
// correcto. Lo demás se ignora para no romper el inicio de sesión.
export function sanearConfigApp(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) return null;
  const limpia = {};
  for (const [clave, dato] of Object.entries(valor)) {
    if (!CLAVES_CONFIG_APP.includes(clave)) continue;
    if (!tipoValido(clave, dato)) continue;
    limpia[clave] = dato;
  }
  return limpia;
}

export function configAppDe(atributos) {
  if (!atributos || typeof atributos !== 'object' || Array.isArray(atributos)) return null;
  const saneada = sanearConfigApp(atributos.configApp);
  return saneada && Object.keys(saneada).length > 0 ? saneada : null;
}

export async function obtenerEsquema(ctx) {
  // Cada clave lleva su valor por defecto: el panel muestra el valor vigente
  // (el de la persona o, si no tiene, este).
  respuestaJson(ctx.res, 200, {
    datos: ESQUEMA_CONFIG_APP.map((entrada) => ({ ...entrada, porDefecto: CONFIG_POR_DEFECTO[entrada.clave] ?? null })),
  });
}
