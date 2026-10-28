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
  milisegundos,
} from '@/dominio/replay';
import type { Parada } from '@/dominio/replay';
import {
  aislarDelMapa,
  indiceCercano,
} from './reproductorComun';
import {
  useReproductor,
} from './contextoReproductor';

// Insignias numeradas de las paradas sobre el mapa. Se crean de nuevo solo al
// cambiar de recorrido; al elegir otra parada solo cambia cuál está activa.
// Tocar una insignia hace lo mismo que tocar su fila: pausa, ubica el reloj,
// resalta la parada y lleva el mapa hasta ella.
export function InsigniasParadas({ mapa, paradas }: { mapa: TipoMapa | null; paradas: Parada[] }) {
  const { paradaSeleccionada, seleccionarParada, cerrarParada, microparadas, resumen, posiciones } = useReproductor();
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
      elemento.dataset.parada = String(orden);
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
        const indice = posiciones.length > 0 ? indiceCercano(posiciones, milisegundos(parada.inicio)) : null;
        const fix = indice == null ? null : posiciones[indice];
        hover.entrar(
          globoDePunto(`Parada ${orden + 1} · ${duracion(parada.duracionMin * 60)}`, [
            { etiqueta: nombre, valor: `${horaCorta(parada.inicio)} – ${horaCorta(parada.fin)}` },
            ...(fix ? [{ etiqueta: 'Batería', valor: bateria(fix.bateriaPct) }] : []),
            ...(parada.direccion ? [{ etiqueta: 'Dirección', valor: parada.direccion }] : []),
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
  // dirección), con apertura suave sobre la insignia. Queda abierta hasta un
  // clic en otro lado del mapa (o al elegir otro punto o parada); arrastrar el
  // mapa no la cierra.
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
    // Compacta: horas y batería en una línea, la dirección debajo.
    const fixParada = posiciones.length > 0 ? indiceCercano(posiciones, milisegundos(parada.inicio)) : null;
    const horas = document.createElement('p');
    horas.className = 'ficha-parada-horas';
    const bat = document.createElement('span');
    bat.textContent = ` · Batería ${fixParada == null ? GUION : bateria(posiciones[fixParada].bateriaPct)}`;
    horas.append(`${horaCorta(parada.inicio)} – ${horaCorta(parada.fin)}`, bat);
    const direccion = document.createElement('p');
    direccion.className = 'ficha-parada-direccion';
    direccion.textContent = parada.direccion || 'Buscando dirección…';
    contenido.append(titulo, horas, direccion);
    let vigente = true;
    if (!parada.direccion) {
      traerDireccion(parada.latitud, parada.longitud, parada.precisionM ?? null)
        .then((r) => {
          if (vigente) direccion.textContent = r.direccion || GUION;
        })
        .catch(() => {
          if (vigente) direccion.textContent = GUION;
        });
    }
    fichaParada.current?.remove();
    fichaParada.current = new Popup({
      anchor: 'bottom',
      offset: 18,
      closeButton: false,
      closeOnClick: false,
      maxWidth: '240px',
      className: 'replay-globo replay-ficha-parada',
    })
      .setLngLat([parada.longitud, parada.latitud])
      .setDOMContent(contenido)
      .addTo(mapa);
    // El vuelo hasta la parada no cuenta: solo lo que hace la persona.
    const cerrar = (evento: { originalEvent?: Event }) => {
      if (evento.originalEvent) cerrarParada();
    };
    mapa.on('click', cerrar);
    return () => {
      vigente = false;
      mapa.off('click', cerrar);
    };
  }, [mapa, paradas, paradaSeleccionada, posiciones, cerrarParada]);
  useEffect(
    () => () => {
      fichaParada.current?.remove();
    },
    [],
  );

  return null;
}
