// Configuración del servicio de recuperación. Lo que venga en el entorno
// (systemd) manda sobre el .env de la raíz. La credencial de Firebase es una
// ruta a un archivo; nunca se registra su contenido.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

export const RUTA_ENV_POR_DEFECTO = resolve(AQUI, '..', '..', '..', '.env');
export const RUTA_CREDENCIAL_POR_DEFECTO =
  '/opt/dmj-keys/firebase-adminsdk.json';

export const INTERVALO_POR_DEFECTO_S = 60;
export const SILENCIO_POR_DEFECTO_MIN = 15;
export const COOLDOWN_POR_DEFECTO_S = 60;
export const MAX_HORA_POR_DEFECTO = 5;
export const VIGENCIA_INTENTO_POR_DEFECTO_MIN = 5;

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

// Activo por defecto (1): la bandera permite apagar el envio sin detener el
// monitoreo. Formatos aceptados: 1/true/si/yes/on.
export function esActivo(valor, defecto = true) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return defecto;
  return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(String(valor).trim().toLowerCase());
}

export function cargarConfiguracion(rutaArchivo) {
  const v = cargarVariables(rutaArchivo);

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
    bd,
    fcm: {
      habilitado: esActivo(v.DMJ_FCM_ENABLED, true),
      credencial: (v.DMJ_FCM_CREDENCIAL || RUTA_CREDENCIAL_POR_DEFECTO).trim(),
    },
    recuperacion: {
      intervaloMs: Math.max(5, entero(v.DMJ_RECUPERACION_INTERVALO, INTERVALO_POR_DEFECTO_S)) * 1000,
      silencioMin: Math.max(1, entero(v.DMJ_RECUPERACION_SILENCIO_MIN, SILENCIO_POR_DEFECTO_MIN)),
      cooldownMs: Math.max(1, entero(v.DMJ_RECUPERACION_COOLDOWN, COOLDOWN_POR_DEFECTO_S)) * 1000,
      maxHora: Math.max(1, entero(v.DMJ_RECUPERACION_MAX_HORA, MAX_HORA_POR_DEFECTO)),
      vigenciaMin: Math.max(
        1,
        entero(v.DMJ_RECUPERACION_INTENTO_VIGENCIA_MIN, VIGENCIA_INTENTO_POR_DEFECTO_MIN),
      ),
      dryRun: esActivo(v.DMJ_RECUPERACION_DRY_RUN, false),
    },
  };
}
