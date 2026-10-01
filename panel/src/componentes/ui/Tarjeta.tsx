import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Superficie base del panel: blanca, borde fino y sombra mínima.
export function Tarjeta({ className, ...resto }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-tarjeta border border-borde bg-superficie shadow-tarjeta', className)} {...resto} />;
}

// Cabecera de una tarjeta o sección: título, dato corto y acciones a la derecha.
export function CabeceraTarjeta({
  titulo,
  detalle,
  acciones,
  className,
}: {
  titulo: ReactNode;
  detalle?: ReactNode;
  acciones?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3', className)}>
      <h2 className="text-[15px] font-semibold">{titulo}</h2>
      {detalle != null && <span className="text-[12px] text-texto-3 cifras">{detalle}</span>}
      {acciones != null && <div className="ml-auto flex items-center gap-2">{acciones}</div>}
    </div>
  );
}
