import { useState } from 'react';
import { duracion } from '@/dominio/formatoBase';
import Icono from './Icono';
import { etiquetaVisita } from '@/dominio/dia';
import {
  horaCorta,
  duracionCorta,
  milisegundos,
} from '@/dominio/replay';
import type { Parada } from '@/dominio/replay';
import {
  useReproductor,
  useDireccion,
} from './contextoReproductor';

// Fila de parada: desde/hasta, duración, extremo del recorrido y dirección. El
// geocode se pide solo para la primera fila (referencia de la zona) y para la
// seleccionada; el resto muestra la dirección que ya trajo el servidor.
function FilaParada({
  parada,
  indice,
  primera,
  ultima,
  activa,
  etiquetaDelRol,
}: {
  parada: Parada;
  indice: number;
  primera: boolean;
  ultima: boolean;
  activa: boolean;
  etiquetaDelRol: string | null;
}) {
  const { seleccionarParada } = useReproductor();
  const pideDireccion = (primera || activa) && !parada.direccion;
  const geocodificada = useDireccion(
    pideDireccion ? (parada.latitudRepresentativa ?? parada.latitud) : null,
    pideDireccion ? (parada.longitudRepresentativa ?? parada.longitud) : null,
    pideDireccion,
    parada.precisionM ?? null,
  );
  const direccion = parada.direccion ?? geocodificada;
  const clases = [primera ? 'primera' : '', ultima ? 'ultima' : '', activa ? 'activa' : ''].filter(Boolean).join(' ');
  return (
    <li className={clases}>
      <button
        type="button"
        onClick={() => seleccionarParada(indice, parada.latitud, parada.longitud, milisegundos(parada.inicio))}
        title={`Desde ${horaCorta(parada.inicio)} hasta ${horaCorta(parada.fin)} (${duracion(parada.duracionMin * 60)})`}
      >
        <span className="parada-cabecera">
          <span className="parada-hora">
            Desde {horaCorta(parada.inicio)} hasta {horaCorta(parada.fin)}
          </span>
          {etiquetaDelRol ? (
            <span className="parada-rol">{etiquetaDelRol}</span>
          ) : (
            (primera || ultima) && <span className="parada-extremo">{primera ? 'Primera' : 'Última'}</span>
          )}
          <span className="parada-tiempo">{duracion(parada.duracionMin * 60)}</span>
        </span>
        {direccion && <span className="parada-direccion">{direccion}</span>}
      </button>
    </li>
  );
}

// Lista de paradas, abierta al cargar el recorrido. `origen` dice si vienen
// del servidor o del cálculo local, para avisar solo cuando el servidor
// falló. Se listan todas; el panel tiene su propio scroll.
export function ListaParadas({
  paradas,
  origen,
  total,
}: {
  paradas: Parada[];
  origen: 'servidor' | 'local';
  total?: number;
}) {
  const [abiertas, setAbiertas] = useState(true);
  const [microAbiertas, setMicroAbiertas] = useState(false);
  // La parada activa vive en el reproductor: elegirla desde su insignia del
  // mapa también resalta su fila, y viceversa.
  const { paradaSeleccionada, microparadas, seleccionarParada, resumen } = useReproductor();
  if (paradas.length === 0 && microparadas.length === 0) return null;
  // El total del servidor puede superar las filas cargadas (tope de la
  // consulta): "y N más" cuenta lo que quedó fuera de la carga.
  const restantes = Math.max(total ?? paradas.length, paradas.length) - paradas.length;
  return (
    <section className="replay-paradas">
      <button
        type="button"
        className="replay-plegar-paradas"
        onClick={() => setAbiertas((valor) => !valor)}
        aria-expanded={abiertas}
      >
        Paradas ({paradas.length})
        <Icono nombre="flecha" />
      </button>
      {origen === 'local' && <p className="replay-nota">Calculadas con los datos del recorrido: el servidor no respondió.</p>}
      {abiertas && (
        <>
          <ul>
            {paradas.map((parada, posicion) => (
              <FilaParada
                key={`${parada.inicio}-${posicion}`}
                parada={parada}
                indice={posicion}
                primera={posicion === 0}
                ultima={posicion === paradas.length - 1}
                activa={paradaSeleccionada === posicion}
                etiquetaDelRol={resumen ? etiquetaVisita(resumen.numeroVisita[posicion]) : null}
              />
            ))}
          </ul>
          {restantes > 0 && <p className="replay-nota">y {restantes} más</p>}
        </>
      )}
      {/* Microparadas: detenciones de 40 s a 3 min en medio de un trayecto.
          Plegadas por defecto; no se numeran ni cortan viajes. */}
      {microparadas.length > 0 && (
        <>
          <button
            type="button"
            className="replay-plegar-paradas replay-plegar-micro"
            onClick={() => setMicroAbiertas((valor) => !valor)}
            aria-expanded={microAbiertas}
          >
            Microparadas ({microparadas.length})
            <Icono nombre="flecha" />
          </button>
          {microAbiertas && (
            <ul className="replay-microparadas">
              {microparadas.map((micro) => (
                <li key={micro.inicio}>
                  <button
                    type="button"
                    onClick={() => seleccionarParada(null, micro.latitud, micro.longitud, milisegundos(micro.inicio))}
                  >
                    <span className="parada-hora">
                      {horaCorta(micro.inicio)} – {horaCorta(micro.fin)}
                    </span>
                    <span className="parada-tiempo">{duracionCorta(micro.duracionS)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
