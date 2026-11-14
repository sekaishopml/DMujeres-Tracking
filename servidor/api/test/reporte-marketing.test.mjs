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
  unirTurnos,
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

test('encendido: inicio manual de la jornada; si seguía de antes, primer contacto desde las 0:00', () => {
  const base = { ios: false, primerPunto: null, ultimoPunto: null };
  const dia = (datos) => horasDelDia({ ...base, ...datos }, desde, hasta, ZONA);
  // Sin jornada: guion, aunque haya puntos.
  assert.deepEqual(dia({ jornadas: [], primerPunto: h('7:00'), ultimoPunto: h('9:00') }), { encendido: '—', apagado: '—' });
  // Inició a las 7:00 a mano: 7:00 aunque el teléfono mandara antes.
  assert.deepEqual(dia({ jornadas: [{ inicio: h('7:00'), fin: h('17:40') }], primerPunto: h('6:10'), ultimoPunto: h('17:39') }), {
    encendido: '7:00',
    apagado: '17:40',
  });
  // Dos jornadas: el primer inicio y el último fin.
  assert.deepEqual(
    dia({ jornadas: [{ inicio: h('7:52'), fin: h('12:00') }, { inicio: h('13:00'), fin: h('18:30') }], ultimoPunto: h('18:29') }),
    { encendido: '7:52', apagado: '18:30' },
  );
  // No la finalizó ayer: sigue abierta, primer contacto del día.
  assert.deepEqual(dia({ jornadas: [{ inicio: h('0:00'), fin: h('23:59'), continua: true, cierreAutomatico: true }], primerPunto: h('0:02'), ultimoPunto: h('23:54') }), {
    encendido: '0:02',
    apagado: '23:54',
  });
  // Seguía abierta, la cerró a las 0:24 y después inició a las 7:21: manda su inicio (Josselyn 30/10).
  assert.deepEqual(
    dia({
      jornadas: [{ inicio: h('0:00'), fin: h('0:24'), continua: true }, { inicio: h('7:21'), fin: h('22:31') }],
      primerPunto: h('0:02'),
      ultimoPunto: h('22:30'),
    }),
    { encendido: '7:21', apagado: '22:31' },
  );
  // Seguía abierta y sin puntos: 0:00.
  assert.deepEqual(dia({ jornadas: [{ inicio: h('0:00'), fin: null, continua: true }] }), { encendido: '0:00', apagado: '—' });
});

test('turno: cerrar a mano y reiniciar en menos de 30 min es la misma jornada', () => {
  const base = { ios: false };
  const dia = (datos) => horasDelDia({ ...base, ...datos }, desde, hasta, ZONA);
  // Jefferson 13/11: venía de ayer, cerró 15:41:15 y reinició 15:41:50. El teléfono reportaba desde las 8:04.
  assert.deepEqual(
    dia({
      jornadas: [
        { inicio: h('0:00'), fin: h('15:41'), continua: true },
        { inicio: new Date(h('15:41').getTime() + 35_000), fin: h('18:33') },
      ],
      primerPunto: h('8:04'),
      ultimoPunto: h('18:33'),
    }),
    { encendido: '8:04', apagado: '18:33' },
  );
  // Silvia 11/11: la jornada de ayer cerrada y reiniciada a las 6:54 en el mismo instante.
  assert.deepEqual(
    dia({
      jornadas: [{ inicio: h('0:00'), fin: h('6:54'), continua: true }, { inicio: h('6:54'), fin: h('19:42') }],
      primerPunto: h('0:03'),
      ultimoPunto: h('19:42'),
    }),
    { encendido: '0:03', apagado: '19:42' },
  );
  // Si pasó más de 30 min (Josselyn 30/10: 7 h) manda el inicio nuevo de la persona.
  assert.deepEqual(
    dia({
      jornadas: [{ inicio: h('0:00'), fin: h('0:24'), continua: true }, { inicio: h('7:21'), fin: h('22:31') }],
      primerPunto: h('0:02'),
      ultimoPunto: h('22:30'),
    }),
    { encendido: '7:21', apagado: '22:31' },
  );
  // Dos jornadas propias con una pausa corta: encendido de la primera, apagado de la última.
  assert.deepEqual(
    dia({ jornadas: [{ inicio: h('7:30'), fin: h('12:00') }, { inicio: h('12:20'), fin: h('18:00') }], ultimoPunto: h('17:59') }),
    { encendido: '7:30', apagado: '18:00' },
  );
  // Paola 11/11: la app cerró la jornada de ayer por sesión perdida (9:19) y ella inició a las 16:01. No finalizó: encendido = primer contacto.
  assert.deepEqual(
    dia({
      jornadas: [
        { inicio: h('0:00'), fin: h('9:19'), continua: true, cierreForzado: true },
        { inicio: h('16:01'), fin: h('23:59'), cierreAutomatico: true },
      ],
      primerPunto: h('0:04'),
      ultimoPunto: h('23:56'),
    }),
    { encendido: '0:04', apagado: '23:56' },
  );
  // Sesión perdida a las 10:00 de una jornada que ella inició a las 8:00 y reinicio a las 10:30: encendido 8:00.
  assert.deepEqual(
    dia({ jornadas: [{ inicio: h('8:00'), fin: h('10:00'), cierreForzado: true }, { inicio: h('10:30'), fin: h('17:30') }], ultimoPunto: h('17:29') }),
    { encendido: '8:00', apagado: '17:30' },
  );
  // Un cierre automático (el servidor lo llevó al último punto) no se une.
  assert.equal(unirTurnos([{ inicio: h('8:00'), fin: h('12:00'), cierreAutomatico: true }, { inicio: h('12:05'), fin: null }]).length, 2);
});

test('apagado: fin manual de la jornada; si no la finalizó, el último punto del día', () => {
  const base = { ios: false, primerPunto: h('7:00') };
  const dia = (datos) => horasDelDia({ ...base, ...datos }, desde, hasta, ZONA).apagado;
  // Finalizó a las 17:05 y el teléfono siguió mandando: 17:05.
  assert.equal(dia({ jornadas: [{ inicio: h('7:00'), fin: h('17:05') }], ultimoPunto: h('23:58') }), '17:05');
  // No la finalizó y dejó de mandar a las 16:28 (el servidor llevó el corte de medianoche al último punto).
  assert.equal(dia({ jornadas: [{ inicio: h('10:09'), fin: h('16:28'), cierreAutomatico: true }], ultimoPunto: h('16:28') }), '16:28');
  // Sigue abierta: el último punto.
  assert.equal(dia({ jornadas: [{ inicio: h('8:07'), fin: null }], ultimoPunto: h('17:40') }), '17:40');
});

test('iPhone: primer y último punto del día', () => {
  const ios = { ios: true, jornadas: [] };
  assert.deepEqual(horasDelDia({ ...ios, primerPunto: h('6:30'), ultimoPunto: h('16:10') }, desde, hasta, ZONA), { encendido: '6:30', apagado: '16:10' });
  assert.deepEqual(horasDelDia({ ...ios, primerPunto: null, ultimoPunto: null }, desde, hasta, ZONA), { encendido: '—', apagado: '—' });
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
