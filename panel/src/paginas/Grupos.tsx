import { cn } from '@/lib/cn';
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UsersRound, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import type { CreacionGrupo, GrupoPlataforma, UsuarioPlataforma } from '@contratos';
import { api } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import { GUION } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';
import { traerGrupos, traerUsuariosPlataforma } from '@/dominio/datos';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { Avatar } from '@/componentes/ui/Avatar';
import { Boton, BotonIcono } from '@/componentes/ui/Boton';
import { Campo, Casilla, Entrada } from '@/componentes/ui/Campo';
import { Dialogo } from '@/componentes/ui/Dialogo';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { CabeceraTarjeta, Tarjeta } from '@/componentes/ui/Tarjeta';
import { Fila, Tabla, Td, Th } from '@/componentes/ui/Tabla';
import {
  AvisoError,
  Buscador,
  CACHE_PLATAFORMA_MS,
  Paginacion,
  SinPermiso,
  TAMANO_PAGINA,
  esErrorDeEstado,
} from '@/componentes/admin/comunes';
import { DialogoConfirmar, DialogoFormulario } from '@/componentes/admin/FormularioBase';

function idEnUrl(grupo: GrupoPlataforma): string {
  return encodeURIComponent(String(grupo.idPublico ?? grupo.id));
}

function claveUsuario(usuario: UsuarioPlataforma): string {
  return String(usuario.idPublico ?? usuario.id);
}

// El servidor puede mandar los miembros como ids o con nombre; se aceptan las
// dos formas.
function idsMiembros(grupo: GrupoPlataforma): string[] {
  if (grupo.usuarioIds && grupo.usuarioIds.length > 0) return grupo.usuarioIds.map((id) => String(id));
  if (grupo.miembros && grupo.miembros.length > 0) {
    return grupo.miembros
      .map((miembro) => String(miembro.idPublico ?? miembro.id ?? miembro.usuario ?? ''))
      .filter((id) => id !== '');
  }
  return [];
}

// Nombres de las personas del grupo; vacío si solo se conoce el conteo.
function listaNombres(grupo: GrupoPlataforma, usuarios: UsuarioPlataforma[]): string[] {
  if (grupo.miembros && grupo.miembros.length > 0) {
    const nombres = grupo.miembros
      .map((miembro) => {
        const nombre = (miembro as { nombre?: unknown }).nombre;
        return typeof nombre === 'string' ? nombre : '';
      })
      .filter((nombre) => nombre !== '');
    if (nombres.length > 0) return nombres;
  }
  const ids = idsMiembros(grupo);
  if (ids.length === 0) return [];
  const porId = new Map<string, UsuarioPlataforma>();
  for (const usuario of usuarios) {
    porId.set(String(usuario.id), usuario);
    porId.set(claveUsuario(usuario), usuario);
  }
  return ids
    .map((id) => porId.get(id)?.nombre ?? porId.get(id)?.usuario ?? '')
    .filter((nombre) => nombre !== '');
}

function textoConteo(grupo: GrupoPlataforma): string {
  const cantidad = idsMiembros(grupo).length || grupo.totalMiembros;
  if (cantidad === undefined || cantidad === 0) return GUION;
  return `${cantidad} en el grupo`;
}

type Modal =
  | { modo: 'crear' }
  | { modo: 'eliminar'; grupo: GrupoPlataforma }
  | { modo: 'miembros'; grupo: GrupoPlataforma };

