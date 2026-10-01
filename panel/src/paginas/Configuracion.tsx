import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SearchX, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Pagina } from '@contratos';
import { api, consulta } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import { mensajeError } from '@/dominio/errores';
import { CLAVE_FLOTA, traerEsquemaAjustes, traerUsuariosPlataforma } from '@/dominio/datos';
import { GUION } from '@/dominio/formatoBase';
import { cn } from '@/lib/cn';
import type { ClaveConfiguracionEquipo, DispositivoGestion, ValorConfiguracionEquipo } from '@/dominio/admin';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { Avatar } from '@/componentes/ui/Avatar';
import { Boton } from '@/componentes/ui/Boton';
import { Campo, Entrada, Selector } from '@/componentes/ui/Campo';
import { ChipEstado } from '@/componentes/ui/ChipEstado';
import { ErrorCarga, Esqueleto, Vacio } from '@/componentes/ui/Estados';
import { CabeceraTarjeta, Tarjeta } from '@/componentes/ui/Tarjeta';
import { AvisoError, Buscador, CACHE_FLOTA_CONSULTA_MS } from '@/componentes/admin/comunes';
import '@/componentes/inicio/inicio.css';

interface OpcionCampo {
  valor: string;
  etiqueta: string;
}

type CampoConfig = {
  clave: ClaveConfiguracionEquipo;
  etiqueta: string;
  ayuda: string;
} & ({ tipo: 'numero' } | { tipo: 'booleano' } | { tipo: 'seleccion'; opciones: OpcionCampo[] });

interface SeccionConfig {
  titulo: string;
  detalle: string;
  campos: CampoConfig[];
}

// Claves que acepta PUT /api/v1/fleet/{id}. Se muestra también la clave exacta,
// para no confundirla con otros ajustes de la app.
const SECCIONES: SeccionConfig[] = [
  {
    titulo: 'Frecuencia de reporte',
    detalle: 'Cada cuánto y con qué precisión el teléfono manda su ubicación.',
    campos: [
      {
        clave: 'mobile.intervalSeconds',
        tipo: 'numero',
        etiqueta: 'Intervalo de envío (segundos)',
        ayuda: 'Tiempo entre un reporte y el siguiente.',
      },
      {
        clave: 'mobile.minIntervalSeconds',
        tipo: 'numero',
        etiqueta: 'Intervalo mínimo (segundos)',
        ayuda: 'Nunca se reporta más seguido que esto.',
      },
      {
        clave: 'mobile.distanceMeters',
        tipo: 'numero',
        etiqueta: 'Distancia mínima (metros)',
        ayuda: 'Recorrido necesario para generar un reporte nuevo.',
      },
      {
        clave: 'mobile.angleDegrees',
        tipo: 'numero',
        etiqueta: 'Cambio de rumbo (grados)',
        ayuda: 'Giro que dispara un reporte aunque no se haya avanzado la distancia.',
      },
      {
        clave: 'mobile.accuracy',
        tipo: 'seleccion',
        etiqueta: 'Precisión del GPS',
        ayuda: 'Más precisión consume más batería.',
        opciones: [
          { valor: 'high', etiqueta: 'Alta (high)' },
          { valor: 'medium', etiqueta: 'Media (medium)' },
          { valor: 'low', etiqueta: 'Baja (low)' },
        ],
      },
    ],
  },
  {
    titulo: 'Reportes sin conexión',
    detalle: 'Qué hace el teléfono con los puntos cuando no hay señal.',
    campos: [
      {
        clave: 'mobile.bufferEnabled',
        tipo: 'booleano',
        etiqueta: 'Guardar puntos sin señal',
        ayuda: 'Si está activado, los puntos se guardan y se envían al volver la conexión.',
      },
      {
        clave: 'mobile.bufferMax',
        tipo: 'numero',
        etiqueta: 'Capacidad de la cola (puntos)',
        ayuda: 'Máximo de puntos guardados a la espera de conexión.',
      },
      {
        clave: 'mobile.bufferPolicy',
        tipo: 'seleccion',
        etiqueta: 'Cuando la cola se llena',
        ayuda: 'Qué puntos se descartan al llegar al máximo.',
        opciones: [
          { valor: 'drop_oldest', etiqueta: 'Descartar los más antiguos (drop_oldest)' },
          { valor: 'drop_newest', etiqueta: 'Descartar los más nuevos (drop_newest)' },
          { valor: 'stop', etiqueta: 'Dejar de guardar (stop)' },
        ],
      },
    ],
  },
  {
    titulo: 'Confirmación y reintentos',
    detalle: 'Cómo se asegura el teléfono de que el servidor recibió cada reporte.',
    campos: [
      {
        clave: 'mobile.ackTimeoutSeconds',
        tipo: 'numero',
        etiqueta: 'Espera de confirmación (segundos)',
        ayuda: 'Tiempo que espera la respuesta del servidor antes de reintentar.',
      },
      {
        clave: 'mobile.maxRetries',
        tipo: 'numero',
        etiqueta: 'Reintentos máximos',
        ayuda: 'Cuántas veces se vuelve a enviar un reporte que no se confirmó.',
      },
    ],
  },
];

