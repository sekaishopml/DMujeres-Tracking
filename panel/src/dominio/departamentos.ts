// Departamento de una persona: el grupo al que pertenece (Grupos). Las listas
// se ordenan por departamento y, dentro de cada uno, por el orden que traigan.

export const SIN_DEPARTAMENTO = 'Sin departamento';

export interface GrupoDepartamento<T> {
  departamento: string;
  elementos: T[];
}

// Agrupa conservando el orden de entrada dentro de cada departamento. Los
// departamentos van por nombre y "Sin departamento" al final.
export function agruparPorDepartamento<T>(
  elementos: readonly T[],
  departamentoDe: (elemento: T) => string | null | undefined,
): GrupoDepartamento<T>[] {
  const mapa = new Map<string, T[]>();
  for (const elemento of elementos) {
    const nombre = departamentoDe(elemento)?.trim() || SIN_DEPARTAMENTO;
    const lista = mapa.get(nombre);
    if (lista) lista.push(elemento);
    else mapa.set(nombre, [elemento]);
  }
  return [...mapa.entries()]
    .map(([departamento, lista]) => ({ departamento, elementos: lista }))
    .sort((a, b) => {
      if (a.departamento === SIN_DEPARTAMENTO) return 1;
      if (b.departamento === SIN_DEPARTAMENTO) return -1;
      return a.departamento.localeCompare(b.departamento, 'es');
    });
}

// Lista plana en el orden en que se ve agrupada: por departamento y, dentro de
// cada uno, por nombre. Así la primera opción de un selector es la misma que se
// toma por omisión.
export function ordenarPorDepartamento<T extends { nombre: string }>(
  elementos: readonly T[],
  departamentoDe: (elemento: T) => string | null | undefined,
): T[] {
  const porNombre = [...elementos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return agruparPorDepartamento(porNombre, departamentoDe).flatMap((grupo) => grupo.elementos);
}
