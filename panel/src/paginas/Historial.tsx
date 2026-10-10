import { Fragment, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { JornadaFlota } from '@contratos';
import { consulta } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Avatar } from '@/componentes/ui/Avatar';
import { Selector } from '@/componentes/ui/Campo';
import { OpcionesPersonas } from '@/componentes/ui/OpcionesPersonas';
import { Segmentado } from '@/componentes/ui/Segmentado';
import { Tarjeta } from '@/componentes/ui/Tarjeta';
import { claseBoton } from '@/componentes/ui/Boton';
import { ErrorCarga, Esqueleto, Vacio } from '@/componentes/ui/Estados';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { GUION } from '@/dominio/formatoBase';
import { traerFlota, traerJornadasFlota, CACHE_AUDITORIA_MS, CLAVE_FLOTA, equiposHabilitados } from '@/dominio/datos';
import { agruparPorDepartamento, ordenarPorDepartamento } from '@/dominio/departamentos';
import { mensajeError } from '@/dominio/errores';
import { etiquetaMes, lunesDe, primeroDeMes, sumarMeses, ultimoDeMes } from '@/dominio/cronograma';
import { fechaHoyLocal, finDeDia, inicioDeDia, sumarDias } from '@/dominio/rango';
import '@/componentes/inicio/inicio.css';

// Asistencia: planilla persona × día con la entrada, la salida y las horas de
// cada jornada, en vista de semana o de mes. Una jornada que cruza la medianoche
// o sigue abierta aparece en cada día que cubre, con las horas de ese día:
// así una jornada en curso desde hace días se ve hoy. Cada celda abre la
// repetición de ruta de ese día.

const ZONA = 'America/Guayaquil';
const HORA = new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA });
const NOMBRE_DIA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const JORNADA_LARGA_H = 16;
// Jornadas abiertas antes del periodo: se buscan hasta 14 días atrás.
const MARGEN_DIAS = 14;

type Vista = 'semana' | 'mes';
const VISTAS: readonly { valor: Vista; etiqueta: string }[] = [
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
];

