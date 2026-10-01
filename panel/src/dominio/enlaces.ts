import { consulta } from '@/lib/api';

// Enlaces entre páginas en un solo sitio: Replay lee dispositivo, desde y
// hasta (YYYY-MM-DD) de la URL.
export function urlReplay(idPublico: string, desde: string, hasta = desde): string {
  return `/replay${consulta({ dispositivo: idPublico, desde, hasta })}`;
}

export function urlExpediente(idPublico: string, fecha?: string): string {
  return `/unidad/${encodeURIComponent(idPublico)}${consulta({ fecha })}`;
}
