// Formato de presentación: nada de datos inventados, campo ausente = "—".
const FECHA_HORA = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' });
const HORA = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const FECHA = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium' });

export const GUION = '—';

export function fechaHora(valor?: string | null): string {
  return valor ? FECHA_HORA.format(new Date(valor)) : GUION;
}

export function hora(valor?: string | null): string {
  return valor ? HORA.format(new Date(valor)) : GUION;
}

export function fecha(valor?: string | null): string {
  return valor ? FECHA.format(new Date(valor)) : GUION;
}

export function hace(valor?: string | null): string {
  if (!valor) return GUION;
  const minutos = Math.round((Date.now() - new Date(valor).getTime()) / 60000);
  if (!Number.isFinite(minutos)) return GUION;
  if (minutos < 1) return 'ahora';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

export function duracion(segundos?: number | null): string {
  if (segundos == null || !Number.isFinite(segundos)) return GUION;
  const total = Math.max(0, Math.round(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function kilometros(metros?: number | null): string {
  if (metros == null || !Number.isFinite(metros)) return GUION;
  const km = metros / 1000;
  return km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

export function velocidad(kmh?: number | null): string {
  return kmh == null || !Number.isFinite(kmh) ? GUION : `${kmh.toFixed(1)} km/h`;
}

export function bateria(pct?: number | null): string {
  return pct == null || !Number.isFinite(pct) ? GUION : `${Math.round(pct)}%`;
}

// Estados de los equipos: los mismos nombres que usa la app.
export const ETIQUETA_ESTADO: Record<string, string> = {
  deshabilitado: 'Fuera de jornada',
  sinSenal: 'Sin señal',
  senalDebil: 'Sin reporte reciente',
  detenido: 'Detenido',
  enLinea: 'En línea',
};
// iPhone: no tiene jornada, su día va de que se activa la app a que se
// desactiva.
export const ETIQUETA_ESTADO_IPHONE: Record<string, string> = {
  deshabilitado: 'App desactivada',
  sinSenal: 'App desactivada',
  senalDebil: 'Señal débil',
  detenido: 'Detenido',
  enLinea: 'App activa',
};

// Colores de estado: los mismos tokens del sistema de diseño (estilos/index.css)
// para que el chip, el marcador del mapa y los gráficos digan lo mismo.
export const COLOR_ESTADO: Record<string, string> = {
  deshabilitado: '#64748b',
  sinSenal: '#d97706',
  senalDebil: '#d97706',
  detenido: '#2563eb',
  enLinea: '#16a34a',
};
