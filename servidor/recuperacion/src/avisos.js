// Avisos de horario: a ciertas horas del día se le manda al teléfono un
// mensaje para que revise su estado y, si algo falta, se lo diga a la persona.
// El teléfono también lo hace solo con su propia alarma (por si no tiene
// conexión) y no repite una hora que ya atendió; por eso aquí basta con mandar
// una vez por hora y no importa repetir tras un reinicio.

export const FRANJAS = ['08:00', '14:00', '15:00', '17:00'];
// Se manda solo en los primeros minutos de la hora: tarde ya no sirve.
const VENTANA_MIN = 10;

const horaLocal = (ahoraMs, zona) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ahoraMs)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});

// Franja que toca mandar ahora ("AAAA-MM-DD HH:MM") o null.
export function franjaDeAhora(ahoraMs, zona = 'America/Guayaquil') {
  const p = horaLocal(ahoraMs, zona);
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
    const equipos = (await almacen.listarEquipos()).filter((e) => e.token);
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
