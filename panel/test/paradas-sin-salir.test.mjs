import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unirParadasSinSalir } from '../src/dominio/paradasUnidas.ts';

const t = (h, m = 0) => new Date(Date.UTC(2026, 9, 11, h + 5, m)).toISOString();
const parada = (ini, fin, lon = -79.88845, lat = -2.22741) => ({
  inicio: ini, fin, duracionMin: 0, latitud: lat, longitud: lon, direccion: null,
});
const sinSenal = (desde, hasta) => ({ desde, hasta, duracionSegundos: 0, motivo: 'SIN_SENAL' });

test('dos paradas en el mismo lugar separadas por un corte sin señal son una', () => {
  const unidas = unirParadasSinSalir(
    [parada(t(11, 53), t(12, 23)), parada(t(15, 3), t(17, 34))],
    [sinSenal(t(12, 23), t(15, 3))],
  );
  assert.equal(unidas.length, 1);
  assert.equal(unidas[0].inicio, t(11, 53));
  assert.equal(unidas[0].fin, t(17, 34));
});

test('si se movió entre las dos, o el corte no es de señal, no se une', () => {
  const lejos = [parada(t(11, 53), t(12, 23)), parada(t(15, 3), t(17, 34), -79.9, -2.2)];
  assert.equal(unirParadasSinSalir(lejos, [sinSenal(t(12, 23), t(15, 3))]).length, 2);
  const cerca = [parada(t(11, 53), t(12, 23)), parada(t(15, 3), t(17, 34))];
  assert.equal(unirParadasSinSalir(cerca, [{ ...sinSenal(t(12, 23), t(15, 3)), motivo: 'FUERA_DE_JORNADA' }]).length, 2);
});

test('GPS apagado entre las dos paradas, o dos cortes seguidos: una sola parada', () => {
  const dos = [parada(t(15, 23), t(16, 11)), parada(t(17, 18), t(18, 55))];
  const apagado = { desde: t(16, 11), hasta: t(17, 18), duracionSegundos: 0, motivo: 'GPS_APAGADO' };
  assert.equal(unirParadasSinSalir(dos, [apagado]).length, 1);
  const seguidos = [sinSenal(t(16, 11), t(16, 40)), { ...sinSenal(t(16, 40), t(17, 18)), motivo: 'SIN_CONTACTO' }];
  assert.equal(unirParadasSinSalir(dos, seguidos).length, 1);
});

test('con datos entre las dos y más de 5 min, o con otra jornada de por medio, siguen separadas', () => {
  const dos = [parada(t(15, 23), t(16, 11)), parada(t(17, 18), t(18, 55))];
  assert.equal(unirParadasSinSalir(dos, []).length, 2);
  assert.equal(unirParadasSinSalir(dos, [sinSenal(t(16, 11), t(16, 20))]).length, 2);
  const corta = [parada(t(10, 0), t(10, 20)), parada(t(10, 23), t(10, 50))];
  assert.equal(unirParadasSinSalir(corta, []).length, 1);
});

test('un viaje dentro de una pausa corta separa las paradas; un pico del GPS no', () => {
  const dos = [parada(t(10, 0), t(10, 2)), parada(t(10, 6), t(10, 50))];
  const punto = (h, m, s, lejos) => ({
    registradoEn: new Date(Date.UTC(2026, 9, 11, h + 5, m, s)).toISOString(),
    latitud: -2.22741 + (lejos ? 0.005 : 0), longitud: -79.88845, precisionM: 8,
  });
  const viaje = [punto(10, 3, 0, true), punto(10, 4, 0, true), punto(10, 5, 0, true)];
  assert.equal(unirParadasSinSalir(dos, [], viaje).length, 2);
  const pico = [punto(10, 3, 0, true), punto(10, 3, 30, true), punto(10, 3, 40, false)];
  assert.equal(unirParadasSinSalir(dos, [], pico).length, 1);
});

test('el GPS que salta entre la oficina y la vereda no parte la estadía', async () => {
  const { unirParadasSinSalir } = await import('../src/dominio/paradasUnidas.ts');
  const t = (h, m) => new Date(Date.UTC(2026, 9, 15, h + 5, m)).toISOString();
  const oficina = { latitud: -0.18411, longitud: -78.49202 };
  const vereda = { latitud: -0.18454, longitud: -78.49273 }; // ~93 m
  const paradas = [
    { inicio: t(14, 30), fin: t(14, 37), duracionMin: 7, ...oficina, direccion: null },
    { inicio: t(14, 46), fin: t(14, 51), duracionMin: 5, ...vereda, direccion: null },
    { inicio: t(15, 10), fin: t(17, 14), duracionMin: 124, ...oficina, direccion: null },
  ];
  const saltos = [38, 40, 43, 55, 58, 60, 65].map((m, i) => ({ registradoEn: t(14 + Math.floor(m / 60), m % 60), ...(i % 2 ? vereda : oficina), precisionM: 8 }));
  assert.equal(unirParadasSinSalir(paradas, [], saltos).length, 1);
  // Si entre la primera y la segunda se fue a 400 m varios minutos, con un
  // trazo posible, salió: esas dos siguen separadas.
  const lejos = (m) => ({ registradoEn: t(14, m), latitud: -0.1805, longitud: -78.49202, precisionM: 5 });
  const viaje = [...saltos.filter((p) => p.registradoEn > t(14, 44)), saltos[0], lejos(39), lejos(40), lejos(41), lejos(42), { ...saltos[1], registradoEn: t(14, 44) }]
    .sort((a, b) => a.registradoEn.localeCompare(b.registradoEn));
  assert.equal(unirParadasSinSalir(paradas, [], viaje).length, 2);
  // Dos puntos lejos en un minuto son un rebote: no basta para partirla.
  const pico = [...saltos, lejos(41), lejos(42)].sort((a, b) => a.registradoEn.localeCompare(b.registradoEn));
  assert.equal(unirParadasSinSalir(paradas, [], pico).length, 1);
});

// Diego, 26/10: diez paradas en la oficina partidas por saltos del GPS bajo
// techo, sin un paso entre una y otra.
test('dos paradas en el mismo lugar sin pasos entre ellas son una', () => {
  const punto = (h, m, pasos, lejos = false) => ({ registradoEn: t(h, m), latitud: -2.22741 + (lejos ? 0.004 : 0), longitud: -79.88845, precisionM: 5, pasos });
  // El contador funciona ese día: avanzó en la mañana.
  const manana = Array.from({ length: 25 }, (_, i) => punto(7, i * 2, i * 20));
  const paradas = [parada(t(9, 0), t(10, 0)), parada(t(11, 0), t(12, 0), -79.8887, -2.2275)];
  // "Rebote" a 440 m durante 35 min sin pasos: se quedó.
  const rebote = Array.from({ length: 13 }, (_, i) => punto(10, i * 5, i === 12 ? 492 : 480, i > 2 && i < 10));
  assert.equal(unirParadasSinSalir(paradas, [], [...manana, ...rebote]).length, 1);
  // El mismo recorrido caminando 40 pasos cada 5 min: salió.
  const viaje = Array.from({ length: 13 }, (_, i) => punto(10, i * 5, 480 + i * 40, i > 2 && i < 10));
  assert.equal(unirParadasSinSalir(paradas, [], [...manana, ...viaje]).length, 2);
});
