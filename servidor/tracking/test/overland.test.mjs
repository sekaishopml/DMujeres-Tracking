import test from 'node:test';
import assert from 'node:assert/strict';
import { atenderOverland, posicionDeOverland } from '../src/overland.js';

// Punto tal como lo manda la app (README de Overland).
const punto = (extra = {}, coordenadas = [-79.9, -2.19]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: coordenadas },
  properties: {
    timestamp: '2026-10-09T15:00:00Z',
    altitude: 12,
    speed: 4,
    course: 90,
    horizontal_accuracy: 8,
    motion: ['driving'],
    battery_state: 'charging',
    battery_level: 0.8,
    device_id: 'iphone-1',
    ...extra,
  },
});

test('convierte unidades: m/s a km/h y batería de 0–1 a porcentaje', () => {
  const p = posicionDeOverland(punto());
  assert.equal(p.latitud, -2.19);
  assert.equal(p.longitud, -79.9);
  assert.equal(p.velocidadKmh, 14.4);
  assert.equal(p.bateria, 80);
  assert.equal(p.precision, 8);
  assert.equal(p.rumbo, 90);
  assert.equal(p.registradoEn.toISOString(), '2026-10-09T15:00:00.000Z');
  assert.deepEqual(p.atributos, { charging: true, movementState: 'driving' });
});

test('los -1 de Overland quedan como dato ausente', () => {
  const p = posicionDeOverland(punto({ speed: -1, course: -1, horizontal_accuracy: -1, battery_level: -1, battery_state: 'unknown', motion: [] }));
  assert.equal(p.velocidadKmh, null);
  assert.equal(p.rumbo, null);
  assert.equal(p.precision, null);
  assert.equal(p.bateria, null);
  assert.deepEqual(p.atributos, {});
});

test('un punto sin hora o sin coordenadas no se guarda', () => {
  assert.equal(posicionDeOverland(punto({ timestamp: 'ayer' })), null);
  assert.equal(posicionDeOverland(punto({}, [null, 5])), null);
  assert.equal(posicionDeOverland(punto({}, [-79.9, 95])), null);
  assert.equal(posicionDeOverland({}), null);
});

// Pedido y respuesta de mentira para probar el receptor sin red ni base.
async function pedir({ id = 'iphone-1', cuerpo, dispositivo = { id: 7, habilitado: true }, falla = false }) {
  const req = { method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(cuerpo)); } };
  const salida = {};
  const res = { writeHead: (codigo) => { salida.codigo = codigo; }, end: (texto) => { salida.cuerpo = JSON.parse(texto); } };
  const guardados = [];
  const ctx = {
    url: new URL(`http://x/overland${id ? `?id=${id}` : ''}`),
    log: { error() {} },
    almacen: {
      buscarDispositivo: async (cual) => { salida.buscado = cual; return dispositivo; },
      registrarLotePosiciones: async (dispositivoId, posiciones) => {
        if (falla) throw new Error('sin base');
        guardados.push({ dispositivoId, posiciones });
      },
    },
  };
  await atenderOverland(req, res, ctx);
  return { ...salida, guardados };
}

test('guarda el lote y responde lo que la app espera para borrarlo', async () => {
  const r = await pedir({ cuerpo: { locations: [punto(), punto({ timestamp: '2026-10-09T15:00:10Z' }), punto({ timestamp: 'mal' })] } });
  assert.equal(r.codigo, 200);
  assert.deepEqual(r.cuerpo, { result: 'ok' });
  assert.equal(r.guardados[0].dispositivoId, 7);
  assert.equal(r.guardados[0].posiciones.length, 2);
});

test('sin id en la URL usa el device_id de la app', async () => {
  const r = await pedir({ id: '', cuerpo: { locations: [punto()] } });
  assert.equal(r.buscado, 'iphone-1');
  assert.equal(r.codigo, 200);
});

test('si la base falla no responde ok: la app conserva el lote y reintenta', async () => {
  const r = await pedir({ cuerpo: { locations: [punto()] }, falla: true });
  assert.equal(r.codigo, 503);
  assert.notEqual(r.cuerpo.result, 'ok');
});

test('equipo desconocido: 404; equipo deshabilitado: ok sin guardar', async () => {
  assert.equal((await pedir({ cuerpo: { locations: [punto()] }, dispositivo: null })).codigo, 404);
  const r = await pedir({ cuerpo: { locations: [punto()] }, dispositivo: { id: 7, habilitado: false } });
  assert.deepEqual(r.cuerpo, { result: 'ok' });
  assert.equal(r.guardados.length, 0);
});
