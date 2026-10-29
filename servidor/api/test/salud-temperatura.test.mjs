import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temperaturaDe, termicoDe } from '../src/equipos/salud.js';

const con = (power) => ({ lastDiagnostics: JSON.stringify({ report: { power } }) });

test('la temperatura es la mediana de las lecturas y no se inventa si quedó congelada', () => {
  assert.equal(temperaturaDe(con({ tempC: 41, tempLecturas: [[1, 33], [2, 41], [3, 34]] })), 34);
  assert.equal(temperaturaDe(con({ tempC: 36.5 })), 36.5);
  assert.equal(temperaturaDe(con({ tempC: 24.9, tempVigente: false, tempLecturas: [[1, 24.9]] })), null);
  assert.equal(temperaturaDe(con({})), null);
  assert.equal(termicoDe(con({ termico: 2 })), 2);
  assert.equal(termicoDe(con({ termico: 9 })), null);
});
