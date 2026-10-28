/** Tipo de cuenta de panel. */
export type TipoCuentaPanel = "administrador" | "operador" | "solo_lectura";

export interface CuentaPanel {
  id: number;
  idPublico: string;
  usuario: string;
  nombre: string;
  tipo: TipoCuentaPanel;
  /** Partes del panel que ve (todas, si es administradora). */
  secciones: string[];
  /** Grupos cuyo personal ve. */
  grupos: { id: string; nombre: string }[];
  /** Personas que ve una por una. */
  personas: { id: string; nombre: string; usuario: string }[];
  habilitado: boolean;
  bloqueada: boolean;
  ultimoAcceso: string | null;
  /** Es la cuenta con la que se entró. */
  propia: boolean;
}

/** GET /api/v1/panel/opciones: lo que se puede elegir al crear o editar. */
export interface OpcionesCuentaPanel {
  secciones: { codigo: string; texto: string; asignable: boolean }[];
  grupos: { id: string; nombre: string }[];
  personas: { id: string; nombre: string; usuario: string }[];
}

/** Cuerpo de POST /api/v1/panel/cuentas; el PATCH acepta cualquiera de estos campos. */
export interface CuentaPanelEntrada {
  usuario: string;
  nombre: string;
  clave: string;
  tipo: TipoCuentaPanel;
  secciones?: string[];
  grupoIds?: string[];
  personaIds?: string[];
}
