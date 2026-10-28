// Importación de cada página por ruta del menú. App las usa con lazy() y el
// menú las llama al pasar el ratón: la sección ya está bajada al hacer clic.
export const cargarPagina = {
  '/': () => import('@/paginas/Inicio'),
  '/en-vivo': () => import('@/paginas/EnVivo'),
  '/historial': () => import('@/paginas/Historial'),
  '/replay': () => import('@/paginas/Replay'),
  '/bateria': () => import('@/paginas/Bateria'),
  '/reportes': () => import('@/paginas/Reportes'),
  '/usuarios': () => import('@/paginas/Usuarios'),
  '/grupos': () => import('@/paginas/Grupos'),
  '/geocercas': () => import('@/paginas/Geocercas'),
  '/configuracion': () => import('@/paginas/Configuracion'),
  '/sistema': () => import('@/paginas/Sistema'),
};

export function precargarPagina(ruta: string) {
  void cargarPagina[ruta as keyof typeof cargarPagina]?.().catch(() => {});
}
