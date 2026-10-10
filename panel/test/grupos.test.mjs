import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparEnPantalla } from '../src/componentes/replay/grupos.ts';

// Proyección de juguete: 1 grado = 1000 px.
const proyectar = (lon, lat) => [lon * 1000, -lat * 1000];
const it = (clave, lon, lat, orden = 0) => ({ clave, lon, lat, orden });

test('juntos en pantalla: se agrupan y salen en orden de hora', () => {
  const grupos = agruparEnPantalla(
    [it('fin', 0.0100, 0.0100, 3), it('inicio', 0.0100, 0.0101, 1), it('parada-0', 0.0101, 0.0100, 2)],
    proyectar,
  );
  assert.equal(grupos.length, 1);
  assert.deepEqual(grupos[0].map((g) => g.clave), ['inicio', 'parada-0', 'fin']);
});

test('lejos uno de otro: no hay grupo', () => {
  assert.deepEqual(agruparEnPantalla([it('inicio', 0, 0, 1), it('fin', 0.5, 0.5, 2)], proyectar), []);
});

test('un solo elemento en un lugar: no es grupo', () => {
  assert.deepEqual(agruparEnPantalla([it('inicio', 0, 0, 1)], proyectar), []);
});
