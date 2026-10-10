// Cosas que caen en el mismo lugar de la pantalla (inicio, fin, paradas y
// novedades). Si son varias, se listan en columnas en vez de encimarse.
//
// Sin imports del panel para poder probarlo con node.

export interface ItemLugar {
  clave: string;
  lon: number;
  lat: number;
  // Instante en ms: el orden de la lista.
  orden: number;
}

// Agrupa por distancia en pantalla (píxeles). Solo devuelve grupos de dos o
// más; un elemento suelto se dibuja como siempre.
export function agruparEnPantalla(
  items: ItemLugar[],
  proyectar: (lon: number, lat: number) => [number, number],
  radioPx = 36,
): ItemLugar[][] {
  const grupos: { ancla: [number, number]; miembros: ItemLugar[] }[] = [];
  const ordenados = [...items].sort((a, b) => a.orden - b.orden);
  for (const item of ordenados) {
    const [x, y] = proyectar(item.lon, item.lat);
    const grupo = grupos.find((g) => Math.hypot(g.ancla[0] - x, g.ancla[1] - y) <= radioPx);
    if (grupo) grupo.miembros.push(item);
    else grupos.push({ ancla: [x, y], miembros: [item] });
  }
  return grupos.filter((g) => g.miembros.length >= 2).map((g) => g.miembros);
}
