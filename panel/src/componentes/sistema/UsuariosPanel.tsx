import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, UserRound } from 'lucide-react';
import type { CuentaPanel, CuentaPanelEntrada, OpcionesCuentaPanel, TipoCuentaPanel } from '@contratos';
import { api } from '@/lib/api';
import { Tarjeta, CabeceraTarjeta } from '@/componentes/ui/Tarjeta';
import { Boton, BotonIcono } from '@/componentes/ui/Boton';
import { Campo, Casilla, Entrada, Selector } from '@/componentes/ui/Campo';
import { Insignia } from '@/componentes/ui/ChipEstado';
import { Tabla, Th, Td, Fila } from '@/componentes/ui/Tabla';
import { Cargando, ErrorCarga, Vacio } from '@/componentes/ui/Estados';
import { AvisoError } from '@/componentes/admin/comunes';
import { GUION, fechaHora } from '@/dominio/formatoBase';
import { mensajeError } from '@/dominio/errores';

const CLAVE = ['sistema', 'cuentas-panel'];
const CLAVE_OPCIONES = ['sistema', 'cuentas-panel-opciones'];

const TIPOS: { valor: TipoCuentaPanel; texto: string; ayuda: string }[] = [
  { valor: 'administrador', texto: 'Administrador', ayuda: 'Ve y cambia todo.' },
  { valor: 'operador', texto: 'Operador', ayuda: 'Cambia lo operativo, sin administración.' },
  { valor: 'solo_lectura', texto: 'Solo lectura', ayuda: 'Solo consulta: no puede cambiar nada.' },
];
const TEXTO_TIPO = Object.fromEntries(TIPOS.map((t) => [t.valor, t.texto])) as Record<TipoCuentaPanel, string>;

interface Borrador {
  usuario: string;
  nombre: string;
  clave: string;
  tipo: TipoCuentaPanel;
  secciones: string[];
  grupoIds: string[];
  personaIds: string[];
  habilitado: boolean;
}

const VACIO: Borrador = {
  usuario: '',
  nombre: '',
  clave: '',
  tipo: 'solo_lectura',
  secciones: ['inicio', 'seguimiento', 'replay', 'reportes', 'bateria', 'historial'],
  grupoIds: [],
  personaIds: [],
  habilitado: true,
};

function alternar(lista: string[], valor: string): string[] {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
}

