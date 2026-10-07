import type { MuestraBateria } from '@contratos';
import { BATERIA_BAJA_PCT } from '@/dominio/bitacora';

export type NivelBateria = 'ok' | 'medio' | 'bajo' | 'sinDato';

// Mismo umbral de riesgo que la bitácora (≤15 %); 15–30 % es atención.
export function nivelBateria(pct?: number | null): NivelBateria {
  if (pct == null || !Number.isFinite(pct)) return 'sinDato';
  if (pct <= BATERIA_BAJA_PCT) return 'bajo';
  if (pct <= 30) return 'medio';
  return 'ok';
}

export const CLASE_FONDO_NIVEL: Record<NivelBateria, string> = {
  ok: 'bg-movimiento',
  medio: 'bg-sin-senal',
  bajo: 'bg-peligro',
  sinDato: 'bg-deshabilitado',
};

export interface Tendencia {
  direccion: 'sube' | 'baja' | 'estable';
  tasaPctHora: number;
}

// Menos de 0,5 % por hora se toma como estable: por debajo pesa más el ruido
// que la tendencia. Se comparan la primera y la última muestra con porcentaje.
export function calcularTendencia(muestras: MuestraBateria[]): Tendencia | null {
  const conValor = muestras.filter((m) => m.bateriaPct != null);
  if (conValor.length < 2) return null;
  const primera = conValor[0];
  const ultima = conValor[conValor.length - 1];
  const horas = (new Date(ultima.registradoEn).getTime() - new Date(primera.registradoEn).getTime()) / 3_600_000;
  if (!Number.isFinite(horas) || horas <= 0) return null;
  const tasaPctHora = ((ultima.bateriaPct ?? 0) - (primera.bateriaPct ?? 0)) / horas;
  if (Math.abs(tasaPctHora) < 0.5) return { direccion: 'estable', tasaPctHora };
  return { direccion: tasaPctHora > 0 ? 'sube' : 'baja', tasaPctHora };
}
