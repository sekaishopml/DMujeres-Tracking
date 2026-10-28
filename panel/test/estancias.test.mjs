// Estancias: rebote del GPS frente a movimiento real, en los bordes y dentro
// de las paradas. Casos tomados de rutas reales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contadorDePasosFiable, salidasDuranteParada, unirParadasSinSalir } from '../src/dominio/paradasUnidas.ts';

const LAT = -2.22707;
const LON = -79.88844;
const base = Date.UTC(2026, 9, 26, 22, 0, 0);
const iso = (s) => new Date(base + s * 1000).toISOString();
// Punto a `m` metros al norte del lugar, a los `s` segundos.
const punto = (s, m, extra = {}) => ({ registradoEn: iso(s), latitud: LAT + m / 111320, longitud: LON, precisionM: 5, ...extra });
const parada = (desde, hasta) => ({ inicio: iso(desde), fin: iso(hasta), duracionMin: 0, latitud: LAT, longitud: LON, direccion: null });

test('el contador de pasos solo cuenta si avanza en el día', () => {
  assert.equal(contadorDePasosFiable([punto(0, 0, { pasos: 0 }), punto(60, 0, { pasos: 0 })]), false);
  const vivo = Array.from({ length: 30 }, (_, i) => punto(i * 60, 0, { pasos: i * 10 }));
  assert.equal(contadorDePasosFiable(vivo), true);
});

// Israel 26/10 17:02: antes de irse el GPS salta 160 m en 3 s y vuelve.
test('el rebote antes de salir queda dentro de la estancia', () => {
  const puntos = [
    punto(0, 10), punto(5, 230), punto(7, 240), punto(9, 210), punto(16, 20), punto(60, 15),
    // salida real: se aleja de forma pareja hasta 600 m
    ...Array.from({ length: 12 }, (_, i) => punto(70 + i * 5, 30 + i * 50)),
  ];
  const [unica] = unirParadasSinSalir([parada(-600, 0)], [], puntos);
  // Termina después del rebote y antes de alejarse de verdad.
  assert.ok(unica.fin >= iso(60) && unica.fin <= iso(75), unica.fin);
});

// Nadia 26/10 08:09: llega en carro y da una vuelta buscando estacionamiento.
test('la vuelta en carro al llegar no se tapa', () => {
  const llegada = Array.from({ length: 10 }, (_, i) => punto(-300 + i * 10, 900 - i * 90)); // de 900 m a 90 m
  const vuelta = [punto(-200, 60), ...Array.from({ length: 8 }, (_, i) => punto(-190 + i * 6, 100 + i * 25)), ...Array.from({ length: 8 }, (_, i) => punto(-140 + i * 6, 280 - i * 25)), punto(-90, 40)];
  const [unica] = unirParadasSinSalir([parada(0, 600)], [], [...llegada, ...vuelta, punto(0, 5)]);
  assert.ok(Date.parse(unica.inicio) >= Date.parse(iso(-90)), unica.inicio);
});

// Miguel 23/10: sale de casa en carro 20 min y vuelve; la parada lo tapaba.
test('un viaje real durante una parada se reconoce como salida', () => {
  const pasos = (s) => (s < 0 ? 700 : s < 1200 ? 880 : 960);
  const puntos = [
    ...Array.from({ length: 10 }, (_, i) => punto(-600 + i * 60, 5, { pasos: 600 + i * 30 })),
    ...Array.from({ length: 40 }, (_, i) => punto(i * 15, i < 20 ? i * 150 : (40 - i) * 150, { pasos: pasos(i * 15) })),
    ...Array.from({ length: 10 }, (_, i) => punto(700 + i * 60, 5, { pasos: 960 + i * 5 })),
  ];
  const salidas = salidasDuranteParada(parada(-600, 1300), puntos, true, false);
  assert.equal(salidas.length, 1);
  // El mismo recorrido sin un solo paso alrededor (teléfono olvidado en la oficina): no salió.
  const quieto = puntos.map((p) => ({ ...p, pasos: 700 }));
  const vivo = Array.from({ length: 30 }, (_, i) => punto(-5000 + i * 60, 0, { pasos: i * 20 }));
  assert.equal(salidasDuranteParada(parada(-600, 1300), [...vivo, ...quieto], true, false).length, 0);
});

// Sin contador de pasos (Sonnia, Melina) decide la actividad del teléfono:
// el rebote bajo techo dice "quieto"; un viaje real, "en vehículo".
test('sin pasos, una salida sin actividad en movimiento no cuenta', () => {
  const salida = (actividad, enCasa = 'STILL') => [
    ...Array.from({ length: 10 }, (_, i) => punto(-600 + i * 60, 5, { actividad: enCasa })),
    ...Array.from({ length: 40 }, (_, i) => punto(i * 15, i < 20 ? i * 150 : (40 - i) * 150, { actividad })),
    ...Array.from({ length: 10 }, (_, i) => punto(700 + i * 60, 5, { actividad: enCasa })),
  ];
  assert.equal(salidasDuranteParada(parada(-600, 1300), salida('IN_VEHICLE'), false, true).length, 1);
  assert.equal(salidasDuranteParada(parada(-600, 1300), salida('STILL'), false, true).length, 0);
  // Sin el permiso de actividad no hay con qué decidir: se muestra.
  assert.equal(salidasDuranteParada(parada(-600, 1300), salida(null, null), false, false).length, 1);
  // Sonnia 26/10 de noche: el teléfono se reportó quieto y después no avisó
  // más (Google calla mientras sigue quieto); el GPS se fue 200 m. No salió.
  assert.equal(salidasDuranteParada(parada(-600, 1300), salida(null), false, false).length, 0);
});

