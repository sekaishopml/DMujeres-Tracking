export interface Usuario {
  id: number;
  idPublico: string;
  nombre: string;
  correo: string | null;
  administrador: boolean;
  soloLectura: boolean;
  habilitado: boolean;
  /** idPublico de los equipos con asignación activa y vigente. */
  dispositivoIds: string[];
}

/** Cuerpo de POST /api/v1/users (solo administradores). */
export interface UsuarioCreacion {
  nombre: string;
  correo: string;
  clave: string;
  administrador?: boolean;
  soloLectura?: boolean;
  /** idPublico o id numérico anterior de los equipos a asignar. */
  dispositivoIds?: string[];
}

/** Cuerpo de PUT /api/v1/users/{id}. `clave` vacía o ausente = no cambiar. */
export interface UsuarioActualizacion {
  nombre?: string;
  correo?: string;
  clave?: string;
  administrador?: boolean;
  soloLectura?: boolean;
  /** Sincroniza la lista completa: activa/desactiva asignaciones. */
  dispositivoIds?: string[];
}

export interface RespuestaUsuario {
  usuario: Usuario;
}
