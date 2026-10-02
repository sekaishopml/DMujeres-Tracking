import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { mensajeError } from '@/dominio/errores';
import { Tarjeta, CabeceraTarjeta } from '@/componentes/ui/Tarjeta';

// Consola de Sistema: comandos de solo lectura contra la base (ver
// servidor/api/src/consola.js). "ayuda" lista los comandos; ↑ ↓ recorren los
// anteriores. Los colores son fijos: una terminal se ve igual en tema claro y oscuro.

export interface RespuestaConsola {
  columnas: string[];
  filas: unknown[][];
  recortado?: boolean;
  duracionMs?: number;
}

interface Bloque {
  id: number;
  comando: string;
  respuesta?: RespuestaConsola;
  error?: string;
}

const ATAJOS = ['resumen', 'equipos', 'pendientes', 'recibidos', 'ayuda'];

export function ejecutarComando(comando: string) {
  return api.post<RespuestaConsola>('/api/v1/consola', { comando }, { redirigir401: false });
}

function celda(valor: unknown): string {
  if (valor == null) return '—';
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no';
  return String(valor);
}

export default function Consola() {
  const [bloques, setBloques] = useState<Bloque[]>([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const historial = useRef<string[]>([]);
  const posicion = useRef(-1);
  const salida = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    salida.current?.scrollTo({ top: salida.current.scrollHeight });
  }, [bloques]);

  async function ejecutar(comando: string) {
    const limpio = comando.trim();
    if (!limpio || ocupado) return;
    historial.current = [limpio, ...historial.current.filter((c) => c !== limpio)].slice(0, 50);
    posicion.current = -1;
    setTexto('');
    if (limpio === 'limpiar' || limpio === 'clear') {
      setBloques([]);
      return;
    }
    const id = Date.now();
    setBloques((b) => [...b.slice(-30), { id, comando: limpio }]);
    setOcupado(true);
    try {
      const respuesta = await ejecutarComando(limpio);
      setBloques((b) => b.map((x) => (x.id === id ? { ...x, respuesta } : x)));
    } catch (error) {
      setBloques((b) => b.map((x) => (x.id === id ? { ...x, error: mensajeError(error) } : x)));
    } finally {
      setOcupado(false);
      entrada.current?.focus();
    }
  }

  function alTeclear(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'Enter') void ejecutar(texto);
    if (evento.key === 'ArrowUp' || evento.key === 'ArrowDown') {
      evento.preventDefault();
      const lista = historial.current;
      if (lista.length === 0) return;
      posicion.current = Math.max(-1, Math.min(lista.length - 1, posicion.current + (evento.key === 'ArrowUp' ? 1 : -1)));
      setTexto(posicion.current < 0 ? '' : lista[posicion.current]);
    }
  }

  return (
    <Tarjeta className="overflow-hidden">
      <CabeceraTarjeta titulo="Consola" detalle="Solo lectura · cada comando queda registrado" />
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        {ATAJOS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => void ejecutar(a)}
            className="cursor-pointer rounded-control border border-borde px-2 py-0.5 font-mono text-[12px] text-texto-2 hover:border-marino-300 hover:text-marino-900"
          >
            {a}
          </button>
        ))}
      </div>
      <div
        className="bg-[#06101f] font-mono text-[12.5px] leading-relaxed text-[#d7e3f4]"
        onClick={() => entrada.current?.focus()}
      >
        <div ref={salida} className="max-h-[420px] min-h-[160px] overflow-auto px-4 py-3">
          {bloques.length === 0 && (
            <p className="text-[#7f93b0]">Escribe un comando y presiona Enter. Prueba: ayuda, resumen, posicion &lt;persona&gt;.</p>
          )}
          {bloques.map((b) => (
            <div key={b.id} className="mb-3">
              <p>
                <span className="text-[#ff5c8a]">dmj&gt;</span> {b.comando}
              </p>
              {b.error && <p className="text-[#ff8a8a]">{b.error}</p>}
              {!b.error && !b.respuesta && <p className="text-[#7f93b0]">consultando…</p>}
              {b.respuesta && (
                <>
                  {b.respuesta.filas.length === 0 ? (
                    <p className="text-[#7f93b0]">(sin filas)</p>
                  ) : (
                    <table className="mt-1 border-collapse whitespace-nowrap">
                      <thead>
                        <tr>
                          {b.respuesta.columnas.map((c) => (
                            <th key={c} className="pr-5 text-left font-normal text-[#93b2d6]">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {b.respuesta.filas.map((fila, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            {fila.map((v, j) => (
                              <td key={j} className="pr-5 align-top">
                                {celda(v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {b.respuesta.duracionMs != null && (
                    <p className="text-[#7f93b0]">
                      {b.respuesta.filas.length} {b.respuesta.filas.length === 1 ? 'fila' : 'filas'}
                      {b.respuesta.recortado ? ' (recortado a 200)' : ''} · {b.respuesta.duracionMs} ms
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5">
          <span className="text-[#ff5c8a]">dmj&gt;</span>
          <input
            ref={entrada}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclear}
            disabled={ocupado}
            spellCheck={false}
            autoComplete="off"
            aria-label="Comando"
            className="min-w-0 flex-1 bg-transparent text-[#d7e3f4] outline-none placeholder:text-[#4f6280]"
            placeholder="ayuda"
          />
        </label>
      </div>
    </Tarjeta>
  );
}
