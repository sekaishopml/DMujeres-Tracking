import { Component } from 'react';
import type { ReactNode } from 'react';

// Si una sección falla al dibujarse, el menú y el resto del panel siguen
// vivos; solo esa sección muestra el aviso. Va con key={ruta}: al cambiar de
// sección se reinicia.
export default class ErrorSeccion extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full min-h-60 place-items-center p-6 text-center">
        <div>
          <p className="font-semibold text-marino-900">Esta sección falló.</p>
          <button
            type="button"
            className="mt-3 cursor-pointer rounded-control border border-borde px-3 py-1.5 text-[13px] font-semibold text-marino-900 hover:bg-marino-50"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
