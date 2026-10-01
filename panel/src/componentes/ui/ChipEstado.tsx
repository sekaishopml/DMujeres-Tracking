import type { EstadoOperativo } from '@/dominio/estado';
import { claveEstado, etiquetaEstado } from '@/dominio/estado';
import { cn } from '@/lib/cn';

// Clave camelCase de dominio/estado.ts → colores del sistema de diseño.
const CLASES: Record<string, string> = {
  enLinea: 'bg-movimiento-suave text-movimiento',
  detenido: 'bg-detenido-suave text-detenido',
  sinSenal: 'bg-sin-senal-suave text-sin-senal',
  senalDebil: 'bg-sin-senal-suave text-sin-senal',
  deshabilitado: 'bg-deshabilitado-suave text-deshabilitado',
  desconocido: 'bg-deshabilitado-suave text-deshabilitado',
};

export function Chip({ clase, children, className }: { clase: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-[11.5px] font-semibold whitespace-nowrap',
        CLASES[clase] ?? CLASES.desconocido,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

// Estado operativo de un equipo con su etiqueta oficial (En línea, Detenido,
// Sin señal, Señal débil, Fuera de jornada).
export function ChipEstado({ equipo, className }: { equipo: EstadoOperativo; className?: string }) {
  return (
    <Chip clase={claveEstado(equipo)} className={className}>
      {etiquetaEstado(equipo)}
    </Chip>
  );
}

// Insignia neutra o de tono para datos que no son estado (rol, grupo, activa).
export function Insignia({
  tono = 'neutro',
  children,
}: {
  tono?: 'neutro' | 'marino' | 'marca' | 'exito' | 'alerta' | 'peligro';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap',
        tono === 'neutro' && 'bg-deshabilitado-suave text-texto-2',
        tono === 'marino' && 'bg-marino-100 text-marino-700',
        tono === 'marca' && 'bg-marca-suave text-marca',
        tono === 'exito' && 'bg-movimiento-suave text-movimiento',
        tono === 'alerta' && 'bg-sin-senal-suave text-sin-senal',
        tono === 'peligro' && 'bg-peligro-suave text-peligro',
      )}
    >
      {children}
    </span>
  );
}
