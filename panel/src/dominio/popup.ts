import type { Dispositivo, Posicion } from '@contratos';
import { bateria, hace, velocidad, GUION } from './formatoBase';
import { claveEstado, etiquetaEstado } from './estado';

// El popup se arma con DOM y textContent: el contenido viene de la API y no
// debe interpretarse como HTML.
export function contenidoPopup(dispositivo: Dispositivo, posicion: Posicion): HTMLElement {
  const caja = document.createElement('div');
  caja.className = 'popup-equipo';

  const titulo = document.createElement('strong');
  titulo.textContent = dispositivo.nombre;
  caja.append(titulo);

  const estado = document.createElement('span');
  estado.className = `chip ${claveEstado(dispositivo)}`;
  estado.textContent = etiquetaEstado(dispositivo);
  caja.append(estado);

  const filas: Array<[string, string]> = [
    ['Batería', bateria(dispositivo.bateriaPct ?? posicion.bateriaPct)],
    ['Velocidad', velocidad(posicion.velocidadKmh)],
    ['Precisión', posicion.precisionM == null ? GUION : `${Math.round(posicion.precisionM)} m`],
    ['Última posición', hace(posicion.registradoEn)],
  ];
  const lista = document.createElement('dl');
  for (const [etiqueta, valor] of filas) {
    const termino = document.createElement('dt');
    termino.textContent = etiqueta;
    const definicion = document.createElement('dd');
    definicion.textContent = valor;
    lista.append(termino, definicion);
  }
  caja.append(lista);
  return caja;
}
