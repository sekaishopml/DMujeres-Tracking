import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

// Tabla de trabajo: cabecera en versalitas sobre marino muy claro, filas con
// línea fina y hover. Va dentro de una Tarjeta; el contenedor da scroll
// horizontal en pantallas angostas.
export function Tabla({ className, ...resto }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...resto} />
    </div>
  );
}

export function Th({ className, numerico, ...resto }: ThHTMLAttributes<HTMLTableCellElement> & { numerico?: boolean }) {
  return (
    <th
      className={cn(
        'border-b border-borde bg-marino-50/70 px-4 py-2.5 text-left text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-texto-2 uppercase',
        numerico && 'text-right',
        className,
      )}
      {...resto}
    />
  );
}

export function Td({ className, numerico, ...resto }: TdHTMLAttributes<HTMLTableCellElement> & { numerico?: boolean }) {
  return (
    <td
      className={cn('border-b border-borde/70 px-4 py-3 align-middle', numerico && 'text-right cifras', className)}
      {...resto}
    />
  );
}

export function Fila({
  className,
  seleccionada,
  ...resto
}: HTMLAttributes<HTMLTableRowElement> & { seleccionada?: boolean }) {
  return (
    <tr
      className={cn(
        'transition-colors hover:bg-marino-50/60 [&:last-child>td]:border-b-0',
        seleccionada && 'bg-marca-suave/60 hover:bg-marca-suave [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-marca)]',
        resto.onClick && 'cursor-pointer',
        className,
      )}
      {...resto}
    />
  );
}
