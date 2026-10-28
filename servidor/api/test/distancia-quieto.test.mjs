import test from 'node:test';
import assert from 'node:assert/strict';
import { sumarDistanciasKm } from '../src/geo.js';

const punto = (s, norteM, precisionM = 5) => ({
  registradoEn: new Date(Date.UTC(2026, 9, 15, 15, 0, s)).toISOString(),
  latitud: -2.2 + norteM / 111320,
  longitud: -79.9,
  precisionM,
});

test('quieto, el temblor del GPS no suma distancia', () => {
  const temblor = Array.from({ length: 360 }, (_, i) => punto(i * 10, (i % 2) * 8));
  assert.ok(sumarDistanciasKm(temblor, { omitirImposibles: true }) < 0.02);
});

test('caminando o en auto la distancia se cuenta', () => {
  const recta = Array.from({ length: 101 }, (_, i) => punto(i * 10, i * 14));
  const km = sumarDistanciasKm(recta, { omitirImposibles: true });
  assert.ok(km > 1.3 && km <= 1.41, `${km}`);
});

test('un punto de antena lejano no suma, aunque la persona lleve horas quieta', () => {
  const dia = [...Array.from({ length: 50 }, (_, i) => punto(i * 300, (i % 2) * 5)), punto(15100, 13000, 900), punto(15200, 5)];
  assert.ok(sumarDistanciasKm(dia, { omitirImposibles: true }) < 0.02);
});
