import { useState } from 'react';
import Icono from '@/componentes/replay/Icono';
import { mensajeError } from '@/dominio/errores';
import { GUION, duracion } from '@/dominio/formatoBase';
import { useVisitasGeocercas } from '@/dominio/geocercas';
import { horaCorta } from '@/dominio/replay';
import type { Parada } from '@/dominio/replay';
import type { Geocerca, VisitaGeocerca } from '@contratos';
import { colorTipo, etiquetaTipo, geocercasSoloPorParadas, resumenDomicilio, visitasSegunParadas } from './logica';

function FilaVisita({ visita }: { visita: VisitaGeocerca }) {
  return (
    <li className="flex justify-between gap-2">
      <span>
        Llegó {visita.llegada ? horaCorta(visita.llegada) : 'N/A'} · Salió {visita.salida ? horaCorta(visita.salida) : 'N/A'}
      </span>
      <span className="text-texto-3">{visita.duracionMin != null ? duracion(visita.duracionMin * 60) : GUION}</span>
    </li>
  );
}

// Geocercas visitadas en el rango, plegable como la lista de paradas. El
// domicilio se lee distinto: la primera salida y la última llegada, y debajo
// cada vez que volvió. Las demás muestran sus visitas una por una.
export default function SeccionGeocercas({
  dispositivoId,
  desde,
  hasta,
  activo,
  paradas,
  geocercas,
  lecturas,
}: {
  dispositivoId: string;
  desde: string;
  hasta: string;
  activo: boolean;
  paradas: readonly Parada[];
  geocercas: readonly Geocerca[];
  // GPS tal como llegó: Llegó/Salió se ajustan a las lecturas cerca de la geocerca.
  lecturas?: readonly { registradoEn: string; latitud: number; longitud: number; precisionM?: number | null }[];
}) {
  const [abiertas, setAbiertas] = useState(true);
  const consulta = useVisitasGeocercas(dispositivoId, desde, hasta, activo);
  if (!activo || consulta.isPending) return null;
  if (consulta.error) return <p className="replay-nota">Geocercas: {mensajeError(consulta.error)}</p>;
  const vistas = consulta.data?.datos ?? [];
  const datos = [
    ...vistas.map((v) => visitasSegunParadas(v, paradas, geocercas, lecturas)),
    ...geocercasSoloPorParadas(vistas, paradas, geocercas, lecturas),
  ];
  // El domicilio primero.
  const lista = [...datos].sort((a, b) => Number(b.tipo === 'casa') - Number(a.tipo === 'casa'));
  return (
    <section className="replay-paradas">
      <button type="button" className="replay-plegar-paradas" onClick={() => setAbiertas((v) => !v)} aria-expanded={abiertas}>
        Geocercas ({lista.length})
        <Icono nombre="flecha" />
      </button>
      {abiertas && lista.length === 0 && <p className="replay-nota">No pasó por ninguna geocerca en este rango.</p>}
      {abiertas && lista.length > 0 && (
        <ul className="space-y-1.5">
          {lista.map((v) => {
            // Solo es "domicilio" si el día empieza adentro. Una casa a la que
            // llegó y de la que salió (otra casa de visita) se lee como visita.
            const casa = v.tipo === 'casa' && v.visitas[0]?.llegada == null;
            const r = resumenDomicilio(v);
            const filas = casa ? r.regresos : v.visitas;
            return (
              <li key={v.geocercaId} className="rounded-control border border-borde bg-superficie px-2.5 py-1.5 text-[12.5px]">
                <p>
                  <span className="font-semibold" style={{ color: colorTipo(v.tipo) }}>
                    {v.nombre}
                  </span>{' '}
                  <span className="text-texto-3">({etiquetaTipo(v.tipo)})</span>
                </p>
                {casa && (
                  <p>
                    Salió del domicilio a las <strong>{r.salio ? horaCorta(r.salio) : 'N/A'}</strong> · Llegó a las{' '}
                    <strong>{r.llego ? horaCorta(r.llego) : 'N/A'}</strong>
                  </p>
                )}
                {casa && filas.length > 1 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-texto-2">Volvió al domicilio {filas.length} veces</summary>
                    <ol className="mt-1 space-y-0.5">
                      {filas.map((x) => (
                        <FilaVisita key={`${x.llegada}-${x.salida}`} visita={x} />
                      ))}
                    </ol>
                  </details>
                )}
                {!casa && (
                  <ol className="mt-0.5 space-y-0.5">
                    {filas.map((x) => (
                      <FilaVisita key={`${x.llegada}-${x.salida}`} visita={x} />
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
