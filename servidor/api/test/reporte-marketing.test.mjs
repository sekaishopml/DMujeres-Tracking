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

test('encendido y apagado: primer y último punto del trazo del replay', () => {
  const dia = (primero, ultimo) => horasDelDia({ primerPunto: primero && h(primero), ultimoPunto: ultimo && h(ultimo) }, ZONA);
  assert.deepEqual(dia('7:02', '17:40'), { encendido: '7:02', apagado: '17:40' });
  // Seguía abierta de ayer: el trazo empieza a las 0:04.
  assert.deepEqual(dia('0:04', '23:56'), { encendido: '0:04', apagado: '23:56' });
  // Sin trazo ese día: guion en los dos.
  assert.deepEqual(dia(null, null), { encendido: '—', apagado: '—' });
  // Solo un punto: es el primero y el último.
  assert.deepEqual(dia('18:01', '18:01'), { encendido: '18:01', apagado: '18:01' });
  // Instantes de la base (Date o texto ISO) dan la misma hora local de Guayaquil.
  assert.deepEqual(horasDelDia({ primerPunto: '2026-10-14T12:30:00Z', ultimoPunto: new Date('2026-10-14T23:05:00Z') }, ZONA), { encendido: '7:30', apagado: '18:05' });
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
