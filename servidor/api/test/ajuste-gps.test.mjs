import test from 'node:test';
import assert from 'node:assert/strict';
import { depurarPosiciones } from '../src/depuracion.js';
import { validarAjusteMatch } from '../src/ruteo.js';

const pos = (seg, lat, lon, precisionM) => ({
  id: seg,
  registradoEn: new Date(Date.UTC(2026, 9, 3, 1, 0, seg)).toISOString(),
  latitud: lat,
  longitud: lon,
  precisionM,
});

test('quita las posiciones viejas que preceden a un salto a un punto mucho más preciso', () => {
  const lista = [
    pos(0, -2.2287, -79.8942, 14),
    pos(48, -2.2305, -79.8960, 17),
    pos(53, -2.2306, -79.8962, 20),
    pos(60, -2.2328, -79.8941, 5),
    pos(62, -2.2328, -79.8942, 5),
  ];
  const { conservadas } = depurarPosiciones(lista);
  assert.deepEqual(conservadas.map((p) => p.id), [0, 60, 62]);
});

test('no quita puntos si el que llega no es mucho mejor', () => {
  const lista = [pos(0, -2.2287, -79.8942, 14), pos(53, -2.2306, -79.8962, 20), pos(60, -2.2328, -79.8941, 18)];
  assert.equal(depurarPosiciones(lista).conservadas.length, 3);
});

test('un ajuste correcto de un trazo con GPS ruidoso no se descarta por el temblor', () => {
  // Calle recta de 600 m al sur; cada 6 m el GPS salta 3 m a un lado y al otro.
  const puntos = [];
  for (let i = 0; i <= 100; i += 1) puntos.push({ latitud: -2.2287 - i * 0.000054, longitud: -79.8942 + (i % 2 ? 0.000027 : -0.000027), precisionM: 22 });
  const trazo = [[-79.8942, -2.2287], [-79.8942, -2.2287 - 100 * 0.000054]];
  const v = validarAjusteMatch(puntos, trazo);
  assert.ok(v.longAjustadaM / v.longCrudaM < 0.75, 'el largo crudo debe estar inflado');
  assert.equal(v.valida, true, JSON.stringify(v));
});

test('un ajuste que se desvía de los puntos sigue descartándose', () => {
  const puntos = [];
  for (let i = 0; i <= 20; i += 1) puntos.push({ latitud: -2.2287 - i * 0.00018, longitud: -79.8942, precisionM: 5 });
  const trazo = [[-79.8932, -2.2287], [-79.8932, -2.2287 - 20 * 0.00018]];
  assert.equal(validarAjusteMatch(puntos, trazo).valida, false);
});

test('quita el pico de velocidad de un teléfono quieto, pero no un giro real en marcha', () => {
  const quieto = [
    { ...pos(0, -2.24258, -79.91470, 15), velocidadKmh: 0 },
    { ...pos(174, -2.24311, -79.91451, 8), velocidadKmh: 24 },
    { ...pos(183, -2.24277, -79.91468, 2), velocidadKmh: 5 },
  ];
  assert.deepEqual(depurarPosiciones(quieto).conservadas.map((p) => p.id), [0, 183]);
  const enMarcha = quieto.map((p) => ({ ...p, velocidadKmh: 30 }));
  assert.equal(depurarPosiciones(enMarcha).conservadas.length, 3);
});
