// Alertas que salen del diagnóstico que manda la app cada 10 minutos (y al
// instante cuando cambia el GPS). Se comparan con lo que se sabía del equipo:
// solo un cambio genera evento, así una alerta no se repite cada 10 minutos.
// Fuera de jornada no se avisa nada: el teléfono no está registrando.

export const BATERIA_CRITICA_PCT = 5;

// Lo que importa del diagnóstico, en el mismo formato en que se guarda en el
// equipo. null cuando la app no lo informó.
export function estadoDeDiagnostico(reporte) {
  const gps = reporte?.gps ?? {};
  const permisos = reporte?.perms ?? {};
  const energia = reporte?.power ?? {};
  const bool = (v) => (typeof v === 'boolean' ? v : null);
  const nivel = Number.isFinite(energia.battery) ? energia.battery : null;
  const fino = bool(permisos.fine);
  const fondo = bool(permisos.background);
  return {
    gps: bool(gps.enabled),
    permisos: fino === null && fondo === null ? null : fino !== false && fondo !== false,
    ahorro: bool(energia.exempt) === null ? null : !energia.exempt,
    bateriaCritica: nivel === null ? null : nivel <= BATERIA_CRITICA_PCT && energia.charging !== true,
  };
}

// Atributos del equipo donde se recuerda el último estado avisado.
export const CLAVES_ESTADO = {
  gps: 'alerta.gps',
  permisos: 'alerta.permisos',
  ahorro: 'alerta.ahorro',
  bateriaCritica: 'alerta.bateriaCritica',
};

const EVENTOS = {
  gps: { mal: 'mobileGpsDisabled', bien: 'mobileGpsReenabled', malSi: false },
  permisos: { mal: 'mobilePermissionLost', bien: 'mobilePermissionRestored', malSi: false },
  ahorro: { mal: 'mobileBatterySaverOn', bien: 'mobileBatterySaverOff', malSi: true },
  bateriaCritica: { mal: 'mobileBatteryCritical', bien: null, malSi: true },
};

// Devuelve {eventos, parche}: los eventos a registrar y los atributos a
// guardar. Un estado desconocido antes no avisa "se arregló", pero sí avisa
// si ya llega mal.
export function alertasDeDiagnostico(atributos, reporte) {
  const actual = estadoDeDiagnostico(reporte);
  const enJornada = reporte?.journey?.active === true;
  const eventos = [];
  const parche = {};
  for (const [campo, valor] of Object.entries(actual)) {
    if (valor === null) continue;
    const clave = CLAVES_ESTADO[campo];
    const previo = typeof atributos?.[clave] === 'boolean' ? atributos[clave] : null;
    parche[clave] = valor;
    if (!enJornada || previo === valor) continue;
    const reglas = EVENTOS[campo];
    const esMal = valor === reglas.malSi;
    if (esMal) eventos.push(reglas.mal);
    else if (previo !== null && reglas.bien) eventos.push(reglas.bien);
  }
  return { eventos, parche };
}
