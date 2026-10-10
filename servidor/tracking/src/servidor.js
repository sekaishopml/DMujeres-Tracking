// Servidor HTTP del receptor de la app. Rutas:
//   GET/POST /                     protocolo OsmAnd (versiones viejas de la app)
//   POST /overland                 Overland (iPhone): lote de puntos
//   POST /api/mobile/v1/sesion     inicio de sesión (devuelve un token)
//   GET  /api/mobile/v1/config     configuración del teléfono
//   GET  /api/mobile/v1/journey    estado de la jornada en el servidor
//   POST /api/mobile/v1/journey    inicio y fin de jornada
//   POST /api/mobile/v1/positions  lote de puntos (sin duplicar)
//   GET/POST /api/mobile/v1/clientes  clientes para registrar actividades
//   GET  /api/mobile/v1/paradas    paradas de un día (actividades desde el GPS)
//   GET  /api/mobile/v1/estado     último punto que tiene el servidor
//   POST /api/mobile/v1/diagnostics
//   GET  /api/mobile/v1/ota
//   POST /api/mobile/v1/fcm-token
//   POST /api/mobile/v1/recovery-ack

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { cargarConfiguracion } from './entorno.js';
import { crearAlmacen } from './db.js';
import { atenderOsmand } from './osmand.js';
import { atenderOverland } from './overland.js';
import {
  atenderConfig,
  atenderDiagnosticos,
  atenderEnergia,
  atenderActividad,
  atenderActividadesConsulta,
  atenderJornada,
  atenderJornadaConsulta,
  atenderLotePosiciones,
  atenderOta,
  atenderRecuperacionAck,
  atenderSesion,
  atenderTokenFcm,
} from './movil.js';
import { atenderClienteNuevo, atenderClientesConsulta, atenderParadasDia } from './clientes.js';
import { atenderEstado } from './estado.js';

function responderNoEncontrado(res) {
  res.writeHead(404, { 'cache-control': 'no-store' });
  res.end();
}

async function manejar(req, res, ctx) {
  let url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
  } catch {
    return responderNoEncontrado(res);
  }
  const ruta = url.pathname.replace(/\/+$/, '') || '/';
  const metodo = req.method;

  if (ruta === '/') {
    if (metodo === 'GET' || metodo === 'POST') {
      return atenderOsmand(req, res, { ...ctx, url });
    }
    return responderNoEncontrado(res);
  }

  if (ruta === '/overland') {
    return atenderOverland(req, res, { ...ctx, url });
  }

  if (ruta === '/api/mobile/v1/sesion' && metodo === 'POST') {
    return atenderSesion(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/config' && metodo === 'GET') {
    return atenderConfig(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/journey' && metodo === 'POST') {
    return atenderJornada(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/journey' && metodo === 'GET') {
    return atenderJornadaConsulta(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/positions' && metodo === 'POST') {
    return atenderLotePosiciones(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/actividades' && metodo === 'GET') {
    return atenderActividadesConsulta(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/actividades' && metodo === 'POST') {
    return atenderActividad(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/clientes' && metodo === 'GET') {
    return atenderClientesConsulta(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/clientes' && metodo === 'POST') {
    return atenderClienteNuevo(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/estado' && metodo === 'GET') {
    return atenderEstado(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/paradas' && metodo === 'GET') {
    return atenderParadasDia(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/power' && metodo === 'POST') {
    return atenderEnergia(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/diagnostics' && metodo === 'POST') {
    return atenderDiagnosticos(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/ota' && metodo === 'GET') {
    return atenderOta(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/fcm-token' && metodo === 'POST') {
    return atenderTokenFcm(req, res, { ...ctx, url });
  }
  if (ruta === '/api/mobile/v1/recovery-ack' && metodo === 'POST') {
    return atenderRecuperacionAck(req, res, { ...ctx, url });
  }
  return responderNoEncontrado(res);
}

export function crearServidor(ctx) {
  return http.createServer((req, res) => {
    Promise.resolve()
      .then(() => manejar(req, res, ctx))
      .catch((error) => {
        ctx.log.error(`peticion no controlada: ${error.message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        }
        res.end();
      });
  });
}

function descripcionBase(bd) {
  if (bd.url) {
    try {
      const url = new URL(bd.url);
      return `${url.hostname}:${url.port}/${url.pathname.replace(/^\//, '')}`;
    } catch {
      return 'DMJ_DB_URL';
    }
  }
  return `${bd.host}:${bd.puerto}/${bd.base}`;
}

async function principal() {
  const configuracion = cargarConfiguracion();
  const log = {
    info: (mensaje) => console.log(`[tracking] ${mensaje}`),
    warn: (mensaje) => console.warn(`[tracking] AVISO ${mensaje}`),
    error: (mensaje) => console.error(`[tracking] ERROR ${mensaje}`),
  };
  const almacen = await crearAlmacen(configuracion, log);
  // Particiones del mes actual y los dos siguientes, para que ningún punto se
  // quede sin dónde guardarse a fin de mes. Si la base no deja crearlas, se
  // avisa y se sigue.
  try {
    await almacen.precrearParticionesProximas();
    log.info('particiones mes+2 precreadas');
  } catch (error) {
    log.warn(`precreacion de particiones fallo: ${error.message}`);
  }
  // Al arrancar se ordenan las jornadas: se registran las que empezaron con el
  // servidor caído y se cierran las abandonadas. Después se revisa cada hora.
  try {
    const reconciliacion = await almacen.reconciliarJornadas();
    if (reconciliacion.creadas || reconciliacion.cerradas) {
      log.info(
        `reconciliacion de jornadas: creadas=${reconciliacion.creadas} ` +
        `cerradas=${reconciliacion.cerradas}`,
      );
    }
  } catch (error) {
    log.warn(`reconciliacion de jornadas fallo: ${error.message}`);
  }
  const reconciliacionPeriodica = setInterval(() => {
    almacen.reconciliarJornadas().catch((error) => {
      log.warn(`reconciliacion periodica fallo: ${error.message}`);
    });
  }, 3600_000);
  reconciliacionPeriodica.unref();
  const servidor = crearServidor({ configuracion, almacen, log });

  servidor.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      log.error(
        `el puerto ${configuracion.puerto} esta ocupado; use DMJ_TRACKING_PORT ` +
        'para elegir otro puerto',
      );
    } else {
      log.error(`servidor: ${error.message}`);
    }
    process.exit(1);
  });

  servidor.listen(configuracion.puerto, configuracion.host, () => {
    log.info(
      `escuchando en http://${configuracion.host}:${configuracion.puerto} ` +
      `(entorno=${configuracion.entorno}, base=${descripcionBase(configuracion.bd)}, ` +
      `canalMovil=${configuracion.canalMovilActivo ? 'activo' : 'apagado'}, ` +
      `claves=${configuracion.clavesMoviles.length}, otaDir=${configuracion.otaDir})`,
    );
  });

  let cerrando = false;
  const cerrar = (senal) => {
    if (cerrando) return;
    cerrando = true;
    log.info(`${senal}: cerrando`);
    servidor.close(async () => {
      await almacen.cerrar().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((error) => {
    console.error(`[tracking] ERROR al arrancar: ${error.message}`);
    process.exit(1);
  });
}
