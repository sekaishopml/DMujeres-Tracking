import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buscarPersona,
  fechaTitulo,
  filasDePersonas,
  horaCorta,
  horasDelDia,
  normalizar,
  ponerTexto,
} from '../src/reportes/reporteMarketing.js';

const ZONA = 'America/Guayaquil';
// 14/10/2026 en Guayaquil (UTC-5).
const desde = new Date('2026-10-14T05:00:00Z');
const hasta = new Date('2026-10-15T05:00:00Z');
const h = (hhmm, dia = 14) => {
  const [hora, min] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, dia, hora + 5, min));
};

test('título y hora como en la plantilla', () => {
  assert.equal(fechaTitulo('2026-10-07'), 'MIERCOLES 07 DE OCTUBRE 2026');
  assert.equal(fechaTitulo('2026-10-17'), 'SABADO 17 DE OCTUBRE 2026');
  assert.equal(horaCorta(h('0:02'), ZONA), '0:02');
  assert.equal(horaCorta(h('7:52'), ZONA), '7:52');
  assert.equal(horaCorta(h('19:05'), ZONA), '19:05');
});

test('la persona de la plantilla se encuentra aunque cambie la escritura', () => {
  const personas = [{ nombre: 'Joyce Obando' }, { nombre: 'JIMMY LLANLLAN' }, { nombre: 'Martha Macias' }, { nombre: 'ANA TROYA' }];
  assert.equal(normalizar(' JIMMY  LLANLLAN '), 'JIMMY LLANLLAN');
  assert.equal(buscarPersona('JIMMY  LLANLLAN', personas).nombre, 'JIMMY LLANLLAN');
  assert.equal(buscarPersona('MARTHA MACÍAS', personas).nombre, 'Martha Macias');
  assert.equal(buscarPersona('JOICE OBANDO ', personas).nombre, 'Joyce Obando');
  assert.equal(buscarPersona('ANA CORREA', personas), null);
});

test('encendido y apagado: primer y último punto del día, dentro o fuera de jornada', () => {
  const base = { ios: false, primerPunto: null, ultimoPunto: null };
  const dia = (datos) => horasDelDia({ ...base, ...datos }, desde, hasta, ZONA, h('23:00'));
  const c = (r) => [r.encendido, r.apagado, r.inicioJornada, r.finJornada];
  // Sin jornada ni puntos: guion en todo.
  assert.deepEqual(c(dia({ jornadas: [] })), ['—', '—', '—', '—']);
  // Encendió el teléfono a las 6:40 (punto sin jornada) y empezó a las 7:52.
  assert.deepEqual(
    c(dia({ jornadas: [{ inicio: h('7:52'), fin: h('12:00') }, { inicio: h('13:00'), fin: h('18:30') }], primerPunto: h('6:40'), ultimoPunto: h('18:29') })),
    ['6:40', '18:30', '7:52', '18:30'],
  );
  // Cerró a las 18:00 y el teléfono siguió mandando hasta las 23:58.
  assert.deepEqual(c(dia({ jornadas: [{ inicio: h('8:00'), fin: h('18:00') }], primerPunto: h('8:01'), ultimoPunto: h('23:58') })), [
    '8:00', '23:58', '8:00', '18:00',
  ]);
  // Seguía abierta de la noche: el primer punto desde las 0:00 es el encendido
  // y la jornada de la persona va aparte (Josselyn 30/10).
  assert.deepEqual(
    c(dia({
      jornadas: [
        { inicio: h('0:00'), fin: h('0:24'), continua: true },
        { inicio: h('7:21'), fin: h('22:31') },
      ],
      primerPunto: h('0:02'),
      ultimoPunto: h('22:30'),
    })),
    ['0:00', '22:31', '7:21', '22:31'],
  );
  // Solo el corte de medianoche y el servidor lo cerró en su último punto.
  assert.deepEqual(c(dia({ jornadas: [{ inicio: h('0:00'), fin: h('5:36'), continua: true, cierreAutomatico: true }], primerPunto: h('0:01'), ultimoPunto: h('5:30') })), [
    '0:00', '5:30', 'Seguía abierta del día anterior', 'No la cerró',
  ]);
  // Puntos pero ninguna jornada.
  const sinJornada = dia({ jornadas: [], primerPunto: h('7:00'), ultimoPunto: h('9:00') });
  assert.deepEqual([...c(sinJornada), sinJornada.observacion], ['7:00', '9:00', 'Sin jornada', '—', 'No inició jornada']);
});

