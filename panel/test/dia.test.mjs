import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coberturaDe, resumenDia } from '../src/dominio/dia.ts';

const hora = (h, m = 0) => new Date(Date.UTC(2026, 9, 2, h + 5, m)).toISOString();
const parada = (ini, fin, lat, lon) => ({
  inicio: hora(...ini),
  fin: hora(...fin),
  duracionMin: (new Date(hora(...fin)) - new Date(hora(...ini))) / 60000,
  latitud: lat,
  longitud: lon,
});
const INICIO = [-2.2797, -79.8746];
const fix = (h, m, lat = INICIO[0], lon = INICIO[1]) => ({ registradoEn: hora(h, m), latitud: lat, longitud: lon });

test('cada lugar distinto es una visita numerada', () => {
  const paradas = [
    parada([8, 10], [8, 50], -2.2275, -79.8885),
    parada([9, 30], [9, 50], -2.2429, -79.9149),
    parada([11, 0], [11, 20], -2.1286, -79.9267),
  ];
  const r = resumenDia({ posiciones: [fix(8, 0), fix(12, 0)], paradas, huecos: [] });
  assert.deepEqual(r.numeroVisita, [1, 2, 3]);
  assert.equal(r.visitas, 3);
});

test('sin paradas o sin puntos no se inventa nada', () => {
  assert.equal(resumenDia({ posiciones: [fix(8, 0)], paradas: [], huecos: [] }).visitas, 0);
  const r = resumenDia({ posiciones: [], paradas: [parada([8, 0], [8, 30], ...INICIO)], huecos: [] });
  assert.deepEqual(r.numeroVisita, [null]);
  assert.equal(r.visitas, 0);
});

test('la cobertura descuenta los cortes y no cuenta el tiempo fuera de jornada', () => {
  const posiciones = [fix(8, 0), fix(18, 0)];
  const huecos = [
    { desde: hora(10, 0), hasta: hora(10, 30), duracionSegundos: 1800 },
    { desde: hora(12, 0), hasta: hora(14, 0), duracionSegundos: 7200, motivo: 'FUERA_DE_JORNADA' },
  ];
  const c = coberturaDe(posiciones, huecos);
  // 10 h menos 2 h fuera de jornada = 8 h medibles; 30 min sin señal.
  assert.equal(Math.round(c.porcentaje * 10) / 10, 93.8);
  assert.equal(c.cortes, 1);
  assert.equal(c.mayorCorteSegundos, 1800);
  assert.equal(coberturaDe([fix(8, 0)], []).porcentaje, null);
});

test('paradas seguidas en el mismo lugar son una sola visita', () => {
  const paradas = [
    parada([8, 0], [8, 40], -2.2229, -79.8998),
    parada([8, 56], [9, 0], -2.2255, -79.9028), // a ~400 m: otra visita
    parada([9, 8], [9, 14], -2.22557, -79.90285), // pegada a la anterior
  ];
  const r = resumenDia({ posiciones: [fix(7, 30), fix(10, 0)], paradas, huecos: [] });
  assert.deepEqual(r.numeroVisita, [1, 2, 2]);
  assert.equal(r.visitas, 2);
});
