import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentosParaDibujar } from '../src/componentes/replay/trazo.ts';

const punto = (s, norteM, precisionM) => ({
  registradoEn: new Date(Date.UTC(2026, 10, 4, 15, 0, s)).toISOString(),
  latitud: -2.2 + norteM / 111320, longitud: -79.9, velocidadKmh: 40, precisionM, valida: true,
});
const tipos = (puntos, imprecisos = []) => segmentosParaDibujar(puntos, [], [], [], imprecisos).map((s) => s.tipo);

test('lecturas seguidas pero imprecisas van punteadas, no como corte', () => {
  const puntos = [0, 10, 20, 30].map((s, k) => punto(s, k * 110, k === 2 ? 40 : 5));
  assert.ok(tipos(puntos).includes('estimated'));
  assert.ok(!tipos(puntos).includes('hueco'));
});

test('el par que rodea una racha imprecisa vista va punteado; sin racha, es corte', () => {
  const a = punto(0, 0, 5);
  const b = punto(100, 1100, 5);
  assert.deepEqual(tipos([a, b]), ['hueco']);
  assert.deepEqual(tipos([a, b], [{ desde: a.registradoEn, hasta: b.registradoEn }]), ['estimated']);
});
