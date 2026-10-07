// GET /api/mobile/v1/estado: lo que el servidor ya tiene de este teléfono.
// El botón Actualizar de la app lo muestra ("el servidor tiene tu ubicación
// de las 10:42"): es la confirmación real de que el registro está llegando.

import { buscarOFallar, identificadorDe, responderJson, responderSinCuerpo, autorizacionMovil } from './movil.js';

export async function atenderEstado(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) return responderSinCuerpo(res, 401);
  const identificador = identificadorDe(req, ctx.url);
  if (!identificador) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  try {
    const { rows } = await ctx.almacen.pool.query(
      `SELECT max(registrado_en) AS ultimo FROM tracking.dmt_posicion
        WHERE dispositivo_id = $1 AND registrado_en > now() - interval '2 days'`,
      [Number(dispositivo.id)],
    );
    const ultimo = rows[0]?.ultimo ? new Date(rows[0].ultimo).getTime() : null;
    return responderJson(res, 200, { ultimoPuntoEn: ultimo, ahora: Date.now() });
  } catch (error) {
    ctx.log.error(`movil/estado: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}
