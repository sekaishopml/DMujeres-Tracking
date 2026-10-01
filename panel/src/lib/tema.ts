import { create } from 'zustand';

export type Tema = 'claro' | 'oscuro';

const CLAVE = 'dmj.panel.tema';

// Preferencia guardada o, si no hay, la del sistema operativo.
function temaInicial(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  } catch {
    // Almacenamiento bloqueado: se sigue con la preferencia del sistema.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

function aplicar(tema: Tema, animar: boolean) {
  const raiz = document.documentElement;
  if (animar) {
    raiz.classList.add('tema-transicion');
    window.setTimeout(() => raiz.classList.remove('tema-transicion'), 260);
  }
  raiz.dataset.tema = tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tema === 'oscuro' ? '#070b14' : '#ffffff');
}

interface EstadoTema {
  tema: Tema;
  alternar: () => void;
}

export const useTema = create<EstadoTema>((set, get) => {
  const tema = temaInicial();
  aplicar(tema, false);
  return {
    tema,
    alternar: () => {
      const siguiente: Tema = get().tema === 'oscuro' ? 'claro' : 'oscuro';
      try {
        localStorage.setItem(CLAVE, siguiente);
      } catch {
        // Sin almacenamiento el cambio dura hasta recargar.
      }
      aplicar(siguiente, true);
      set({ tema: siguiente });
    },
  };
});

// Colores para lienzos (Chart.js, marcadores) que no leen clases: toma el
// valor vigente del token CSS. Quien lo use debe suscribirse a useTema para
// volver a pintar al cambiar de tema.
export function colorToken(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${nombre}`).trim();
}
