import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cambioDeSilencio, tocaAvisoVisible } from '../src/monitor.js';
import { enHorarioLaboral } from '../src/avisos.js';

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

test('aviso visible tras 3 rescates sin respuesta, y cada 3 más, solo en horario laboral', () => {
  const toca = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => tocaAvisoVisible(n, true));
  assert.deepEqual(toca, [4, 7, 10]);
  assert.equal(tocaAvisoVisible(4, false), false);
  assert.equal(tocaAvisoVisible(19, true), true);
  assert.equal(tocaAvisoVisible(22, true), false);
  // Sábado 17/10/2026 a las 16:59 sí; a las 17:00 y el domingo no.
  assert.equal(enHorarioLaboral(Date.parse('2026-10-17T16:59:00-05:00')), true);
  assert.equal(enHorarioLaboral(Date.parse('2026-10-17T17:00:00-05:00')), false);
  assert.equal(enHorarioLaboral(Date.parse('2026-10-18T10:00:00-05:00')), false);
  assert.equal(enHorarioLaboral(Date.parse('2026-10-12T06:59:00-05:00')), false);
});