function Formulario({
  cuenta,
  opciones,
  alCerrar,
}: {
  cuenta: CuentaPanel | null;
  opciones: OpcionesCuentaPanel;
  alCerrar: () => void;
}) {
  const cliente = useQueryClient();
  const [datos, setDatos] = useState<Borrador>(
    cuenta
      ? {
          usuario: cuenta.usuario,
          nombre: cuenta.nombre,
          clave: '',
          tipo: cuenta.tipo,
          secciones: cuenta.secciones,
          grupoIds: cuenta.grupos.map((g) => g.id),
          personaIds: cuenta.personas.map((p) => p.id),
          habilitado: cuenta.habilitado,
        }
      : VACIO,
  );
  const [filtro, setFiltro] = useState('');
  const propia = cuenta?.propia === true;
  const administrador = datos.tipo === 'administrador';
  // Una cuenta administradora trae todas las partes; al bajarla solo valen las asignables.
  const secciones = datos.secciones.filter((c) => opciones.secciones.find((s) => s.codigo === c)?.asignable);

  const guardar = useMutation({
    mutationFn: () => {
      if (!cuenta) {
        const cuerpo: CuentaPanelEntrada = {
          usuario: datos.usuario.trim(),
          nombre: datos.nombre.trim(),
          clave: datos.clave,
          tipo: datos.tipo,
          secciones,
          grupoIds: datos.grupoIds,
          personaIds: datos.personaIds,
        };
        return api.post(`/api/v1/panel/cuentas`, cuerpo);
      }
      // En la cuenta propia el servidor no admite cambiar tipo ni permisos.
      const cuerpo: Partial<CuentaPanelEntrada> & { habilitado?: boolean } = { nombre: datos.nombre.trim() };
      if (datos.clave) cuerpo.clave = datos.clave;
      if (!propia) {
        cuerpo.tipo = datos.tipo;
        cuerpo.secciones = secciones;
        cuerpo.grupoIds = datos.grupoIds;
        cuerpo.personaIds = datos.personaIds;
        cuerpo.habilitado = datos.habilitado;
      }
      return api.patch(`/api/v1/panel/cuentas/${cuenta.id}`, cuerpo);
    },
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE });
      alCerrar();
    },
  });

  const desbloquear = useMutation({
    mutationFn: () => api.patch(`/api/v1/panel/cuentas/${cuenta?.id}`, { desbloquear: true }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE }),
  });

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    guardar.mutate();
  }

  const personas = opciones.personas.filter((p) => {
    const t = filtro.trim().toLowerCase();
    return t === '' || p.nombre.toLowerCase().includes(t) || p.usuario.toLowerCase().includes(t);
  });
  const sinAlcance = !administrador && datos.grupoIds.length === 0 && datos.personaIds.length === 0;

  return (
    <form onSubmit={enviar} className="space-y-4 border-t border-borde px-5 py-4">
      <h3 className="text-[14px] font-semibold text-marino-900">{cuenta ? `Editar ${cuenta.usuario}` : 'Nueva cuenta de panel'}</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Campo etiqueta="Nombre">
          <Entrada value={datos.nombre} onChange={(e) => setDatos({ ...datos, nombre: e.target.value })} required maxLength={200} />
        </Campo>
        <Campo etiqueta="Usuario" ayuda={cuenta ? 'No se puede cambiar.' : 'Distingue mayúsculas de minúsculas.'}>
          <Entrada
            value={datos.usuario}
            onChange={(e) => setDatos({ ...datos, usuario: e.target.value })}
            disabled={cuenta != null}
            required
            minLength={2}
            maxLength={40}
            autoComplete="off"
          />
        </Campo>
        <Campo etiqueta={cuenta ? 'Clave nueva' : 'Clave'} ayuda={cuenta ? 'Déjala vacía para no cambiarla.' : 'Mínimo 8 caracteres.'}>
          <Entrada
            type="password"
            value={datos.clave}
            onChange={(e) => setDatos({ ...datos, clave: e.target.value })}
            required={!cuenta}
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
          />
        </Campo>
        <Campo etiqueta="Tipo de cuenta" ayuda={TIPOS.find((t) => t.valor === datos.tipo)?.ayuda}>
          <Selector value={datos.tipo} disabled={propia} onChange={(e) => setDatos({ ...datos, tipo: e.target.value as TipoCuentaPanel })}>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.texto}
              </option>
            ))}
          </Selector>
        </Campo>
      </div>

      <fieldset disabled={propia} className="space-y-2">
        <legend className="text-[12px] font-semibold text-marino-900">Partes del panel que puede ver</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {opciones.secciones.map((s) => {
            const fija = !s.asignable;
            return (
              <Casilla
                key={s.codigo}
                etiqueta={s.texto}
                checked={administrador || (!fija && datos.secciones.includes(s.codigo))}
                disabled={administrador || fija || propia}
                onChange={() => setDatos({ ...datos, secciones: alternar(datos.secciones, s.codigo) })}
              />
            );
          })}
        </div>
        {!administrador && (
          <p className="text-[12px] text-texto-3">Configuración y Sistema son solo de administradores.</p>
        )}
      </fieldset>

      <fieldset disabled={propia || administrador} className="space-y-2">
        <legend className="text-[12px] font-semibold text-marino-900">Personal que puede ver</legend>
        {administrador ? (
          <p className="text-[12.5px] text-texto-2">Una cuenta administradora ve a todo el personal.</p>
        ) : (
          <>
            <p className="text-[12px] text-texto-3">
              Un grupo incluye a quienes entren después. También se pueden elegir personas una por una.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[12px] font-medium text-texto-2">Grupos</p>
                <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-control border border-borde p-2.5">
                  {opciones.grupos.length === 0 && <p className="text-[12.5px] text-texto-3">No hay grupos creados.</p>}
                  {opciones.grupos.map((g) => (
                    <div key={g.id}>
                      <Casilla
                        etiqueta={g.nombre}
                        checked={datos.grupoIds.includes(g.id)}
                        onChange={() => setDatos({ ...datos, grupoIds: alternar(datos.grupoIds, g.id) })}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[12px] font-medium text-texto-2">
                  Personas <span className="text-texto-3">({datos.personaIds.length} elegidas)</span>
                </p>
                <Entrada placeholder="Buscar persona…" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="mb-1.5" />
                <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-control border border-borde p-2.5">
                  {personas.length === 0 && <p className="text-[12.5px] text-texto-3">Sin coincidencias.</p>}
                  {personas.map((p) => (
                    <div key={p.id}>
                      <Casilla
                        etiqueta={`${p.nombre} (${p.usuario})`}
                        checked={datos.personaIds.includes(p.id)}
                        onChange={() => setDatos({ ...datos, personaIds: alternar(datos.personaIds, p.id) })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {sinAlcance && (
              <p className="text-[12.5px] font-medium text-sin-senal">
                Sin grupos ni personas asignadas, esta cuenta no verá a nadie.
              </p>
            )}
          </>
        )}
      </fieldset>

      {cuenta && !propia && (
        <Casilla
          etiqueta="Cuenta habilitada (si se deshabilita, se cierran sus sesiones)"
          checked={datos.habilitado}
          onChange={(e) => setDatos({ ...datos, habilitado: e.target.checked })}
        />
      )}
      {propia && <p className="text-[12px] text-texto-3">Es tu cuenta: no puedes cambiar su tipo, sus permisos ni deshabilitarla.</p>}

      {guardar.error && <AvisoError>{mensajeError(guardar.error)}</AvisoError>}
      {desbloquear.error && <AvisoError>{mensajeError(desbloquear.error)}</AvisoError>}
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" variante="principal" disabled={guardar.isPending}>
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
        {cuenta?.bloqueada && (
          <Boton variante="peligro" onClick={() => desbloquear.mutate()} disabled={desbloquear.isPending}>
            Desbloquear cuenta
          </Boton>
        )}
      </div>
    </form>
  );
}

function resumenAlcance(c: CuentaPanel): string {
  if (c.tipo === 'administrador') return 'Todo el personal';
  const partes = [
    c.grupos.length > 0 ? `${c.grupos.length} ${c.grupos.length === 1 ? 'grupo' : 'grupos'}` : null,
    c.personas.length > 0 ? `${c.personas.length} ${c.personas.length === 1 ? 'persona' : 'personas'}` : null,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' y ') : 'Nadie';
}

// Cuentas de acceso al panel (no las del personal de campo): quién entra, qué
// partes ve y a qué personal llega.
export default function UsuariosPanel() {
  // null = cerrado, 'nueva' = alta, o la cuenta que se edita.
  const [editando, setEditando] = useState<CuentaPanel | 'nueva' | null>(null);
  const cuentas = useQuery({ queryKey: CLAVE, queryFn: () => api.get<{ datos: CuentaPanel[] }>('/api/v1/panel/cuentas') });
  const opciones = useQuery({
    queryKey: CLAVE_OPCIONES,
    queryFn: () => api.get<OpcionesCuentaPanel>('/api/v1/panel/opciones'),
    staleTime: 60_000,
  });
  const filas = cuentas.data?.datos ?? [];

  return (
    <Tarjeta>
      <CabeceraTarjeta
        titulo="Usuarios del panel"
        detalle={cuentas.data ? `${filas.length} ${filas.length === 1 ? 'cuenta' : 'cuentas'}` : undefined}
        acciones={
          <Boton variante="principal" tamano="sm" icono={Plus} disabled={editando != null || !opciones.data} onClick={() => setEditando('nueva')}>
            Nueva cuenta
          </Boton>
        }
      />
      {cuentas.isPending && <Cargando texto="Cargando cuentas del panel…" />}
      {cuentas.error && (
        <div className="px-5 pb-4">
          <ErrorCarga mensaje={mensajeError(cuentas.error)} alReintentar={() => cuentas.refetch()} />
        </div>
      )}
      {cuentas.data && filas.length === 0 && <Vacio icono={UserRound} titulo="Sin cuentas de panel">Crea la primera con «Nueva cuenta».</Vacio>}
      {filas.length > 0 && (
        <Tabla>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th className="max-lg:hidden">Usuario</Th>
              <Th>Tipo</Th>
              <Th>Ve a</Th>
              <Th className="max-lg:hidden">Último acceso</Th>
              <Th>Estado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <Fila key={c.id}>
                <Td className="font-medium text-marino-900">{c.nombre || GUION}</Td>
                <Td className="font-mono text-[12.5px] max-lg:hidden">{c.usuario}</Td>
                <Td>
                  <Insignia tono={c.tipo === 'administrador' ? 'marca' : c.tipo === 'operador' ? 'marino' : 'neutro'}>
                    {TEXTO_TIPO[c.tipo]}
                  </Insignia>
                </Td>
                <Td className="text-texto-2">{resumenAlcance(c)}</Td>
                <Td className="whitespace-nowrap max-lg:hidden">{c.ultimoAcceso ? fechaHora(c.ultimoAcceso) : GUION}</Td>
                <Td>
                  {!c.habilitado ? (
                    <Insignia tono="peligro">Deshabilitada</Insignia>
                  ) : c.bloqueada ? (
                    <Insignia tono="alerta">Bloqueada</Insignia>
                  ) : (
                    <Insignia tono="exito">Activa</Insignia>
                  )}
                </Td>
                <Td className="text-right">
                  <BotonIcono icono={Pencil} etiqueta={`Editar ${c.usuario}`} disabled={editando != null} onClick={() => setEditando(c)} />
                </Td>
              </Fila>
            ))}
          </tbody>
        </Tabla>
      )}
      {editando != null && opciones.data && (
        <Formulario
          key={editando === 'nueva' ? 'nueva' : editando.id}
          cuenta={editando === 'nueva' ? null : editando}
          opciones={opciones.data}
          alCerrar={() => setEditando(null)}
        />
      )}
      {opciones.error && (
        <div className="px-5 pb-4">
          <ErrorCarga mensaje={mensajeError(opciones.error)} alReintentar={() => opciones.refetch()} />
        </div>
      )}
    </Tarjeta>
  );
}
