import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerLineas } from '../src/dominio/clientes.ts';

test('cada línea es un cliente; dirección y ubicación opcionales', () => {
  const r = leerLineas('Farmacia Central | Av. 9 de Octubre | -2.1894, -79.8853\nTienda El Sol | Calle 10\n\nKiosko');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { nombre: 'Farmacia Central', direccion: 'Av. 9 de Octubre', lat: -2.1894, lon: -79.8853 });
  assert.deepEqual(r[1], { nombre: 'Tienda El Sol', direccion: 'Calle 10', lat: null, lon: null });
  assert.deepEqual(r[2], { nombre: 'Kiosko', direccion: null, lat: null, lon: null });
});

test('también acepta columnas pegadas de Excel (tabulador)', () => {
  const r = leerLineas('Bodega Norte\tAv. Las Aguas\t-2.15\t-79.90');
  assert.deepEqual(r[0], { nombre: 'Bodega Norte', direccion: 'Av. Las Aguas', lat: -2.15, lon: -79.9 });
});
