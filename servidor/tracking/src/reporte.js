// Reporte de la persona desde la app (diario, semanal o mensual). El Excel y
// la imagen los arma la app con lo que ya tiene; aquí solo:
//  - GET  /api/mobile/v1/jornadas?desde=&hasta=  inicio y fin de jornada de
//    cada día (la app no guarda el historial);
//  - POST /api/mobile/v1/reporte/correo         lo manda por correo desde
//    reporte@sekaidevec.com (Resend) y recuerda el correo de la persona.
// La clave de Resend vive en /opt/dmj-keys/correo.env (RESEND_API_KEY=...),
// fuera del repo; se lee en cada envío, así no hace falta reiniciar.

import { readFile } from 'node:fs/promises';
import {
  autorizacionMovil, buscarOFallar, identificadorDe, leerJson, responderJson, responderSinCuerpo,
} from './movil.js';

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Un Excel y una imagen de un mes caben de sobra (en base64).
const LIMITE_REPORTE = 8 * 1024 * 1024;
const TIPOS_ARCHIVO = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
]);
// Como mucho 10 envíos por teléfono por hora: no es un buzón para cualquier cosa.
const MAX_ENVIOS_HORA = 10;
const enviosRecientes = new Map();
export const REMITENTE = 'DMujeres Reportes <reporte@sekaidevec.com>';
export const ARCHIVO_CLAVE = '/opt/dmj-keys/correo.env';

export function puedeEnviar(dispositivoId, ahoraMs = Date.now()) {
  const lista = (enviosRecientes.get(dispositivoId) ?? []).filter((t) => ahoraMs - t < 3_600_000);
  if (lista.length >= MAX_ENVIOS_HORA) {
    enviosRecientes.set(dispositivoId, lista);
    return false;
  }
  lista.push(ahoraMs);
  enviosRecientes.set(dispositivoId, lista);
  return true;
}

async function claveResend() {
  try {
    const texto = await readFile(ARCHIVO_CLAVE, 'utf8');
    return texto.match(/^\s*RESEND_API_KEY\s*=\s*(\S+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function atenderJornadasConsulta(req, res, ctx) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) return responderSinCuerpo(res, 401);
  const identificador = identificadorDe(req, ctx.url);
  const desde = ctx.url.searchParams.get('desde');
  const hasta = ctx.url.searchParams.get('hasta');
  if (!identificador || !FECHA_RE.test(desde ?? '') || !FECHA_RE.test(hasta ?? '')) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  try {
    const { rows } = await ctx.almacen.pool.query(
      `SELECT to_char(inicio_en AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS fecha,
              to_char(inicio_en AT TIME ZONE 'America/Guayaquil', 'HH24:MI') AS inicio,
              to_char(fin_en AT TIME ZONE 'America/Guayaquil', 'HH24:MI') AS fin,
              estado = 'abierta' AS abierta, atributos->>'notaFin' AS nota_fin
         FROM operations.dmt_jornada
        WHERE dispositivo_id = $1
          AND inicio_en >= ($2::date::timestamp AT TIME ZONE 'America/Guayaquil')
          AND inicio_en < (($3::date + 1)::timestamp AT TIME ZONE 'America/Guayaquil')
        ORDER BY inicio_en`,
      [Number(dispositivo.id), desde, hasta],
    );
    return responderJson(res, 200, {
      jornadas: rows.map((f) => ({ fecha: f.fecha, inicio: f.inicio, fin: f.fin, abierta: f.abierta, notaFin: f.nota_fin })),
      correo: typeof dispositivo.atributos?.['mobile.correoReporte'] === 'string' ? dispositivo.atributos['mobile.correoReporte'] : null,
    });
  } catch (error) {
    ctx.log.error(`movil/jornadas: ${error.message}`);
    return responderSinCuerpo(res, 503);
  }
}

export async function atenderReporteCorreo(req, res, ctx, enviar = globalThis.fetch) {
  if (!ctx.configuracion.canalMovilActivo) return responderSinCuerpo(res, 404);
  if (!(await autorizacionMovil(req, ctx))) return responderSinCuerpo(res, 401);
  const lectura = await leerJson(req, LIMITE_REPORTE);
  if (!lectura.ok) return responderSinCuerpo(res, lectura.motivo === 'grande' ? 413 : 400);
  const cuerpo = lectura.datos ?? {};
  const identificador = typeof cuerpo.deviceId === 'string' ? cuerpo.deviceId.trim() : identificadorDe(req, ctx.url);
  const correo = typeof cuerpo.correo === 'string' ? cuerpo.correo.trim().toLowerCase() : '';
  const archivos = Array.isArray(cuerpo.archivos) ? cuerpo.archivos : [];
  const validos = archivos.length > 0 && archivos.length <= 3 && archivos.every((a) =>
    typeof a?.nombre === 'string' && /^[\w .()-]{1,80}\.(xlsx|png)$/.test(a.nombre) &&
    TIPOS_ARCHIVO.has(a.tipo) && typeof a.base64 === 'string' && a.base64.length > 0);
  if (!identificador || !CORREO_RE.test(correo) || correo.length > 120 || !validos) return responderSinCuerpo(res, 400);
  const dispositivo = await buscarOFallar(ctx, res, identificador, 404);
  if (!dispositivo) return;
  // El correo queda guardado aunque el envío falle: la app lo recuerda igual.
  await ctx.almacen.fusionarAtributosDispositivo(dispositivo.id, { 'mobile.correoReporte': correo }).catch(() => {});
  const clave = await claveResend();
  if (!clave) return responderJson(res, 503, { error: 'correo_no_configurado' });
  if (!puedeEnviar(String(dispositivo.id))) return responderJson(res, 429, { error: 'demasiados_envios' });
  const titulo = typeof cuerpo.asunto === 'string' && cuerpo.asunto.trim() ? cuerpo.asunto.trim().slice(0, 120) : 'Reporte';
  try {
    const r = await enviar('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: REMITENTE,
        to: [correo],
        subject: titulo,
        text: `${titulo}\n\nAdjunto su reporte generado desde la app DMujeres Tracking.`,
        attachments: archivos.map((a) => ({ filename: a.nombre, content: a.base64 })),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      ctx.log.warn(`movil/reporte: Resend respondió ${r.status}`);
      return responderJson(res, 502, { error: 'envio_fallido' });
    }
    ctx.log.info(`movil/reporte: enviado a ${correo.replace(/^(.).*@/, '$1***@')} (${archivos.length} archivos)`);
    return responderJson(res, 200, { ok: true });
  } catch (error) {
    ctx.log.warn(`movil/reporte: ${error.message}`);
    return responderJson(res, 502, { error: 'envio_fallido' });
  }
}
