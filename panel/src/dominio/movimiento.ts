// Movimiento de los marcadores en vivo. El marcador no persigue el último
// punto (arrancaba y frenaba con cada uno): reproduce el recorrido con las
// horas del teléfono, un poco atrasado, como un video con búfer. Así va a la
// velocidad real aunque los puntos lleguen a destiempo o en lotes.

export interface Muestra {
  t: number;
  lon: number;
  lat: number;
}

// `desfase`: cuánto va atrasada la reproducción respecto al reloj del navegador.
export interface Pista {
  muestras: Muestra[];
  desfase: number;
}

// Un tramo nunca tarda más que esto en recorrerse: quieto llega un punto cada
// varios minutos y no tiene sentido mover el marcador durante todo ese rato.
const TRAMO_MAX_MS = 15_000;
// Atraso máximo respecto al último punto recibido (lotes grandes).
const ATRASO_MAX_MS = 20_000;

export function nuevaPista(muestra: Muestra, ahora: number): Pista {
  return { muestras: [muestra], desfase: ahora - muestra.t };
}

function metros(a: Muestra, b: Muestra): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

// `minimoM`: por debajo de esa distancia el punto es temblor del GPS y se ignora.
export function agregarMuestra(pista: Pista, muestra: Muestra, ahora: number, minimoM: number): void {
  const ultima = pista.muestras[pista.muestras.length - 1];
  if (muestra.t <= ultima.t || metros(ultima, muestra) < minimoM) return;
  // Un hueco largo se acorta adelantando todo lo anterior.
  const sobra = muestra.t - ultima.t - TRAMO_MAX_MS;
  if (sobra > 0) {
    for (const m of pista.muestras) m.t += sobra;
    pista.desfase -= sobra;
  }
  const reproducido = ahora - pista.desfase;
  if (reproducido >= ultima.t) {
    // Ya esperaba en el último punto: el tramo nuevo empieza ahora, desde ahí.
    pista.muestras = [ultima, muestra];
    pista.desfase = ahora - ultima.t;
    return;
  }
  pista.muestras.push(muestra);
  if (muestra.t - reproducido > ATRASO_MAX_MS) pista.desfase = ahora - (muestra.t - ATRASO_MAX_MS);
}

export function posicionEn(pista: Pista, ahora: number): [number, number] {
  const t = ahora - pista.desfase;
  const ms = pista.muestras;
  while (ms.length > 2 && ms[1].t <= t) ms.shift();
  const [a, b] = ms;
  if (!b || t <= a.t) return [a.lon, a.lat];
  if (t >= b.t) return [b.lon, b.lat];
  const k = (t - a.t) / (b.t - a.t);
  return [a.lon + (b.lon - a.lon) * k, a.lat + (b.lat - a.lat) * k];
}

export function enReposo(pista: Pista, ahora: number): boolean {
  return ahora - pista.desfase >= pista.muestras[pista.muestras.length - 1].t;
}
