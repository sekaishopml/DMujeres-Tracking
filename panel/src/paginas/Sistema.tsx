import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ServerOff } from 'lucide-react';
import type { EstadoSalud } from '@contratos';
import { api } from '@/lib/api';
import { useSesion } from '@/lib/sesion';
import { Tarjeta, CabeceraTarjeta } from '@/componentes/ui/Tarjeta';
import { Insignia } from '@/componentes/ui/ChipEstado';
import { Tabla, Th, Td, Fila } from '@/componentes/ui/Tabla';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { CLAVE_FLOTA, traerFlota, traerSalud } from '@/dominio/datos';
import type { Disponibilidad, Salud, Version } from '@/dominio/admin';
import { GUION, bateria, fechaHora, hace } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';
import Persona from '@/componentes/reportes/Persona';
import HistorialSalud from '@/componentes/sistema/HistorialSalud';
import Consola, { ejecutarComando } from '@/componentes/sistema/Consola';
import { cn } from '@/lib/cn';

type EstadoServicio = 'ok' | 'error' | 'desconocido';
const PUNTO: Record<EstadoServicio, string> = { ok: 'bg-movimiento', error: 'bg-peligro', desconocido: 'bg-deshabilitado' };

// Cifras del resumen (comando "resumen" de la consola) con su nombre legible.
const CIFRAS: [string, string][] = [
  ['equipos', 'Equipos'],
  ['reportando_15min', 'Reportando (15 min)'],
  ['jornadas_abiertas', 'Jornadas abiertas'],
  ['puntos_hoy', 'Puntos hoy'],
  ['puntos_5min', 'Puntos últimos 5 min'],
  ['ultimo_recibido', 'Último punto recibido'],
  ['eventos_hoy', 'Eventos hoy'],
  ['pendientes_telefonos', 'Pendientes en teléfonos'],
  ['paneles_en_vivo', 'Paneles en vivo'],
];

// Sondeo de salud: suficiente para detectar caídas sin castigar al servidor.
const INTERVALO_MS = 15_000;

// Cada servicio explica qué implica su caída, no un "Ok" suelto.
const SIGNIFICADO: Record<'proceso' | 'baseDatos' | 'tracking', Record<EstadoServicio, string>> = {
  proceso: {
    ok: 'El servicio responde: el panel puede cargar y guardar datos.',
    error: 'El servicio no responde: el panel no puede cargar ni guardar datos.',
    desconocido: 'Comprobando si el servicio responde…',
  },
  baseDatos: {
    ok: 'La base de datos responde: personas e historial disponibles.',
    error: 'La base de datos no responde: no hay datos de personas ni historial.',
    desconocido: 'Sin confirmación de la base de datos.',
  },
  tracking: {
    ok: 'El motor de seguimiento está conectado: las posiciones llegan.',
    error: 'El motor de seguimiento no responde: los teléfonos dejarán de actualizarse.',
    desconocido: 'Sin confirmación del motor de seguimiento.',
  },
};

const ETIQUETA_SALUD: Record<EstadoSalud, { texto: string; tono: 'exito' | 'alerta' | 'peligro' | 'marino' | 'neutro' }> = {
  HEALTHY: { texto: 'Saludable', tono: 'exito' },
  DEGRADED: { texto: 'Degradado', tono: 'alerta' },
  OFFLINE: { texto: 'Sin conexión', tono: 'peligro' },
  RECOVERING: { texto: 'Recuperando', tono: 'marino' },
  MISCONFIGURED: { texto: 'Mal configurado', tono: 'alerta' },
};

function estadoDe(valor: 'ok' | 'error' | undefined, cargando: boolean, fallo: boolean): EstadoServicio {
  if (valor === 'ok') return 'ok';
  if (cargando) return 'desconocido';
  if (valor === 'error' || fallo) return 'error';
  return 'desconocido';
}

