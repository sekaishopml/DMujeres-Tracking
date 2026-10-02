import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useVivo } from '@/lib/vivo';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';
import { useSesion } from '@/lib/sesion';
import { alNoAutorizado, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PantallaCarga } from '@/componentes/ui/PantallaCarga';
import { useTema } from '@/lib/tema';
import { Avatar } from '@/componentes/ui/Avatar';
import { CLAVE_FLOTA, traerFlota } from '@/dominio/datos';
import { claveEstado } from '@/dominio/estado';
import { hace } from '@/dominio/formatoBase';
import { Logo } from './Logo';
import { Notificaciones } from './Notificaciones';
import { GRUPOS, paginaDeRuta } from './navegacion';
import { aplicarAvisoPestana } from './avisoPestana';
import {
  CLAVE_NOVEDADES_CRONOGRAMA,
  REFRESCO_NOVEDADES_MS,
  traerNovedadesCronograma,
} from '@/componentes/reportes/novedades';

const ID_ACCIONES = 'marco-acciones-pagina';
const CLAVE_LATERAL = 'dmj.panel.lateral';

// El lateral plegado (solo íconos) se recuerda por navegador.
function lateralPlegadoInicial(): boolean {
  try {
    return localStorage.getItem(CLAVE_LATERAL) === '1';
  } catch {
    return false;
  }
}

// Las páginas colocan sus acciones (filtros de fecha, exportar, agregar) en la
// barra superior, junto al título, con <AccionesPagina>.
export function AccionesPagina({ children }: { children: ReactNode }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  useEffect(() => setDestino(document.getElementById(ID_ACCIONES)), []);
  return destino ? createPortal(children, destino) : null;
}

