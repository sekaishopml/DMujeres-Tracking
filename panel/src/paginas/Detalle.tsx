import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BatteryCharging, Flag, MapPin, Play, Route, TimerOff, TriangleAlert, ArrowUpRight } from 'lucide-react';
import { consulta } from '@/lib/api';
import {
  CACHE_AUDITORIA_MS,
  traerBateriaEquipo,
  traerDispositivo,
  traerJornadas,
  traerParadas,
  traerReplay,
  traerUltimaPosicion,
} from '@/dominio/datos';
import { construirBitacora, resumenBitacora } from '@/dominio/bitacora';
import type { EventoBitacora } from '@/dominio/bitacora';
import { colorEstado, claveEstado } from '@/dominio/estado';
import { mensajeError, esNoEncontrado } from '@/dominio/errores';
import { bateria, duracion, fecha, fechaHora, GUION, hace, hora, velocidad } from '@/dominio/formatoBase';
import { coordenadas, entero, grados, metros, siNo } from '@/dominio/formato';
import { fechaAyerLocal, fechaHoyLocal, finDeDia, inicioDeDia } from '@/dominio/rango';
import { AccionesPagina } from '@/componentes/marco/Marco';
import { Avatar } from '@/componentes/ui/Avatar';
import { claseBoton } from '@/componentes/ui/Boton';
import { Tarjeta, CabeceraTarjeta } from '@/componentes/ui/Tarjeta';
import { ChipEstado } from '@/componentes/ui/ChipEstado';
import { Entrada } from '@/componentes/ui/Campo';
import { Segmentado } from '@/componentes/ui/Segmentado';
import { Cargando, ErrorCarga, Esqueleto, Vacio } from '@/componentes/ui/Estados';
import { CurvaBateria } from '@/componentes/bateria/CurvaBateria';
import { CLASE_FONDO_NIVEL, nivelBateria } from '@/componentes/bateria/nivel';
import { LineaTiempo, ESTILO_EVENTO } from '@/componentes/expediente/LineaTiempo';
import { MapaLugar } from '@/componentes/expediente/MapaLugar';
import type { PuntoMapa } from '@/componentes/expediente/MapaLugar';

const REFRESCO_MS = 10_000;


// Hito del día en la franja de la ficha: etiqueta pequeña y valor en cifras.
function Hito({
  etiqueta,
  valor,
  icono: Icono,
  tono,
}: {
  etiqueta: string;
  valor: string;
  icono: typeof Play;
  tono?: string;
}) {
  return (
    <div className="px-5 py-3">
      <dt className="flex items-center gap-1.5 text-[11.5px] text-texto-2">
        <Icono className="size-3.5 text-texto-3" />
        {etiqueta}
      </dt>
      <dd className={`mt-0.5 font-display text-[17px] leading-tight font-semibold text-marino-900 cifras ${tono ?? ''}`}>{valor}</dd>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-medium text-texto-3">{etiqueta}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-marino-900">{children}</dd>
    </div>
  );
}

