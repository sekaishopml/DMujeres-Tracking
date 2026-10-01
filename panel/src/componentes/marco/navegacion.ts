import type { LucideIcon } from 'lucide-react';
import {
  BatteryMedium,
  ChartColumn,
  History,
  LayoutDashboard,
  MapPinned,
  Route,
  Server,
  Settings2,
  Users,
  UsersRound,
} from 'lucide-react';

export interface Enlace {
  ruta: string;
  texto: string;
  // Subtítulo de la barra superior: qué se responde en esta página.
  descripcion: string;
  icono: LucideIcon;
  exacto?: boolean;
  soloAdmin?: boolean;
}

// Menú del panel: una sola fuente para la lateral, las migas y los títulos.
export const GRUPOS: { titulo: string; enlaces: Enlace[] }[] = [
  {
    titulo: 'Operación',
    enlaces: [
      { ruta: '/', descripcion: 'Resumen de la jornada de hoy en toda la operación.', texto: 'Inicio', icono: LayoutDashboard, exacto: true },
      { ruta: '/en-vivo', descripcion: 'Dónde está cada persona ahora y qué hizo en el día.', texto: 'Seguimiento', icono: MapPinned },
      { ruta: '/replay', descripcion: 'Reconstrucción auditada del recorrido: trayectos, paradas e interrupciones de señal.', texto: 'Repetición de ruta', icono: Route },
      { ruta: '/historial', descripcion: 'Quién trabajó cada día: entrada, salida, horas y jornadas sin cerrar.', texto: 'Asistencia', icono: History },
      { ruta: '/bateria', descripcion: 'Nivel de batería, cargas y equipos en riesgo de apagarse.', texto: 'Batería', icono: BatteryMedium },
      { ruta: '/reportes', descripcion: 'Cronograma de actividades declarado por cada persona y auditado contra su recorrido.', texto: 'Reportes', icono: ChartColumn },
    ],
  },
  {
    titulo: 'Administración',
    enlaces: [
      { ruta: '/usuarios', descripcion: 'Cuentas de acceso, roles y equipos asignados.', texto: 'Usuarios', icono: Users, soloAdmin: true },
      { ruta: '/grupos', descripcion: 'Grupos de trabajo y sus integrantes.', texto: 'Grupos', icono: UsersRound, soloAdmin: true },
      { ruta: '/configuracion', descripcion: 'Ajustes de la plataforma y de la app en los teléfonos.', texto: 'Configuración', icono: Settings2, soloAdmin: true },
      { ruta: '/sistema', descripcion: 'Estado de los servicios y de cada equipo.', texto: 'Sistema', icono: Server, soloAdmin: true },
    ],
  },
];

export function paginaDeRuta(ruta: string): { texto: string; grupo: string; descripcion: string } {
  if (ruta.startsWith('/unidad/'))
    return { texto: 'Expediente', grupo: 'Operación', descripcion: 'Expediente de auditoría: equipo, hitos de la jornada y registro de eventos.' };
  for (const grupo of GRUPOS) {
    for (const enlace of grupo.enlaces) {
      if (enlace.exacto ? ruta === enlace.ruta : ruta.startsWith(enlace.ruta) && enlace.ruta !== '/') {
        return { texto: enlace.texto, grupo: grupo.titulo, descripcion: enlace.descripcion };
      }
    }
  }
  return { texto: '', grupo: '', descripcion: '' };
}