// Antigüedad desde un "hace N segundos" que reporta el servidor.
function haceSegundos(segundos: number | null): string {
  if (segundos == null || !Number.isFinite(segundos)) return GUION;
  return hace(new Date(Date.now() - segundos * 1000).toISOString());
}

export default function Sistema() {
  const administrador = useSesion((s) => s.usuario?.administrador === true);

  const salud = useQuery({
    queryKey: ['sistema', 'salud'],
    queryFn: () => api.get<Salud>('/api/v1/health', { redirigir401: false }),
    refetchInterval: INTERVALO_MS,
  });
  const listo = useQuery({
    queryKey: ['sistema', 'listo'],
    queryFn: () => api.get<Disponibilidad>('/api/v1/ready', { redirigir401: false }),
    refetchInterval: INTERVALO_MS,
  });
  const version = useQuery({
    queryKey: ['sistema', 'version'],
    queryFn: () => api.get<Version>('/api/v1/version', { redirigir401: false }),
    refetchInterval: INTERVALO_MS,
  });
  const equipos = useQuery({
    queryKey: ['sistema', 'salud-equipos'],
    queryFn: traerSalud,
    enabled: administrador,
    refetchInterval: INTERVALO_MS,
  });
  const resumen = useQuery({
    queryKey: ['sistema', 'resumen'],
    queryFn: () => ejecutarComando('resumen'),
    enabled: administrador,
    refetchInterval: INTERVALO_MS,
  });
  const flota = useQuery({ queryKey: CLAVE_FLOTA, queryFn: () => traerFlota(), staleTime: 60_000, enabled: administrador });

  const nombres = useMemo(() => new Map((flota.data?.datos ?? []).map((d) => [d.id, d])), [flota.data]);

  if (!administrador) {
    return (
      <Tarjeta>
        <Vacio icono={ServerOff} titulo="Solo para administradores">
          Necesitas permisos de administrador para ver el estado del sistema.
        </Vacio>
      </Tarjeta>
    );
  }

  // /ready puede fallar con 503 o responder 200 "degradado": ambos significan
  // que una dependencia no está bien.
  const baseDatos = listo.data?.dependencias.baseDatos;
  const tracking = listo.data?.dependencias.tracking;
  const listoFalla = listo.isError || listo.data?.estado === 'degradado' || baseDatos === 'error' || tracking === 'error';
  const fallidas: string[] = [];
  if (baseDatos === 'error') fallidas.push('la base de datos');
  if (tracking === 'error') fallidas.push('el motor de seguimiento');

  const estadoApi = estadoDe(salud.data?.estado === 'ok' ? 'ok' : undefined, salud.isPending, salud.isError);
  const estadoBd = estadoDe(baseDatos, listo.isPending, false);
  const estadoTracking = estadoDe(tracking, listo.isPending, false);

  const filas = equipos.data?.datos ?? [];

  return (
    <div className="space-y-4">
      {listoFalla && (
        <div role="alert" className="rounded-tarjeta border border-peligro/20 bg-peligro-suave px-4 py-3 text-[13px] text-peligro">
          <p className="font-semibold">Servicio con problemas</p>
          <p>
            {listo.error
              ? `No se pudo comprobar el estado del servicio: ${mensajeError(listo.error)}`
              : fallidas.length > 0
                ? `La revisión falla en ${fallidas.join(' y ')}.`
                : 'La revisión del servicio quedó en estado con problemas.'}
          </p>
          <p className="text-peligro/80">
            Los datos del panel pueden estar incompletos. Avisa a quien administra el sistema antes de operar.
          </p>
        </div>
      )}
      {salud.error && <ErrorCarga mensaje={mensajeError(salud.error)} alReintentar={() => salud.refetch()} />}

      <Tarjeta className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span className="inline-flex items-center gap-2" title={SIGNIFICADO.proceso[estadoApi]}>
            <span className={cn('size-2 rounded-full', PUNTO[estadoApi])} />
            <b className="font-semibold text-marino-900">API</b>
          </span>
          <span className="inline-flex items-center gap-2" title={SIGNIFICADO.baseDatos[estadoBd]}>
            <span className={cn('size-2 rounded-full', PUNTO[estadoBd])} />
            <b className="font-semibold text-marino-900">Base de datos</b>
          </span>
          <span className="inline-flex items-center gap-2" title={SIGNIFICADO.tracking[estadoTracking]}>
            <span className={cn('size-2 rounded-full', PUNTO[estadoTracking])} />
            <b className="font-semibold text-marino-900">Seguimiento</b>
          </span>
          <span className="ml-auto text-[12px] text-texto-3">
            Comprobado {hace(listo.data?.comprobadoEn ?? (salud.dataUpdatedAt ? new Date(salud.dataUpdatedAt).toISOString() : null))}
          </span>
        </div>
        <p className="mt-2 text-[12px] text-texto-2">
          Panel {__VERSION_PANEL__} · Servicio {version.data?.version ?? GUION} · Esquema {version.data?.versionEsquema ?? GUION} ·
          Commit <span className="font-mono">{version.data?.commit ?? GUION}</span> · Construido {fechaHora(version.data?.construidoEn)}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-borde pt-3 sm:grid-cols-3 xl:grid-cols-9">
          {CIFRAS.map(([clave, texto]) => {
            const i = resumen.data?.columnas.indexOf(clave) ?? -1;
            const valor = i >= 0 ? resumen.data?.filas[0]?.[i] : null;
            return (
              <div key={clave}>
                <dt className="text-[11.5px] text-texto-3">{texto}</dt>
                <dd className="text-[15px] font-semibold text-marino-900 cifras">{valor == null ? GUION : String(valor)}</dd>
              </div>
            );
          })}
        </dl>
      </Tarjeta>

      <Consola />

      <Tarjeta>
        <CabeceraTarjeta titulo="Salud de los equipos" detalle={equipos.data ? `${filas.length} equipos` : undefined} />
        {equipos.isPending && <Cargando texto="Cargando salud de los equipos…" />}
        {equipos.error && (
          <div className="px-5 pb-4">
            <ErrorCarga mensaje={mensajeError(equipos.error)} alReintentar={() => equipos.refetch()} />
          </div>
        )}
        {equipos.data && filas.length === 0 && <Vacio titulo="Sin datos de salud">Todavía no hay equipos que reporten su salud.</Vacio>}
        {filas.length > 0 && (
          <Tabla>
            <thead>
              <tr>
                <Th>Persona</Th>
                <Th>Estado</Th>
                <Th>Causa</Th>
                <Th>Versión de la app</Th>
                <Th>Último reporte</Th>
                <Th numerico>Pendientes</Th>
                <Th numerico>Batería</Th>
              </tr>
            </thead>
            <tbody>
              {filas.map((s) => {
                const etiqueta = ETIQUETA_SALUD[s.estado] ?? { texto: s.estado, tono: 'neutro' as const };
                const dispositivo = nombres.get(s.dispositivoId);
                return (
                  <Fila key={s.dispositivoId}>
                    <Td><Persona nombre={dispositivo?.nombre} /></Td>
                    <Td><Insignia tono={etiqueta.tono}>{etiqueta.texto}</Insignia></Td>
                    <Td className="min-w-56 text-texto-2">{s.causa || GUION}</Td>
                    <Td className="whitespace-nowrap">{s.appVersion ?? dispositivo?.versionApp ?? GUION}</Td>
                    <Td className="whitespace-nowrap">
                      {s.lastFixAgeS != null ? haceSegundos(s.lastFixAgeS) : hace(dispositivo?.ultimaConexion)}
                    </Td>
                    <Td numerico>{s.bufferDepth ?? dispositivo?.pendientes ?? GUION}</Td>
                    <Td numerico>{bateria(s.bateriaPct ?? dispositivo?.bateriaPct)}</Td>
                  </Fila>
                );
              })}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      <HistorialSalud />
    </div>
  );
}
