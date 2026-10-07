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

test('fuera de jornada no avisa pero recuerda el estado', () => {
  const fuera = alertasDeDiagnostico({}, reporte({ gps: false, jornada: false }));
  assert.deepEqual(fuera.eventos, []);
  assert.equal(fuera.parche['alerta.gps'], false);
  // Si inicia la jornada con el GPS apagado no se repite: ya se sabía.
  assert.deepEqual(alertasDeDiagnostico(fuera.parche, reporte({ gps: false })).eventos, []);
});

test('si llega mal sin estado previo, avisa', () => {
  assert.deepEqual(alertasDeDiagnostico({}, reporte({ gps: false })).eventos, ['mobileGpsDisabled']);
});