// Marco del panel: lateral blanca con el logotipo oficial y la navegación en
// píldoras (la activa en magenta), y barra superior con el título de la
// página, su propósito, la búsqueda de personas, los avisos y la cuenta.
export default function Marco() {
  const { usuario, cargando, cargar, salir } = useSesion();
  useVivo(usuario != null);
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [menuMovil, setMenuMovil] = useState(false);
  const [plegado, setPlegado] = useState(lateralPlegadoInicial);
  const pantallaCompleta = pathname.startsWith('/replay') || pathname.startsWith('/en-vivo');
  // Actividades nuevas en el cronograma: número magenta en "Reportes".
  const novedades = useQuery({
    queryKey: CLAVE_NOVEDADES_CRONOGRAMA,
    queryFn: traerNovedadesCronograma,
    enabled: usuario != null,
    refetchInterval: REFRESCO_NOVEDADES_MS,
    retry: false,
  });
  const avisos: Record<string, number> = { '/reportes': novedades.data?.total ?? 0 };
  // El mismo número en la pestaña del navegador (título e ícono).
  const totalAvisos = novedades.data?.total ?? 0;
  useEffect(() => {
    void aplicarAvisoPestana(totalAvisos);
  }, [totalAvisos]);

  useEffect(() => {
    alNoAutorizado(() => navegar('/login', { replace: true }));
    return () => alNoAutorizado(null);
  }, [navegar]);

  useEffect(() => {
    cargar().then((u) => {
      if (!u) navegar('/login', { replace: true });
    });
  }, [cargar, navegar]);

  useEffect(() => setMenuMovil(false), [pathname]);

  function alternarLateral() {
    setPlegado((actual) => {
      try {
        localStorage.setItem(CLAVE_LATERAL, actual ? '0' : '1');
      } catch {
        // Sin almacenamiento el estado dura hasta recargar.
      }
      return !actual;
    });
  }

  if (cargando || !usuario) return <PantallaCarga texto="Comprobando sesión…" />;

  const pagina = paginaDeRuta(pathname);
  const nombre = usuario.nombre || usuario.correo || 'Cuenta';

  return (
    <div className="flex h-full overflow-hidden bg-fondo">
      <button
        type="button"
        aria-label="Cerrar menú"
        onClick={() => setMenuMovil(false)}
        className={cn('fixed inset-0 z-40 bg-sombra/40 lg:hidden', menuMovil ? 'block' : 'hidden')}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-(--ancho-lateral) flex-none flex-col border-r border-borde bg-superficie',
          'transition-[transform,width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
          'lg:relative lg:translate-x-0',
          plegado && 'lg:w-[76px]',
          menuMovil ? 'translate-x-0 shadow-flotante' : '-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={alternarLateral}
          aria-label={plegado ? 'Desplegar menú lateral' : 'Plegar menú lateral'}
          title={plegado ? 'Desplegar menú' : 'Plegar menú'}
          className="absolute top-[calc(var(--alto-cabecera)/2-12px)] -right-3 z-10 hidden size-6 cursor-pointer place-items-center rounded-md border border-borde bg-superficie text-texto-2 shadow-tarjeta transition-colors hover:border-marca hover:text-marca lg:grid"
        >
          <ChevronLeft className={cn('size-4 transition-transform duration-200', plegado && 'rotate-180')} strokeWidth={2.2} />
        </button>

        {/* Nada dentro del lateral cambia de sitio al plegar: los íconos quedan
            fijos y el ancho solo recorta las etiquetas, que se desvanecen. Así
            la animación no vuelve a maquetar el contenido en cada cuadro. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative h-[calc(var(--alto-cabecera)+10px)] flex-none">
            <div
              className={cn(
                'absolute inset-x-0 top-[calc(50%+6px)] flex -translate-y-1/2 justify-center transition-opacity duration-150',
                plegado && 'lg:pointer-events-none lg:opacity-0',
              )}
            >
              <Logo className="h-[calc(var(--alto-cabecera)-26px)]" />
            </div>
            <div
              className={cn(
                'pointer-events-none absolute top-[calc(50%+6px)] left-4 hidden -translate-y-1/2 opacity-0 transition-opacity duration-200 lg:block',
                plegado && 'lg:opacity-100',
              )}
            >
              <Logo simbolo className="size-9" />
            </div>
            <button
              type="button"
              onClick={() => setMenuMovil(false)}
              aria-label="Cerrar menú"
              className="absolute top-1/2 right-4 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-control text-texto-2 hover:bg-fondo lg:hidden"
            >
              <X className="size-4" />
            </button>
          </div>

          <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-1 pb-2 [scrollbar-width:none]">
            {GRUPOS.map((grupo) => {
              const enlaces = grupo.enlaces.filter((e) => !e.soloAdmin || usuario.administrador);
              if (enlaces.length === 0) return null;
              return (
                <div key={grupo.titulo} className="mb-[clamp(10px,2.4vh,22px)]">
                  <p className="relative mb-1.5 h-4 px-4 text-[11px] leading-4 font-semibold tracking-[0.08em] whitespace-nowrap text-texto-3 uppercase">
                    <span className={cn('transition-opacity duration-150', plegado && 'lg:opacity-0')}>{grupo.titulo}</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-3 top-1/2 hidden border-t border-borde opacity-0 transition-opacity duration-200 lg:block',
                        plegado && 'lg:opacity-100',
                      )}
                    />
                  </p>
                  <div className="flex flex-col gap-1">
                    {enlaces.map(({ ruta, texto, icono: Icono, exacto }) => {
                      const aviso = avisos[ruta] ?? 0;
                      const cifra = aviso > 99 ? '99+' : String(aviso);
                      return (
                      <NavLink
                        key={ruta}
                        to={ruta}
                        end={exacto}
                        title={plegado ? (aviso > 0 ? `${texto} · ${aviso} nuevas` : texto) : undefined}
                        aria-label={aviso > 0 ? `${texto}, ${aviso} actividades nuevas` : texto}
                        className={({ isActive }) =>
                          cn(
                            'group/nav relative flex h-(--alto-item) items-center gap-3.5 overflow-hidden rounded-[12px] px-4 text-[14px] font-medium whitespace-nowrap transition-colors',
                            isActive
                              ? 'bg-marca text-white shadow-[0_6px_16px_-4px_rgb(235_0_69/0.45)]'
                              : 'text-texto-2 hover:bg-fondo hover:text-marino-900',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <Icono className="size-[19px] flex-none" strokeWidth={1.9} />
                            <span className={cn('transition-opacity duration-150', plegado && 'lg:opacity-0')}>{texto}</span>
                            {aviso > 0 && (
                              <span
                                aria-hidden="true"
                                className={cn(
                                  'ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] leading-none font-bold cifras',
                                  isActive ? 'bg-white text-marca' : 'bg-marca text-white',
                                  plegado && 'lg:absolute lg:top-1 lg:left-7 lg:ml-0 lg:h-4 lg:min-w-4 lg:px-1 lg:text-[10px]',
                                )}
                              >
                                {cifra}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="flex-none border-t border-borde px-3 py-2.5">
            <Versiones plegado={plegado} />
            <button
              type="button"
              onClick={salir}
              title={plegado ? 'Cerrar sesión' : undefined}
              aria-label="Cerrar sesión"
              className="flex h-(--alto-item) w-full cursor-pointer items-center gap-3.5 overflow-hidden rounded-[12px] px-4 text-[14px] font-medium whitespace-nowrap text-texto-2 transition-colors hover:bg-peligro-suave hover:text-peligro"
            >
              <LogOut className="size-[19px] flex-none" strokeWidth={1.9} />
              <span className={cn('transition-opacity duration-150', plegado && 'lg:opacity-0')}>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-(--alto-cabecera) flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-borde bg-superficie px-4 py-2 md:px-7">
          <button
            type="button"
            onClick={() => setMenuMovil(true)}
            aria-label="Abrir menú"
            className="grid size-10 cursor-pointer place-items-center rounded-full border border-borde text-texto-2 hover:bg-fondo lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] leading-tight font-semibold">{pagina.texto}</h1>
            {pagina.descripcion && <p className="mt-0.5 hidden truncate text-[13px] text-texto-2 sm:block">{pagina.descripcion}</p>}
          </div>
          <div id={ID_ACCIONES} className="order-last flex w-full flex-wrap items-center gap-2 empty:hidden xl:order-none xl:w-auto [&_input]:w-auto [&_select]:w-auto [&_select]:max-w-56" />
          <div className="flex items-center gap-2">
            <BuscadorPersonas />
            <Notificaciones />
            <MenuCuenta
              nombre={nombre}
              correo={usuario.correo ?? ''}
              rol={usuario.administrador ? 'Administrador' : usuario.soloLectura ? 'Solo lectura' : 'Supervisión'}
              alSalir={salir}
            />
          </div>
        </header>

        <main className={cn('min-h-0 flex-1', pantallaCompleta ? 'overflow-hidden' : 'overflow-y-auto px-4 py-[clamp(14px,2.4vh,24px)] md:px-[clamp(16px,2vw,28px)]')}>
          {/* Cada página entra con un fundido corto; mientras su código baja,
              el marco queda en pie y solo el contenido muestra el círculo. */}
          <div key={pathname} className="h-full animate-entrar">
            <Suspense
              fallback={
                <div className="grid h-full min-h-60 place-items-center">
                  <span className="circulo-carga" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

// Menú de la cuenta: modo nocturno y cierre de sesión, al alcance en
// cualquier pantalla (también en móvil, donde la lateral está oculta).
function MenuCuenta({ nombre, correo, rol, alSalir }: { nombre: string; correo: string; rol: string; alSalir: () => void }) {
  const { tema, alternar } = useTema();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCerrarAlClicFuera(caja, abierto, () => setAbierto(false));

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="flex cursor-pointer items-center gap-2.5 rounded-full border border-borde bg-superficie py-1 pr-1 pl-1 transition-colors hover:border-borde-fuerte md:pr-3"
      >
        <Avatar nombre={nombre} tamano="sm" />
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[160px] truncate text-[13px] font-semibold text-marino-900">{nombre}</span>
          <span className="block text-[11px] text-texto-3">{rol}</span>
        </span>
        <ChevronDown className={cn('hidden size-4 text-texto-3 transition-transform md:block', abierto && 'rotate-180')} />
      </button>
      {abierto && (
        <div role="menu" className="absolute top-12 right-0 z-50 w-64 animate-entrar rounded-tarjeta border border-borde bg-superficie p-1.5 shadow-flotante">
          <div className="border-b border-borde px-3 pt-2 pb-3">
            <p className="truncate text-[13px] font-semibold text-marino-900">{nombre}</p>
            {correo && <p className="truncate text-[12px] text-texto-3">{correo}</p>}
          </div>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={tema === 'oscuro'}
            onClick={alternar}
            className="mt-1.5 flex w-full cursor-pointer items-center gap-3 rounded-control px-3 py-2.5 text-[13px] text-texto hover:bg-fondo"
          >
            {tema === 'oscuro' ? <Sun className="size-4 text-texto-2" /> : <Moon className="size-4 text-texto-2" />}
            <span className="flex-1 text-left">Modo nocturno</span>
            <span className={cn('relative h-5 w-9 rounded-full transition-colors', tema === 'oscuro' ? 'bg-marca' : 'bg-borde-fuerte')}>
              <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]', tema === 'oscuro' ? 'left-[18px]' : 'left-0.5')} />
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={alSalir}
            className="flex w-full cursor-pointer items-center gap-3 rounded-control px-3 py-2.5 text-[13px] text-peligro hover:bg-peligro-suave"
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </button>
          <p className="mt-1 border-t border-borde px-3 pt-2 pb-1 text-[11px] text-texto-3">
            DMujeres Tracking · panel v{__VERSION_PANEL__}
          </p>
        </div>
      )}
    </div>
  );
}

function useCerrarAlClicFuera(caja: React.RefObject<HTMLElement | null>, activo: boolean, cerrar: () => void) {
  useEffect(() => {
    if (!activo) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) cerrar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [caja, activo, cerrar]);
}

// Consulta compartida con las páginas (misma clave de caché): no duplica
// peticiones. Sin redirección en 401 porque es de fondo.
function useFlota() {
  return useQuery({
    queryKey: CLAVE_FLOTA,
    queryFn: () => traerFlota({ redirigir401: false }),
    refetchInterval: 30_000,
  });
}

function BuscadorPersonas() {
  const navegar = useNavigate();
  const flota = useFlota();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const caja = useRef<HTMLDivElement>(null);

  useCerrarAlClicFuera(caja, abierto, () => setAbierto(false));

  const resultados = useMemo(() => {
    const q = texto.trim().toLowerCase();
    const todos = flota.data?.datos ?? [];
    return (q ? todos.filter((d) => `${d.nombre} ${d.identificadorUnico}`.toLowerCase().includes(q)) : todos).slice(0, 8);
  }, [texto, flota.data]);

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label="Buscar persona"
        title="Buscar persona"
        className="grid size-10 cursor-pointer place-items-center rounded-full border border-borde text-texto-2 transition-colors hover:bg-fondo hover:text-marino-900"
      >
        <Search className="size-[18px]" />
      </button>
      {abierto && (
        <div className="absolute top-12 right-0 z-50 w-[min(340px,calc(100vw-32px))] animate-entrar rounded-tarjeta border border-borde bg-superficie p-2 shadow-flotante">
          <input
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar persona o equipo…"
            className="h-10 w-full rounded-control border border-borde bg-fondo px-3 text-[13px] focus:border-marca focus:outline-none"
          />
          <ul className="mt-2 max-h-80 overflow-y-auto">
            {resultados.map((d) => (
              <li key={d.idPublico}>
                <button
                  type="button"
                  onClick={() => {
                    setAbierto(false);
                    setTexto('');
                    navegar(`/unidad/${d.idPublico}`);
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-fondo"
                >
                  <Avatar nombre={d.nombre} estado={claveEstado(d)} tamano="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-marino-900">{d.nombre}</span>
                    <span className="block truncate text-[11.5px] text-texto-3">Último reporte {hace(d.ultimaConexion)}</span>
                  </span>
                </button>
              </li>
            ))}
            {resultados.length === 0 && <li className="px-2 py-6 text-center text-[12.5px] text-texto-3">Sin coincidencias.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// Avisos: personas en jornada sin señal y equipos con batería baja, tomados
// del estado real de la flota (nada se inventa ni se guarda).

// Versiones del panel y de la app Android publicada, sobre "Cerrar sesión".
function Versiones({ plegado }: { plegado: boolean }) {
  const version = useQuery({
    queryKey: ['sistema', 'version'],
    queryFn: () => api.get<{ versionApp?: string | null }>('/api/v1/version', { redirigir401: false }),
    staleTime: 10 * 60_000,
  });
  const app = version.data?.versionApp;
  return (
    <p
      className={cn(
        'mb-1.5 flex items-center gap-1.5 overflow-hidden px-4 text-[11px] whitespace-nowrap text-texto-3 transition-opacity duration-150',
        plegado && 'lg:opacity-0',
      )}
      title={`Panel v${__VERSION_PANEL__}${app ? ` · App v${app}` : ''}`}
    >
      <span className="rounded-md bg-fondo px-1.5 py-0.5 font-medium">Panel v{__VERSION_PANEL__}</span>
      {app && <span className="rounded-md bg-fondo px-1.5 py-0.5 font-medium">App v{app}</span>}
    </p>
  );
}
