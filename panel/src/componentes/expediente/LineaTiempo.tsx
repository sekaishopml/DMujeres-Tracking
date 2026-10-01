import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  BatteryCharging,
  BatteryLow,
  BatteryWarning,
  Flag,
  MapPin,
  Play,
  Plug,
  RotateCcw,
  WifiOff,
} from 'lucide-react';
import type { EventoBitacora, TipoEvento } from '@/dominio/bitacora';
import { bateria, hora } from '@/dominio/formatoBase';
import { cn } from '@/lib/cn';

interface Estilo {
  icono: LucideIcon;
  punto: string;
  // Color del marcador en el mapa (mismos tokens que el punto).
  color: string;
}

export const ESTILO_EVENTO: Record<TipoEvento, Estilo> = {
  jornadaInicio: { icono: Play, punto: 'bg-marino-700', color: '#17365d' },
  jornadaFin: { icono: Flag, punto: 'bg-marino-700', color: '#17365d' },
  salida: { icono: ArrowUpRight, punto: 'bg-movimiento', color: '#16a34a' },
  llegada: { icono: MapPin, punto: 'bg-detenido', color: '#2563eb' },
  sinSenal: { icono: WifiOff, punto: 'bg-sin-senal', color: '#d97706' },
  sinBateria: { icono: BatteryWarning, punto: 'bg-peligro', color: '#dc2626' },
  retomo: { icono: RotateCcw, punto: 'bg-movimiento', color: '#16a34a' },
  cargaInicio: { icono: BatteryCharging, punto: 'bg-marino-500', color: '#2c5f99' },
  cargaFin: { icono: Plug, punto: 'bg-marino-500', color: '#2c5f99' },
  bateriaBaja: { icono: BatteryLow, punto: 'bg-sin-senal', color: '#d97706' },
};

function InsigniaBateria({ pct }: { pct: number }) {
  const bajo = pct <= 15;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold cifras',
        bajo ? 'bg-peligro-suave text-peligro' : 'bg-marino-50 text-marino-700',
      )}
    >
      {bateria(pct)}
    </span>
  );
}

export function LineaTiempo({
  eventos,
  seleccionado,
  alSeleccionar,
}: {
  eventos: EventoBitacora[];
  seleccionado: string | null;
  alSeleccionar: (evento: EventoBitacora) => void;
}) {
  return (
    <ol className="px-3 pb-4">
      {eventos.map((e, i) => {
        const estilo = ESTILO_EVENTO[e.tipo];
        const Icono = estilo.icono;
        const clicable = e.lugar != null;
        const activo = seleccionado === e.id;
        const Contenedor = clicable ? 'button' : 'div';
        return (
          <li key={e.id} className="relative flex gap-3">
            <div className="flex w-14 flex-none justify-end pt-3 pr-1 text-[12.5px] font-semibold text-marino-900 cifras">
              {hora(e.instante)}
            </div>
            <div className="relative flex flex-none flex-col items-center">
              <span
                className={cn(
                  'z-[1] mt-2.5 grid size-7 place-items-center rounded-full text-white ring-4 ring-superficie',
                  estilo.punto,
                )}
              >
                <Icono className="size-3.5" strokeWidth={2.25} />
              </span>
              {i < eventos.length - 1 && <span className="absolute top-9 -bottom-2 w-px bg-borde-fuerte" />}
            </div>
            <Contenedor
              type={clicable ? 'button' : undefined}
              onClick={clicable ? () => alSeleccionar(e) : undefined}
              className={cn(
                'mb-1 min-w-0 flex-1 rounded-control border px-3 py-2 text-left',
                e.atencion ? 'border-peligro/25 bg-peligro-suave' : 'border-transparent',
                clicable && 'cursor-pointer transition-colors hover:border-marino-300',
                activo && 'border-marca ring-2 ring-marca/15',
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-semibold text-marino-900">{e.titulo}</span>
                {e.bateriaPct != null && <InsigniaBateria pct={e.bateriaPct} />}
              </span>
              {e.detalle && <span className="mt-0.5 block text-[12.5px] text-texto-2">{e.detalle}</span>}
              {clicable && <span className="mt-1 block text-[11.5px] text-texto-3">Ver lugar en el mapa</span>}
            </Contenedor>
          </li>
        );
      })}
    </ol>
  );
}
