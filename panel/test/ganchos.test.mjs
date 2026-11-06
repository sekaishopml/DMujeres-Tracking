import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinPicos } from '../src/componentes/replay/flechas.ts';

// Metros a [lon, lat] cerca de Quito.
const v = (esteM, norteM) => [-78.49 + esteM / 111320, -0.18 + norteM / 111320];

test('el ajuste a calles pierde el gancho a la otra calzada (Diego 05/11)', () => {
  const linea = [v(-249, -372), v(-222, -338), v(-229, -335), v(-234, -333), v(-232, -329), v(-220, -287)];
  assert.ok(!sinPicos(linea).some(([lon, lat]) => lon === linea[1][0] && lat === linea[1][1]));
});

test('una esquina de verdad se queda', () => {
  const linea = [v(0, 0), v(0, 80), v(80, 80)];
  assert.equal(sinPicos(linea).length, 3);
});
