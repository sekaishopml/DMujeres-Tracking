import { Avatar } from '@/componentes/ui/Avatar';
import { GUION } from '@/dominio/formatoBase';

export default function Persona({ nombre }: { nombre?: string }) {
  if (!nombre) return <span className="text-texto-3">{GUION}</span>;
  return (
    <span className="flex items-center gap-2.5">
      <Avatar nombre={nombre} tamano="sm" />
      <span className="font-medium text-marino-900">{nombre}</span>
    </span>
  );
}