const CAMPOS_CONFIG: CampoConfig[] = SECCIONES.flatMap((seccion) => seccion.campos);

// Clave del equipo -> clave del ajuste de la app (que trae el valor por
// defecto).
const CLAVE_ESQUEMA: Record<ClaveConfiguracionEquipo, string> = {
  'mobile.intervalSeconds': 'intervalSeconds',
  'mobile.minIntervalSeconds': 'min_interval_seconds',
  'mobile.distanceMeters': 'distanceMeters',
  'mobile.angleDegrees': 'angleDegrees',
  'mobile.accuracy': 'accuracy',
  'mobile.bufferEnabled': 'bufferEnabled',
  'mobile.bufferMax': 'bufferMax',
  'mobile.bufferPolicy': 'bufferPolicy',
  'mobile.ackTimeoutSeconds': 'ackTimeoutSeconds',
  'mobile.maxRetries': 'maxRetries',
};
const UNIDAD: Partial<Record<ClaveConfiguracionEquipo, string>> = {
  'mobile.intervalSeconds': 's',
  'mobile.minIntervalSeconds': 's',
  'mobile.distanceMeters': 'm',
  'mobile.angleDegrees': '°',
  'mobile.ackTimeoutSeconds': 's',
  'mobile.bufferMax': 'puntos',
};

type Vigente = { valor: ValorConfiguracionEquipo; origen: 'equipo' | 'persona' | 'defecto' | 'ninguno' };
type AjustesPersona = Map<string, Record<string, ValorConfiguracionEquipo>>;

// Valor que vale para el equipo, en el mismo orden que usa el servidor: el
// del equipo, si no el de la persona asignada (Usuarios), si no el del
// sistema.
function vigenteDe(
  dispositivo: DispositivoGestion | null,
  clave: ClaveConfiguracionEquipo,
  defectos: Map<string, ValorConfiguracionEquipo>,
  personas?: AjustesPersona,
): Vigente {
  const propio = dispositivo ? valorDesdeConfiguracion(dispositivo.configuracion?.[clave]) : null;
  if (propio !== null) return { valor: propio, origen: 'equipo' };
  const dePersona = dispositivo ? valorDesdeConfiguracion(personas?.get(dispositivo.idPublico)?.[CLAVE_ESQUEMA[clave]]) : null;
  if (dePersona !== null) return { valor: dePersona, origen: 'persona' };
  const defecto = defectos.get(CLAVE_ESQUEMA[clave]) ?? null;
  return defecto !== null ? { valor: defecto, origen: 'defecto' } : { valor: null, origen: 'ninguno' };
}

