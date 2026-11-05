// Por qué no hay puntos en un corte del recorrido. Se mira lo que pasó en el
// teléfono durante el corte, en este orden:
//  - REINICIO_SIN_APP: reinició el teléfono y la app tardó en volver;
//  - APAGADO: se apagó el teléfono;
//  - GPS_APAGADO: apagó la ubicación;
//  - SIN_PERMISO: quitó el permiso de ubicación;
//  - SIN_CONTACTO: no llegó ni un diagnóstico (la app manda uno cada 10 min):
//    la app estaba detenida o el teléfono sin datos;
//  - SIN_SENAL: la app seguía viva pero el GPS no daba posición.
// Los cortes cortos no alcanzan a tener diagnóstico y quedan como SIN_SENAL.

const MARGEN_MS = 2 * 60_000;
const SIN_CONTACTO_MIN_MS = 25 * 60_000;

const CAUSA_DE_EVENTO = [
  ['APAGADO', ['mobilePowerOff', 'mobileShutdown']],
  ['GPS_APAGADO', ['mobileGpsDisabled']],
  ['SIN_PERMISO', ['mobilePermissionLost']],
];

// Reactivar el GPS o devolver el permiso dentro del corte prueba que estaba
// apagado o quitado, aunque el aviso de apagado no haya llegado (Israel 21/10:
// la jornada empezó con el GPS ya apagado). Tiene que ser dentro del corte:
// uno de justo antes es de otro apagado que ya pasó.
const CAUSA_DE_REGRESO = [
  ['GPS_APAGADO', 'mobileGpsReenabled'],
  ['SIN_PERMISO', 'mobilePermissionRestored'],
];

// Se apagó y se volvió a encender dentro del corte, y el corte siguió mucho
// después de encender: la app tardó en volver. No es "teléfono apagado" todo
// el rato (Kevin 01/11: apagado 14 s, la app volvió 65 min después).
const REINICIO_HOLGURA_MS = 5 * 60_000;

export function causaDeHueco(hueco, eventos, diagnosticos) {
  const desde = new Date(hueco.desde).getTime();
  const hasta = new Date(hueco.hasta).getTime();
  const dentro = (instante) => instante >= desde - MARGEN_MS && instante <= hasta;
  const apagado = eventos.find((e) => CAUSA_DE_EVENTO[0][1].includes(e.tipo) && dentro(e.en));
  const encendido = apagado && eventos.find((e) => e.tipo === 'mobilePowerOn' && e.en >= apagado.en && e.en <= hasta);
  if (encendido && hasta - encendido.en > REINICIO_HOLGURA_MS) return 'REINICIO_SIN_APP';
  for (const [causa, tipos] of CAUSA_DE_EVENTO) {
    if (eventos.some((e) => tipos.includes(e.tipo) && dentro(e.en))) return causa;
  }
  for (const [causa, tipo] of CAUSA_DE_REGRESO) {
    if (eventos.some((e) => e.tipo === tipo && e.en > desde && e.en <= hasta)) return causa;
  }
  const conDiagnostico = diagnosticos.some((d) => d > desde && d < hasta);
  if (!conDiagnostico && hasta - desde >= SIN_CONTACTO_MIN_MS) return 'SIN_CONTACTO';
  return 'SIN_SENAL';
}

export const TIPOS_EVENTO_CAUSA = [
  ...CAUSA_DE_EVENTO.flatMap(([, tipos]) => tipos),
  ...CAUSA_DE_REGRESO.map(([, tipo]) => tipo),
  'mobilePowerOn',
];
