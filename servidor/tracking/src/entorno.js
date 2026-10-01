// Configuración del receptor. Lo que venga en el entorno (systemd) manda sobre
// el archivo .env de la raíz. Nunca se registran valores secretos.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

export const RUTA_ENV_POR_DEFECTO = resolve(AQUI, '..', '..', '..', '.env');

export const PUERTO_POR_DEFECTO = 5056;
export const HOST_POR_DEFECTO = '127.0.0.1';
// Carpeta de donde se sirven latest.json, rollout.json y el APK de la app.
export const OTA_DIR_POR_DEFECTO = '/home/DMujeres-Tracking/ota';

export function cargarVariables(rutaArchivo = process.env.DMJ_ENV_FILE || RUTA_ENV_POR_DEFECTO) {
  const variables = {};
  if (rutaArchivo && existsSync(rutaArchivo)) {
    for (const linea of readFileSync(rutaArchivo, 'utf8').split('\n')) {
      const limpia = linea.trim();
      if (!limpia || limpia.startsWith('#')) continue;
      const corte = limpia.indexOf('=');
      if (corte <= 0) continue;
      const clave = limpia.slice(0, corte).trim();
      let valor = limpia.slice(corte + 1).trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      variables[clave] = valor;
    }
  }
  for (const [clave, valor] of Object.entries(process.env)) {
    if (valor !== undefined) variables[clave] = valor;
  }
  return variables;
}

function entero(valor, defecto) {
  const numero = Number.parseInt(String(valor ?? '').trim(), 10);
  return Number.isInteger(numero) ? numero : defecto;
}

export function cargarConfiguracion(rutaArchivo) {
  const v = cargarVariables(rutaArchivo);
  const host = (v.DMJ_TRACKING_HOST || HOST_POR_DEFECTO).trim();
  const puerto = entero(v.DMJ_TRACKING_PORT, PUERTO_POR_DEFECTO);
  const clavesMoviles = [v.DMJ_CLAVE_MOVIL, v.DMJ_CLAVE_MOVIL_ANTERIOR]
    .map((clave) => (clave ?? '').trim())
    .filter((clave) => clave.length > 0);

  const bd = v.DMJ_DB_URL && v.DMJ_DB_URL.trim()
    ? { url: v.DMJ_DB_URL.trim() }
    : (() => {
        const usuario = (v.POSTGRES_USER ?? '').trim();
        const clave = v.POSTGRES_PASSWORD ?? '';
        const base = (v.POSTGRES_DB ?? '').trim();
        if (!usuario || !clave || !base) {
          throw new Error(
            'Falta configuracion de base: POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB ' +
            'o DMJ_DB_URL en el .env'
          );
        }
        return {
          host: (v.DMJ_DB_HOST || '127.0.0.1').trim(),
          puerto: entero(v.DMJ_DB_PORT, 5443),
          base,
          usuario,
          clave,
        };
      })();

  return {
    entorno: (v.DMJ_ENTORNO || 'desarrollo').trim(),
    host,
    puerto,
    canalMovilActivo: String(v.DMJ_CANAL_MOVIL ?? '1').trim() !== '0',
    clavesMoviles,
    otaDir: (v.DMJ_OTA_DIR || OTA_DIR_POR_DEFECTO).trim(),
    // La app no pide la clave cada día: la sesión móvil dura 30 días.
    sesionMovilHoras: entero(v.DMJ_SESION_MOVIL_HORAS, 720),
    bd,
  };
}
