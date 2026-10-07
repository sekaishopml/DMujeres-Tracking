import { cn } from '@/lib/cn';
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, LockOpen, Pencil, Plus, SlidersHorizontal, Smartphone, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ActualizacionUsuarioPlataforma,
  CreacionUsuarioPlataforma,
  Dispositivo,
  EntradaEsquemaAjustes,
  GrupoPlataforma,
  RespuestaCreacionUsuarioPlataforma,
  UsuarioPlataforma,
} from '@contratos';
import { api } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import { GUION, fechaHora, hora } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';
import {
  CLAVE_FLOTA,
  invalidarFlota,
  traerEsquemaAjustes,
  traerFlota,
  traerGrupos,
  traerUsuariosPlataforma,
} from '@/dominio/datos';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { Avatar } from '@/componentes/ui/Avatar';
import { Boton, BotonIcono } from '@/componentes/ui/Boton';
import { Campo, Entrada, Selector } from '@/componentes/ui/Campo';
import { IconoAndroid, IconoApple } from '@/componentes/ui/Plataforma';
import { Insignia } from '@/componentes/ui/ChipEstado';
import { Dialogo } from '@/componentes/ui/Dialogo';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { CabeceraTarjeta, Tarjeta } from '@/componentes/ui/Tarjeta';
import { Fila, Tabla, Td, Th } from '@/componentes/ui/Tabla';
import {
  AvisoError,
  Buscador,
  CACHE_FLOTA_CONSULTA_MS,
  CACHE_PLATAFORMA_MS,
  Paginacion,
  SinPermiso,
  TAMANO_PAGINA,
  esErrorDeEstado,
} from '@/componentes/admin/comunes';
import { DialogoConfirmar, DialogoFormulario } from '@/componentes/admin/FormularioBase';

const CLAVE_MINIMA = 8;

type ValorAjuste = number | boolean | string | null;

function idEnUrl(usuario: UsuarioPlataforma): string {
  return encodeURIComponent(usuario.idPublico ?? String(usuario.id));
}

function idTextoGrupo(grupo: GrupoPlataforma): string {
  return String(grupo.idPublico ?? grupo.id);
}

function idOriginalGrupo(grupo: GrupoPlataforma): number | string {
  return grupo.idPublico ?? grupo.id;
}

function textoGrupos(usuario: UsuarioPlataforma): string {
  const grupos = usuario.grupos ?? [];
  if (grupos.length === 0) return GUION;
  return grupos.map((grupo) => grupo.nombre).join(', ');
}

// Equipos asignados, con su nombre. Si hay asignaciones cuyo equipo no está en
// la lista visible, se muestra cuántas son para no esconderlas.
function textoEquipos(usuario: UsuarioPlataforma, flota: Dispositivo[]): string {
  const ids = usuario.dispositivoIds ?? [];
  if (ids.length === 0) return GUION;
  const conteo = ids.length === 1 ? '1 equipo' : `${ids.length} equipos`;
  if (flota.length === 0) return conteo;
  const nombresPorId = new Map<string, string>();
  for (const equipo of flota) {
    nombresPorId.set(String(equipo.id), equipo.nombre);
    nombresPorId.set(equipo.idPublico, equipo.nombre);
  }
  const nombres = ids
    .map((id) => nombresPorId.get(String(id)))
    .filter((nombre): nombre is string => typeof nombre === 'string' && nombre !== '');
  return nombres.length > 0 ? nombres.join(', ') : conteo;
}

type Modal =
  | { modo: 'crear' }
  | { modo: 'editar'; usuario: UsuarioPlataforma }
  | { modo: 'baja'; usuario: UsuarioPlataforma }
  | { modo: 'ajustes'; usuario: UsuarioPlataforma };

// En edición la clave vacía significa "no cambiar"; en creación es obligatoria.
// Receptor OsmAnd al que envía Traccar Client en iPhone.
const SERVIDOR_IPHONE = 'http://68.168.20.219:5055';

