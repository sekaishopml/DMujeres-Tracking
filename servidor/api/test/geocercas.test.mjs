import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularVisitas, puntoEnPoligono, puntosValidos, resumirVisitas } from '../src/lugares/geocercas.js';

const cuadro = [[-79.9, -2.2], [-79.89, -2.2], [-79.89, -2.19], [-79.9, -2.19]];
const dentro = [-79.895, -2.195];
const fuera = [-79.8, -2.1];
// Afuera, pero a unos 55 m del borde: la calle de al lado.
const cerca = [-79.9005, -2.195];
// Adentro, junto al mismo borde: por donde se cruza, la distancia entre
// el último punto de un lado y el primero del otro es corta.
const dentroBorde = [-79.8995, -2.195];
const p = (min, [lon, lat], extra = {}) => ({
  registradoEn: new Date(Date.UTC(2026, 9, 1, 12, min)).toISOString(),
  latitud: lat,
  longitud: lon,
  precisionM: 10,
  valida: true,
  ...extra,
});
const serie = (...marcas) => marcas.map(([min, lugar, extra]) => p(min, lugar, extra));

test('punto en polígono', () => {
  assert.equal(puntoEnPoligono(...dentro, cuadro), true);
  assert.equal(puntoEnPoligono(...fuera, cuadro), false);
});

test('un punto suelto adentro no cuenta como llegada', () => {
  const v = calcularVisitas(serie([0, fuera], [1, fuera], [2, fuera], [3, dentro], [4, fuera], [5, fuera], [6, fuera]), cuadro);
  assert.equal(v.length, 0);
});

test('dos visitas, salida y llegada con temblor intermedio', () => {
  // Un punto por minuto: la llegada y la salida se cuentan solo si se vio el paso.
  const minutos = (desde, hasta, lugar) => Array.from({ length: hasta - desde + 1 }, (_, i) => [desde + i, lugar]);
  const v = calcularVisitas(
    serie(
      ...minutos(0, 9, cerca),
      ...minutos(10, 12, dentroBorde), [13, cerca], ...minutos(14, 29, dentroBorde),
      ...minutos(30, 49, cerca),
      ...minutos(50, 52, dentroBorde),
    ),
    cuadro,
  );
  assert.equal(v.length, 2);
  assert.equal(v[0].llegada, p(10, dentroBorde).registradoEn);
  assert.equal(v[0].salida, p(30, fuera).registradoEn);
  assert.equal(v[0].duracionMin, 20);
  assert.equal(v[1].salida, null);
  assert.equal(v[1].duracionMin, null);
  const r = resumirVisitas({ id: 1, nombre: 'Casa', tipo: 'casa' }, v);
  assert.deepEqual(r.llegadas, [v[1].llegada, v[0].llegada]);
  assert.deepEqual(r.salidas, [v[0].salida]);
});

test('si empieza adentro, la llegada es N/A; sin paso visto, la salida también', () => {
  const v = calcularVisitas(
    serie([0, dentro], [1, dentro], [2, dentro], [3, fuera, { precisionM: 500 }], [4, fuera, { valida: false }], [5, fuera], [6, fuera], [7, fuera]),
    cuadro,
  );
  assert.equal(v.length, 1);
  assert.equal(v[0].llegada, null);
  assert.equal(v[0].salida, null);
  assert.deepEqual(resumirVisitas({ id: 1, nombre: 'Oficina', tipo: 'oficina' }, v).llegadas, []);
});

test('salida con señal perdida y vuelta lejos: N/A; salida seguida: hora', () => {
  const lejos = [-79.8, -2.1];
  const dentroYSale = [[0, dentroBorde], [1, dentroBorde], [2, dentroBorde]];
  const corte = calcularVisitas(serie(...dentroYSale, [3, lejos], [4, lejos], [5, lejos]), cuadro);
  assert.equal(corte[0].salida, null);
  const seguida = calcularVisitas(serie(...dentroYSale, [3, cerca], [4, cerca], [5, cerca]), cuadro);
  assert.equal(seguida[0].salida, p(3, cerca).registradoEn);
});

