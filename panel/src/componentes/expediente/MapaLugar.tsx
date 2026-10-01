import { useEffect, useRef, useState } from 'react';
import { Marker } from 'maplibre-gl';
import type { Map as TipoMapa } from 'maplibre-gl';
import MapaBase from '@/componentes/mapa/MapaBase';

export interface PuntoMapa {
  latitud: number;
  longitud: number;
  color: string;
}

// Mapa pequeño con un único marcador que se recentra al cambiar el punto.
export function MapaLugar({ punto, className }: { punto: PuntoMapa | null; className?: string }) {
  const [mapa, setMapa] = useState<TipoMapa | null>(null);
  const marcador = useRef<Marker | null>(null);

  useEffect(() => {
    if (!mapa || !punto) {
      marcador.current?.remove();
      marcador.current = null;
      return;
    }
    const centro: [number, number] = [punto.longitud, punto.latitud];
    if (!marcador.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:18px;height:18px;border-radius:9999px;border:3px solid #fff;box-shadow:0 1px 6px rgba(12,31,61,.5)';
      el.style.background = punto.color;
      marcador.current = new Marker({ element: el, anchor: 'center' }).setLngLat(centro).addTo(mapa);
    } else {
      marcador.current.setLngLat(centro);
      marcador.current.getElement().style.background = punto.color;
    }
    mapa.jumpTo({ center: centro, zoom: 16 });
  }, [mapa, punto]);

  useEffect(
    () => () => {
      marcador.current?.remove();
      marcador.current = null;
    },
    [],
  );

  return <MapaBase clase={className ?? 'h-72 w-full'} alListo={setMapa} zoom={14} />;
}
