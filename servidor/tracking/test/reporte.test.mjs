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

test('el correo es texto simple como los del equipo y escapa los datos', async () => {
  const { correoHtml, correoTexto, frasesCorreo } = await import('../src/reporte.js');
  const datos = { titulo: 'Reporte semanal', nombre: 'Ana <b>', rango: 'Del 26/10/2026 al 01/11/2026', archivos: ['a.xlsx', 'a.pdf'] };
  // 15:00 en Guayaquil.
  const tarde = Date.parse('2026-10-29T15:00:00-05:00');
  const html = correoHtml(datos, tarde);
  assert.match(html, /Buenas tardes,/);
  assert.match(html, /Por medio del presente, se adjunta el reporte semanal de Ana &lt;b&gt;, del 26\/10\/2026 al 01\/11\/2026, en Excel y PDF\./);
  assert.match(html, /departamento de CCTV/);
  // Sin colores de marca, líneas ni membrete.
  assert.doesNotMatch(html, /<b>|·|#0B2545|border|bgcolor/i);
  // Se dice que es automático, de DMujeres Tracking, y que no se responda.
  assert.match(html, /generado automáticamente por DMujeres Tracking\. Por favor, no responda a este mensaje\./);
  assert.match(html, /Saludos cordiales,<br><br>DMujeres Tracking/);
  assert.match(correoTexto(datos, Date.parse('2026-10-29T08:00:00-05:00')), /^Buenos días,\n\nPor medio del presente/);
  const { asunto } = frasesCorreo({ ...datos, nombre: 'Ana', rango: 'Martes 28/10/2026', archivos: ['a.pdf'] });
  assert.equal(asunto, 'Reporte semanal de Ana, martes 28/10/2026');
  assert.match(frasesCorreo({ titulo: 'Reporte', nombre: '', rango: '', archivos: [] }).cuerpo, /^Por medio del presente, se adjunta el reporte\.$/);
});
