import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Store } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import { GUION } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { Boton, BotonIcono } from '@/componentes/ui/Boton';
import { AreaTexto, Campo, Entrada } from '@/componentes/ui/Campo';
import { Insignia } from '@/componentes/ui/ChipEstado';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { CabeceraTarjeta, Tarjeta } from '@/componentes/ui/Tarjeta';
import { Fila, Tabla, Td, Th } from '@/componentes/ui/Tabla';
import { Buscador } from '@/componentes/admin/comunes';
import { leerLineas } from '@/dominio/clientes';
import { DialogoFormulario } from '@/componentes/admin/FormularioBase';

// Clientes: los lugares que visitan los colaboradores. En la app los eligen de
// esta lista al registrar una actividad (y pueden agregar uno nuevo desde la
// parada donde están). Con la ubicación, el cronograma compara el cliente
// declarado con donde estuvo el teléfono.

interface Cliente {
  id: number;
  nombre: string;
  direccion: string | null;
  lat: number | null;
  lon: number | null;
  activo: boolean;
  visitas: number;
  creadoEnApp: boolean;
}

const CLAVE = ['clientes'] as const;

function leerUbicacion(texto: string): { lat: number | null; lon: number | null } | null {
  if (!texto.trim()) return { lat: null, lon: null };
  const numeros = texto.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numeros.length === 2 ? { lat: numeros[0], lon: numeros[1] } : null;
}

type Modal = { modo: 'agregar' } | { modo: 'editar'; cliente: Cliente } | null;

