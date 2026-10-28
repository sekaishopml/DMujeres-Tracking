import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAvisosDeHorario, franjaDeAhora } from '../src/avisos.js';

// Guayaquil va 5 horas detrás de UTC.
const a = (hora) => Date.parse(`2026-10-12T${hora}:00-05:00`);

test('toca avisar a las 8, 14, 15 y 17, solo en los primeros minutos', () => {
  assert.equal(franjaDeAhora(a('08:00')), '2026-10-12 08:00');
  assert.equal(franjaDeAhora(a('08:09')), '2026-10-12 08:00');
  assert.equal(franjaDeAhora(a('08:10')), null);
  assert.equal(franjaDeAhora(a('14:03')), '2026-10-12 14:00');
  assert.equal(franjaDeAhora(a('15:00')), '2026-10-12 15:00');
  assert.equal(franjaDeAhora(a('17:05')), '2026-10-12 17:00');
  assert.equal(franjaDeAhora(a('12:00')), null);
});

test('manda una sola vez por hora y solo a los teléfonos con token', async () => {
  const enviados = [];
  const almacen = { listarEquipos: async () => [{ token: 'A' }, { token: null }, { token: 'B' }], marcarTokenInvalido: async () => {} };
  const emisor = { enviarAvisoHorario: async (m) => (enviados.push(m), { messageId: 'x' }) };
  const avisar = crearAvisosDeHorario();
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('08:01') }), 2);
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('08:02') }), 0);
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('09:00') }), 0);
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('14:00') }), 2);
  assert.deepEqual(enviados.map((m) => `${m.token}${m.franja}`), ['A0800', 'B0800', 'A1400', 'B1400']);
});
