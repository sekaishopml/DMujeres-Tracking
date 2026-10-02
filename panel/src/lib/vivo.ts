import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type { Posicion, PosicionesVivas } from '@contratos';
import { CLAVE_FLOTA } from '@/dominio/datos';
import { CLAVE_NOVEDADES_CRONOGRAMA } from '@/componentes/reportes/novedades';

// Canal en vivo (/api/v1/vivo): el servidor avisa apenas llega un punto, un
// evento o una actividad. Las posiciones se aplican directo al mapa; lo demás
// solo marca las consultas como viejas, juntando avisos para no pedir de más.
// Mientras el canal está abierto las pantallas consultan mucho menos.

interface MensajeVivo {
  posiciones: Posicion[];
  eventos: number[];
  actividades: number[];
}

const ESPERA_REFRESCO_MS = 3000;
// Los puntos llegan seguido: el estado de la flota se repasa como mucho cada 10 s.
const FLOTA_POR_PUNTOS_MS = 10_000;
let conectado = false;

export function vivoConectado(): boolean {
  return conectado;
}

export function useVivo(activo: boolean) {
  const cliente = useQueryClient();
  useEffect(() => {
    if (!activo || typeof EventSource === 'undefined') return;
    const fuente = new EventSource('/api/v1/vivo');
    const porRefrescar = new Map<string, QueryKey>();
    let temporizador: number | undefined;
    let flotaPorPuntos = 0;

    function refrescar(...claves: QueryKey[]) {
      for (const clave of claves) porRefrescar.set(JSON.stringify(clave), clave);
      temporizador ??= window.setTimeout(() => {
        temporizador = undefined;
        for (const clave of porRefrescar.values()) void cliente.invalidateQueries({ queryKey: clave });
        porRefrescar.clear();
      }, ESPERA_REFRESCO_MS);
    }

    fuente.onopen = () => {
      conectado = true;
    };
    fuente.onerror = () => {
      // El navegador reintenta solo; mientras tanto vuelven las consultas normales.
      conectado = false;
    };
    fuente.onmessage = (evento) => {
      let mensaje: MensajeVivo;
      try {
        mensaje = JSON.parse(evento.data) as MensajeVivo;
      } catch {
        return;
      }
      if (mensaje.posiciones.length > 0) {
        cliente.setQueryData<PosicionesVivas>(['posiciones-vivas'], (previo) => {
          if (!previo) return previo;
          const nuevas = new Map(mensaje.posiciones.map((p) => [p.dispositivoId, p]));
          const datos = previo.datos.map((p) => {
            const nueva = nuevas.get(p.dispositivoId);
            nuevas.delete(p.dispositivoId);
            // Un punto viejo que llega tarde no hace retroceder al marcador.
            return nueva && nueva.registradoEn >= p.registradoEn ? nueva : p;
          });
          return { ...previo, datos: [...datos, ...nuevas.values()] };
        });
        if (Date.now() - flotaPorPuntos > FLOTA_POR_PUNTOS_MS) {
          flotaPorPuntos = Date.now();
          refrescar(CLAVE_FLOTA);
        }
      }
      if (mensaje.eventos.length > 0) refrescar(CLAVE_FLOTA, ['inicio'], ['notificaciones'], ['salud']);
      if (mensaje.actividades.length > 0) refrescar(CLAVE_NOVEDADES_CRONOGRAMA, ['inicio'], ['cronograma']);
    };

    return () => {
      conectado = false;
      fuente.close();
      window.clearTimeout(temporizador);
    };
  }, [activo, cliente]);
}
