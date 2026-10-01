// Tipos de usuarios, grupos, roles y ajustes (GET /api/v1/usuarios, /grupos,
// /roles y /configuracion/esquema). Los opcionales son los que el servidor
// puede no mandar; el panel los trata como ausentes.

export interface GrupoResumen {
  id: number | string;
  nombre: string;
}

export interface RolPlataforma {
  id: number | string;
  nombre: string;
}

export type ConfigApp = Record<string, number | boolean | string | null>;

export interface UsuarioPlataforma {
  id: number | string;
  idPublico: string;
  /** Nombre con el que la persona entra al panel. */
  usuario: string;
  /** Nombre completo para mostrar. */
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  cargo?: string | null;
  habilitado: boolean;
  administrador: boolean;
  grupos: GrupoResumen[];
  configApp: ConfigApp;
  // Equipos que la cuenta puede ver. Si no vienen, el panel los pide a
  // GET /api/v1/usuarios/:id/equipos.
  dispositivoIds?: (number | string)[];
  // La lectura no trae los roles; si algún día vienen, se muestran.
  roles?: RolPlataforma[];
  rolIds?: (number | string)[];
}

export interface CreacionUsuarioPlataforma {
  usuario: string;
  clave: string;
  nombre: string;
  telefono?: string;
  cargo?: string;
  grupoIds?: (number | string)[];
  rolIds?: (number | string)[];
  // Las cuentas de administración nacen con este indicador en fijo; las
  // personas de campo no lo mandan.
  administrador?: boolean;
  configApp?: ConfigApp;
  // Pide que se cree también el equipo de la persona (identificador = usuario
  // en minúsculas) y su asignación. El servidor responde `equipo` o null.
  crearEquipo?: boolean;
}

// Equipo creado junto con la cuenta (POST /api/v1/usuarios con
// `crearEquipo:true`). `identificador` es el nombre que se configura en la
// app como ID de equipo y el que se ve en Replay y En vivo.
export interface EquipoCreadoConCuenta {
  id: number | string;
  idPublico?: string;
  nombre: string;
  identificador: string;
}

export interface RespuestaCreacionUsuarioPlataforma {
  usuario: UsuarioPlataforma;
  equipo?: EquipoCreadoConCuenta | null;
}

export interface ActualizacionUsuarioPlataforma {
  usuario?: string;
  clave?: string;
  nombre?: string;
  telefono?: string | null;
  cargo?: string | null;
  correo?: string | null;
  habilitado?: boolean;
  administrador?: boolean;
  grupoIds?: (number | string)[];
  rolIds?: (number | string)[];
  configApp?: ConfigApp;
}

export interface GrupoPlataforma {
  id: number | string;
  idPublico?: string;
  nombre: string;
  descripcion?: string | null;
  // Los miembros pueden venir de distintas formas; todos son opcionales.
  usuarioIds?: (number | string)[];
  miembros?: { id?: number | string; idPublico?: string; usuario?: string; nombre?: string }[];
  totalMiembros?: number;
}

export interface CreacionGrupo {
  nombre: string;
  descripcion?: string;
}

// Equipo visible para una cuenta (GET /api/v1/usuarios/:id/equipos). El
// servidor responde {datos:[...]}; el panel también acepta un arreglo simple.
export interface EquipoVisibleUsuario {
  id: number | string;
  idPublico?: string;
  nombre: string;
}

// Reemplazo de la lista visible (PUT /api/v1/usuarios/:id/equipos). Se manda
// el id interno cuando se conoce; el servidor también acepta el idPublico.
export interface EquiposVisiblesUsuario {
  dispositivoIds: (number | string)[];
}

export interface MiembrosGrupo {
  usuarioIds: (number | string)[];
}

export type TipoAjuste = 'numero' | 'entero' | 'booleano' | 'texto';

export interface EntradaEsquemaAjustes {
  clave: string;
  etiqueta: string;
  descripcion: string;
  tipo: TipoAjuste;
  min?: number;
  max?: number;
  /** Valor que vale si la persona no tiene uno propio. */
  porDefecto?: number | boolean | string | null;
}
