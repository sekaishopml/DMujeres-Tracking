import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { Dispositivo } from '@contratos';
import { Route } from 'lucide-react';
import { claseBoton } from '@/componentes/ui/Boton';
import { hora } from '@/dominio/formatoBase';
import { urlReplay } from '@/dominio/enlaces';
import { useResumenDelDia } from '@/dominio/resumenDelDia';

// Al pasar el cursor por una persona: su día en cuatro datos y dónde estuvo por
// última vez, sin salir de la tabla. El día se pide solo al abrir la tarjeta.

const ESPERA_ABRIR_MS = 350;
const ESPERA_CERRAR_MS = 150;
const ANCHO = 320;

export default function HoverDia({ equipo, dia, children }: { equipo: Dispositivo; dia: string; children: ReactNode }) {
  const ancla = useRef<HTMLDivElement>(null);
  const [lugar, setLugar] = useState<{ x: number; y: number; arriba: boolean } | null>(null);
  const temporizador = useRef<number | undefined>(undefined);

  const abrir = (demora: number) => {
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => {
      const caja = ancla.current?.getBoundingClientRect();
      if (!caja) return;
      // Se abre debajo; si no cabe, encima. Siempre dentro de la ventana.
      const arriba = caja.bottom + 230 > window.innerHeight && caja.top > 240;
      setLugar({
        x: Math.min(Math.max(8, caja.left), window.innerWidth - ANCHO - 8),
        y: arriba ? caja.top - 6 : caja.bottom + 6,
        arriba,
      });
    }, demora);
  };
  const cerrar = () => {
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setLugar(null), ESPERA_CERRAR_MS);
  };
  useEffect(() => () => window.clearTimeout(temporizador.current), []);
  useEffect(() => {
    if (!lugar) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setLugar(null);
    };
    // Al desplazar la tabla el ancla se mueve y la tarjeta quedaría suelta.
    const alDesplazar = () => setLugar(null);
    window.addEventListener('keydown', alTeclear);
    window.addEventListener('scroll', alDesplazar, true);
    return () => {
      window.removeEventListener('keydown', alTeclear);
      window.removeEventListener('scroll', alDesplazar, true);
    };
  }, [lugar]);

  return (
    <div
      ref={ancla}
      onMouseEnter={() => abrir(ESPERA_ABRIR_MS)}
      onMouseLeave={cerrar}
      onFocus={() => abrir(0)}
      onBlur={cerrar}
    >
      {children}
      {lugar &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={() => window.clearTimeout(temporizador.current)}
            onMouseLeave={cerrar}
            style={{ left: lugar.x, top: lugar.y, width: ANCHO, transform: lugar.arriba ? 'translateY(-100%)' : undefined }}
            className="fixed z-[60] animate-entrar rounded-tarjeta border border-borde bg-superficie shadow-flotante"
          >
            <CuerpoDia equipo={equipo} dia={dia} />
          </div>,
          document.body,
        )}
    </div>
  );
}

function CuerpoDia({ equipo, dia }: { equipo: Dispositivo; dia: string }) {
  const { ultimaParada } = useResumenDelDia(equipo.idPublico, dia);
  return (
    <>
      <div className="px-3 pt-3 pb-2">
        <p className="truncate font-display text-[14px] font-semibold text-marino-900">{equipo.nombre}</p>
        <p className="truncate text-[11.5px] text-texto-3">{equipo.departamento ?? 'Sin departamento'} · hoy</p>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <p className="mr-auto min-w-0 truncate text-[11.5px] text-texto-2">
          {ultimaParada ? (
            <>
              <span className="text-texto-3">Última parada: </span>
              {ultimaParada.direccion ?? `desde las ${hora(ultimaParada.inicio)}`}
            </>
          ) : null}
        </p>
        <Link to={urlReplay(equipo.idPublico, dia)} className={claseBoton('secundario', 'sm')}>
          <Route className="size-3.5" />
          Replay
        </Link>
      </div>
    </>
  );
}
