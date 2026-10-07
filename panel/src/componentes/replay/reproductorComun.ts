import type { Map as TipoMapa } from 'maplibre-gl';
import type { ChartOptions } from 'chart.js';
import type { Posicion } from '@contratos';
import { GUION } from '@/dominio/formatoBase';
import type { Vertice } from './flechas';
import {
  milisegundos,
} from '@/dominio/replay';
import type { EstadoUnidad, Microparada, Parada } from '@/dominio/replay';

// Constantes y ayudas que comparten las piezas del reproductor.

export const SIN_PARADAS: Parada[] = [];
export const SIN_LINEAS: Vertice[][] = [];
export const HORA_SEGUNDOS = new Intl.DateTimeFormat('es-EC', {
  timeZone: 'America/Guayaquil',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export function horaConSegundos(valor: string): string {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? GUION : HORA_SEGUNDOS.format(d);
}
// Deben coincidir con --eje-bateria y --eje-velocidad de replay.css.
export const ANCHO_EJE_BATERIA_PX = 42;
export const ANCHO_EJE_VELOCIDAD_PX = 58;
export const SIN_MICROPARADAS: Microparada[] = [];
export const VELOCIDADES = [1, 2, 4, 6, 8, 16];

// El marcador se mueve en cada cuadro, pero el resto (gráfico, barra, lectura)
// se actualiza 5 veces por segundo: redibujar el gráfico a 60 Hz con miles de
// puntos pesa mucho y no se nota la diferencia. El reloj sigue igual porque
// vive en instanteRef.
export const INTERVALO_PINTADO_MS = 200;

// Al elegir una parada el mapa vuela a zoom de ciudad (15-16) en unos 900 ms.
// Si ya está más cerca, no se aleja. Con movimiento reducido, salta directo.
export const ZOOM_PARADA_MIN = 15;
export const ZOOM_PARADA_MAX = 16;
export const DURACION_VUELO_PARADA_MS = 900;
export const CURVA_VUELO_PARADA = 1.42;

// Fix más próximo en el tiempo al instante dado (posiciones en orden).
export function indiceCercano(posiciones: Posicion[], instante: number): number {
  let bajo = 0;
  let alto = posiciones.length - 1;
  while (bajo < alto) {
    const medio = (bajo + alto) >> 1;
    if (milisegundos(posiciones[medio].registradoEn) < instante) bajo = medio + 1;
    else alto = medio;
  }
  if (bajo > 0 && instante - milisegundos(posiciones[bajo - 1].registradoEn) < milisegundos(posiciones[bajo].registradoEn) - instante) {
    return bajo - 1;
  }
  return bajo;
}

// Cuánto hay que correr el centro del mapa para que lo elegido quede en la parte
// que no tapan el panel lateral ni la franja de abajo.
export function desplazamientoVisible(mapa: TipoMapa): [number, number] {
  const lienzo = mapa.getContainer().getBoundingClientRect();
  let izquierda = lienzo.left;
  let abajo = lienzo.bottom;
  const panel = document.querySelector('.replay-panel:not(.colapsado)')?.getBoundingClientRect();
  if (panel && panel.right > lienzo.left && panel.width < lienzo.width / 2) izquierda = panel.right;
  const franja = document.querySelector('.replay-timeline')?.getBoundingClientRect();
  if (franja && franja.top > lienzo.top + lienzo.height / 2 && franja.top < lienzo.bottom) abajo = franja.top;
  return [(izquierda + lienzo.right) / 2 - (lienzo.left + lienzo.right) / 2, (lienzo.top + abajo) / 2 - (lienzo.top + lienzo.bottom) / 2];
}

// La ficha de una parada se abre encima de ella: la parada queda un poco por
// debajo del centro visible para que la ficha quepa entera.
export const ALTO_FICHA_PARADA_PX = 150;

// Los marcadores (paradas, microparadas, cortes) van sobre la línea del mapa: si
// el clic sigue de largo, el mapa lo toma también como un clic en la línea y
// elige un punto suelto, que deshace la parada recién elegida. Por eso se
// cortan aquí los eventos antes de que lleguen al mapa.
export function aislarDelMapa(elemento: HTMLElement): void {
  for (const tipo of ['mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'pointerdown', 'pointerup']) {
    elemento.addEventListener(tipo, (evento) => evento.stopPropagation());
  }
}

export function movimientoReducido(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Velocidad base: la ruta completa se recorre en unos 150 s a 1×, con un
// mínimo de 1× y un máximo de 120×, para que una ruta larga no sea eterna ni
// una de varios días un parpadeo.
export const FACTOR_MINIMO = 1;
export const FACTOR_MAXIMO = 120;
// Cada cuánto se actualiza la guía del recorrido al reproducir.
export const INTERVALO_GUIA_MS = 0;
// Opacidad de la parte del recorrido que todavía no se reproduce.
export const OPACIDAD_POR_RECORRER = 0.22;
// Un corte lleva etiqueta en el mapa si dejó un salto de al menos esto, y se
// rotulan como mucho los primeros de la lista para no llenar el mapa.
export const SALTO_ETIQUETA_M = 150;
export const MAX_ETIQUETAS_CORTE = 12;
// Cuánto más rápido corre el reloj dentro de una parada o un corte de señal.
export const FACTOR_ESPERA = 24;
export const SEGUNDOS_OBJETIVO = 150;

export function factorBase(posiciones: Posicion[]): number {
  if (posiciones.length < 2) return FACTOR_MINIMO;
  const duracionMs =
    milisegundos(posiciones[posiciones.length - 1].registradoEn) - milisegundos(posiciones[0].registradoEn);
  if (!(duracionMs > 0)) return FACTOR_MINIMO;
  const factor = duracionMs / (SEGUNDOS_OBJETIVO * 1000);
  return Math.min(Math.max(factor, FACTOR_MINIMO), FACTOR_MAXIMO);
}

// Color del marcador según el estado del punto (reemplaza el azul de base).
export const CLASE_ESTADO: Record<EstadoUnidad, string> = {
  movimiento: 'estado-movimiento',
  detencion: 'estado-detencion',
  sinSenal: 'estado-sin-senal',
};

// Etiqueta legible del estado del fix para la ficha del punto seleccionado.
export const ETIQUETA_ESTADO_PUNTO: Record<EstadoUnidad, string> = {
  movimiento: 'En movimiento',
  detencion: 'Detenido',
  sinSenal: 'Sin señal',
};

// Línea fina, sin puntos, relleno suave y sin ejes: la batería acompaña al
// recorrido. El eje Y fijo de 0 a 100 deja la misma escala en todos los
// equipos.
export const OPCIONES_BATERIA: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  // El valor bajo el cursor se muestra con una etiqueta propia (HTML): el
  // tooltip de Chart.js se recorta dentro de un lienzo de 36 px de alto.
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: { enabled: false },
  },
  scales: {
    x: { display: false },
    y: { display: false, min: 0, max: 100 },
  },
  elements: {
    line: { borderWidth: 1.5 },
    point: { radius: 0 },
  },
};
