import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PARADA_S, detectarParadas } from '../src/paradas.js';

const p = (hora, latitud, longitud, precisionM = 15) => ({
  registradoEn: `2026-09-30T${hora}Z`,
  latitud,
  longitud,
  precisionM,
});

// Caminata real con la velocidad siempre en 0 y una parada de 21:00 a 21:03
// hora local (02:00-02:03 UTC).
const caminata = [
  p('01:59:11', -2.24108, -79.91612),
  p('01:59:17', -2.24115, -79.91635),
  p('01:59:28', -2.24119, -79.91661),
  p('02:00:12', -2.24124, -79.91791),
  p('02:00:23', -2.24135, -79.91804),
  p('02:00:29', -2.24151, -79.91796),
  p('02:01:41', -2.24164, -79.9179),
  p('02:03:04', -2.24195, -79.91784, 25),
  p('02:03:15', -2.24217, -79.91791, 28),
  p('02:03:20', -2.24218, -79.91749, 20),
  p('02:03:26', -2.24213, -79.91718),
  p('02:03:32', -2.24207, -79.91682, 24),
];

test('detecta la parada corta de 21:00 a 21:03 aunque la velocidad sea 0 siempre', () => {
  const paradas = detectarParadas(caminata);
  assert.equal(paradas.length, 1);
  assert.equal(paradas[0].inicio.toISOString().slice(11, 16), '02:00');
  assert.ok(paradas[0].segundos >= 150 && paradas[0].segundos <= 200, `duró ${paradas[0].segundos} s`);
});

test('puntos cada 2 min moviéndose cientos de metros no forman parada', () => {
  const puntos = [];
  let lat = -2.2;
  for (let k = 0; k < 20; k += 1) {
    lat += 0.003; // ~330 m por fix
    const t = new Date(Date.UTC(2026, 8, 29, 22, 0, 0) + k * 121_000).toISOString();
    puntos.push({ registradoEn: t, latitud: lat, longitud: -79.9, precisionM: 20 });
  }
  assert.equal(detectarParadas(puntos).length, 0);
});

test('horas de ubicación aproximada (100 m) en la misma coordenada no son una parada', () => {
  const puntos = [];
  for (let k = 0; k < 30; k += 1) {
    const t = new Date(Date.UTC(2026, 8, 29, 15, 40, 0) + k * 600_000).toISOString();
    puntos.push({ registradoEn: t, latitud: -2.17, longitud: -79.88, precisionM: 100 });
  }
  assert.equal(detectarParadas(puntos).length, 0);
});

test('una estancia de horas con deriva de GPS es una sola parada', () => {
  const puntos = [];
  for (let k = 0; k < 40; k += 1) {
    const t = new Date(Date.UTC(2026, 8, 29, 13, 0, 0) + k * 120_000).toISOString();
    const deriva = (k % 5) * 0.00008; // hasta ~35 m
    puntos.push({ registradoEn: t, latitud: -2.24283 + deriva, longitud: -79.91493 - deriva, precisionM: 15 + (k % 3) * 10 });
  }
  const paradas = detectarParadas(puntos);
  assert.equal(paradas.length, 1);
  assert.ok(paradas[0].segundos >= 39 * 120 - 1);
});

test('un hueco de más de 30 min parte la estancia aunque vuelva al mismo sitio', () => {
  const paradas = detectarParadas([
    p('10:00:00', -2.2, -79.9),
    p('10:05:00', -2.2, -79.9),
    p('11:00:00', -2.2, -79.9),
    p('11:05:00', -2.2, -79.9),
  ]);
  assert.equal(paradas.length, 2);
});

test('un fix de deriva suelto no parte una estancia en dos', () => {
  const paradas = detectarParadas([
    p('10:00:00', -2.2, -79.9),
    p('10:10:00', -2.2, -79.9),
    p('10:20:00', -2.2, -79.9),
    p('10:21:00', -2.2008, -79.9), // ~90 m, deriva
    p('10:22:00', -2.2, -79.9),
    p('10:40:00', -2.2, -79.9),
  ]);
  assert.equal(paradas.length, 1);
  assert.equal(paradas[0].segundos, 40 * 60);
});

