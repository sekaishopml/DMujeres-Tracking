// Enlace de descarga de la app: cada petición lee la versión publicada, así
// no hace falta reiniciar el servidor al publicar una versión nueva.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const CARPETA_OTA_DEFECTO = '/home/DMujeres-Tracking/ota';

const NO_DISPONIBLE = {
  estado: 503,
  cabeceras: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  cuerpo: 'La app no está disponible por ahora.',
};

// Solo se redirige a un .apk por https; un manifiesto raro no debe mandar a otro sitio.
function urlApkValida(valor) {
  if (typeof valor !== 'string') return false;
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' && url.pathname.endsWith('.apk');
  } catch {
    return false;
  }
}

// Recibe el texto de latest.json (null si no existe) y decide la respuesta.
export function respuestaDescarga(texto) {
  if (texto == null) return NO_DISPONIBLE;
  let manifiesto;
  try {
    manifiesto = JSON.parse(texto);
  } catch {
    return NO_DISPONIBLE;
  }
  if (!urlApkValida(manifiesto?.url)) return NO_DISPONIBLE;
  return {
    estado: 302,
    cabeceras: { Location: manifiesto.url, 'Cache-Control': 'no-store' },
    cuerpo: '',
  };
}

export async function leerDescarga(carpeta = process.env.DMJ_OTA_DIR ?? CARPETA_OTA_DEFECTO) {
  let texto = null;
  try {
    texto = await readFile(join(carpeta, 'latest.json'), 'utf8');
  } catch {
    // sin archivo: se responde 503
  }
  return respuestaDescarga(texto);
}

// Segunda app (REMU): un archivo fijo de la carpeta de versiones. Se manda
// como descarga, con su nombre, en lugar de mostrarse en el navegador.
const APK_REMU = 'REUMCLIENT7.9.1.apk';

export async function enviarApkRemu(req, res, carpeta = process.env.DMJ_OTA_DIR ?? CARPETA_OTA_DEFECTO) {
  const archivo = join(carpeta, APK_REMU);
  let info;
  try {
    info = await stat(archivo);
  } catch {
    res.writeHead(NO_DISPONIBLE.estado, NO_DISPONIBLE.cabeceras).end(NO_DISPONIBLE.cuerpo);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': info.size,
    'Content-Disposition': `attachment; filename="${APK_REMU}"`,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(archivo).on('error', () => res.destroy()).pipe(res);
}
