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
const CASA = [-2.2797, -79.8746];
const OFICINA = { latitud: -2.2274, longitud: -79.8884, radioM: 120 };
const fix = (h, m, lat = CASA[0], lon = CASA[1]) => ({ registradoEn: hora(h, m), latitud: lat, longitud: lon });

test('día completo: casa, oficina, visitas y regreso', () => {
  const paradas = [
    parada([6, 0], [7, 40], ...CASA),
    parada([8, 10], [8, 50], -2.2275, -79.8885), // oficina
    parada([9, 30], [9, 50], -2.2429, -79.9149), // visita 1
    parada([11, 0], [11, 20], -2.1286, -79.9267), // visita 2
    parada([20, 0], [21, 0], -2.27975, -79.87455), // regreso a casa (≈ 30 m)
  ];
  const r = resumenDia({ posiciones: [fix(6, 0), fix(21, 0)], paradas, huecos: [], oficina: OFICINA });
  assert.deepEqual(r.roles, ['visita', 'oficina', 'visita', 'visita', 'visita']);
  assert.deepEqual(r.numeroVisita, [1, null, 2, 3, 4]);
  assert.equal(r.salidaCasa, null);
  assert.equal(r.llegadaOficina, hora(8, 10));
  assert.equal(r.salidaOficina, hora(8, 50));
  assert.equal(r.visitas, 4);
});

test('sin oficina no se inventa la llegada', () => {
  const paradas = [parada([6, 0], [7, 0], ...CASA), parada([8, 0], [8, 30], -2.2275, -79.8885)];
  const r = resumenDia({ posiciones: [fix(6, 0), fix(9, 0)], paradas, huecos: [], oficina: null });
  assert.equal(r.llegadaOficina, null);
  assert.equal(r.salidaOficina, null);
  assert.deepEqual(r.roles, ['visita', 'visita']);
});

test('un registro que arranca en la calle no tiene casa ni salida', () => {
  const paradas = [parada([10, 5], [10, 12], -2.2429, -79.9149)];
  const r = resumenDia({ posiciones: [fix(10, 0)], paradas, huecos: [], oficina: OFICINA });
  assert.equal(r.salidaCasa, null);
  assert.deepEqual(r.roles, ['visita']);
});

test('si sigue en casa al final de los datos todavía no salió', () => {
  const paradas = [parada([6, 0], [9, 0], ...CASA)];
  const r = resumenDia({ posiciones: [fix(6, 0), fix(9, 0)], paradas, huecos: [], oficina: null });
    assert.equal(r.salidaCasa, null);
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
  const r = resumenDia({ posiciones: [fix(7, 30), fix(10, 0)], paradas, huecos: [], oficina: null });
  assert.deepEqual(r.numeroVisita, [1, 2, 2]);
  assert.equal(r.visitas, 2);
});
