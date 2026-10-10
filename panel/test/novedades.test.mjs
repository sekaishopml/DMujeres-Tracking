import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novedadesDelRecorrido } from '../src/componentes/replay/novedades.ts';

const p = (lat, hora, extra = {}) => ({ latitud: lat, longitud: -79.9, registradoEn: `2026-10-08T${hora}:00.000Z`, ...extra });

test('apagado en el mismo lugar: una sola marca con el lapso', () => {
  const n = novedadesDelRecorrido([p(-2.2, '15:00'), p(-2.2001, '15:40')], [{ desde: '2026-10-08T15:00:00.000Z', hasta: '2026-10-08T15:40:00.000Z', motivo: 'APAGADO' }]);
  assert.equal(n.length, 1);
  assert.equal(n[0].titulo, 'Apagó el teléfono');
  assert.equal(n[0].detalle, '10:00 a 10:40 · 40 min');
});

test('sin batería y volvió lejos: dos marcas', () => {
  const n = novedadesDelRecorrido(
    [p(-2.2, '15:00', { bateriaPct: 3 }), p(-2.21, '16:00', { bateriaPct: 40 })],
    [{ desde: '2026-10-08T15:00:00.000Z', hasta: '2026-10-08T16:00:00.000Z', motivo: 'SIN_CONTACTO' }],
  );
  assert.deepEqual(n.map((x) => x.titulo), ['Se quedó sin batería aquí', 'Aquí volvió']);
});

test('puntos que llegaron tarde: una marca al empezar el tramo sin internet', () => {
  const tarde = (h) => p(-2.2, h, { recibidoEn: '2026-10-08T20:15:00.000Z' });
  const n = novedadesDelRecorrido([p(-2.2, '15:00', { recibidoEn: '2026-10-08T15:00:05.000Z' }), tarde('15:05'), tarde('19:00')], []);
  assert.equal(n.length, 1);
  assert.equal(n[0].titulo, 'Sin internet desde aquí');
  assert.equal(n[0].detalle, '10:05 a 14:00 · los puntos llegaron a las 15:15');
});
