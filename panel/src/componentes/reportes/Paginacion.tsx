import { Boton } from '@/componentes/ui/Boton';

export default function Paginacion({
  pagina,
  tamano,
  total,
  alCambiar,
}: {
  pagina: number;
  tamano: number;
  total: number;
  alCambiar: (pagina: number) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / tamano));
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-borde px-5 py-3 text-[12.5px] text-texto-2">
      <span className="cifras">
        Página {pagina} de {totalPaginas} · {total} registros
      </span>
      <span className="ml-auto flex gap-2">
        <Boton tamano="sm" disabled={pagina <= 1} onClick={() => alCambiar(pagina - 1)}>
          Anterior
        </Boton>
        <Boton tamano="sm" disabled={pagina >= totalPaginas} onClick={() => alCambiar(pagina + 1)}>
          Siguiente
        </Boton>
      </span>
    </div>
  );
}
