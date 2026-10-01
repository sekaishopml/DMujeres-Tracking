// Carga la configuración del .env de la raíz sin dependencias. Lo que ya está
// en el entorno del proceso manda. Nunca imprime valores.

import { readFileSync } from 'node:fs';

const RUTA_ENV_POR_DEFECTO = '/home/DMujeres-Tracking/.env';

// Commit en producción: DMJ_COMMIT si lo fija el despliegue; si no, el HEAD
// del repositorio (leído del disco, sin ejecutar git).
function commitDelRepositorio() {
  try {
    const raiz = new URL('../../../', import.meta.url);
    const cabeza = readFileSync(new URL('.git/HEAD', raiz), 'utf8').trim();
    if (!cabeza.startsWith('ref: ')) return cabeza.slice(0, 12);
    const referencia = cabeza.slice(5);
    try {
      return readFileSync(new URL(`.git/${referencia}`, raiz), 'utf8').trim().slice(0, 12);
    } catch {
      const empaquetadas = readFileSync(new URL('.git/packed-refs', raiz), 'utf8');
      const linea = empaquetadas.split('\n').find((l) => l.endsWith(` ${referencia}`));
      return linea ? linea.slice(0, 12) : null;
    }
  } catch {
    return null;
  }
}

function entero(valor, porDefecto) {
  const numero = Number.parseInt(valor ?? '', 10);
  return Number.isFinite(numero) ? numero : porDefecto;
}

function numero(valor, porDefecto) {
  const parseado = Number.parseFloat(valor ?? '');
  return Number.isFinite(parseado) ? parseado : porDefecto;
}

function descomillar(valor) {
  const texto = valor.trim();
  if (texto.length >= 2) {
    const primero = texto[0];
    const ultimo = texto[texto.length - 1];
    if ((primero === '"' && ultimo === '"') || (primero === "'" && ultimo === "'")) {
      return texto.slice(1, -1);
    }
  }
  return texto;
}

export function cargarArchivoEnv(ruta = process.env.DMJ_ENV_FILE || RUTA_ENV_POR_DEFECTO) {
  let contenido;
  try {
    contenido = readFileSync(ruta, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return ruta;
    throw error;
  }
  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const separador = limpia.indexOf('=');
    if (separador <= 0) continue;
    const clave = limpia.slice(0, separador).trim();
    const valor = descomillar(limpia.slice(separador + 1));
    if (!(clave in process.env)) process.env[clave] = valor;
  }
  return ruta;
}

function configuracionBaseDatos(env) {
  if (env.DMJ_DB_URL) {
    return { connectionString: env.DMJ_DB_URL };
  }
  const usuario = env.DMJ_DB_USUARIO || env.POSTGRES_USER;
  const clave = env.DMJ_DB_CLAVE || env.POSTGRES_PASSWORD;
  const nombre = env.DMJ_DB_NOMBRE || env.POSTGRES_DB || 'dmujeres';
  if (!usuario) {
    throw new Error('Falta DMJ_DB_USUARIO/POSTGRES_USER: revise el archivo de entorno de la API.');
  }
  return {
    host: env.DMJ_DB_HOST || '127.0.0.1',
    port: entero(env.DMJ_DB_PORT, 5443),
    user: usuario,
    password: clave,
    database: nombre,
  };
}

export function construirConfiguracion(env = process.env, version = '0.0.0') {
  const tls = env.DMJ_TLS === '1' || env.DMJ_TLS === 'true';
  return {
    servicio: 'dmj-api',
    version,
    entorno: env.DMJ_ENTORNO || 'desarrollo',
    host: env.DMJ_API_HOST || '127.0.0.1',
    puerto: entero(env.DMJ_API_PORT, 8081),
    tls,
    zonaHoraria: env.DMJ_ZONA_HORARIA || 'America/Guayaquil',
    intervaloRefrescoSegundos: entero(env.DMJ_REFRESCO_SEGUNDOS, 5),
    sesionHoras: numero(env.DMJ_SESION_HORAS, 12),
    db: configuracionBaseDatos(env),
    trackingUrl: env.DMJ_TRACKING_URL || '',
    mapa: {
      estiloUrl: env.DMJ_MAPA_ESTILO_URL || 'https://demotiles.maplibre.org/style.json',
      centro: [-2.1908, -79.9002],
      zoom: numero(env.DMJ_MAPA_ZOOM, 12),
    },
    commit: env.DMJ_COMMIT || commitDelRepositorio() || 'desconocido',
    construidoEn: env.DMJ_BUILD_TIME || new Date().toISOString(),
  };
}

export function leerVersionPaquete() {
  try {
    const paquete = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof paquete.version === 'string' ? paquete.version : '0.0.0';
  } catch {
    // La version es informativa: si el paquete no se puede leer se reporta 0.0.0.
    return '0.0.0';
  }
}

export function cargarEntorno(ruta) {
  cargarArchivoEnv(ruta);
  return construirConfiguracion(process.env, leerVersionPaquete());
}