// Diego 26/10 18:28: la parada quedó en el centro de la geocerca y la línea
// de salida empezaba a 150 m; se veía cortada.
test('la ruta nunca queda partida: se une pasando por la parada', async () => {
  const { coser } = await import('../src/componentes/replay/trazo.ts');
  const lugar = [LON, LAT];
  const lejos = (m) => [LON, LAT + m / 111320];
  const llegada = { tipo: 'ruta', modo: 'vehiculo', coordenadas: [lejos(-500), lugar], instante: Date.parse(iso(-60)) };
  const salida = { tipo: 'ruta', modo: 'caminata', coordenadas: [lejos(150), lejos(300)], instante: Date.parse(iso(700)) };
  const fin = (s) => (s.instante ?? 0) + 60_000;
  const cosido = coser([llegada, salida], [parada(0, 600)], fin);
  const union = cosido.slice(2);
  assert.equal(union.length, 1);
  assert.equal(union[0].tipo, 'hueco');
  assert.deepEqual(union[0].coordenadas, [lugar, lejos(150)]);
  // Unos metros se cierran con la misma línea.
  const corta = coser([llegada, { ...salida, coordenadas: [lejos(10), lejos(300)] }], [parada(0, 600)], fin).slice(2);
  assert.equal(corta[0].tipo, 'ruta');
});

// Israel 26/10 13:01: en carro, dos lecturas rebotan 270 m al norte y vuelve.
test('un rebote de dos puntos en marcha se quita', async () => {
  const { depurarRecorrido } = await import('../src/dominio/depuracion.ts');
  const este = (s, m) => ({ registradoEn: iso(s), latitud: LAT, longitud: LON + m / 111320, precisionM: 3 });
  const puntos = [este(0, 0), este(2, 28), este(4, 56), { ...punto(10, 270), precisionM: 13 }, { ...punto(14, 350), precisionM: 12 }, este(26, 300), este(28, 328)];
  const limpio = depurarRecorrido(puntos).posiciones;
  assert.equal(limpio.length, 5);
  assert.ok(limpio.every((p) => p.latitud === LAT));
});

// La misma calle de ida (09:00) y de vuelta (17:00): la hora sale del tramo
// bajo el cursor, no de la primera pasada.
test('sobre una calle recorrida dos veces, gana la pasada del tramo señalado', async () => {
  const { horaSobreTrazo } = await import('../src/componentes/replay/flechas.ts');
  const ida = [{ lon: LON, lat: LAT, t: 9 * 3600e3 }, { lon: LON, lat: LAT + 0.002, t: 9 * 3600e3 + 60e3 }];
  const vuelta = [{ lon: LON + 0.00002, lat: LAT + 0.002, t: 17 * 3600e3 }, { lon: LON + 0.00002, lat: LAT, t: 17 * 3600e3 + 60e3 }];
  const t = horaSobreTrazo([ida, vuelta], LON, LAT + 0.001, 40, 17 * 3600e3);
  assert.ok(t >= 17 * 3600e3, String(t));
  assert.ok(horaSobreTrazo([ida, vuelta], LON, LAT + 0.001) < 10 * 3600e3);
});

// Diego 26/10 18:21-18:26: da la vuelta a la manzana a 110 pasos por minuto
// dentro de 70 m. No es una parada; esperar quieto después sí.
test('una caminata corta en poco espacio no es parada', async () => {
  const { caminando } = await import('../src/dominio/depuracion.ts');
  const andando = Array.from({ length: 13 }, (_, i) => punto(i * 10, (i % 4) * 15, { pasos: 1700 + i * 18 }));
  assert.equal(caminando(andando), true);
  const quieto = Array.from({ length: 13 }, (_, i) => punto(i * 10, 0, { pasos: 2083 }));
  assert.equal(caminando(quieto), false);
  // El contador que vuelve a cero al empezar otra jornada no cuenta como pasos.
  assert.equal(caminando([punto(0, 0, { pasos: 5000 }), punto(120, 0, { pasos: 0 }), punto(240, 0, { pasos: 10 })]), false);
});

// Ir en carro no suma pasos: un viaje con velocidad de vehículo es salida
// aunque el contador no se mueva.
test('un viaje en carro sin pasos sigue siendo salida', () => {
  const pasos = 700;
  const vivo = Array.from({ length: 30 }, (_, i) => punto(-5000 + i * 60, 0, { pasos: i * 20 }));
  const puntos = [
    ...vivo,
    ...Array.from({ length: 10 }, (_, i) => punto(-600 + i * 60, 5, { pasos })),
    ...Array.from({ length: 40 }, (_, i) => punto(i * 15, i < 20 ? i * 150 : (40 - i) * 150, { pasos, velocidadKmh: 36 })),
    ...Array.from({ length: 10 }, (_, i) => punto(700 + i * 60, 5, { pasos })),
  ];
  assert.equal(salidasDuranteParada(parada(-600, 1300), puntos, true, false).length, 1);
});

test('la parada informa los minutos sin datos que incluye', () => {
  const puntos = Array.from({ length: 20 }, (_, i) => punto(i * 60, 5));
  const corte = { desde: iso(300), hasta: iso(900), motivo: 'SIN_SENAL' };
  const [unica] = unirParadasSinSalir([parada(0, 1200)], [corte], puntos);
  assert.equal(unica.cortesMin, 10);
});
