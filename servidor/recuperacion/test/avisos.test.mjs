import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAvisosDeHorario, franjaDeAhora } from '../src/avisos.js';

// Guayaquil va 5 horas detrás de UTC.
const a = (hora) => Date.parse(`2026-10-12T${hora}:00-05:00`);

// El 12/10/2026 es lunes y el 17/10, sábado.
test('toca avisar de lunes a viernes a las 07:30, 08:15, 12:00 y 15:00, solo en los primeros minutos', () => {
  assert.equal(franjaDeAhora(a('07:30')), '2026-10-12 07:30');
  assert.equal(franjaDeAhora(a('07:39')), '2026-10-12 07:30');
  assert.equal(franjaDeAhora(a('07:40')), null);
  assert.equal(franjaDeAhora(a('12:03')), '2026-10-12 12:00');
  assert.equal(franjaDeAhora(a('15:00')), '2026-10-12 15:00');
  assert.equal(franjaDeAhora(a('17:00')), null);
  assert.equal(franjaDeAhora(a('08:00')), null);
  assert.equal(franjaDeAhora(a('08:20')), '2026-10-12 08:15');
  assert.equal(franjaDeAhora(Date.parse('2026-10-17T07:30:00-05:00')), null);
});

test('manda una sola vez por hora y solo a los teléfonos con token', async () => {
  const enviados = [];
  const almacen = { listarEquipos: async () => [{ token: 'A' }, { token: null }, { token: 'B' }], marcarTokenInvalido: async () => {} };
  const emisor = { enviarAvisoHorario: async (m) => (enviados.push(m), { messageId: 'x' }) };
  const avisar = crearAvisosDeHorario();
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('07:31') }), 2);
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('07:32') }), 0);
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('09:00') }), 0);
  assert.equal(await avisar({ almacen, emisor, ahoraMs: a('12:00') }), 2);
  assert.deepEqual(enviados.map((m) => `${m.token}${m.franja}`), ['A0730', 'B0730', 'A1200', 'B1200']);
});

test('a las 08:15 solo a los que no mandaron puntos desde las 08:00', async () => {
  const enviados = [];
  const almacen = {
    listarEquipos: async () => [
      { token: 'A', ultimaPosicionEn: new Date(a('08:05')) },
      { token: 'B', ultimaPosicionEn: new Date(a('07:50')) },
      { token: 'C', ultimaPosicionEn: null },
    ],
    marcarTokenInvalido: async () => {},
  };
  const emisor = { enviarAvisoHorario: async (m) => (enviados.push(m.token), { messageId: 'x' }) };
  assert.equal(await crearAvisosDeHorario()({ almacen, emisor, ahoraMs: a('08:16') }), 2);
  assert.deepEqual(enviados, ['B', 'C']);
});