function diasDe(vista: Vista, ancla: string): string[] {
  if (vista === 'semana') return Array.from({ length: 7 }, (_, i) => sumarDias(lunesDe(ancla), i));
  const primero = primeroDeMes(ancla);
  const ultimo = ultimoDeMes(ancla);
  const dias: string[] = [];
  for (let d = primero; d <= ultimo; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

function indiceSemana(dia: string): number {
  return (new Date(`${dia}T12:00:00`).getDay() + 6) % 7;
}

function horasTexto(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return h > 0 ? `${h} h${m > 0 ? ` ${m}` : ''}` : `${m} min`;
}

function horasCortas(minutos: number): string {
  return `${(minutos / 60).toLocaleString('es-EC', { maximumFractionDigits: 1 })} h`;
}

interface Celda {
  minutos: number;
  // Primera entrada del día (null si la jornada venía del día anterior).
  entrada: string | null;
  // Última salida del día (null si siguió después o sigue en curso).
  salida: string | null;
  enCurso: boolean;
  abiertaLarga: boolean;
  continua: boolean;
}

// Reparte cada jornada en los días que cubre, con los minutos de cada día.
function celdasPorPersona(jornadas: JornadaFlota[], ahora: number): Map<string, Map<string, Celda>> {
  const mapa = new Map<string, Map<string, Celda>>();
  for (const j of jornadas) {
    const inicio = new Date(j.inicioEn).getTime();
    const fin = j.finEn ? new Date(j.finEn).getTime() : ahora;
    if (!(fin > inicio)) continue;
    const abiertaLarga = !j.soloApp && !j.finEn && (ahora - inicio) / 3_600_000 > JORNADA_LARGA_H;
    const porDia = mapa.get(j.idPublico) ?? new Map<string, Celda>();
    for (let dia = DIA.format(new Date(inicio)); ; dia = sumarDias(dia, 1)) {
      const desdeDia = new Date(inicioDeDia(dia)).getTime();
      const hastaDia = new Date(finDeDia(dia)).getTime() + 1;
      if (desdeDia >= fin) break;
      const a = Math.max(inicio, desdeDia);
      const b = Math.min(fin, hastaDia);
      if (b > a) {
        const celda = porDia.get(dia) ?? { minutos: 0, entrada: null, salida: null, enCurso: false, abiertaLarga: false, continua: false };
        celda.minutos += (b - a) / 60_000;
        if (inicio >= desdeDia && (!celda.entrada || j.inicioEn < celda.entrada)) celda.entrada = j.inicioEn;
        if (inicio < desdeDia) celda.continua = true;
        if (j.finEn && fin <= hastaDia && (!celda.salida || j.finEn > celda.salida)) celda.salida = j.finEn;
        if (!j.finEn && ahora <= hastaDia) celda.enCurso = true;
        if (abiertaLarga) celda.abiertaLarga = true;
        porDia.set(dia, celda);
      }
    }
    mapa.set(j.idPublico, porDia);
  }
  return mapa;
}

export default function Historial() {
  const hoy = fechaHoyLocal();
  const [vista, setVista] = useState<Vista>('semana');
  const [ancla, setAncla] = useState(hoy);
  const [persona, setPersona] = useState('');
  const dias = useMemo(() => diasDe(vista, ancla), [vista, ancla]);
  const titulo =
    vista === 'mes'
      ? etiquetaMes(dias[0]).replace(/^./, (l) => l.toUpperCase()).replace(' De ', ' de ')
      : `${Number(dias[0].slice(8))}/${dias[0].slice(5, 7)} – ${Number(dias[6].slice(8))}/${dias[6].slice(5, 7)}/${dias[6].slice(0, 4)}`;

  const flota = useQuery({ queryKey: CLAVE_FLOTA, queryFn: () => traerFlota(), staleTime: 60_000 });
  const personas = useMemo(
    () => ordenarPorDepartamento(equiposHabilitados(flota.data?.datos ?? []), (e) => e.departamento),
    [flota.data],
  );
  const jornadas = useQuery({
    queryKey: ['asistencia', dias[0], dias[dias.length - 1]],
    queryFn: () => traerJornadasFlota(inicioDeDia(sumarDias(dias[0], -MARGEN_DIAS)), finDeDia(dias[dias.length - 1])),
    staleTime: CACHE_AUDITORIA_MS,
    refetchInterval: () => (document.hidden ? false : 60_000),
  });

  const celdas = useMemo(
    () => celdasPorPersona(jornadas.data?.datos ?? [], jornadas.dataUpdatedAt || Date.now()),
    [jornadas.data, jornadas.dataUpdatedAt],
  );
  const filas = personas.filter((p) => persona === '' || p.idPublico === persona);
  const grupos = useMemo(() => agruparPorDepartamento(filas, (p) => p.departamento), [filas]);

  const mover = (paso: number) => setAncla(vista === 'semana' ? sumarDias(ancla, paso * 7) : sumarMeses(ancla, paso));

  return (
    <div className="space-y-4">
      <AccionesPagina>
        <Selector aria-label="Persona" className="w-44" value={persona} onChange={(e) => setPersona(e.target.value)}>
          <option value="">Todo el equipo</option>
          <OpcionesPersonas equipos={personas} />
        </Selector>
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
      </AccionesPagina>

      <Tarjeta className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3.5 pb-2.5">
          <h2 className="text-[15px] font-semibold">{titulo}</h2>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-texto-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-movimiento" /> En curso
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-sin-senal" /> Abierta más de {JORNADA_LARGA_H} h (sin cerrar)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-marino-300" /> Cerrada
            </span>
          </p>
        </div>

        {jornadas.error ? (
          <div className="px-4 pb-4">
            <ErrorCarga mensaje={mensajeError(jornadas.error)} alReintentar={() => void jornadas.refetch()} />
          </div>
        ) : flota.isPending || jornadas.isPending ? (
          <PlanillaEsqueleto columnas={vista === 'semana' ? 7 : 10} />
        ) : filas.length === 0 ? (
          <Vacio titulo="Sin personas">No hay personas activas para mostrar.</Vacio>
        ) : (
          <div className="overflow-x-auto">
            <table className={cn('w-full border-collapse text-[12.5px]', vista === 'semana' ? 'min-w-[900px]' : 'min-w-[1280px]')}>
              <thead>
                <tr className="border-y border-borde bg-marino-50/60 text-[10.5px] font-semibold tracking-[0.05em] text-texto-3 uppercase">
                  <th className="sticky left-0 z-[1] bg-marino-50 px-4 py-2 text-left">Persona</th>
                  {dias.map((dia) => {
                    const i = indiceSemana(dia);
                    return (
                      <th
                        key={dia}
                        className={cn('px-1 py-2 text-center', dia === hoy && 'text-marca', i >= 5 && 'bg-marino-100/40')}
                      >
                        {vista === 'semana' ? `${NOMBRE_DIA[i]} ${dia.slice(8, 10)}` : (
                          <>
                            <span className="block">{NOMBRE_DIA[i].slice(0, 2)}</span>
                            <span className="block">{Number(dia.slice(8, 10))}</span>
                          </>
                        )}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-right">Días</th>
                  <th className="px-3 py-2 text-right">Horas</th>
                  <th className="px-3 py-2 text-right">Entrada media</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((grupo) => (
                  <Fragment key={grupo.departamento}>
                    {grupos.length > 1 && (
                      <tr className="border-b border-borde/70 bg-marino-50/60">
                        <th
                          colSpan={dias.length + 4}
                          scope="colgroup"
                          className="px-4 py-1.5 text-left text-[10.5px] font-semibold tracking-[0.05em] text-texto-3 uppercase"
                        >
                          <span className="sticky left-4">
                            {grupo.departamento} · {grupo.elementos.length}
                          </span>
                        </th>
                      </tr>
                    )}
                    {grupo.elementos.map((p) => (
                      <FilaAsistencia
                        key={p.idPublico}
                        persona={p}
                        orden={filas.indexOf(p)}
                        dias={dias}
                        porDia={celdas.get(p.idPublico)}
                        hoy={hoy}
                        compacta={vista === 'mes'}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

function FilaAsistencia({
  persona,
  orden,
  dias,
  porDia,
  hoy,
  compacta,
}: {
  persona: { idPublico: string; nombre: string };
  orden: number;
  dias: string[];
  porDia: Map<string, Celda> | undefined;
  hoy: string;
  compacta: boolean;
}) {
  const delPeriodo = dias.map((d) => porDia?.get(d)).filter((c): c is Celda => Boolean(c));
  const minutos = delPeriodo.reduce((suma, c) => suma + c.minutos, 0);
  const entradas = delPeriodo
    .filter((c) => c.entrada)
    .map((c) => {
      const [h, m] = HORA.format(new Date(c.entrada!)).split(':').map(Number);
      return h * 60 + m;
    });
  const media = entradas.length > 0 ? Math.round(entradas.reduce((a, b) => a + b, 0) / entradas.length) : null;
  return (
    <tr className="inicio-fila border-b border-borde/70 last:border-b-0" style={{ '--orden': Math.min(orden, 12) } as CSSProperties}>
      <td className="sticky left-0 z-[1] bg-superficie px-4 py-2">
        <span className="flex items-center gap-2.5">
          <Avatar nombre={persona.nombre} tamano="sm" />
          <span className="truncate font-semibold text-marino-900">{persona.nombre}</span>
        </span>
      </td>
      {dias.map((dia) => (
        <td key={dia} className={cn('px-0.5 py-1.5 text-center', indiceSemana(dia) >= 5 && 'bg-marino-50/50')}>
          <CeldaDia celda={porDia?.get(dia) ?? null} dia={dia} hoy={hoy} persona={persona} compacta={compacta} />
        </td>
      ))}
      <td className="px-3 py-2 text-right font-semibold text-marino-900 cifras">{delPeriodo.length}</td>
      <td className="px-3 py-2 text-right text-marino-900 cifras">{minutos > 0 ? horasTexto(minutos) : GUION}</td>
      <td className="px-3 py-2 text-right text-texto-2 cifras">
        {media == null ? GUION : `${String(Math.floor(media / 60)).padStart(2, '0')}:${String(media % 60).padStart(2, '0')}`}
      </td>
    </tr>
  );
}

function CeldaDia({
  celda,
  dia,
  hoy,
  persona,
  compacta,
}: {
  celda: Celda | null;
  dia: string;
  hoy: string;
  persona: { idPublico: string; nombre: string };
  compacta: boolean;
}) {
  if (!celda) return <span className="text-texto-3">{dia > hoy ? '' : GUION}</span>;
  const tono = celda.abiertaLarga ? 'bg-sin-senal-suave' : celda.enCurso ? 'bg-movimiento-suave' : 'bg-marino-50';
  const entrada = celda.entrada ? HORA.format(new Date(celda.entrada)) : 'continúa';
  const salida = celda.salida ? HORA.format(new Date(celda.salida)) : celda.enCurso ? 'en curso' : 'sigue';
  const detalle = `${persona.nombre} · ${dia}: ${entrada} – ${salida}, ${horasTexto(celda.minutos)}${
    celda.abiertaLarga ? ' (jornada sin cerrar)' : ''
  }. Abrir la repetición de ruta.`;
  return (
    <Link
      to={`/replay${consulta({ dispositivo: persona.idPublico, desde: dia, hasta: dia })}`}
      title={detalle}
      aria-label={detalle}
      className={cn('block rounded-[8px] px-1 py-1 leading-tight transition-colors hover:bg-marino-100/70', tono)}
    >
      {compacta ? (
        <span className={cn('block text-[11.5px] font-semibold cifras', celda.abiertaLarga ? 'text-sin-senal' : 'text-marino-900')}>
          {horasCortas(celda.minutos)}
        </span>
      ) : (
        <>
          <span className="block font-semibold text-marino-900 cifras">
            {entrada} – {salida}
          </span>
          <span className={cn('block text-[11px] cifras', celda.abiertaLarga ? 'font-semibold text-sin-senal' : 'text-texto-3')}>
            {celda.abiertaLarga ? `Sin cerrar · ${horasTexto(celda.minutos)}` : horasTexto(celda.minutos)}
          </span>
        </>
      )}
    </Link>
  );
}

function PlanillaEsqueleto({ columnas }: { columnas: number }) {
  return (
    <div className="space-y-2.5 px-4 pb-4" aria-busy="true" aria-label="Cargando asistencia">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Esqueleto className="size-8 flex-none rounded-full" />
          <Esqueleto className="h-3 w-24 flex-none" />
          {Array.from({ length: columnas }, (_, j) => (
            <Esqueleto key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
