package com.dmujeres.app.sync

/**
 * Cuándo pausar y reanudar la cola ante un 401 o 403 (sin Android, se prueba
 * en la JVM).
 *
 * - 401 con token: el token ya no sirve. Se borra la sesión y se reintenta una
 *   vez con la clave compartida; si también falla, se pausa.
 * - Otros casos (401 sin token = clave compartida inválida, 403): se pausa
 *   hasta que cambie la clave o el token, o se toque Actualizar.
 * - Si la clave o el token cambian respecto de la pausa (por ejemplo, al
 *   entrar de nuevo), la cola sigue sola.
 * Nunca se borra un punto que el servidor no confirmó.
 */
object UploadAuthPolicy {

    /**
     * ¿La pausa queda fija? false con un 401 con token: se reintenta una vez
     * con la clave compartida después de borrar la sesión.
     */
    fun shouldLatchPause(httpCode: Int, hadToken: Boolean): Boolean =
        !(hadToken && httpCode == 401)

    /**
     * ¿Reanudar porque cambiaron el token o la clave desde la pausa? Sin
     * cambios no se reanuda, para no repetir el mismo 401.
     */
    fun shouldResumeAfterAuthChange(
        pausedToken: String,
        pausedApiKey: String,
        currentToken: String,
        currentApiKey: String,
    ): Boolean = pausedToken != currentToken || pausedApiKey != currentApiKey
}
