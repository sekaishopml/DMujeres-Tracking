import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirBitacora } from '../src/dominio/bitacora.ts';

const actividad = (id, cargadaEn) => ({
  id, dispositivoId: 'x', nombre: 'Ana', fecha: '2026-10-13', hora: '09:00:00', horaFin: '10:30:00', tipo: 'visita',
  lugar: 'Farmacia Sur', nota: null, registro: { en: cargadaEn, conJornada: true, latitud: -2.2, longitud: -79.9, direccion: null },
});

test('la bitácora incluye avisos del teléfono y lo cargado al cronograma ese día', () => {
  const eventos = construirBitacora({
    desde: '2026-10-13T05:00:00.000Z',
    hasta: '2026-10-14T04:59:59.999Z',
    avisos: [
      { tipo: 'mobileGpsDisabled', texto: 'Apagó el GPS', categoria: 'alerta', en: '2026-10-13T15:00:00.000Z' },
      { tipo: 'mobileGpsReenabled', texto: 'Reactivó el GPS', categoria: 'recuperacion', en: '2026-10-13T15:10:00.000Z' },
      { tipo: 'mobilePermissionLost', texto: 'Quitó el permiso de ubicación', categoria: 'alerta', en: '2026-10-13T16:00:00.000Z' },
    ],
    actividades: [actividad('a1', '2026-10-13T14:00:00.000Z'), actividad('a2', '2026-10-12T14:00:00.000Z')],
  });
  assert.deepEqual(eventos.map((e) => [e.tipo, e.titulo, e.atencion ?? false]), [
    ['cronograma', 'Subió al cronograma: Visita en Farmacia Sur', false],
    ['aviso', 'Apagó el GPS', true],
    ['recuperacion', 'Reactivó el GPS', false],
    ['aviso', 'Quitó el permiso de ubicación', true],
  ]);
  assert.equal(eventos[0].detalle, 'Para el 13/10/2026, 09:00 a 10:30.');
});
