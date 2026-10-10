import { useEffect, useRef, useState } from 'react';
import { Marker } from 'maplibre-gl';
import type { Map as TipoMapa } from 'maplibre-gl';
import { duracion } from '@/dominio/formatoBase';
import { horaCorta, milisegundos } from '@/dominio/replay';
import { useReproductor } from './contextoReproductor';
import { agruparEnPantalla } from './grupos';
import type { ItemLugar } from './grupos';
import { novedadesDelRecorrido } from './novedades';
import { aislarDelMapa } from './reproductorComun';

interface Fila {
  clave: string;
  lon: number;
  lat: number;
  orden: number;
  tipo: 'inicio' | 'fin' | 'parada' | 'novedad';
  // Etiqueta corta de color, hora y un detalle breve.
  etiqueta: string;
  hora: string;
  detalle: string;
  accion: () => void;
}

// Cuando inicio, fin, paradas o novedades caen en el mismo lugar de la
// pantalla, se listan en una tarjeta con columnas (hora, qué fue, cuánto duró)
// en vez de encimarse. Cada fila lleva al momento que describe.
export function GruposEnLugar({ mapa, enVivo = false }: { mapa: TipoMapa | null; enVivo?: boolean }) {
  const { posiciones, paradas, huecos, dispositivo, seleccionar, seleccionarParada } = useReproductor();
  const esIphone = dispositivo?.plataforma === 'ios';
  const [version, setVersion] = useState(0);
  // Burbuja abierta (sus claves): sigue abierta aunque el mapa se mueva y las
  // burbujas se vuelvan a armar. Se cierra con su X, un clic en otro lado del
  // mapa o al arrastrarlo.
  const abierta = useRef<string | null>(null);
  // Grupos que ya estaban en pantalla: solo los nuevos entran con animación.
  const vistos = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!mapa) return;
    // El vuelo del mapa no cuenta: solo lo que hace la persona.
    const cerrar = (evento: { originalEvent?: Event }) => {
      if (!evento.originalEvent || abierta.current == null) return;
      abierta.current = null;
      for (const e of mapa.getContainer().querySelectorAll('.grupo-lugar.abierto')) e.classList.remove('abierto');
    };
    mapa.on('click', cerrar);
    mapa.on('dragstart', cerrar);
    return () => {
      mapa.off('click', cerrar);
      mapa.off('dragstart', cerrar);
    };
  }, [mapa]);

  useEffect(() => {
    if (!mapa) return;
    const alMover = () => setVersion((v) => v + 1);
    mapa.on('moveend', alMover);
    return () => {
      mapa.off('moveend', alMover);
    };
  }, [mapa]);

  useEffect(() => {
    if (!mapa || posiciones.length === 0) return;
    const filas: Fila[] = [];
    const primera = posiciones[0];
    const ultima = posiciones[posiciones.length - 1];
    filas.push({
      clave: 'inicio',
      lon: primera.longitud,
      lat: primera.latitud,
      orden: milisegundos(primera.registradoEn),
      tipo: 'inicio',
      etiqueta: esIphone ? 'App activada' : 'Inicio',
      hora: horaCorta(primera.registradoEn),
      detalle: '',
      accion: () => seleccionar(0),
    });
    filas.push({
      clave: 'fin',
      lon: ultima.longitud,
      lat: ultima.latitud,
      orden: milisegundos(ultima.registradoEn),
      tipo: 'fin',
      // Con el día en curso todavía no terminó: es solo el último punto.
      etiqueta: enVivo ? 'Último' : esIphone ? 'App desactivada' : 'Fin',
      hora: horaCorta(ultima.registradoEn),
      detalle: '',
      accion: () => seleccionar(posiciones.length - 1),
    });
    paradas.forEach((p, i) => {
      const inicio = milisegundos(p.inicio);
      filas.push({
        clave: `parada-${i}`,
        lon: p.longitud,
        lat: p.latitud,
        orden: inicio,
        tipo: 'parada',
        etiqueta: `Parada ${i + 1}`,
        hora: `${horaCorta(p.inicio)}–${horaCorta(p.fin)}`,
        detalle: duracion(p.duracionMin * 60),
        accion: () => seleccionarParada(i, p.latitud, p.longitud, inicio),
      });
    });
    for (const [i, n] of novedadesDelRecorrido(posiciones, huecos).entries()) {
      const fix = posiciones[n.indice];
      filas.push({
        clave: `novedad-${i}`,
        lon: n.lon,
        lat: n.lat,
        orden: fix ? milisegundos(fix.registradoEn) : 0,
        tipo: 'novedad',
        etiqueta: n.titulo.replace(/ desde aquí| aquí/g, ''),
        hora: n.detalle.split(' · ')[0].replace(' a ', '–'),
        detalle: '',
        accion: () => seleccionar(n.indice),
      });
    }

    const proyectar = (lon: number, lat: number): [number, number] => {
      const punto = mapa.project([lon, lat]);
      return [punto.x, punto.y];
    };
    // Lugares (inicio, fin, paradas) y novedades se agrupan por separado: cada
    // grupo es una burbuja con pico hacia su punto, los lugares a la derecha y
    // las novedades a la izquierda, así no se tapan entre sí.
    const agrupar = (lista: Fila[]) => {
      const porClave = new Map(lista.map((f) => [f.clave, f]));
      const items: ItemLugar[] = lista.map((f) => ({ clave: f.clave, lon: f.lon, lat: f.lat, orden: f.orden }));
      return agruparEnPantalla(items, proyectar).map((grupo) => grupo.map((g) => porClave.get(g.clave)!));
    };
    const gruposLugar = agrupar(filas.filter((f) => f.tipo !== 'novedad'));
    const gruposNovedad = agrupar(filas.filter((f) => f.tipo === 'novedad'));
    const alternar = (clave: string, tarjeta: HTMLElement) => {
      const abrir = abierta.current !== clave;
      for (const e of mapa.getContainer().querySelectorAll('.grupo-lugar.abierto')) e.classList.remove('abierto');
      abierta.current = abrir ? clave : null;
      if (abrir) tarjeta.classList.add('abierto');
    };
    const ahora = new Set<string>();
    const crear = (miembros: Fila[], lado: 'derecha' | 'izquierda', texto: string) => {
      const clave = miembros.map((f) => f.clave).join('|');
      const marcador = burbuja(mapa, miembros, lado, texto, abierta.current === clave, (tarjeta) => alternar(clave, tarjeta));
      if (!vistos.current.has(clave)) marcador.getElement().classList.add('nace');
      ahora.add(clave);
      return marcador;
    };
    const marcadores = [
      ...gruposLugar.map((miembros) => crear(miembros, 'derecha', String(miembros.length))),
      ...gruposNovedad.map((miembros) => crear(miembros, 'izquierda', `! ${miembros.length}`)),
    ];
    vistos.current = ahora;
    // Lo que ya está en una burbuja no se repite suelto (etiqueta de inicio o
    // fin, insignia de parada, "!" de novedad). Va como regla de estilo: sigue
    // valiendo aunque esos marcadores se vuelvan a dibujar.
    const selector = (clave: string) => {
      if (clave === 'inicio' || clave === 'fin') return `.marcador-extremo.${clave}`;
      const [tipo, i] = clave.split('-');
      return tipo === 'parada' ? `.marcador-parada[data-parada="${i}"]` : `.marcador-novedad-pin[data-novedad="${i}"]`;
    };
    // Cada marcador agrupado viaja hasta su burbuja y se desvanece; al
    // separarse el grupo (más zoom) vuelve a su lugar desde ahí, como gotas
    // que se sueltan. El movimiento lo hace la transición de replay.css.
    const reglas: string[] = [];
    for (const miembros of [...gruposLugar, ...gruposNovedad]) {
      const [gx, gy] = proyectar(
        miembros.reduce((t, f) => t + f.lon, 0) / miembros.length,
        miembros.reduce((t, f) => t + f.lat, 0) / miembros.length,
      );
      miembros.forEach((f, i) => {
        const [x, y] = proyectar(f.lon, f.lat);
        const quien = selector(f.clave);
        reglas.push(
          `${quien} { translate: ${Math.round(gx - x)}px ${Math.round(gy - y)}px; opacity: 0 !important; pointer-events: none; transition-delay: ${i * 45}ms; }`,
          `${quien} > * { scale: 0.3; transition-delay: ${i * 45}ms; }`,
        );
      });
    }
    const estilo = document.createElement('style');
    estilo.textContent = reglas.join('\n');
    document.head.append(estilo);
    return () => {
      for (const marcador of marcadores) marcador.remove();
      estilo.remove();
    };
  }, [mapa, posiciones, paradas, huecos, esIphone, enVivo, seleccionar, seleccionarParada, version]);

  return null;
}

