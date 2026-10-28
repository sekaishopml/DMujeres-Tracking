// Partes del panel que se pueden mostrar u ocultar por cuenta. Configuración y
// Sistema son solo de administradores y no se pueden asignar a nadie más.

export const SECCIONES = [
  { codigo: 'inicio', texto: 'Inicio' },
  { codigo: 'seguimiento', texto: 'Seguimiento' },
  { codigo: 'replay', texto: 'Repetición de ruta' },
  { codigo: 'reportes', texto: 'Reportes' },
  { codigo: 'bateria', texto: 'Batería' },
  { codigo: 'historial', texto: 'Historial' },
  { codigo: 'usuarios', texto: 'Usuarios', administracion: true },
  { codigo: 'grupos', texto: 'Grupos', administracion: true },
  // Incluye la lista de clientes que se visitan.
  { codigo: 'geocercas', texto: 'Geocercas', administracion: true },
  { codigo: 'configuracion', texto: 'Configuración', soloAdministrador: true },
  { codigo: 'sistema', texto: 'Sistema', soloAdministrador: true },
];

export const TODAS = SECCIONES.map((s) => s.codigo);
export const ASIGNABLES = SECCIONES.filter((s) => !s.soloAdministrador).map((s) => s.codigo);
// Lo que ve una cuenta que nunca recibió una lista (las de siempre).
export const POR_DEFECTO = SECCIONES.filter((s) => !s.administracion && !s.soloAdministrador).map((s) => s.codigo);

// Secciones que realmente puede ver una cuenta: la administradora todas; las
// demás, su lista guardada (o la de siempre) sin las exclusivas de administración.
export function seccionesDe(administrador, atributos) {
  if (administrador) return [...TODAS];
  const guardadas = atributos?.panel?.secciones;
  const lista = Array.isArray(guardadas) ? guardadas : POR_DEFECTO;
  return lista.filter((codigo) => ASIGNABLES.includes(codigo));
}

// Sección que exige el servidor para una ruta, o null si no depende de una.
const RUTAS_POR_SECCION = [
  ['/api/v1/usuarios', 'usuarios'],
  ['/api/v1/bajas', 'usuarios'],
  ['/api/v1/grupos', 'grupos'],
  ['/api/v1/clientes', 'geocercas'],
  ['/api/v1/salud/historial', 'sistema'],
];

export function seccionDeRuta(camino) {
  const par = RUTAS_POR_SECCION.find(([base]) => camino === base || camino.startsWith(`${base}/`));
  return par ? par[1] : null;
}
