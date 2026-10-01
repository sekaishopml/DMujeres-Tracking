import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { BotonIcono } from './Boton';
import { cn } from '@/lib/cn';

// Diálogo modal sobre <dialog> nativo: foco atrapado, Esc y fondo los da el
// navegador. `pie` recibe los botones de acción.
export function Dialogo({
  abierto,
  alCerrar,
  titulo,
  descripcion,
  children,
  pie,
  ancho = 'md',
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: ReactNode;
  descripcion?: ReactNode;
  children?: ReactNode;
  pie?: ReactNode;
  ancho?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    if (abierto && !nodo.open) nodo.showModal();
    if (!abierto && nodo.open) nodo.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      onClick={(evento) => {
        if (evento.target === ref.current) alCerrar();
      }}
      className={cn(
        'm-auto max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] overflow-visible rounded-tarjeta bg-transparent p-0 backdrop:bg-sombra/45 backdrop:backdrop-blur-[2px]',
        ancho === 'sm' && 'max-w-md',
        ancho === 'md' && 'max-w-xl',
        ancho === 'lg' && 'max-w-3xl',
      )}
    >
      {abierto && (
        <div className="flex max-h-[calc(100dvh-32px)] animate-entrar flex-col overflow-hidden rounded-tarjeta bg-superficie shadow-flotante">
          <div className="flex items-start gap-3 border-b border-borde px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold">{titulo}</h2>
              {descripcion && <p className="mt-0.5 text-[12.5px] text-texto-2">{descripcion}</p>}
            </div>
            <BotonIcono icono={X} etiqueta="Cerrar" onClick={alCerrar} className="-mt-1 -mr-2" />
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {pie && <div className="flex justify-end gap-2 border-t border-borde bg-fondo/60 px-5 py-3">{pie}</div>}
        </div>
      )}
    </dialog>
  );
}