function legible(campo: CampoConfig, valor: ValorConfiguracionEquipo): string {
  if (valor === null || valor === '') return GUION;
  if (campo.tipo === 'booleano') return valor === true || valor === 'true' ? 'Activado' : 'Desactivado';
  if (campo.tipo === 'seleccion') {
    const opcion = campo.opciones.find((o) => o.valor === String(valor));
    return opcion ? opcion.etiqueta.replace(/\s*\(.*\)$/, '') : String(valor);
  }
  const unidad = UNIDAD[campo.clave];
  return unidad ? `${valor} ${unidad}` : String(valor);
}

type ValoresBorrador = Record<ClaveConfiguracionEquipo, string>;

interface BorradorEquipo {
  nombre: string;
  valores: ValoresBorrador;
}

interface CuerpoEquipo {
  nombre?: string;
  configuracion?: Partial<Record<ClaveConfiguracionEquipo, ValorConfiguracionEquipo>>;
}

type ResultadoCampo = { ok: true; valor: ValorConfiguracionEquipo } | { ok: false; error: string };
type Analisis = { ok: true; cuerpo: CuerpoEquipo } | { ok: false; error: string };

const VALORES_VACIOS: ValoresBorrador = {
  'mobile.intervalSeconds': '',
  'mobile.minIntervalSeconds': '',
  'mobile.distanceMeters': '',
  'mobile.angleDegrees': '',
  'mobile.accuracy': '',
  'mobile.bufferEnabled': '',
  'mobile.bufferMax': '',
  'mobile.bufferPolicy': '',
  'mobile.ackTimeoutSeconds': '',
  'mobile.maxRetries': '',
};

// Un valor ausente o con un tipo inesperado se trata como "sin definir", nunca
// se completa con un valor inventado.
function valorDesdeConfiguracion(valor: unknown): ValorConfiguracionEquipo {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'boolean' || typeof valor === 'string') return valor;
  return null;
}

function textoDesde(valor: ValorConfiguracionEquipo): string {
  return valor === null ? '' : String(valor);
}

function borradorDesde(dispositivo: DispositivoGestion): BorradorEquipo {
  const valores: ValoresBorrador = { ...VALORES_VACIOS };
  for (const campo of CAMPOS_CONFIG) {
    valores[campo.clave] = textoDesde(valorDesdeConfiguracion(dispositivo.configuracion?.[campo.clave]));
  }
  return { nombre: dispositivo.nombre, valores };
}

// Un campo vacío solo vale si el ajuste no existía: el guardado mezcla y no
// acepta null, así que un valor puesto no se puede borrar.
function parsearCampo(campo: CampoConfig, texto: string, original: ValorConfiguracionEquipo): ResultadoCampo {
  const limpio = texto.trim();
  if (limpio === '') {
    if (original !== null) {
      return { ok: false, error: `${campo.etiqueta} ya tiene valor y no se puede quitar; escribe uno nuevo.` };
    }
    return { ok: true, valor: null };
  }
  if (campo.tipo === 'numero') {
    const numero = Number(limpio);
    if (!Number.isFinite(numero)) return { ok: false, error: `${campo.etiqueta} debe ser un número.` };
    return { ok: true, valor: numero };
  }
  if (campo.tipo === 'booleano') {
    if (limpio === 'true') return { ok: true, valor: true };
    if (limpio === 'false') return { ok: true, valor: false };
    return { ok: false, error: `${campo.etiqueta}: usa activado o desactivado.` };
  }
  return { ok: true, valor: limpio };
}

// Devuelve únicamente los campos distintos al valor original.
function calcularCambios(dispositivo: DispositivoGestion, borrador: BorradorEquipo): Analisis {
  const nombre = borrador.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre del equipo no puede quedar vacío.' };
  const cuerpo: CuerpoEquipo = {};
  if (nombre !== dispositivo.nombre) cuerpo.nombre = nombre;
  const configuracion: Partial<Record<ClaveConfiguracionEquipo, ValorConfiguracionEquipo>> = {};
  let hayConfiguracion = false;
  for (const campo of CAMPOS_CONFIG) {
    const original = valorDesdeConfiguracion(dispositivo.configuracion?.[campo.clave]);
    const resultado = parsearCampo(campo, borrador.valores[campo.clave], original);
    if (!resultado.ok) return resultado;
    if (resultado.valor !== original) {
      configuracion[campo.clave] = resultado.valor;
      hayConfiguracion = true;
    }
  }
  if (hayConfiguracion) cuerpo.configuracion = configuracion;
  return { ok: true, cuerpo };
}

