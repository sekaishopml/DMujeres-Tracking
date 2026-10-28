import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerDescarga, respuestaDescarga } from '../src/descarga.js';

const carpeta = await mkdtemp(join(tmpdir(), 'dmj-ota-'));
after(() => rm(carpeta, { recursive: true, force: true }));

const manifiesto = (datos) => JSON.stringify({ version: '2.7.6', versionCode: 322, sha256: 'abc', ...datos });
const URL_OK = 'https://tracking.sekaidevec.com/DMujeres-Tracking-2.7.6.apk';

test('manifiesto válido redirige al apk', async () => {
  await writeFile(join(carpeta, 'latest.json'), manifiesto({ url: URL_OK }));
  const r = await leerDescarga(carpeta);
  assert.equal(r.estado, 302);
  assert.equal(r.cabeceras.Location, URL_OK);
  assert.equal(r.cabeceras['Cache-Control'], 'no-store');
});

test('archivo ausente responde 503', async () => {
  const r = await leerDescarga(join(carpeta, 'no-existe'));
  assert.equal(r.estado, 503);
  assert.equal(r.cuerpo, 'La app no está disponible por ahora.');
});

test('JSON roto responde 503', async () => {
  await writeFile(join(carpeta, 'latest.json'), '{ roto');
  assert.equal((await leerDescarga(carpeta)).estado, 503);
});

test('url que no es https o no termina en .apk responde 503', () => {
  assert.equal(respuestaDescarga(manifiesto({ url: 'http://tracking.sekaidevec.com/app.apk' })).estado, 503);
  assert.equal(respuestaDescarga(manifiesto({ url: 'https://tracking.sekaidevec.com/app.zip' })).estado, 503);
  assert.equal(respuestaDescarga(manifiesto({ url: 'no es una url' })).estado, 503);
  assert.equal(respuestaDescarga(manifiesto({})).estado, 503);
  assert.equal(respuestaDescarga(null).estado, 503);
});
