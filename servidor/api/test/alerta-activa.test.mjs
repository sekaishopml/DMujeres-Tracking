import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertaActivaDe } from '../src/dto.js';

test('una alerta del teléfono se ve solo mientras hay jornada', () => {
  const enJornada = { jornada_activa: true, atributos: { 'alerta.permisos': false } };
  assert.equal(alertaActivaDe(enJornada), 'Permiso de ubicación quitado');
  assert.equal(alertaActivaDe({ ...enJornada, jornada_activa: false }), null);
});

test('GPS y notificaciones apagados se nombran; todo encendido no alerta', () => {
  assert.equal(alertaActivaDe({ jornada_activa: true, atributos: { 'alerta.gps': false } }), 'GPS apagado');
  assert.equal(alertaActivaDe({ jornada_activa: true, atributos: { 'alerta.notificaciones': false } }), 'Notificaciones apagadas');
  assert.equal(alertaActivaDe({ jornada_activa: true, atributos: { 'alerta.gps': true, 'alerta.permisos': true } }), null);
  assert.equal(alertaActivaDe({ jornada_activa: true, atributos: {} }), null);
});
