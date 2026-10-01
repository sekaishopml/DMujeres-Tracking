import { clsx, type ClassValue } from 'clsx';

// Une clases condicionales de Tailwind sin arrastrar librerías de merge: el
// kit evita choques de utilidades por diseño (cada variante define las suyas).
export function cn(...clases: ClassValue[]): string {
  return clsx(clases);
}
