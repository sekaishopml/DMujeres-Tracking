import { cn } from '@/lib/cn';
import { COLOR_ESTADO } from '@/dominio/formatoBase';

// Tonos de fondo para las iniciales: estables por nombre (la misma persona
// siempre del mismo color) y dentro de la paleta marino/magenta del panel.
const FONDOS = ['#17365d', '#2c5f99', '#eb0045', '#0f766e', '#7c3aed', '#b45309', '#1f4a7c', '#be185d'];

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return nombre.trim().slice(0, 2).toUpperCase() || '?';
}

export function colorDeNombre(nombre: string): string {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FONDOS[h % FONDOS.length];
}

const TAMANOS = {
  sm: 'size-8 text-[11px]',
  md: 'size-10 text-[13px]',
  lg: 'size-12 text-[15px]',
  xl: 'size-16 text-[20px]',
};

// Avatar de persona: iniciales sobre su color y, si se pasa `estado` (clave
// camelCase de dominio/estado.ts), un punto con el color del estado.
export function Avatar({
  nombre,
  estado,
  tamano = 'md',
  className,
}: {
  nombre: string;
  estado?: string;
  tamano?: keyof typeof TAMANOS;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-grid flex-none', className)}>
      <span
        className={cn('grid place-items-center rounded-full font-display font-semibold text-white', TAMANOS[tamano])}
        style={{ background: colorDeNombre(nombre) }}
        aria-hidden="true"
      >
        {iniciales(nombre)}
      </span>
      {estado && (
        <span
          className={cn(
            'absolute right-0 bottom-0 rounded-full ring-2 ring-superficie',
            tamano === 'sm' ? 'size-2.5' : 'size-3',
          )}
          style={{ background: COLOR_ESTADO[estado] ?? COLOR_ESTADO.deshabilitado }}
          title={estado}
        />
      )}
    </span>
  );
}