// Estancia en un edificio, con el GPS corriéndose bajo techo.
// Dos tramos quietos en el mismo sitio separados por 10 min en los que el GPS
// salta a ~240 m y vuelve en segundos: es una sola estancia.
const quieto = (desdeMin, hastaMin, lat, lon) => {
  const lista = [];
  for (let m = desdeMin; m <= hastaMin; m += 1) {
    const hh = String(15 + Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    lista.push(p(`${hh}:${mm}:00`, lat + (m % 3) * 0.00002, lon, 10));
  }
  return lista;
};
const hm = (m, s = 0) => `${String(15 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

test('saltos sueltos del GPS bajo techo no parten la estancia', () => {
  const puntos = [
    ...quieto(0, 20, -2.22724, -79.88854),
    // Pausa de 10 min: dos saltos de ~240 m que vuelven en segundos.
    p(hm(24, 0), -2.22724, -79.8863, 18),
    p(hm(24, 20), -2.22724, -79.88854, 12),
    p(hm(27, 0), -2.2275, -79.8870, 12),
    p(hm(27, 30), -2.22724, -79.88854, 12),
    ...quieto(31, 60, -2.22742, -79.88846),
  ];
  const paradas = detectarParadas(puntos);
  assert.equal(paradas.length, 1);
  assert.equal(paradas[0].inicio.toISOString(), '2026-09-30T15:00:00.000Z');
  assert.equal(paradas[0].fin.toISOString(), '2026-09-30T16:00:00.000Z');
});

test('una salida real de más de 2 min a más de 200 m sí parte la estancia', () => {
  const puntos = [
    ...quieto(0, 20, -2.22724, -79.88854),
    // 4 min a ~300 m (fixes cada 30 s) y regresa.
    ...[0, 30, 60, 90, 120, 150, 180, 210, 240].map((s) => p(hm(23 + Math.floor(s / 60), s % 60), -2.22724, -79.88584, 8)),
    ...quieto(31, 60, -2.22742, -79.88846),
  ];
  const paradas = detectarParadas(puntos);
  const largas = paradas.filter((x) => x.segundos >= 20 * 60);
  assert.equal(largas.length, 2);
});

test('salir caminando despacio no queda dentro de la parada', () => {
  const puntos = [
    ...quieto(0, 10, -2.22742, -79.88846),
    // Sale a pie hacia el oeste, ~4 km/h (11 m cada 10 s): los 5 pasos quedan
    // dentro de 60 m, los 3 últimos fuera del núcleo de 30 m.
    ...[1, 2, 3, 4, 5].map((n) => p(hm(10, n * 10), -2.2274, -79.88846 - n * 0.0001, 3)),
  ];
  const [parada] = detectarParadas(puntos);
  assert.ok(parada, 'hay parada');
  assert.ok(parada.fin.getTime() <= Date.parse('2026-09-30T15:10:20Z'), `la parada no se come la salida (${parada.fin.toISOString()})`);
});

// Propiedades que deben cumplirse con cualquier recorrido, probadas con
// recorridos al azar (siempre los mismos): paradas ordenadas, sin solaparse,
// del largo mínimo y con el centro dentro del recorrido.
function azar(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test('con recorridos al azar las paradas son válidas y no se solapan', () => {
  for (let semilla = 1; semilla <= 40; semilla += 1) {
    const r = azar(semilla);
    const puntos = [];
    let lat = -2.2;
    let lon = -79.9;
    let t = Date.UTC(2026, 9, 7, 13, 0);
    for (let i = 0; i < 300; i += 1) {
      const quieto = r() < 0.6;
      const paso = quieto ? 0.00003 : 0.002;
      lat += (r() - 0.5) * paso;
      lon += (r() - 0.5) * paso;
      t += (r() < 0.05 ? 40 * 60 : 20 + r() * 90) * 1000;
      puntos.push({
        registradoEn: new Date(t).toISOString(),
        latitud: lat,
        longitud: lon,
        precisionM: r() < 0.15 ? 120 + r() * 800 : 5 + r() * 40,
      });
    }
    const paradas = detectarParadas(puntos);
    paradas.forEach((p, i) => {
      assert.ok(p.segundos >= MIN_PARADA_S, `semilla ${semilla}: parada más corta que el mínimo`);
      assert.ok(p.fin > p.inicio, `semilla ${semilla}: fin antes del inicio`);
      if (i > 0) assert.ok(p.inicio >= paradas[i - 1].fin, `semilla ${semilla}: paradas solapadas`);
    });
  }
});
