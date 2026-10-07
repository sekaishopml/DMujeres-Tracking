import { useEffect, useRef } from 'react';
import { Marker, Popup } from 'maplibre-gl';
import type { Map as TipoMapa } from 'maplibre-gl';
import { bateria, duracion, GUION } from '@/dominio/formatoBase';
import { traerDireccion } from '@/dominio/datos';
import { etiquetaVisita } from '@/dominio/dia';
import { globoDePunto, globoHoverDe } from './globos';
import {
  horaCorta,
  duracionCorta,
  indiceMasCercano,
  milisegundos,
} from '@/dominio/replay';
import type { Parada } from '@/dominio/replay';
import {
  aislarDelMapa,
} from './reproductorComun';
import {
  useReproductor,
} from './contextoReproductor';

// Insignias numeradas de las paradas sobre el mapa. Se crean de nuevo solo al
// cambiar de recorrido; al elegir otra parada solo cambia cuál está activa.
// Tocar una insignia hace lo mismo que tocar su fila: pausa, ubica el reloj,
// resalta la parada y lleva el mapa hasta ella.
export function InsigniasParadas({ mapa, paradas }: { mapa: TipoMapa | null; paradas: Parada[] }) {
  const { paradaSeleccionada, seleccionarParada, microparadas, resumen, posiciones } = useReproductor();
  const elementos = useRef<Map<number, HTMLDivElement>>(new Map());

  // Microparadas: punto chico sin número, debajo de las insignias. Pulsarlo
  // ubica el reloj y vuela el mapa hasta él, igual que una parada.
  useEffect(() => {
    if (!mapa) return;
    const marcadores = microparadas.map((micro) => {
      const elemento = document.createElement('div');
      elemento.className = 'marcador-microparada';
      aislarDelMapa(elemento);
      elemento.title = `Microparada: ${horaCorta(micro.inicio)} – ${horaCorta(micro.fin)} (${duracionCorta(micro.duracionS)})`;
      elemento.addEventListener('click', () => {
        seleccionarParada(null, micro.latitud, micro.longitud, milisegundos(micro.inicio));
      });
      return new Marker({ element: elemento, anchor: 'center' }).setLngLat([micro.longitud, micro.latitud]).addTo(mapa);
    });
    return () => {
      for (const marcador of marcadores) marcador.remove();
    };
  }, [mapa, microparadas, seleccionarParada]);

  useEffect(() => {
    if (!mapa) return;
    const almacen = elementos.current;
    const hover = globoHoverDe(mapa);
    const marcadores = paradas.map((parada, orden) => {
      const nombre = etiquetaVisita(resumen?.numeroVisita[orden] ?? null);
      const elemento = document.createElement('div');
      elemento.className = 'marcador-parada';
      elemento.setAttribute('aria-label', `${nombre}: desde ${horaCorta(parada.inicio)} hasta ${horaCorta(parada.fin)}`);
      const insignia = document.createElement('span');
      insignia.className = 'parada-insignia';
      insignia.textContent = String(orden + 1);
      const etiqueta = document.createElement('span');
      etiqueta.className = 'parada-duracion';
      etiqueta.textContent = duracion(parada.duracionMin * 60);
      elemento.append(insignia, etiqueta);
      aislarDelMapa(elemento);
      // Al pasar el cursor, el mismo globo que da la línea (hora y batería del
      // punto) con lo de la parada: qué es, desde y hasta cuándo y su dirección.
      // Al pulsarla se abre la ficha completa y el globo sobra.
      elemento.addEventListener('mouseenter', () => {
        if (elemento.classList.contains('activa')) return;
        const indice = indiceMasCercano(posiciones, parada.longitud, parada.latitud);
        const fix = indice == null ? null : posiciones[indice];
        hover.entrar(
          globoDePunto(`${nombre} · Parada ${orden + 1}`, [
            { etiqueta: 'Desde', valor: horaCorta(parada.inicio) },
            { etiqueta: 'Hasta', valor: horaCorta(parada.fin) },
            { etiqueta: 'Duración', valor: duracion(parada.duracionMin * 60) },
            ...(parada.direccion ? [{ etiqueta: 'Dirección', valor: parada.direccion }] : []),
            ...(fix ? [{ etiqueta: 'Batería', valor: bateria(fix.bateriaPct) }] : []),
          ]),
          [parada.longitud, parada.latitud],
          18,
        );
      });
      elemento.addEventListener('mouseleave', () => hover.salir());
      elemento.addEventListener('click', () => {
        hover.quitar();
        seleccionarParada(orden, parada.latitud, parada.longitud, milisegundos(parada.inicio));
      });
      almacen.set(orden, elemento);
      return new Marker({ element: elemento, anchor: 'center' })
        .setLngLat([parada.longitud, parada.latitud])
        .addTo(mapa);
    });
    return () => {
      for (const marcador of marcadores) marcador.remove();
      hover.quitar();
      almacen.clear();
    };
  }, [mapa, paradas, posiciones, seleccionarParada, resumen]);

  useEffect(() => {
    for (const [orden, elemento] of elementos.current) {
      elemento.classList.toggle('activa', orden === paradaSeleccionada);
    }
  }, [paradas, paradaSeleccionada, resumen]);

  // Ficha desplegable de la parada elegida (desde, hasta, duración y
  // dirección), con apertura suave sobre la insignia. Se cierra al elegir un
  // punto u otra parada.
  const fichaParada = useRef<Popup | null>(null);
  useEffect(() => {
    const parada = paradaSeleccionada != null ? paradas[paradaSeleccionada] : undefined;
    if (!mapa || !parada || paradaSeleccionada == null) {
      fichaParada.current?.remove();
      fichaParada.current = null;
      return;
    }
    const contenido = document.createElement('div');
    contenido.className = 'ficha-parada';
    const titulo = document.createElement('p');
    titulo.className = 'ficha-parada-titulo';
    titulo.textContent = `Parada ${paradaSeleccionada + 1} · ${duracion(parada.duracionMin * 60)}`;
    const fila = (etiqueta: string, valor: string) => {
      const p = document.createElement('p');
      const e = document.createElement('span');
      e.textContent = etiqueta;
      const v = document.createElement('strong');
      v.textContent = valor;
      p.append(e, v);
      return { p, v };
    };
    const desde = fila('Desde', horaCorta(parada.inicio));
    const hasta = fila('Hasta', horaCorta(parada.fin));
    const direccion = fila('Dirección', parada.direccion || 'Buscando…');
    direccion.p.className = 'ficha-parada-direccion';
    const fixParada = indiceMasCercano(posiciones, parada.longitud, parada.latitud);
    const bat = fila('Batería', fixParada == null ? GUION : bateria(posiciones[fixParada].bateriaPct));
    contenido.append(titulo, desde.p, hasta.p, bat.p, direccion.p);
    let vigente = true;
    if (!parada.direccion) {
      traerDireccion(parada.latitud, parada.longitud, parada.precisionM ?? null)
        .then((r) => {
          if (vigente) direccion.v.textContent = r.direccion || GUION;
        })
        .catch(() => {
          if (vigente) direccion.v.textContent = GUION;
        });
    }
    fichaParada.current?.remove();
    fichaParada.current = new Popup({
      anchor: 'bottom',
      offset: 18,
      closeButton: false,
      closeOnClick: false,
      maxWidth: '260px',
      className: 'replay-globo replay-ficha-parada',
    })
      .setLngLat([parada.longitud, parada.latitud])
      .setDOMContent(contenido)
      .addTo(mapa);
    return () => {
      vigente = false;
    };
  }, [mapa, paradas, paradaSeleccionada, posiciones]);
  useEffect(
    () => () => {
      fichaParada.current?.remove();
    },
    [],
  );

  return null;
}
