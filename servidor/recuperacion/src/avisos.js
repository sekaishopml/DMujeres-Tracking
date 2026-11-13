// Avisos de horario: de lunes a sábado a las 07:30, 08:15, 12:00 y 15:00 se le
// manda al teléfono un mensaje para que revise su estado y, si algo falta, se
// lo diga a la persona (nunca en la tarde ni de noche). A las 08:15 solo a los
// que no mandaron puntos desde las 08:00: es el recordatorio de iniciar jornada.
// El teléfono también lo hace solo con su propia alarma (por si no tiene
// conexión) y no repite una hora que ya atendió; por eso aquí basta con mandar
// una vez por hora y no importa repetir tras un reinicio.

export const FRANJAS = ['07:30', '08:15', '12:00', '15:00'];
// Se manda solo en los primeros minutos de la hora: tarde ya no sirve.
const VENTANA_MIN = 10;

const horaLocal = (ahoraMs, zona) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(ahoraMs)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
const DIAS_HABILES = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

// Lunes a sábado de 07:00 a 17:00: el aviso visible con sonido solo se manda
// en ese horario.
export function enHorarioLaboral(ahoraMs, zona = 'America/Guayaquil') {
  const p = horaLocal(ahoraMs, zona);
  const minutos = Number(p.hour) * 60 + Number(p.minute);
  return DIAS_HABILES.has(p.weekday) && minutos >= 7 * 60 && minutos < 17 * 60;
}

// Franja que toca mandar ahora ("AAAA-MM-DD HH:MM") o null.
export function franjaDeAhora(ahoraMs, zona = 'America/Guayaquil') {
  const p = horaLocal(ahoraMs, zona);
  if (!DIAS_HABILES.has(p.weekday)) return null;
  const minutos = Number(p.hour) * 60 + Number(p.minute);
  const franja = FRANJAS.find((f) => {
    const inicio = Number(f.slice(0, 2)) * 60 + Number(f.slice(3));
    return minutos >= inicio && minutos < inicio + VENTANA_MIN;
  });
  return franja ? `${p.year}-${p.month}-${p.day} ${franja}` : null;
}

export function crearAvisosDeHorario({ zona = 'America/Guayaquil' } = {}) {
  let ultima = null;
  return async function avisar({ almacen, emisor, log, ahoraMs = Date.now() }) {
    const franja = franjaDeAhora(ahoraMs, zona);
    if (!franja || franja === ultima || !emisor) return 0;
    ultima = franja;
    let equipos = (await almacen.listarEquipos()).filter((e) => e.token);
    if (franja.endsWith('08:15')) {
      const ocho = Date.parse(`${franja.slice(0, 10)}T08:00:00-05:00`);
      equipos = equipos.filter((e) => !(e.ultimaPosicionEn?.getTime() >= ocho));
    }
    let enviados = 0;
    for (const equipo of equipos) {
      const r = await emisor.enviarAvisoHorario({ token: equipo.token, franja: franja.slice(11).replace(':', '') });
      if (r.messageId) enviados += 1;
      else if (r.tokenInvalido) await almacen.marcarTokenInvalido(equipo.token);
    }
    log?.info(`aviso de horario ${franja}: equipos=${equipos.length} enviados=${enviados}`);
    return enviados;
  };
}