// Aplica aquí lo que aceptó la API cuando la respuesta no trae la
// configuración completa.
function aplicarCambios(base: BorradorEquipo, cuerpo: CuerpoEquipo): BorradorEquipo {
  const siguiente: BorradorEquipo = { nombre: cuerpo.nombre ?? base.nombre, valores: { ...base.valores } };
  for (const campo of CAMPOS_CONFIG) {
    const valor = cuerpo.configuracion?.[campo.clave];
    if (valor !== undefined) siguiente.valores[campo.clave] = textoDesde(valor);
  }
  return siguiente;
}

function ControlCampo({
  campo,
  valor,
  vigente,
  porDefecto,
  deshabilitado,
  alCambiar,
}: {
  campo: CampoConfig;
  valor: string;
  vigente: Vigente;
  porDefecto: ValorConfiguracionEquipo;
  deshabilitado: boolean;
  alCambiar: (valor: string) => void;
}) {
  return (
    <Campo
      etiqueta={campo.etiqueta}
      ayuda={
        <>
          <span className="block font-medium text-marino-900">
            Rige: {legible(campo, vigente.valor)}
            <span className="font-normal text-texto-3">
              {vigente.origen === 'equipo'
                ? ' · propio de este equipo'
                : vigente.origen === 'persona'
                  ? ' · de los ajustes de la persona (Usuarios)'
                  : vigente.origen === 'defecto'
                    ? ' · por defecto del sistema'
                    : ''}
            </span>
          </span>
          <span className="block">{campo.ayuda}</span>
        </>
      }
    >
      {campo.tipo === 'numero' ? (
        <Entrada
          type="number"
          step="any"
          min="0"
          value={valor}
          placeholder={porDefecto !== null ? `Por defecto: ${porDefecto}` : undefined}
          onChange={(evento) => alCambiar(evento.target.value)}
          disabled={deshabilitado}
        />
      ) : (
        <Selector value={valor} onChange={(evento) => alCambiar(evento.target.value)} disabled={deshabilitado}>
          <option value="">{porDefecto !== null ? `Por defecto (${legible(campo, porDefecto)})` : 'Sin definir'}</option>
          {campo.tipo === 'booleano' ? (
            <>
              <option value="true">Activado</option>
              <option value="false">Desactivado</option>
            </>
          ) : (
            campo.opciones.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))
          )}
        </Selector>
      )}
    </Campo>
  );
}