function burbuja(
  mapa: TipoMapa,
  miembros: Fila[],
  lado: 'derecha' | 'izquierda',
  texto: string,
  abierta: boolean,
  alternar: (tarjeta: HTMLElement) => void,
): Marker {
  const lon = miembros.reduce((s, f) => s + f.lon, 0) / miembros.length;
  const lat = miembros.reduce((s, f) => s + f.lat, 0) / miembros.length;
  const tarjeta = document.createElement('div');
  // Ya abierta al volver a armarse: entra sin animación (no hay estado previo).
  tarjeta.className = `grupo-lugar burbuja-${lado}${abierta ? ' abierto' : ''}`;
  aislarDelMapa(tarjeta);
  const cabecera = document.createElement('div');
  cabecera.className = 'grupo-lugar-cabecera';
  const titulo = document.createElement('button');
  titulo.type = 'button';
  titulo.className = 'grupo-lugar-titulo';
  titulo.textContent = texto;
  for (const fila of miembros) {
    const punto = document.createElement('i');
    punto.className = `grupo-punto ${fila.tipo}`;
    titulo.append(punto);
  }
  titulo.addEventListener('click', () => alternar(tarjeta));
  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.className = 'grupo-cerrar';
  cerrar.setAttribute('aria-label', 'Cerrar');
  cerrar.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  cerrar.addEventListener('click', () => alternar(tarjeta));
  cabecera.append(titulo, cerrar);
  const lista = document.createElement('div');
  lista.className = 'grupo-lugar-filas';
  const dentro = document.createElement('div');
  dentro.className = 'grupo-lugar-filas-dentro';
  lista.append(dentro);
  for (const fila of miembros) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'grupo-lugar-fila';
    const etiqueta = document.createElement('span');
    etiqueta.className = `grupo-etiqueta ${fila.tipo}`;
    etiqueta.textContent = fila.etiqueta;
    const hora = document.createElement('span');
    hora.className = 'grupo-hora';
    hora.textContent = fila.hora;
    boton.append(etiqueta, hora);
    if (fila.detalle) {
      const detalle = document.createElement('span');
      detalle.className = 'grupo-detalle';
      detalle.textContent = fila.detalle;
      boton.append(detalle);
    }
    boton.addEventListener('click', () => fila.accion());
    dentro.append(boton);
  }
  tarjeta.append(cabecera, lista);
  // La esquina de abajo (con el pico) queda sobre el punto.
  const derecha = lado === 'derecha';
  return new Marker({ element: tarjeta, anchor: derecha ? 'bottom-left' : 'bottom-right', offset: [derecha ? 10 : -10, -2] })
    .setLngLat([lon, lat])
    .addTo(mapa);
}
