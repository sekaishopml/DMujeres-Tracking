import { Popup } from 'maplibre-gl';
import type { Map } from 'maplibre-gl';
import type { Posicion } from '@contratos';
import { distanciaM } from '@/dominio/dia';
import { bateria, duracion } from '@/dominio/formatoBase';
import { horaCorta, milisegundos } from '@/dominio/replay';

// Globos del mapa al pasar el cursor. Se arman con DOM y textContent: el
// contenido viene de la API y no debe interpretarse como HTML.

// Globo que sigue al cursor sin quitarle el clic al mapa. Sin ancla fija: el
// mapa lo pone arriba, abajo o al costado según donde quepa entero.
export function nuevoGlobo(): Popup {
  return new Popup({
    offset: 12,
    closeButton: false,
    closeOnClick: false,
    closeOnMove: false,
    maxWidth: '280px',
    className: 'replay-globo replay-globo-cursor',
  });
}

export interface FilaGlobo {
  etiqueta: string;
  valor: string;
}

export function globoDePunto(titulo: string, filas: FilaGlobo[], nota?: string): HTMLElement {
  const contenido = document.createElement('div');
  contenido.className = 'globo-fix';
  const cabecera = document.createElement('p');
  cabecera.className = 'globo-titulo';
  cabecera.textContent = titulo;
  contenido.append(cabecera);
  for (const { etiqueta, valor } of filas) {
    const fila = document.createElement('p');
    const e = document.createElement('span');
    e.textContent = etiqueta;
    const v = document.createElement('strong');
    v.textContent = valor;
    fila.append(e, v);
    contenido.append(fila);
  }
  if (nota) {
    const pie = document.createElement('p');
    pie.className = 'globo-nota';
    pie.textContent = nota;
    contenido.append(pie);
  }
  return contenido;
}

// Lo que se sabe de un corte de señal: entre qué horas, cuánto duró, cuánto se
// movió entre el último punto visto y el siguiente, y la batería de los dos.
export function globoDeCorte(antes: Posicion, despues: Posicion): HTMLElement {
  const segundos = (milisegundos(despues.registradoEn) - milisegundos(antes.registradoEn)) / 1000;
  const km = distanciaM(antes, despues) / 1000;
  return globoDePunto(
    'Sin señal',
    [
      { etiqueta: 'Desde', valor: horaCorta(antes.registradoEn) },
      { etiqueta: 'Hasta', valor: horaCorta(despues.registradoEn) },
      { etiqueta: 'Duración', valor: duracion(segundos) },
      { etiqueta: 'Se movió', valor: km < 0.1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km` },
      { etiqueta: 'Batería', valor: `${bateria(antes.bateriaPct)} → ${bateria(despues.bateriaPct)}` },
    ],
    'La línea de guiones une dos puntos: lo de en medio no se vio.',
  );
}

// Un solo globo por mapa para todo lo que sale al pasar el cursor (la línea,
// una parada, un corte): así dos globos nunca se turnan abriendo y cerrando, y
// al salir de un elemento hay una pequeña espera por si el cursor entra en el
// vecino.
export interface GloboHover {
  // Verdadero mientras el cursor está sobre una parada o un corte: la línea del
  // mapa que pasa por debajo no debe quitarle el globo.
  ocupado: boolean;
  mostrar: (contenido: HTMLElement, lugar: [number, number], separacion?: number) => void;
  entrar: (contenido: HTMLElement, lugar: [number, number], separacion?: number) => void;
  salir: () => void;
  ocultar: () => void;
  quitar: () => void;
}

const globosPorMapa = new WeakMap<object, GloboHover>();
const ESPERA_OCULTAR_MS = 140;

export function globoHoverDe(mapa: Map): GloboHover {
  const existente = globosPorMapa.get(mapa);
  if (existente) return existente;
  const popup = nuevoGlobo();
  let temporizador: number | undefined;
  const hover: GloboHover = {
    ocupado: false,
    entrar(contenido, lugar, separacion) {
      hover.ocupado = true;
      hover.mostrar(contenido, lugar, separacion);
    },
    salir() {
      hover.ocupado = false;
      hover.ocultar();
    },
    mostrar(contenido, lugar, separacion = 12) {
      window.clearTimeout(temporizador);
      popup.setLngLat(lugar).setOffset(separacion).setDOMContent(contenido).addTo(mapa);
    },
    ocultar() {
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(() => popup.remove(), ESPERA_OCULTAR_MS);
    },
    quitar() {
      hover.ocupado = false;
      window.clearTimeout(temporizador);
      popup.remove();
    },
  };
  globosPorMapa.set(mapa, hover);
  return hover;
}