function DialogoNuevoGrupo({
  guardando,
  error,
  alGuardar,
  alCerrar,
}: {
  guardando: boolean;
  error: unknown;
  alGuardar: (cuerpo: CreacionGrupo) => void;
  alCerrar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [validacion, setValidacion] = useState('');

  function enviar() {
    if (!nombre.trim()) return setValidacion('Escribe el nombre del grupo.');
    setValidacion('');
    const cuerpo: CreacionGrupo = { nombre: nombre.trim() };
    if (descripcion.trim() !== '') cuerpo.descripcion = descripcion.trim();
    alGuardar(cuerpo);
  }

  return (
    <DialogoFormulario
      id="form-grupo"
      titulo="Agregar grupo"
      alCerrar={alCerrar}
      alEnviar={enviar}
      guardando={guardando}
    >
      <Campo etiqueta="Nombre del grupo">
        <Entrada
          value={nombre}
          onChange={(evento) => setNombre(evento.target.value)}
          autoFocus
          placeholder="Por ejemplo: Turno de noche"
        />
      </Campo>
      <Campo etiqueta="Descripción (opcional)">
        <Entrada
          value={descripcion}
          onChange={(evento) => setDescripcion(evento.target.value)}
          placeholder="Para qué se usa este grupo"
        />
      </Campo>
      {validacion !== '' ? (
        <AvisoError>{validacion}</AvisoError>
      ) : error != null ? (
        <AvisoError>{mensajeError(error)}</AvisoError>
      ) : null}
    </DialogoFormulario>
  );
}

// Claves (id y id público) de quienes ya están en el grupo, para marcarlos.
function clavesMiembros(grupo: GrupoPlataforma, usuarios: UsuarioPlataforma[]): string[] {
  const conocidas = new Set(idsMiembros(grupo));
  return usuarios
    .filter((usuario) => conocidas.has(String(usuario.id)) || conocidas.has(String(usuario.idPublico)))
    .map(claveUsuario);
}

// El listado de grupos solo trae el total de miembros: al abrir el diálogo se
// lee el grupo con sus miembros para marcar a quienes ya están. Sin esto el
// diálogo abría todo desmarcado y "Guardar lista" vaciaba el grupo.
function DialogoMiembros(props: {
  grupo: GrupoPlataforma;
  usuarios: UsuarioPlataforma[];
  guardando: boolean;
  error: unknown;
  alGuardar: (usuarioIds: (number | string)[]) => void;
  alCerrar: () => void;
}) {
  const detalle = useQuery({
    queryKey: ['grupo', String(props.grupo.idPublico ?? props.grupo.id)],
    queryFn: async () => {
      const respuesta = await api.get<{ grupo: GrupoPlataforma } | GrupoPlataforma>(`/api/v1/grupos/${idEnUrl(props.grupo)}`);
      return 'grupo' in respuesta ? respuesta.grupo : respuesta;
    },
    staleTime: 0,
  });
  if (!detalle.data) {
    return (
      <Dialogo abierto alCerrar={props.alCerrar} titulo={`Quiénes están en ${props.grupo.nombre}`}>
        {detalle.error != null ? <AvisoError>{mensajeError(detalle.error)}</AvisoError> : <Cargando />}
      </Dialogo>
    );
  }
  return <ListaMiembros key={detalle.dataUpdatedAt} {...props} grupo={detalle.data} />;
}

function ListaMiembros({
  grupo,
  usuarios,
  guardando,
  error,
  alGuardar,
  alCerrar,
}: {
  grupo: GrupoPlataforma;
  usuarios: UsuarioPlataforma[];
  guardando: boolean;
  error: unknown;
  alGuardar: (usuarioIds: (number | string)[]) => void;
  alCerrar: () => void;
}) {
  const iniciales = useMemo(() => clavesMiembros(grupo, usuarios), [grupo, usuarios]);
  const [elegidos, setElegidos] = useState<string[]>(iniciales);

  // Orden fijo al abrir (no salta al marcar): primero quienes ya están en el
  // grupo, luego las personas disponibles y al final las dadas de baja.
  const { enGrupo, disponibles, ocultas } = useMemo(() => {
    const porNombre = (a: UsuarioPlataforma, b: UsuarioPlataforma) =>
      Number(a.habilitado === false) - Number(b.habilitado === false) ||
      (a.nombre || a.usuario || '').localeCompare(b.nombre || b.usuario || '', 'es');
    const dentro = new Set(iniciales);
    // Disponibles: personas activas que no están en otro grupo (cada persona va
    // en un solo grupo; el servidor también lo exige). Las cuentas de
    // administración no son personas de campo.
    const enOtroGrupo = (u: UsuarioPlataforma) =>
      (u.grupos ?? []).some((g) => String(g.id) !== String(grupo.id));
    const fuera = usuarios.filter((u) => !dentro.has(claveUsuario(u)));
    return {
      enGrupo: usuarios.filter((u) => dentro.has(claveUsuario(u))).sort(porNombre),
      disponibles: fuera.filter((u) => u.habilitado !== false && !u.administrador && !enOtroGrupo(u)).sort(porNombre),
      ocultas: {
        otroGrupo: fuera.filter((u) => u.habilitado !== false && enOtroGrupo(u)).length,
        deBaja: fuera.filter((u) => u.habilitado === false).length,
      },
    };
  }, [usuarios, iniciales, grupo]);

  function alternar(clave: string) {
    setElegidos((actuales) => (actuales.includes(clave) ? actuales.filter((otro) => otro !== clave) : [...actuales, clave]));
  }

  function enviar() {
    const porClave = new Map(usuarios.map((usuario) => [claveUsuario(usuario), usuario]));
    const usuarioIds = elegidos
      .map((clave) => porClave.get(clave))
      .filter((usuario): usuario is UsuarioPlataforma => usuario !== undefined)
      .map((usuario) => usuario.id ?? usuario.idPublico);
    alGuardar(usuarioIds);
  }

  const fila = (usuario: UsuarioPlataforma) => (
    <div key={claveUsuario(usuario)} className="flex items-center gap-2.5">
      <Avatar nombre={usuario.nombre || usuario.usuario} tamano="sm" />
      <Casilla
        etiqueta={
          <span>
            {usuario.nombre}
            {usuario.usuario ? ` (${usuario.usuario})` : ''}
            {usuario.habilitado === false ? ' · dada de baja' : ''}
          </span>
        }
        checked={elegidos.includes(claveUsuario(usuario))}
        onChange={() => alternar(claveUsuario(usuario))}
      />
    </div>
  );

  return (
    <DialogoFormulario
      id="form-miembros"
      titulo={`Quiénes están en ${grupo.nombre}`}
      descripcion="Las marcadas pertenecen al grupo. Marca para sumar y desmarca para quitar."
      alCerrar={alCerrar}
      alEnviar={enviar}
      guardando={guardando}
      etiquetaGuardar="Guardar lista"
    >
      {usuarios.length === 0 && <p className="text-[13px] text-texto-3">No hay personas para asignar.</p>}
      {usuarios.length > 0 && (
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold text-marino-900">En el grupo ({enGrupo.length})</legend>
            {enGrupo.length === 0 ? (
              <p className="text-[13px] text-texto-3">Todavía nadie. Marca abajo a quienes quieras sumar.</p>
            ) : (
              <div className="flex flex-col gap-2.5">{enGrupo.map(fila)}</div>
            )}
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold text-marino-900">Disponibles para sumar ({disponibles.length})</legend>
            {disponibles.length === 0 ? (
              <p className="text-[13px] text-texto-3">No hay personas libres para sumar.</p>
            ) : (
              <div className="flex flex-col gap-2.5">{disponibles.map(fila)}</div>
            )}
            {(ocultas.otroGrupo > 0 || ocultas.deBaja > 0) && (
              <p className="mt-3 text-[12px] text-texto-3">
                No se muestran{' '}
                {[
                  ocultas.otroGrupo > 0 && `${ocultas.otroGrupo} ${ocultas.otroGrupo === 1 ? 'persona que ya está' : 'personas que ya están'} en otro grupo`,
                  ocultas.deBaja > 0 && `${ocultas.deBaja} ${ocultas.deBaja === 1 ? 'dada' : 'dadas'} de baja`,
                ]
                  .filter(Boolean)
                  .join(' ni ')}
                . Cada persona pertenece a un solo grupo.
              </p>
            )}
          </fieldset>
        </div>
      )}
      {error != null && <AvisoError>{mensajeError(error)}</AvisoError>}
    </DialogoFormulario>
  );
}

export default function Grupos() {
  const administrador = useSesion((estado) => estado.usuario?.administrador === true);
  const soloLectura = useSesion((estado) => estado.usuario?.soloLectura === true);
  const cliente = useQueryClient();
  const [pagina, setPagina] = useState(1);
  const [busqueda, setBusqueda] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);

  const grupos = useQuery({
    queryKey: ['grupos'],
    enabled: administrador,
    queryFn: () => traerGrupos(),
    staleTime: CACHE_PLATAFORMA_MS,
  });
  const usuarios = useQuery({
    queryKey: ['usuarios-plataforma'],
    enabled: administrador,
    queryFn: () => traerUsuariosPlataforma(),
    staleTime: CACHE_PLATAFORMA_MS,
  });

  const listaUsuarios = useMemo(() => usuarios.data ?? [], [usuarios.data]);
  const lista = useMemo(() => {
    const filtro = busqueda.trim().toLowerCase();
    const datos = grupos.data ?? [];
    if (filtro === '') return datos;
    return datos.filter((g) => g.nombre.toLowerCase().includes(filtro) || (g.descripcion ?? '').toLowerCase().includes(filtro));
  }, [grupos.data, busqueda]);
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visibles = useMemo(
    () => lista.slice((paginaSegura - 1) * TAMANO_PAGINA, paginaSegura * TAMANO_PAGINA),
    [lista, paginaSegura],
  );

  const crear = useMutation({
    mutationFn: (cuerpo: CreacionGrupo) => api.post<{ grupo: GrupoPlataforma }>('/api/v1/grupos', cuerpo),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['grupos'] });
      toast.success('Grupo creado.');
      setModal(null);
    },
  });

  const eliminar = useMutation({
    mutationFn: (grupo: GrupoPlataforma) => api.borrar<void>(`/api/v1/grupos/${idEnUrl(grupo)}`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['grupos'] });
      toast.success('Grupo eliminado. Las personas no se borran.');
      setModal(null);
    },
  });

  const guardarMiembros = useMutation({
    mutationFn: ({ grupo, usuarioIds }: { grupo: GrupoPlataforma; usuarioIds: (number | string)[] }) =>
      api.put<{ grupo: GrupoPlataforma }>(`/api/v1/grupos/${idEnUrl(grupo)}/miembros`, { usuarioIds }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['grupos'] });
      // Los grupos de cada cuenta salen de la lista de usuarios.
      void cliente.invalidateQueries({ queryKey: ['usuarios-plataforma'] });
      toast.success('Lista del grupo guardada.');
      setModal(null);
    },
  });

  const cerrarModal = useCallback(() => setModal(null), []);

  if (!administrador || esErrorDeEstado(grupos.error, 403)) {
    return <SinPermiso>Necesitas permisos de administrador para gestionar grupos.</SinPermiso>;
  }

  return (
    <div className="space-y-5">
      <AccionesPagina>
        <Buscador
          valor={busqueda}
          alCambiar={(valor) => {
            setBusqueda(valor);
            setPagina(1);
          }}
          placeholder="Buscar grupo"
        />
        {!soloLectura && (
          <Boton
            variante="principal"
            icono={Plus}
            onClick={() => {
              crear.reset();
              setModal({ modo: 'crear' });
            }}
          >
            Agregar grupo
          </Boton>
        )}
      </AccionesPagina>
      {soloLectura && (
        <p className="rounded-control border border-borde bg-superficie px-4 py-3 text-[13px] text-texto-2">
          Tu cuenta es de solo lectura: puedes consultar, pero no hacer cambios.
        </p>
      )}

      <Tarjeta>
        <CabeceraTarjeta
          titulo="Lista de grupos"
          detalle={grupos.data ? `${total} ${busqueda.trim() ? 'encontrados' : 'registrados'}` : 'Consultando…'}
        />
        {grupos.isPending && <Cargando texto="Cargando grupos…" />}
        {grupos.error && (
          <div className="px-5 pb-5">
            <ErrorCarga mensaje={mensajeError(grupos.error)} alReintentar={() => void grupos.refetch()} />
          </div>
        )}
        {grupos.data && total === 0 && (
          <Vacio icono={UsersRound} titulo={busqueda.trim() ? 'Sin resultados' : 'Todavía no hay grupos'}>
            {busqueda.trim() ? 'Ningún grupo coincide con la búsqueda.' : 'Crea el primero con el botón de arriba.'}
          </Vacio>
        )}
        {visibles.length > 0 && (
          <>
            <Tabla>
              <thead>
                <tr>
                  <Th>Grupo</Th>
                  <Th>Descripción</Th>
                  <Th>Personas</Th>
                  <Th className="text-right">Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((grupo) => {
                  const nombres = listaNombres(grupo, listaUsuarios);
                  return (
                    <Fila key={String(grupo.idPublico ?? grupo.id)}>
                      <Td className="font-semibold text-marino-900">{grupo.nombre}</Td>
                      <Td className="max-w-72">{grupo.descripcion ?? GUION}</Td>
                      <Td className="max-w-80">{nombres.length > 0 ? nombres.join(', ') : textoConteo(grupo)}</Td>
                      <Td>
                        <div className={cn('flex items-center justify-end gap-1', soloLectura && 'hidden')}>
                          <BotonIcono
                            icono={UserCog}
                            etiqueta={`Cambiar quiénes están en ${grupo.nombre}`}
                            onClick={() => {
                              guardarMiembros.reset();
                              setModal({ modo: 'miembros', grupo });
                            }}
                          />
                          <BotonIcono
                            icono={Trash2}
                            peligro
                            etiqueta={`Eliminar el grupo ${grupo.nombre}`}
                            onClick={() => {
                              eliminar.reset();
                              setModal({ modo: 'eliminar', grupo });
                            }}
                          />
                        </div>
                      </Td>
                    </Fila>
                  );
                })}
              </tbody>
            </Tabla>
            <Paginacion pagina={paginaSegura} tamano={TAMANO_PAGINA} total={total} alCambiar={setPagina} />
          </>
        )}
        {usuarios.error != null && (
          <p className="px-5 pb-4 text-[12.5px] text-texto-3">
            No se pudieron cargar las personas para mostrar los nombres del grupo.
          </p>
        )}
      </Tarjeta>

      {modal?.modo === 'crear' && (
        <DialogoNuevoGrupo
          guardando={crear.isPending}
          error={crear.error}
          alGuardar={(cuerpo) => crear.mutate(cuerpo)}
          alCerrar={cerrarModal}
        />
      )}

      {modal?.modo === 'eliminar' && (
        <DialogoConfirmar
          titulo="Eliminar el grupo"
          alCerrar={cerrarModal}
          alConfirmar={() => eliminar.mutate(modal.grupo)}
          trabajando={eliminar.isPending}
          etiqueta="Eliminar"
          etiquetaTrabajando="Eliminando…"
        >
          <p>
            ¿Eliminar el grupo <b className="text-marino-900">{modal.grupo.nombre}</b>? Las personas no se borran,
            solo quedan sin ese grupo.
          </p>
          {eliminar.error != null && <AvisoError>{mensajeError(eliminar.error)}</AvisoError>}
        </DialogoConfirmar>
      )}

      {modal?.modo === 'miembros' &&
        (usuarios.data ? (
          <DialogoMiembros
            grupo={modal.grupo}
            usuarios={listaUsuarios}
            guardando={guardarMiembros.isPending}
            error={guardarMiembros.error}
            alGuardar={(usuarioIds) => guardarMiembros.mutate({ grupo: modal.grupo, usuarioIds })}
            alCerrar={cerrarModal}
          />
        ) : (
          <Dialogo
            abierto
            alCerrar={cerrarModal}
            titulo={`Quiénes están en ${modal.grupo.nombre}`}
            pie={<Boton onClick={cerrarModal}>Cerrar</Boton>}
          >
            {usuarios.error ? (
              <div className="space-y-3 text-[13px]">
                <p>No se pudieron cargar las personas. Inténtalo más tarde.</p>
                <AvisoError>{mensajeError(usuarios.error)}</AvisoError>
              </div>
            ) : (
              <Cargando texto="Cargando personas…" />
            )}
          </Dialogo>
        ))}
    </div>
  );
}
