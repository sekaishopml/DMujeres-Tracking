import { ChevronLeft, ChevronRight, Crosshair, FileDown, MoveRight, Pause, Play } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Íconos del reproductor por nombre: el reproductor los elige según su estado
// (play/pausa, plegar/desplegar), así que se resuelven con un mapa.
const ICONOS: Record<string, LucideIcon> = {
  enVivo: Crosshair,
  flecha: MoveRight,
  reportes: FileDown,
  chevronDer: ChevronRight,
  chevronIzq: ChevronLeft,
  pausa: Pause,
  play: Play,
};

export default function Icono({ nombre, tamano = 16 }: { nombre: string; tamano?: number }) {
  const Componente = ICONOS[nombre] ?? MoveRight;
  return <Componente size={tamano} strokeWidth={2} aria-hidden="true" />;
}
