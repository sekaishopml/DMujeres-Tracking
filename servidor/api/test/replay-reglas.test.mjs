// Reglas de la Repetición de ruta: nada se dibuja como recorrido si no hay
// puntos que lo respalden. Ejecutar: node24 --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimadoPlausible } from '../src/ruteo.js';
import { depurarPosiciones } from '../src/depuracion.js';
import { sumarDistanciasKm } from '../src/geo.js';

const fix = (lat, lon, iso) => ({ latitud: lat, longitud: lon, registradoEn: iso });
// ~111 m por milésima de grado de latitud en Guayaquil.
const A = fix(-2.2000, -79.9000, '2026-09-28T13:00:00.000Z');

test('ESTIMATED: salto corto y camino casi recto se acepta', () => {
  const B = fix(-2.2030, -79.9000, '2026-09-28T13:01:00.000Z'); // ~333 m en 60 s
  assert.equal(estimadoPlausible(A, B, null, 360), true);
});

test('ESTIMATED: rodeo x4,5 (sentido único) se rechaza', () => {
  const B = fix(-2.20154, -79.9000, '2026-09-28T13:01:06.000Z'); // ~171 m
  assert.equal(estimadoPlausible(A, B, null, 769), false);
});

test('ESTIMATED: hueco de 18 min no se inventa aunque la ruta sea recta', () => {
  const B = fix(-2.2528, -79.9000, '2026-09-28T13:18:14.000Z'); // ~5,9 km
  assert.equal(estimadoPlausible(A, B, null, 6000), false);
});

test('ESTIMATED: velocidad imposible por el camino se rechaza', () => {
  const B = fix(-2.2100, -79.9000, '2026-09-28T13:00:10.000Z'); // ~1,1 km en 10 s
  assert.equal(estimadoPlausible(A, B, null, 1150), false);
});

test('depuración: aparta el fix del emulador (Googleplex)', () => {
  const r = depurarPosiciones([
    A,
    fix(37.4220, -122.0841, '2026-09-28T13:01:00.000Z'),
    fix(-2.2005, -79.9000, '2026-09-28T13:02:00.000Z'),
  ]);
  assert.equal(r.conservadas.length, 2);
  assert.equal(r.calidad.descartadasFueraDeZona, 1);
});

test('depuración: dos teléfonos alternando se marcan como origen múltiple', () => {
  const lejos = (i) => fix(-2.0923, -79.9209, `2026-09-28T13:0${i}:30.000Z`);
  const cerca = (i) => fix(-2.2274, -79.8884, `2026-09-28T13:0${i}:00.000Z`);
  const pos = [];
  for (let i = 0; i < 6; i += 1) pos.push(cerca(i), lejos(i));
  pos.push(cerca(7));
  const r = depurarPosiciones(pos);
  assert.equal(r.calidad.posibleOrigenMultiple, true);
  assert.ok(r.conservadas.every((p) => p.latitud < -2.2));
});

test('distancia: un par imposible no suma kilómetros', () => {
  const pos = [A, fix(-2.0923, -79.9209, '2026-09-28T13:00:30.000Z'), fix(-2.2003, -79.9000, '2026-09-28T13:01:00.000Z')];
  assert.ok(sumarDistanciasKm(pos, { omitirImposibles: true }) < 0.1);
  assert.ok(sumarDistanciasKm(pos) > 20);
});

// Puntos reales del 8 de octubre (mantilla): al salir de un lugar cerrado.
const leido = (lat, lon, hora, kmh, precision) =>
  ({ latitud: lat, longitud: lon, registradoEn: `2026-10-08T${hora}.000Z`, velocidadKmh: kmh, precisionM: precision });

test('depuración: quita la ida y vuelta del GPS que no cuadra con su velocidad', () => {
  const r = depurarPosiciones([
    leido(-2.242694, -79.914932, '15:03:32', 6.5, 13),
    leido(-2.242338, -79.914788, '15:03:35', 2.1, 8),
    leido(-2.242131, -79.914772, '15:03:37', 2.0, 2),
    leido(-2.242598, -79.914904, '15:03:38', 7.4, 2),
  ]);
  assert.deepEqual(r.conservadas.map((p) => p.registradoEn.slice(11, 19)), ['15:03:32', '15:03:38']);
  assert.equal(r.calidad.descartadasExcursion, 2);
});

test('depuración: avanzar de verdad aunque el GPS reporte 0 km/h no se quita', () => {
  const r = depurarPosiciones([
    leido(-2.2000, -79.9, '15:00:00', 0, 5),
    leido(-2.2004, -79.9, '15:00:02', 0, 5),
    leido(-2.2008, -79.9, '15:00:04', 0, 5),
  ]);
  assert.equal(r.conservadas.length, 3);
});

test('depuración: quita lo impreciso entre puntos precisos y conserva una imprecisión larga', () => {
  const r = depurarPosiciones([
    leido(-2.2000, -79.9, '15:00:00', 5, 10),
    leido(-2.2009, -79.9, '15:00:30', 70, 100),
    leido(-2.2001, -79.9, '15:01:00', 5, 10),
    leido(-2.2002, -79.9, '15:04:00', 5, 60),
    leido(-2.2003, -79.9, '15:08:00', 5, 10),
  ]);
  assert.deepEqual(r.conservadas.map((p) => p.precisionM), [10, 10, 60, 10]);
  assert.equal(r.calidad.descartadasImprecisas, 1);
});

test('depuración: la salida de una parada con 24 a 100 m de error sale entera', () => {
  const r = depurarPosiciones([
    leido(-2.227299, -79.888411, '00:42:49', 7.3, 14),
    leido(-2.227162, -79.888672, '00:43:16', 0.6, 26),
    leido(-2.226799, -79.888678, '00:43:33', 0, 24),
    leido(-2.2268, -79.8892, '00:44:54', 73.2, 100),
    leido(-2.227053, -79.889261, '00:45:06', 23.2, 15),
  ]);
  assert.deepEqual(r.conservadas.map((p) => p.precisionM), [14, 15]);
});
