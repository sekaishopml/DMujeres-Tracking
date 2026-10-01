import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type Tono = 'marino' | 'marca' | 'movimiento' | 'detenido' | 'sinSenal' | 'peligro' | 'neutro';

const TONOS: Record<Tono, { icono: string; valor: string }> = {
  marino: { icono: 'bg-marino-100 text-marino-700', valor: 'text-marino-900' },
  marca: { icono: 'bg-marca-suave text-marca', valor: 'text-marino-900' },
  movimiento: { icono: 'bg-movimiento-suave text-movimiento', valor: 'text-marino-900' },
  detenido: { icono: 'bg-detenido-suave text-detenido', valor: 'text-marino-900' },
  sinSenal: { icono: 'bg-sin-senal-suave text-sin-senal', valor: 'text-sin-senal' },
  peligro: { icono: 'bg-peligro-suave text-peligro', valor: 'text-peligro' },
  neutro: { icono: 'bg-deshabilitado-suave text-deshabilitado', valor: 'text-marino-900' },
};

// Ficha de indicador (KPI): ícono en pastilla de color, cifra grande en
// Poppins y etiqueta. `resaltar` pinta la cifra con el color del tono cuando
// el valor exige atención (p. ej. equipos sin señal > 0).
export function Cifra({
  etiqueta,
  valor,
  detalle,
  icono: Icono,
  tono = 'marino',
  resaltar = false,
  onClick,
}: {
  etiqueta: string;
  valor: ReactNode;
  detalle?: ReactNode;
  icono?: LucideIcon;
  tono?: Tono;
  resaltar?: boolean;
  onClick?: () => void;
}) {
  const Contenedor = onClick ? 'button' : 'div';
  return (
    <Contenedor
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-center gap-3.5 rounded-tarjeta border border-borde bg-superficie px-3.5 py-3 text-left shadow-tarjeta sm:px-4 sm:py-3.5',
        onClick && 'cursor-pointer transition-colors hover:border-marino-300',
      )}
    >
      {Icono && (
        <span className={cn('hidden size-10 flex-none place-items-center rounded-[10px] sm:grid', TONOS[tono].icono)}>
          <Icono className="size-5" strokeWidth={2} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium text-texto-2">{etiqueta}</span>
        <span
          className={cn(
            'block font-display text-[24px] leading-tight font-semibold cifras',
            resaltar ? TONOS[tono].valor : 'text-marino-900',
          )}
        >
          {valor}
        </span>
        {detalle != null && <span className="block truncate text-[11.5px] text-texto-3">{detalle}</span>}
      </span>
    </Contenedor>
  );
}
