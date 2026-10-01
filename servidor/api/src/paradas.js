// Paradas por permanencia.
//
// Una parada es el tiempo que la persona se queda dentro de un radio, sin
// importar la velocidad que diga el teléfono (hay teléfonos que siempre dicen
// 0, otros mandan pocos puntos, y la ubicación por antenas repite la misma
// coordenada durante horas).
//
// Se agrupan puntos seguidos mientras estén a RADIO_M o menos del centro
// (mediana) del grupo; si el grupo dura MIN_PARADA_S o más, es parada. Los
// puntos imprecisos no abren ni sostienen una parada por sí solos, pero
// tampoco la cortan si caen cerca. Un hueco sin puntos de más de MAX_HUECO_S
// corta el grupo: ese tiempo no se vio.

export const RADIO_M = 60;
export const MIN_PARADA_S = 120;
export const PRECISION_BUENA_M = 80;
export const MAX_HUECO_S = 30 * 60;
// Núcleo de la parada: los extremos más lejos que esto del centro se recortan.
export const RADIO_NUCLEO_M = 30;
export const MIN_FIXES_BORDE = 3;

function metros(a, b) {
  const dLat = (b.latitud - a.latitud) * 111320;
  const dLon = (b.longitud - a.longitud) * 111320 * Math.cos(((a.latitud + b.latitud) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

function mediana(valores) {
  const orden = [...valores].sort((x, y) => x - y);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

const bueno = (p) => p.precisionM == null || p.precisionM <= PRECISION_BUENA_M;
const ms = (p) => (p.registradoEn instanceof Date ? p.registradoEn.getTime() : new Date(p.registradoEn).getTime());

// puntos: [{ registradoEn, latitud, longitud, precisionM }] de UN equipo,
// ordenados por hora. Devuelve [{ inicio, fin, segundos, latitud, longitud,
// precisionM, fixes }] con inicio/fin como Date.
export function detectarParadas(puntos) {
  const paradas = [];
  let i = 0;
  while (i < puntos.length) {
    if (!bueno(puntos[i])) {
      i += 1;
      continue;
    }
    const buenos = [puntos[i]];
    let centro = { latitud: puntos[i].latitud, longitud: puntos[i].longitud };
    let ultimo = i;
    // Último punto (bueno, o aproximado y cercano) que confirma que sigue ahí:
    // el hueco se mide desde él. Sin jornada la app manda un punto cada 5 a 10
    // min, casi todos de antena, y entre dos buenos pueden pasar más de 30 min.
    let ultimoVisto = i;
    let j = i + 1;
    while (j < puntos.length) {
      const p = puntos[j];
      if ((ms(p) - ms(puntos[ultimoVisto])) / 1000 > MAX_HUECO_S) break;
      const d = metros(centro, p);
      if (bueno(p)) {
        if (d > RADIO_M) break;
        buenos.push(p);
        centro = { latitud: mediana(buenos.map((x) => x.latitud)), longitud: mediana(buenos.map((x) => x.longitud)) };
        ultimo = j;
        ultimoVisto = j;
      } else if (d > RADIO_M + Math.min(p.precisionM ?? 0, 150)) {
        // Un fix aproximado lejísimos sí indica que se fue.
        break;
      } else {
        ultimoVisto = j;
      }
      j += 1;
    }
    // Bordes: llegar o irse caminando despacio cae dentro del radio y se
    // contaba como parada. Los puntos de los extremos a más de RADIO_NUCLEO_M
    // del centro son la llegada o la salida. Solo se recorta un borde con al
    // menos MIN_FIXES_BORDE puntos fuera: uno suelto es ruido.
    const fuera = (k) => !bueno(puntos[k]) || metros(centro, puntos[k]) > RADIO_NUCLEO_M;
    let primero = i;
    let k = i;
    while (k < ultimo && fuera(k)) k += 1;
    if (puntos.slice(i, k).filter(bueno).length >= MIN_FIXES_BORDE) primero = k;
    k = ultimo;
    while (k > primero && fuera(k)) k -= 1;
    if (puntos.slice(k + 1, ultimo + 1).filter(bueno).length >= MIN_FIXES_BORDE) ultimo = k;
    const nucleo = puntos.slice(primero, ultimo + 1).filter(bueno);
    const segundos = (ms(puntos[ultimo]) - ms(puntos[primero])) / 1000;
    if (segundos >= MIN_PARADA_S && nucleo.length >= 2) {
      paradas.push({
        inicio: new Date(ms(puntos[primero])),
        fin: new Date(ms(puntos[ultimo])),
        segundos,
        latitud: centro.latitud,
        longitud: centro.longitud,
        precisionM: mediana(nucleo.map((x) => x.precisionM ?? 0)),
        fixes: nucleo.length,
      });
      i = ultimo + 1;
    } else {
      i += 1;
    }
  }
  return fusionar(paradas, puntos);
}

// Un fix de deriva suelto fuera del radio partía una estancia en dos
// (18:05-18:35 y 18:36-18:52 en el mismo patio): paradas seguidas en el mismo
// sitio con menos de MAX_PAUSA_FUSION_S entre ellas son una sola.
export const MAX_PAUSA_FUSION_S = 180;

// Dentro de un edificio el GPS se corre 70 a 100 m y una estancia larga
// quedaba partida en varias paradas. Dos paradas seguidas son la misma si:
//  - las separa MAX_PAUSA_ESTANCIA_S o menos,
//  - sus centros están a RADIO_FUSION_M o menos, y
//  - en la pausa no se alejó más de EXCURSION_MAX_M durante MIN_PARADA_S
//    seguidos (un salto suelto del GPS no es una salida).
// Una visita real a otro sitio (2 min o más a más de RADIO_FUSION_M) corta la
// cadena.
export const MAX_PAUSA_ESTANCIA_S = 15 * 60;
export const RADIO_FUSION_M = 100;
export const EXCURSION_MAX_M = 200;

// ¿Salió de verdad durante la pausa? Solo si los puntos buenos se quedan a
// más de EXCURSION_MAX_M del centro durante MIN_PARADA_S seguidos; bajo techo
// el GPS salta 200 m y vuelve en segundos.
function salidaSostenida(puntos, centro, desdeMs, hastaMs) {
  let fueraDesde = null;
  for (const p of puntos) {
    const t = ms(p);
    if (t <= desdeMs || !bueno(p)) continue;
    if (t >= hastaMs) break;
    if (metros(centro, p) > EXCURSION_MAX_M) {
      if (fueraDesde === null) fueraDesde = t;
      if ((t - fueraDesde) / 1000 >= MIN_PARADA_S) return true;
    } else {
      fueraDesde = null;
    }
  }
  return false;
}

function mismaEstancia(previa, parada, puntos) {
  const pausaS = (parada.inicio.getTime() - previa.fin.getTime()) / 1000;
  const distancia = metros(previa, parada);
  if (pausaS <= MAX_PAUSA_FUSION_S && distancia <= RADIO_M) return true;
  if (pausaS > MAX_PAUSA_ESTANCIA_S || distancia > RADIO_FUSION_M) return false;
  return !salidaSostenida(puntos ?? [], previa, previa.fin.getTime(), parada.inicio.getTime());
}

function fusionar(paradas, puntos) {
  const salida = [];
  for (const parada of paradas) {
    const previa = salida[salida.length - 1];
    if (previa && mismaEstancia(previa, parada, puntos)) {
      const fixes = previa.fixes + parada.fixes;
      previa.latitud = (previa.latitud * previa.fixes + parada.latitud * parada.fixes) / fixes;
      previa.longitud = (previa.longitud * previa.fixes + parada.longitud * parada.fixes) / fixes;
      previa.fin = parada.fin;
      previa.segundos = (previa.fin.getTime() - previa.inicio.getTime()) / 1000;
      previa.fixes = fixes;
    } else {
      salida.push({ ...parada });
    }
  }
  return salida;
}
