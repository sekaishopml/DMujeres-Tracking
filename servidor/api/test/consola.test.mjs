import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretar } from '../src/consola.js';

test('la consola separa persona y cantidad y solo deja leer con sql', () => {
  assert.deepEqual(interpretar('posiciones Maria Perez 50'), { nombre: 'posiciones', persona: 'Maria Perez', cantidad: 50 });
  assert.deepEqual(interpretar('bateria maria'), { nombre: 'bateria', persona: 'maria', cantidad: 30 });
  assert.equal(interpretar('posiciones ana 9999').cantidad, 200);
  assert.equal(interpretar('sql select 1;').consulta, 'select 1');
  assert.throws(() => interpretar('sql delete from tracking.dmt_posicion'));
  assert.throws(() => interpretar('posicion'));
  assert.throws(() => interpretar('borrar todo'));
});
