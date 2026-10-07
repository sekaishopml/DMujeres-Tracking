// Lista de clientes pegada en el panel. Sin imports del panel para poder
// probarla con node.

// Una línea por cliente: "Nombre | Dirección | -2.19, -79.88". La dirección y
// la ubicación son opcionales; así se pega directo desde Excel (con tabulador).
export function leerLineas(texto: string): { nombre: string; direccion: string | null; lat: number | null; lon: number | null }[] {
  return texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const partes = linea.split(/\s*[|\t;]\s*/);
      const [nombre = '', direccion = '', ...resto] = partes;
      const numeros = resto.join(' ').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      return {
        nombre: nombre.trim(),
        direccion: direccion.trim() || null,
        lat: numeros.length >= 2 ? numeros[0] : null,
        lon: numeros.length >= 2 ? numeros[1] : null,
      };
    })
    .filter((c) => c.nombre);
}
