// Reporte de Marketing: la plantilla de Excel (plantillas/Reporte_Marketing.xlsm)
// con la fecha elegida y, por persona: encendido y apagado (primer y último
// punto del día), inicio y fin de la jornada y la observación (motivo o causa
// cuando terminó antes de las 17:00). Solo se tocan esas celdas; formato y
// macros quedan como en la plantilla.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { consultar } from '../base/db.js';
import { datosInvalidos } from '../base/errores.js';
import { rangoHoy } from '../base/http.js';
import { PREDICADO_PERMISO, permisoDe } from '../equipos/flota.js';
import { GPS_APAGADO_POR, TIPOS } from '../recorrido/eventos.js';
import { aJornada } from '../recorrido/jornadas.js';

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

// Hora desde la que terminar ya no pide motivo (la app lo pide antes).
const FIN_LABORAL = '17:00';
const VACIO = { encendido: SIN_DATO, apagado: SIN_DATO, inicioJornada: SIN_DATO, finJornada: SIN_DATO, observacion: '' };

// Lo que avisó el teléfono al dejar de mandar puntos (mismos textos que la
// bitácora del panel).
const CAUSAS_TELEFONO = ['mobilePowerOff', 'mobileShutdown', 'mobileGpsDisabled', 'mobilePermissionLost'];
export const TIPOS_CAUSA = [...CAUSAS_TELEFONO, 'mobileBatteryCritical', 'mobileSilent'];
const MARGEN_MS = 2 * 60_000;
const VENTANA_MS = 30 * 60_000;

// Por qué no hubo puntos después del último, en este orden: lo que avisó el
// teléfono hasta 30 min después (apagado, GPS, permiso); batería crítica
// desde 30 min antes; el servidor notó que dejó de reportar; y si no hay
// nada, se dice así (nunca se inventa).
function causaDelApagado(ultimo, eventos, hora) {
  const t = ultimo.getTime();
  const cerca = eventos.filter((e) => e.en.getTime() >= t - MARGEN_MS && e.en.getTime() <= t + VENTANA_MS);
  const aviso = cerca.find((e) => CAUSAS_TELEFONO.includes(e.tipo));
  if (aviso) {
    const texto = (aviso.tipo === 'mobileGpsDisabled' && GPS_APAGADO_POR[aviso.quien]) || TIPOS[aviso.tipo].texto;
    return `${texto} a las ${hora(aviso.en)}`;
  }
  const bateria = eventos.find((e) => e.tipo === 'mobileBatteryCritical' && Math.abs(e.en.getTime() - t) <= VENTANA_MS);
  if (bateria) return `${TIPOS.mobileBatteryCritical.texto} a las ${hora(bateria.en)}`;
  if (eventos.some((e) => e.tipo === 'mobileSilent' && e.en.getTime() >= t - MARGEN_MS)) {
    return `${TIPOS.mobileSilent.texto} desde las ${hora(ultimo)}`;
  }
  return `Sin ubicación desde las ${hora(ultimo)}, sin causa registrada en el teléfono`;
}

