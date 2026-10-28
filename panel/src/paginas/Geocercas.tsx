import { Fragment, useMemo, useState } from 'react';
import { Building2, History, Pencil, Power, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useSesion } from '@/lib/sesion';
import { GUION, fechaHora } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';
import { useGeocercas, useGuardarGeocerca } from '@/dominio/geocercas';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { BotonIcono } from '@/componentes/ui/Boton';
import { Selector } from '@/componentes/ui/Campo';
import { Insignia } from '@/componentes/ui/ChipEstado';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { Segmentado } from '@/componentes/ui/Segmentado';
import { CabeceraTarjeta, Tarjeta } from '@/componentes/ui/Tarjeta';
import { Fila, Tabla, Td, Th } from '@/componentes/ui/Tabla';
import { Buscador } from '@/componentes/admin/comunes';
import FormularioGeocerca from '@/componentes/geocercas/FormularioGeocerca';
import type { DatosFormulario } from '@/componentes/geocercas/FormularioGeocerca';
import HistorialGeocerca from '@/componentes/geocercas/HistorialGeocerca';
import { TIPOS, colorTipo, etiquetaTipo } from '@/componentes/geocercas/logica';
import type { Geocerca } from '@/componentes/geocercas/logica';
import Clientes from './Clientes';

// Geocercas: las zonas dibujadas en el mapa (casa, cliente, oficina...). Se
// crean desde Seguimiento o Repetición de ruta con el botón del edificio; aquí
// se revisan, se corrigen sus datos y se consulta su historial. La segunda
// pestaña conserva la lista de clientes que usa la app al registrar
// actividades.

type Pestana = 'geocercas' | 'clientes';
type Accion = { modo: 'editar' | 'estado'; geocerca: Geocerca } | null;

function ListaGeocercas() {
  const soloLectura = useSesion((s) => s.usuario?.soloLectura === true);
  const lista = useGeocercas(true);
  const guardar = useGuardarGeocerca();
  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('');
  const [abierta, setAbierta] = useState<number | null>(null);
  const [accion, setAccion] = useState<Accion>(null);
  const [error, setError] = useState<string | null>(null);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (lista.data?.datos ?? []).filter(
      (g) => (!tipo || g.tipo === tipo) && (!q || `${g.nombre} ${g.creadoPor} ${g.editadoPor ?? ''}`.toLowerCase().includes(q)),
    );
  }, [lista.data, busqueda, tipo]);

  function alGuardar(datos: DatosFormulario) {
    if (!accion) return;
    const { modo, geocerca } = accion;
    setError(null);
    guardar.mutate(
      {
        id: geocerca.id,
        cambios:
          modo === 'editar'
            ? { nombre: datos.nombre, tipo: datos.tipo, quien: datos.quien }
            : { activo: !geocerca.activo, quien: datos.quien },
      },
      {
        onSuccess: () => {
          toast.success(modo === 'editar' ? 'Geocerca guardada.' : geocerca.activo ? 'Geocerca dada de baja.' : 'Geocerca restaurada.');
          setAccion(null);
        },
        onError: (e) => setError(mensajeError(e)),
      },
    );
  }

  const g = accion?.geocerca;
  return (
    <div className="space-y-5">
      <AccionesPagina>
        <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar geocerca" />
        <Selector value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Filtrar por tipo" className="w-36">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </Selector>
      </AccionesPagina>

      <Tarjeta>
        <CabeceraTarjeta
          titulo="Geocercas"
          detalle={lista.data ? `${lista.data.datos.filter((x) => x.activo).length} activas` : 'Consultando…'}
        />
        <p className="px-5 pb-3 text-[12.5px] text-texto-2">
          Para crear una, usa el botón del edificio en el mapa de Seguimiento o de Repetición de ruta.
        </p>
        {lista.isPending && <Cargando texto="Cargando geocercas…" />}
        {lista.error && <ErrorCarga mensaje={mensajeError(lista.error)} alReintentar={() => void lista.refetch()} />}
        {lista.data && visibles.length === 0 && (
          <Vacio titulo="Sin geocercas">No hay geocercas que coincidan con la búsqueda.</Vacio>
        )}
        {visibles.length > 0 && (
          <Tabla>
            <thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Tipo</Th>
                <Th className="max-lg:hidden">Creada por</Th>
                <Th className="max-lg:hidden">Última edición</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((x) => (
                <Fragment key={x.id}>
                  <Fila onClick={() => setAbierta(abierta === x.id ? null : x.id)} seleccionada={abierta === x.id}>
                    <Td className="font-semibold text-marino-900">{x.nombre}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: colorTipo(x.tipo) }} />
                        {etiquetaTipo(x.tipo)}
                      </span>
                    </Td>
                    <Td className="max-lg:hidden">
                      {x.creadoPor || GUION}
                      <p className="text-[11.5px] text-texto-3">{fechaHora(x.creadoEn)}</p>
                    </Td>
                    <Td className="max-lg:hidden">
                      {x.editadoPor ? (
                        <>
                          {x.editadoPor}
                          <p className="text-[11.5px] text-texto-3">{fechaHora(x.actualizadoEn)}</p>
                        </>
                      ) : (
                        GUION
                      )}
                    </Td>
                    <Td>{x.activo ? <Insignia tono="exito">Activa</Insignia> : <Insignia tono="neutro">De baja</Insignia>}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <BotonIcono icono={History} etiqueta="Ver historial" onClick={() => setAbierta(abierta === x.id ? null : x.id)} />
                        {!soloLectura && x.activo && (
                          <BotonIcono icono={Pencil} etiqueta="Editar datos" onClick={() => setAccion({ modo: 'editar', geocerca: x })} />
                        )}
                        {!soloLectura && (
                          <BotonIcono
                            icono={x.activo ? Power : RotateCcw}
                            etiqueta={x.activo ? 'Dar de baja' : 'Restaurar'}
                            peligro={x.activo}
                            onClick={() => setAccion({ modo: 'estado', geocerca: x })}
                          />
                        )}
                      </div>
                    </Td>
                  </Fila>
                  {abierta === x.id && (
                    <tr>
                      <td colSpan={6} className="bg-fondo/60 px-5 py-3">
                        <p className="mb-1 text-[12px] font-semibold">Historial</p>
                        <HistorialGeocerca id={x.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      <FormularioGeocerca
        abierto={accion != null}
        soloQuien={accion?.modo === 'estado'}
        titulo={
          accion?.modo === 'editar' ? 'Editar geocerca' : g?.activo ? `Dar de baja “${g.nombre}”` : `Restaurar “${g?.nombre ?? ''}”`
        }
        inicial={g ? { nombre: g.nombre, tipo: g.tipo } : undefined}
        guardando={guardar.isPending}
        error={error}
        alGuardar={alGuardar}
        alCancelar={() => {
          setAccion(null);
          setError(null);
        }}
      />
    </div>
  );
}

export default function Geocercas() {
  const [pestana, setPestana] = useState<Pestana>('geocercas');
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Building2 className="size-5 text-texto-2" aria-hidden="true" />
        <Segmentado
          opciones={[
            { valor: 'geocercas', etiqueta: 'Geocercas' },
            { valor: 'clientes', etiqueta: 'Clientes de la app' },
          ]}
          valor={pestana}
          alCambiar={setPestana}
        />
      </div>
      {pestana === 'geocercas' ? <ListaGeocercas /> : <Clientes />}
    </div>
  );
}

