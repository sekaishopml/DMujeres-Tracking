// Reglas de entrada que comparten el panel y la app.
//  - Una cuenta solo puede tener la app abierta en un teléfono a la vez.

// Minutos que le faltan a un bloqueo; 0 si la cuenta no está bloqueada.
export function minutosBloqueo(bloqueadoHasta, ahoraMs = Date.now()) {
  if (!bloqueadoHasta) return 0;
  const resta = new Date(bloqueadoHasta).getTime() - ahoraMs;
  return resta > 0 ? Math.ceil(resta / 60_000) : 0;
}

export const MENSAJE_OTRO_TELEFONO =
  'La cuenta ya está abierta en otro teléfono. Pide al administrador que cierre esa sesión.';

// Borra bloqueos que quedaron de cuando tres claves equivocadas bloqueaban.
export async function limpiarFallos(pool, usuarioId) {
  await pool.query(
    `UPDATE iam.dmt_usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL
      WHERE id = $1 AND (intentos_fallidos <> 0 OR bloqueado_hasta IS NOT NULL)`,
    [usuarioId],
  );
}

// Sesiones abiertas de la app de esta cuenta en otra instalación. Las
// sesiones viejas que no guardaron la instalación no cuentan: así nadie queda
// fuera el día que se actualiza la app.
export async function sesionEnOtroTelefono(pool, usuarioId, instalacion) {
  const { rows } = await pool.query(
    `SELECT 1 FROM iam.dmt_sesion
      WHERE usuario_id = $1 AND tipo = 'movil' AND revocada_en IS NULL
        AND (expira_en IS NULL OR expira_en > now())
        AND instalacion IS NOT NULL AND instalacion IS DISTINCT FROM $2
      LIMIT 1`,
    [usuarioId, instalacion],
  );
  return rows.length > 0;
}
