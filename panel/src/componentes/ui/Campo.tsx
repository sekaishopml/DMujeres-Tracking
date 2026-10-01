import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const claseControl = cn(
  'h-9 w-full rounded-control border border-borde-fuerte bg-superficie px-3 text-[13px] text-texto',
  'placeholder:text-texto-3 transition-[border-color,box-shadow]',
  'focus:border-marca focus:ring-3 focus:ring-marca/15 focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-fondo disabled:text-texto-3',
);

// Etiqueta + control + ayuda o error. Envolver en <label> hace pulsable todo.
export function Campo({
  etiqueta,
  ayuda,
  error,
  children,
  className,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[12px] font-semibold text-marino-900">{etiqueta}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] font-medium text-peligro">{error}</span>
      ) : ayuda ? (
        <span className="mt-1 block text-[12px] text-texto-3">{ayuda}</span>
      ) : null}
    </label>
  );
}

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Entrada(
  { className, ...resto },
  ref,
) {
  return <input ref={ref} className={cn(claseControl, className)} {...resto} />;
});

export const Selector = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Selector(
  { className, ...resto },
  ref,
) {
  return <select ref={ref} className={cn(claseControl, 'cursor-pointer pr-8', className)} {...resto} />;
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AreaTexto({ className, ...resto }, ref) {
    return <textarea ref={ref} className={cn(claseControl, 'h-auto min-h-20 py-2', className)} {...resto} />;
  },
);

export function Casilla({
  etiqueta,
  className,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[13px] text-texto-2', className)}>
      <input type="checkbox" className="size-4 cursor-pointer accent-marca" {...resto} />
      {etiqueta}
    </label>
  );
}
