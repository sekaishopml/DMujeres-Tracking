// Piezas compartidas por las páginas de administración (Usuarios, Grupos,
// Configuración): permisos, búsqueda, paginación y avisos en línea.
import type { ReactNode } from 'react';
import { Search, ShieldAlert } from 'lucide-react';
import { Boton } from '@/componentes/ui/Boton';
import { Entrada } from '@/componentes/ui/Campo';
import { Tarjeta } from '@/componentes/ui/Tarjeta';
import { Vacio } from '@/componentes/ui/Estados';
import { ApiError } from '@/lib/api';

// Datos de plataforma (cuentas, grupos, roles, esquema): solo cambian por
// mutaciones que invalidan su clave, así que 5 min evita recargarlos.
export const CACHE_PLATAFORMA_MS = 5 * 60_000;
export const CACHE_FLOTA_CONSULTA_MS = 60_000;
export const TAMANO_PAGINA = 25;

export function esErrorDeEstado(error: unknown, estado: number): boolean {
  return error instanceof ApiError && error.estado === estado;
}

export function SinPermiso({ children }: { children: ReactNode }) {
  return (
    <Tarjeta>
      <Vacio icono={ShieldAlert} titulo="Acceso restringido">
        {children}
      </Vacio>
    </Tarjeta>
  );
}

export function Buscador({
  valor,
  alCambiar,
  placeholder,
}: {
  valor: string;
  alCambiar: (valor: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-texto-3" />
      <Entrada
        type="search"
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9"
      />
    </div>
  );
}

export function Paginacion({
  pagina,
  tamano,
  total,
  alCambiar,
}: {
  pagina: number;
  tamano: number;
  total: number;
  alCambiar: (pagina: number) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / tamano));
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-borde px-5 py-3 text-[12.5px] text-texto-2">
      <span className="cifras">
        Página {pagina} de {totalPaginas} · {total} registros
      </span>
      <div className="ml-auto flex gap-2">
        <Boton tamano="sm" disabled={pagina <= 1} onClick={() => alCambiar(pagina - 1)}>
          Anterior
        </Boton>
        <Boton tamano="sm" disabled={pagina >= totalPaginas} onClick={() => alCambiar(pagina + 1)}>
          Siguiente
        </Boton>
      </div>
    </div>
  );
}

export function AvisoError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 rounded-control bg-peligro-suave px-3 py-2 text-[12.5px] font-medium text-peligro">
      {children}
    </p>
  );
}
