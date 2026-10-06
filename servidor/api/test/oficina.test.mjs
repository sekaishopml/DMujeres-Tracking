import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarOficina, RADIO_POR_DEFECTO_M } from '../src/oficina.js';

test('la oficina se valida y toma valores por defecto', () => {
  assert.deepEqual(validarOficina({ latitud: '-2.2275', longitud: -79.8885 }), {
    nombre: 'Oficina',
    latitud: -2.2275,
    longitud: -79.8885,
    radioM: RADIO_POR_DEFECTO_M,
  });
  assert.equal(validarOficina({ nombre: '  Sede  ', latitud: 0, longitud: 0, radioM: 80.4 }).radioM, 80);
});

test('coordenadas o radio fuera de rango se rechazan', () => {
  assert.throws(() => validarOficina({ latitud: 91, longitud: 0 }), /latitud/);
  assert.throws(() => validarOficina({ latitud: 0, longitud: 'x' }), /longitud/);
  assert.throws(() => validarOficina({ latitud: 0, longitud: 0, radioM: 5 }), /radioM/);
  assert.throws(() => validarOficina(null), /latitud/);
});
