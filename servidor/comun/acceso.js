// Reglas de entrada que comparten el panel y la app.
//  - Tres claves equivocadas seguidas bloquean la cuenta 15 minutos: nadie
//    puede probar contraseñas al azar. Entrar bien deja el contador en cero.
//  - Una cuenta solo puede tener la app abierta en un teléfono a la vez.

export const MAX_INTENTOS = 3;
export const MINUTOS_BLOQUEO = 15;

// Minutos que le faltan a un bloqueo; 0 si la cuenta no está bloqueada.
export function minutosBloqueo(bloqueadoHasta, ahoraMs = Date.now()) {
  if (!bloqueadoHasta) return 0;
  const resta = new Date(bloqueadoHasta).getTime() - ahoraMs;
  return resta > 0 ? Math.ceil(resta / 60_000) : 0;
}

export function mensajeBloqueo(minutos) {
  return `La cuenta quedó bloqueada por ${MAX_INTENTOS} intentos fallidos. Intenta en ${minutos} min o pide al administrador que la desbloquee.`;
}

export const MENSAJE_OTRO_TELEFONO =
  'La cuenta ya está abierta en otro teléfono. Pide al administrador que cierre esa sesión.';

// Suma un intento fallido; al tercero bloquea y vuelve a empezar la cuenta.
// Devuelve los minutos de bloqueo (0 si todavía no se bloquea).
export async function registrarFallo(pool, usuarioId) {
  const { rows } = await pool.query(
    `UPDATE iam.dmt_usuario
        SET bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2
                                   THEN now() + ($3::int * interval '1 minute')
                                   ELSE bloqueado_hasta END,
            intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0
                                     ELSE intentos_fallidos + 1 END
      WHERE id = $1
      RETURNING bloqueado_hasta`,
    [usuarioId, MAX_INTENTOS, MINUTOS_BLOQUEO],
  );
  return minutosBloqueo(rows[0]?.bloqueado_hasta);
}

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
