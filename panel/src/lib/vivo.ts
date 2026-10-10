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
    // El sitio va por HTTP/1.1: el navegador abre como mucho 6 conexiones y
    // cada canal abierto ocupa una para siempre. Con varias pestañas (o páginas
    // guardadas al navegar) se llenaban y todo el panel quedaba "Cargando…".
    // Por eso el canal solo está abierto mientras la pestaña se ve.
    let fuente: EventSource | null = null;
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

    const escuchar = (fuente: EventSource) => {
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
    };

    const abrir = () => {
      if (fuente || document.hidden) return;
      fuente = new EventSource('/api/v1/vivo');
      escuchar(fuente);
    };
    const cerrar = () => {
      conectado = false;
      fuente?.close();
      fuente = null;
    };
    const alCambiarVista = () => (document.hidden ? cerrar() : abrir());
    abrir();
    document.addEventListener('visibilitychange', alCambiarVista);
    window.addEventListener('pagehide', cerrar);
    window.addEventListener('pageshow', abrir);
    return () => {
      cerrar();
      document.removeEventListener('visibilitychange', alCambiarVista);
      window.removeEventListener('pagehide', cerrar);
      window.removeEventListener('pageshow', abrir);
      window.clearTimeout(temporizador);
    };
  }, [activo, cliente]);
}
