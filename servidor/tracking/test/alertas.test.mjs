import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertasDeDiagnostico } from '../src/alertas.js';

const reporte = ({ gps = true, fine = true, background = true, exempt = true, battery = 80, charging = false, jornada = true } = {}) => ({
  gps: { enabled: gps },
  perms: { fine, background },
  power: { exempt, battery, charging },
  journey: { active: jornada },
});

test('apagar el GPS en jornada avisa una sola vez y al volver avisa que lo reactivó', () => {
  const primero = alertasDeDiagnostico({}, reporte());
  assert.deepEqual(primero.eventos, []);
  const apagado = alertasDeDiagnostico(primero.parche, reporte({ gps: false }));
  assert.deepEqual(apagado.eventos, ['mobileGpsDisabled']);
  const sigue = alertasDeDiagnostico(apagado.parche, reporte({ gps: false }));
  assert.deepEqual(sigue.eventos, []);
  const vuelve = alertasDeDiagnostico(sigue.parche, reporte());
  assert.deepEqual(vuelve.eventos, ['mobileGpsReenabled']);
});

test('quitar permisos, activar el ahorro de batería y la batería crítica', () => {
  const base = alertasDeDiagnostico({}, reporte()).parche;
  assert.deepEqual(alertasDeDiagnostico(base, reporte({ background: false })).eventos, ['mobilePermissionLost']);
  assert.deepEqual(alertasDeDiagnostico(base, reporte({ exempt: false })).eventos, ['mobileBatterySaverOn']);
  assert.deepEqual(alertasDeDiagnostico(base, reporte({ battery: 4 })).eventos, ['mobileBatteryCritical']);
  assert.deepEqual(alertasDeDiagnostico(base, reporte({ battery: 4, charging: true })).eventos, []);
});

test('fuera de jornada no avisa, y la jornada que empieza con el GPS apagado sí avisa', () => {
  // Israel 21/10: el teléfono encendió con la ubicación apagada a las 07:58,
  // 14 s después inició la jornada y nunca hubo aviso hasta las 11:29.
  const fuera = alertasDeDiagnostico({}, reporte({ gps: false, jornada: false }));
  assert.deepEqual(fuera.eventos, []);
  const inicio = alertasDeDiagnostico(fuera.parche, reporte({ gps: false }));
  assert.deepEqual(inicio.eventos, ['mobileGpsDisabled']);
  assert.deepEqual(alertasDeDiagnostico(inicio.parche, reporte({ gps: false })).eventos, []);
});

test('lo avisado en una jornada se vuelve a avisar en la siguiente si sigue mal', () => {
  const ayer = alertasDeDiagnostico({}, reporte({ gps: false })).parche;
  const noche = alertasDeDiagnostico(ayer, reporte({ gps: false, jornada: false })).parche;
  assert.deepEqual(alertasDeDiagnostico(noche, reporte({ gps: false })).eventos, ['mobileGpsDisabled']);
});

test('si llega mal sin estado previo, avisa', () => {
  assert.deepEqual(alertasDeDiagnostico({}, reporte({ gps: false })).eventos, ['mobileGpsDisabled']);
});

test('ahorro de batería del sistema y reloj cambiado avisan una vez y al volver', () => {
  const ahora = Date.UTC(2026, 9, 7, 15, 0);
  const conReloj = (clockMs, saver = false) => ({ ...reporte(), power: { exempt: true, battery: 80, charging: false, saver }, device: { clockMs } });
  const base = alertasDeDiagnostico({}, conReloj(ahora), ahora).parche;
  const mal = alertasDeDiagnostico(base, conReloj(ahora + 20 * 60_000, true), ahora);
  assert.deepEqual(mal.eventos.sort(), ['mobileClockOff', 'mobilePowerSaveOn']);
  const igual = alertasDeDiagnostico(mal.parche, conReloj(ahora + 20 * 60_000, true), ahora);
  assert.deepEqual(igual.eventos, []);
  const bien = alertasDeDiagnostico(mal.parche, conReloj(ahora + 30_000, false), ahora);
  assert.deepEqual(bien.eventos.sort(), ['mobileClockOk', 'mobilePowerSaveOff']);
});

test('apagar las notificaciones de la app avisa una vez y al volver a activarlas', () => {
  const con = (notifications) => ({ ...reporte(), perms: { fine: true, background: true, notifications } });
  const base = alertasDeDiagnostico({}, con(true)).parche;
  const apagadas = alertasDeDiagnostico(base, con(false));
  assert.deepEqual(apagadas.eventos, ['mobileNotificationsOff']);
  assert.deepEqual(alertasDeDiagnostico(apagadas.parche, con(false)).eventos, []);
  assert.deepEqual(alertasDeDiagnostico(apagadas.parche, con(true)).eventos, ['mobileNotificationsOn']);
  // Una app que no informa las notificaciones no genera nada.
  assert.deepEqual(alertasDeDiagnostico(base, reporte()).eventos, []);
});

test('sin hora del teléfono no se afirma nada del reloj', () => {
  assert.deepEqual(alertasDeDiagnostico({}, reporte(), Date.now()).eventos, []);
});

test('dos diagnósticos a la vez no registran el mismo evento dos veces', async () => {
  const { esRepetido } = await import('../src/alertas.js');
  const recientes = new Map();
  assert.equal(esRepetido(recientes, 'equipo|mobileGpsReenabled', 1000), false);
  assert.equal(esRepetido(recientes, 'equipo|mobileGpsReenabled', 1016), true);
  assert.equal(esRepetido(recientes, 'equipo|mobileGpsDisabled', 1016), false);
  assert.equal(esRepetido(recientes, 'equipo|mobileGpsReenabled', 20_000), false);
});
