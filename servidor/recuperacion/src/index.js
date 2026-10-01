// Servicio de recuperacion FCM: worker con bucle (sin frameworks, sin HTTP).
// Cada DMJ_RECUPERACION_INTERVALO evalua la flota y envia el probe de
// recuperacion a los equipos silenciados que cumplan la politica. Se detiene
// limpiamente con SIGTERM/SIGINT (systemd).

import { cargarConfiguracion } from './config.js';
import { crearAlmacen } from './db.js';
import { cargarCredencial, crearEmisorFcm } from './fcm.js';
import { ejecutarCiclo } from './monitor.js';
import { crearLog } from './log.js';

const log = crearLog('recuperacion');

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function principal() {
  const configuracion = cargarConfiguracion();
  const politica = configuracion.recuperacion;

  log.info(
    `arranque entorno=${configuracion.entorno} intervalo=${politica.intervaloMs / 1000}s ` +
    `silencioMin=${politica.silencioMin} cooldown=${politica.cooldownMs / 1000}s ` +
    `maxHora=${politica.maxHora} vigenciaMin=${politica.vigenciaMin} ` +
    `dryRun=${politica.dryRun} fcmHabilitado=${configuracion.fcm.habilitado}`
  );

  const almacen = await crearAlmacen(configuracion, log);

  let emisor = null;
  if (!configuracion.fcm.habilitado) {
    log.warn('DMJ_FCM_ENABLED inactivo: el servicio solo monitorea, no envia probes');
  } else if (politica.dryRun) {
    log.info('DMJ_RECUPERACION_DRY_RUN activo: no se envia ni se escribe en la base');
  } else {
    try {
      const credencial = cargarCredencial(configuracion.fcm.credencial);
      emisor = crearEmisorFcm({ credencial, log });
      log.info(`FCM operativo proyecto=${credencial.projectId}`);
    } catch (error) {
      log.error(
        `FCM sin credencial utilizable (${configuracion.fcm.credencial}): ` +
        `${error.message}; no se enviaran probes`
      );
    }
  }

  let detenido = false;
  const detener = (senal) => {
    if (!detenido) {
      detenido = true;
      log.info(`senal ${senal}: cerrando servicio`);
    }
  };
  process.on('SIGTERM', () => detener('SIGTERM'));
  process.on('SIGINT', () => detener('SIGINT'));

  while (!detenido) {
    try {
      await ejecutarCiclo({ almacen, emisor, configuracion, log });
    } catch (error) {
      log.error(`ciclo fallido: ${error.message}`);
    }
    const fin = Date.now() + politica.intervaloMs;
    while (!detenido && Date.now() < fin) {
      await esperar(Math.min(1000, fin - Date.now()));
    }
  }

  await almacen.cerrar();
  log.info('servicio detenido');
}

principal().catch((error) => {
  log.error(`arranque fallido: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
