import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CACHE_AUDITORIA_MS, traerParadas, traerReplay } from './datos';
import { resumenDia } from './dia';
import type { ResumenDia } from './dia';
import { finDeDia, inicioDeDia } from './rango';

export interface DiaDeUnaPersona {
  resumen: ResumenDia;
  cargando: boolean;
  // El día no tiene ni un punto: el resumen está vacío y se muestra "—".
  sinDatos: boolean;
  // Dirección de la última parada del día, si ya se conoce.
  ultimaParada: { direccion: string | null; inicio: string; fin: string } | null;
}

// El día de una persona (hoy o uno pasado) visto como lo vive: visitas y
// cobertura. Comparte caché con Seguimiento y Repetición
// (mismas claves), así que abrir una tarjeta no repite lo ya pedido.
export function useResumenDelDia(idPublico: string, dia: string, habilitado = true): DiaDeUnaPersona {
  const desde = inicioDeDia(dia);
  const hasta = finDeDia(dia);
  const opciones = { staleTime: CACHE_AUDITORIA_MS, retry: 0, enabled: habilitado } as const;
  const replay = useQuery({ queryKey: ['replay', idPublico, dia, dia], queryFn: () => traerReplay(idPublico, desde, hasta), ...opciones });
  const paradas = useQuery({ queryKey: ['paradas', idPublico, dia, dia], queryFn: () => traerParadas(idPublico, desde, hasta), ...opciones });
  return useMemo(() => {
    const lista = [...(paradas.data?.datos ?? [])].sort((a, b) => a.inicio.localeCompare(b.inicio));
    const posiciones = replay.data?.posiciones ?? [];
    const ultima = lista.at(-1);
    return {
      resumen: resumenDia({ posiciones, paradas: lista, huecos: replay.data?.huecos ?? [] }),
      cargando: habilitado && (replay.isPending || paradas.isPending),
      sinDatos: posiciones.length === 0,
      ultimaParada: ultima ? { direccion: ultima.direccion ?? null, inicio: ultima.inicio, fin: ultima.fin } : null,
    };
  }, [replay.data, replay.isPending, paradas.data, paradas.isPending, habilitado]);
}
