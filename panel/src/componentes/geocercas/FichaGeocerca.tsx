import { useState } from 'react';
import { History, Pencil, Power, RotateCcw, X } from 'lucide-react';
import { fechaHora, GUION } from '@/dominio/formatoBase';
import { Boton, BotonIcono } from '@/componentes/ui/Boton';
import HistorialGeocerca from './HistorialGeocerca';
import { colorTipo, etiquetaTipo } from './logica';
import type { Geocerca } from './logica';

// Ficha de una geocerca sobre el mapa: datos, quién la creó y la última
// edición, con acceso al historial.
export default function FichaGeocerca({
  geocerca,
  puedeEditar,
  alCerrar,
  alEditar,
  alCambiarEstado,
}: {
  geocerca: Geocerca;
  puedeEditar: boolean;
  alCerrar: () => void;
  alEditar: () => void;
  alCambiarEstado: () => void;
}) {
  const [verHistorial, setVerHistorial] = useState(false);
  // Pegada debajo del selector de mapas, con su mismo ancho y borde izquierdo
  // (igual que el cuadro de dibujo de geocercas).
  const alinear = (caja: HTMLDivElement | null) => {
    const selector = caja?.parentElement?.querySelector<HTMLElement>('[aria-label="Capa del mapa"]');
    if (!caja || !selector) return;
    caja.style.width = `${selector.offsetWidth}px`;
    caja.style.left = `${selector.offsetLeft}px`;
    caja.style.top = `${selector.offsetTop + selector.offsetHeight}px`;
  };
  return (
    <div
      ref={alinear}
      className="absolute z-[6] max-h-[calc(100%-96px)] overflow-y-auto rounded-bl-tarjeta border-b border-l border-borde bg-superficie p-3 text-[13px] shadow-flotante"
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: colorTipo(geocerca.tipo) }} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold">{geocerca.nombre}</h3>
          <p className="text-[12px] text-texto-2">
            {etiquetaTipo(geocerca.tipo)}
            {!geocerca.activo && ' · De baja'}
          </p>
        </div>
        <BotonIcono icono={X} etiqueta="Cerrar" onClick={alCerrar} />
      </div>
      <dl className="mt-2 space-y-1 text-[12.5px]">
        <div>
          <dt className="inline text-texto-3">Creada por </dt>
          <dd className="inline">
            {geocerca.creadoPor || GUION} · {fechaHora(geocerca.creadoEn)}
          </dd>
        </div>
        <div>
          <dt className="inline text-texto-3">Última edición </dt>
          <dd className="inline">
            {geocerca.editadoPor ? `${geocerca.editadoPor} · ${fechaHora(geocerca.actualizadoEn)}` : GUION}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {puedeEditar && geocerca.activo && (
          <Boton tamano="sm" icono={Pencil} onClick={alEditar}>
            Editar
          </Boton>
        )}
        {puedeEditar && (
          <Boton tamano="sm" variante={geocerca.activo ? 'peligro' : 'secundario'} icono={geocerca.activo ? Power : RotateCcw} onClick={alCambiarEstado}>
            {geocerca.activo ? 'Dar de baja' : 'Restaurar'}
          </Boton>
        )}
        <Boton tamano="sm" icono={History} onClick={() => setVerHistorial((v) => !v)} aria-expanded={verHistorial}>
          Historial
        </Boton>
      </div>
      {verHistorial && (
        <div className="mt-2 border-t border-borde pt-2">
          <HistorialGeocerca id={geocerca.id} />
        </div>
      )}
    </div>
  );
}
