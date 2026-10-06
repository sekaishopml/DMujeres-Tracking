// Envía avisos push con FCM (API HTTP v1, sin SDK): firma un JWT con la cuenta
// de servicio, lo cambia por un token de acceso (se guarda hasta 5 min antes de
// vencer) y manda el mensaje de recuperación al teléfono.
//
// Solo se informa éxito si FCM devuelve un messageId. La credencial nunca se
// registra.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const PLANTILLA_URL_FCM = (proyecto) =>
  `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(proyecto)}/messages:send`;
const ALCANCE = 'https://www.googleapis.com/auth/firebase.messaging';
const VIDA_JWT_S = 3600;
const MARGEN_CACHE_MS = 5 * 60 * 1000;

export class ErrorFcm extends Error {
  constructor(mensaje, opciones = {}) {
    super(mensaje);
    this.name = 'ErrorFcm';
    this.codigo = opciones.codigo ?? 'ERROR_FCM';
    this.http = opciones.http ?? null;
    this.tokenInvalido = opciones.tokenInvalido === true;
  }
}

export function cargarCredencial(ruta) {
  const crudo = JSON.parse(readFileSync(ruta, 'utf8'));
  for (const campo of ['project_id', 'client_email', 'private_key']) {
    if (typeof crudo[campo] !== 'string' || crudo[campo].trim() === '') {
      throw new Error(`credencial FCM invalida: falta ${campo}`);
    }
  }
  return {
    ruta,
    projectId: crudo.project_id,
    clientEmail: crudo.client_email,
    privateKey: crudo.private_key,
  };
}

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

export function firmarJwt(credencial, ahoraSegundos = Math.floor(Date.now() / 1000)) {
  const cabecera = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const reclamos = base64url(JSON.stringify({
    iss: credencial.clientEmail,
    scope: ALCANCE,
    aud: URL_TOKEN,
    iat: ahoraSegundos,
    exp: ahoraSegundos + VIDA_JWT_S,
  }));
  const firma = createSign('RSA-SHA256')
    .update(`${cabecera}.${reclamos}`)
    .sign(credencial.privateKey);
  return `${cabecera}.${reclamos}.${firma.toString('base64url')}`;
}

// Clasifica el error HTTP de FCM: UNREGISTERED/INVALID_ARGUMENT y 404 marcan el
// token como invalido; el resto queda como codigo de error registrado.
function clasificarError(http, texto) {
  let codigo = `HTTP_${http}`;
  try {
    const cuerpo = JSON.parse(texto);
    const error = cuerpo?.error;
    const detalle = Array.isArray(error?.details)
      ? error.details.find((item) => typeof item?.errorCode === 'string')
      : null;
    if (detalle) codigo = detalle.errorCode;
    else if (typeof error?.status === 'string') codigo = error.status;
  } catch {
    // cuerpo no JSON: se conserva HTTP_<codigo>
  }
  const tokenInvalido = http === 404 || codigo === 'UNREGISTERED' || codigo === 'INVALID_ARGUMENT';
  return { messageId: null, errorCode: codigo, http, tokenInvalido };
}

export function crearEmisorFcm({ credencial, log, fetchImpl = fetch, ahora = () => Date.now() }) {
  const urlFcm = PLANTILLA_URL_FCM(credencial.projectId);
  let cache = { token: null, expiraEn: 0 };

  async function obtenerAccessToken() {
    if (cache.token && ahora() < cache.expiraEn) return cache.token;
    const jwt = firmarJwt(credencial, Math.floor(ahora() / 1000));
    const cuerpo = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    });
    const respuesta = await fetchImpl(URL_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: cuerpo,
    });
    const texto = await respuesta.text();
    if (!respuesta.ok) {
      throw new ErrorFcm(`canje OAuth HTTP ${respuesta.status}`, {
        codigo: 'OAUTH_ERROR',
        http: respuesta.status,
      });
    }
    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new ErrorFcm('respuesta OAuth no JSON', { codigo: 'OAUTH_ERROR' });
    }
    if (typeof datos.access_token !== 'string' || datos.access_token === '') {
      throw new ErrorFcm('respuesta OAuth sin access_token', { codigo: 'OAUTH_ERROR' });
    }
    const segundos = Number(datos.expires_in);
    const vidaMs = Number.isFinite(segundos) && segundos > 0
      ? segundos * 1000
      : VIDA_JWT_S * 1000;
    cache = {
      token: datos.access_token,
      expiraEn: ahora() + Math.max(60_000, vidaMs - MARGEN_CACHE_MS),
    };
    log?.info(`OAuth renovado (vigencia ${Math.round(vidaMs / 1000)} s)`);
    return cache.token;
  }

  async function publicar(accessToken, cuerpo) {
    return await fetchImpl(urlFcm, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
    });
  }

  async function enviarProbe({ token, attemptId, deviceId, issuedAtMs }) {
    const cuerpo = {
      message: {
        token,
        data: {
          type: 'TRACKING_RECOVERY_PROBE',
          recoveryAttemptId: attemptId,
          deviceId,
          issuedAtMs: String(issuedAtMs),
        },
        // Con 60 s el aviso se perdía si el teléfono estaba sin red o dormido en
        // ese minuto. Con 30 min FCM lo guarda y lo entrega al volver, y la
        // llave de colapso deja solo el más reciente.
        android: { priority: 'HIGH', ttl: '1800s', collapse_key: 'tracking_recovery' },
      },
    };
    try {
      let acceso = await obtenerAccessToken();
      let respuesta = await publicar(acceso, cuerpo);
      // 401: renovar el access token una unica vez y reintentar.
      if (respuesta.status === 401) {
        cache = { token: null, expiraEn: 0 };
        acceso = await obtenerAccessToken();
        respuesta = await publicar(acceso, cuerpo);
      }
      const texto = await respuesta.text();
      if (!respuesta.ok) return clasificarError(respuesta.status, texto);
      let datos;
      try {
        datos = JSON.parse(texto);
      } catch {
        return { messageId: null, errorCode: 'RESPUESTA_NO_JSON', http: respuesta.status, tokenInvalido: false };
      }
      if (typeof datos?.name !== 'string' || datos.name === '') {
        return { messageId: null, errorCode: 'SIN_MESSAGE_ID', http: respuesta.status, tokenInvalido: false };
      }
      return { messageId: datos.name, errorCode: null, http: respuesta.status, tokenInvalido: false };
    } catch (error) {
      const codigo = error instanceof ErrorFcm ? error.codigo : 'ERROR_RED';
      return {
        messageId: null,
        errorCode: codigo,
        http: error instanceof ErrorFcm ? error.http : null,
        tokenInvalido: false,
      };
    }
  }

  return { obtenerAccessToken, enviarProbe, projectId: credencial.projectId };
}
