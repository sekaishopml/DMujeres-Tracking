import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirBitacora, resumenBitacora } from '../src/dominio/bitacora.ts';

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

// Día 22/10/2026; las horas son de Guayaquil (UTC-5).
const t = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 22, h + 5, m)).toISOString();
};
const LUGAR = { latitud: -0.1841, longitud: -78.4921 };
const OTRO = { latitud: -0.2021, longitud: -78.4921 }; // ~2 km
const puntosCada = (desde, hasta, lugar) => {
  const salida = [];
  for (let m = Date.parse(t(desde)); m <= Date.parse(t(hasta)); m += 60_000) {
    salida.push({ registradoEn: new Date(m).toISOString(), ...lugar, precisionM: 10 });
  }
  return salida;
};
const parada = (id, desde, hasta, lugar) => ({
  id, inicio: t(desde), fin: t(hasta), duracionMin: (Date.parse(t(hasta)) - Date.parse(t(desde))) / 60_000, ...lugar, direccion: null,
});

test('apagarse y volver a aparecer en el mismo lugar no es una salida', () => {
  // Ana Troya 22/10: batería en 1 % a las 10:39, vuelve a las 11:35 en el mismo punto.
  const eventos = construirBitacora({
    posiciones: [...puntosCada('08:00', '09:00', LUGAR), ...puntosCada('10:00', '11:00', LUGAR), ...puntosCada('11:05', '11:10', OTRO)],
    paradas: [parada(1, '08:00', '09:00', LUGAR), parada(2, '10:00', '11:00', LUGAR), parada(3, '11:05', '11:10', OTRO)],
    huecos: [{ desde: t('09:00'), hasta: t('10:00'), duracionSegundos: 3600, motivo: 'APAGADO' }],
  });
  const salidas = eventos.filter((e) => e.tipo === 'salida' || e.tipo === 'salidaSinHora');
  assert.deepEqual(salidas.map((e) => [e.tipo, e.instante]), [['salida', t('11:00')]]);
  assert.equal(eventos.filter((e) => e.tipo === 'llegada' && e.instante === t('10:00')).length, 0);
});

test('sin registro de cuándo se fue no se da una hora de salida', () => {
  const eventos = construirBitacora({
    posiciones: [...puntosCada('08:00', '09:00', LUGAR), ...puntosCada('10:00', '11:00', OTRO)],
    paradas: [parada(1, '08:00', '09:00', LUGAR), parada(2, '10:00', '11:00', OTRO)],
    huecos: [{ desde: t('09:00'), hasta: t('10:00'), duracionSegundos: 3600, motivo: 'SIN_SENAL' }],
  });
  const salida = eventos.find((e) => e.instante === t('09:00') && e.tipo.startsWith('salida'));
  assert.equal(salida.tipo, 'salidaSinHora');
  assert.equal(eventos.find((e) => e.instante === t('10:00') && e.tipo.startsWith('llegada')).tipo, 'llegadaSinHora');
  assert.equal(resumenBitacora(eventos).primeraSalida.tipo, 'salidaSinHora');
});

test('el corte de medianoche no es la hora de entrada', () => {
  // Josselyn 30/10: la jornada de ayer siguió hasta las 00:24 y empezó a las 07:21.
  const eventos = construirBitacora({
    jornadas: [
      { inicioEn: t('00:00'), finEn: t('00:24'), duracionMin: 24, abierta: false, continua: true },
      { inicioEn: t('07:21'), finEn: t('22:31'), duracionMin: 910, abierta: false, cierreAutomatico: true },
    ],
  });
  const resumen = resumenBitacora(eventos);
  assert.equal(resumen.inicioJornada.instante, t('07:21'));
  assert.equal(resumen.continuaJornada, true);
  assert.equal(resumen.finJornada.titulo, 'No cerró la jornada');
  assert.equal(resumen.finJornada.automatico, true);
});
