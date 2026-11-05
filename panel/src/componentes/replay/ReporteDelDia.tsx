import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { TIPOS, traerCronograma } from '@/dominio/cronograma';
import type { Actividad } from '@/dominio/cronograma';

// Qué dice el recorrido de lo declarado, solo cuando hay algo que revisar.
const AVISO_RESPALDO: Record<string, string> = {
  LEJOS: 'Lejos del cliente',
  SIMULADA: 'Solo ubicación simulada a esa hora',
  SIN_RECORRIDO: 'Sin recorrido a esa hora',
};

// Actividades que la persona cargó para ese día, plegadas por defecto. La
// lista tiene alto máximo y se desplaza, para que no tape el mapa.
export default function ReporteDelDia({ dispositivoId, dia }: { dispositivoId: string; dia: string }) {
  const [abierto, setAbierto] = useState(false);
  const reporte = useQuery({
    queryKey: ['reporte-dia', dispositivoId, dia],
    queryFn: () => traerCronograma(dia, dia, dispositivoId),
    enabled: dispositivoId !== '' && dia !== '',
    staleTime: 60_000,
    retry: false,
  });
  const actividades: Actividad[] = (reporte.data?.datos ?? [])
    .filter((a) => a.fecha === dia)
    .sort((x, y) => x.hora.localeCompare(y.hora));
  if (reporte.isPending || reporte.isError || actividades.length === 0) return null;

  return (
    <section className="replay-reporte">
      <button type="button" className="replay-plegar-paradas" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        Reporte del día ({actividades.length})
        <ChevronDown size={14} className={abierto ? 'rotate-180' : undefined} aria-hidden="true" />
      </button>
      {abierto && (
        <ul className="replay-reporte-lista">
          {actividades.map((a) => {
            const aviso = AVISO_RESPALDO[a.respaldo?.estado ?? ''];
            return (
              <li key={a.id}>
                <span className="replay-reporte-hora">
                  {a.hora.slice(0, 5)}
                  {a.horaFin ? `–${a.horaFin.slice(0, 5)}` : ''}
                </span>
                <span className="replay-reporte-texto">
                  <strong>{TIPOS[a.tipo]?.etiqueta ?? a.tipo}</strong>
                  {a.lugar ? ` · ${a.lugar}` : ''}
                  {aviso && <em>{aviso}</em>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