// El guardado nunca manda roles; al crear, el servidor siempre crea su equipo.
function DialogoCuenta({
  usuario,
  grupos,
  gruposError,
  guardando,
  error,
  alGuardar,
  alCerrar,
}: {
  usuario: UsuarioPlataforma | null;
  grupos: GrupoPlataforma[];
  gruposError: unknown;
  guardando: boolean;
  error: unknown;
  alGuardar: (cuerpo: CreacionUsuarioPlataforma | ActualizacionUsuarioPlataforma) => void;
  alCerrar: () => void;
}) {
  const [cuenta, setCuenta] = useState(usuario?.usuario ?? '');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [telefono, setTelefono] = useState(usuario?.telefono ?? '');
  const [cargo, setCargo] = useState(usuario?.cargo ?? '');
  // Los grupos de la persona llegan con id numérico y el selector usa el id
  // público: se traducen con la lista de grupos.
  const [grupoIds, setGrupoIds] = useState<string[]>(() =>
    (usuario?.grupos ?? []).flatMap((g) => {
      const grupo = grupos.find((x) => String(x.id) === String(g.id) || String(x.idPublico) === String(g.id));
      return grupo ? [idTextoGrupo(grupo)] : [];
    }),
  );
  const [plataforma, setPlataforma] = useState<'android' | 'ios'>('android');
  const [idIphone, setIdIphone] = useState('');
  const [validacion, setValidacion] = useState('');

  function enviar() {
    const iphone = !usuario && plataforma === 'ios';
    if (iphone && !idIphone.trim()) return setValidacion('Escribe el identificador de dispositivo que muestra Traccar Client.');
    if (!usuario && !iphone && !cuenta.trim()) return setValidacion('Escribe el nombre con el que la persona va a entrar.');
    if (!nombre.trim()) return setValidacion('Escribe el nombre completo de la persona.');
    if (!usuario && !iphone && !clave) return setValidacion('Escribe una contraseña para la cuenta nueva.');
    if (!iphone && clave && clave.length < CLAVE_MINIMA) {
      return setValidacion(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres.`);
    }
    setValidacion('');
    const gruposElegidos = grupos.filter((grupo) => grupoIds.includes(idTextoGrupo(grupo))).map(idOriginalGrupo);
    if (!usuario) {
      const cuerpo: CreacionUsuarioPlataforma = {
        nombre: nombre.trim(),
        // El equipo de rastreo se crea siempre junto con la cuenta.
        crearEquipo: true,
        plataforma,
      };
      if (iphone) {
        cuerpo.identificadorEquipo = idIphone.trim();
      } else {
        cuerpo.usuario = cuenta.trim();
        cuerpo.clave = clave;
      }
      if (telefono.trim() !== '') cuerpo.telefono = telefono.trim();
      if (cargo.trim() !== '') cuerpo.cargo = cargo.trim();
      if (gruposElegidos.length > 0) cuerpo.grupoIds = gruposElegidos;
      alGuardar(cuerpo);
      return;
    }
    const cuerpo: ActualizacionUsuarioPlataforma = {
      nombre: nombre.trim(),
      telefono: telefono.trim() === '' ? null : telefono.trim(),
      cargo: cargo.trim() === '' ? null : cargo.trim(),
      grupoIds: gruposElegidos,
    };
    if (clave !== '') cuerpo.clave = clave;
    alGuardar(cuerpo);
  }

  return (
    <DialogoFormulario
      id="form-cuenta"
      titulo={usuario ? 'Cambiar los datos de la cuenta' : 'Agregar cuenta'}
      descripcion={
        usuario ? (
          <>
            Cuenta: <b>{usuario.usuario}</b>
          </>
        ) : (
          'La cuenta se crea con su equipo y ya aparece en En vivo y Replay.'
        )
      }
      alCerrar={alCerrar}
      alEnviar={enviar}
      guardando={guardando}
    >
      {!usuario && (
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-semibold text-marino-900">Teléfono de la persona</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { valor: 'android', texto: 'Android', Icono: IconoAndroid },
                { valor: 'ios', texto: 'iPhone', Icono: IconoApple },
              ] as const
            ).map(({ valor, texto, Icono }) => (
              <button
                key={valor}
                type="button"
                aria-pressed={plataforma === valor}
                onClick={() => setPlataforma(valor)}
                className={cn(
                  'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-control border text-[14px] font-medium transition-colors',
                  plataforma === valor ? 'border-marca bg-marca/5 text-marino-900' : 'border-borde text-texto-2 hover:border-marino-300',
                )}
              >
                <Icono className="size-5" />
                {texto}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {!usuario && plataforma === 'ios' && (
          <Campo
            etiqueta="Identificador de dispositivo"
            ayuda="El que muestra Traccar Client en el iPhone, en «Identificador de dispositivo»."
          >
            <Entrada
              value={idIphone}
              onChange={(evento) => setIdIphone(evento.target.value)}
              autoComplete="off"
              inputMode="text"
              placeholder="Por ejemplo: 482913"
            />
          </Campo>
      )}
      {!usuario && plataforma === 'android' && (
        <Campo etiqueta="Nombre para entrar">
          <Entrada
            value={cuenta}
            onChange={(evento) => setCuenta(evento.target.value)}
            autoFocus
            autoComplete="off"
            placeholder="Por ejemplo: maria.p"
          />
        </Campo>
      )}
      {(usuario || plataforma === 'android') && (
      <Campo
        etiqueta={usuario ? 'Contraseña nueva' : 'Contraseña'}
        ayuda={usuario ? 'Déjala vacía para no cambiarla.' : `Mínimo ${CLAVE_MINIMA} caracteres.`}
      >
        <div className="relative">
          <Entrada
            type={verClave ? 'text' : 'password'}
            value={clave}
            onChange={(evento) => setClave(evento.target.value)}
            autoComplete="new-password"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setVerClave((visible) => !visible)}
            aria-label={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
            className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-control text-texto-2 hover:bg-marino-50"
          >
            {verClave ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Campo>
      )}
      <Campo etiqueta="Nombre de la persona">
        <Entrada value={nombre} onChange={(evento) => setNombre(evento.target.value)} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Teléfono (opcional)">
          <Entrada value={telefono} onChange={(evento) => setTelefono(evento.target.value)} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Puesto (opcional)">
          <Entrada
            value={cargo}
            onChange={(evento) => setCargo(evento.target.value)}
            placeholder="Por ejemplo: Asistente de cobranza"
          />
        </Campo>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[12px] font-semibold text-marino-900">Grupo</legend>
        {gruposError != null && (
          <p className="text-[12.5px] text-texto-3">No se pudieron cargar los grupos; puedes guardar sin cambiarlos.</p>
        )}
        {grupos.length === 0 && gruposError == null && (
          <p className="text-[12.5px] text-texto-3">Todavía no hay grupos creados.</p>
        )}
        {grupos.length > 0 && (
          <>
            {/* Una persona pertenece a un solo grupo (el servidor también lo exige). */}
            <Selector
              aria-label="Grupo"
              value={grupoIds[0] ?? ''}
              onChange={(evento) => setGrupoIds(evento.target.value ? [evento.target.value] : [])}
            >
              <option value="">Sin grupo</option>
              {grupos.map((grupo) => (
                <option key={idTextoGrupo(grupo)} value={idTextoGrupo(grupo)}>
                  {grupo.nombre}
                </option>
              ))}
            </Selector>
            <p className="mt-1 text-[11.5px] text-texto-3">Cada persona pertenece a un solo grupo.</p>
          </>
        )}
      </fieldset>
      {!usuario && plataforma === 'ios' && (
        <div className="rounded-control bg-marino-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-texto-2">
          <p className="mb-1 font-semibold text-marino-900">En el iPhone, dentro de Traccar Client:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              Dirección del servidor: <b className="text-marino-900">{SERVIDOR_IPHONE}</b>
            </li>
            <li>En Ajustes del iPhone: ubicación «Siempre» con ubicación exacta, y actualización en segundo plano activada.</li>
            <li>Encender el seguimiento al empezar el día. La jornada se abre sola con el primer punto y se cierra tras unas 2 h sin puntos.</li>
          </ol>
        </div>
      )}
      {validacion !== '' ? (
        <AvisoError>{validacion}</AvisoError>
      ) : error != null ? (
        <AvisoError>{mensajeError(error)}</AvisoError>
      ) : null}
    </DialogoFormulario>
  );
}

// Valor de un ajuste como lo lee una persona (Activado, Alta, 10 s…).
const TEXTOS_AJUSTE: Record<string, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  drop_oldest: 'Borrar lo más viejo',
  drop_newest: 'No guardar lo nuevo',
};
const UNIDAD_AJUSTE: Record<string, string> = {
  intervalSeconds: 's',
  min_interval_seconds: 's',
  ackTimeoutSeconds: 's',
  distanceMeters: 'm',
  angleDegrees: '°',
  l1_max_update_delay_ms: 'ms',
};
function valorLegible(valor: ValorAjuste | null | undefined, clave: string): string {
  if (valor == null || valor === '') return GUION;
  if (typeof valor === 'boolean') return valor ? 'Activado' : 'Desactivado';
  if (typeof valor === 'number') return UNIDAD_AJUSTE[clave] ? `${valor} ${UNIDAD_AJUSTE[clave]}` : String(valor);
  return TEXTOS_AJUSTE[valor] ?? valor;
}

// Clave del esquema de la app -> clave del equipo (mobile.*).
const CLAVE_EQUIPO: Record<string, string> = {
  intervalSeconds: 'mobile.intervalSeconds',
  min_interval_seconds: 'mobile.minIntervalSeconds',
  distanceMeters: 'mobile.distanceMeters',
  angleDegrees: 'mobile.angleDegrees',
  accuracy: 'mobile.accuracy',
  bufferEnabled: 'mobile.bufferEnabled',
  bufferMax: 'mobile.bufferMax',
  bufferPolicy: 'mobile.bufferPolicy',
  ackTimeoutSeconds: 'mobile.ackTimeoutSeconds',
  maxRetries: 'mobile.maxRetries',
};
function valorEquipo(config: Record<string, unknown> | null, clave: string): ValorAjuste {
  const valor = config?.[CLAVE_EQUIPO[clave] ?? ''];
  return typeof valor === 'number' || typeof valor === 'boolean' || typeof valor === 'string' ? valor : null;
}

function textoDesdeAjuste(valor: unknown): string {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor === 'boolean') return valor ? 'true' : 'false';
  if (typeof valor === 'string') return valor;
  return '';
}

function DialogoAjustes({
  usuario,
  esquema,
  cargandoEsquema,
  errorEsquema,
  guardando,
  error,
  alGuardar,
  alCerrar,
  configEquipo,
}: {
  usuario: UsuarioPlataforma;
  esquema: EntradaEsquemaAjustes[];
  cargandoEsquema: boolean;
  errorEsquema: unknown;
  guardando: boolean;
  error: unknown;
  alGuardar: (ajustes: Record<string, ValorAjuste>) => void;
  alCerrar: () => void;
  // Configuración propia del equipo de la persona: si tiene un valor, ese
  // manda (mismo orden que el servidor).
  configEquipo: Record<string, unknown> | null;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const iniciales: Record<string, string> = {};
    for (const entrada of esquema) iniciales[entrada.clave] = textoDesdeAjuste(usuario.configApp?.[entrada.clave]);
    return iniciales;
  });
  const [validacion, setValidacion] = useState('');
  const titulo = `Ajustes de ${usuario.nombre}`;

  function cambiar(clave: string, valor: string) {
    setValores((actuales) => ({ ...actuales, [clave]: valor }));
  }

  function enviar() {
    const ajustes: Record<string, ValorAjuste> = {};
    for (const entrada of esquema) {
      const texto = (valores[entrada.clave] ?? '').trim();
      if (texto === '') {
        ajustes[entrada.clave] = null;
        continue;
      }
      if (entrada.tipo === 'numero' || entrada.tipo === 'entero') {
        const numero = Number(texto);
        if (!Number.isFinite(numero)) return setValidacion(`“${entrada.etiqueta}” debe ser un número.`);
        if (entrada.min !== undefined && numero < entrada.min) {
          return setValidacion(`“${entrada.etiqueta}” no puede ser menor de ${entrada.min}.`);
        }
        if (entrada.max !== undefined && numero > entrada.max) {
          return setValidacion(`“${entrada.etiqueta}” no puede ser mayor de ${entrada.max}.`);
        }
        if (entrada.tipo === 'entero' && !Number.isInteger(numero)) {
          return setValidacion(`“${entrada.etiqueta}” debe ser un número entero.`);
        }
        ajustes[entrada.clave] = numero;
      } else if (entrada.tipo === 'booleano') {
        if (texto !== 'true' && texto !== 'false') {
          return setValidacion(`“${entrada.etiqueta}” tiene un valor que no se reconoce.`);
        }
        ajustes[entrada.clave] = texto === 'true';
      } else {
        ajustes[entrada.clave] = texto;
      }
    }
    setValidacion('');
    alGuardar(ajustes);
  }

  if (cargandoEsquema || errorEsquema != null || esquema.length === 0) {
    return (
      <Dialogo
        abierto
        alCerrar={alCerrar}
        titulo={titulo}
        pie={<Boton onClick={alCerrar}>Cerrar</Boton>}
      >
        {cargandoEsquema ? (
          <Cargando texto="Cargando los ajustes disponibles…" />
        ) : errorEsquema != null ? (
          <div className="space-y-3 text-[13px]">
            <p>No se pudieron cargar los ajustes de esta cuenta. Inténtalo más tarde.</p>
            <AvisoError>{mensajeError(errorEsquema)}</AvisoError>
          </div>
        ) : (
          <p className="text-[13px]">Esta cuenta aún no tiene ajustes para cambiar.</p>
        )}
      </Dialogo>
    );
  }

  return (
    <DialogoFormulario
      id="form-ajustes"
      titulo={titulo}
      descripcion="Cada ajuste muestra el valor que rige hoy. Un campo vacío usa el valor por defecto del sistema."
      alCerrar={alCerrar}
      alEnviar={enviar}
      guardando={guardando}
      etiquetaGuardar="Guardar ajustes"
    >
      {esquema.map((entrada) => (
        <Campo
          key={entrada.clave}
          etiqueta={entrada.etiqueta}
          ayuda={
            <>
              {(() => {
                const delEquipo = valorEquipo(configEquipo, entrada.clave);
                const dePersona = usuario.configApp?.[entrada.clave] ?? null;
                const valor = delEquipo ?? dePersona ?? entrada.porDefecto ?? null;
                const origen =
                  delEquipo != null
                    ? ' · lo fija el equipo en Configuración (manda sobre este ajuste)'
                    : dePersona != null
                      ? ' · definido para esta persona'
                      : ' · por defecto del sistema';
                return (
                  <span className="block font-medium text-marino-900">
                    Rige hoy: {valorLegible(valor, entrada.clave)}
                    <span className={delEquipo != null ? 'font-normal text-sin-senal' : 'font-normal text-texto-3'}>{origen}</span>
                  </span>
                );
              })()}
              {entrada.descripcion !== '' && <span className="block">{entrada.descripcion}</span>}
            </>
          }
        >
          {entrada.tipo === 'numero' || entrada.tipo === 'entero' ? (
            <Entrada
              type="number"
              step="any"
              min={entrada.min}
              max={entrada.max}
              value={valores[entrada.clave] ?? ''}
              placeholder={entrada.porDefecto != null ? `Por defecto: ${entrada.porDefecto}` : undefined}
              onChange={(evento) => cambiar(entrada.clave, evento.target.value)}
            />
          ) : entrada.tipo === 'booleano' ? (
            <Selector value={valores[entrada.clave] ?? ''} onChange={(evento) => cambiar(entrada.clave, evento.target.value)}>
              <option value="">Por defecto ({valorLegible(entrada.porDefecto ?? null, entrada.clave)})</option>
              <option value="true">Activado</option>
              <option value="false">Desactivado</option>
            </Selector>
          ) : (
            <Entrada
              type="text"
              placeholder={entrada.porDefecto != null ? `Por defecto: ${valorLegible(entrada.porDefecto, entrada.clave)}` : undefined}
              value={valores[entrada.clave] ?? ''}
              onChange={(evento) => cambiar(entrada.clave, evento.target.value)}
            />
          )}
        </Campo>
      ))}
      {validacion !== '' ? (
        <AvisoError>{validacion}</AvisoError>
      ) : error != null ? (
        <AvisoError>{mensajeError(error)}</AvisoError>
      ) : null}
    </DialogoFormulario>
  );
}

export default function Usuarios() {
  const administrador = useSesion((estado) => estado.usuario?.administrador === true);
  // Una cuenta administradora marcada como solo lectura ve la lista pero no
  // las acciones: la API rechaza sus cambios con 403.
  const soloLectura = useSesion((estado) => estado.usuario?.soloLectura === true);
  const cliente = useQueryClient();
  const [pagina, setPagina] = useState(1);
  const [busqueda, setBusqueda] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);

  const usuarios = useQuery({
    queryKey: ['usuarios-plataforma'],
    enabled: administrador,
    queryFn: () => traerUsuariosPlataforma(),
    staleTime: CACHE_PLATAFORMA_MS,
  });
  const grupos = useQuery({
    queryKey: ['grupos'],
    enabled: administrador,
    queryFn: () => traerGrupos(),
    staleTime: CACHE_PLATAFORMA_MS,
  });
  const esquema = useQuery({
    queryKey: ['esquema-ajustes'],
    enabled: administrador,
    queryFn: () => traerEsquemaAjustes(),
    staleTime: CACHE_PLATAFORMA_MS,
  });
  // La flota resuelve los nombres de la columna "Equipos".
  const flota = useQuery({
    queryKey: CLAVE_FLOTA,
    enabled: administrador,
    queryFn: () => traerFlota(),
    staleTime: CACHE_FLOTA_CONSULTA_MS,
  });

  // Primero las cuentas habilitadas y al final las dadas de baja, cada bloque
  // en orden alfabético por nombre (la cuenta desempata).
  const lista = useMemo(() => {
    const filtro = busqueda.trim().toLowerCase();
    const base = (usuarios.data ?? []).filter(
      (u) =>
        filtro === '' ||
        [u.nombre, u.usuario, u.telefono ?? '', u.cargo ?? ''].some((texto) => texto.toLowerCase().includes(filtro)),
    );
    return base.sort((a, b) => {
      if (a.habilitado !== b.habilitado) return a.habilitado ? -1 : 1;
      const nombreA = (a.nombre.trim() !== '' ? a.nombre : a.usuario).trim();
      const nombreB = (b.nombre.trim() !== '' ? b.nombre : b.usuario).trim();
      const porNombre = nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base', numeric: true });
      if (porNombre !== 0) return porNombre;
      return a.usuario.localeCompare(b.usuario, 'es', { sensitivity: 'base', numeric: true });
    });
  }, [usuarios.data, busqueda]);
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visibles = useMemo(
    () => lista.slice((paginaSegura - 1) * TAMANO_PAGINA, paginaSegura * TAMANO_PAGINA),
    [lista, paginaSegura],
  );
  const listaGrupos = useMemo(() => grupos.data ?? [], [grupos.data]);
  const listaEquipos = useMemo(() => flota.data?.datos ?? [], [flota.data]);

  function invalidar() {
    void cliente.invalidateQueries({ queryKey: ['usuarios-plataforma'] });
  }

  const crear = useMutation({
    // El servidor crea la cuenta y su equipo de rastreo en la misma operación.
    mutationFn: (cuerpo: CreacionUsuarioPlataforma) =>
      api.post<RespuestaCreacionUsuarioPlataforma>('/api/v1/usuarios', cuerpo),
    onSuccess: ({ equipo }) => {
      invalidar();
      void invalidarFlota(cliente);
      toast.success(
        equipo
          ? `Cuenta y equipo creados. “${equipo.nombre}” ya aparece en En vivo y Replay.`
          : 'Cuenta creada.',
      );
      setModal(null);
    },
  });

  const actualizar = useMutation({
    mutationFn: ({ usuario, cuerpo }: { usuario: UsuarioPlataforma; cuerpo: ActualizacionUsuarioPlataforma }) =>
      api.patch<{ usuario: UsuarioPlataforma }>(`/api/v1/usuarios/${idEnUrl(usuario)}`, cuerpo),
    onSuccess: () => {
      invalidar();
      toast.success('Cambios guardados.');
      setModal(null);
    },
  });

  const darDeBaja = useMutation({
    mutationFn: (usuario: UsuarioPlataforma) => api.borrar<void>(`/api/v1/usuarios/${idEnUrl(usuario)}`),
    onSuccess: () => {
      invalidar();
      toast.success('Cuenta dada de baja. Puedes reactivarla cuando la necesites.');
      setModal(null);
    },
  });

  const reactivar = useMutation({
    mutationFn: (usuario: UsuarioPlataforma) =>
      api.patch<{ usuario: UsuarioPlataforma }>(`/api/v1/usuarios/${idEnUrl(usuario)}`, { habilitado: true }),
    onSuccess: () => {
      invalidar();
      toast.success('Cuenta reactivada.');
    },
    onError: (error) => toast.error(mensajeError(error)),
  });

  const desbloquear = useMutation({
    mutationFn: (usuario: UsuarioPlataforma) =>
      api.post<{ usuario: UsuarioPlataforma }>(`/api/v1/usuarios/${idEnUrl(usuario)}/desbloquear`, {}),
    onSuccess: () => {
      invalidar();
      toast.success('Cuenta desbloqueada.');
    },
    onError: (error) => toast.error(mensajeError(error)),
  });

  // Cierra la app en el teléfono donde esté abierta: así la persona puede
  // entrar desde otro (solo se permite uno a la vez).
  const cerrarTelefono = useMutation({
    mutationFn: (usuario: UsuarioPlataforma) =>
      api.post<{ usuario: UsuarioPlataforma }>(`/api/v1/usuarios/${idEnUrl(usuario)}/cerrar-sesion-telefono`, {}),
    onSuccess: () => {
      invalidar();
      toast.success('Sesión del teléfono cerrada. Ya puede entrar desde otro.');
    },
    onError: (error) => toast.error(mensajeError(error)),
  });

  const guardarAjustes = useMutation({
    mutationFn: ({ usuario, ajustes }: { usuario: UsuarioPlataforma; ajustes: Record<string, ValorAjuste> }) =>
      api.patch<{ usuario: UsuarioPlataforma }>(`/api/v1/usuarios/${idEnUrl(usuario)}`, { configApp: ajustes }),
    onSuccess: () => {
      invalidar();
      toast.success('Ajustes guardados.');
      setModal(null);
    },
  });

  const cerrarModal = useCallback(() => setModal(null), []);

  function abrirCrear() {
    crear.reset();
    setModal({ modo: 'crear' });
  }
  function abrirEditar(usuario: UsuarioPlataforma) {
    actualizar.reset();
    setModal({ modo: 'editar', usuario });
  }
  function abrirBaja(usuario: UsuarioPlataforma) {
    darDeBaja.reset();
    setModal({ modo: 'baja', usuario });
  }
  function abrirAjustes(usuario: UsuarioPlataforma) {
    guardarAjustes.reset();
    setModal({ modo: 'ajustes', usuario });
  }

  function guardarCuenta(cuerpo: CreacionUsuarioPlataforma | ActualizacionUsuarioPlataforma) {
    if (!modal) return;
    if (modal.modo === 'crear') crear.mutate(cuerpo as CreacionUsuarioPlataforma);
    else if (modal.modo === 'editar') actualizar.mutate({ usuario: modal.usuario, cuerpo });
  }

  if (!administrador || esErrorDeEstado(usuarios.error, 403)) {
    return <SinPermiso>Necesitas permisos de administrador para gestionar cuentas.</SinPermiso>;
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
          placeholder="Buscar cuenta o persona"
        />
        {!soloLectura && (
          <Boton variante="principal" icono={Plus} onClick={abrirCrear}>
            Agregar cuenta
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
          titulo="Cuentas de acceso"
          detalle={usuarios.data ? `${total} ${busqueda.trim() ? 'encontradas' : 'registradas'}` : 'Consultando…'}
        />
        {usuarios.isPending && <Cargando texto="Cargando cuentas…" />}
        {usuarios.error && (
          <div className="px-5 pb-5">
            <ErrorCarga mensaje={mensajeError(usuarios.error)} alReintentar={() => void usuarios.refetch()} />
          </div>
        )}
        {usuarios.data && total === 0 && (
          <Vacio icono={Users} titulo={busqueda.trim() ? 'Sin resultados' : 'Todavía no hay cuentas'}>
            {busqueda.trim() ? 'Ninguna cuenta coincide con la búsqueda.' : 'Agrega la primera cuenta con el botón de arriba.'}
          </Vacio>
        )}
        {visibles.length > 0 && (
          <>
            <Tabla>
              <thead>
                <tr>
                  <Th>Persona</Th>
                  <Th>Teléfono</Th>
                  <Th>Puesto</Th>
                  <Th>Grupos</Th>
                  <Th>Equipos</Th>
                  <Th>Estado</Th>
                  <Th className="text-right">Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((usuario) => (
                  <Fila key={usuario.idPublico}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar nombre={usuario.nombre || usuario.usuario} tamano="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold text-marino-900">{usuario.nombre || usuario.usuario}</p>
                          <p className="text-[12px] text-texto-3">{usuario.usuario}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>{usuario.telefono ?? GUION}</Td>
                    <Td>{usuario.cargo ?? GUION}</Td>
                    <Td className="max-w-56">{textoGrupos(usuario)}</Td>
                    <Td className="max-w-56">{textoEquipos(usuario, listaEquipos)}</Td>
                    <Td>
                      {!usuario.habilitado ? (
                        <Insignia tono="neutro">Dada de baja</Insignia>
                      ) : usuario.bloqueadaHasta ? (
                        <Insignia tono="peligro">Bloqueada hasta {hora(usuario.bloqueadaHasta)}</Insignia>
                      ) : (
                        <Insignia tono="exito">Activa</Insignia>
                      )}
                      {usuario.sesionTelefonoDesde && (
                        <p className="mt-1 text-[11.5px] text-texto-3">App abierta desde {fechaHora(usuario.sesionTelefonoDesde)}</p>
                      )}
                    </Td>
                    <Td>
                      <div className={cn('flex items-center justify-end gap-1', soloLectura && 'hidden')}>
                        <BotonIcono
                          icono={Pencil}
                          etiqueta={`Cambiar los datos de ${usuario.nombre}`}
                          onClick={() => abrirEditar(usuario)}
                        />
                        <BotonIcono
                          icono={SlidersHorizontal}
                          etiqueta={`Cambiar los ajustes de ${usuario.nombre}`}
                          onClick={() => abrirAjustes(usuario)}
                        />
                        {usuario.bloqueadaHasta && (
                          <BotonIcono
                            icono={LockOpen}
                            etiqueta={`Desbloquear la cuenta de ${usuario.nombre}`}
                            onClick={() => desbloquear.mutate(usuario)}
                            disabled={desbloquear.isPending}
                          />
                        )}
                        {usuario.sesionTelefonoDesde && (
                          <BotonIcono
                            icono={Smartphone}
                            etiqueta={`Cerrar la app en el teléfono de ${usuario.nombre}`}
                            onClick={() => cerrarTelefono.mutate(usuario)}
                            disabled={cerrarTelefono.isPending}
                          />
                        )}
                        {usuario.habilitado ? (
                          <BotonIcono
                            icono={Trash2}
                            peligro
                            etiqueta={`Dar de baja a ${usuario.nombre}`}
                            onClick={() => abrirBaja(usuario)}
                          />
                        ) : (
                          <Boton
                            tamano="sm"
                            title="Reactivar la cuenta"
                            aria-label={`Reactivar la cuenta de ${usuario.nombre}`}
                            onClick={() => reactivar.mutate(usuario)}
                            disabled={reactivar.isPending}
                          >
                            {reactivar.isPending && reactivar.variables === usuario ? 'Reactivando…' : 'Reactivar'}
                          </Boton>
                        )}
                      </div>
                    </Td>
                  </Fila>
                ))}
              </tbody>
            </Tabla>
            <Paginacion pagina={paginaSegura} tamano={TAMANO_PAGINA} total={total} alCambiar={setPagina} />
          </>
        )}
      </Tarjeta>

      {modal?.modo === 'crear' && (
        <DialogoCuenta
          usuario={null}
          grupos={listaGrupos}
          gruposError={grupos.error}
          guardando={crear.isPending}
          error={crear.error}
          alGuardar={guardarCuenta}
          alCerrar={cerrarModal}
        />
      )}

      {/* Se abre cuando ya llegaron los grupos: así el selector arranca con el
          grupo actual de la persona y no con "Sin grupo". */}
      {modal?.modo === 'editar' && !grupos.isPending && (
        <DialogoCuenta
          usuario={modal.usuario}
          grupos={listaGrupos}
          gruposError={grupos.error}
          guardando={actualizar.isPending}
          error={actualizar.error}
          alGuardar={guardarCuenta}
          alCerrar={cerrarModal}
        />
      )}

      {modal?.modo === 'baja' && (
        <DialogoConfirmar
          titulo="Dar de baja la cuenta"
          alCerrar={cerrarModal}
          alConfirmar={() => darDeBaja.mutate(modal.usuario)}
          trabajando={darDeBaja.isPending}
          etiqueta="Dar de baja"
          etiquetaTrabajando="Dando de baja…"
        >
          <p>
            ¿Dar de baja a <b className="text-marino-900">{modal.usuario.nombre}</b> ({modal.usuario.usuario})? La
            persona dejará de poder entrar; sus datos y su equipo se conservan, y puedes reactivar la cuenta cuando la
            necesites.
          </p>
          {darDeBaja.error != null && <AvisoError>{mensajeError(darDeBaja.error)}</AvisoError>}
        </DialogoConfirmar>
      )}

      {modal?.modo === 'ajustes' && (
        <DialogoAjustes
          usuario={modal.usuario}
          esquema={esquema.data ?? []}
          cargandoEsquema={esquema.isPending}
          errorEsquema={esquema.error}
          guardando={guardarAjustes.isPending}
          error={guardarAjustes.error}
          alGuardar={(ajustes) => guardarAjustes.mutate({ usuario: modal.usuario, ajustes })}
          alCerrar={cerrarModal}
          configEquipo={
            listaEquipos.find((d) => (modal.usuario.dispositivoIds ?? []).map(String).includes(String(d.idPublico)))?.configuracion ?? null
          }
        />
      )}
    </div>
  );
}
