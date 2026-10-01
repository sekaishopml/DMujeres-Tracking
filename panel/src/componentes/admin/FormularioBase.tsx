import type { FormEvent, ReactNode } from 'react';
import { Boton } from '@/componentes/ui/Boton';
import { Dialogo } from '@/componentes/ui/Dialogo';

// Diálogo con formulario: el pie (Cancelar / Guardar) queda fuera del área con
// scroll y envía el <form> por su id.
export function DialogoFormulario({
  id,
  titulo,
  descripcion,
  alCerrar,
  alEnviar,
  guardando,
  etiquetaGuardar = 'Guardar',
  children,
}: {
  id: string;
  titulo: ReactNode;
  descripcion?: ReactNode;
  alCerrar: () => void;
  alEnviar: () => void;
  guardando: boolean;
  etiquetaGuardar?: string;
  children: ReactNode;
}) {
  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!guardando) alEnviar();
  }
  return (
    <Dialogo
      abierto
      alCerrar={alCerrar}
      titulo={titulo}
      descripcion={descripcion}
      pie={
        <>
          <Boton variante="secundario" onClick={alCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="principal" type="submit" form={id} disabled={guardando}>
            {guardando ? 'Guardando…' : etiquetaGuardar}
          </Boton>
        </>
      }
    >
      <form id={id} onSubmit={enviar} noValidate className="space-y-4">
        {children}
      </form>
    </Dialogo>
  );
}

// Confirmación de acción destructiva.
export function DialogoConfirmar({
  titulo,
  alCerrar,
  alConfirmar,
  trabajando,
  etiqueta,
  etiquetaTrabajando,
  children,
}: {
  titulo: ReactNode;
  alCerrar: () => void;
  alConfirmar: () => void;
  trabajando: boolean;
  etiqueta: string;
  etiquetaTrabajando: string;
  children: ReactNode;
}) {
  return (
    <Dialogo
      abierto
      ancho="sm"
      alCerrar={alCerrar}
      titulo={titulo}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={trabajando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" onClick={alConfirmar} disabled={trabajando}>
            {trabajando ? etiquetaTrabajando : etiqueta}
          </Boton>
        </>
      }
    >
      <div className="text-[13px] text-texto-2">{children}</div>
    </Dialogo>
  );
}
