import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregarMuestra, enReposo, nuevaPista, posicionEn } from '../src/dominio/movimiento.ts';

// 0.0001° de longitud ≈ 11 m en el ecuador.
const m = (t, pasos) => ({ t, lon: -79.9 + pasos * 0.0001, lat: 0 });
const lonEn = (pista, ahora) => posicionEn(pista, ahora)[0];

test('un punto por segundo: avanza sin pararse y sin retroceder', () => {
  const pista = nuevaPista(m(0, 0), 300);
  let anterior = lonEn(pista, 300);
  let quietos = 0;
  for (let ahora = 300; ahora <= 20_300; ahora += 100) {
    // Cada punto llega 300 ms después de tomado, con ±150 ms de variación.
    for (let s = 1; s <= 20; s += 1) {
      const llegada = s * 1000 + 300 + (s % 2 ? 150 : -150);
      if (llegada > ahora - 100 && llegada <= ahora) agregarMuestra(pista, m(s * 1000, s * 2), llegada, 5);
    }
    const lon = lonEn(pista, ahora);
    assert.ok(lon >= anterior - 1e-12, 'retrocedió');
    if (ahora > 2000 && ahora < 19_000 && lon === anterior) quietos += 1;
    anterior = lon;
  }
  assert.equal(quietos, 0);
});

test('un lote de puntos se reproduce a su velocidad, no de golpe', () => {
  const pista = nuevaPista(m(0, 0), 0);
  for (let s = 1; s <= 10; s += 1) agregarMuestra(pista, m(s * 1000, s * 2), 10_500, 5);
  const mitad = lonEn(pista, 15_500);
  assert.ok(mitad > -79.9 && mitad < m(0, 20).lon);
  assert.equal(enReposo(pista, 15_500), false);
  assert.equal(lonEn(pista, 30_000), m(0, 20).lon);
  assert.equal(enReposo(pista, 30_000), true);
});

test('el temblor no mueve el marcador y un hueco largo se recorre en 15 s', () => {
  const pista = nuevaPista(m(0, 0), 0);
  agregarMuestra(pista, { t: 1000, lon: -79.9 + 0.00002, lat: 0 }, 1000, 5);
  assert.equal(pista.muestras.length, 1);
  agregarMuestra(pista, m(300_000, 10), 300_000, 5);
  assert.equal(enReposo(pista, 300_000 + 14_000), false);
  assert.equal(enReposo(pista, 300_000 + 15_000), true);
});
