import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puedeEnviar } from '../src/reporte.js';

test('como mucho 10 envíos por teléfono por hora', () => {
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < 10; i += 1) assert.equal(puedeEnviar('A', t0 + i), true);
  assert.equal(puedeEnviar('A', t0 + 20), false);
  // Otro teléfono no se ve afectado, y pasada la hora vuelve a poder.
  assert.equal(puedeEnviar('B', t0 + 20), true);
  assert.equal(puedeEnviar('A', t0 + 3_600_001), true);
});

test('el correo es una carta corta con el nombre de la empresa y escapa los datos', async () => {
  const { correoHtml, frasesCorreo } = await import('../src/reporte.js');
  const datos = { titulo: 'Reporte semanal', nombre: 'Ana <b>', rango: 'Del 26/10/2026 al 01/11/2026', archivos: ['a.xlsx', 'a.pdf'] };
  const html = correoHtml(datos);
  assert.match(html, />DMujeres</);
  assert.match(html, /Adjunto encontrará el reporte semanal de Ana &lt;b&gt;, del 26\/10\/2026 al 01\/11\/2026, en Excel y PDF\./);
  assert.doesNotMatch(html, /<b>|Tracking|·/);
  const { asunto } = frasesCorreo({ ...datos, nombre: 'Ana', rango: 'Martes 28/10/2026', archivos: ['a.pdf'] });
  assert.equal(asunto, 'Reporte semanal de Ana, martes 28/10/2026');
  assert.match(frasesCorreo({ titulo: 'Reporte', nombre: '', rango: '', archivos: [] }).cuerpo, /^Adjunto encontrará el reporte\.$/);
});
