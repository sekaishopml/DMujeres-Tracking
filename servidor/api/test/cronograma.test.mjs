import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paradaDeActividad, respaldoDe } from '../src/cronograma.js';

const h = (hhmm) => new Date(`2026-10-01T${hhmm}:00-05:00`);
const parada = (desde, hasta, latitud = 1) => ({ inicio: h(desde), fin: h(hasta), latitud, longitud: 1 });

test('con rango toma la parada que más comparte con él y su cobertura', () => {
  const paradas = [parada('08:55', '09:10', 1), parada('09:20', '10:50', 2)];
  const r = paradaDeActividad(paradas, h('09:00').getTime(), h('11:00').getTime());
  assert.equal(r.parada.latitud, 2);
  assert.equal(r.porRango, true);
  assert.equal(r.coberturaPct, 75);
});

test('sin rango usa la parada que toca la hora de inicio (±5 min)', () => {
  const paradas = [parada('09:04', '09:40', 3)];
  const r = paradaDeActividad(paradas, h('09:00').getTime(), null);
  assert.equal(r.parada.latitud, 3);
  assert.equal(r.coberturaPct, null);
  assert.equal(paradaDeActividad([parada('09:10', '09:40')], h('09:00').getTime(), null).parada, null);
});

test('con rango sin paradas dentro vuelve a la hora de inicio', () => {
  const r = paradaDeActividad([parada('08:56', '08:59', 4)], h('09:00').getTime(), h('10:00').getTime());
  assert.equal(r.parada.latitud, 4);
  assert.equal(r.porRango, false);
});


test('el respaldo sale del recorrido a esa hora, no de cuándo se cargó', () => {
  const detenida = { detenida: true, latitud: -2.2, longitud: -79.9 };
  assert.equal(respaldoDe({ tipo: 'visita', enHora: detenida, cliente: null }).estado, 'GPS');
  assert.equal(respaldoDe({ tipo: 'visita', enHora: detenida, cliente: { lat: -2.2005, lon: -79.9 } }).estado, 'GPS');
  const lejos = respaldoDe({ tipo: 'visita', enHora: detenida, cliente: { lat: -2.22, lon: -79.9 } });
  assert.equal(lejos.estado, 'LEJOS');
  assert.ok(lejos.distanciaM > 2000);
  assert.equal(respaldoDe({ tipo: 'visita', enHora: { detenida: false }, cliente: null }).estado, 'EN_CAMINO');
  assert.equal(respaldoDe({ tipo: 'visita', enHora: null, cliente: null }).estado, 'SIN_RECORRIDO');
  assert.equal(respaldoDe({ tipo: 'vacaciones', enHora: null, cliente: null }).estado, 'NO_APLICA');
});
