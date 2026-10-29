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
  'application/pdf',
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

const escaparHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Correo con la cabecera de la marca (franja azul), el resumen del reporte y
// un pie. Estilos en línea y tablas: así lo muestran bien Outlook y Gmail.
export function correoHtml({ titulo, nombre, rango, archivos }) {
  const fila = (etiqueta, valor) =>
    `<tr><td style="padding:6px 0;color:#5f6b7a;width:110px">${etiqueta}</td><td style="padding:6px 0;color:#17202a;font-weight:bold">${escaparHtml(valor)}</td></tr>`;
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px 12px;background:#f3f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e1e6ee;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">
<tr><td style="background:#17365D;border-radius:10px 10px 0 0;padding:22px 28px">
<div style="color:#ffffff;font-size:20px;font-weight:bold">DMujeres Tracking</div>
<div style="color:#c9d4e3;font-size:13px">Auditoría de jornadas en campo</div>
</td></tr>
<tr><td style="padding:28px">
<div style="font-size:17px;font-weight:bold;color:#17365D;margin-bottom:6px">${escaparHtml(titulo)}</div>
<div style="color:#17202a;margin-bottom:18px">Adjuntamos el reporte solicitado desde la app.</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid #e1e6ee;border-bottom:1px solid #e1e6ee;width:100%;margin-bottom:18px">
${fila('Persona', nombre)}${fila('Período', rango)}${fila('Archivos', archivos.join(', '))}
</table>
<div style="color:#5f6b7a;font-size:12px">El PDF se lee mejor para revisar e imprimir; el Excel, para filtrar y sumar.</div>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e1e6ee;color:#8a95a5;font-size:11px">
Mensaje automático de DMujeres Tracking. No responda a este correo.
</td></tr>
</table></body></html>`;
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
    typeof a?.nombre === 'string' && /^[\p{L}\p{N} .()-]{1,90}\.(xlsx|pdf|png)$/u.test(a.nombre) &&
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
        html: correoHtml({
          titulo: typeof cuerpo.titulo === 'string' && cuerpo.titulo.trim() ? cuerpo.titulo.trim().slice(0, 80) : titulo,
          nombre: typeof cuerpo.nombre === 'string' && cuerpo.nombre.trim() ? cuerpo.nombre.trim().slice(0, 80) : '—',
          rango: typeof cuerpo.rango === 'string' && cuerpo.rango.trim() ? cuerpo.rango.trim().slice(0, 80) : '—',
          archivos: archivos.map((a) => a.nombre),
        }),
        text: `${titulo}\n\nAdjuntamos el reporte solicitado desde la app DMujeres Tracking.\nMensaje automático: no responda a este correo.`,
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
