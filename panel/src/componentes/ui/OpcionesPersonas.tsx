import type { Dispositivo } from '@contratos';
import { agruparPorDepartamento } from '@/dominio/departamentos';

// Opciones de un selector de personas, agrupadas por departamento. Con un solo
// departamento no se dibujan grupos: no aportan nada.
export function OpcionesPersonas({
  equipos,
  valorDe = (equipo) => equipo.idPublico,
  etiquetaDe = (equipo) => equipo.nombre,
}: {
  equipos: Dispositivo[];
  valorDe?: (equipo: Dispositivo) => string;
  etiquetaDe?: (equipo: Dispositivo) => string;
}) {
  const grupos = agruparPorDepartamento(equipos, (equipo) => equipo.departamento);
  const opciones = (lista: Dispositivo[]) =>
    lista.map((equipo) => (
      <option key={equipo.idPublico} value={valorDe(equipo)}>
        {etiquetaDe(equipo)}
      </option>
    ));
  if (grupos.length <= 1) return <>{opciones(equipos)}</>;
  return (
    <>
      {grupos.map((grupo) => (
        <optgroup key={grupo.departamento} label={grupo.departamento}>
          {opciones(grupo.elementos)}
        </optgroup>
      ))}
    </>
  );
}
