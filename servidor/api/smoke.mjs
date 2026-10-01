// Prueba completa de la API contra la base real.
// Arranca la API en un puerto de prueba, inicia sesión y recorre las rutas con
// datos reales. Sale con 0 si todo pasa.
//
// También prueba la escritura: crea un administrador temporal, prueba usuarios
// y configuración de equipos, y al final lo borra con sus sesiones,
// asignaciones y auditoría.
//
// Uso:
//   node24 servidor/api/smoke.mjs
// Variables opcionales:
//   DMJ_TEST_EMAIL / DMJ_TEST_PASSWORD              usuario no administrador
//   DMJ_TEST_ADMIN_EMAIL / DMJ_TEST_ADMIN_PASSWORD  administrador
//   DMJ_SMOKE_PORT                                  puerto de la prueba

import { spawn } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cargarEntorno } from './src/entorno.js';
import { crearPool } from './src/db.js';
import { verificarClave } from './src/auth.js';
import { motivoRechazoEliminacion } from './src/usuarios.js';

const DIRECTORIO = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.DMJ_SMOKE_PORT ?? 18081);
const BASE = `http://127.0.0.1:${PUERTO}/api/v1`;
const EMAIL = process.env.DMJ_TEST_EMAIL ?? '';
const CLAVE = process.env.DMJ_TEST_PASSWORD ?? '';
if (!EMAIL || !CLAVE) {
  console.error('Faltan DMJ_TEST_EMAIL y DMJ_TEST_PASSWORD (usuario de prueba).');
  process.exit(2);
}
const ADMIN_EMAIL = process.env.DMJ_TEST_ADMIN_EMAIL ?? '';
const ADMIN_CLAVE = process.env.DMJ_TEST_ADMIN_PASSWORD ?? '';

// Credenciales efímeras del bloque de escritura (se crean y se borran aquí).
const ADMIN_TEMPORAL = {
  correo: 'prueba-admin@dmujeres.local',
  nombreUsuario: 'prueba-admin',
  nombre: 'Admin temporal 4b',
  clave: 'ClaveAdminTemporal1!',
};
const USUARIO_TEMPORAL = {
  correo: 'prueba-usuario@dmujeres.local',
  nombre: 'Usuario smoke 4b',
  nombreEditado: 'Usuario smoke 4b editado',
  clave: 'ClaveUsuarioTemporal1!',
  claveNueva: 'ClaveUsuarioNueva4b!',
};

