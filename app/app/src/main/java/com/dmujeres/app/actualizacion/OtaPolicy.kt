package com.dmujeres.app.actualizacion

/**
 * Cuándo mostrar el aviso de actualización (sin Android ni red, se prueba en
 * la JVM).
 *
 * El aviso sale siempre que haya publicada una versión mayor que la
 * instalada: al abrir la app y cada minuto. Nada lo oculta salvo actualizar;
 * si falla la red, se reintenta en la siguiente vuelta.
 *
 * [CHECK_GAP_MS] solo limita las consultas (como mucho una por minuto con la
 * app abierta). Al abrir ([coldStart]) siempre se consulta.
 * [MAX_DEFER_AFTER_OPEN_MS] asegura que nunca pasen más de unos 2 min.
 */
object OtaPolicy {

    /** Freno anti-spam de RED entre chequeos con la app abierta (1 min). */
    const val CHECK_GAP_MS = 60_000L

    /** Tope absoluto de bloqueo tras abrir (~2 min). */
    const val MAX_DEFER_AFTER_OPEN_MS = 120_000L

    /**
     * ¿Hay una versión mayor publicada? Se compara el versionCode. Igual o
     * menor: no hay aviso.
     */
    fun isUpdateAvailable(publishedVersionCode: Int, installedVersionCode: Int): Boolean =
        publishedVersionCode > installedVersionCode

    /**
     * ¿La versión publicada en GitHub ("X.Y.Z") es mayor que la instalada? Se
     * compara número por número; una parte que no es número vale 0 (un
     * "-beta" no gana a la versión final).
     */
    fun isNewerName(installed: String, candidate: String): Boolean {
        val installedParts = installed.split(".")
        val publishedParts = candidate.split(".")
        for (i in 0 until maxOf(installedParts.size, publishedParts.size)) {
            val a = installedParts.getOrNull(i)?.toIntOrNull() ?: 0
            val b = publishedParts.getOrNull(i)?.toIntOrNull() ?: 0
            if (a != b) return b > a
        }
        return false
    }

    /**
     * ¿Hay que consultar ahora? Al abrir la app, siempre. Con la app abierta,
     * como mucho una vez por minuto y nunca más de unos 2 min sin consultar.
     */
    fun shouldCheck(nowMs: Long, lastCheckMs: Long, coldStart: Boolean): Boolean {
        if (coldStart) return true
        if (lastCheckMs <= 0L) return true
        if (lastCheckMs > nowMs) return true // el reloj se atrasó: se consulta
        val elapsed = nowMs - lastCheckMs
        if (elapsed >= MAX_DEFER_AFTER_OPEN_MS) return true
        return elapsed >= CHECK_GAP_MS
    }
}
