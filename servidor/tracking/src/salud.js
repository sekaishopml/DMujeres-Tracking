// Historial de salud del teléfono (telemetry.dmt_salud_dispositivo). Cada
// diagnóstico que manda la app (cada 10 min) queda como una fila. Así se ve
// cómo evoluciona el GPS, la batería y la cola sin enviar, y se distingue un
// problema del teléfono de uno de la persona.
//
// Recibe el cuerpo del diagnóstico y el User-Agent y devuelve la fila. Lo que
// no viene queda en null.

// Si no hay un punto nuevo en este tiempo con el servicio activo, el GPS está
// atrasado (la app pide uno por segundo con jornada y cada 120 s sin ella).
export const GPS_ATRASADO_S = 5 * 60;

function objeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor : null;
}

function numero(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function booleano(valor) {
  return typeof valor === 'boolean' ? valor : null;
}

function texto(valor, maximo = 120) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim().slice(0, maximo) : null;
}

// "Dalvik/2.1.0 (Linux; U; Android 14; Infinix X6531 Build/UP1A...)" da
// { versionAndroid: '14', modelo: 'Infinix X6531' }.
export function equipoDeAgente(agente) {
  const resultado = { versionAndroid: null, modelo: null };
  if (typeof agente !== 'string') return resultado;
  const dentro = agente.match(/\(([^)]*)\)/)?.[1];
  if (!dentro) return resultado;
  for (const parte of dentro.split(';').map((p) => p.trim())) {
    const android = parte.match(/^Android\s+([\w.]+)/i);
    if (android) {
      resultado.versionAndroid = android[1];
      continue;
    }
    const modelo = parte.match(/^(.+?)\s+Build\//);
    if (modelo) resultado.modelo = modelo[1].slice(0, 80);
  }
  return resultado;
}

// Estado resumido, en orden de gravedad: lo primero que falla es lo que se
// muestra. 'ok' solo si todo lo reportado está bien.
export function estadoDeReporte(reporte) {
  const gps = objeto(reporte.gps);
  const permisos = objeto(reporte.perms);
  const cola = objeto(reporte.buffer);
  const jornada = objeto(reporte.journey);
  if (texto(reporte.crash)) return 'cierre_inesperado';
  if (gps && booleano(gps.enabled) === false) return 'gps_apagado';
  if (permisos && (booleano(permisos.fine) === false || booleano(permisos.background) === false)) return 'sin_permisos';
  if (gps && booleano(gps.mock) === true) return 'ubicacion_simulada';
  const edad = gps ? numero(gps.fixAgeSec) : null;
  if (jornada && booleano(jornada.active) === true && edad !== null && edad > GPS_ATRASADO_S) return 'gps_atrasado';
  if (cola && (numero(cola.pending) ?? 0) > 0) return 'cola_pendiente';
  return 'ok';
}

// Marca del teléfono a partir del modelo: prefijos conocidos o, si el modelo
// empieza con un nombre ("Infinix X6531"), ese nombre. Si no, null.
const PREFIJOS_FABRICANTE = [
  [/^SM-/i, 'Samsung'],
  [/^(LGN|ELI|ALI|CMA|BRP)-/i, 'Honor'],
  [/^Redmi|^M\d{4}/i, 'Xiaomi'],
  [/^moto/i, 'Motorola'],
];

export function fabricanteDeModelo(modelo) {
  if (typeof modelo !== 'string' || modelo === '') return null;
  for (const [patron, nombre] of PREFIJOS_FABRICANTE) if (patron.test(modelo)) return nombre;
  const primera = modelo.split(/\s+/)[0];
  return modelo.includes(' ') && /^[A-Za-z]{3,}$/.test(primera) ? primera : null;
}

export function filaSalud(datos, agente, ahoraMs) {
  const reporte = objeto(datos?.report) ?? {};
  const app = objeto(reporte.app);
  const gps = objeto(reporte.gps);
  const cola = objeto(reporte.buffer);
  const equipo = equipoDeAgente(agente);
  const marca = numero(datos?.ts);
  // La hora del teléfono puede venir corrida: solo se usa si es razonable
  // (no más de 1 día de diferencia con el servidor).
  const registradoMs = marca !== null && Math.abs(marca - ahoraMs) <= 86_400_000 ? marca : ahoraMs;
  const edad = gps ? numero(gps.fixAgeSec) : null;
  const recuperaciones = numero(reporte.recoveryCount);
  const servicio = texto(reporte.fgsState, 40);
  return {
    fabricante: fabricanteDeModelo(equipo.modelo),
    modelo: equipo.modelo,
    versionAndroid: equipo.versionAndroid,
    versionApp: app ? texto(app.versionName, 40) : null,
    estadoSalud: estadoDeReporte(reporte),
    primerPlano: servicio === null ? null : servicio === 'running',
    movimiento: texto(reporte.movementState, 40),
    colaSalida: cola ? numero(cola.pending) : null,
    ultimoFixEn: edad !== null ? new Date(registradoMs - edad * 1000) : null,
    continuidad: servicio,
    recuperacion: recuperaciones !== null ? String(Math.trunc(recuperaciones)) : null,
    sesionId: texto(reporte.bootId, 80),
    tipoEvento: texto(reporte.crash) ? 'crash' : 'diagnostico',
    registradoEn: new Date(registradoMs),
    atributos: datos,
  };
}
