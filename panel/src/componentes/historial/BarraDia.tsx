import { diaDe, inicioDeDia } from '@/dominio/rango';

// Barra delgada de 24 h con el tramo de la jornada. Si la jornada cruza la
// medianoche, el tramo se recorta al día de inicio (la hora de fin lleva +1).
export function BarraDia({ inicioEn, finEn }: { inicioEn: string; finEn: string | null }) {
  const inicio = new Date(inicioEn);
  const diaInicio = new Date(inicioDeDia(diaDe(inicio))).getTime();
  const dia = 24 * 3_600_000;
  const fin = finEn ? new Date(finEn).getTime() : Date.now();
  const desde = Math.max(0, Math.min(1, (inicio.getTime() - diaInicio) / dia));
  const hasta = Math.max(desde, Math.min(1, (fin - diaInicio) / dia));
  const ancho = Math.max(hasta - desde, 0.008);
  return (
    <div
      className="relative h-2 w-40 rounded-full bg-marino-100"
      role="img"
      aria-label={`Jornada dentro de las 24 horas del día${finEn ? '' : ' (en curso)'}`}
    >
      <span
        className="absolute inset-y-0 rounded-full bg-marino-700"
        style={{ left: `${desde * 100}%`, width: `${ancho * 100}%` }}
      />
    </div>
  );
}
