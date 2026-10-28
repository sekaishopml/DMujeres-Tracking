import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { aUsuario } from '../src/dto.js';
import { PREDICADO_PERMISO, permisoDe } from '../src/flota.js';
import { exigirAccesoDeRuta } from '../src/permisos.js';
import { ASIGNABLES, POR_DEFECTO, seccionDeRuta, seccionesDe } from '../src/secciones.js';
import {
  actualizarCuentaPanel,
  crearCuentaPanel,
  listarCuentasPanel,
  seccionesValidas,
  tipoDe,
} from '../src/panel.js';

const sinRoles = { query: async () => ({ rows: [] }) };
const cuenta = (extra) => aUsuario({ id: 7, id_publico: 'x', nombre: 'n', habilitado: true, ...extra });
const ctxDe = (usuario, metodo, camino) => ({
  usuario,
  pool: sinRoles,
  req: { method: metodo },
  url: new URL(camino, 'http://interno'),
});
const rechaza = (promesa, estado) =>
  assert.rejects(promesa, (e) => e.estado === estado);

test('secciones: administradora todas, las demás su lista sin las exclusivas', () => {
  assert.ok(seccionesDe(true, {}).includes('sistema'));
  assert.deepEqual(seccionesDe(false, {}), POR_DEFECTO);
  const asignadas = seccionesDe(false, { panel: { secciones: ['inicio', 'sistema', 'usuarios'] } });
  assert.deepEqual(asignadas, ['inicio', 'usuarios']);
  assert.deepEqual(seccionesDe(false, { panel: { secciones: [] } }), []);
});

test('la sesión trae las secciones y si es solo lectura', () => {
  const u = cuenta({ solo_lectura: true, atributos: { panel: { secciones: ['inicio'] } } });
  assert.deepEqual(u.secciones, ['inicio']);
  assert.equal(u.soloLectura, true);
  assert.ok(cuenta({ administrador: true }).secciones.includes('configuracion'));
});

test('validar secciones rechaza desconocidas y las exclusivas de administración', () => {
  assert.deepEqual(seccionesValidas(['inicio', 'inicio', 'bateria']), ['inicio', 'bateria']);
  assert.throws(() => seccionesValidas(['sistema']), /solo de administradores/);
  assert.throws(() => seccionesValidas(['nada']), /no existe/);
  assert.throws(() => seccionesValidas('inicio'), /lista/);
  assert.ok(!ASIGNABLES.includes('configuracion'));
});

test('tipo de cuenta según las marcas', () => {
  assert.equal(tipoDe({ administrador: true, solo_lectura: true }), 'administrador');
  assert.equal(tipoDe({ administrador: false, solo_lectura: true }), 'solo_lectura');
  assert.equal(tipoDe({}), 'operador');
});

test('rutas de administración dependen de su sección', () => {
  assert.equal(seccionDeRuta('/api/v1/usuarios'), 'usuarios');
  assert.equal(seccionDeRuta('/api/v1/usuarios/5/equipos'), 'usuarios');
  assert.equal(seccionDeRuta('/api/v1/grupos/3'), 'grupos');
  assert.equal(seccionDeRuta('/api/v1/salud/historial'), 'sistema');
  assert.equal(seccionDeRuta('/api/v1/usuariosx'), null);
  assert.equal(seccionDeRuta('/api/v1/fleet'), null);
});

test('solo lectura: el servidor rechaza toda escritura, no solo se ocultan botones', async () => {
  const lector = cuenta({ solo_lectura: true });
  await rechaza(exigirAccesoDeRuta(ctxDe(lector, 'PUT', '/api/v1/fleet/1')), 403);
  await rechaza(exigirAccesoDeRuta(ctxDe(lector, 'POST', '/api/v1/panel/cuentas')), 403);
  await exigirAccesoDeRuta(ctxDe(lector, 'GET', '/api/v1/fleet'));
  await exigirAccesoDeRuta(ctxDe(lector, 'POST', '/api/v1/auth/logout'));
});

test('una sección no asignada se rechaza aunque se manipule el navegador', async () => {
  const sin = cuenta({ atributos: { panel: { secciones: ['inicio'] } } });
  await rechaza(exigirAccesoDeRuta(ctxDe(sin, 'GET', '/api/v1/usuarios')), 403);
  const con = cuenta({ atributos: { panel: { secciones: ['inicio', 'usuarios'] } } });
  await exigirAccesoDeRuta(ctxDe(con, 'GET', '/api/v1/usuarios'));
  await exigirAccesoDeRuta(ctxDe(cuenta({ administrador: true }), 'GET', '/api/v1/usuarios'));
});

test('solo una administradora maneja cuentas de panel y nadie amplía lo suyo', async () => {
  const operador = cuenta({});
  const lector = cuenta({ solo_lectura: true });
  for (const quien of [operador, lector]) {
    const ctx = { usuario: quien, pool: sinRoles, params: { id: '7' } };
    await rechaza(listarCuentasPanel(ctx), 403);
    await rechaza(crearCuentaPanel(ctx), 403);
    await rechaza(actualizarCuentaPanel(ctx), 403);
  }
});

test('el permiso: la administradora ve todo; las demás pasan por su id', () => {
  assert.equal(permisoDe(cuenta({ administrador: true })), null);
  assert.equal(permisoDe(cuenta({})), 7);
});

test('el predicado cubre propios, personas elegidas y grupos', () => {
  assert.match(PREDICADO_PERMISO, /a\.usuario_id = \$1/);
  assert.match(PREDICADO_PERMISO, /dmt_panel_persona/);
  assert.match(PREDICADO_PERMISO, /dmt_panel_grupo[\s\S]*dmt_usuario_grupo/);
  assert.match(PREDICADO_PERMISO, /\$1::bigint IS NULL/);
});

test('ninguna consulta repite el permiso a mano: todas usan PREDICADO_PERMISO', () => {
  const dir = new URL('../src/', import.meta.url);
  for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    if (archivo === 'flota.js') continue;
    const texto = readFileSync(new URL(archivo, dir), 'utf8');
    assert.ok(!/a\.dispositivo_id = d\.id AND a\.usuario_id = \$1/.test(texto), `${archivo} copia el permiso`);
  }
});