export default function Detalle() {
  const { id } = useParams();
  const idPublico = id ?? '';
  const [params, setParams] = useSearchParams();
  const hoy = fechaHoyLocal();
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') ?? '') ? (params.get('fecha') as string) : hoy;
  const ayer = fechaAyerLocal();
  const [seleccionado, setSeleccionado] = useState<EventoBitacora | null>(null);

  const cambiarDia = (nuevo: string) => {
    if (!nuevo) return;
    setSeleccionado(null);
    setParams(nuevo === hoy ? {} : { fecha: nuevo }, { replace: true });
  };

  const desde = inicioDeDia(dia);
  const hasta = finDeDia(dia);
  const esHoy = dia === hoy;
  const habilitado = idPublico !== '';

  // Sondeo de fondo: un 401 aquí no redirige, la comprobación de sesión decide.
  const equipo = useQuery({
    queryKey: ['dispositivo', idPublico],
    queryFn: () => traerDispositivo(idPublico, { redirigir401: false }),
    enabled: habilitado,
    refetchInterval: REFRESCO_MS,
  });
  const posicion = useQuery({
    queryKey: ['dispositivo', idPublico, 'posicion'],
    queryFn: () => traerUltimaPosicion(idPublico, { redirigir401: false }),
    enabled: habilitado,
    refetchInterval: REFRESCO_MS,
    // Un 404 no es fallo: la persona simplemente no tiene fix conocido.
    retry: false,
  });

  const opcionesDia = { staleTime: CACHE_AUDITORIA_MS, enabled: habilitado, refetchInterval: esHoy ? 60_000 : false } as const;
  const jornadas = useQuery({
    queryKey: ['expediente', idPublico, dia, 'jornadas'],
    queryFn: () => traerJornadas(idPublico, desde, hasta),
    ...opcionesDia,
  });
  const replay = useQuery({
    queryKey: ['expediente', idPublico, dia, 'replay'],
    queryFn: () => traerReplay(idPublico, desde, hasta),
    retry: false,
    ...opcionesDia,
  });
  const paradas = useQuery({
    queryKey: ['expediente', idPublico, dia, 'paradas'],
    queryFn: () => traerParadas(idPublico, desde, hasta),
    ...opcionesDia,
  });
  const bateriaDia = useQuery({
    queryKey: ['expediente', idPublico, dia, 'bateria'],
    queryFn: () => traerBateriaEquipo(idPublico, desde, hasta),
    ...opcionesDia,
  });

  const eventos = useMemo(
    () =>
      construirBitacora({
        jornadas: jornadas.data?.jornadas,
        posiciones: replay.data?.posiciones,
        huecos: replay.data?.huecos,
        paradas: paradas.data?.datos,
        muestrasBateria: bateriaDia.data?.muestras,
      }),
    [jornadas.data, replay.data, paradas.data, bateriaDia.data],
  );
  const resumen = useMemo(() => resumenBitacora(eventos), [eventos]);

  const consultasDia = [jornadas, replay, paradas, bateriaDia];
  const cargandoDia = consultasDia.every((c) => c.isPending);
  const replaySinDatos = replay.error != null && esNoEncontrado(replay.error);
  const candidatos = [
    { nombre: 'las jornadas', q: jornadas, ignorar: false },
    { nombre: 'el recorrido y los huecos de señal', q: replay, ignorar: replaySinDatos },
    { nombre: 'las paradas', q: paradas, ignorar: false },
    { nombre: 'la batería', q: bateriaDia, ignorar: false },
  ];
  const fallos = candidatos.flatMap(({ nombre, q, ignorar }) =>
    q.error && !ignorar ? [{ nombre, error: q.error as unknown, reintentar: () => void q.refetch() }] : [],
  );

  const enlaceReplay = equipo.data
    ? `/replay${consulta({ dispositivo: equipo.data.idPublico, desde: dia, hasta: dia })}`
    : '/replay';

  const dispositivo = equipo.data;
  const ultima = posicion.data;
  const puntoMapa: PuntoMapa | null = seleccionado?.lugar
    ? {
        latitud: seleccionado.lugar.latitud,
        longitud: seleccionado.lugar.longitud,
        color: ESTILO_EVENTO[seleccionado.tipo].color,
      }
    : ultima
      ? { latitud: ultima.latitud, longitud: ultima.longitud, color: dispositivo ? colorEstado(dispositivo) : '#64748b' }
      : null;

  const acciones = (
    <AccionesPagina>
      <Segmentado
        opciones={[
          { valor: 'hoy', etiqueta: 'Hoy' },
          { valor: 'ayer', etiqueta: 'Ayer' },
        ]}
        valor={dia === hoy ? 'hoy' : dia === ayer ? 'ayer' : null}
        alCambiar={(v) => cambiarDia(v === 'hoy' ? hoy : ayer)}
      />
      <Entrada
        type="date"
        aria-label="Día de la bitácora"
        value={dia}
        max={hoy}
        onChange={(e) => cambiarDia(e.target.value)}
        className="w-40"
      />
    </AccionesPagina>
  );

  if (equipo.isPending) {
    return (
      <div className="space-y-5">
        {acciones}
        <Esqueleto className="h-32" />
        <Cargando texto="Cargando expediente…" />
      </div>
    );
  }
  if (equipo.error) {
    return (
      <div className="space-y-5">
        {acciones}
        <ErrorCarga mensaje={mensajeError(equipo.error)} alReintentar={() => void equipo.refetch()} />
        <Link to="/en-vivo" className={claseBoton('secundario')}>
          <ArrowLeft className="size-4" /> Volver
        </Link>
      </div>
    );
  }
  if (!dispositivo) {
    return (
      <Tarjeta>
        <Vacio titulo="La persona no está disponible">No se encontró el equipo solicitado.</Vacio>
      </Tarjeta>
    );
  }

  const nivel = nivelBateria(dispositivo.bateriaPct);
  const muestrasBateria = bateriaDia.data?.muestras ?? [];
  const conPct = muestrasBateria.filter((m) => m.bateriaPct != null);

  return (
    <div className="space-y-5">
      {acciones}

      <Tarjeta className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <Avatar nombre={dispositivo.nombre} estado={claveEstado(dispositivo)} tamano="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-[19px] leading-tight font-semibold text-marino-900">
                {dispositivo.nombre}
              </h2>
              <ChipEstado equipo={dispositivo} />
              {dispositivo.jornadaActiva && (
                <span className="rounded-full bg-movimiento-suave px-2 py-0.5 text-[11px] font-semibold text-movimiento">
                  En jornada
                </span>
              )}
              {!dispositivo.habilitado && (
                <span className="rounded-full bg-deshabilitado-suave px-2 py-0.5 text-[11px] font-semibold text-deshabilitado">
                  Cuenta dada de baja
                </span>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-texto-2">
              <span className="font-mono text-texto-3">{dispositivo.identificadorUnico}</span>
              <span>App {dispositivo.versionApp ?? GUION}</span>
              <span title={dispositivo.ultimaConexion ? fechaHora(dispositivo.ultimaConexion) : undefined}>
                Último reporte {dispositivo.ultimaConexion ? hace(dispositivo.ultimaConexion) : GUION}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {dispositivo.bateriaPct != null && (
                  <span className="h-1.5 w-10 overflow-hidden rounded-full bg-marino-100">
                    <span
                      className={`block h-full rounded-full ${CLASE_FONDO_NIVEL[nivel]}`}
                      style={{ width: `${Math.max(0, Math.min(100, dispositivo.bateriaPct))}%` }}
                    />
                  </span>
                )}
                {bateria(dispositivo.bateriaPct)}
                {dispositivo.cargando && <BatteryCharging className="size-3.5 text-movimiento" aria-label="Cargando" />}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/en-vivo" className={claseBoton('fantasma', 'sm')}>
              <ArrowLeft className="size-4" /> Volver
            </Link>
            <Link to={enlaceReplay} className={claseBoton('principal', 'sm')}>
              <Route className="size-4" /> Repetición de ruta
            </Link>
          </div>
        </div>
        <div className="border-t border-borde bg-fondo/60 px-5 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-texto-3 uppercase">
          Hitos del {fecha(`${dia}T12:00:00`)}
          {esHoy && ' · hoy'}
        </div>
        <dl className="grid grid-cols-2 divide-borde bg-fondo/60 sm:grid-cols-3 sm:divide-x xl:grid-cols-6">
          <Hito etiqueta="Inició jornada" icono={Play} valor={hora(resumen.inicioJornada?.instante)} />
          <Hito etiqueta="Primera salida" icono={ArrowUpRight} valor={hora(resumen.primeraSalida?.instante)} tono="text-movimiento" />
          <Hito etiqueta="Primera llegada" icono={MapPin} valor={hora(resumen.primeraLlegada?.instante)} tono="text-detenido" />
          <Hito
            etiqueta="Finalizó jornada"
            icono={Flag}
            valor={resumen.finJornada ? hora(resumen.finJornada.instante) : resumen.inicioJornada ? 'En curso' : GUION}
          />
          <Hito
            etiqueta="Sin registro"
            icono={TimerOff}
            valor={resumen.cortes > 0 ? duracion(resumen.sinRegistroS) : GUION}
            tono={resumen.sinRegistroS > 0 ? 'text-sin-senal' : undefined}
          />
          <Hito
            etiqueta="Cortes / sin batería"
            icono={TriangleAlert}
            valor={`${resumen.cortes} / ${resumen.sinBateria}`}
            tono={resumen.sinBateria > 0 ? 'text-peligro' : undefined}
          />
        </dl>
      </Tarjeta>

      {fallos.map((f) => (
        <ErrorCarga
          key={f.nombre}
          mensaje={`No se pudo cargar ${f.nombre}: ${mensajeError(f.error)}`}
          alReintentar={f.reintentar}
        />
      ))}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          <Tarjeta>
            <CabeceraTarjeta
              titulo="Bitácora del día"
              detalle={eventos.length > 0 ? `${eventos.length} eventos${resumen.atenciones ? ` · ${resumen.atenciones} por revisar` : ''}` : undefined}
            />
            {cargandoDia ? (
              <Cargando texto="Armando la bitácora…" />
            ) : eventos.length === 0 ? (
              <Vacio titulo="Sin eventos registrados">
                No hay jornadas, paradas ni cortes de señal para este día.
              </Vacio>
            ) : (
              <LineaTiempo eventos={eventos} seleccionado={seleccionado?.id ?? null} alSeleccionar={setSeleccionado} />
            )}
          </Tarjeta>

          <Tarjeta>
            <CabeceraTarjeta
              titulo="Batería del día"
              detalle={conPct.length > 0 ? `${conPct.length} lecturas` : undefined}
            />
            <div className="px-5 pb-5">
              {bateriaDia.isPending ? (
                <Cargando texto="Cargando batería…" />
              ) : bateriaDia.error ? (
                <p className="py-6 text-center text-[13px] text-texto-2">No hay curva de batería disponible.</p>
              ) : conPct.length === 0 ? (
                <Vacio titulo="Sin lecturas de batería">No hay lecturas con porcentaje para este día.</Vacio>
              ) : (
                <CurvaBateria muestras={muestrasBateria} etiqueta="hora" />
              )}
            </div>
          </Tarjeta>
        </div>

        <div className="min-w-0 space-y-5 xl:sticky xl:top-4 xl:self-start">
          <Tarjeta className="overflow-hidden">
            <CabeceraTarjeta
              titulo={seleccionado ? seleccionado.titulo : 'Última posición'}
              detalle={seleccionado ? hora(seleccionado.instante) : undefined}
            />
            {puntoMapa ? (
              <MapaLugar punto={puntoMapa} className="h-72 w-full" />
            ) : (
              <Vacio titulo="Sin posición">
                {posicion.isPending
                  ? 'Cargando posición…'
                  : posicion.error && !esNoEncontrado(posicion.error)
                    ? mensajeError(posicion.error)
                    : 'La persona no tiene posición conocida.'}
              </Vacio>
            )}
            {seleccionado?.lugar?.direccion && (
              <p className="px-5 pt-3 text-[12.5px] text-texto-2">{seleccionado.lugar.direccion}</p>
            )}
            {seleccionado ? (
              <div className="flex items-center justify-between px-5 py-3 text-[12px] text-texto-3">
                <span className="cifras">{coordenadas(seleccionado.lugar?.latitud, seleccionado.lugar?.longitud)}</span>
                <button type="button" onClick={() => setSeleccionado(null)} className="cursor-pointer font-semibold text-marca">
                  Ver última posición
                </button>
              </div>
            ) : (
              ultima && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
                  <Dato etiqueta="Coordenadas">{coordenadas(ultima.latitud, ultima.longitud)}</Dato>
                  <Dato etiqueta="Velocidad">{velocidad(ultima.velocidadKmh)}</Dato>
                  <Dato etiqueta="Rumbo">{grados(ultima.rumboGrados)}</Dato>
                  <Dato etiqueta="Precisión">{metros(ultima.precisionM)}</Dato>
                  <Dato etiqueta="Altitud">{metros(ultima.altitudM)}</Dato>
                  <Dato etiqueta="Batería">{bateria(ultima.bateriaPct)}</Dato>
                  <Dato etiqueta="Registrada">
                    {ultima.registradoEn ? `${fechaHora(ultima.registradoEn)}` : GUION}
                  </Dato>
                  <Dato etiqueta="Recibida">{fechaHora(ultima.recibidoEn)}</Dato>
                  <Dato etiqueta="Posición válida">{siNo(ultima.valida)}</Dato>
                  <Dato etiqueta="Pendientes de envío">{entero(dispositivo.pendientes)}</Dato>
                </dl>
              )
            )}
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
