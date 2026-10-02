import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Pagina, ReporteParada, ReporteViaje, ResumenReporte } from '@contratos';
import { api, consulta } from '@/lib/api';
import { Tarjeta, CabeceraTarjeta } from '@/componentes/ui/Tarjeta';
import { Segmentado } from '@/componentes/ui/Segmentado';
import { Entrada, Selector } from '@/componentes/ui/Campo';
import { Tabla, Th, Td, Fila } from '@/componentes/ui/Tabla';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { CACHE_AUDITORIA_MS, CLAVE_FLOTA, equiposHabilitados, traerFlota } from '@/dominio/datos';
import { GUION, duracion, fechaHora, kilometros, velocidad } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';
import { fechaHaceDias, fechaHoyLocal, finDeDia, inicioDeDia } from '@/dominio/rango';
import GraficoDistancia from '@/componentes/reportes/GraficoDistancia';
import Paginacion from '@/componentes/reportes/Paginacion';
import Persona from '@/componentes/reportes/Persona';

const TAMANO = 25;

type Pestana = 'resumen' | 'viajes' | 'paradas';
type Periodo = 'hoy' | '7' | '30';

const PESTANAS = [
  { valor: 'resumen', etiqueta: 'Resumen' },
  { valor: 'viajes', etiqueta: 'Viajes' },
  { valor: 'paradas', etiqueta: 'Paradas' },
] as const;

const PERIODOS = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: '7', etiqueta: '7 días' },
  { valor: '30', etiqueta: '30 días' },
] as const;


function rangoDePeriodo(periodo: Periodo): { desde: string; hasta: string } {
  const dias = periodo === 'hoy' ? 0 : Number(periodo);
  return { desde: fechaHaceDias(dias), hasta: fechaHoyLocal() };
}

function fechaValida(valor: string): boolean {
  return valor !== '' && !Number.isNaN(new Date(`${valor}T00:00:00`).getTime());
}

