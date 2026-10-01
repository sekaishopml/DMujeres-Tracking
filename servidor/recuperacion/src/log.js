// Registro minimo a stdout/stderr (journald lo captura). Nunca se registran
// tokens ni material de credenciales: los mensajes incluyen solo prefijos o
// longitudes cuando hace falta diagnostico.

export function crearLog(nombre) {
  const marca = () => new Date().toISOString();
  const linea = (escribir, nivel, mensaje) => {
    escribir(`${marca()} [${nombre}] ${nivel} ${mensaje}`);
  };
  return {
    info: (mensaje) => linea(console.log, 'INFO', mensaje),
    warn: (mensaje) => linea(console.warn, 'AVISO', mensaje),
    error: (mensaje) => linea(console.error, 'ERROR', mensaje),
  };
}
