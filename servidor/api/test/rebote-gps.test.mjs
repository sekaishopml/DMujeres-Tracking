import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrarOutliersTeleport } from '../src/recorrido/ruteo.js';

// Diego Duarte 15/10, Quito: el GPS rebota unos 100 m al este de la avenida
// entre 08:00:43 y 08:00:50 con precisión de 6-8 m.
const p = (hms, lat, lon, v, acc) => ({ registradoEn: `2026-10-15T${hms}-05:00`, latitud: lat, longitud: lon, velocidadKmh: v, precisionM: acc });
const puntos = [
  p('08:00:17', -0.18776, -78.49578, 43.6, 3),
  p('08:00:18', -0.18762, -78.49571, 46.2, 3),
  p('08:00:19', -0.18747, -78.49567, 53.3, 3),
  p('08:00:40', -0.18460, -78.49572, 40.9, 15),
  p('08:00:43', -0.18583, -78.49541, 35.7, 8),
  p('08:00:44', -0.18616, -78.49525, 30.0, 8),
  p('08:00:45', -0.18640, -78.49504, 26.6, 8),
  p('08:00:46', -0.18651, -78.49489, 23.6, 7),
  p('08:00:48', -0.18598, -78.49407, 16.7, 7),
  p('08:00:50', -0.18614, -78.49411, 8.0, 6),
  p('08:01:33', -0.18399, -78.49505, 7.1, 1),
  p('08:01:36', -0.18389, -78.49503, 17.0, 2),
  p('08:01:38', -0.18379, -78.49502, 22.0, 2),
];

test('el rebote del GPS entre edificios no entra al ajuste a calles', () => {
  const horas = filtrarOutliersTeleport(puntos).map((x) => x.registradoEn.slice(11, 19));
  assert.deepEqual(horas, ['08:00:17', '08:00:18', '08:00:19', '08:00:40', '08:01:33', '08:01:36', '08:01:38']);
});

test('un auto que va rápido y reporta su velocidad no pierde puntos', () => {
  // 15 m por segundo (54 km/h) reportando 54 km/h.
  const recta = Array.from({ length: 10 }, (_, i) => p(`08:10:${String(i).padStart(2, '0')}`, -0.18 + i * 0.000135, -78.49, 54, 4));
  assert.equal(filtrarOutliersTeleport(recta).length, 10);
});
