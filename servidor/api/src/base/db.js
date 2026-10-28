// Conexión a PostgreSQL (un solo pool por proceso). Las consultas tienen
// tiempo máximo y se cortan si el navegador se desconecta.

import pg from 'pg';

const { Pool } = pg;

export class ConsultaAbortada extends Error {
  constructor() {
    super('Consulta abortada por desconexión del cliente.');
    this.name = 'ConsultaAbortada';
  }
}

export function crearPool(configuracionDb) {
  return new Pool({
    ...configuracionDb,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    application_name: 'dmj-api',
  });
}

export async function consultar(pool, texto, valores = [], { signal, timeoutMs } = {}) {
  if (signal && signal.aborted) throw new ConsultaAbortada();
  const configuracion = { text: texto, values: valores };
  if (timeoutMs) configuracion.query_timeout = timeoutMs;
  const consulta = pool.query(configuracion);
  if (!signal) return consulta;
  let quitarEscucha = () => {};
  const abortada = new Promise((_, rechazar) => {
    const alAbortar = () => rechazar(new ConsultaAbortada());
    signal.addEventListener('abort', alAbortar, { once: true });
    quitarEscucha = () => signal.removeEventListener('abort', alAbortar);
  });
  try {
    return await Promise.race([consulta, abortada]);
  } finally {
    quitarEscucha();
  }
}

// Ejecuta un bloque atomico (BEGIN/COMMIT) sobre una conexion del pool.
// Si la funcion lanza, deshace todo y propaga el error.
export async function enTransaccion(pool, funcion) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await funcion(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try {
      await cliente.query('ROLLBACK');
    } catch {
      // Si la conexion ya no responde, el error original es el relevante.
    }
    throw error;
  } finally {
    cliente.release();
  }
}

