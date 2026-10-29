import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puedeEnviar } from '../src/reporte.js';

test('como mucho 10 envíos por teléfono por hora', () => {
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < 10; i += 1) assert.equal(puedeEnviar('A', t0 + i), true);
  assert.equal(puedeEnviar('A', t0 + 20), false);
  // Otro teléfono no se ve afectado, y pasada la hora vuelve a poder.
  assert.equal(puedeEnviar('B', t0 + 20), true);
  assert.equal(puedeEnviar('A', t0 + 3_600_001), true);
});
