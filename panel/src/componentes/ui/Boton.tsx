import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type VarianteBoton = 'principal' | 'secundario' | 'marino' | 'fantasma' | 'peligro';

// Clases compartidas con los enlaces que parecen botón (<Link className={claseBoton(...)}>).
export function claseBoton(variante: VarianteBoton = 'secundario', tamano: 'sm' | 'md' = 'md'): string {
  return cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors',
    'disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
    tamano === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-9 px-4 text-[13px]',
    variante === 'principal' && 'bg-marca text-white shadow-[0_2px_8px_rgb(235_0_69/0.25)] hover:bg-marca-oscuro',
    variante === 'secundario' && 'border border-borde-fuerte bg-superficie text-marino-900 hover:border-marino-300 hover:bg-marino-50',
    variante === 'marino' && 'bg-tinta-2 text-white hover:bg-tinta-3',
    variante === 'fantasma' && 'text-texto-2 hover:bg-marino-50 hover:text-marino-900',
    variante === 'peligro' && 'border border-peligro/30 bg-superficie text-peligro hover:bg-peligro-suave',
  );
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tamano?: 'sm' | 'md';
  icono?: LucideIcon;
  children?: ReactNode;
}

export const Boton = forwardRef<HTMLButtonElement, Props>(function Boton(
  { variante = 'secundario', tamano = 'md', icono: Icono, className, children, type = 'button', ...resto },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(claseBoton(variante, tamano), className)} {...resto}>
      {Icono && <Icono className={tamano === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={2} />}
      {children}
    </button>
  );
});

// Botón cuadrado solo con ícono (acciones de fila, cerrar, plegar).
export function BotonIcono({
  icono: Icono,
  etiqueta,
  className,
  peligro = false,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { icono: LucideIcon; etiqueta: string; peligro?: boolean }) {
  return (
    <button
      type="button"
      title={etiqueta}
      aria-label={etiqueta}
      className={cn(
        'inline-grid size-8 cursor-pointer place-items-center rounded-control text-texto-2 transition-colors',
        peligro ? 'hover:bg-peligro-suave hover:text-peligro' : 'hover:bg-marino-50 hover:text-marino-900',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...resto}
    >
      <Icono className="size-4" strokeWidth={2} />
    </button>
  );
}
