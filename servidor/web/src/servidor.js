// Sirve el panel compilado (panel/dist) y pasa las llamadas /api/* a la API.
import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip, gzipSync } from 'node:zlib';

const AQUI = fileURLToPath(new URL('.', import.meta.url));
// DMJ_WEB_DIST permite servir otra carpeta compilada.
const DIST = resolve(process.env.DMJ_WEB_DIST ?? resolve(AQUI, '../../../panel/dist'));
const API = process.env.DMJ_API_URL ?? 'http://127.0.0.1:8081';
const PUERTO = Number(process.env.DMJ_WEB_PORT ?? 8999);
const HOST = process.env.DMJ_WEB_HOST ?? '0.0.0.0';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// Texto que vale la pena comprimir (JS, CSS, JSON, SVG, HTML): baja ~4 veces.
const COMPRIMIBLE = /^(text\/|application\/json|image\/svg)/;
const aceptaGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
// Archivos ya comprimidos, por ruta y fecha: se comprimen una sola vez.
const comprimidos = new Map();

async function servirEstatico(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let ruta = decodeURIComponent(url.pathname);
  if (ruta === '/') ruta = '/index.html';
  const destino = resolve(join(DIST, normalize(ruta)));
  // Nada fuera de dist: la web es un SPA, cualquier ruta desconocida cae en index.
  if (!destino.startsWith(DIST)) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  try {
    const info = await stat(destino);
    if (info.isFile()) {
      const tipo = TIPOS[extname(destino)] ?? 'application/octet-stream';
      const cabeceras = {
        'Content-Type': tipo,
        // Lo de /assets lleva el hash en el nombre: nunca cambia, se guarda un año.
        'Cache-Control': destino.endsWith('index.html')
          ? 'no-cache'
          : ruta.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
        Vary: 'Accept-Encoding',
      };
      if (COMPRIMIBLE.test(tipo) && aceptaGzip(req)) {
        const clave = `${destino}:${info.mtimeMs}`;
        let cuerpo = comprimidos.get(clave);
        if (!cuerpo) {
          cuerpo = gzipSync(await readFile(destino), { level: 9 });
          comprimidos.set(clave, cuerpo);
        }
        res.writeHead(200, { ...cabeceras, 'Content-Encoding': 'gzip' });
        res.end(cuerpo);
        return;
      }
      res.writeHead(200, cabeceras);
      res.end(await readFile(destino));
      return;
    }
  } catch {
    // si no, sigue con index.html
  }
  const indice = await readFile(join(DIST, 'index.html'));
  res.writeHead(200, { 'Content-Type': TIPOS['.html'], 'Cache-Control': 'no-cache' });
  res.end(indice);
}

function proxyApi(req, res) {
  const destino = new URL(req.url, API);
  const solicitud = httpRequest(
    {
      hostname: destino.hostname,
      port: destino.port || 80,
      path: destino.pathname + destino.search,
      method: req.method,
      headers: { ...req.headers, host: destino.host },
    },
    (respuesta) => {
      // El JSON de la API (la ruta de un día pesa ~100 kB) va comprimido.
      const tipo = respuesta.headers['content-type'] ?? '';
      if (tipo.startsWith('application/json') && !respuesta.headers['content-encoding'] && aceptaGzip(req)) {
        const { 'content-length': _largo, ...cabeceras } = respuesta.headers;
        res.writeHead(respuesta.statusCode ?? 502, { ...cabeceras, 'content-encoding': 'gzip', vary: 'Accept-Encoding' });
        respuesta.pipe(createGzip()).pipe(res);
        return;
      }
      res.writeHead(respuesta.statusCode ?? 502, respuesta.headers);
      respuesta.pipe(res);
    },
  );
  solicitud.on('error', (error) => {
    console.error(`[web] API no disponible: ${error.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { codigo: 'SERVICIO_NO_DISPONIBLE', mensaje: 'La API no responde.' } }));
  });
  // Si el navegador se va (por ejemplo del canal en vivo), se corta también
  // con la API para no dejar conexiones colgadas.
  res.on('close', () => solicitud.destroy());
  req.pipe(solicitud);
}

createServer((req, res) => {
  if ((req.url ?? '').startsWith('/api/')) {
    proxyApi(req, res);
  } else {
    servirEstatico(req, res).catch((error) => {
      console.error('[web] error sirviendo estático', error);
      res.writeHead(500).end('Error interno');
    });
  }
}).listen(PUERTO, HOST, () => {
  console.log(`[web] DMujeres Tracking en http://${HOST}:${PUERTO} (API ${API})`);
});
