import { mensajeError } from '@/dominio/errores';
import { fechaHora } from '@/dominio/formatoBase';
import { useHistorialGeocerca } from '@/dominio/geocercas';
import { Cargando } from '@/componentes/ui/Estados';
import { etiquetaAccion } from './logica';

// Quién hizo cada cambio, el día y la hora. Más reciente primero.
export default function HistorialGeocerca({ id }: { id: number }) {
  const consulta = useHistorialGeocerca(id);
  if (consulta.isPending) return <Cargando />;
  if (consulta.error) return <p className="text-[12.5px] text-peligro">{mensajeError(consulta.error)}</p>;
  const datos = consulta.data?.datos ?? [];
  if (datos.length === 0) return <p className="text-[12.5px] text-texto-3">Sin movimientos registrados.</p>;
  return (
    <ul className="divide-y divide-borde">
      {datos.map((h) => (
        <li key={h.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
          <span>
            <strong className="font-semibold">{etiquetaAccion(h.accion)}</strong> · {h.quien || '—'}
          </span>
          <span className="shrink-0 text-texto-3">{fechaHora(h.ocurridoEn)}</span>
        </li>
      ))}
    </ul>
  );
}
