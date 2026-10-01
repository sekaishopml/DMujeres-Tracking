import type { Usuario } from "./users";

export interface Credenciales {
  usuario: string;
  clave: string;
}

export interface Sesion {
  usuario: Usuario;
  expiraEn: string;
}
