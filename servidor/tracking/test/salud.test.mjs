import test from 'node:test';
import assert from 'node:assert/strict';
import { equipoDeAgente, estadoDeReporte, fabricanteDeModelo, filaSalud } from '../src/salud.js';

const AGENTE_INFINIX = 'Dalvik/2.1.0 (Linux; U; Android 14; Infinix X6531 Build/UP1A.231005.007)';
const AGENTE_SAMSUNG = 'Dalvik/2.1.0 (Linux; U; Android 16; SM-A175F Build/BP4A.251205.006)';

// Diagnóstico real de un Infinix X6531.
const REPORTE_INFINIX = {
  report: {
    app: { versionCode: 301, versionName: '2.4.0' },
    gps: { enabled: true, provider: 'fused', fixAgeSec: 109, mock: false },
    buffer: { pending: 0, depth: 0, overflow: 0, dead: 0 },
    power: { battery: 84, charging: false, exempt: true },
    perms: { fine: true, background: true, notifications: true },
    journey: { active: true },
    bootId: '2a10d7ca-7e48-40f0-a509-608234aeb3ad',
    recoveryCount: 143,
    fgsState: 'running',
    movementState: 'STATIONARY',
  },
};

test('el User-Agent da versión de Android, modelo y fabricante', () => {
  assert.deepEqual(equipoDeAgente(AGENTE_INFINIX), { versionAndroid: '14', modelo: 'Infinix X6531' });
  assert.deepEqual(equipoDeAgente(AGENTE_SAMSUNG), { versionAndroid: '16', modelo: 'SM-A175F' });
  assert.equal(fabricanteDeModelo('Infinix X6531'), 'Infinix');
  assert.equal(fabricanteDeModelo('SM-A175F'), 'Samsung');
  assert.equal(fabricanteDeModelo('LGN-LX3'), 'Honor');
  assert.equal(fabricanteDeModelo('Z2450'), null);
  assert.deepEqual(equipoDeAgente(null), { versionAndroid: null, modelo: null });
});

test('la fila conserva lo reportado sin inventar nada', () => {
  const ahora = Date.parse('2026-10-01T00:43:00Z');
  const fila = filaSalud(REPORTE_INFINIX, AGENTE_INFINIX, ahora);
  assert.equal(fila.versionApp, '2.4.0');
  assert.equal(fila.estadoSalud, 'ok');
  assert.equal(fila.primerPlano, true);
  assert.equal(fila.movimiento, 'STATIONARY');
  assert.equal(fila.colaSalida, 0);
  assert.equal(fila.recuperacion, '143');
  assert.equal(fila.tipoEvento, 'diagnostico');
  assert.equal(fila.ultimoFixEn.getTime(), ahora - 109_000);
  assert.equal(fila.registradoEn.getTime(), ahora);
});

test('estado: el problema más grave manda', () => {
  const base = structuredClone(REPORTE_INFINIX.report);
  assert.equal(estadoDeReporte({ ...base, gps: { ...base.gps, fixAgeSec: 900 } }), 'gps_atrasado');
  assert.equal(estadoDeReporte({ ...base, gps: { ...base.gps, fixAgeSec: 900 }, journey: { active: false } }), 'ok');
  assert.equal(estadoDeReporte({ ...base, buffer: { pending: 40 } }), 'cola_pendiente');
  assert.equal(estadoDeReporte({ ...base, perms: { fine: true, background: false } }), 'sin_permisos');
  assert.equal(estadoDeReporte({ ...base, gps: { enabled: false } }), 'gps_apagado');
  assert.equal(estadoDeReporte({ ...base, crash: 'java.lang.NullPointerException' }), 'cierre_inesperado');
});

test('hora del teléfono corrida más de un día: se usa la del servidor', () => {
  const ahora = Date.parse('2026-10-01T00:00:00Z');
  const fila = filaSalud({ ts: ahora - 3 * 86_400_000, report: {} }, null, ahora);
  assert.equal(fila.registradoEn.getTime(), ahora);
  assert.equal(fila.versionApp, null);
  assert.equal(fila.colaSalida, null);
});
