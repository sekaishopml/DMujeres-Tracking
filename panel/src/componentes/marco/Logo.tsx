import { cn } from '@/lib/cn';

// Logotipo oficial de DMujeres Tracking (el mismo de la app Android, tomado de
// sus recursos). Sobre fondos claros va "DMujeres" en negro y en modo
// nocturno o sobre marino (`claro`) en blanco; `simbolo` son los labios de la
// marca (negro / blanco).
export function Logo({
  claro = false,
  simbolo = false,
  className,
}: {
  claro?: boolean;
  simbolo?: boolean;
  className?: string;
}) {
  if (simbolo) {
    // Símbolo del menú plegado: los labios de la marca en negro (blanco en
    // modo nocturno), el mismo dibujo del ícono de la pestaña.
    return (
      <>
        <img src="/marca/labios-negro.png" alt="DMujeres Tracking" className={cn('object-contain dark:hidden', className ?? 'size-8')} draggable={false} />
        <img
          src="/marca/labios-blanco.png"
          alt=""
          aria-hidden="true"
          className={cn('hidden object-contain dark:block', className ?? 'size-8')}
          draggable={false}
        />
      </>
    );
  }
  if (claro) {
    return <img src="/marca/dmujeres-tracking-blanco.png" alt="DMujeres Tracking" className={cn('w-auto', className ?? 'h-9')} draggable={false} />;
  }
  return (
    <>
      <img src="/marca/dmujeres-tracking.png" alt="DMujeres Tracking" className={cn('w-auto dark:hidden', className ?? 'h-9')} draggable={false} />
      <img
        src="/marca/dmujeres-tracking-blanco.png"
        alt=""
        aria-hidden="true"
        className={cn('hidden w-auto dark:block', className ?? 'h-9')}
        draggable={false}
      />
    </>
  );
}
