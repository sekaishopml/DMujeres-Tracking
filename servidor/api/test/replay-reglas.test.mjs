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
