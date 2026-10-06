// Tabla de rutas del contrato /api/v1 y emparejador simple.

import * as auth from './auth.js';
import * as bateria from './bateria.js';
import * as config from './config.js';
import * as cronograma from './cronograma.js';
import * as eventos from './eventos.js';
import * as cuentas from './cuentas.js';
import * as esquema from './esquema.js';
import * as flota from './flota.js';
import * as geocodigo from './geocodigo.js';
import * as grupos from './grupos.js';
import * as jornadas from './jornadas.js';
import * as oficina from './oficina.js';
import * as posiciones from './posiciones.js';
import * as replay from './replay.js';
import * as reportes from './reportes.js';
import * as roles from './roles.js';
import * as salud from './salud.js';
import * as usuarios from './usuarios.js';
import * as vivo from './vivo.js';
import * as consola from './consola.js';

export const DEFINICIONES = [
  { metodo: 'POST', ruta: '/api/v1/auth/login', publica: true, manejar: auth.iniciarSesion },
  { metodo: 'POST', ruta: '/api/v1/auth/logout', manejar: auth.cerrarSesion },
  { metodo: 'GET', ruta: '/api/v1/auth/me', manejar: auth.obtenerSesion },
  { metodo: 'GET', ruta: '/api/v1/fleet', manejar: flota.listarFlota },
  { metodo: 'GET', ruta: '/api/v1/fleet/:id', manejar: flota.obtenerDispositivo },
  { metodo: 'PUT', ruta: '/api/v1/fleet/:id', manejar: flota.actualizarDispositivo },
  { metodo: 'GET', ruta: '/api/v1/fleet/:id/position', manejar: posiciones.obtenerPosicionDispositivo },
  { metodo: 'GET', ruta: '/api/v1/fleet/:id/journeys', manejar: jornadas.listarJornadas },
  { metodo: 'GET', ruta: '/api/v1/journeys', manejar: jornadas.listarJornadasFlota },
  { metodo: 'GET', ruta: '/api/v1/positions/live', manejar: posiciones.listarPosicionesVivas },
  { metodo: 'GET', ruta: '/api/v1/vivo', manejar: vivo.abrirVivo },
  { metodo: 'POST', ruta: '/api/v1/consola', manejar: consola.ejecutarConsola },
  { metodo: 'GET', ruta: '/api/v1/replay', manejar: replay.listarReplayDisponible },
  { metodo: 'GET', ruta: '/api/v1/replay/:deviceId', manejar: replay.obtenerReplay },
  { metodo: 'GET', ruta: '/api/v1/reports/trips', manejar: reportes.listarViajes },
  { metodo: 'GET', ruta: '/api/v1/reports/stops', manejar: reportes.listarParadas },
  { metodo: 'GET', ruta: '/api/v1/reports/summary', manejar: reportes.obtenerResumen },
  { metodo: 'GET', ruta: '/api/v1/battery', manejar: bateria.listarBateriaFlota },
  { metodo: 'GET', ruta: '/api/v1/battery/:deviceId', manejar: bateria.obtenerBateriaDispositivo },
  { metodo: 'GET', ruta: '/api/v1/users', manejar: usuarios.listarUsuarios },
  { metodo: 'POST', ruta: '/api/v1/users', manejar: usuarios.crearUsuario },
  { metodo: 'GET', ruta: '/api/v1/users/:id', manejar: usuarios.obtenerUsuario },
  { metodo: 'PUT', ruta: '/api/v1/users/:id', manejar: usuarios.actualizarUsuario },
  { metodo: 'DELETE', ruta: '/api/v1/users/:id', manejar: usuarios.eliminarUsuario },
  { metodo: 'GET', ruta: '/api/v1/usuarios', manejar: cuentas.listarCuentas },
  { metodo: 'POST', ruta: '/api/v1/usuarios', manejar: cuentas.crearCuenta },
  { metodo: 'GET', ruta: '/api/v1/usuarios/:id', manejar: cuentas.obtenerCuenta },
  { metodo: 'PATCH', ruta: '/api/v1/usuarios/:id', manejar: cuentas.actualizarCuenta },
  { metodo: 'DELETE', ruta: '/api/v1/usuarios/:id', manejar: cuentas.eliminarCuenta },
  { metodo: 'GET', ruta: '/api/v1/usuarios/:id/equipos', manejar: cuentas.obtenerEquiposCuenta },
  { metodo: 'PUT', ruta: '/api/v1/usuarios/:id/equipos', manejar: cuentas.reemplazarEquiposCuenta },
  { metodo: 'GET', ruta: '/api/v1/grupos', manejar: grupos.listarGrupos },
  { metodo: 'POST', ruta: '/api/v1/grupos', manejar: grupos.crearGrupo },
  { metodo: 'GET', ruta: '/api/v1/grupos/:id', manejar: grupos.obtenerGrupo },
  { metodo: 'PATCH', ruta: '/api/v1/grupos/:id', manejar: grupos.actualizarGrupo },
  { metodo: 'DELETE', ruta: '/api/v1/grupos/:id', manejar: grupos.eliminarGrupo },
  { metodo: 'PUT', ruta: '/api/v1/grupos/:id/miembros', manejar: grupos.reemplazarMiembros },
  { metodo: 'GET', ruta: '/api/v1/roles', manejar: roles.listarRoles },
  { metodo: 'GET', ruta: '/api/v1/configuracion/esquema', manejar: esquema.obtenerEsquema },
  { metodo: 'GET', ruta: '/api/v1/config', manejar: config.obtenerConfiguracion },
  { metodo: 'GET', ruta: '/api/v1/oficina', manejar: oficina.obtenerOficina },
  { metodo: 'PUT', ruta: '/api/v1/oficina', manejar: oficina.fijarOficina },
  { metodo: 'DELETE', ruta: '/api/v1/oficina', manejar: oficina.quitarOficina },
  { metodo: 'GET', ruta: '/api/v1/geocode/reverse', manejar: geocodigo.obtenerDireccion },
  { metodo: 'GET', ruta: '/api/v1/cronograma', manejar: cronograma.listarCronograma },
  { metodo: 'GET', ruta: '/api/v1/eventos', manejar: eventos.listarEventos },
  { metodo: 'GET', ruta: '/api/v1/cronograma/novedades', manejar: cronograma.novedadesCronograma },
  { metodo: 'POST', ruta: '/api/v1/cronograma/visto', manejar: cronograma.marcarCronogramaVisto },
  { metodo: 'GET', ruta: '/api/v1/health', publica: true, manejar: salud.salud },
  { metodo: 'GET', ruta: '/api/v1/ready', publica: true, manejar: salud.disponibilidad },
  { metodo: 'GET', ruta: '/api/v1/version', publica: true, manejar: salud.version },
  { metodo: 'GET', ruta: '/api/v1/salud', manejar: salud.listarSalud },
  { metodo: 'GET', ruta: '/api/v1/salud/historial', manejar: salud.historialSalud },
];

export function prepararRutas() {
  return DEFINICIONES.map((definicion) => ({
    ...definicion,
    segmentos: definicion.ruta.split('/').filter(Boolean),
  }));
}

export function buscarRuta(rutas, metodo, camino) {
  const segmentos = camino.split('/').filter(Boolean);
  for (const ruta of rutas) {
    if (ruta.metodo !== metodo || ruta.segmentos.length !== segmentos.length) continue;
    const params = {};
    let coincide = true;
    for (let indice = 0; indice < segmentos.length; indice += 1) {
      const esperado = ruta.segmentos[indice];
      if (esperado.startsWith(':')) {
        params[esperado.slice(1)] = decodeURIComponent(segmentos[indice]);
      } else if (esperado !== segmentos[indice]) {
        coincide = false;
        break;
      }
    }
    if (coincide) return { ruta, params };
  }
  return null;
}
