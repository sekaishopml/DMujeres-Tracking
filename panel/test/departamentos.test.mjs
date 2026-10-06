import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparPorDepartamento, SIN_DEPARTAMENTO } from '../src/dominio/departamentos.ts';

test('agrupa por departamento, ordena por nombre y deja "Sin departamento" al final', () => {
  const gente = [
    { n: 'Ana', d: 'DPTO. TECNICOS' },
    { n: 'Beto', d: null },
    { n: 'Carla', d: 'DPTO. MARKETING' },
    { n: 'Dani', d: 'DPTO. TECNICOS' },
    { n: 'Eli', d: '  ' },
  ];
  const grupos = agruparPorDepartamento(gente, (p) => p.d);
  assert.deepEqual(grupos.map((g) => g.departamento), ['DPTO. MARKETING', 'DPTO. TECNICOS', SIN_DEPARTAMENTO]);
  assert.deepEqual(grupos[1].elementos.map((p) => p.n), ['Ana', 'Dani']);
  assert.deepEqual(grupos[2].elementos.map((p) => p.n), ['Beto', 'Eli']);
});

test('sin elementos no hay grupos', () => {
  assert.deepEqual(agruparPorDepartamento([], () => null), []);
});
