import { test } from 'node:test';
import assert from 'node:assert/strict';
import { causaDeHueco } from '../src/causas.js';

const t = (h, m = 0) => Date.UTC(2026, 9, 7, h, m);
const hueco = { desde: new Date(t(9)).toISOString(), hasta: new Date(t(10)).toISOString() };

test('el evento del teléfono dice la causa del corte', () => {
  assert.equal(causaDeHueco(hueco, [{ tipo: 'mobileGpsDisabled', en: t(9, 5) }], [t(9, 20)]), 'GPS_APAGADO');
  assert.equal(causaDeHueco(hueco, [{ tipo: 'mobilePowerOff', en: t(8, 59) }], []), 'APAGADO');
  assert.equal(causaDeHueco(hueco, [{ tipo: 'mobilePermissionLost', en: t(9, 30) }], []), 'SIN_PERMISO');
});

test('sin diagnósticos la app no estaba o no tenía datos; con diagnósticos es falta de señal', () => {
  assert.equal(causaDeHueco(hueco, [], []), 'SIN_CONTACTO');
  assert.equal(causaDeHueco(hueco, [], [t(9, 10), t(9, 20)]), 'SIN_SENAL');
  const corto = { desde: new Date(t(9)).toISOString(), hasta: new Date(t(9, 10)).toISOString() };
  assert.equal(causaDeHueco(corto, [], []), 'SIN_SENAL');
});

test('un evento de otra hora no cuenta', () => {
  assert.equal(causaDeHueco(hueco, [{ tipo: 'mobileGpsDisabled', en: t(11) }], [t(9, 10)]), 'SIN_SENAL');
});
