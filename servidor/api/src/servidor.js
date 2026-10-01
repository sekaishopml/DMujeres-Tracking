// Servidor HTTP de la API /api/v1 (Node 24, sin frameworks). Escucha en
// 127.0.0.1:8081 (DMJ_API_PORT); no se expone directo a internet.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { cargarEntorno } from './entorno.js';
import { crearLog } from './log.js';
import { ConsultaAbortada, crearPool } from './db.js';
import { noAutenticado, noEncontrado, responderError } from './errores.js';
import { buscarRuta, prepararRutas } from './rutas.js';
import { tokenDeSesion, validarSesion } from './sesiones.js';

export function crearServidor({ configuracion, pool, log }) {
  const rutas = prepararRutas();
  const servidor = http.createServer((req, res) => {
    atender(req, res, { configuracion, pool, log, rutas }).catch((error) => {
      log.error('error_no_controlado', { detalle: error.message });
      if (!res.headersSent) responderError(res, error);
    });
  });
  return servidor;
}

async function atender(req, res, deps) {
  const inicio = process.hrtime.bigint();
  const url = new URL(req.url, 'http://interno');
  const controlador = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controlador.abort();
  });

  let sesion = null;
  let error = null;
  try {
    const coincidencia = buscarRuta(deps.rutas, req.method, url.pathname);
    if (!coincidencia) {
      throw noEncontrado('La ruta solicitada no existe.');
    }
    const { ruta, params } = coincidencia;
    if (!ruta.publica) {
      sesion = await validarSesion(deps.pool, tokenDeSesion(req));
      if (!sesion) throw noAutenticado();
    }
    const contexto = {
      req,
      res,
      url,
      params,
      pool: deps.pool,
      log: deps.log,
      entorno: deps.configuracion,
      sesion,
      usuario: sesion?.usuario ?? null,
      signal: controlador.signal,
    };
    await ruta.manejar(contexto);
  } catch (capturado) {
    error = capturado;
    if (capturado instanceof ConsultaAbortada) {
      deps.log.aviso('consulta_abortada_por_desconexion', { ruta: url.pathname });
    } else if (!res.headersSent) {
      responderError(res, capturado);
      if (!capturado.codigo) {
        deps.log.error('error_interno', { ruta: url.pathname, detalle: capturado.stack });
      }
    }
  } finally {
    if (res.writableEnded) {
      const duracionMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      deps.log.info('solicitud', {
        metodo: req.method,
        ruta: url.pathname,
        estado: res.statusCode,
        duracionMs: Math.round(duracionMs),
        usuario: sesion?.usuario?.id ?? undefined,
        error: error?.codigo ?? undefined,
      });
    }
  }
}

export function arrancar(configuracion = cargarEntorno()) {
  const log = crearLog(configuracion.servicio);
  const pool = crearPool(configuracion.db);
  pool.on('error', (error) => log.error('pool_error', { detalle: error.message }));
  const servidor = crearServidor({ configuracion, pool, log });
  servidor.listen(configuracion.puerto, configuracion.host, () => {
    log.info('api_escuchando', {
      host: configuracion.host,
      puerto: configuracion.puerto,
      entorno: configuracion.entorno,
      tls: configuracion.tls,
    });
  });
  const apagar = (senal) => {
    log.info('apagando_api', { senal });
    const forzar = setTimeout(() => {
      log.aviso('apagado_forzado');
      servidor.closeAllConnections?.();
      process.exit(1);
    }, 10000);
    forzar.unref();
    servidor.close(() => {
      pool
        .end()
        .then(() => {
          clearTimeout(forzar);
          log.info('api_detenida');
          process.exit(0);
        })
        .catch((error) => {
          log.error('pool_cierre_error', { detalle: error.message });
          process.exit(1);
        });
    });
    servidor.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
  return { servidor, pool, log };
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) {
  arrancar();
}