test('observación: motivo o causa cuando terminó antes de las 17:00', () => {
  const base = { ios: false, primerPunto: h('7:30') };
  const dia = (datos, ahora = h('23:00')) => horasDelDia({ ...base, ...datos }, desde, hasta, ZONA, ahora).observacion;
  const abierta = [{ inicio: h('7:30'), fin: h('16:28'), cierreAutomatico: true }];
  // Cerró antes de las 17:00 con motivo: el motivo.
  assert.equal(dia({ jornadas: [{ inicio: h('7:30'), fin: h('15:10'), notaFin: 'Cita médica' }], ultimoPunto: h('15:09') }), 'Motivo de cierre (15:10): Cita médica');
  // Cerró antes de las 17:00 sin motivo.
  assert.equal(dia({ jornadas: [{ inicio: h('7:30'), fin: h('15:10') }], ultimoPunto: h('15:09') }), 'Finalizó la jornada a las 15:10 sin motivo');
  // Cerró a las 17:00 o después: nada que observar.
  assert.equal(dia({ jornadas: [{ inicio: h('7:30'), fin: h('17:00') }], ultimoPunto: h('16:59') }), '');
  // No cerró y el teléfono dejó de mandar a las 16:28 (Jefferson 10/11): la causa.
  // El servidor notó el silencio 4 s antes del aviso del GPS: manda el aviso.
  const gps = [{ tipo: 'mobileSilent', en: h('16:28') }, { tipo: 'mobileGpsDisabled', en: h('16:28'), quien: 'persona' }];
  assert.equal(dia({ jornadas: abierta, ultimoPunto: h('16:28'), eventos: gps }), 'Apagó el GPS a mano a las 16:28. No finalizó la jornada');
  // Solo el silencio (Joselyn 10/11).
  assert.equal(
    dia({ jornadas: abierta, ultimoPunto: h('15:28'), eventos: [{ tipo: 'mobileSilent', en: h('15:26') }, { tipo: 'mobilePowerOff', en: h('22:00') }] }),
    'Dejó de reportar con la jornada abierta desde las 15:28. No finalizó la jornada',
  );
  const pedidos = [{ tipo: 'mobileSilent', en: h('15:45') }, { tipo: 'mobileAvisoRescate', en: h('16:05') }, { tipo: 'mobileAvisoRescate', en: h('16:40') }];
  assert.equal(
    dia({ jornadas: abierta, ultimoPunto: h('15:28'), eventos: pedidos }),
    'Dejó de reportar con la jornada abierta desde las 15:28 (se le pidió abrir la app 2 veces). No finalizó la jornada',
  );
  const apagado = [{ tipo: 'mobileBatteryCritical', en: h('16:10') }, { tipo: 'mobilePowerOff', en: h('16:30') }];
  assert.equal(dia({ jornadas: abierta, ultimoPunto: h('16:28'), eventos: apagado }), 'Apagó el teléfono a las 16:30. No finalizó la jornada');
  assert.equal(dia({ jornadas: abierta, ultimoPunto: h('16:28'), eventos: [{ tipo: 'mobileBatteryCritical', en: h('16:10') }] }), 'Batería crítica a las 16:10. No finalizó la jornada');
  // Un apagado de antes del último punto ya pasó: no es la causa.
  assert.equal(
    dia({ jornadas: abierta, ultimoPunto: h('16:28'), eventos: [{ tipo: 'mobileGpsDisabled', en: h('10:00') }] }),
    'Sin ubicación desde las 16:28, sin causa registrada en el teléfono. No finalizó la jornada',
  );
  // Quedó abierta en un día pasado: no la cerró.
  const pasada = horasDelDia({ ...base, jornadas: [{ inicio: h('8:00'), fin: null }], ultimoPunto: h('8:39'), eventos: [{ tipo: 'mobileSilent', en: h('8:40') }] }, desde, hasta, ZONA, h('9:00', 16));
  assert.deepEqual([pasada.finJornada, pasada.observacion], ['No la cerró', 'Dejó de reportar con la jornada abierta desde las 8:39. No finalizó la jornada']);
  // Hoy antes de las 17:00 todavía no se juzga.
  assert.equal(dia({ jornadas: [{ inicio: h('7:30'), fin: null }], ultimoPunto: h('15:00') }, h('15:05')), '');
  // Sábado 17/10 también se trabaja hasta las 17:00; el domingo 18 no.
  const dia17 = (n) => horasDelDia(
    { ios: false, primerPunto: h('7:30', n), jornadas: [{ inicio: h('7:30', n), fin: h('12:00', n) }], ultimoPunto: h('12:00', n) },
    h('0:00', n), h('0:00', n + 1), ZONA, h('23:00', n),
  ).observacion;
  assert.equal(dia17(17), 'Finalizó la jornada a las 12:00 sin motivo');
  assert.equal(dia17(18), '');
});

test('iPhone: primer y último punto del día', () => {
  const ios = { ios: true, jornadas: [] };
  const r = horasDelDia({ ...ios, primerPunto: h('6:30'), ultimoPunto: h('16:10') }, desde, hasta, ZONA);
  assert.deepEqual([r.encendido, r.apagado], ['6:30', '16:10']);
  const vacio = horasDelDia({ ...ios, primerPunto: null, ultimoPunto: null }, desde, hasta, ZONA);
  assert.deepEqual([vacio.encendido, vacio.apagado], ['—', '—']);
});

test('la plantilla real: filas de personas y celdas con su estilo', () => {
  const plantilla = fileURLToPath(new URL('../plantillas/Reporte_Marketing.xlsm', import.meta.url));
  const leer = (archivo) => execFileSync('unzip', ['-p', plantilla, archivo], { encoding: 'utf8' });
  const hoja = leer('xl/worksheets/sheet4.xml');
  const compartidos = [...leer('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''),
  );
  const filas = filasDePersonas(hoja, compartidos);
  // Lizbeth Rivera salió de la plantilla el 06/11.
  assert.equal(filas.length, 20);
  assert.ok(!filas.some((f) => f.nombre === 'LIZBETH RIVERA'));
  assert.deepEqual(filas[0], { fila: '12', nombre: 'DIEGO DUARTE' });
  assert.deepEqual(filas.at(-1), { fila: '35', nombre: 'ISRAEL LOPEZ' });
  assert.ok(!filas.some((f) => ['MARKETING', 'TECNICOS', 'MERCADERISTAS', 'RETAIL', 'MENSAJERO'].includes(f.nombre)));
  const llena = ponerTexto(hoja, 'C12', '7:52');
  assert.match(llena, /<c r="C12" s="8" t="inlineStr"><is><t>7:52<\/t><\/is><\/c>/);
  assert.match(ponerTexto(hoja, 'B2', 'MIERCOLES 14 DE OCTUBRE 2026'), /<c r="B2" s="46" t="inlineStr"><is><t>MIERCOLES 14 DE OCTUBRE 2026<\/t>/);
});
