import { cn } from '@/lib/cn';

// Control segmentado (Hoy / Ayer / 7 días, capas del mapa, pestañas cortas).
export function Segmentado<T extends string>({
  opciones,
  valor,
  alCambiar,
  className,
}: {
  opciones: readonly { valor: T; etiqueta: string }[];
  valor: T | null;
  alCambiar: (valor: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-control border border-borde bg-marino-50 p-0.5', className)} role="group">
      {opciones.map((opcion) => (
        <button
          key={opcion.valor}
          type="button"
          aria-pressed={opcion.valor === valor}
          onClick={() => alCambiar(opcion.valor)}
          className={cn(
            'h-7 cursor-pointer rounded-[6px] px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors',
            opcion.valor === valor
              ? 'bg-superficie text-marino-900 shadow-[0_1px_2px_rgb(12_31_61/0.12)]'
              : 'text-texto-2 hover:text-marino-900',
          )}
        >
          {opcion.etiqueta}
        </button>
      ))}
    </div>
  );
}
