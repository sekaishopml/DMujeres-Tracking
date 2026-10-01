// Utilidades HTTP sin dependencias: respuestas, cuerpo JSON, paginacion,
// rangos de fecha ISO y ordenamiento por campos del contrato.

import { datosInvalidos } from './errores.js';

export const TAMANO_MAXIMO_PAGINA = 200;
export const TAMANO_POR_DEFECTO = 25;

export function respuestaJson(res, estado, cuerpo, cabeceras = {}) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...cabeceras,
  });
  res.end(texto);
}

export function respuestaSinContenido(res, cabeceras = {}) {
  res.writeHead(204, { 'Cache-Control': 'no-store', ...cabeceras });
  res.end();
}

export function leerCuerpoJson(req, limiteBytes = 65536) {
  return new Promise((resolver, rechazar) => {
    const trozos = [];
    let tamanio = 0;
    req.on('data', (trozo) => {
      tamanio += trozo.length;
      if (tamanio > limiteBytes) {
        rechazar(datosInvalidos('El cuerpo de la petición es demasiado grande.'));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => {
      const texto = Buffer.concat(trozos).toString('utf8').trim();
      if (!texto) {
        rechazar(datosInvalidos('El cuerpo de la petición no puede estar vacío.'));
        return;
      }
      try {
        const cuerpo = JSON.parse(texto);
        if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
          rechazar(datosInvalidos('El cuerpo debe ser un objeto JSON.'));
          return;
        }
        resolver(cuerpo);
      } catch {
        rechazar(datosInvalidos('El cuerpo no es JSON válido.'));
      }
    });
    req.on('error', () => rechazar(datosInvalidos('No se pudo leer el cuerpo de la petición.')));
  });
}

export function leerPaginacion(url) {
  const pagina = leerEntero(url.searchParams.get('pagina'), 1, 1, Number.MAX_SAFE_INTEGER, 'pagina');
  const tamano = leerEntero(
    url.searchParams.get('tamano'),
    TAMANO_POR_DEFECTO,
    1,
    TAMANO_MAXIMO_PAGINA,
    'tamano',
  );
  return { pagina, tamano, desplazamiento: (pagina - 1) * tamano };
}

function leerEntero(valor, porDefecto, minimo, maximo, nombre) {
  if (valor === null || valor === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw datosInvalidos(`El parámetro ${nombre} debe ser un entero entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

export function parsearFecha(valor, nombre) {
  const fecha = new Date(valor);
  if (!Number.isFinite(fecha.getTime())) {
    throw datosInvalidos(`El parámetro ${nombre} no es una fecha ISO-8601 válida.`);
  }
  return fecha;
}

export function rangoHoy(zonaHoraria, ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ahora);
  const obtener = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  const anio = obtener('year');
  const mes = obtener('month');
  const dia = obtener('day');
  const inicioIngenuo = new Date(`${anio}-${mes}-${dia}T00:00:00Z`);
  const desplazamiento = desplazamientoZonaMinutos(zonaHoraria, inicioIngenuo);
  const desde = new Date(inicioIngenuo.getTime() - desplazamiento * 60000);
  const hasta = new Date(desde.getTime() + 86400000);
  return { desde, hasta };
}

export function rangoUltimasHoras(horas, ahora = new Date()) {
  return { desde: new Date(ahora.getTime() - horas * 3600000), hasta: ahora };
}

function desplazamientoZonaMinutos(zonaHoraria, instante) {
  const formato = new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria, timeZoneName: 'longOffset' });
  const nombre = formato.formatToParts(instante).find((parte) => parte.type === 'timeZoneName')?.value ?? 'GMT';
  const coincidencia = /GMT([+-])(\d{2}):?(\d{2})?/.exec(nombre);
  if (!coincidencia) return 0;
  const signo = coincidencia[1] === '-' ? -1 : 1;
  const horas = Number(coincidencia[2] ?? 0);
  const minutos = Number(coincidencia[3] ?? 0);
  return signo * (horas * 60 + minutos);
}

export function leerRango(url, opciones) {
  const { porDefecto = null, maxDias = 31, zonaHoraria = 'UTC' } = opciones ?? {};
  const valorDesde = url.searchParams.get('desde');
  const valorHasta = url.searchParams.get('hasta');
  let desde = null;
  let hasta = null;
  if (valorDesde) desde = parsearFecha(valorDesde, 'desde');
  if (valorHasta) hasta = parsearFecha(valorHasta, 'hasta');
  if (!desde && !hasta && porDefecto === 'hoy') {
    const rango = rangoHoy(zonaHoraria);
    desde = rango.desde;
    hasta = rango.hasta;
  } else if (!desde && !hasta && porDefecto === 'ultimas24h') {
    const rango = rangoUltimasHoras(24);
    desde = rango.desde;
    hasta = rango.hasta;
  }
  if (desde && !hasta) throw datosInvalidos('Falta el parámetro hasta.');
  if (hasta && !desde) throw datosInvalidos('Falta el parámetro desde.');
  if (desde && hasta) {
    if (desde.getTime() >= hasta.getTime()) {
      throw datosInvalidos('El parámetro desde debe ser anterior a hasta.');
    }
    const dias = (hasta.getTime() - desde.getTime()) / 86400000;
    if (dias > maxDias) {
      throw datosInvalidos(`La ventana no puede superar ${maxDias} días; cargue por tramos.`);
    }
  }
  return { desde, hasta };
}

export function leerOrden(url, campos, porDefecto) {
  const valor = url.searchParams.get('orden');
  if (!valor) return { sql: porDefecto, campo: porDefecto };
  const descendente = valor.startsWith('-');
  const campo = descendente ? valor.slice(1) : valor;
  const columna = campos[campo];
  if (!columna) {
    throw datosInvalidos(`El campo de orden ${campo} no es válido.`);
  }
  return { sql: `${columna}${descendente ? ' DESC' : ' ASC'}`, campo };
}
