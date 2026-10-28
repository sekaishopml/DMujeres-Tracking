import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentosDeRecorrido } from '../src/dominio/replay.ts';

// Un punto cada 8 s; `pasoM` metros hacia el oeste entre uno y otro.
const serie = (pasos) => pasos.map((oesteM, i) => ({
  registradoEn: new Date(Date.UTC(2026, 9, 13, 1, 40, i * 8)).toISOString(),
  latitud: -2.2486, longitud: -79.8904 - oesteM / 111320, velocidadKmh: 4.5, precisionM: 3, valida: true,
}));

test('caminata con pares de 10 m se dibuja completa', () => {
  const puntos = serie(Array.from({ length: 20 }, (_, i) => i * 10));
  const rutas = segmentosDeRecorrido(puntos, [], []).filter((s) => s.tipo === 'ruta');
  assert.equal(rutas.length, 19);
});

test('temblor en el mismo sitio (pares de menos de 12 m sin avance) no se dibuja', () => {
  const puntos = serie(Array.from({ length: 20 }, (_, i) => (i % 2) * 8));
  assert.equal(segmentosDeRecorrido(puntos, [], []).length, 0);
});

test('un salto con tramo estimado sale como raya de corte, no en blanco', () => {
  const a = { registradoEn: '2026-10-12T22:29:58.000Z', latitud: -2.20868, longitud: -79.88567, velocidadKmh: 28, precisionM: 18, valida: true };
  const b = { registradoEn: '2026-10-12T22:31:39.000Z', latitud: -2.20483, longitud: -79.88463, velocidadKmh: 9, precisionM: 10, valida: true };
  const estimado = { desde: a.registradoEn, hasta: b.registradoEn, metodo: 'ESTIMATED', trazado: [[a.longitud, a.latitud], [b.longitud, b.latitud]] };
  const segmentos = segmentosDeRecorrido([a, b], [], [estimado]);
  assert.deepEqual(segmentos.map((s) => s.tipo), ['hueco']);
});

test('una pausa corta caminando, fuera de parada, no corta la línea', async () => {
  const { segmentosParaDibujar } = await import('../src/componentes/replay/trazo.ts');
  const pasos = [0, 10, 20, 30, 40, 40, 40, 40, 50, 60, 70, 80];
  const puntos = serie(pasos).map((p, i) => (pasos[i] === pasos[i - 1] || pasos[i] === pasos[i + 1] ? { ...p, velocidadKmh: 0 } : p));
  const rutas = segmentosParaDibujar(puntos, [], [], []).filter((s) => s.tipo === 'ruta');
  assert.ok(rutas.length > 0);
  assert.ok(rutas.every((s) => s.modo !== 'quieto'));
});