// Una fila del Excel para un equipo en el día [desde, hasta):
//  - encendido: el primer punto del día desde las 0:00 (dentro o fuera de
//    jornada) o el inicio de una jornada, lo que pase antes;
//  - apagado: el último punto del día hasta las 23:59, o el cierre de la
//    jornada que hizo la persona si fue después;
//  - inicio y fin de jornada: los de la persona (el corte de medianoche no lo
//    es: "Seguía abierta del día anterior" / "No la cerró");
//  - observación, de lunes a sábado: el motivo que escribió al cerrar y, si
//    terminó antes de las 17:00 sin motivo, cómo terminó.
// Los puntos simulados no cuentan. iPhone (no marca jornada): solo puntos.
export function horasDelDia({ ios, jornadas, primerPunto, ultimoPunto, eventos = [] }, desde, hasta, zona, ahora = new Date()) {
  const hora = (t) => horaCorta(t, zona);
  if (ios) {
    return primerPunto ? { ...VACIO, encendido: hora(primerPunto), apagado: hora(ultimoPunto) } : VACIO;
  }
  if (jornadas.length === 0 && !primerPunto) return VACIO;
  const delDia = jornadas.filter((j) => j.inicio >= desde && j.inicio < hasta);
  const inicios = [primerPunto, ...delDia.map((j) => j.inicio)].filter(Boolean);
  const cierres = jornadas.filter((j) => j.fin && !j.cierreAutomatico && j.fin >= desde && j.fin < hasta).map((j) => j.fin);
  const finales = [ultimoPunto, ...cierres].filter(Boolean);
  const min = (lista) => new Date(Math.min(...lista.map((t) => t.getTime())));
  const max = (lista) => new Date(Math.max(...lista.map((t) => t.getTime())));
  const fila = {
    encendido: inicios.length ? hora(min(inicios)) : SIN_DATO,
    apagado: finales.length ? hora(max(finales)) : SIN_DATO,
    inicioJornada: SIN_DATO,
    finJornada: SIN_DATO,
    observacion: '',
  };
  if (jornadas.length === 0) return { ...fila, inicioJornada: 'Sin jornada', observacion: 'No inició jornada' };
  const propia = jornadas.find((j) => j.inicio >= desde && !j.continua);
  fila.inicioJornada = propia ? hora(propia.inicio) : 'Seguía abierta del día anterior';
  const ultima = jornadas[jornadas.length - 1];
  const cerroLaPersona = ultima.fin && !ultima.cierreAutomatico && ultima.fin < hasta;
  // Abierta en un día que ya pasó: no la cerró ese día.
  const enCurso = !ultima.fin && ahora.getTime() < hasta.getTime();
  fila.finJornada = enCurso ? 'En curso' : cerroLaPersona ? hora(ultima.fin) : 'No la cerró';

  const notas = jornadas.filter((j) => j.notaFin && j.fin).map((j) => `Motivo de cierre (${hora(j.fin)}): ${j.notaFin}`);
  const diaSemana = new Date(desde.getTime() + 12 * 3_600_000).getUTCDay();
  const laborable = diaSemana >= 1 && diaSemana <= 6;
  const [hh, mm] = FIN_LABORAL.split(':').map(Number);
  // Las 17:00 de ese día (las horas se comparan como texto en la zona del día).
  const antesDeLas17 = (t) => {
    const [h, m] = hora(t).split(':').map(Number);
    return h * 60 + m < hh * 60 + mm;
  };
  const yaPasaron17 = ahora.getTime() >= hasta.getTime() || !antesDeLas17(ahora);
  const avisos = [];
  if (laborable && yaPasaron17 && !ultima.notaFin) {
    if (cerroLaPersona && antesDeLas17(ultima.fin)) {
      avisos.push(`Finalizó la jornada a las ${hora(ultima.fin)} sin motivo`);
    } else if (!cerroLaPersona && ultimoPunto && antesDeLas17(ultimoPunto)) {
      avisos.push(causaDelApagado(ultimoPunto, eventos, hora));
    } else if (!cerroLaPersona && !ultimoPunto) {
      avisos.push('Sin ubicación en el día');
    }
  }
  if (!cerroLaPersona && !enCurso) avisos.push('No finalizó la jornada');
  fila.observacion = [...notas, ...avisos].join('. ');
  return fila;
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

async function leerEquipos(ctx, desde, hasta, zona) {
  const { rows: personas } = await consultar(
    ctx.pool,
    `SELECT DISTINCT ON (u.id) u.nombre, d.id AS dispositivo_id, d.atributos->>'plataforma' = 'ios' AS ios
     FROM iam.dmt_usuario u
     JOIN operations.dmt_asignacion a ON a.usuario_id = u.id AND a.activa
     JOIN tracking.dmt_dispositivo d ON d.id = a.dispositivo_id
     WHERE u.habilitado AND NOT u.administrador AND d.habilitado AND ${PREDICADO_PERMISO}
     ORDER BY u.id, a.desde_en DESC`,
    [permisoDe(ctx.usuario)],
    { signal: ctx.signal },
  );
  const ids = personas.map((p) => Number(p.dispositivo_id));
  const { rows: jornadas } = await consultar(
    ctx.pool,
    `SELECT id, dispositivo_id, inicio_en, fin_en, atributos, 0 AS duracion_min FROM operations.dmt_jornada
     WHERE dispositivo_id = ANY($1) AND inicio_en < $3 AND (fin_en IS NULL OR fin_en >= $2)
     ORDER BY inicio_en`,
    [ids, desde, hasta],
    { signal: ctx.signal },
  );
  // Primer y último punto válido del día (sin simulados), dentro o fuera de
  // jornada: cualquier punto prueba que el teléfono estaba encendido.
  const { rows: puntos } = await consultar(
    ctx.pool,
    `SELECT p.dispositivo_id, min(p.registrado_en) AS primero, max(p.registrado_en) AS ultimo
     FROM tracking.dmt_posicion p
     WHERE p.dispositivo_id = ANY($1) AND p.registrado_en >= $2 AND p.registrado_en < $3 AND p.valida
     GROUP BY p.dispositivo_id`,
    [ids, desde, hasta],
    { signal: ctx.signal },
  );
  const { rows: eventos } = await consultar(
    ctx.pool,
    `SELECT dispositivo_id, tipo, ocurrido_en, atributos->>'quien' AS quien FROM tracking.dmt_evento
     WHERE dispositivo_id = ANY($1) AND ocurrido_en >= $2 AND ocurrido_en < $3 AND tipo = ANY($4)
     ORDER BY ocurrido_en`,
    [ids, desde, hasta, TIPOS_CAUSA],
    { signal: ctx.signal },
  );
  return personas.map((p) => {
    const id = Number(p.dispositivo_id);
    const punto = puntos.find((x) => Number(x.dispositivo_id) === id);
    return {
      nombre: p.nombre,
      ios: p.ios === true,
      jornadas: jornadas
        .filter((j) => Number(j.dispositivo_id) === id)
        .map((j) => {
          const a = aJornada(j, zona);
          // Una jornada que empezó otro día también sigue de antes.
          const continua = a.continua === true || j.inicio_en < desde;
          return { inicio: j.inicio_en, fin: j.fin_en, continua, cierreAutomatico: a.cierreAutomatico === true, notaFin: a.notaFin ?? null };
        }),
      primerPunto: punto?.primero ?? null,
      ultimoPunto: punto?.ultimo ?? null,
      eventos: eventos.filter((e) => Number(e.dispositivo_id) === id).map((e) => ({ tipo: e.tipo, en: e.ocurrido_en, quien: e.quien })),
    };
  });
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
      const valor = valorDe(nombre);
      hoja = ponerTexto(hoja, `C${fila}`, valor.encendido);
      hoja = ponerTexto(hoja, `D${fila}`, valor.apagado);
      hoja = ponerTexto(hoja, `E${fila}`, valor.inicioJornada);
      hoja = ponerTexto(hoja, `F${fila}`, valor.finJornada);
      if (valor.observacion) hoja = ponerTexto(hoja, `G${fila}`, valor.observacion);
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
  const equipos = await leerEquipos(ctx, desde, hasta, zona);
  const libro = await armarLibro(fechaTitulo(fecha), (nombre) => {
    const persona = buscarPersona(nombre, equipos);
    return persona ? horasDelDia(persona, desde, hasta, zona) : VACIO;
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
