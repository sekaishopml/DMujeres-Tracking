import test from 'node:test';
import assert from 'node:assert/strict';
import { depurarPosiciones } from '../src/recorrido/depuracion.js';
import { validarAjusteMatch } from '../src/recorrido/ruteo.js';

const pos = (seg, lat, lon, precisionM) => ({
  id: seg,
  registradoEn: new Date(Date.UTC(2026, 9, 3, 1, 0, seg)).toISOString(),
  latitud: lat,
  longitud: lon,
  precisionM,
});

test('quita las posiciones viejas que preceden a un salto a un punto mucho más preciso', () => {
  const lista = [
    pos(0, -2.2287, -79.8942, 14),
    pos(48, -2.2305, -79.8960, 17),
    pos(53, -2.2306, -79.8962, 20),
    pos(60, -2.2328, -79.8941, 5),
    pos(62, -2.2328, -79.8942, 5),
  ];
  const { conservadas } = depurarPosiciones(lista);
  assert.deepEqual(conservadas.map((p) => p.id), [0, 60, 62]);
});

test('no quita puntos si el que llega no es mucho mejor', () => {
  const lista = [pos(0, -2.2287, -79.8942, 14), pos(53, -2.2306, -79.8962, 20), pos(60, -2.2328, -79.8941, 18)];
  assert.equal(depurarPosiciones(lista).conservadas.length, 3);
});

test('un ajuste correcto de un trazo con GPS ruidoso no se descarta por el temblor', () => {
  // Calle recta de 600 m al sur; cada 6 m el GPS salta 3 m a un lado y al otro.
  const puntos = [];
  for (let i = 0; i <= 100; i += 1) puntos.push({ latitud: -2.2287 - i * 0.000054, longitud: -79.8942 + (i % 2 ? 0.000027 : -0.000027), precisionM: 22 });
  const trazo = [[-79.8942, -2.2287], [-79.8942, -2.2287 - 100 * 0.000054]];
  const v = validarAjusteMatch(puntos, trazo);
  assert.ok(v.longAjustadaM / v.longCrudaM < 0.75, 'el largo crudo debe estar inflado');
  assert.equal(v.valida, true, JSON.stringify(v));
});

test('un ajuste que se desvía de los puntos sigue descartándose', () => {
  const puntos = [];
  for (let i = 0; i <= 20; i += 1) puntos.push({ latitud: -2.2287 - i * 0.00018, longitud: -79.8942, precisionM: 5 });
  const trazo = [[-79.8932, -2.2287], [-79.8932, -2.2287 - 20 * 0.00018]];
  assert.equal(validarAjusteMatch(puntos, trazo).valida, false);
});

// Israel 26/10 12:31: GPS de 2 m y la calle del mapa 18 m al lado.
test('con GPS preciso, un ajuste corrido de los puntos se descarta', () => {
  const puntos = [];
  for (let i = 0; i <= 20; i += 1) puntos.push({ latitud: -2.2287 - i * 0.00018, longitud: -79.8942, precisionM: 2 });
  const corrido = (m) => [[-79.8942 + m / 111320, -2.2287], [-79.8942 + m / 111320, -2.2287 - 20 * 0.00018]];
  assert.equal(validarAjusteMatch(puntos, corrido(18)).valida, false);
  assert.equal(validarAjusteMatch(puntos, corrido(6)).valida, true);
});

test('quita el pico de velocidad de un teléfono quieto, pero no un giro real en marcha', () => {
  const quieto = [
    { ...pos(0, -2.24258, -79.91470, 15), velocidadKmh: 0 },
    { ...pos(174, -2.24311, -79.91451, 8), velocidadKmh: 24 },
    { ...pos(183, -2.24277, -79.91468, 2), velocidadKmh: 5 },
  ];
  assert.deepEqual(depurarPosiciones(quieto).conservadas.map((p) => p.id), [0, 183]);
  const enMarcha = quieto.map((p) => ({ ...p, velocidadKmh: 30 }));
  assert.equal(depurarPosiciones(enMarcha).conservadas.length, 3);
});

test('ráfaga al despertar: puntos que saltan diciendo que está quieta quedan en uno solo', async () => {
  const { sinRafagasQuietas } = await import('../src/recorrido/depuracion.js');
  const t = (s) => new Date(Date.parse('2026-10-10T15:00:00Z') + s * 1000).toISOString();
  const p = (s, lat, lon, velocidadKmh) => ({ registradoEn: t(s), latitud: lat, longitud: lon, velocidadKmh, precisionM: 5 });
  const antes = [p(0, -2.2390, -79.8938, 40), p(5, -2.2391, -79.8930, 40)];
  // Cinco minutos dormido, 35 s de saltos de hasta 150 m con velocidad de estar quieta, y calla de nuevo.
  const rafaga = [p(305, -2.22724, -79.88854, 1), p(322, -2.22793, -79.88735, 3), p(327, -2.22801, -79.88751, 2), p(340, -2.22741, -79.88811, 1)];
  const despues = [p(900, -2.2384, -79.8912, 3), p(905, -2.2385, -79.8913, 15)];
  const r = sinRafagasQuietas([...antes, ...rafaga, ...despues]);
  assert.equal(r.quitadas, 3);
  assert.deepEqual(r.lista.map((x) => x.registradoEn), [t(0), t(5), t(340), t(900), t(905)]);
  // Si en esos segundos iba en vehículo, es recorrido real y se conserva.
  const enAuto = rafaga.map((x) => ({ ...x, velocidadKmh: 35 }));
  assert.equal(sinRafagasQuietas([...antes, ...enAuto, ...despues]).quitadas, 0);
});

