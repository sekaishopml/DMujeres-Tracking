import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { atenderSesionRecuperada } from '../src/movil.js';

function pedido(cuerpo) {
  const req = Readable.from([Buffer.from(JSON.stringify(cuerpo))]);
  req.headers = {};
  req.socket = {};
  return req;
}

function resFalsa() {
  return {
    status: null,
    cuerpo: '',
    writeHead(codigo) { this.status = codigo; },
    setHeader() {},
    end(texto = '') { this.cuerpo = String(texto); },
  };
}

function ctxCon(filaSesion) {
  const consultas = [];
  return {
    consultas,
    configuracion: { canalMovilActivo: true },
    log: { info() {}, warn() {}, error() {} },
    almacen: {
      pool: {
        query: async (sql, valores) => {
          consultas.push({ sql, valores });
          if (sql.includes('FROM iam.dmt_sesion s')) return { rows: filaSesion ? [filaSesion] : [] };
          return { rows: [] };
        },
      },
    },
  };
}

const INSTALACION = 'f9e159c7-a751-46eb-b649-bda2da0f252d';
const NADIA = { id: 5, nombre: 'Nadia Figueroa', nombre_usuario: 'Nadia', atributos: {} };

test('instalación con sesión viva recibe un token nuevo y la anterior se cierra', async () => {
  const ctx = ctxCon(NADIA);
  const res = resFalsa();
  await atenderSesionRecuperada(pedido({ instalacion: INSTALACION }), res, ctx);
  assert.equal(res.status, 200);
  const cuerpo = JSON.parse(res.cuerpo);
  assert.ok(cuerpo.token.length > 20);
  assert.equal(cuerpo.expiraEn, null);
  assert.deepEqual(cuerpo.usuario, { nombre: 'Nadia Figueroa', nombreUsuario: 'Nadia' });
  const cierre = ctx.consultas.find((c) => c.sql.includes('SET revocada_en'));
  assert.deepEqual(cierre.valores, [5, INSTALACION]);
  const nueva = ctx.consultas.find((c) => c.sql.includes('INSERT INTO iam.dmt_sesion'));
  assert.equal(nueva.valores[0], 5);
  assert.equal(nueva.valores.at(-1), INSTALACION);
});

test('sin sesión viva (quitada desde el panel) responde 404 y no crea nada', async () => {
  const ctx = ctxCon(null);
  const res = resFalsa();
  await atenderSesionRecuperada(pedido({ instalacion: INSTALACION }), res, ctx);
  assert.equal(res.status, 404);
  assert.ok(!ctx.consultas.some((c) => c.sql.includes('INSERT')));
});

test('sin instalación válida responde 400', async () => {
  for (const cuerpo of [{}, { instalacion: 'x' }, { instalacion: "a' or 1=1 --" }]) {
    const res = resFalsa();
    await atenderSesionRecuperada(pedido(cuerpo), res, ctxCon(NADIA));
    assert.equal(res.status, 400);
  }
});
