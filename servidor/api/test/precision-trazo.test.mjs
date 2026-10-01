import test from 'node:test';
import assert from 'node:assert/strict';
import { esPrecisoParaTrazo, PRECISION_MAX_TRAZO_M } from '../src/ruteo.js';

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

import { esVentanaAPie } from '../src/ruteo.js';

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