export default function Configuracion() {
  // Editar exige administrador y que la cuenta no sea de solo lectura.
  const administrador = useSesion(
    (estado) => estado.usuario?.administrador === true && estado.usuario?.soloLectura !== true,
  );
  const cliente = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [seleccionId, setSeleccionId] = useState('');
  const [seleccionado, setSeleccionado] = useState<DispositivoGestion | null>(null);
  const [original, setOriginal] = useState<BorradorEquipo | null>(null);
  const [borrador, setBorrador] = useState<BorradorEquipo | null>(null);

  // Misma clave que el resto de páginas: comparte la caché de la flota.
  const equipos = useQuery({
    queryKey: CLAVE_FLOTA,
    queryFn: () => api.get<Pagina<DispositivoGestion>>(`/api/v1/fleet${consulta({ tamano: 200 })}`),
    staleTime: CACHE_FLOTA_CONSULTA_MS,
  });

  // Valores por defecto del sistema (los que rigen si el equipo no tiene uno).
  const esquema = useQuery({ queryKey: ['esquema-ajustes'], queryFn: () => traerEsquemaAjustes(), staleTime: 5 * 60_000 });
  const defectos = useMemo(
    () => new Map((esquema.data ?? []).map((e) => [e.clave, (e.porDefecto ?? null) as ValorConfiguracionEquipo])),
    [esquema.data],
  );

  // Ajustes de la persona asignada a cada equipo (Usuarios › ajustes).
  const usuarios = useQuery({ queryKey: ['usuarios-plataforma'], queryFn: () => traerUsuariosPlataforma(), staleTime: 60_000 });
  const personas = useMemo<AjustesPersona>(() => {
    const mapa: AjustesPersona = new Map();
    for (const u of usuarios.data ?? []) {
      if (u.administrador || u.habilitado === false || !u.configApp) continue;
      for (const id of u.dispositivoIds ?? []) mapa.set(String(id), u.configApp as Record<string, ValorConfiguracionEquipo>);
    }
    return mapa;
  }, [usuarios.data]);

  const guardar = useMutation({
    mutationFn: ({ id, cuerpo }: { id: string; cuerpo: CuerpoEquipo }) =>
      api.put<{ dispositivo: DispositivoGestion }>(`/api/v1/fleet/${encodeURIComponent(id)}`, cuerpo),
    onSuccess: (datos, variables) => {
      void cliente.invalidateQueries({ queryKey: ['flota'] });
      toast.success('Cambios guardados.');
      const respuesta = datos.dispositivo;
      if (respuesta && respuesta.configuracion !== undefined && respuesta.configuracion !== null) {
        const base = borradorDesde(respuesta);
        setOriginal(base);
        setBorrador(base);
        setSeleccionado(respuesta);
        setSeleccionId(respuesta.idPublico);
      } else if (original) {
        const base = aplicarCambios(original, variables.cuerpo);
        setOriginal(base);
        setBorrador(base);
        if (respuesta) {
          setSeleccionado(respuesta);
          setSeleccionId(respuesta.idPublico);
        }
      }
    },
    onError: (error) => toast.error(mensajeError(error)),
  });

  const filtro = busqueda.trim().toLowerCase();
  const flota = useMemo(() => {
    const datos = equipos.data?.datos ?? [];
    if (!filtro) return datos;
    return datos.filter(
      (dispositivo) =>
        dispositivo.nombre.toLowerCase().includes(filtro) || dispositivo.identificadorUnico.toLowerCase().includes(filtro),
    );
  }, [equipos.data, filtro]);

  const analisis = seleccionado && borrador ? calcularCambios(seleccionado, borrador) : null;
  const hayCambios = analisis?.ok === true && Object.keys(analisis.cuerpo).length > 0;
  const errorCampos = analisis?.ok === false ? analisis.error : '';

  function seleccionar(dispositivo: DispositivoGestion) {
    const base = borradorDesde(dispositivo);
    setSeleccionId(dispositivo.idPublico);
    setSeleccionado(dispositivo);
    setOriginal(base);
    setBorrador(base);
    guardar.reset();
  }

  function cambiarValor(clave: ClaveConfiguracionEquipo, valor: string) {
    setBorrador((actual) => (actual ? { ...actual, valores: { ...actual.valores, [clave]: valor } } : actual));
  }

  function descartar() {
    if (original) setBorrador(original);
    guardar.reset();
  }

  function enviar() {
    if (!administrador || !seleccionado || !analisis || !analisis.ok || guardar.isPending) return;
    if (Object.keys(analisis.cuerpo).length === 0) return;
    guardar.reset();
    guardar.mutate({ id: seleccionado.idPublico, cuerpo: analisis.cuerpo });
  }

  return (
    <div className="space-y-4">
      <AccionesPagina>
        <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar equipo" />
      </AccionesPagina>

      {!administrador && (
        <p className="rounded-tarjeta border border-sin-senal/25 bg-sin-senal-suave px-4 py-3 text-[13px] font-medium text-sin-senal">
          Tu cuenta no puede cambiar la configuración (hace falta ser administrador y no ser de solo lectura); se muestra en solo lectura.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Equipos, con el resumen de lo que rige en cada uno. */}
        <Tarjeta className="overflow-hidden lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2.5">
            <h2 className="text-[15px] font-semibold">Equipos</h2>
            <span className="text-[12px] text-texto-3">
              {flota.length} de {equipos.data?.total ?? 0}
            </span>
          </div>
          {equipos.isPending ? (
            <div className="space-y-3 px-4 pb-4" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Esqueleto className="size-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Esqueleto className="h-3 w-1/2" />
                    <Esqueleto className="h-2.5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : equipos.error ? (
            <div className="px-4 pb-4">
              <ErrorCarga mensaje={mensajeError(equipos.error)} alReintentar={() => void equipos.refetch()} />
            </div>
          ) : flota.length === 0 ? (
            <Vacio icono={SearchX} titulo="Sin equipos">
              No hay equipos que coincidan con la búsqueda.
            </Vacio>
          ) : (
            <ul className="inicio-lista divide-y divide-borde/70 border-t border-borde" style={{ maxHeight: 'calc(100vh - 230px)' }}>
              {flota.map((dispositivo) => {
                const activo = dispositivo.idPublico === seleccionId;
                const propio = CAMPOS_CONFIG.some((c) => vigenteDe(dispositivo, c.clave, defectos, personas).origen === 'equipo');
                const resumen = ['mobile.intervalSeconds', 'mobile.distanceMeters', 'mobile.accuracy']
                  .map((clave) => {
                    const campo = CAMPOS_CONFIG.find((c) => c.clave === clave)!;
                    return legible(campo, vigenteDe(dispositivo, campo.clave, defectos, personas).valor);
                  })
                  .join(' · ');
                return (
                  <li key={dispositivo.idPublico}>
                    <button
                      type="button"
                      onClick={() => seleccionar(dispositivo)}
                      aria-pressed={activo}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        activo ? 'bg-marca-suave' : 'hover:bg-fondo',
                      )}
                    >
                      <Avatar nombre={dispositivo.nombre} tamano="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={cn('truncate text-[13px] font-semibold', activo ? 'text-marca' : 'text-marino-900')}>
                            {dispositivo.nombre}
                          </span>
                          {propio && (
                            <span className="rounded-full bg-marino-100 px-1.5 text-[10px] font-semibold text-marino-800">Personalizado</span>
                          )}
                        </span>
                        <span className="block truncate text-[11.5px] text-texto-3 cifras">{resumen}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>

        <div className="min-w-0 space-y-4">
          {!seleccionado || !borrador ? (
            <Tarjeta className="overflow-hidden">
              <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                <span className="grid size-9 flex-none place-items-center rounded-full bg-marino-50 text-marino-800">
                  <Settings2 className="size-4" />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold">Configuración por defecto del sistema</h2>
                  <p className="text-[12.5px] text-texto-2">
                    Rige en todos los teléfonos que no tienen un valor propio. Orden: valor del equipo, luego el de la persona
                    (Usuarios › ajustes) y por último este. Elige un equipo para ver o cambiar el suyo.
                  </p>
                </div>
              </div>
              <TablaVigente
                filas={CAMPOS_CONFIG.map((campo) => ({ campo, vigente: vigenteDe(null, campo.clave, defectos) }))}
                cargando={esquema.isPending}
              />
            </Tarjeta>
          ) : (
            <form
              onSubmit={(evento) => {
                evento.preventDefault();
                enviar();
              }}
              noValidate
              className="space-y-4"
            >
              <Tarjeta className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                  <Avatar nombre={seleccionado.nombre} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold">Configuración vigente de {seleccionado.nombre}</h2>
                    <p className="text-[12px] text-texto-3">
                      <span className="font-mono">{seleccionado.identificadorUnico}</span>
                      {seleccionado.versionApp ? ` · App ${seleccionado.versionApp}` : ''}
                    </p>
                  </div>
                  <ChipEstado equipo={seleccionado} />
                </div>
                <TablaVigente
                  filas={CAMPOS_CONFIG.map((campo) => ({ campo, vigente: vigenteDe(seleccionado, campo.clave, defectos, personas) }))}
                  cargando={esquema.isPending}
                />
              </Tarjeta>

              <Tarjeta>
                <CabeceraTarjeta titulo="Nombre del equipo" />
                <div className="px-5 pb-5">
                  <Campo etiqueta="Nombre" ayuda="Así se ve el equipo en Seguimiento, Repetición de ruta y reportes.">
                    <Entrada
                      value={borrador.nombre}
                      onChange={(evento) => setBorrador({ ...borrador, nombre: evento.target.value })}
                      disabled={!administrador}
                      className="sm:max-w-md"
                    />
                  </Campo>
                </div>
              </Tarjeta>

              {SECCIONES.map((seccion) => (
                <Tarjeta key={seccion.titulo}>
                  <CabeceraTarjeta titulo={`Cambiar: ${seccion.titulo.toLowerCase()}`} />
                  <p className="-mt-2 px-5 pb-3 text-[12.5px] text-texto-2">{seccion.detalle}</p>
                  <div className="grid gap-x-5 gap-y-4 px-5 pb-5 sm:grid-cols-2">
                    {seccion.campos.map((campo) => (
                      <ControlCampo
                        key={campo.clave}
                        campo={campo}
                        valor={borrador.valores[campo.clave]}
                        vigente={vigenteDe(seleccionado, campo.clave, defectos, personas)}
                        porDefecto={defectos.get(CLAVE_ESQUEMA[campo.clave]) ?? null}
                        deshabilitado={!administrador}
                        alCambiar={(valor) => cambiarValor(campo.clave, valor)}
                      />
                    ))}
                  </div>
                </Tarjeta>
              ))}

              {errorCampos !== '' && <AvisoError>{errorCampos}</AvisoError>}
              {guardar.error != null && <AvisoError>{mensajeError(guardar.error)}</AvisoError>}

              {administrador && hayCambios && (
                <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-tarjeta border border-borde bg-superficie px-5 py-3 shadow-flotante">
                  <p className="mr-auto text-[13px] font-medium text-marino-900">Hay cambios sin guardar.</p>
                  <Boton onClick={descartar} disabled={guardar.isPending}>
                    Descartar
                  </Boton>
                  <Boton variante="principal" type="submit" disabled={guardar.isPending || errorCampos !== ''}>
                    {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
                  </Boton>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Lo que rige, ajuste por ajuste, con su origen.
function TablaVigente({ filas, cargando }: { filas: { campo: CampoConfig; vigente: Vigente }[]; cargando: boolean }) {
  return (
    <dl className="grid border-t border-borde sm:grid-cols-2">
      {filas.map(({ campo, vigente }) => (
        <div key={campo.clave} className="flex items-baseline justify-between gap-3 border-b border-borde/70 px-5 py-2 sm:odd:border-r">
          <dt className="text-[12.5px] text-texto-2">{campo.etiqueta.replace(/\s*\(.*\)$/, '')}</dt>
          <dd className="text-right">
            {cargando && vigente.origen === 'ninguno' ? (
              <Esqueleto className="h-3.5 w-14" />
            ) : (
              <>
                <span className="text-[13px] font-semibold text-marino-900 cifras">{legible(campo, vigente.valor)}</span>
                {vigente.origen === 'equipo' && (
                  <span className="ml-1.5 rounded-full bg-marino-100 px-1.5 text-[10px] font-semibold text-marino-800">equipo</span>
                )}
                {vigente.origen === 'persona' && (
                  <span className="ml-1.5 rounded-full bg-detenido-suave px-1.5 text-[10px] font-semibold text-detenido">persona</span>
                )}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
