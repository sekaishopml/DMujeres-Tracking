import type { ReactNode } from 'react';
import type { Dispositivo } from '@contratos';
import { OpcionesPersonas } from '@/componentes/ui/OpcionesPersonas';
import { fechaAyerLocal, fechaHoyLocal } from '@/dominio/rango';

interface Props {
  equipos: Dispositivo[];
  cargandoEquipos: boolean;
  dispositivoId: string;
  alCambiarDispositivo: (id: string) => void;
  desde: string;
  hasta: string;
  alCambiarDesde: (fecha: string) => void;
  alCambiarHasta: (fecha: string) => void;
  // En Replay el filtro va dentro del panel flotante y se pinta sin tarjeta
  // propia; Historial conserva la tarjeta del resto de la página.
  compacto?: boolean;
  // La auditoría toda la flota: la primera opción es "Todas" y usa el valor
  // vacío, que el endpoint de jornadas lee como "sin filtro". Las demás
  // pantallas mantienen la unidad obligatoria para anclar el mapa.
  conTodas?: boolean;
  // Botones a la derecha del selector de equipo, en su misma fila.
  acciones?: ReactNode;
}

// Selector compartido por Historial y Replay: ambos necesitan equipo + rango y
// mantener la misma forma de elegir evita que las pantallas diverjan.
export default function FiltroReplay({
  equipos,
  cargandoEquipos,
  dispositivoId,
  alCambiarDispositivo,
  desde,
  hasta,
  alCambiarDesde,
  alCambiarHasta,
  compacto = false,
  conTodas = false,
  acciones,
}: Props) {
  const atajos = [
    { etiqueta: 'Ayer', fecha: fechaAyerLocal() },
    { etiqueta: 'Hoy', fecha: fechaHoyLocal() },
  ];
  return (
    <div className={compacto ? 'filtro-replay' : 'tarjeta filtro-replay'}>
      <div className="fila-equipo">
        <label className="campo campo-equipo">
          <span>Equipo</span>
          <select
            value={dispositivoId}
            onChange={(evento) => alCambiarDispositivo(evento.target.value)}
            disabled={cargandoEquipos || equipos.length === 0}
          >
            {conTodas && <option value="">Todos los equipos</option>}
            {equipos.length === 0 && !conTodas && (
              <option value="">{cargandoEquipos ? 'Cargando equipos…' : 'Sin equipos visibles'}</option>
            )}
            <OpcionesPersonas equipos={equipos} etiquetaDe={(equipo) => `${equipo.nombre} · ${equipo.identificadorUnico}`} />
          </select>
        </label>
      {acciones}
      </div>
      <label className="campo">
        <span>Desde</span>
        <input type="date" value={desde} onChange={(evento) => alCambiarDesde(evento.target.value)} />
      </label>
      <label className="campo">
        <span>Hasta</span>
        <input type="date" value={hasta} onChange={(evento) => alCambiarHasta(evento.target.value)} />
      </label>
      <div className="rango-rapido" role="group" aria-label="Día">
        {atajos.map(({ etiqueta, fecha }) => {
          const activo = desde === fecha && hasta === fecha;
          return (
            <button
              key={etiqueta}
              type="button"
              className={`suave${activo ? ' activo' : ''}`}
              aria-pressed={activo}
              onClick={() => {
                alCambiarDesde(fecha);
                alCambiarHasta(fecha);
              }}
            >
              {etiqueta}
            </button>
          );
        })}
      </div>
    </div>
  );
}
