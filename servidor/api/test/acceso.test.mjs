import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutosBloqueo } from '../../comun/acceso.js';

test('minutos que faltan de un bloqueo', () => {
  const ahora = Date.UTC(2026, 9, 7, 12, 0);
  assert.equal(minutosBloqueo(null, ahora), 0);
  assert.equal(minutosBloqueo(new Date(ahora - 1000), ahora), 0);
  assert.equal(minutosBloqueo(new Date(ahora + 14 * 60_000 + 1), ahora), 15);
  assert.equal(minutosBloqueo(new Date(ahora + 30_000).toISOString(), ahora), 1);
});
