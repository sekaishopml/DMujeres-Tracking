// Oficina: el lugar de trabajo común del equipo, para decir a qué hora llegó
// cada persona. La fija un administrador (system.dmt_configuracion,
// operacion.oficina). Si nadie la fijó se sugiere el lugar donde más personas
// distintas se detuvieron en los últimos 30 días; la sugerencia nunca se
// guarda sola.

import { consultar } from './db.js';
import { datosInvalidos } from './errores.js';
import { leerCuerpoJson, respuestaJson, respuestaSinContenido } from './http.js';
import { exigirAdministracion } from './permisos.js';
import { auditar } from './sesiones.js';

const CLAVE = 'operacion.oficina';
export const RADIO_POR_DEFECTO_M = 120;
const RADIO_MIN_M = 30;
const RADIO_MAX_M = 1000;
// Con menos personas distintas no hay un "lugar del equipo".
const MIN_PERSONAS = 3;
// La sugerencia cuesta una pasada por 30 días de puntos: se guarda una hora.
const VIGENCIA_SUGERENCIA_MS = 60 * 60_000;

let sugerencia = { calculadaEn: 0, datos: null };

function numero(valor, campo, minimo, maximo) {
  const n = typeof valor === 'string' ? Number(valor.trim()) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < minimo || n > maximo) {
    throw datosInvalidos(`El campo ${campo} debe ser un número entre ${minimo} y ${maximo}.`);
  }
  return n;
}

// Valida el cuerpo de PUT /oficina y lo deja como se guarda.
export function validarOficina(cuerpo) {
  const nombre = typeof cuerpo?.nombre === 'string' ? cuerpo.nombre.trim().slice(0, 80) : '';
  return {
    nombre: nombre || 'Oficina',
    latitud: numero(cuerpo?.latitud, 'latitud', -90, 90),
    longitud: numero(cuerpo?.longitud, 'longitud', -180, 180),
    radioM: Math.round(numero(cuerpo?.radioM ?? RADIO_POR_DEFECTO_M, 'radioM', RADIO_MIN_M, RADIO_MAX_M)),
  };
}

async function oficinaConfigurada(ctx) {
  const { rows } = await consultar(
    ctx.pool,
    'SELECT valor FROM system.dmt_configuracion WHERE clave = $1 AND NOT es_secreto',
    [CLAVE],
    { signal: ctx.signal },
  );
  if (!rows[0]) return null;
  try {
    return validarOficina(rows[0].valor);
  } catch {
    // Un valor dañado se ignora: es mejor la sugerencia que un error.
    return null;
  }
}

// Celda de unos 110 m con más personas distintas (y luego más días-persona)
// de puntos casi quietos; el centro es el promedio de lo que cae alrededor.
const SQL_SUGERIDA = `
  WITH quietos AS (
    SELECT p.dispositivo_id, p.latitud, p.longitud,
           (p.registrado_en AT TIME ZONE $1)::date AS dia
      FROM tracking.dmt_posicion p
      JOIN tracking.dmt_dispositivo d ON d.id = p.dispositivo_id AND d.habilitado
     WHERE p.registrado_en > now() - interval '30 days'
       AND p.valida
       AND (p.precision_m IS NULL OR p.precision_m <= 50)
       AND coalesce(p.velocidad_kmh, 0) < 3
  ), celda AS (
    SELECT round(latitud::numeric, 3) AS la, round(longitud::numeric, 3) AS lo,
           count(DISTINCT dispositivo_id) AS personas,
           count(DISTINCT (dispositivo_id, dia)) AS dias
      FROM quietos
     GROUP BY 1, 2
    HAVING count(DISTINCT dispositivo_id) >= $2
     ORDER BY personas DESC, dias DESC
     LIMIT 1
  )
  SELECT c.personas::int AS personas, c.dias::int AS dias,
         avg(q.latitud) AS latitud, avg(q.longitud) AS longitud
    FROM celda c
    JOIN quietos q ON abs(q.latitud - c.la::float8) <= 0.0015 AND abs(q.longitud - c.lo::float8) <= 0.0015
   GROUP BY c.personas, c.dias`;

async function oficinaSugerida(ctx) {
  const ahora = Date.now();
  if (ahora - sugerencia.calculadaEn < VIGENCIA_SUGERENCIA_MS) return sugerencia.datos;
  const { rows } = await consultar(ctx.pool, SQL_SUGERIDA, [ctx.entorno.zonaHoraria, MIN_PERSONAS], {
    signal: ctx.signal,
    timeoutMs: 15_000,
  });
  const fila = rows[0];
  const datos = fila && Number.isFinite(Number(fila.latitud))
    ? {
        latitud: Number(fila.latitud),
        longitud: Number(fila.longitud),
        radioM: RADIO_POR_DEFECTO_M,
        personas: fila.personas,
        dias: fila.dias,
      }
    : null;
  sugerencia = { calculadaEn: ahora, datos };
  return datos;
}

// GET /api/v1/oficina → { oficina, sugerida }. `oficina` es la fijada por un
// administrador (o null); `sugerida` solo se calcula cuando no hay fijada.
export async function obtenerOficina(ctx) {
  const oficina = await oficinaConfigurada(ctx);
  const sugerida = oficina ? null : await oficinaSugerida(ctx).catch(() => null);
  respuestaJson(ctx.res, 200, { oficina, sugerida });
}

// PUT /api/v1/oficina { nombre?, latitud, longitud, radioM? }
export async function fijarOficina(ctx) {
  await exigirAdministracion(ctx);
  const oficina = validarOficina(await leerCuerpoJson(ctx.req, 4096));
  await consultar(
    ctx.pool,
    `INSERT INTO system.dmt_configuracion (clave, valor, descripcion)
     VALUES ($1, $2::jsonb, 'Lugar de trabajo común: llegada y salida de la oficina en el panel')
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [CLAVE, JSON.stringify(oficina)],
    { signal: ctx.signal },
  );
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'fijar_oficina',
    entidad: 'configuracion',
    entidadId: CLAVE,
    descripcion: 'Oficina fijada.',
    datos: oficina,
    req: ctx.req,
  });
  respuestaJson(ctx.res, 200, { oficina, sugerida: null });
}

// DELETE /api/v1/oficina: vuelve a la sugerencia.
export async function quitarOficina(ctx) {
  await exigirAdministracion(ctx);
  await consultar(ctx.pool, 'DELETE FROM system.dmt_configuracion WHERE clave = $1', [CLAVE], { signal: ctx.signal });
  sugerencia = { calculadaEn: 0, datos: null };
  await auditar(ctx.pool, ctx.log, {
    usuarioId: ctx.usuario?.id,
    accion: 'quitar_oficina',
    entidad: 'configuracion',
    entidadId: CLAVE,
    descripcion: 'Oficina quitada.',
    req: ctx.req,
  });
  respuestaSinContenido(ctx.res);
}