let pasadas = 0;
let falladas = 0;
let cookie = '';

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas += 1;
    console.log(`PASS  ${nombre}`);
  } else {
    falladas += 1;
    console.log(`FAIL  ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  }
}

async function pedir(metodo, ruta, { cuerpo, conCookie = true, cookieExtra } = {}) {
  const cabeceras = {};
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  const galleta = cookieExtra ?? cookie;
  if (conCookie && galleta) cabeceras.Cookie = galleta;
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { estado: respuesta.status, json, cabeceras: respuesta.headers };
}

function cookieDeRespuesta(cabeceras) {
  const galletas = cabeceras.getSetCookie?.() ?? [];
  const sesion = galletas.find((valor) => valor.startsWith('dmj_sesion='));
  return sesion ? sesion.split(';')[0] : '';
}

// --- Escritura --------------------------------------------------------------

const SIN_VALOR = Symbol('sinValor');

function credencialPbkdf2(clave) {
  const sal = randomBytes(24);
  return {
    hash: pbkdf2Sync(clave, sal, 1000, 24, 'sha1').toString('hex'),
    sal: sal.toString('hex'),
  };
}

// Borra todo rastro de los usuarios temporales (auditoria, sesiones,
// asignaciones y usuarios). Nunca toca a usuarios reales.
async function limpiarTemporales(pool) {
  const correos = [ADMIN_TEMPORAL.correo, USUARIO_TEMPORAL.correo];
  const { rows } = await pool.query(
    'SELECT id FROM iam.dmt_usuario WHERE lower(correo) = ANY($1)',
    [correos],
  );
  const ids = rows.map((fila) => Number(fila.id));
  if (ids.length > 0) {
    const textos = ids.map(String);
    await pool.query(
      `DELETE FROM audit.dmt_auditoria
       WHERE usuario_id = ANY($1::bigint[])
          OR (entidad = $2 AND entidad_id = ANY($3::text[]))`,
      [ids, 'usuario', textos],
    );
    await pool.query('DELETE FROM iam.dmt_sesion WHERE usuario_id = ANY($1::bigint[])', [ids]);
    await pool.query('DELETE FROM operations.dmt_asignacion WHERE usuario_id = ANY($1::bigint[])', [ids]);
    await pool.query('DELETE FROM iam.dmt_usuario WHERE id = ANY($1::bigint[])', [ids]);
  }
  const {
    rows: [resto],
  } = await pool.query(
    `SELECT count(*)::int AS total FROM iam.dmt_usuario WHERE lower(correo) = ANY($1)`,
    [correos],
  );
  return { usuarios: ids.length, restantes: resto.total };
}

async function prepararAdminTemporal(pool) {
  await limpiarTemporales(pool);
  const { hash, sal } = credencialPbkdf2(ADMIN_TEMPORAL.clave);
  const { rows } = await pool.query(
    `INSERT INTO iam.dmt_usuario
       (nombre_usuario, nombre, correo, hash_clave, sal, administrador, solo_lectura, habilitado)
     VALUES ($1, $2, $3, $4, $5, true, false, true)
     RETURNING id, id_publico`,
    [ADMIN_TEMPORAL.nombreUsuario, ADMIN_TEMPORAL.nombre, ADMIN_TEMPORAL.correo, hash, sal],
  );
  return { id: Number(rows[0].id), idPublico: rows[0].id_publico };
}

function valorPrevio(equipo, clave) {
  const atributos = equipo.atributos ?? {};
  return Object.prototype.hasOwnProperty.call(atributos, clave) ? atributos[clave] : SIN_VALOR;
}

// Restaura solo las claves tocadas y el nombre original de los equipos usados.
async function restaurarEquipos(pool, tocados) {
  for (const cambio of tocados) {
    if (cambio.previo === SIN_VALOR) {
      await pool.query(
        'UPDATE tracking.dmt_dispositivo SET atributos = atributos - $2::text WHERE id = $1',
        [cambio.id, cambio.clave],
      );
    } else {
      await pool.query(
        `UPDATE tracking.dmt_dispositivo
         SET atributos = jsonb_set(atributos, ARRAY[$2::text], $3::jsonb, true)
         WHERE id = $1`,
        [cambio.id, cambio.clave, JSON.stringify(cambio.previo)],
      );
    }
    await pool.query(
      'UPDATE tracking.dmt_dispositivo SET nombre = $2, actualizado_en = now() WHERE id = $1',
      [cambio.id, cambio.nombre],
    );
  }
}

async function esperarServidor(hijosSalida) {
  const limite = Date.now() + 15000;
  while (Date.now() < limite) {
    try {
      const { estado } = await pedir('GET', '/health', { conCookie: false });
      if (estado === 200) return true;
    } catch {
      // El servidor aun no escucha; se reintenta.
    }
    await new Promise((resolver) => setTimeout(resolver, 250));
  }
  console.error('El servidor no respondio en 15 s. Ultimas lineas:');
  console.error(hijosSalida.join('').split('\n').slice(-20).join('\n'));
  return false;
}

async function principal() {
  const salida = [];
  const servidor = spawn(process.execPath, [path.join(DIRECTORIO, 'src', 'servidor.js')], {
    env: {
      ...process.env,
      DMJ_API_PORT: String(PUERTO),
      DMJ_API_HOST: '127.0.0.1',
      DMJ_ENTORNO: 'pruebas',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', (trozo) => salida.push(trozo.toString()));
  servidor.stderr.on('data', (trozo) => salida.push(trozo.toString()));

  let codigo = 0;
  let pool = null;
  let adminTemporal = null;
  let usuarioTemporal = null;
  const equiposTocados = [];
  try {
    if (!(await esperarServidor(salida))) {
      console.log('FAIL  servidor de prueba no disponible');
      falladas += 1;
      return;
    }

    // Publicas
    const health = await pedir('GET', '/health', { conCookie: false });
    comprobar('health 200 y estado ok', health.estado === 200 && health.json?.estado === 'ok', JSON.stringify(health.json));
    const ready = await pedir('GET', '/ready', { conCookie: false });
    comprobar(
      'ready 200 con baseDatos/tracking ok',
      ready.estado === 200 && ready.json?.dependencias?.baseDatos === 'ok' && ready.json?.dependencias?.tracking === 'ok',
      JSON.stringify(ready.json),
    );
    const version = await pedir('GET', '/version', { conCookie: false });
    comprobar(
      'version 200 con versionApi v1 y versionEsquema',
      version.estado === 200 && version.json?.versionApi === 'v1' && typeof version.json?.versionEsquema === 'string',
      JSON.stringify(version.json),
    );

    // Sin cookie
    const sinSesion = await pedir('GET', '/fleet', { conCookie: false });
    comprobar(
      'sin cookie 401 NO_AUTENTICADO',
      sinSesion.estado === 401 && sinSesion.json?.error?.codigo === 'NO_AUTENTICADO',
      JSON.stringify(sinSesion.json),
    );

    // Login
    const malLogin = await pedir('POST', '/auth/login', {
      conCookie: false,
      cuerpo: { usuario: EMAIL, clave: 'clave-incorrecta-smoke' },
    });
    comprobar('login con clave incorrecta 401', malLogin.estado === 401 && malLogin.json?.error?.codigo === 'NO_AUTENTICADO');

    const login = await pedir('POST', '/auth/login', { conCookie: false, cuerpo: { usuario: EMAIL, clave: CLAVE } });
    cookie = cookieDeRespuesta(login.cabeceras);
    const setCookie = (login.cabeceras.getSetCookie?.() ?? []).find((v) => v.startsWith('dmj_sesion=')) ?? '';
    comprobar(
      'login 200, cookie HttpOnly y SameSite=Lax',
      login.estado === 200 && cookie.startsWith('dmj_sesion=') && /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie),
      `estado=${login.estado}`,
    );

    const me = await pedir('GET', '/auth/me');
    comprobar('auth/me 200 con el usuario del login', me.estado === 200 && (me.json?.correo === EMAIL || me.json?.nombre === EMAIL), JSON.stringify(me.json));

    // Flota
    const flota = await pedir('GET', '/fleet?pagina=1&tamano=200');
    const dispositivos = flota.json?.datos ?? [];
    comprobar('fleet 200 paginado con datos', flota.estado === 200 && flota.json?.pagina === 1 && Array.isArray(dispositivos) && dispositivos.length >= 1, JSON.stringify(flota.json)?.slice(0, 200));
    const dispositivo = dispositivos[0];
    if (!dispositivo) throw new Error('smoke sin dispositivos visibles para la cuenta de prueba');

    const detalle = await pedir('GET', `/fleet/${dispositivo.id}`);
    comprobar('fleet/{id} 200 coincide el dispositivo', detalle.estado === 200 && detalle.json?.id === dispositivo.id, JSON.stringify(detalle.json)?.slice(0, 200));
    const detalleUuid = await pedir('GET', `/fleet/${dispositivo.idPublico}`);
    comprobar('fleet/{idPublico} 200', detalleUuid.estado === 200 && detalleUuid.json?.id === dispositivo.id);

    const posicion = await pedir('GET', `/fleet/${dispositivo.id}/position`);
    comprobar(
      'fleet/{id}/position 200 con latitud/registradoEn',
      posicion.estado === 200 && Number.isFinite(posicion.json?.latitud) && typeof posicion.json?.registradoEn === 'string',
      JSON.stringify(posicion.json)?.slice(0, 200),
    );

    const idsVisibles = new Set(dispositivos.map((fila) => String(fila.id)));
    const candidatoAjeno = [52, 56, 50, 47].find((id) => !idsVisibles.has(String(id))) ?? 999999;
    const ajeno = await pedir('GET', `/fleet/${candidatoAjeno}`);
    comprobar('fleet de dispositivo ajeno 404', ajeno.estado === 404 && ajeno.json?.error?.codigo === 'NO_ENCONTRADO', `id=${candidatoAjeno} estado=${ajeno.estado}`);

    // Vivo
    const vivo = await pedir('GET', '/positions/live');
    comprobar(
      'positions/live 200 con datos y refresco',
      vivo.estado === 200 && Array.isArray(vivo.json?.datos) && vivo.json.datos.length >= 1 && vivo.json?.intervaloRefrescoSegundos >= 1,
      JSON.stringify(vivo.json)?.slice(0, 200),
    );

    // Geocodificacion inversa desde la ultima posicion viva de la flota.
    // Sin red en el servidor, `direccion: null` tambien es valido.
    const ultimaViva = vivo.json?.datos?.[vivo.json.datos.length - 1];
    const geocode = ultimaViva
      ? await pedir(
          'GET',
          `/geocode/reverse?lat=${encodeURIComponent(ultimaViva.latitud)}&lon=${encodeURIComponent(ultimaViva.longitud)}`,
        )
      : { estado: 0, json: null };
    const direccion = geocode.json?.direccion;
    comprobar(
      'geocode/reverse 200 con direccion o null',
      geocode.estado === 200 && (direccion === null || (typeof direccion === 'string' && direccion.length > 0)),
      JSON.stringify(geocode.json)?.slice(0, 200),
    );
    console.log(
      typeof direccion === 'string' && direccion.length > 0
        ? `INFO  geocode/reverse direccion: ${direccion}`
        : 'INFO  geocode/reverse sin red o sin direccion: null es valido',
    );
    const geocodeRango = await pedir('GET', '/geocode/reverse?lat=999&lon=-79.8991');
    const geocodeSinLon = await pedir('GET', '/geocode/reverse?lat=-2.1577');
    comprobar(
      'geocode/reverse con parametros invalidos 400 DATOS_INVALIDOS',
      geocodeRango.estado === 400 &&
        geocodeRango.json?.error?.codigo === 'DATOS_INVALIDOS' &&
        geocodeSinLon.estado === 400 &&
        geocodeSinLon.json?.error?.codigo === 'DATOS_INVALIDOS',
      `rango estado=${geocodeRango.estado} sinLon estado=${geocodeSinLon.estado}`,
    );

    // Repetición de ruta: se usa la última semana, porque la prueba puede
    // correr de madrugada y "hoy" todavía no tiene datos.
    const desdePrueba = new Date(Date.now() - 7 * 86400_000).toISOString();
    const hastaPrueba = new Date().toISOString();
    const rangoPrueba = `?desde=${encodeURIComponent(desdePrueba)}&hasta=${encodeURIComponent(hastaPrueba)}`;
    const disponibles = await pedir('GET', `/replay${rangoPrueba}`);
    const recorrido = disponibles.json?.datos?.[0];
    comprobar(
      'replay (últimos 7 días) 200 con recorrido disponible',
      disponibles.estado === 200 && disponibles.json?.total >= 1 && recorrido?.totalPosiciones >= 1,
      JSON.stringify(disponibles.json)?.slice(0, 200),
    );
    if (recorrido) {
      const replay = await pedir(
        'GET',
        `/replay/${recorrido.idPublico}?desde=${encodeURIComponent(recorrido.desde)}&hasta=${encodeURIComponent(recorrido.hasta)}`,
      );
      comprobar(
        'replay/{deviceId} 200 con posiciones, huecos y resumen',
        replay.estado === 200 &&
          replay.json?.posiciones?.length >= 1 &&
          Array.isArray(replay.json?.huecos) &&
          replay.json?.resumen?.totalPosiciones === replay.json.posiciones.length,
        JSON.stringify(replay.json)?.slice(0, 200),
      );
      // Tramos reconstruidos {desde, hasta, metodo, mapaVersion, trazado}; se
      // acepta también la clave `estimados`.
      const tramos = replay.json?.reconstruidos ?? replay.json?.estimados ?? null;
      const claveTramos = replay.json?.reconstruidos !== undefined ? 'reconstruidos' : 'estimados';
      const formaTramo = (tramo) =>
        tramo !== null && typeof tramo === 'object' &&
        typeof tramo.desde === 'string' && typeof tramo.hasta === 'string' &&
        (tramo.metodo === 'MATCHED' || tramo.metodo === 'ESTIMATED') &&
        (tramo.mapaVersion === null || typeof tramo.mapaVersion === 'string') &&
        Array.isArray(tramo.trazado) && tramo.trazado.length >= 2;
      comprobar(
        `replay tramos (${claveTramos}) con metodo/mapaVersion/trazado`,
        replay.estado === 200 && (tramos === null || (Array.isArray(tramos) && tramos.every(formaTramo))),
        `clave=${claveTramos} total=${Array.isArray(tramos) ? tramos.length : 'n/a'}`,
      );
      if (replay.json?.reconstruidos !== undefined && replay.json?.estimados !== undefined) {
        comprobar(
          'replay expone reconstruidos sin duplicar estimados en el contrato final',
          false,
          'conviven ambas claves en transición; quitar estimados en Sprint 3',
        );
      }
    }

    // Jornadas: encendido/apagado del equipo de prueba el 25/09 (hora local).
    const rangoJornadas = '?desde=2026-09-25T00:00:00-05:00&hasta=2026-09-26T00:00:00-05:00';
    const jornadas = await pedir('GET', `/fleet/${dispositivo.idPublico}/journeys${rangoJornadas}`);
    const listaJornadas = jornadas.json?.jornadas ?? [];
    const iniciosJornadas = listaJornadas.map((fila) => Date.parse(fila.inicioEn));
    comprobar(
      'fleet/{id}/journeys 200 con jornadas del 25/09 en orden ascendente',
      jornadas.estado === 200 &&
        Array.isArray(jornadas.json?.jornadas) &&
        jornadas.json?.total === listaJornadas.length &&
        listaJornadas.length >= 1 &&
        listaJornadas.every(
          (fila) =>
            Number.isInteger(fila.id) &&
            typeof fila.inicioEn === 'string' &&
            (fila.finEn === null || typeof fila.finEn === 'string') &&
            Number.isFinite(fila.duracionMin) &&
            typeof fila.abierta === 'boolean',
        ) &&
        iniciosJornadas.every((valor, indice) => indice === 0 || iniciosJornadas[indice - 1] <= valor),
      JSON.stringify(jornadas.json)?.slice(0, 300),
    );
    const jornadasInexistentes = await pedir(
      'GET',
      '/fleet/00000000-0000-0000-0000-000000000000/journeys',
    );
    comprobar(
      'fleet/{id}/journeys de id inexistente 404 NO_ENCONTRADO',
      jornadasInexistentes.estado === 404 &&
        jornadasInexistentes.json?.error?.codigo === 'NO_ENCONTRADO',
      `estado=${jornadasInexistentes.estado}`,
    );
    const jornadasInvalidas = await pedir(
      'GET',
      `/fleet/${dispositivo.idPublico}/journeys?desde=ayer&hasta=hoy`,
    );
    comprobar(
      'fleet/{id}/journeys con fechas inválidas 400 DATOS_INVALIDOS',
      jornadasInvalidas.estado === 400 && jornadasInvalidas.json?.error?.codigo === 'DATOS_INVALIDOS',
      `estado=${jornadasInvalidas.estado}`,
    );

    // Jornadas de todos los equipos: filtro por equipo y fechas inválidas.
    const jornadaEquipo = await pedir(
      'GET',
      `/journeys${rangoJornadas}&dispositivoId=${encodeURIComponent(dispositivo.idPublico)}`,
    );
    const jornadasDelEquipo = jornadaEquipo.json?.datos ?? [];
    comprobar(
      'journeys con filtro por equipo 200 y trae la unidad pedida',
      jornadaEquipo.estado === 200 &&
        jornadaEquipo.json?.pagina === 1 &&
        Array.isArray(jornadaEquipo.json?.datos) &&
        jornadaEquipo.json?.total === jornadasDelEquipo.length &&
        jornadasDelEquipo.length >= 1 &&
        jornadasDelEquipo.every(
          (fila) =>
            Number.isInteger(fila.id) &&
            Number.isInteger(fila.dispositivoId) &&
            typeof fila.idPublico === 'string' &&
            typeof fila.nombre === 'string' &&
            String(fila.idPublico) === String(dispositivo.idPublico),
        ),
      JSON.stringify(jornadaEquipo.json)?.slice(0, 300),
    );
    const jornadasFlota = await pedir('GET', `/journeys${rangoJornadas}`);
    const listaFlota = jornadasFlota.json?.datos ?? [];
    const iniciosFlota = listaFlota.map((fila) => Date.parse(fila.inicioEn));
    comprobar(
      'journeys 25/09 200 con todas las unidades en orden ascendente',
      jornadasFlota.estado === 200 &&
        Array.isArray(jornadasFlota.json?.datos) &&
        jornadasFlota.json?.total === listaFlota.length &&
        listaFlota.length >= jornadasDelEquipo.length &&
        listaFlota.some((fila) => String(fila.idPublico) === String(dispositivo.idPublico)) &&
        iniciosFlota.every((valor, indice) => indice === 0 || iniciosFlota[indice - 1] <= valor),
      JSON.stringify(jornadasFlota.json)?.slice(0, 300),
    );
    const jornadasFlotaDiaSinDatos = await pedir(
      'GET',
      '/journeys?desde=2026-01-01T00:00:00-05:00&hasta=2026-01-02T00:00:00-05:00',
    );
    comprobar(
      'journeys de dia sin jornadas 200 con total 0',
      jornadasFlotaDiaSinDatos.estado === 200 && jornadasFlotaDiaSinDatos.json?.total === 0,
      `estado=${jornadasFlotaDiaSinDatos.estado}`,
    );
    const jornadasFlotaInvalidas = await pedir('GET', '/journeys?desde=ayer&hasta=hoy');
    comprobar(
      'journeys con fechas inválidas 400 DATOS_INVALIDOS',
      jornadasFlotaInvalidas.estado === 400 && jornadasFlotaInvalidas.json?.error?.codigo === 'DATOS_INVALIDOS',
      `estado=${jornadasFlotaInvalidas.estado}`,
    );

    // Reportes
    const viajes = await pedir('GET', `/reports/trips${rangoPrueba}`);
    comprobar('reports/trips 200 paginado con viajes', viajes.estado === 200 && viajes.json?.total >= 1 && viajes.json?.datos?.[0]?.origen?.latitud !== undefined, JSON.stringify(viajes.json)?.slice(0, 200));
    const paradas = await pedir('GET', `/reports/stops${rangoPrueba}`);
    comprobar('reports/stops 200 paginado con paradas', paradas.estado === 200 && paradas.json?.total >= 1 && paradas.json?.pagina === 1, JSON.stringify(paradas.json)?.slice(0, 200));
    const resumen = await pedir('GET', `/reports/summary${rangoPrueba}`);
    comprobar(
      'reports/summary 200 con totales y desglose',
      resumen.estado === 200 && resumen.json?.dispositivos >= 1 && resumen.json?.posiciones >= 1 && Array.isArray(resumen.json?.porDispositivo),
      JSON.stringify(resumen.json)?.slice(0, 200),
    );

    // Bateria
    const bateria = await pedir('GET', '/battery');
    comprobar('battery 200 paginado', bateria.estado === 200 && bateria.json?.total >= 1 && Array.isArray(bateria.json?.datos), JSON.stringify(bateria.json)?.slice(0, 200));
    const bateriaDispositivo = await pedir('GET', `/battery/${dispositivo.id}`);
    comprobar(
      'battery/{deviceId} 200 con muestras',
      bateriaDispositivo.estado === 200 && Array.isArray(bateriaDispositivo.json?.muestras) && bateriaDispositivo.json.muestras.length >= 1,
      JSON.stringify(bateriaDispositivo.json)?.slice(0, 200),
    );

    // Salud: estado con causa por equipo (pide sesión).
    const salud = await pedir('GET', '/salud');
    const estadosSalud = new Set(['HEALTHY', 'DEGRADED', 'OFFLINE', 'RECOVERING', 'MISCONFIGURED']);
    const filaSaludOk = (fila) =>
      fila !== null && typeof fila === 'object' &&
      Number.isInteger(fila.dispositivoId) &&
      estadosSalud.has(fila.estado) &&
      typeof fila.causa === 'string' && fila.causa.length > 0 &&
      ('lastFixAgeS' in fila) && ('uploadLagS' in fila) && ('captureGapS' in fila) &&
      ('bufferDepth' in fila) && ('bateriaPct' in fila) && ('cargando' in fila) &&
      ('gps' in fila) && ('permisos' in fila) && ('bateriaExenta' in fila) &&
      ('fgs' in fila) && ('jornada' in fila) && ('red' in fila) &&
      ('bootId' in fila) && ('recoveryCount' in fila) && ('appVersion' in fila) &&
      ('android' in fila) && ('fabricante' in fila) && ('modelo' in fila);
    comprobar(
      'salud 200 con datos y causa por equipo',
      salud.estado === 200 && Array.isArray(salud.json?.datos) &&
      salud.json.datos.length >= 1 && salud.json.datos.every(filaSaludOk),
      `estado=${salud.estado} total=${salud.json?.datos?.length ?? 'n/a'}`,
    );
    const saludSinSesion = await pedir('GET', '/salud', { conCookie: false });
    comprobar(
      'salud sin cookie 401 NO_AUTENTICADO',
      saludSinSesion.estado === 401 && saludSinSesion.json?.error?.codigo === 'NO_AUTENTICADO',
      `estado=${saludSinSesion.estado}`,
    );

    // Usuarios: usuario normal no administra
    const usuarios = await pedir('GET', '/users');
    comprobar('users sin ser administrador 403 SIN_PERMISO', usuarios.estado === 403 && usuarios.json?.error?.codigo === 'SIN_PERMISO', JSON.stringify(usuarios.json));
    const usuarioDetalle = await pedir('GET', `/users/${me.json?.id ?? 9}`);
    comprobar('users/{id} sin ser administrador 403 SIN_PERMISO', usuarioDetalle.estado === 403 && usuarioDetalle.json?.error?.codigo === 'SIN_PERMISO', JSON.stringify(usuarioDetalle.json));

    // Paginacion invalida
    const invalido = await pedir('GET', '/fleet?tamano=9999');
    comprobar('parametro invalido 400 DATOS_INVALIDOS', invalido.estado === 400 && invalido.json?.error?.codigo === 'DATOS_INVALIDOS');

    // Config
    const config = await pedir('GET', '/config');
    comprobar(
      'config 200 con mapa y capacidades',
      config.estado === 200 && config.json?.versionApi === 'v1' && typeof config.json?.mapa?.estiloUrl === 'string' && typeof config.json?.capacidades?.replay === 'boolean',
      JSON.stringify(config.json)?.slice(0, 200),
    );

    // Logout
    const logout = await pedir('POST', '/auth/logout');
    comprobar('logout 204', logout.estado === 204);
    const despues = await pedir('GET', '/auth/me');
    comprobar('auth/me tras logout 401', despues.estado === 401 && despues.json?.error?.codigo === 'NO_AUTENTICADO');

    // Administrador opcional (si se entregan credenciales por entorno)
    if (ADMIN_EMAIL && ADMIN_CLAVE) {
      const loginAdmin = await pedir('POST', '/auth/login', { conCookie: false, cuerpo: { usuario: ADMIN_EMAIL, clave: ADMIN_CLAVE } });
      const cookieAdmin = cookieDeRespuesta(loginAdmin.cabeceras);
      const usuariosAdmin = await pedir('GET', '/users', { cookieExtra: cookieAdmin });
      comprobar('users como administrador 200', usuariosAdmin.estado === 200 && usuariosAdmin.json?.total >= 1, `estado=${usuariosAdmin.estado}`);
      const primerUsuario = usuariosAdmin.json?.datos?.[0];
      if (primerUsuario) {
        const detalleAdmin = await pedir('GET', `/users/${primerUsuario.id}`, { cookieExtra: cookieAdmin });
        comprobar('users/{id} como administrador 200', detalleAdmin.estado === 200 && detalleAdmin.json?.id === primerUsuario.id);
      }
      await pedir('POST', '/auth/logout', { cookieExtra: cookieAdmin });
    } else {
      console.log('INFO  users como administrador: omitido (defina DMJ_TEST_ADMIN_EMAIL/DMJ_TEST_ADMIN_PASSWORD)');
    }

    // -----------------------------------------------------------------------
    // Escritura: usuarios y configuración de equipos
    // -----------------------------------------------------------------------
    const entorno = cargarEntorno();
    pool = crearPool(entorno.db);
    adminTemporal = await prepararAdminTemporal(pool);
    const loginAdminTemporal = await pedir('POST', '/auth/login', {
      conCookie: false,
      cuerpo: { usuario: ADMIN_TEMPORAL.correo, clave: ADMIN_TEMPORAL.clave },
    });
    const cookieAdminTemporal = cookieDeRespuesta(loginAdminTemporal.cabeceras);
    comprobar(
      'admin temporal creado por SQL y login 200',
      loginAdminTemporal.estado === 200 && cookieAdminTemporal.startsWith('dmj_sesion='),
      `estado=${loginAdminTemporal.estado}`,
    );

    const { rows: equipos } = await pool.query(
      `SELECT id, id_legado, id_publico, nombre, atributos
       FROM tracking.dmt_dispositivo
       WHERE habilitado
       ORDER BY id
       LIMIT 2`,
    );
    const [equipoA, equipoB] = equipos;
    if (!equipoA || !equipoB) throw new Error('smoke de escritura sin dos equipos habilitados');

    const creacion = await pedir('POST', '/users', {
      cookieExtra: cookieAdminTemporal,
      cuerpo: {
        nombre: USUARIO_TEMPORAL.nombre,
        correo: USUARIO_TEMPORAL.correo,
        clave: USUARIO_TEMPORAL.clave,
        dispositivoIds: [equipoA.id_publico],
      },
    });
    usuarioTemporal = creacion.json?.usuario ?? null;
    comprobar(
      'POST /users 201 crea usuario con dispositivoIds',
      creacion.estado === 201 &&
        usuarioTemporal?.correo === USUARIO_TEMPORAL.correo &&
        usuarioTemporal?.administrador === false &&
        usuarioTemporal?.dispositivoIds?.includes(equipoA.id_publico),
      `estado=${creacion.estado} ${JSON.stringify(creacion.json)?.slice(0, 200)}`,
    );
    if (!usuarioTemporal) throw new Error('no se pudo crear el usuario de prueba');

    const {
      rows: [creadoBd],
    } = await pool.query(
      `SELECT u.nombre_usuario, u.hash_clave, u.sal
       FROM iam.dmt_usuario u WHERE u.id = $1`,
      [usuarioTemporal.id],
    );
    comprobar(
      'credencial PBKDF2 heredada (48 hex) y nombre_usuario derivado del correo',
      creadoBd?.nombre_usuario === 'prueba-usuario' &&
        /^[0-9a-f]{48}$/.test(creadoBd?.hash_clave ?? '') &&
        /^[0-9a-f]{48}$/.test(creadoBd?.sal ?? '') &&
        verificarClave(USUARIO_TEMPORAL.clave, creadoBd?.hash_clave, creadoBd?.sal),
    );

    const {
      rows: [asignacionInicial],
    } = await pool.query(
      `SELECT count(*)::int AS total FROM operations.dmt_asignacion
       WHERE usuario_id = $1 AND dispositivo_id = $2 AND activa`,
      [usuarioTemporal.id, equipoA.id],
    );
    comprobar(
      'asignacion activa del equipo A en operations.dmt_asignacion',
      asignacionInicial.total === 1,
      `total=${asignacionInicial.total}`,
    );

    const loginUsuario = await pedir('POST', '/auth/login', {
      conCookie: false,
      cuerpo: { usuario: USUARIO_TEMPORAL.correo, clave: USUARIO_TEMPORAL.clave },
    });
    const cookieUsuario = cookieDeRespuesta(loginUsuario.cabeceras);
    comprobar(
      'login del usuario nuevo 200',
      loginUsuario.estado === 200 && cookieUsuario.startsWith('dmj_sesion='),
      `estado=${loginUsuario.estado}`,
    );

    const sincronizacion = await pedir('PUT', `/users/${usuarioTemporal.idPublico}`, {
      cookieExtra: cookieAdminTemporal,
      cuerpo: { dispositivoIds: [String(equipoB.id_legado ?? equipoB.id)] },
    });
    const { rows: asignaciones } = await pool.query(
      `SELECT dispositivo_id, activa, hasta_en FROM operations.dmt_asignacion
       WHERE usuario_id = $1 ORDER BY id`,
      [usuarioTemporal.id],
    );
    const asignacionA = asignaciones.find((fila) => String(fila.dispositivo_id) === String(equipoA.id));
    const asignacionB = asignaciones.find((fila) => String(fila.dispositivo_id) === String(equipoB.id));
    comprobar(
      'PUT /users sincroniza equipos: activa B y desactiva A conservando historico',
      sincronizacion.estado === 200 &&
        asignacionA?.activa === false &&
        asignacionA?.hasta_en !== null &&
        asignacionB?.activa === true &&
        asignacionB?.hasta_en === null &&
        sincronizacion.json?.usuario?.dispositivoIds?.includes(equipoB.id_publico) &&
        !sincronizacion.json?.usuario?.dispositivoIds?.includes(equipoA.id_publico),
      `estado=${sincronizacion.estado}`,
    );
    if (!asignacionB) throw new Error('la sincronizacion no dejo el equipo B activo');

    const edicion = await pedir('PUT', `/users/${usuarioTemporal.idPublico}`, {
      cookieExtra: cookieAdminTemporal,
      cuerpo: { nombre: USUARIO_TEMPORAL.nombreEditado, clave: USUARIO_TEMPORAL.claveNueva },
    });
    comprobar(
      'PUT /users edita nombre y clave',
      edicion.estado === 200 && edicion.json?.usuario?.nombre === USUARIO_TEMPORAL.nombreEditado,
      `estado=${edicion.estado}`,
    );
    const loginClaveNueva = await pedir('POST', '/auth/login', {
      conCookie: false,
      cuerpo: { usuario: USUARIO_TEMPORAL.correo, clave: USUARIO_TEMPORAL.claveNueva },
    });
    comprobar('login con la clave nueva 200', loginClaveNueva.estado === 200);
    const loginClaveVieja = await pedir('POST', '/auth/login', {
      conCookie: false,
      cuerpo: { usuario: USUARIO_TEMPORAL.correo, clave: USUARIO_TEMPORAL.clave },
    });
    comprobar('login con la clave anterior 401', loginClaveVieja.estado === 401);
    const claveVacia = await pedir('PUT', `/users/${usuarioTemporal.idPublico}`, {
      cookieExtra: cookieAdminTemporal,
      cuerpo: { nombre: USUARIO_TEMPORAL.nombreEditado, clave: '' },
    });
    const loginTrasVacia = await pedir('POST', '/auth/login', {
      conCookie: false,
      cuerpo: { usuario: USUARIO_TEMPORAL.correo, clave: USUARIO_TEMPORAL.claveNueva },
    });
    comprobar(
      'PUT /users con clave vacia no cambia la credencial',
      claveVacia.estado === 200 && loginTrasVacia.estado === 200,
      `estado=${claveVacia.estado}`,
    );

    const crearNoAdmin = await pedir('POST', '/users', {
      cookieExtra: cookieUsuario,
      cuerpo: { nombre: 'No permitido', correo: 'no-permitido@dmujeres.local', clave: 'ClaveNoPermitida1!' },
    });
    comprobar(
      'POST /users con usuario no admin 403 SIN_PERMISO',
      crearNoAdmin.estado === 403 && crearNoAdmin.json?.error?.codigo === 'SIN_PERMISO',
      `estado=${crearNoAdmin.estado}`,
    );
    const borrarNoAdmin = await pedir('DELETE', `/users/${usuarioTemporal.idPublico}`, {
      cookieExtra: cookieUsuario,
    });
    comprobar(
      'DELETE /users con usuario no admin 403 SIN_PERMISO',
      borrarNoAdmin.estado === 403 && borrarNoAdmin.json?.error?.codigo === 'SIN_PERMISO',
    );

    const claveMerge = 'mobile.intervalSeconds';
    equiposTocados.push({
      id: equipoA.id,
      nombre: equipoA.nombre,
      clave: claveMerge,
      previo: valorPrevio(equipoA, claveMerge),
    });
    const configAdmin = await pedir('PUT', `/fleet/${equipoA.id_publico}`, {
      cookieExtra: cookieAdminTemporal,
      cuerpo: { nombre: `${equipoA.nombre}-smoke4b`, configuracion: { [claveMerge]: 45 } },
    });
    const {
      rows: [filaMerge],
    } = await pool.query(
      `SELECT d.nombre, d.atributos ? 'mobile.journeyId' AS conserva_journey,
              d.atributos->>'mobile.intervalSeconds' AS intervalo
       FROM tracking.dmt_dispositivo d WHERE d.id = $1`,
      [equipoA.id],
    );
    comprobar(
      'PUT /fleet aplica whitelist y nombre',
      configAdmin.estado === 200 &&
        configAdmin.json?.dispositivo?.configuracion?.[claveMerge] === 45 &&
        configAdmin.json?.dispositivo?.nombre === `${equipoA.nombre}-smoke4b`,
      `estado=${configAdmin.estado}`,
    );
    comprobar(
      'merge conserva las demas claves de atributos',
      filaMerge?.conserva_journey === true && filaMerge?.intervalo === '45',
      JSON.stringify(filaMerge),
    );

    const configInvalida = await pedir('PUT', `/fleet/${equipoA.id_publico}`, {
      cookieExtra: cookieAdminTemporal,
      cuerpo: { configuracion: { 'mobile.noPermitida': 1 } },
    });
    comprobar(
      'PUT /fleet rechaza claves fuera de la whitelist 400',
      configInvalida.estado === 400 && configInvalida.json?.error?.codigo === 'DATOS_INVALIDOS',
      `estado=${configInvalida.estado}`,
    );

    const claveUsuario = 'mobile.bufferMax';
    equiposTocados.push({
      id: equipoB.id,
      nombre: equipoB.nombre,
      clave: claveUsuario,
      previo: valorPrevio(equipoB, claveUsuario),
    });
    const configUsuario = await pedir('PUT', `/fleet/${equipoB.id_publico}`, {
      cookieExtra: cookieUsuario,
      cuerpo: { configuracion: { [claveUsuario]: 7 } },
    });
    const configAjeno = await pedir('PUT', `/fleet/${equipoA.id_publico}`, {
      cookieExtra: cookieUsuario,
      cuerpo: { configuracion: { 'mobile.distanceMeters': 10 } },
    });
    comprobar(
      'PUT /fleet: equipo asignado 200 (no admin) y equipo ajeno 404',
      configUsuario.estado === 200 &&
        configAjeno.estado === 404 &&
        configAjeno.json?.error?.codigo === 'NO_ENCONTRADO',
      `asignado=${configUsuario.estado} ajeno=${configAjeno.estado}`,
    );
    comprobar(
      'configuracion solo para administradores',
      configAdmin.json?.dispositivo?.configuracion !== null &&
        configUsuario.json?.dispositivo?.configuracion === null,
    );

    const autoborrado = await pedir('DELETE', `/users/${adminTemporal.idPublico}`, {
      cookieExtra: cookieAdminTemporal,
    });
    comprobar(
      '400 al intentar borrar el ultimo admin (auto-borrado)',
      autoborrado.estado === 400 &&
        autoborrado.json?.error?.codigo === 'DATOS_INVALIDOS' &&
        /propia cuenta|administrador/i.test(autoborrado.json?.error?.mensaje ?? ''),
      `estado=${autoborrado.estado} ${JSON.stringify(autoborrado.json)}`,
    );
    comprobar(
      'guarda de ultimo administrador activo (funcion de decision)',
      motivoRechazoEliminacion({ esEjecutor: false, objetivoEsAdminActivo: true, administradoresActivos: 1 }) === 'ultimo_administrador' &&
        motivoRechazoEliminacion({ esEjecutor: true, objetivoEsAdminActivo: true, administradoresActivos: 3 }) === 'autoborrado' &&
        motivoRechazoEliminacion({ esEjecutor: false, objetivoEsAdminActivo: false, administradoresActivos: 5 }) === null,
    );

    const baja = await pedir('DELETE', `/users/${usuarioTemporal.idPublico}`, {
      cookieExtra: cookieAdminTemporal,
    });
    const {
      rows: [bajaBd],
    } = await pool.query('SELECT habilitado FROM iam.dmt_usuario WHERE id = $1', [usuarioTemporal.id]);
    const {
      rows: [activasTrasBaja],
    } = await pool.query(
      'SELECT count(*)::int AS total FROM operations.dmt_asignacion WHERE usuario_id = $1 AND activa',
      [usuarioTemporal.id],
    );
    const {
      rows: [sesionesTrasBaja],
    } = await pool.query(
      'SELECT count(*)::int AS total FROM iam.dmt_sesion WHERE usuario_id = $1 AND revocada_en IS NULL',
      [usuarioTemporal.id],
    );
    const loginTrasBaja = await pedir('POST', '/auth/login', {
      conCookie: false,
      cuerpo: { usuario: USUARIO_TEMPORAL.correo, clave: USUARIO_TEMPORAL.claveNueva },
    });
    comprobar(
      'DELETE /users 204 con baja logica y limpieza de sesiones/asignaciones',
      baja.estado === 204 &&
        bajaBd?.habilitado === false &&
        activasTrasBaja.total === 0 &&
        sesionesTrasBaja.total === 0,
      `estado=${baja.estado}`,
    );
    comprobar('login tras la baja 401', loginTrasBaja.estado === 401);

    const {
      rows: [auditoria],
    } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (
                WHERE datos::text LIKE '%ClaveUsuarioTemporal1!%'
                   OR datos::text LIKE '%ClaveAdminTemporal1!%'
              )::int AS con_claves
       FROM audit.dmt_auditoria
       WHERE usuario_id = ANY($1::bigint[])
         AND accion IN ('crear_usuario', 'editar_usuario', 'eliminar_usuario', 'editar_dispositivo')`,
      [[adminTemporal.id, usuarioTemporal.id]],
    );
    comprobar(
      'auditoria registra las escrituras sin claves ni hashes',
      auditoria.total >= 7 && auditoria.con_claves === 0,
      `total=${auditoria.total} conClaves=${auditoria.con_claves}`,
    );
  } catch (error) {
    falladas += 1;
    console.log(`FAIL  excepción en el smoke -> ${error.message}`);
  } finally {
    if (pool) {
      try {
        await restaurarEquipos(pool, equiposTocados);
        const limpieza = await limpiarTemporales(pool);
        comprobar(
          'limpieza del bloque de escritura (usuarios, sesiones, asignaciones, auditoria)',
          limpieza.restantes === 0,
          `restantes=${limpieza.restantes}`,
        );
      } catch (error) {
        falladas += 1;
        console.log(`FAIL  limpieza del bloque de escritura -> ${error.message}`);
      }
      await pool.end().catch(() => {});
    }
    servidor.kill('SIGTERM');
    const apagado = new Promise((resolver) => servidor.once('exit', resolver));
    const forzar = setTimeout(() => servidor.kill('SIGKILL'), 5000);
    await apagado;
    clearTimeout(forzar);
    if (falladas > 0) codigo = 1;
    console.log(`\nSmoke API v1: ${pasadas} PASS, ${falladas} FAIL`);
    console.log(codigo === 0 ? 'RESULTADO: PASS' : 'RESULTADO: FAIL');
  }
  process.exit(codigo);
}

principal();