export default function Clientes() {
  const cliente = useQueryClient();
  const soloLectura = useSesion((estado) => estado.usuario?.soloLectura === true);
  const [busqueda, setBusqueda] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [lineas, setLineas] = useState('');
  const [edicion, setEdicion] = useState({ nombre: '', direccion: '', ubicacion: '' });

  const lista = useQuery({ queryKey: CLAVE, queryFn: () => api.get<{ datos: Cliente[] }>('/api/v1/clientes') });
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const datos = lista.data?.datos ?? [];
    return q ? datos.filter((c) => `${c.nombre} ${c.direccion ?? ''}`.toLowerCase().includes(q)) : datos;
  }, [lista.data, busqueda]);

  const agregar = useMutation({
    mutationFn: (clientes: ReturnType<typeof leerLineas>) =>
      api.post<{ creados: number; repetidos: number }>('/api/v1/clientes', { clientes }),
    onSuccess: (r) => {
      void cliente.invalidateQueries({ queryKey: CLAVE });
      toast.success(`${r.creados} agregados${r.repetidos > 0 ? ` · ${r.repetidos} ya estaban` : ''}.`);
      setModal(null);
      setLineas('');
    },
    onError: (error) => toast.error(mensajeError(error)),
  });

  const editar = useMutation({
    mutationFn: ({ id, cambios }: { id: number; cambios: Record<string, unknown> }) =>
      api.patch<{ cliente: Cliente }>(`/api/v1/clientes/${id}`, cambios),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: CLAVE });
      toast.success('Cliente guardado.');
      setModal(null);
    },
    onError: (error) => toast.error(mensajeError(error)),
  });

  function abrirEditar(c: Cliente) {
    setEdicion({
      nombre: c.nombre,
      direccion: c.direccion ?? '',
      ubicacion: c.lat != null && c.lon != null ? `${c.lat}, ${c.lon}` : '',
    });
    setModal({ modo: 'editar', cliente: c });
  }

  function guardarEdicion(c: Cliente) {
    const ubicacion = leerUbicacion(edicion.ubicacion);
    if (!ubicacion) {
      toast.error('La ubicación va como "latitud, longitud" (por ejemplo -2.19, -79.88).');
      return;
    }
    editar.mutate({ id: c.id, cambios: { nombre: edicion.nombre, direccion: edicion.direccion, lat: ubicacion.lat, lon: ubicacion.lon } });
  }

  const sinUbicacion = (lista.data?.datos ?? []).filter((c) => c.activo && c.lat == null).length;

  return (
    <div className="space-y-5">
      <AccionesPagina>
        <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar cliente" />
        {!soloLectura && (
          <Boton variante="principal" icono={Plus} onClick={() => setModal({ modo: 'agregar' })}>
            Agregar clientes
          </Boton>
        )}
      </AccionesPagina>

      <Tarjeta>
        <CabeceraTarjeta
          titulo="Clientes"
          detalle={
            lista.data
              ? `${lista.data.datos.filter((c) => c.activo).length} activos${sinUbicacion > 0 ? ` · ${sinUbicacion} sin ubicación` : ''}`
              : 'Consultando…'
          }
        />
        {lista.isPending && <Cargando texto="Cargando clientes…" />}
        {lista.error && (
          <div className="px-5 pb-5">
            <ErrorCarga mensaje={mensajeError(lista.error)} alReintentar={() => void lista.refetch()} />
          </div>
        )}
        {lista.data && visibles.length === 0 && (
          <Vacio icono={Store} titulo={busqueda.trim() ? 'Sin resultados' : 'Todavía no hay clientes'}>
            {busqueda.trim()
              ? 'Ningún cliente coincide con la búsqueda.'
              : 'Agrega la lista (puedes pegarla desde Excel) o deja que los colaboradores los agreguen desde la app.'}
          </Vacio>
        )}
        {visibles.length > 0 && (
          <Tabla>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Dirección</Th>
                <Th>Ubicación</Th>
                <Th className="text-right">Visitas</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <Fila key={c.id}>
                  <Td>
                    <p className="font-semibold text-marino-900">{c.nombre}</p>
                    {c.creadoEnApp && <p className="text-[11.5px] text-texto-3">Agregado desde la app</p>}
                  </Td>
                  <Td className="max-w-72">{c.direccion ?? GUION}</Td>
                  <Td>
                    {c.lat != null && c.lon != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${c.lat},${c.lon}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-marino-700 hover:text-marca"
                      >
                        <MapPin className="size-3.5" /> Ver en el mapa
                      </a>
                    ) : (
                      <span className="text-sin-senal">Sin ubicación</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{c.visitas}</Td>
                  <Td>{c.activo ? <Insignia tono="exito">Activo</Insignia> : <Insignia tono="neutro">Retirado</Insignia>}</Td>
                  <Td>
                    {!soloLectura && (
                      <div className="flex items-center justify-end gap-1">
                        <BotonIcono icono={Pencil} etiqueta={`Editar ${c.nombre}`} onClick={() => abrirEditar(c)} />
                        <Boton
                          tamano="sm"
                          onClick={() => editar.mutate({ id: c.id, cambios: { activo: !c.activo } })}
                          disabled={editar.isPending}
                        >
                          {c.activo ? 'Retirar' : 'Reactivar'}
                        </Boton>
                      </div>
                    )}
                  </Td>
                </Fila>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      {modal?.modo === 'agregar' && (
        <DialogoFormulario
          id="agregar-clientes"
          titulo="Agregar clientes"
          descripcion='Uno por línea: "Nombre | Dirección | latitud, longitud". La dirección y la ubicación son opcionales; puedes pegar las columnas desde Excel.'
          alCerrar={() => setModal(null)}
          alEnviar={() => {
            const clientes = leerLineas(lineas);
            if (clientes.length === 0) toast.error('Escribe al menos un cliente.');
            else agregar.mutate(clientes);
          }}
          guardando={agregar.isPending}
          etiquetaGuardar={`Agregar ${leerLineas(lineas).length || ''}`.trim()}
        >
          <Campo etiqueta="Clientes">
            <AreaTexto
              id="clientes-lineas"
              rows={10}
              value={lineas}
              onChange={(e) => setLineas(e.target.value)}
              placeholder={'Farmacia Central | Av. 9 de Octubre y Boyacá | -2.1894, -79.8853\nTienda El Sol | Calle 10 y Av. Quito'}
            />
          </Campo>
        </DialogoFormulario>
      )}

      {modal?.modo === 'editar' && (
        <DialogoFormulario
          id="editar-cliente"
          titulo="Editar cliente"
          alCerrar={() => setModal(null)}
          alEnviar={() => guardarEdicion(modal.cliente)}
          guardando={editar.isPending}
        >
          <Campo etiqueta="Nombre">
            <Entrada id="cliente-nombre" value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} />
          </Campo>
          <Campo etiqueta="Dirección">
            <Entrada id="cliente-direccion" value={edicion.direccion} onChange={(e) => setEdicion({ ...edicion, direccion: e.target.value })} />
          </Campo>
          <Campo etiqueta="Ubicación" ayuda='Latitud y longitud, por ejemplo "-2.1894, -79.8853" (en Google Maps: clic derecho sobre el lugar).'>
            <Entrada id="cliente-ubicacion" value={edicion.ubicacion} onChange={(e) => setEdicion({ ...edicion, ubicacion: e.target.value })} />
          </Campo>
        </DialogoFormulario>
      )}
    </div>
  );
}
