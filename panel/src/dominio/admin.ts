// Tipos de sistema que no están en @contratos (compartido/tipos no tiene
// config.ts). Copian los nombres de campo de la API para no usar `any`.
import type { Dispositivo, Entorno, PuntoGeo } from '@contratos';

export interface MapaConfig {
  estiloUrl: string;
  centroInicial: PuntoGeo;
  zoomInicial: number;
}

export interface CapacidadesConfig {
  replay: boolean;
  reportes: boolean;
  sse: boolean;
  websocket: boolean;
  exportacion: boolean;
}

export interface Configuracion {
  versionApi: string;
  entorno: Entorno;
  zonaHoraria: string;
  intervaloRefrescoSegundos: number;
  mapa: MapaConfig;
  capacidades: CapacidadesConfig;
}

export interface Salud {
  estado: 'ok';
}

export interface DependenciasSalud {
  baseDatos: 'ok' | 'error';
  tracking: 'ok' | 'error';
}

export interface Disponibilidad {
  estado: 'listo' | 'degradado';
  dependencias: DependenciasSalud;
  comprobadoEn: string;
}

export interface Version {
  version: string;
  versionApi: string;
  versionEsquema: string;
  commit: string;
  construidoEn: string;
}

// --- Escritura de usuarios y equipos ---

export type ClaveConfiguracionEquipo =
  | 'mobile.intervalSeconds'
  | 'mobile.minIntervalSeconds'
  | 'mobile.distanceMeters'
  | 'mobile.angleDegrees'
  | 'mobile.accuracy'
  | 'mobile.bufferEnabled'
  | 'mobile.bufferMax'
  | 'mobile.bufferPolicy'
  | 'mobile.ackTimeoutSeconds'
  | 'mobile.maxRetries';

export type ValorConfiguracionEquipo = number | boolean | string | null;

// Claves que acepta `PUT /fleet/{id}`: las que faltan no se inventan.
export interface ConfiguracionEquipo {
  'mobile.intervalSeconds'?: number;
  'mobile.minIntervalSeconds'?: number;
  'mobile.distanceMeters'?: number;
  'mobile.angleDegrees'?: number;
  'mobile.accuracy'?: string;
  'mobile.bufferEnabled'?: boolean;
  'mobile.bufferMax'?: number;
  'mobile.bufferPolicy'?: string;
  'mobile.ackTimeoutSeconds'?: number;
  'mobile.maxRetries'?: number;
}

export interface DispositivoGestion extends Omit<Dispositivo, 'configuracion'> {
  configuracion?: ConfiguracionEquipo | null;
}
