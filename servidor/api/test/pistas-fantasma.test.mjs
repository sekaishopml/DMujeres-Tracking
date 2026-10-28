import test from 'node:test';
import assert from 'node:assert/strict';
import { partirVentanasDensas, saltosEnVentana } from '../src/recorrido/ruteo.js';

// Recta hacia el norte, un punto por segundo. `desvio(i)` corre el punto i
// hacia el este (metros) para simular las pistas fantasma del GPS frío.
const GRADO_M = 111_320;
function recta(n, kmhReal, kmhReportada, desvio = () => 0) {
  return Array.from({ length: n }, (_, i) => ({
    registradoEn: new Date(Date.UTC(2026, 9, 25, 23, 0, i)).toISOString(),
    latitud: -2.2 + (i * kmhReal) / 3.6 / GRADO_M,
    longitud: -79.9 + desvio(i) / GRADO_M,
    velocidadKmh: kmhReportada,
    precisionM: 4,
  }));
}

test('el GPS frío que salta entre pistas paralelas no se ajusta a calles', () => {
  // Cada 10 s cambia de pista: 200 m al este y de vuelta, yendo a 50 km/h.
  const puntos = recta(60, 50, 50, (i) => (Math.floor(i / 10) % 2 === 1 ? 200 : 0));
  assert.ok(saltosEnVentana(puntos) >= 3);
  assert.deepEqual(partirVentanasDensas(puntos), []);
});

test('un recorrido limpio sí se ajusta', () => {
  const puntos = recta(60, 50, 50);
  assert.equal(saltosEnVentana(puntos), 0);
  assert.equal(partirVentanasDensas(puntos).length, 1);
});

test('en carretera a 125 km/h no hay saltos', () => {
  assert.equal(saltosEnVentana(recta(60, 125, 120)), 0);
});

test('un teléfono que reporta poca velocidad yendo en carro no tiene saltos', () => {
  // Avanza a 40 km/h reportando 5: es hacia adelante, no un rebote.
  assert.equal(saltosEnVentana(recta(60, 40, 5)), 0);
});

test('un rebote suelto entre edificios sigue yendo al ajuste', () => {
  const puntos = recta(60, 50, 50, (i) => (i === 30 ? 100 : 0));
  assert.ok(saltosEnVentana(puntos) <= 2);
  assert.equal(partirVentanasDensas(puntos).length, 1);
});