export default function Recorridos({ pestanas }: { pestanas?: ReactNode }) {
  const flota = useQuery({ queryKey: CLAVE_FLOTA, queryFn: () => traerFlota(), staleTime: 60_000 });
  const [equipo, setEquipo] = useState('');
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [periodo, setPeriodo] = useState<Periodo | null>('7');
  const [rango, setRango] = useState(() => rangoDePeriodo('7'));
  const [paginaViajes, setPaginaViajes] = useState(1);
  const [paginaParadas, setPaginaParadas] = useState(1);

  // Personas en orden alfabético; sin elección, se muestra la primera.
  const personas = useMemo(
    () => equiposHabilitados(flota.data?.datos ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [flota.data],
  );
  const elegido = equipo || personas[0]?.idPublico || '';

  const filtros = {
    dispositivoId: elegido || undefined,
    desde: fechaValida(rango.desde) ? inicioDeDia(rango.desde) : undefined,
    hasta: fechaValida(rango.hasta) ? finDeDia(rango.hasta) : undefined,
  };

  const viajes = useQuery({
    queryKey: ['reportes', 'viajes', filtros, paginaViajes],
    enabled: pestana === 'viajes' && elegido !== '',
    placeholderData: keepPreviousData,
    staleTime: CACHE_AUDITORIA_MS,
    queryFn: () =>
      api.get<Pagina<ReporteViaje>>(
        `/api/v1/reports/trips${consulta({ ...filtros, pagina: paginaViajes, tamano: TAMANO, orden: '-inicio' })}`,
      ),
  });

  const paradas = useQuery({
    queryKey: ['reportes', 'paradas', filtros, paginaParadas],
    enabled: pestana === 'paradas' && elegido !== '',
    placeholderData: keepPreviousData,
    staleTime: CACHE_AUDITORIA_MS,
    queryFn: () =>
      api.get<Pagina<ReporteParada>>(
        `/api/v1/reports/stops${consulta({ ...filtros, pagina: paginaParadas, tamano: TAMANO, orden: '-inicio' })}`,
      ),
  });

  const resumen = useQuery({
    queryKey: ['reportes', 'resumen', filtros],
    enabled: elegido !== '',
    placeholderData: keepPreviousData,
    staleTime: CACHE_AUDITORIA_MS,
    queryFn: () => api.get<ResumenReporte>(`/api/v1/reports/summary${consulta(filtros)}`),
  });

  // Los reportes traen el id anterior; con la lista de equipos se pasa a
  // nombre (sin coincidencia se muestra "—").
  const nombres = useMemo(() => new Map(personas.map((d) => [d.id, d.nombre])), [personas]);

  function reiniciarPaginas() {
    setPaginaViajes(1);
    setPaginaParadas(1);
  }

  function cambiarPeriodo(valor: Periodo) {
    setPeriodo(valor);
    setRango(rangoDePeriodo(valor));
    reiniciarPaginas();
  }

  function cambiarFecha(parcial: { desde?: string; hasta?: string }) {
    setPeriodo(null);
    setRango((actual) => ({ ...actual, ...parcial }));
    reiniciarPaginas();
  }

  const r = resumen.data;

  return (
    <div className="space-y-4">
      <Tarjeta className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {pestanas}
        <Selector
          aria-label="Persona"
          className="w-44"
          value={elegido}
          onChange={(e) => {
            setEquipo(e.target.value);
            reiniciarPaginas();
          }}
        >
          {personas.map((p) => (
            <option key={p.idPublico} value={p.idPublico}>
              {p.nombre}
            </option>
          ))}
        </Selector>
        <Segmentado opciones={PERIODOS} valor={periodo} alCambiar={cambiarPeriodo} />
        <Entrada
          type="date"
          aria-label="Desde"
          className="w-36"
          value={rango.desde}
          max={rango.hasta || undefined}
          onChange={(e) => cambiarFecha({ desde: e.target.value })}
        />
        <Entrada
          type="date"
          aria-label="Hasta"
          className="w-36"
          value={rango.hasta}
          min={rango.desde || undefined}
          onChange={(e) => cambiarFecha({ hasta: e.target.value })}
        />
      </Tarjeta>

      {flota.error && <ErrorCarga mensaje={mensajeError(flota.error)} alReintentar={() => flota.refetch()} />}
      {resumen.error && <ErrorCarga mensaje={mensajeError(resumen.error)} alReintentar={() => resumen.refetch()} />}

      <Tarjeta className="grid grid-cols-2 divide-borde overflow-hidden sm:grid-cols-5 sm:divide-x">
        {[
          ['Distancia total', r ? kilometros(r.distanciaTotalKm * 1000) : GUION],
          ['Tiempo en movimiento', r ? duracion(r.duracionTotalMin * 60) : GUION],
          ['Viajes', r ? r.viajes : GUION],
          ['Paradas', r ? r.paradas : GUION],
          ['Personas', r ? r.dispositivos : GUION],
        ].map(([texto, valor]) => (
          <div key={String(texto)} className="px-4 py-3">
            <span className="block text-[12px] text-texto-2">{texto}</span>
            <span className="text-[20px] leading-tight font-semibold text-marino-900 cifras">{valor}</span>
          </div>
        ))}
      </Tarjeta>
      <p className="text-[12px] text-texto-3">
        {r
          ? `Rango consultado: ${fechaHora(r.desde)} — ${fechaHora(r.hasta)}`
          : resumen.error
            ? 'No se pudo calcular el resumen del rango.'
            : 'Consultando el rango seleccionado…'}
      </p>

      <Tarjeta>
        <CabeceraTarjeta titulo="Distancia por persona" detalle={r ? `${r.porDispositivo.length} personas` : undefined} />
        <div className="px-5 pb-5">
          {resumen.isPending ? (
            <Cargando />
          ) : r && r.porDispositivo.length > 0 ? (
            <GraficoDistancia
              filas={r.porDispositivo}
              resaltarId={elegido}
            />
          ) : (
            <Vacio titulo="Sin actividad">No hay actividad de personas en el rango.</Vacio>
          )}
        </div>
      </Tarjeta>

      <Tarjeta>
        <CabeceraTarjeta
          titulo="Detalle"
          detalle={
            pestana === 'viajes' && viajes.data
              ? `${viajes.data.total} registros`
              : pestana === 'paradas' && paradas.data
                ? `${paradas.data.total} registros`
                : pestana === 'resumen' && r
                  ? `${r.porDispositivo.length} personas`
                  : undefined
          }
          acciones={<Segmentado opciones={PESTANAS} valor={pestana} alCambiar={setPestana} />}
        />

        {pestana === 'resumen' && (
          <>
            {resumen.isPending && <Cargando />}
            {r && r.porDispositivo.length === 0 && <Vacio titulo="Sin actividad">No hay actividad de personas en el rango.</Vacio>}
            {r && r.porDispositivo.length > 0 && (
              <Tabla>
                <thead>
                  <tr>
                    <Th>Persona</Th>
                    <Th numerico>Distancia</Th>
                    <Th numerico>Duración</Th>
                    <Th numerico>Viajes</Th>
                    <Th numerico>Paradas</Th>
                    <Th>Última posición</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.porDispositivo.map((d) => (
                    <Fila key={d.dispositivoId}>
                      <Td><Persona nombre={d.nombre} /></Td>
                      <Td numerico>{kilometros(d.distanciaKm * 1000)}</Td>
                      <Td numerico>{duracion(d.duracionMin * 60)}</Td>
                      <Td numerico>{d.viajes}</Td>
                      <Td numerico>{d.paradas}</Td>
                      <Td className="whitespace-nowrap">{fechaHora(d.ultimaPosicionEn)}</Td>
                    </Fila>
                  ))}
                </tbody>
              </Tabla>
            )}
          </>
        )}

        {pestana === 'viajes' && (
          <>
            {viajes.isPending && <Cargando texto="Cargando viajes…" />}
            {viajes.error && <div className="px-5 pb-4"><ErrorCarga mensaje={mensajeError(viajes.error)} alReintentar={() => viajes.refetch()} /></div>}
            {viajes.data && viajes.data.datos.length === 0 && <Vacio titulo="Sin viajes">No hay viajes en el rango.</Vacio>}
            {viajes.data && viajes.data.datos.length > 0 && (
              <>
                <Tabla>
                  <thead>
                    <tr>
                      <Th>Persona</Th>
                      <Th>Inició</Th>
                      <Th>Finalizó</Th>
                      <Th numerico>Duración</Th>
                      <Th numerico>Distancia</Th>
                      <Th numerico>Vel. promedio</Th>
                      <Th numerico>Vel. máxima</Th>
                      <Th numerico>Paradas</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {viajes.data.datos.map((v) => (
                      <Fila key={v.id}>
                        <Td><Persona nombre={nombres.get(v.dispositivoId)} /></Td>
                        <Td className="whitespace-nowrap">{fechaHora(v.inicio)}</Td>
                        <Td className="whitespace-nowrap">{fechaHora(v.fin)}</Td>
                        <Td numerico>{duracion(v.duracionMin * 60)}</Td>
                        <Td numerico>{kilometros(v.distanciaKm * 1000)}</Td>
                        <Td numerico>{velocidad(v.velocidadPromedioKmh)}</Td>
                        <Td numerico>{velocidad(v.velocidadMaximaKmh)}</Td>
                        <Td numerico>{v.paradas}</Td>
                      </Fila>
                    ))}
                  </tbody>
                </Tabla>
                <Paginacion pagina={viajes.data.pagina} tamano={viajes.data.tamano} total={viajes.data.total} alCambiar={setPaginaViajes} />
              </>
            )}
          </>
        )}

        {pestana === 'paradas' && (
          <>
            {paradas.isPending && <Cargando texto="Cargando paradas…" />}
            {paradas.error && <div className="px-5 pb-4"><ErrorCarga mensaje={mensajeError(paradas.error)} alReintentar={() => paradas.refetch()} /></div>}
            {paradas.data && paradas.data.datos.length === 0 && <Vacio titulo="Sin paradas">No hay paradas en el rango.</Vacio>}
            {paradas.data && paradas.data.datos.length > 0 && (
              <>
                <Tabla>
                  <thead>
                    <tr>
                      <Th>Persona</Th>
                      <Th>Inició</Th>
                      <Th>Finalizó</Th>
                      <Th numerico>Duración</Th>
                      <Th>Dirección</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {paradas.data.datos.map((p) => (
                      <Fila key={p.id}>
                        <Td><Persona nombre={nombres.get(p.dispositivoId)} /></Td>
                        <Td className="whitespace-nowrap">{fechaHora(p.inicio)}</Td>
                        <Td className="whitespace-nowrap">{fechaHora(p.fin)}</Td>
                        <Td numerico>{duracion(p.duracionMin * 60)}</Td>
                        {/* Sin dirección se muestran las coordenadas reales, nunca un texto inventado. */}
                        <Td className="min-w-64">{p.direccion ?? `${p.latitud.toFixed(5)}, ${p.longitud.toFixed(5)}`}</Td>
                      </Fila>
                    ))}
                  </tbody>
                </Tabla>
                <Paginacion pagina={paradas.data.pagina} tamano={paradas.data.tamano} total={paradas.data.total} alCambiar={setPaginaParadas} />
              </>
            )}
          </>
        )}
      </Tarjeta>
    </div>
  );
}
