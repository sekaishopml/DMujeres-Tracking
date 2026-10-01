// Limpia puntos imposibles antes de dibujar la Repetición de ruta. La base no
// se toca: solo se apartan del trazo, de las distancias y de la
// reconstrucción, y la respuesta dice cuántos y por qué.
//
//  - FUERA_DE_ZONA: puntos lejos del área de trabajo (37.422,-122.084 es la
//    ubicación por defecto de un emulador; un solo punto así sumaba 6.400 km).
//  - SALTO: ir y volver a más de 180 km/h. Pasa cuando dos teléfonos reportan
//    con la misma cuenta y los puntos alternan entre dos sitios. Se conserva
//    la secuencia coherente y, si se repite, se avisa.

import { LAT_MAX_OP, LAT_MIN_OP, LON_MAX_OP, LON_MIN_OP } from './segmentos.js';
import { VELOCIDAD_IMPOSIBLE_KMH, distanciaKm } from './geo.js';

// Saltos de más de 2 km repetidos 3 o más veces: no es error del GPS (que es
// de decenas o cientos de metros), son dos equipos alternando.
const SALTO_ORIGEN_MULTIPLE_KM = 2;
const MIN_SALTOS_ORIGEN_MULTIPLE = 3;

function enZona(p) {
  return (
    Number.isFinite(p.latitud) && Number.isFinite(p.longitud)
    && p.latitud >= LAT_MIN_OP && p.latitud <= LAT_MAX_OP
    && p.longitud >= LON_MIN_OP && p.longitud <= LON_MAX_OP
  );
}

function velocidadKmh(a, b) {
  const km = distanciaKm(a.latitud, a.longitud, b.latitud, b.longitud);
  const horas = (new Date(b.registradoEn).getTime() - new Date(a.registradoEn).getTime()) / 3600000;
  if (!(horas > 0)) return km > 0.05 ? Infinity : 0;
  return km / horas;
}

export function depurarPosiciones(posiciones) {
  const enArea = [];
  let fueraDeZona = 0;
  for (const p of posiciones) {
    if (enZona(p)) enArea.push(p);
    else fueraDeZona += 1;
  }
  const conservadas = [];
  let saltos = 0;
  let saltosLargos = 0;
  for (let i = 0; i < enArea.length; i += 1) {
    const actual = enArea[i];
    const anterior = conservadas[conservadas.length - 1];
    const siguiente = enArea[i + 1];
    if (anterior && siguiente) {
      const ida = velocidadKmh(anterior, actual);
      const vuelta = velocidadKmh(actual, siguiente);
      const directo = velocidadKmh(anterior, siguiente);
      if (ida > VELOCIDAD_IMPOSIBLE_KMH && vuelta > VELOCIDAD_IMPOSIBLE_KMH && directo <= VELOCIDAD_IMPOSIBLE_KMH) {
        saltos += 1;
        if (distanciaKm(anterior.latitud, anterior.longitud, actual.latitud, actual.longitud) > SALTO_ORIGEN_MULTIPLE_KM) {
          saltosLargos += 1;
        }
        continue;
      }
    }
    conservadas.push(actual);
  }
  return {
    conservadas,
    calidad: {
      descartadasFueraDeZona: fueraDeZona,
      descartadasSalto: saltos,
      posibleOrigenMultiple: saltosLargos >= MIN_SALTOS_ORIGEN_MULTIPLE,
    },
  };
}
