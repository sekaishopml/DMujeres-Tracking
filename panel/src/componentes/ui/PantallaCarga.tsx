import { Logo } from '@/componentes/marco/Logo';

// Pantalla de carga de la aplicación (sesión y páginas que aún bajan): el
// logotipo oficial y debajo el círculo magenta.
export function PantallaCarga({ texto }: { texto?: string }) {
  return (
    <div className="grid h-full place-items-center bg-fondo" role="status" aria-live="polite">
      <div className="flex animate-entrar flex-col items-center gap-7">
        <Logo className="h-14" />
        <span className="circulo-carga" />
        <span className="sr-only">{texto ?? 'Cargando…'}</span>
      </div>
    </div>
  );
}
