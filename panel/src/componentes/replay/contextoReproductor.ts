import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Dispositivo, Hueco, Posicion } from '@contratos';
import { traerDireccion } from '@/dominio/datos';
import type { ResumenDia } from '@/dominio/dia';
import type { EstadoUnidad, Microparada, Parada, TramoReconstruido } from '@/dominio/replay';

// Estado que el reproductor comparte con sus piezas (lista, pista, controles).

export interface Reproductor {
  finRangoMs: number | null;
  paradas: Parada[];
  microparadas: Microparada[];
  resumen: ResumenDia | null;
  // Al reproducir, las paradas y los cortes de señal pasan rápido: solo se ve
  // el recorrido.
  saltarEsperas: boolean;
  alternarSaltarEsperas: () => void;
  // Lleva el reloj al inicio de la parada anterior o siguiente.
  irAParada: (direccion: 1 | -1) => void;
  posiciones: Posicion[];
  huecos: Hueco[];
  reconstruidos: TramoReconstruido[];
  dispositivo: Dispositivo | null;
  indice: number;
  punto: Posicion | null;
  // Estado del fix en curso (movimiento, detenido, sin señal).
  estado: EstadoUnidad;
  reproduciendo: boolean;
  velocidad: number;
  seguir: boolean;
  seleccionado: number | null;
  // Parada elegida en la lista o en su insignia del mapa: la fila y la
  // insignia se resaltan juntas.
  paradaSeleccionada: number | null;
  // La barra de tiempo no la controla React: el reproductor escribe su valor y
  // su relleno en cada cuadro, así el avance se ve continuo.
  sliderRef: RefObject<HTMLInputElement | null>;
  alternar: () => void;
  alternarSeguir: () => void;
  // Paso a paso por el recorrido: ±1 punto reproducible por pulsación.
  moverPunto: (direccion: 1 | -1) => void;
  cambiarVelocidad: (valor: number) => void;
  mover: (indice: number) => void;
  pausar: () => void;
  // Salto a un instante de la línea de tiempo pedido desde fuera (paradas).
  irA: (instante: number) => void;
  // Selección de una parada: pausa, ubica el reloj, selecciona su fix, marca
  // la parada y lleva el mapa hasta ella con un vuelo suave (salto directo con
  // movimiento reducido), igual que elegir un colaborador en En vivo.
  // Con indiceParada null (microparada) hace lo mismo sin resaltar parada.
  seleccionarParada: (indiceParada: number | null, latitud: number, longitud: number, instante: number) => void;
  // Selección de un fix al pulsar la ruta: pausa y ubica el reproductor.
  seleccionar: (indice: number) => void;
  quitarSeleccion: () => void;
}

export const ContextoReproductor = createContext<Reproductor | null>(null);


export function useReproductor(): Reproductor {
  const reproductor = useContext(ContextoReproductor);
  if (!reproductor) {
    throw new Error('Los bloques de Replay van dentro de ReproductorReplay.');
  }
  return reproductor;
}

// Dirección a pedido, por coordenada redondeada; react-query no repite
// consultas y la caché de datos.ts evita pedir dos veces la misma parada.
export function useDireccion(
  lat: number | null,
  lon: number | null,
  habilitada: boolean,
  precisionM: number | null = null,
): string | null {
  const consulta = useQuery({
    queryKey: [
      'geocode',
      lat == null ? null : lat.toFixed(5),
      lon == null ? null : lon.toFixed(5),
      precisionM == null ? null : Math.round(precisionM),
    ],
    queryFn: async () => {
      if (lat == null || lon == null) return { direccion: null };
      return traerDireccion(lat, lon, precisionM);
    },
    enabled: habilitada && lat != null && lon != null,
    retry: false,
    staleTime: Infinity,
  });
  return consulta.data?.direccion ?? null;
}
