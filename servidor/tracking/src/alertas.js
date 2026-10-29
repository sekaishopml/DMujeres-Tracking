// Alertas que salen del diagnóstico que manda la app cada 10 minutos (y al
// instante cuando cambia el GPS). Se comparan con lo que se sabía del equipo:
// solo un cambio genera evento, así una alerta no se repite cada 10 minutos.
// Fuera de jornada no se avisa nada: el teléfono no está registrando.

export const BATERIA_CRITICA_PCT = 5;
// Diferencia entre la hora del teléfono y la del servidor que ya es sospechosa.
export const RELOJ_DESFASE_MAX_MS = 5 * 60_000;

// Lo que importa del diagnóstico, en el mismo formato en que se guarda en el
// equipo. null cuando la app no lo informó.
export function estadoDeDiagnostico(reporte, ahoraMs = Date.now()) {
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
    notificaciones: bool(permisos.notifications),
    ahorro: bool(energia.exempt) === null ? null : !energia.exempt,
    bateriaCritica: nivel === null ? null : nivel <= BATERIA_CRITICA_PCT && energia.charging !== true,
    ahorroSistema: bool(energia.saver),
    reloj: Number.isFinite(reporte?.device?.clockMs) ? Math.abs(reporte.device.clockMs - ahoraMs) > RELOJ_DESFASE_MAX_MS : null,
  };
}

// Atributos del equipo donde se recuerda el último estado avisado.
export const CLAVES_ESTADO = {
  gps: 'alerta.gps',
  permisos: 'alerta.permisos',
  notificaciones: 'alerta.notificaciones',
  ahorro: 'alerta.ahorro',
  bateriaCritica: 'alerta.bateriaCritica',
  ahorroSistema: 'alerta.ahorroSistema',
  reloj: 'alerta.reloj',
};

const EVENTOS = {
  gps: { mal: 'mobileGpsDisabled', bien: 'mobileGpsReenabled', malSi: false },
  permisos: { mal: 'mobilePermissionLost', bien: 'mobilePermissionRestored', malSi: false },
  notificaciones: { mal: 'mobileNotificationsOff', bien: 'mobileNotificationsOn', malSi: false },
  ahorro: { mal: 'mobileBatterySaverOn', bien: 'mobileBatterySaverOff', malSi: true },
  bateriaCritica: { mal: 'mobileBatteryCritical', bien: null, malSi: true },
  ahorroSistema: { mal: 'mobilePowerSaveOn', bien: 'mobilePowerSaveOff', malSi: true },
  reloj: { mal: 'mobileClockOff', bien: 'mobileClockOk', malSi: true },
};

// Dos diagnósticos que llegan casi a la vez leen el mismo estado anterior y
// generarían el mismo evento dos veces. Lo último enviado se recuerda 10 s.
export const VENTANA_EVENTO_MS = 10_000;
export function esRepetido(recientes, clave, ahoraMs) {
  const previo = recientes.get(clave);
  if (previo !== undefined && ahoraMs - previo < VENTANA_EVENTO_MS) return true;
  recientes.set(clave, ahoraMs);
  if (recientes.size > 1000) {
    for (const [otra, t] of recientes) if (ahoraMs - t >= VENTANA_EVENTO_MS) recientes.delete(otra);
  }
  return false;
}

// Quién apagó la ubicación, según cómo estaba el teléfono en ese instante
// (la app lo anota al cambiar): con la pantalla encendida y desbloqueada solo
// pudo ser la persona; con el ahorro de batería activo o la pantalla apagada,
// el teléfono. Sin el dato (versiones viejas) o si es de otro cambio, null.
export const VENTANA_CAMBIO_MS = 5 * 60_000;
export function quienApagoGps(reporte, ahoraMs = Date.now()) {
  const c = reporte?.gps?.cambio;
  if (!c || !Number.isFinite(c.en) || Math.abs(ahoraMs - c.en) > VENTANA_CAMBIO_MS) return null;
  if (c.ahorro === true) return 'ahorro';
  if (c.pantalla === false) return 'telefono';
  if (c.pantalla === true && c.bloqueado === false) return 'persona';
  return null;
}

// Devuelve {eventos, parche}: los eventos a registrar y los atributos a
// guardar. Un estado desconocido antes no avisa "se arregló", pero sí avisa
// si ya llega mal.
export function alertasDeDiagnostico(atributos, reporte, ahoraMs = Date.now()) {
  const actual = estadoDeDiagnostico(reporte, ahoraMs);
  const enJornada = reporte?.journey?.active === true;
  const eventos = [];
  const parche = {};
  for (const [campo, valor] of Object.entries(actual)) {
    if (valor === null) continue;
    const clave = CLAVES_ESTADO[campo];
    // Fuera de jornada el estado se olvida: si la jornada empieza con el GPS
    // ya apagado, el primer diagnóstico avisa. Antes se recordaba "apagado"
    // desde antes del inicio y nunca se avisaba (Israel 21/10: 07:58-11:29).
    if (!enJornada) {
      parche[clave] = null;
      continue;
    }
    const previo = typeof atributos?.[clave] === 'boolean' ? atributos[clave] : null;
    parche[clave] = valor;
    if (previo === valor) continue;
    const reglas = EVENTOS[campo];
    const esMal = valor === reglas.malSi;
    if (esMal) eventos.push(reglas.mal);
    else if (previo !== null && reglas.bien) eventos.push(reglas.bien);
  }
  return { eventos, parche };
}
