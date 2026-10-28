import { useEffect, useId, useState } from 'react';
import { Boton } from '@/componentes/ui/Boton';
import { Campo, Entrada, Selector } from '@/componentes/ui/Campo';
import { Dialogo } from '@/componentes/ui/Dialogo';
import { quienGuardado, recordarQuien } from '@/dominio/geocercas';
import { TIPOS, validarFormulario } from './logica';
import type { ErroresFormulario, TipoGeocerca } from './logica';

export interface DatosFormulario {
  nombre: string;
  tipo: TipoGeocerca;
  quien: string;
}

// Nombre, tipo y quién hace el cambio. "Quién editó" se pide siempre y se
// recuerda el último nombre usado en este navegador.
export default function FormularioGeocerca({
  abierto,
  titulo,
  inicial,
  soloQuien = false,
  guardando,
  error,
  alGuardar,
  alCancelar,
}: {
  abierto: boolean;
  titulo: string;
  inicial?: { nombre: string; tipo: TipoGeocerca };
  // Para dar de baja o restaurar: solo se pide quién lo hace.
  soloQuien?: boolean;
  guardando: boolean;
  error?: string | null;
  alGuardar: (datos: DatosFormulario) => void;
  alCancelar: () => void;
}) {
  const id = useId();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoGeocerca | ''>('');
  const [quien, setQuien] = useState('');
  const [errores, setErrores] = useState<ErroresFormulario>({});

  useEffect(() => {
    if (!abierto) return;
    setNombre(inicial?.nombre ?? '');
    setTipo(inicial?.tipo ?? '');
    setQuien(quienGuardado());
    setErrores({});
    // Solo al abrir: los cambios de `inicial` mientras se escribe no deben pisar el texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const e = validarFormulario({ nombre, quien, tipo });
    if (soloQuien) {
      delete e.nombre;
      delete e.tipo;
    }
    setErrores(e);
    if (Object.keys(e).length > 0) return;
    recordarQuien(quien);
    alGuardar({ nombre: nombre.trim(), tipo: tipo as TipoGeocerca, quien: quien.trim() });
  }

  return (
    <Dialogo
      abierto={abierto}
      alCerrar={alCancelar}
      titulo={titulo}
      ancho="sm"
      pie={
        <>
          <Boton onClick={alCancelar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton type="submit" form={id} variante="principal" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </>
      }
    >
      <form id={id} onSubmit={enviar} className="space-y-3" noValidate>
        {!soloQuien && (
        <>
        <Campo etiqueta="Nombre de geocerca" error={errores.nombre}>
          <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} autoFocus />
        </Campo>
        <Campo etiqueta="Tipo" error={errores.tipo}>
          <Selector value={tipo} onChange={(e) => setTipo(e.target.value as TipoGeocerca)}>
            <option value="" disabled>
              Elige un tipo
            </option>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </Selector>
        </Campo>
        </>
        )}
        <Campo etiqueta="Quién editó" error={errores.quien} ayuda="Obligatorio: queda en el historial.">
          <Entrada value={quien} onChange={(e) => setQuien(e.target.value)} maxLength={120} autoFocus={soloQuien} />
        </Campo>
        {error && <p className="text-[12.5px] font-medium text-peligro">{error}</p>}
      </form>
    </Dialogo>
  );
}
