import test from 'node:test';
import assert from 'node:assert/strict';
import { esPrecisoParaTrazo, PRECISION_MAX_TRAZO_M } from '../src/recorrido/ruteo.js';

test('fix de GPS (10 m) entra al trazo', () => {
  assert.equal(esPrecisoParaTrazo({ precisionM: 10 }), true);
});

test('punto de antena (92.9 m) queda fuera del trazo', () => {
  assert.equal(esPrecisoParaTrazo({ precisionM: 92.9 }), false);
});

test('el límite es inclusivo y sin precisión no se descarta', () => {
  assert.equal(esPrecisoParaTrazo({ precisionM: PRECISION_MAX_TRAZO_M }), true);
  assert.equal(esPrecisoParaTrazo({ precisionM: null }), true);
  assert.equal(esPrecisoParaTrazo({ precision_m: 120 }), false);
});

import { esVentanaAPie, tramoEnVehiculo } from '../src/recorrido/ruteo.js';

test('ventana a pie (5 min, 400 m) no va al ajuste a vía; en vehículo sí', () => {
  const t = (s) => new Date(Date.parse('2026-09-30T14:52:00Z') + s * 1000).toISOString();
  const aPie = [
    { registradoEn: t(0), latitud: -2.22405, longitud: -79.89825 },
    { registradoEn: t(300), latitud: -2.22807, longitud: -79.89756 },
  ];
  const vehiculo = [
    { registradoEn: t(0), latitud: -2.22405, longitud: -79.89825 },
    { registradoEn: t(60), latitud: -2.22807, longitud: -79.89756 },
  ];
  assert.equal(esVentanaAPie(aPie), true);
  assert.equal(esVentanaAPie(vehiculo), false);
});

test('de una ventana lenta se saca el viaje en auto, sin la espera ni el temblor al llegar', () => {
  const t = (s) => new Date(Date.parse('2026-10-10T15:04:00Z') + s * 1000).toISOString();
  const p = (s, lon, velocidadKmh, precisionM = 3) => ({ registradoEn: t(s), latitud: -2.2427, longitud: lon, velocidadKmh, precisionM });
  const quieta = Array.from({ length: 12 }, (_, k) => p(k * 10, -79.9149, 0));
  const enAuto = [1, 2, 3].map((k) => p(120 + k * 10, -79.9149 - k * 0.00045, 18));
  const llegada = p(160, -79.91625, 0);
  // Ya quieta, el GPS salta con velocidad falsa y poca precisión.
  const temblor = [p(170, -79.9165, 25, 20), p(180, -79.9166, 30, 20), p(190, -79.9167, 28, 20)];
  const ventana = [...quieta, ...enAuto, llegada, ...temblor];
  assert.equal(esVentanaAPie(ventana), true);
  const tramo = tramoEnVehiculo(ventana);
  assert.deepEqual(tramo.map((x) => x.registradoEn), [t(110), t(130), t(140), t(150), t(160)]);
  // Un solo pico de velocidad no es un viaje.
  assert.equal(tramoEnVehiculo([...quieta.slice(0, 5), p(50, -79.9149, 109), ...quieta.slice(6)]), null);
});
