import test from 'node:test';
import assert from 'node:assert/strict';
import { responderNoAutorizado } from '../src/movil.js';

function resFalsa() {
  return {
    status: null,
    cuerpo: '',
    writeHead(codigo) { this.status = codigo; },
    end(texto = '') { this.cuerpo = texto; },
  };
}

function ctxConMotivo(motivo) {
  return {
    almacen: {
      pool: { query: async () => ({ rows: motivo ? [{ motivo }] : [] }) },
    },
  };
}

const CON_TOKEN = { headers: { authorization: 'Bearer abc123' } };

test('token de cuenta dada de baja responde 401 con motivo', async () => {
  const res = resFalsa();
  await responderNoAutorizado(CON_TOKEN, res, ctxConMotivo('cuenta_dada_de_baja'));
  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.cuerpo), { error: 'cuenta_dada_de_baja' });
});

test('sesión revocada responde 401 con su motivo', async () => {
  const res = resFalsa();
  await responderNoAutorizado(CON_TOKEN, res, ctxConMotivo('sesion_revocada'));
  assert.deepEqual(JSON.parse(res.cuerpo), { error: 'sesion_revocada' });
});

test('otro 401 (sin token o token desconocido) no cambia: sin cuerpo', async () => {
  const sinToken = resFalsa();
  await responderNoAutorizado({ headers: {} }, sinToken, ctxConMotivo('cuenta_dada_de_baja'));
  assert.equal(sinToken.status, 401);
  assert.equal(sinToken.cuerpo, '');

  const desconocido = resFalsa();
  await responderNoAutorizado(CON_TOKEN, desconocido, ctxConMotivo(null));
  assert.equal(desconocido.status, 401);
  assert.equal(desconocido.cuerpo, '');
});