test('pasar rozando el borde no es visita: 3 puntos en 30 s se descartan', () => {
  const v = calcularVisitas(
    serie([0, fuera], [1, fuera], [2, fuera], [3, dentro], [3.3, dentro], [3.6, dentro], [4, fuera], [5, fuera], [6, fuera]),
    cuadro,
  );
  assert.equal(v.length, 0);
});

test('puntos del polígono: valida, quita el cierre y rechaza lo malo', () => {
  assert.equal(puntosValidos([...cuadro, cuadro[0]]).length, 4);
  assert.throws(() => puntosValidos([[0, 0], [1, 1]]));
  assert.throws(() => puntosValidos([[0, 0], [1, 1], [200, 0]]));
  assert.throws(() => puntosValidos([[0, 0], [1, 1], ['a', 0]]));
});

test('quieta en una casa pequeña: el temblor del GPS no cuenta como salidas y llegadas', async () => {
  const { calcularVisitas, metrosAlPoligono } = await import('../src/lugares/geocercas.js');
  // Casa de unos 15 m de lado.
  const casa = [[-79.91500, -2.24280], [-79.91487, -2.24280], [-79.91487, -2.24267], [-79.91500, -2.24267]];
  const t = (min) => new Date(Date.parse('2026-10-10T08:00:00Z') + min * 60000).toISOString();
  const p = (min, lon, lat) => ({ registradoEn: t(min), longitud: lon, latitud: lat, precisionM: 17, valida: true });
  const puntos = [];
  // Dos horas adentro, con uno de cada dos puntos unos metros afuera.
  for (let m = 0; m < 120; m += 2) puntos.push(p(m, m % 4 === 0 ? -79.91493 : -79.91481, -2.24273));
  // Se va lejos media hora y vuelve.
  for (let m = 120; m < 150; m += 2) puntos.push(p(m, -79.91000, -2.24000));
  for (let m = 150; m < 170; m += 2) puntos.push(p(m, -79.91493, -2.24273));
  assert.ok(metrosAlPoligono(-79.91481, -2.24273, casa) < 15);
  const visitas = calcularVisitas(puntos, casa);
  // Sin paso visto (se fue a 700 m en 2 min): las dos horas quedan en N/A.
  assert.deepEqual(visitas.map((v) => [v.llegada, v.salida]), [[null, null], [null, null]]);
});

test('un rebote del GPS de pocos segundos afuera no parte la visita en dos', () => {
  const adentro = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => [desde + i, dentro]);
  const v = calcularVisitas(
    serie(...adentro(0, 30), [30.1, cerca], [30.12, cerca], [30.14, cerca], [30.16, cerca], ...adentro(31, 60)),
    cuadro,
  );
  assert.deepEqual(v.map((x) => [x.llegada, x.salida]), [[null, null]]);
});

test('estacionado en la calle a 10 m de un local no es visita; de una casa sí', () => {
  const acera = [-79.9001, -2.195];
  const puntos = serie([0, fuera], [1, fuera], [2, acera], [4, acera], [6, acera], [8, fuera], [9, fuera], [10, fuera]);
  assert.equal(calcularVisitas(puntos, cuadro, 0).length, 0);
  assert.equal(calcularVisitas(puntos, cuadro).length, 1);
});

test('llegar a casa y cerrar la jornada al minuto cuenta como llegada', () => {
  // Afuera hasta las 12:05; adentro 3 puntos en 60 s y ya no hay más datos.
  const seg = (s, [lon, lat]) => ({ registradoEn: new Date(Date.UTC(2026, 9, 1, 12, 0, s)).toISOString(), latitud: lat, longitud: lon, precisionM: 10, valida: true });
  const puntos = [seg(0, dentro), seg(60, dentro), seg(120, dentro), seg(180, dentroBorde), seg(200, cerca), seg(260, cerca), seg(320, cerca), seg(400, cerca), seg(420, dentroBorde), seg(450, dentro), seg(480, dentro)];
  const v = calcularVisitas(puntos, cuadro);
  assert.equal(v.length, 2);
  assert.equal(v[1].llegada, puntos[8].registradoEn);
  assert.equal(v[1].salida, null);
});
