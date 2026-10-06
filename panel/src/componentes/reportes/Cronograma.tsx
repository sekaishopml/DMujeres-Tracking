import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, MapPin, Navigation, TriangleAlert } from 'lucide-react';
import { Segmentado } from '@/componentes/ui/Segmentado';
import { Tarjeta } from '@/componentes/ui/Tarjeta';
import { Avatar } from '@/componentes/ui/Avatar';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { claseBoton } from '@/componentes/ui/Boton';
import { CLAVE_FLOTA, equiposHabilitados, traerDireccion, traerFlota } from '@/dominio/datos';
import { mensajeError } from '@/dominio/errores';
import { hora } from '@/dominio/formatoBase';
import { agruparPorDepartamento, ordenarPorDepartamento } from '@/dominio/departamentos';
import { diaDe, fechaHoyLocal, sumarDias } from '@/dominio/rango';
import {
  TIPOS,
  diasDeSemana,
  etiquetaDia,
  etiquetaMes,
  lunesDe,
  primeroDeMes,
  sumarMeses,
  traerCronograma,
  ultimoDeMes,
  type Actividad,
} from '@/dominio/cronograma';
import { cn } from '@/lib/cn';
import {
  CLAVE_NOVEDADES_CRONOGRAMA,
  REFRESCO_NOVEDADES_MS,
  marcarCronogramaVisto,
  traerNovedadesCronograma,
} from './novedades';

type Vista = 'semana' | 'mes';
const VISTAS = [
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
] as const;

// Cronograma de actividades: lo que cada persona declaró en la app, en
// semana (columnas por día, como su Excel) o en mes (calendario), con la
// auditoría contra su recorrido a la hora declarada.
export default function Cronograma({ pestanas }: { pestanas?: ReactNode }) {
  const hoy = fechaHoyLocal();
  const [vista, setVista] = useState<Vista>('semana');
  const [ancla, setAncla] = useState(hoy);
  const [persona, setPersona] = useState('');

  const flota = useQuery({ queryKey: CLAVE_FLOTA, queryFn: () => traerFlota() });
  // Personas por departamento y nombre; sin elección, se muestra la primera.
  const equipos = useMemo(
    () => ordenarPorDepartamento(equiposHabilitados(flota.data?.datos ?? []), (e) => e.departamento),
    [flota.data],
  );
  const elegida = persona || equipos[0]?.idPublico || '';

  const lunes = lunesDe(ancla);
  const desde = vista === 'semana' ? lunes : primeroDeMes(ancla);
  const hasta = vista === 'semana' ? sumarDias(lunes, 6) : ultimoDeMes(ancla);

  const cronograma = useQuery({
    queryKey: ['cronograma', desde, hasta, elegida],
    queryFn: () => traerCronograma(desde, hasta, elegida),
    enabled: elegida !== '',
    refetchInterval: 60_000,
  });
  const datos = useMemo(() => cronograma.data?.datos ?? [], [cronograma.data]);

  // Avisos: cuántas actividades nuevas cargó cada persona desde la última vez
  // que se abrió su cronograma. Ver el de una persona la marca como vista.
  const cliente = useQueryClient();
  const avisos = useQuery({
    queryKey: CLAVE_NOVEDADES_CRONOGRAMA,
    queryFn: traerNovedadesCronograma,
    refetchInterval: REFRESCO_NOVEDADES_MS,
    retry: false,
  });
  const nuevasPor = useMemo(
    () => new Map((avisos.data?.personas ?? []).map((p) => [p.dispositivoId, p.nuevas])),
    [avisos.data],
  );
  const nuevasElegida = nuevasPor.get(elegida) ?? 0;
  useEffect(() => {
    if (elegida === '' || nuevasElegida === 0 || !cronograma.isSuccess) return;
    marcarCronogramaVisto(elegida)
      .then(() => cliente.invalidateQueries({ queryKey: CLAVE_NOVEDADES_CRONOGRAMA }))
      .catch(() => undefined);
  }, [elegida, nuevasElegida, cronograma.isSuccess, cronograma.dataUpdatedAt, cliente]);

  const mover = (paso: number) =>
    setAncla(vista === 'semana' ? sumarDias(ancla, paso * 7) : sumarMeses(ancla, paso));
  const titulo = vista === 'semana' ? rangoSemana(desde, hasta) : etiquetaMes(desde);

  const novedades = datos.filter((a) => a.tipo === 'novedad').length;
  const sinJornada = datos.filter((a) => !a.registro.conJornada).length;

  return (
    <div className="space-y-4">
      {/* Una sola barra: vista, persona, periodo y, debajo, lo que se está viendo. */}
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          {pestanas}
          <SelectorPersona
            personas={equipos.map((e) => ({ id: e.idPublico, nombre: e.nombre, departamento: e.departamento, nuevas: nuevasPor.get(e.idPublico) ?? 0 }))}
            valor={elegida}
            alCambiar={setPersona}
          />
          <Segmentado opciones={VISTAS} valor={vista} alCambiar={setVista} />
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => mover(-1)} className={claseBoton('secundario', 'sm')} aria-label="Anterior">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" onClick={() => setAncla(hoy)} className={claseBoton('secundario', 'sm')}>
              Hoy
            </button>
            <button type="button" onClick={() => mover(1)} className={claseBoton('secundario', 'sm')} aria-label="Siguiente">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => exportarCsv(datos, desde, hasta)}
            disabled={datos.length === 0}
            className={cn(claseBoton('secundario', 'sm'), 'ml-auto')}
          >
            <Download className="size-4" /> CSV
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-borde px-4 py-2">
          <p className="text-[14px] font-semibold text-marino-900 first-letter:uppercase">{titulo}</p>
          <Dato valor={datos.length} etiqueta="actividades" />
          <Dato valor={novedades} etiqueta="novedades" tono={novedades > 0 ? 'text-marca' : undefined} />
          <Dato
            valor={sinJornada}
            etiqueta="cargadas sin jornada"
            tono={sinJornada > 0 ? 'text-sin-senal' : undefined}
            titulo="Se cargaron con la jornada cerrada: no llevan ubicación de registro."
          />
        </div>
      </Tarjeta>

      {cronograma.error ? (
        <ErrorCarga mensaje={mensajeError(cronograma.error)} alReintentar={() => void cronograma.refetch()} />
      ) : cronograma.isPending ? (
        <Cargando texto="Cargando cronograma…" />
      ) : vista === 'mes' ? (
        <Mes
          desde={desde}
          hasta={hasta}
          hoy={hoy}
          datos={datos}
          alElegirDia={(dia) => {
            setAncla(dia);
            setVista('semana');
          }}
        />
      ) : (
        <Planilla dias={diasDeSemana(lunes)} hoy={hoy} datos={datos} />
      )}
    </div>
  );
}

