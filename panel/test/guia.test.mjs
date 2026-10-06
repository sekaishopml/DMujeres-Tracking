import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradienteHasta, prepararGuia, progresoEn } from '../src/componentes/replay/guia.ts';

// Una línea recta al este de ~220 m con tiempos 0 a 100 s, el doble de rápido en la segunda mitad.
const linea = [
  { lon: -79.9, lat: -2.2, t: 0 },
  { lon: -79.899, lat: -2.2, t: 60_000 },
  { lon: -79.898, lat: -2.2, t: 80_000 },
];
const guia = prepararGuia(linea, 0, 100_000);

test('el avance sigue la distancia recorrida en el instante pedido', () => {
  assert.equal(progresoEn(linea, guia, -5), 0);
  assert.equal(progresoEn(linea, guia, 100_000), 1);
  assert.ok(Math.abs(progresoEn(linea, guia, 30_000) - 0.25) < 1e-6);
  assert.ok(Math.abs(progresoEn(linea, guia, 70_000) - 0.75) < 1e-6);
});

test('el degradado tiene cortes crecientes y es transparente después del avance', () => {
  const e = gradienteHasta(guia, 0.4);
  const q = e.slice(3).filter((_, i) => i % 2 === 0);
  assert.ok(q.every((v, i) => i === 0 || v > q[i - 1]), 'los cortes deben crecer');
  assert.equal(e.at(-1), 'rgba(0,0,0,0)');
  assert.equal(e.at(-2), 1);
  const colores = e.slice(3).filter((_, i) => i % 2 === 1);
  assert.equal(colores[colores.length - 3] !== 'rgba(0,0,0,0)', true);
});

test('sin avance todo es transparente y con avance completo todo es color', () => {
  assert.deepEqual(gradienteHasta(guia, 0).slice(3), [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)']);
  assert.ok(gradienteHasta(guia, 1).slice(3).every((v, i) => i % 2 === 0 || v !== 'rgba(0,0,0,0)'));
  assert.equal(gradienteHasta(guia, 0.5, '#ffffff').slice(3, 5)[1], '#ffffff');
});
