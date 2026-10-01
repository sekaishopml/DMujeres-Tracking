import type { Dispositivo } from '@contratos';
import { BatteryCharging } from 'lucide-react';
import { claveEstado } from '@/dominio/estado';
import { GUION, hace } from '@/dominio/formatoBase';
import { Avatar } from '@/componentes/ui/Avatar';
import { cn } from '@/lib/cn';
import { CLASE_FONDO_NIVEL, CLASE_TEXTO_NIVEL, nivelBateria } from './nivel';

export function TarjetaPersona({
  equipo,
  seleccionada,
  alSeleccionar,
}: {
  equipo: Dispositivo;
  seleccionada: boolean;
  alSeleccionar: () => void;
}) {
  const nivel = nivelBateria(equipo.bateriaPct);
  const pct = equipo.bateriaPct;
  return (
    <button
      type="button"
      onClick={alSeleccionar}
      aria-pressed={seleccionada}
      className={cn(
        'min-w-0 cursor-pointer rounded-tarjeta border bg-superficie p-4 text-left shadow-tarjeta transition-colors',
        seleccionada ? 'border-marca ring-2 ring-marca/15' : 'border-borde hover:border-marino-300',
      )}
    >
      <span className="flex items-center gap-3">
        <Avatar nombre={equipo.nombre} estado={claveEstado(equipo)} tamano="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-marino-900">{equipo.nombre}</span>
          <span className="block truncate text-[11.5px] text-texto-3">{equipo.identificadorUnico}</span>
        </span>
        {equipo.cargando && <BatteryCharging className="size-5 flex-none text-movimiento" aria-label="Cargando" />}
      </span>
      <span className={cn('mt-3 block font-display text-[30px] leading-none font-semibold cifras', CLASE_TEXTO_NIVEL[nivel])}>
        {pct == null ? GUION : `${Math.round(pct)}%`}
      </span>
      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-marino-100">
        <span
          className={cn('block h-full rounded-full', CLASE_FONDO_NIVEL[nivel])}
          style={{ width: `${pct == null ? 0 : Math.max(0, Math.min(100, pct))}%` }}
        />
      </span>
      <span className="mt-2 block text-[11.5px] text-texto-3">
        {equipo.cargando ? 'Cargando · ' : ''}
        {equipo.ultimaConexion ? `Actualizado ${hace(equipo.ultimaConexion)}` : 'Sin conexión registrada'}
      </span>
    </button>
  );
}
