// Por qué no hay puntos en un corte del recorrido. Se mira lo que pasó en el
// teléfono durante el corte, en este orden:
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

export function causaDeHueco(hueco, eventos, diagnosticos) {
  const desde = new Date(hueco.desde).getTime();
  const hasta = new Date(hueco.hasta).getTime();
  const dentro = (instante) => instante >= desde - MARGEN_MS && instante <= hasta;
  for (const [causa, tipos] of CAUSA_DE_EVENTO) {
    if (eventos.some((e) => tipos.includes(e.tipo) && dentro(e.en))) return causa;
  }
  const conDiagnostico = diagnosticos.some((d) => d > desde && d < hasta);
  if (!conDiagnostico && hasta - desde >= SIN_CONTACTO_MIN_MS) return 'SIN_CONTACTO';
  return 'SIN_SENAL';
}

export const TIPOS_EVENTO_CAUSA = CAUSA_DE_EVENTO.flatMap(([, tipos]) => tipos);
