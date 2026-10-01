// Registro simple a stdout en una linea JSON por evento.
// Regla: nunca escribir claves, cookies, hashes ni cuerpos de peticion.

function emitir(nivel, mensaje, datos) {
  const entrada = { t: new Date().toISOString(), nivel, mensaje };
  if (datos) {
    for (const [clave, valor] of Object.entries(datos)) {
      if (valor !== undefined && valor !== null) entrada[clave] = valor;
    }
  }
  process.stdout.write(`${JSON.stringify(entrada)}\n`);
}

export function crearLog(nombreServicio) {
  const base = { servicio: nombreServicio };
  return {
    info(mensaje, datos) {
      emitir('info', mensaje, { ...base, ...datos });
    },
    aviso(mensaje, datos) {
      emitir('aviso', mensaje, { ...base, ...datos });
    },
    error(mensaje, datos) {
      emitir('error', mensaje, { ...base, ...datos });
    },
  };
}