// Lista de personas con aviso de actividades nuevas: un círculo magenta con el
// número junto a quien subió o cambió su cronograma. El selector del navegador
// no permite color, por eso es una lista propia con el mismo aspecto.
function SelectorPersona({
  personas,
  valor,
  alCambiar,
}: {
  personas: { id: string; nombre: string; departamento: string | null; nuevas: number }[];
  valor: string;
  alCambiar: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const actual = personas.find((p) => p.id === valor);
  const otrasConAviso = personas.filter((p) => p.id !== valor && p.nuevas > 0).length;
  const grupos = useMemo(() => agruparPorDepartamento(personas, (p) => p.departamento), [personas]);
  const conGrupos = grupos.length > 1;

  useEffect(() => {
    if (!abierto) return;
    const fuera = (evento: MouseEvent) => {
      if (!caja.current?.contains(evento.target as Node)) setAbierto(false);
    };
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={otrasConAviso > 0 ? `Persona: ${actual?.nombre ?? ''}. ${otrasConAviso} con actividades nuevas` : `Persona: ${actual?.nombre ?? ''}`}
        onClick={() => setAbierto((v) => !v)}
        className="flex h-9 w-52 cursor-pointer items-center gap-2 rounded-control border border-borde-fuerte bg-superficie px-3 text-left text-[13px] text-texto transition-[border-color,box-shadow] hover:border-marino-300 focus-visible:border-marca focus-visible:ring-3 focus-visible:ring-marca/15 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{actual?.nombre ?? '—'}</span>
        {otrasConAviso > 0 && (
          <span className="size-2.5 flex-none rounded-full bg-marca" title={`${otrasConAviso} con actividades nuevas`} />
        )}
        <ChevronDown className="size-4 flex-none text-texto-3" />
      </button>
      {abierto && (
        <ul
          role="listbox"
          aria-label="Persona"
          className="absolute right-0 z-50 mt-1 max-h-80 w-60 overflow-auto rounded-control border border-borde bg-superficie py-1 shadow-[0_12px_32px_rgb(11_37_69/0.16)]"
        >
          {grupos.map((grupo) => (
            <Fragment key={grupo.departamento}>
              {conGrupos && (
                <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-texto-3 uppercase">
                  {grupo.departamento}
                </li>
              )}
              {grupo.elementos.map((p) => {
                const elegida = p.id === valor;
                return (
                  <li key={p.id} role="option" aria-selected={elegida}>
                    <button
                      type="button"
                      onClick={() => {
                        alCambiar(p.id);
                        setAbierto(false);
                      }}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-fondo',
                        elegida ? 'font-semibold text-marino-900' : 'text-texto',
                      )}
                    >
                      <Check className={cn('size-3.5 flex-none', elegida ? 'text-marca' : 'invisible')} />
                      <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
                      {p.nuevas > 0 && (
                        <span
                          className="grid h-5 min-w-5 flex-none place-items-center rounded-full bg-marca px-1.5 text-[11px] leading-none font-bold text-white cifras"
                          title={`${p.nuevas} actividades nuevas`}
                        >
                          {p.nuevas > 99 ? '99+' : p.nuevas}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dato({ valor, etiqueta, tono, titulo }: { valor: number; etiqueta: string; tono?: string; titulo?: string }) {
  return (
    <p className="text-[12.5px] text-texto-2" title={titulo}>
      <span className={cn('text-[14px] font-semibold text-marino-900 cifras', tono)}>{valor}</span>{' '}
      {etiqueta}
    </p>
  );
}

// Colores de día de la planilla Excel que usa el equipo (lunes salmón,
// martes azul, miércoles verde, jueves amarillo, viernes lavanda). Se mezclan
// con la superficie para que funcionen también en modo nocturno.
const COLOR_DIA = ['#f4b183', '#9dc3e6', '#c5e0b4', '#ffe699', '#c9cdea', '#d9d9d9', '#e7e6e6'];
const NOMBRE_DIA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const tinte = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--color-superficie))`;

// Planilla semanal de una persona, con la misma forma que su Excel: una
// columna por día (HORA | PLANIFICACIÓN) y una fila por actividad en orden.
function Planilla({ dias, hoy, datos, nombre }: { dias: string[]; hoy: string; datos: Actividad[]; nombre?: string }) {
  const visibles = dias.map((d, i) => ({ d, i })).filter(({ d, i }) => i < 5 || datos.some((a) => a.fecha === d));
  const porDia = visibles.map(({ d }) => datos.filter((a) => a.fecha === d).sort((x, y) => x.hora.localeCompare(y.hora)));
  const filas = Math.max(1, ...porDia.map((l) => l.length));
  if (datos.length === 0 && !nombre) {
    return (
      <Tarjeta>
        <Vacio titulo="Sin actividades esta semana">La persona no cargó actividades en la app para estas fechas.</Vacio>
      </Tarjeta>
    );
  }
  return (
    <Tarjeta className="overflow-x-auto">
      {nombre && (
        <div className="flex items-center gap-2.5 border-b border-borde px-4 py-2.5">
          <Avatar nombre={nombre} tamano="sm" />
          <span className="text-[13.5px] font-semibold text-marino-900">{nombre}</span>
          <span className="text-[12px] text-texto-3">{datos.length} actividades</span>
        </div>
      )}
      <table className="w-full min-w-[900px] table-fixed border-collapse text-[12.5px]">
        <colgroup>
          {visibles.map(({ d }) => (
            <FragmentoCol key={d} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {visibles.map(({ d, i }) => (
              <th
                key={d}
                colSpan={2}
                className="border border-borde px-2 py-1.5 text-center text-[12.5px] font-bold text-marino-900"
                style={{ background: tinte(COLOR_DIA[i], d === hoy ? 90 : 70) }}
              >
                {NOMBRE_DIA[i]} {Number(d.slice(8))}
                {d === hoy && <span className="ml-1.5 rounded-full bg-marca px-1.5 text-[10px] text-white">hoy</span>}
              </th>
            ))}
          </tr>
          <tr>
            {visibles.map(({ d, i }) => (
              <FragmentoCabecera key={d} color={COLOR_DIA[i]} />
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: filas }, (_, fila) => (
            <tr key={fila}>
              {visibles.map(({ d, i }, col) => {
                const a = porDia[col][fila];
                const almuerzo = a?.tipo === 'almuerzo';
                return (
                  <FragmentoCelda key={d} actividad={a} color={COLOR_DIA[i]} almuerzo={almuerzo} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Tarjeta>
  );
}


function FragmentoCol() {
  return (
    <>
      <col className="w-[62px]" />
      <col />
    </>
  );
}

function FragmentoCabecera({ color }: { color: string }) {
  return (
    <>
      <th className="border border-borde px-1 py-1 text-center text-[10.5px] font-bold tracking-[0.04em] text-marino-900 uppercase" style={{ background: tinte(color, 45) }}>
        Hora
      </th>
      <th className="border border-borde px-2 py-1 text-center text-[10.5px] font-bold tracking-[0.04em] text-marino-900 uppercase" style={{ background: tinte(color, 25) }}>
        Planificación
      </th>
    </>
  );
}

function FragmentoCelda({ actividad: a, color, almuerzo }: { actividad?: Actividad; color: string; almuerzo: boolean }) {
  const fondoHora = tinte(color, 40);
  const fondo = almuerzo ? 'color-mix(in srgb, var(--color-texto-3) 18%, var(--color-superficie))' : undefined;
  if (!a) {
    return (
      <>
        <td className="border border-borde" style={{ background: tinte(color, 22) }} />
        <td className="border border-borde" />
      </>
    );
  }
  const tipo = TIPOS[a.tipo];
  return (
    <>
      <td
        className="border border-borde px-1 py-1.5 text-center align-top font-mono text-[12px] font-semibold text-marino-900"
        style={{ background: fondo ?? fondoHora }}
      >
        {a.hora}
        {a.horaFin && <span className="block text-[10.5px] font-normal text-texto-3">a {a.horaFin}</span>}
      </td>
      <td className="border border-borde px-2 py-1.5 align-top" style={{ background: fondo }}>
        <div className="flex flex-wrap items-center gap-1">
          {a.tipo !== 'visita' && (
            <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', tipo.clase)}>{tipo.etiqueta}</span>
          )}
          {a.lugar && <span className="font-semibold break-words text-marino-900">{a.lugar}</span>}
        </div>
        {a.nota && <p className="mt-0.5 text-[11.5px] break-words text-texto-2">{a.nota}</p>}
        <AuditoriaCorta actividad={a} />
      </td>
    </>
  );
}

// Cuándo se cargó respecto de lo declarado: antes (planificada), mientras
// ocurría o después de que terminó (registro tardío, con cuánto después).
// Ecuador continental: UTC-5 todo el año.
const MARGEN_CARGA_MS = 15 * 60_000;
// Más de una hora después se marca como aviso, igual que sin jornada.
function momentoDeCarga(a: Actividad): { texto: string; tardia: boolean } | null {
  const inicio = Date.parse(`${a.fecha}T${a.hora}:00-05:00`);
  const fin = Date.parse(`${a.fecha}T${a.horaFin ?? a.hora}:00-05:00`);
  const en = Date.parse(a.registro.en);
  if (Number.isNaN(inicio) || Number.isNaN(fin) || Number.isNaN(en)) return null;
  if (en < inicio - MARGEN_CARGA_MS) return { texto: 'planificada', tardia: false };
  if (en <= fin + MARGEN_CARGA_MS) return null;
  const minutos = Math.round((en - fin) / 60_000);
  const tarde = minutos < 60 ? `${minutos} min` : minutos < 1440 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${Math.floor(minutos / 1440)} d`;
  return { texto: `${tarde} después`, tardia: minutos > 60 };
}

// Auditoría en una línea dentro de la celda; el detalle completo va en el
// título (al pasar el mouse) y en el enlace a la ruta.
function AuditoriaCorta({ actividad: a }: { actividad: Actividad }) {
  const eh = a.enHora;
  const direccion = useDireccionFaltante(eh?.latitud ?? null, eh?.longitud ?? null, eh?.direccion ?? null);
  const cobertura = eh?.detenida && eh.coberturaPct != null ? ` (${eh.coberturaPct} % del horario)` : '';
  const texto = !eh
    ? 'Sin recorrido a esa hora'
    : `${eh.detenida ? 'Detenida' : 'En camino'}${eh.detenida && eh.paradaDesde && eh.paradaHasta ? ` ${hora(eh.paradaDesde)}–${hora(eh.paradaHasta)}${cobertura}` : ''}${direccion ? ` · ${direccion}` : ''}`;
  const momento = momentoDeCarga(a);
  const carga = `Cargada ${hora(a.registro.en)}${diaDe(a.registro.en) !== a.fecha ? ` del ${etiquetaDia(diaDe(a.registro.en))}` : ''}${a.registro.conJornada ? ' con jornada' : ' sin jornada'}${momento ? ` · ${momento.texto}` : ''}`;
  const aviso = !a.registro.conJornada || momento?.tardia === true;
  return (
    <div className="mt-1 space-y-0.5 text-[10.5px] leading-tight">
      <p className="flex items-start gap-1 text-texto-3" title={texto}>
        {eh?.detenida ? <MapPin className="mt-px size-3 flex-none text-detenido" /> : <Navigation className="mt-px size-3 flex-none text-movimiento" />}
        <span className="line-clamp-2">{texto}</span>
        {eh && (
          <Link to={`/replay?dispositivo=${a.dispositivoId}&desde=${a.fecha}&hasta=${a.fecha}`} className="ml-auto flex-none font-semibold text-marino-700 hover:text-marca">
            Ruta
          </Link>
        )}
      </p>
      <p className={cn('flex items-center gap-1', aviso ? 'text-sin-senal' : 'text-texto-3')} title={carga}>
        {aviso && <TriangleAlert className="size-3 flex-none" />}
        {carga}
      </p>
    </div>
  );
}

// Mes: calendario con lo cargado cada día; un clic abre esa semana.
function Mes({
  desde,
  hasta,
  hoy,
  datos,
  alElegirDia,
}: {
  desde: string;
  hasta: string;
  hoy: string;
  datos: Actividad[];
  alElegirDia: (dia: string) => void;
}) {
  const inicio = lunesDe(desde);
  const celdas: string[] = [];
  for (let d = inicio; d <= hasta || celdas.length % 7 !== 0; d = sumarDias(d, 1)) celdas.push(d);
  return (
    <Tarjeta className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-borde bg-fondo text-center text-[11px] font-semibold tracking-[0.06em] text-texto-3 uppercase">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
          <span key={d} className="py-2">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {celdas.map((dia) => {
          const delDia = datos.filter((a) => a.fecha === dia);
          const fuera = dia < desde || dia > hasta;
          const porTipo = new Map<string, number>();
          for (const a of delDia) porTipo.set(a.tipo, (porTipo.get(a.tipo) ?? 0) + 1);
          return (
            <button
              key={dia}
              type="button"
              onClick={() => alElegirDia(dia)}
              className={cn(
                'flex min-h-24 cursor-pointer flex-col items-start justify-start border-r border-b border-borde p-2 text-left transition-colors hover:bg-fondo',
                fuera && 'bg-fondo/60 opacity-50',
              )}
            >
              <span
                className={cn(
                  'inline-grid size-6 place-items-center rounded-full text-[12px] font-semibold cifras',
                  dia === hoy ? 'bg-marca text-white' : 'text-marino-900',
                )}
              >
                {Number(dia.slice(8))}
              </span>
              {delDia.length > 0 && (
                <div className="mt-1 space-y-1">
                  <p className="text-[11.5px] text-texto-2">
                    <strong className="text-marino-900">{delDia.length}</strong>{' '}
                    {delDia.length === 1 ? 'actividad' : 'actividades'} ·{' '}
                    {new Set(delDia.map((a) => a.dispositivoId)).size} pers.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {[...porTipo].map(([tipo, n]) => (
                      <span
                        key={tipo}
                        className={cn('rounded-full px-1.5 text-[10px] font-semibold', TIPOS[tipo as keyof typeof TIPOS].clase)}
                      >
                        {TIPOS[tipo as keyof typeof TIPOS].etiqueta} {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Tarjeta>
  );
}

function useDireccionFaltante(lat: number | null, lon: number | null, conocida: string | null) {
  const consulta = useQuery({
    queryKey: ['geocode', lat?.toFixed(5), lon?.toFixed(5), null],
    queryFn: () => traerDireccion(lat as number, lon as number),
    enabled: conocida == null && lat != null && lon != null,
    staleTime: Infinity,
    retry: false,
  });
  return conocida ?? consulta.data?.direccion ?? null;
}

function exportarCsv(datos: Actividad[], desde: string, hasta: string) {
  const campo = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const filas = [
    ['Fecha', 'Persona', 'Hora', 'Tipo', 'Lugar', 'Nota', 'Cargada', 'Con jornada', 'A esa hora', 'Dirección a esa hora'],
    ...datos.map((a) => [
      a.fecha,
      a.nombre,
      a.horaFin ? `${a.hora}–${a.horaFin}` : a.hora,
      TIPOS[a.tipo].etiqueta,
      a.lugar,
      a.nota,
      a.registro.en,
      a.registro.conJornada ? 'Sí' : 'No',
      a.enHora ? (a.enHora.detenida ? 'Detenida' : 'En camino') : 'Sin recorrido',
      a.enHora?.direccion,
    ]),
  ];
  const texto = '﻿' + filas.map((f) => f.map(campo).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `cronograma-${desde}-a-${hasta}.csv`;
  enlace.click();
  URL.revokeObjectURL(url);
}

const DIA_MES = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', day: 'numeric', month: 'short' });
function rangoSemana(desde: string, hasta: string): string {
  const f = (d: string) => DIA_MES.format(new Date(`${d}T12:00:00Z`)).replace('.', '');
  return `${f(desde)} – ${f(hasta)} ${hasta.slice(0, 4)}`;
}
