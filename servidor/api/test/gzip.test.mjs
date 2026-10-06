import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { respuestaJson } from '../src/http.js';

function simular(cuerpo, aceptar) {
  const res = { req: { headers: aceptar ? { 'accept-encoding': aceptar } : {} }, cabeceras: null, datos: null };
  res.writeHead = (_, c) => { res.cabeceras = c; };
  res.end = (d) => { res.datos = d; };
  respuestaJson(res, 200, cuerpo);
  return res;
}

test('una respuesta grande se comprime si el navegador acepta gzip', () => {
  const cuerpo = { lista: Array.from({ length: 2000 }, (_, i) => ({ i, lat: -2.2 })) };
  const r = simular(cuerpo, 'gzip, deflate, br');
  assert.equal(r.cabeceras['Content-Encoding'], 'gzip');
  assert.equal(r.cabeceras['Content-Length'], r.datos.length);
  assert.deepEqual(JSON.parse(gunzipSync(r.datos)), cuerpo);
});

test('sin gzip, o pequeña, va tal cual', () => {
  const grande = { lista: Array.from({ length: 2000 }, (_, i) => ({ i })) };
  assert.equal(simular(grande, null).cabeceras['Content-Encoding'], undefined);
  const r = simular({ ok: true }, 'gzip');
  assert.equal(r.cabeceras['Content-Encoding'], undefined);
  assert.deepEqual(JSON.parse(r.datos), { ok: true });
});
