import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cambioDeSilencio } from '../src/monitor.js';

const equipo = (silencioDesde) => ({ atributos: silencioDesde ? { 'mobile.silencioDesde': silencioDesde } : {} });

test('avisa una vez cuando calla con la jornada abierta y otra cuando vuelve', () => {
  const callado = { candidato: true, jornadaActiva: true, ultimaSenalMs: 1000 };
  assert.deepEqual(cambioDeSilencio(equipo(null), callado), { tipo: 'mobileSilent', desde: 1000 });
  assert.equal(cambioDeSilencio(equipo(1000), callado), null);
  const volvio = { candidato: false, jornadaActiva: true, ultimaSenalMs: 9000 };
  assert.deepEqual(cambioDeSilencio(equipo(1000), volvio), { tipo: 'mobileResumed', desde: 1000 });
  assert.equal(cambioDeSilencio(equipo(null), volvio), null);
});

test('si la jornada se cerró mientras callaba solo se olvida', () => {
  assert.deepEqual(cambioDeSilencio(equipo(1000), { candidato: false, jornadaActiva: false }), { tipo: null, desde: 1000 });
});
