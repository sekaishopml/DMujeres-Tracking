import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Tarjeta } from '@/componentes/ui/Tarjeta';

export type EstadoServicio = 'ok' | 'error' | 'desconocido';

const PUNTO: Record<EstadoServicio, string> = {
  ok: 'bg-movimiento',
  error: 'bg-peligro',
  desconocido: 'bg-deshabilitado',
};

const TEXTO: Record<EstadoServicio, string> = {
  ok: 'Funciona',
  error: 'Con falla',
  desconocido: 'Sin respuesta',
};

// Tarjeta de un servicio: punto de estado, nombre, veredicto y qué implica.
export function TarjetaServicio({
  nombre,
  estado,
  significado,
}: {
  nombre: string;
  estado: EstadoServicio;
  significado: string;
}) {
  return (
    <Tarjeta className="p-5">
      <div className="flex items-center gap-2">
        <span className={cn('size-2.5 rounded-full', PUNTO[estado])} aria-hidden="true" />
        <h3 className="text-[13px] font-semibold text-marino-900">{nombre}</h3>
      </div>
      <p className={cn('mt-2 font-display text-[20px] font-semibold', estado === 'error' ? 'text-peligro' : 'text-marino-900')}>
        {TEXTO[estado]}
      </p>
      <p className="mt-1 text-[12px] text-texto-2">{significado}</p>
    </Tarjeta>
  );
}

export function TarjetaDato({ etiqueta, children, mono }: { etiqueta: string; children: ReactNode; mono?: boolean }) {
  return (
    <Tarjeta className="p-5">
      <p className="text-[13px] font-semibold text-marino-900">{etiqueta}</p>
      <p className={cn('mt-2 truncate font-display text-[20px] font-semibold text-marino-900', mono && 'font-mono text-[17px]')}>
        {children}
      </p>
    </Tarjeta>
  );
}
