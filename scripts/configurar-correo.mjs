// Deja listo el envío de correos desde reporte@sekaidevec.com:
//  1. registra el dominio en Resend (o usa el que ya está);
//  2. crea en Cloudflare los registros que pide Resend (DKIM, SPF y rebotes)
//     y la política DMARC, en "solo DNS";
//  3. pide a Resend que verifique y muestra el estado.
// Claves fuera del repo: /opt/dmj-keys/correo.env (RESEND_API_KEY, con acceso
// completo) y /opt/dmj-keys/cloudflare.env (CF_API_TOKEN). Se puede repetir:
// lo que ya existe no se duplica.
// Uso: sudo node24 scripts/configurar-correo.mjs

import { readFileSync } from 'node:fs';

const DOMINIO = 'sekaidevec.com';
const clave = (archivo, nombre) => readFileSync(archivo, 'utf8').match(new RegExp(`^\\s*${nombre}\\s*=\\s*(\\S+)`, 'm'))?.[1];
const RESEND = clave('/opt/dmj-keys/correo.env', 'RESEND_API_KEY');
const CF = clave('/opt/dmj-keys/cloudflare.env', 'CF_API_TOKEN');
if (!RESEND || !CF) throw new Error('Falta RESEND_API_KEY o CF_API_TOKEN en /opt/dmj-keys');

async function api(url, token, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${opciones.method ?? 'GET'} ${url}: ${r.status} ${JSON.stringify(datos.errors ?? datos.message ?? datos)}`);
  return datos;
}
const resend = (ruta, opciones) => api(`https://api.resend.com${ruta}`, RESEND, opciones);
const cf = (ruta, opciones) => api(`https://api.cloudflare.com/client/v4${ruta}`, CF, opciones);

let dominio = (await resend('/domains')).data?.find((d) => d.name === DOMINIO);
if (!dominio) dominio = await resend('/domains', { method: 'POST', body: JSON.stringify({ name: DOMINIO }) });
const detalle = await resend(`/domains/${dominio.id}`);
console.log(`Resend: dominio ${DOMINIO} (${detalle.status})`);

const zona = (await cf(`/zones?name=${DOMINIO}`)).result[0];
const existentes = (await cf(`/zones/${zona.id}/dns_records?per_page=500`)).result;
const registros = [
  ...detalle.records.map((r) => ({
    type: r.type,
    name: r.name === '@' || r.name === DOMINIO ? DOMINIO : `${r.name.replace(new RegExp(`\\.?${DOMINIO}$`), '')}.${DOMINIO}`,
    content: r.value,
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
  })),
  // Política DMARC: solo observar al principio (no rechaza nada).
  { type: 'TXT', name: `_dmarc.${DOMINIO}`, content: 'v=DMARC1; p=none;' },
];
for (const r of registros) {
  const ya = existentes.find((e) => e.type === r.type && e.name === r.name && e.content.replace(/"/g, '') === r.content.replace(/"/g, ''));
  if (ya) {
    console.log(`  ya estaba: ${r.type} ${r.name}`);
    continue;
  }
  await cf(`/zones/${zona.id}/dns_records`, { method: 'POST', body: JSON.stringify({ ...r, ttl: 1, proxied: false }) });
  console.log(`  creado:    ${r.type} ${r.name}`);
}

await resend(`/domains/${dominio.id}/verify`, { method: 'POST' });
const final = await resend(`/domains/${dominio.id}`);
console.log(`Resend: ${final.status}. Si dice "pending", se vuelve a correr en unos minutos (el DNS tarda).`);
