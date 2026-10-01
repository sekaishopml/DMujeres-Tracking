import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tarjeta, CabeceraTarjeta } from '@/componentes/ui/Tarjeta';
import { Insignia } from '@/componentes/ui/ChipEstado';
import { Tabla, Th, Td, Fila } from '@/componentes/ui/Tabla';
import { Segmentado } from '@/componentes/ui/Segmentado';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { GUION, hace } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';
import Persona from '@/componentes/reportes/Persona';

// Historial de salud por equipo (GET /api/v1/salud/historial): la app manda su
// diagnóstico cada 10 min y cada uno queda guardado. Aquí se resume la
// ventana elegida para ver si un equipo falla seguido (GPS atrasado, puntos
// sin enviar, recuperaciones del GPS) y con qué teléfono.

interface FilaHistorial {
  dispositivoId: string;
  nombre: string;
  reportes: number;
  ok: number;
  gpsAtrasado: number;
  colaPendiente: number;
  otrosProblemas: number;
  colaMaxima: number | null;
  recuperaciones: number | null;
  telefono: string | null;
  versionAndroid: string | null;
  versionApp: string | null;
  ultimoEstado: string | null;
  ultimoReporte: string | null;
}

type Tono = 'exito' | 'alerta' | 'peligro' | 'marino' | 'neutro';
const ESTADOS: Record<string, { texto: string; tono: Tono }> = {
  ok: { texto: 'Bien', tono: 'exito' },
  gps_atrasado: { texto: 'GPS atrasado', tono: 'alerta' },
  cola_pendiente: { texto: 'Puntos sin enviar', tono: 'alerta' },
  sin_permisos: { texto: 'Sin permisos', tono: 'peligro' },
  gps_apagado: { texto: 'GPS apagado', tono: 'peligro' },
  ubicacion_simulada: { texto: 'Ubicación simulada', tono: 'peligro' },
  cierre_inesperado: { texto: 'Cierre inesperado', tono: 'peligro' },
};

const VENTANAS = [
  { valor: '24', etiqueta: '24 h' },
  { valor: '72', etiqueta: '3 días' },
  { valor: '168', etiqueta: '7 días' },
] as const;
type Ventana = (typeof VENTANAS)[number]['valor'];

function porcentaje(parte: number, total: number): string {
  return total > 0 ? `${Math.round((parte / total) * 100)} %` : GUION;
}

export default function HistorialSalud() {
  const [horas, setHoras] = useState<Ventana>('24');
  const historial = useQuery({
    queryKey: ['sistema', 'historial-salud', horas],
    queryFn: () => api.get<{ horas: number; datos: FilaHistorial[] }>(`/api/v1/salud/historial?horas=${horas}`),
    refetchInterval: 60_000,
  });
  const filas = historial.data?.datos ?? [];

  return (
    <Tarjeta>
      <CabeceraTarjeta
        titulo="Historial de salud"
        detalle="Un diagnóstico de cada teléfono cada 10 min"
        acciones={<Segmentado opciones={VENTANAS} valor={horas} alCambiar={setHoras} />}
      />
      {historial.isPending && <Cargando texto="Cargando historial…" />}
      {historial.error && (
        <div className="px-5 pb-4">
          <ErrorCarga mensaje={mensajeError(historial.error)} alReintentar={() => historial.refetch()} />
        </div>
      )}
      {historial.data && filas.length === 0 && (
        <Vacio titulo="Sin diagnósticos en esta ventana">
          Los teléfonos con la app 2.4 o posterior envían su diagnóstico cada 10 minutos.
        </Vacio>
      )}
      {filas.length > 0 && (
        <Tabla>
          <thead>
            <tr>
              <Th>Persona</Th>
              <Th>Teléfono</Th>
              <Th>App</Th>
              <Th>Último estado</Th>
              <Th numerico>Sin problemas</Th>
              <Th numerico>GPS atrasado</Th>
              <Th numerico>Puntos sin enviar (máx.)</Th>
              <Th numerico>Recuperaciones del GPS</Th>
              <Th>Último diagnóstico</Th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const estado = f.ultimoEstado ? ESTADOS[f.ultimoEstado] ?? { texto: f.ultimoEstado, tono: 'neutro' as const } : null;
              return (
                <Fila key={f.dispositivoId}>
                  <Td><Persona nombre={f.nombre} /></Td>
                  <Td className="whitespace-nowrap text-texto-2">
                    {f.telefono ?? GUION}
                    {f.versionAndroid ? ` · Android ${f.versionAndroid}` : ''}
                  </Td>
                  <Td className="whitespace-nowrap">{f.versionApp ?? GUION}</Td>
                  <Td>{estado ? <Insignia tono={estado.tono}>{estado.texto}</Insignia> : GUION}</Td>
                  <Td numerico title={`${f.ok} de ${f.reportes} diagnósticos`}>{porcentaje(f.ok, f.reportes)}</Td>
                  <Td numerico title="Diagnósticos con jornada abierta y sin punto GPS nuevo en más de 5 min">
                    {f.gpsAtrasado > 0 ? porcentaje(f.gpsAtrasado, f.reportes) : '0 %'}
                  </Td>
                  <Td numerico>{f.colaMaxima ?? GUION}</Td>
                  <Td numerico title="Veces que la app tuvo que reactivar el GPS en la ventana">
                    {f.recuperaciones ?? GUION}
                  </Td>
                  <Td className="whitespace-nowrap">{hace(f.ultimoReporte)}</Td>
                </Fila>
              );
            })}
          </tbody>
        </Tabla>
      )}
    </Tarjeta>
  );
}
