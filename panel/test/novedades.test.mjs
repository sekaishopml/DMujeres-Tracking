import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corteAlInicio, novedadesDelRecorrido, textoCorteAlInicio } from '../src/componentes/replay/novedades.ts';

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

test('los avisos del teléfono se marcan donde estaba la persona, sin repetir lo que ya dice un corte', () => {
  const posiciones = [p(-2.2, '15:00'), p(-2.21, '15:10'), p(-2.22, '15:50'), p(-2.23, '16:00')];
  const cortes = [{ desde: '2026-10-08T15:10:00.000Z', hasta: '2026-10-08T15:50:00.000Z', motivo: 'GPS_APAGADO' }];
  const avisos = [
    { tipo: 'mobileGpsDisabled', texto: 'Apagó el GPS', en: '2026-10-08T15:11:00.000Z' },
    { tipo: 'mobileGpsReenabled', texto: 'Reactivó el GPS', en: '2026-10-08T15:49:00.000Z' },
    { tipo: 'mobileNotificationsOff', texto: 'Apagó las notificaciones de la app', en: '2026-10-08T15:55:00.000Z' },
  ];
  const titulos = novedadesDelRecorrido(posiciones, cortes, avisos).map((n) => n.titulo);
  assert.equal(titulos.filter((t) => t === 'Apagó el GPS').length, 0);
  assert.ok(titulos.includes('Reactivó el GPS'));
  const notificaciones = novedadesDelRecorrido(posiciones, cortes, avisos).find((n) => n.titulo === 'Apagó las notificaciones de la app');
  assert.equal(notificaciones.indice, 2);
});

const cortesSeguidos = (n) =>
  Array.from({ length: n }, (_, k) => ({
    desde: `2026-10-08T${String(15 + Math.floor((k * 15) / 60)).padStart(2, '0')}:${String((k * 15) % 60).padStart(2, '0')}:00.000Z`,
    hasta: `2026-10-08T${String(15 + Math.floor(((k + 1) * 15) / 60)).padStart(2, '0')}:${String(((k + 1) * 15) % 60).padStart(2, '0')}:00.000Z`,
    motivo: 'SIN_SENAL',
  }));

test('más de 3 cortes de señal seguidos en el mismo lugar: una sola señal débil', () => {
  const posiciones = Array.from({ length: 5 }, (_, k) => p(-2.2, `${String(15 + Math.floor((k * 15) / 60)).padStart(2, '0')}:${String((k * 15) % 60).padStart(2, '0')}`));
  const n = novedadesDelRecorrido(posiciones, cortesSeguidos(4));
  assert.equal(n.length, 1);
  assert.equal(n[0].titulo, 'Señal débil');
  assert.equal(n[0].detalle, '10:00 a 11:00 · 1 h');
});

test('tres cortes de señal en el mismo lugar se siguen marcando uno a uno', () => {
  const posiciones = Array.from({ length: 4 }, (_, k) => p(-2.2, `${String(15 + Math.floor((k * 15) / 60)).padStart(2, '0')}:${String((k * 15) % 60).padStart(2, '0')}`));
  const n = novedadesDelRecorrido(posiciones, cortesSeguidos(3));
  assert.equal(n.length, 3);
  assert.ok(n.every((x) => x.titulo === 'Sin señal GPS'));
});

test('jornada que empezó sin ubicación: se marca en el primer punto con su lapso', () => {
  // Israel 21/10: jornada 07:58, ubicación apagada, primer punto 12:02.
  const n = novedadesDelRecorrido(
    [p(-2.2, '17:02'), p(-2.2001, '17:10')],
    [{ desde: '2026-10-08T12:58:00.000Z', hasta: '2026-10-08T17:02:00.000Z', motivo: 'GPS_APAGADO' }],
  );
  assert.equal(n.length, 1);
  assert.equal(n[0].indice, 0);
  assert.equal(n[0].titulo, 'Inició la jornada sin ruta: ubicación apagada');
  assert.equal(n[0].detalle, '07:58 a 12:02 · 4 h 4 min');
});

test('la línea de tiempo empieza en el corte del inicio de la jornada', () => {
  const posiciones = [p(-2.2, '17:02'), p(-2.2001, '17:10')];
  const inicio = { desde: '2026-10-08T12:58:00.000Z', hasta: '2026-10-08T17:02:00.000Z', motivo: 'GPS_APAGADO' };
  const medio = { desde: '2026-10-08T17:02:00.000Z', hasta: '2026-10-08T17:10:00.000Z', motivo: 'SIN_SENAL' };
  assert.equal(corteAlInicio(posiciones, [medio, inicio]), inicio);
  assert.equal(corteAlInicio(posiciones, [medio]), null);
  assert.equal(textoCorteAlInicio(inicio), 'Sin ruta: ubicación apagada');
});
