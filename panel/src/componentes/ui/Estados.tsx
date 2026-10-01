import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox, LoaderCircle, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

// Sin datos: ícono, título y una línea de ayuda. Nunca una caja vacía.
export function Vacio({
  icono: Icono = Inbox,
  titulo,
  children,
  className,
}: {
  icono?: LucideIcon;
  titulo: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <span className="grid size-11 place-items-center rounded-full bg-marino-50 text-marino-400">
        <Icono className="size-5" />
      </span>
      <p className="font-display text-[14px] font-semibold text-marino-900">{titulo}</p>
      {children && <p className="max-w-sm text-[12.5px] text-texto-2">{children}</p>}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…', className }: { texto?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-12 text-[13px] text-texto-2', className)}>
      <LoaderCircle className="size-4 animate-spin text-marca" />
      {texto}
    </div>
  );
}

export function ErrorCarga({ mensaje, alReintentar }: { mensaje: string; alReintentar?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-tarjeta border border-peligro/20 bg-peligro-suave px-4 py-3 text-[13px] text-peligro">
      <TriangleAlert className="mt-0.5 size-4 flex-none" />
      <p className="flex-1">{mensaje}</p>
      {alReintentar && (
        <button type="button" onClick={alReintentar} className="cursor-pointer font-semibold underline">
          Reintentar
        </button>
      )}
    </div>
  );
}

// Bloque gris animado mientras llega el dato (fichas, filas).
export function Esqueleto({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-marino-100/70', className)} />;
}
