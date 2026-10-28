// Reglas de la Repetición de ruta: nada se dibuja como recorrido si no hay
// puntos que lo respalden. Ejecutar: node24 --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depurarPosiciones } from '../src/recorrido/depuracion.js';
import { sumarDistanciasKm } from '../src/recorrido/geo.js';

const fix = (lat, lon, iso) => ({ latitud: lat, longitud: lon, registradoEn: iso });
// ~111 m por milésima de grado de latitud en Guayaquil.
const A = fix(-2.2000, -79.9000, '2026-09-28T13:00:00.000Z');

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

// Diego, 26/10 en Quito: el GPS bajo techo saltó 2,8 km a "55 km/h" y volvió.
test('depuración: salto de kilómetros que vuelve sin un solo paso se quita', () => {
  const p = (lat, lon, hora, pasos) => ({ ...leido(lat, lon, hora, 55, 9), pasos });
  // El contador funciona ese día: avanzó en la mañana.
  const manana = Array.from({ length: 25 }, (_, i) => p(-0.18388, -78.49191, `12:${String(i * 2).padStart(2, '0')}:00`, i * 12));
  const r = depurarPosiciones([
    ...manana,
    p(-0.18388, -78.49191, '13:20:39', 304),
    p(-0.19605, -78.46988, '13:22:49', 304),
    p(-0.19625, -78.46969, '13:22:51', 304),
    p(-0.18480, -78.49214, '13:24:12', 304),
  ]);
  assert.deepEqual(r.conservadas.slice(-2).map((x) => x.registradoEn.slice(11, 19)), ['13:20:39', '13:24:12']);
  // Con pasos de por medio sí salió: se conserva.
  const conPasos = depurarPosiciones([
    p(-0.18388, -78.49191, '13:20:39', 304),
    p(-0.19605, -78.46988, '13:24:39', 350),
    p(-0.18480, -78.49214, '13:28:12', 420),
  ]);
  assert.equal(conPasos.conservadas.length, 3);
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