test('quita la lectura que se aleja 150 m a más de 60 km/h y vuelve lenta; un viaje real se conserva', () => {
  const pico = [
    { ...pos(0, -2.244146, -79.915213, 14), velocidadKmh: 61 },
    { ...pos(11, -2.246455, -79.915575, 11), velocidadKmh: 83 },
    { ...pos(22, -2.246203, -79.915583, 9), velocidadKmh: 25 },
    { ...pos(33, -2.245435, -79.915478, 13), velocidadKmh: 7 },
  ];
  assert.deepEqual(depurarPosiciones(pico).conservadas.map((p) => p.id), [0, 22, 33]);
  const viaje = [0, 10, 20, 30].map((seg, i) => ({ ...pos(seg, -2.244 - i * 0.0013, -79.915, 8), velocidadKmh: 80 }));
  assert.equal(depurarPosiciones(viaje).conservadas.length, 4);
});

// Jeremy 27/10, en la oficina: casos reales del depurador.
const fix = (s, metrosNorte, extra = {}) => ({
  id: s,
  registradoEn: new Date(Date.UTC(2026, 9, 27, 23, 0, 0) + s * 1000).toISOString(),
  latitud: -2.2274 + metrosNorte / 111320,
  longitud: -79.88842,
  precisionM: 8,
  velocidadKmh: 4,
  ...extra,
});

test('un salto caminando que vuelve en más de un minuto se quita', async () => {
  const { depurarPosiciones } = await import('../src/recorrido/depuracion.js');
  // 18:51: camina a 4 km/h, salta 600 m en 17 s y vuelve en 76 s.
  const lista = [fix(0, 0), fix(7, 10), fix(24, 610), fix(25, 620), fix(101, 120), fix(110, 130)];
  assert.deepEqual(depurarPosiciones(lista).conservadas.map((p) => p.id), [0, 7, 101, 110]);
});

test('un punto falso al despertar tras un silencio se quita', async () => {
  const { depurarPosiciones } = await import('../src/recorrido/depuracion.js');
  // 11:04 quieta; 4 min sin puntos; aparece a 445 m con ±11 m y vuelve.
  const lista = [fix(0, 0), fix(231, 445, { precisionM: 11 }), fix(232, 425), fix(233, 402), fix(283, 16), fix(287, 16)];
  assert.deepEqual(depurarPosiciones(lista).conservadas.map((p) => p.id), [0, 283, 287]);
  // Si de verdad se fue, no vuelve: se conserva.
  const viaje = [fix(0, 0), fix(231, 900, { velocidadKmh: 40 }), fix(241, 1000, { velocidadKmh: 40 }), fix(251, 1100, { velocidadKmh: 40 })];
  assert.equal(depurarPosiciones(viaje).conservadas.length, 4);
});

test('una racha de puntos por red al perder el GPS manejando se quita', async () => {
  const { depurarPosiciones } = await import('../src/recorrido/depuracion.js');
  const red = Array.from({ length: 12 }, (_, k) => fix(100 + k * 20, 300 + k * 120, { precisionM: k % 2 ? 200 : 100, velocidadKmh: 0 }));
  const lista = [fix(0, 0, { velocidadKmh: 45 }), fix(1, 12, { velocidadKmh: 45 }), ...red, fix(400, 2100, { velocidadKmh: 30 }), fix(401, 2110, { velocidadKmh: 30 })];
  assert.equal(depurarPosiciones(lista).conservadas.length, 4);
});

// Jeremy 27/10 17:27: un punto a 180 km/h entre otros a 25-58 km/h.
test('la velocidad máxima es la sostenida, no un pico del GPS', async () => {
  const { velocidadMaximaSostenidaKmh } = await import('../src/recorrido/geo.js');
  // Avanza 11 m por segundo (40 km/h) y un punto salta 50 m (180 km/h).
  const lista = Array.from({ length: 10 }, (_, k) => fix(k, k * 11, { velocidadKmh: 40, precisionM: 8 }));
  lista[5] = fix(5, 5 * 11 + 39, { velocidadKmh: 180, precisionM: 8 });
  const v = velocidadMaximaSostenidaKmh(lista);
  assert.ok(v > 35 && v <= 41, String(v));
  // Sin tres puntos precisos seguidos no hay dato.
  assert.equal(velocidadMaximaSostenidaKmh(lista.map((p) => ({ ...p, precisionM: 100 }))), 0);
});
