// GET /api/v1/vivo: avisos en vivo al panel (Server-Sent Events).
// El receptor avisa con NOTIFY dmt_vivo ('p:<id>' punto, 'e:<id>' evento,
// 'a:<id>' actividad). Aquí hay una sola conexión LISTEN para todos y los
// avisos se juntan: como mucho un envío por segundo y una sola consulta de
// posiciones por envío, sin importar cuántos paneles estén abiertos.

import { PREDICADO_PERMISO, permisoDe } from './flota.js';
import { SELECT_POSICION_ACTUAL } from './posiciones.js';
import { aPosicion } from './dto.js';
import { validarSesion, tokenDeSesion } from './sesiones.js';

const CANAL = 'dmt_vivo';
const ENVIO_MS = 1000;
const LATIDO_MS = 25_000;
const REVISION_MS = 5 * 60_000;
const MAX_CLIENTES = 200;

const clientes = new Set();
let pendientes = { p: new Set(), e: new Set(), a: new Set() };
let escucha = null;
let temporizador = null;

async function equiposPermitidos(pool, usuario) {
  const { rows } = await pool.query(
    `SELECT d.id FROM tracking.dmt_dispositivo d WHERE d.habilitado AND ${PREDICADO_PERMISO}`,
    [permisoDe(usuario)],
  );
  return new Set(rows.map((fila) => Number(fila.id)));
}

// Conexión LISTEN propia (fuera del pool de consultas). Si se cae, se vuelve a
// abrir al rato; los paneles mientras tanto siguen con su consulta periódica.
async function asegurarEscucha(pool, log) {
  if (escucha) return;
  escucha = 'conectando';
  try {
    const conexion = await pool.connect();
    conexion.on('notification', ({ payload }) => {
      const [tipo, id] = String(payload ?? '').split(':');
      const numero = Number(id);
      if (pendientes[tipo] && Number.isInteger(numero)) pendientes[tipo].add(numero);
    });
    conexion.on('error', (error) => {
      log.error('vivo_escucha_error', { detalle: error.message });
      conexion.release(true);
      escucha = null;
      setTimeout(() => clientes.size > 0 && asegurarEscucha(pool, log), 5000).unref();
    });
    await conexion.query(`LISTEN ${CANAL}`);
    escucha = conexion;
    temporizador ??= setInterval(() => enviar(pool, log), ENVIO_MS);
  } catch (error) {
    escucha = null;
    log.error('vivo_escucha_error', { detalle: error.message });
    setTimeout(() => clientes.size > 0 && asegurarEscucha(pool, log), 5000).unref();
  }
}

async function enviar(pool, log) {
  const lote = pendientes;
  pendientes = { p: new Set(), e: new Set(), a: new Set() };
  if (clientes.size === 0 || (lote.p.size + lote.e.size + lote.a.size) === 0) return;
  let posiciones = [];
  if (lote.p.size > 0) {
    try {
      const { rows } = await pool.query(
        `${SELECT_POSICION_ACTUAL} WHERE pa.dispositivo_id = ANY($1::bigint[])`,
        [[...lote.p]],
      );
      posiciones = rows.map(aPosicion);
    } catch (error) {
      log.error('vivo_posiciones_error', { detalle: error.message });
    }
  }
  for (const cliente of clientes) {
    const mensaje = {
      posiciones: posiciones.filter((p) => cliente.permitidos.has(p.dispositivoId)),
      eventos: [...lote.e].filter((id) => cliente.permitidos.has(id)),
      actividades: [...lote.a].filter((id) => cliente.permitidos.has(id)),
    };
    if (mensaje.posiciones.length + mensaje.eventos.length + mensaje.actividades.length === 0) continue;
    cliente.res.write(`data: ${JSON.stringify(mensaje)}\n\n`);
  }
}

export async function abrirVivo(ctx) {
  if (clientes.size >= MAX_CLIENTES) {
    ctx.res.writeHead(503, { 'Retry-After': '30' }).end();
    return;
  }
  const cliente = { res: ctx.res, permitidos: await equiposPermitidos(ctx.pool, ctx.usuario) };
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx no debe juntar la respuesta: cada aviso sale apenas se escribe.
    'X-Accel-Buffering': 'no',
  });
  ctx.res.write('retry: 5000\n\n');
  clientes.add(cliente);
  await asegurarEscucha(ctx.pool, ctx.log);

  // Latido para que nginx y el navegador no corten por inactividad, y cada
  // tanto se revisa que la sesión siga vigente y qué equipos puede ver.
  const latido = setInterval(() => ctx.res.write(': latido\n\n'), LATIDO_MS);
  const revision = setInterval(async () => {
    try {
      const sesion = await validarSesion(ctx.pool, tokenDeSesion(ctx.req));
      if (!sesion) return ctx.res.end();
      cliente.permitidos = await equiposPermitidos(ctx.pool, sesion.usuario);
    } catch (error) {
      ctx.log.error('vivo_revision_error', { detalle: error.message });
    }
  }, REVISION_MS);

  await new Promise((resolver) => ctx.res.on('close', resolver));
  clearInterval(latido);
  clearInterval(revision);
  clientes.delete(cliente);
}
