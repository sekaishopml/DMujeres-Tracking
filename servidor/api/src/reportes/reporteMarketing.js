// Reporte de Marketing: la plantilla de Excel (plantillas/Reporte_Marketing.xlsm)
// con la fecha elegida y, por persona, la hora de encendido y de apagado. Solo
// se tocan esas celdas; formato, macros y las demás columnas quedan como en la
// plantilla. Las horas son de referencia: la ruta se revisa en el replay.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { consultar } from '../base/db.js';
import { datosInvalidos, ErrorApi } from '../base/errores.js';
import { rangoHoy } from '../base/http.js';
import { PREDICADO_PERMISO, permisoDe } from '../equipos/flota.js';
import { trazoDelRango } from '../recorrido/replay.js';

const ejecutar = promisify(execFile);
const PLANTILLA = fileURLToPath(new URL('../../plantillas/Reporte_Marketing.xlsm', import.meta.url));
const HOJA = 'RESUMEN';
const SIN_DATO = '—';
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

// "MIERCOLES 07 DE OCTUBRE 2026", como el título de la plantilla.
export function fechaTitulo(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const semana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return `${DIAS[semana]} ${String(dia).padStart(2, '0')} DE ${MESES[mes - 1]} ${anio}`;
}

// Hora local en 24 h sin cero a la izquierda: 0:02, 7:52, 13:05.
export function horaCorta(instante, zona) {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instante);
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${Number(valor('hour'))}:${valor('minute')}`;
}

// Mayúsculas, sin tildes ni espacios de más: "JIMMY  LLANLLAN" = "Jimmy Llanllan".
export function normalizar(nombre) {
  return String(nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function distancia(a, b) {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const arriba = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = arriba;
    }
  }
  return fila[b.length];
}

// La persona de la plantilla con su cuenta: igual, o con hasta 2 letras
// distintas si es la única así ("JOICE OBANDO" = "Joyce Obando").
export function buscarPersona(nombre, personas) {
  const buscado = normalizar(nombre);
  const igual = personas.find((p) => normalizar(p.nombre) === buscado);
  if (igual) return igual;
  const cerca = personas.filter((p) => distancia(normalizar(p.nombre), buscado) <= 2);
  return cerca.length === 1 ? cerca[0] : null;
}

const VACIO = { encendido: SIN_DATO, apagado: SIN_DATO };

// REGLA PERMANENTE del Excel de Marketing (ver docs/servidor.md; no cambiarla
// sin orden expresa del usuario): el encendido es la hora del primer punto del
// trazo que se ve en el replay ese día y el apagado la del último. Se calculan
// con la misma función que el replay (`trazoDelRango`), así que siempre
// coinciden con el mapa. Sin trazo ese día: guion.
export function horasDelDia({ primerPunto, ultimoPunto }, zona) {
  if (!primerPunto || !ultimoPunto) return VACIO;
  return { encendido: horaCorta(new Date(primerPunto), zona), apagado: horaCorta(new Date(ultimoPunto), zona) };
}

const escapar = (texto) => texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const desescapar = (texto) =>
  texto.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function textosCompartidos(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    desescapar([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
}

// Pone texto en una celda conservando su estilo (vacía o con valor).
export function ponerTexto(xml, ref, texto) {
  const celda = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const hallada = xml.match(celda);
  if (!hallada) return xml;
  const estilo = hallada[1].match(/ s="\d+"/)?.[0] ?? '';
  return xml.replace(celda, `<c r="${ref}"${estilo} t="inlineStr"><is><t>${escapar(texto)}</t></is></c>`);
}

// Filas de personas de la hoja: nombre en B, sin título de sección (esas
// combinan C:I) ni leyenda (llevan ":"). Devuelve [{ fila, nombre }].
export function filasDePersonas(hoja, compartidos) {
  const secciones = new Set([...hoja.matchAll(/<mergeCell ref="C(\d+):I\d+"\/>/g)].map((m) => m[1]));
  const filas = [];
  for (const m of hoja.matchAll(/<c r="B(\d+)"[^>]*t="s"[^>]*><v>(\d+)<\/v><\/c>/g)) {
    const fila = m[1];
    const nombre = compartidos[Number(m[2])] ?? '';
    if (Number(fila) <= 10 || secciones.has(fila) || nombre.includes(':')) continue;
    if (!new RegExp(`<c r="C${fila}"`).test(hoja)) continue;
    filas.push({ fila, nombre });
  }
  return filas;
}

// El primer y el último punto del trazo del replay de cada persona. Se piden
// de a pocas para no saturar la base.
const SIMULTANEAS = 4;

async function leerEquipos(ctx, desde, hasta) {
  const { rows: personas } = await consultar(
    ctx.pool,
    `SELECT DISTINCT ON (u.id) u.nombre, d.id AS dispositivo_id, d.atributos->>'plataforma' AS plataforma
     FROM iam.dmt_usuario u
     JOIN operations.dmt_asignacion a ON a.usuario_id = u.id AND a.activa
     JOIN tracking.dmt_dispositivo d ON d.id = a.dispositivo_id
     WHERE u.habilitado AND NOT u.administrador AND d.habilitado AND ${PREDICADO_PERMISO}
     ORDER BY u.id, a.desde_en DESC`,
    [permisoDe(ctx.usuario)],
    { signal: ctx.signal },
  );
  const resultado = new Array(personas.length);
  let siguiente = 0;
  async function trabajar() {
    while (siguiente < personas.length) {
      const i = siguiente;
      siguiente += 1;
      const p = personas[i];
      let primerPunto = null;
      let ultimoPunto = null;
      try {
        const { posiciones } = await trazoDelRango(
          ctx,
          { id: p.dispositivo_id, atributos: { plataforma: p.plataforma } },
          { desde, hasta },
        );
        // Solo ubicación simulada: no hay trazo (posiciones vacías).
        if (posiciones.length > 0) {
          primerPunto = posiciones[0].registradoEn;
          ultimoPunto = posiciones[posiciones.length - 1].registradoEn;
        }
      } catch (error) {
        // Sin trazo ese día (404) o demasiados puntos (400): guion. Otro error sigue.
        if (!(error instanceof ErrorApi) || ![400, 404].includes(error.estado)) throw error;
      }
      resultado[i] = { nombre: p.nombre, primerPunto, ultimoPunto };
    }
  }
  await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, personas.length) }, trabajar));
  return resultado;
}

// Arma el libro: copia de la plantilla con la hoja RESUMEN llena.
async function armarLibro(titulo, valorDe) {
  const carpeta = await mkdtemp(join(tmpdir(), 'reporte-marketing-'));
  try {
    const dir = join(carpeta, 'libro');
    await ejecutar('unzip', ['-q', PLANTILLA, '-d', dir]);
    const libro = await readFile(join(dir, 'xl/workbook.xml'), 'utf8');
    const rid = libro.match(new RegExp(`<sheet name="${HOJA}"[^>]*r:id="([^"]+)"`))[1];
    const rels = await readFile(join(dir, 'xl/_rels/workbook.xml.rels'), 'utf8');
    const destino = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))[1];
    const archivoHoja = join(dir, 'xl', destino.replace(/^\/?xl\//, ''));
    const compartidos = textosCompartidos(await readFile(join(dir, 'xl/sharedStrings.xml'), 'utf8'));
    let hoja = await readFile(archivoHoja, 'utf8');
    hoja = ponerTexto(hoja, 'B2', titulo);
    for (const { fila, nombre } of filasDePersonas(hoja, compartidos)) {
      const { encendido, apagado } = valorDe(nombre);
      hoja = ponerTexto(hoja, `C${fila}`, encendido);
      hoja = ponerTexto(hoja, `D${fila}`, apagado);
    }
    await writeFile(archivoHoja, hoja);
    // [Content_Types].xml primero, como lo deja Excel.
    const salida = join(carpeta, 'reporte.xlsm');
    await ejecutar('zip', ['-q', '-X', '-D', salida, '[Content_Types].xml'], { cwd: dir });
    await ejecutar('zip', ['-q', '-X', '-D', '-r', salida, '.', '-x', '[[]Content_Types].xml'], { cwd: dir });
    return await readFile(salida);
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

// GET /api/v1/reports/marketing?fecha=AAAA-MM-DD
export async function descargarReporteMarketing(ctx) {
  const fecha = ctx.url.searchParams.get('fecha') ?? '';
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && new Date(Date.UTC(anio, mes - 1, dia)).toISOString().startsWith(fecha);
  if (!valida) throw datosInvalidos('La fecha debe tener el formato AAAA-MM-DD.');
  const zona = ctx.entorno.zonaHoraria;
  // Día local de la fecha: el mediodía UTC cae en ese día en cualquier zona de América.
  const { desde, hasta } = rangoHoy(zona, new Date(`${fecha}T12:00:00Z`));
  const equipos = await leerEquipos(ctx, desde, hasta);
  const libro = await armarLibro(fechaTitulo(fecha), (nombre) => {
    const persona = buscarPersona(nombre, equipos);
    return persona ? horasDelDia(persona, zona) : VACIO;
  });
  const nombre = `Reporte_Marketing_${String(dia).padStart(2, '0')}-${String(mes).padStart(2, '0')}-${String(anio).slice(2)}.xlsm`;
  ctx.res.writeHead(200, {
    'content-type': 'application/vnd.ms-excel.sheet.macroEnabled.12',
    'content-length': libro.length,
    'content-disposition': `attachment; filename="${nombre}"`,
    'cache-control': 'no-store',
  });
  ctx.res.end(libro);
}
