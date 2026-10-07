package com.dmujeres.app.sesion

/**
 * Pasos del cierre de sesión ordenado (sin Android ni red, se prueba en la
 * JVM).
 *
 * Orden fijo: enviar la cola, cerrar la jornada y borrar la sesión.
 * - Lo no enviado nunca se borra: queda en la base para el próximo envío
 *   (sigue siendo válido con la sesión nueva).
 * - Un 401 a mitad no hace perder datos: se deja de intentar y se sigue al
 *   cierre con lo que quede.
 * - La sesión no queda a medias: o se borra entera (avisando lo que faltó) o
 *   queda como estaba y se informa.
 */
object SessionClosePlan {

    /** Tope total del cierre (flush + fin + limpieza), aproximado. */
    const val TIMEOUT_MS = 30_000L

    /** Lotes del endpoint actual (igual que la cola de subida). */
    const val MAX_BATCH = 50

    /** Lo que puede pasar al enviar un lote durante el cierre. */
    enum class BatchOutcome {
        /** Lote procesado con avance (confirmados o descartados DEAD): seguir. */
        SENT,
        /** Nada que enviar: cola vacía. */
        EMPTY,
        /** 401 con token: el token ya no sirve, se sigue al cierre. */
        AUTH_PAUSED,
        /** Red/servidor sin confirmar: conservar todo e ir al fin. */
        RETRY_LATER,
    }

    /** Resultado de intentar cerrar la jornada en el servidor. */
    enum class JourneyOutcome {
        /** El servidor confirmó el cierre. */
        CLOSED,
        /** No había jornada abierta, o el servidor ya la tenía cerrada. */
        ALREADY_CLOSED,
        /** Sin red o sin respuesta: queda cerrada en el teléfono. */
        OFFLINE,
        /** 401 con token al avisar el cierre: queda cerrada en el teléfono. */
        AUTH_FAILED,
    }

    /** Un lote enviado: cuántos confirmó el servidor y qué pasó. */
    data class SendResult(val confirmed: Int, val outcome: BatchOutcome)

    /** Informe del cierre, para mensajes humanos en español. */
    data class CloseReport(
        val sent: Int,
        val remaining: Int,
        val authFailed: Boolean,
        val journey: JourneyOutcome,
        val sessionCleared: Boolean,
    ) {
        /** Cierre completo: nada pendiente, jornada cerrada y sesión limpia. */
        fun isComplete(): Boolean =
            sessionCleared && remaining == 0 && !authFailed &&
                (journey == JourneyOutcome.CLOSED || journey == JourneyOutcome.ALREADY_CLOSED)
    }

    /**
     * ¿Hay que hacer el cierre antes de iniciar sesión? Solo si ya hay una
     * sesión guardada y entra OTRO usuario: lo que está en curso es del
     * anterior y se cierra con su equipo. Con el mismo usuario no se repite.
     */
    fun requiresCleanCloseBeforeLogin(
        hasSession: Boolean,
        currentUser: String,
        nextUser: String,
    ): Boolean =
        hasSession && SessionAuth.normalizeUser(currentUser) != SessionAuth.normalizeUser(nextUser)

    /** Puertos que el entorno Android implementa (falsificados en tests). */
    interface Driver {
        fun pendingCount(): Int
        fun sendBatch(maxBatch: Int): SendResult
        fun endJourney(): JourneyOutcome
        fun clearSession()
        fun nowMs(): Long
    }

    /**
     * Corre los tres pasos con [timeoutMs] de tope. [onBatchConfirmed] avisa
     * cada avance (para la pantalla; corre en el hilo del cierre).
     */
    fun run(
        driver: Driver,
        timeoutMs: Long = TIMEOUT_MS,
        maxBatch: Int = MAX_BATCH,
        onBatchConfirmed: (Int) -> Unit = {},
    ): CloseReport {
        val deadline = driver.nowMs() + timeoutMs
        var sent = 0
        var authFailed = false
        // a. + b. Vaciar la cola: serie estricta hasta vaciar o agotar el tope.
        while (driver.nowMs() < deadline) {
            if (driver.pendingCount() <= 0) break
            val result = runCatching { driver.sendBatch(maxBatch) }
                .getOrDefault(SendResult(0, BatchOutcome.RETRY_LATER))
            if (result.confirmed > 0) {
                sent += result.confirmed
                onBatchConfirmed(result.confirmed)
            }
            when (result.outcome) {
                BatchOutcome.EMPTY -> break
                BatchOutcome.SENT -> Unit // seguir con el siguiente lote
                BatchOutcome.AUTH_PAUSED -> {
                    authFailed = true
                    break
                }
                BatchOutcome.RETRY_LATER -> break
            }
        }
        val remaining = runCatching { driver.pendingCount() }.getOrDefault(-1)
        // c. Finalizar la jornada abierta local (ya cerrada en el servidor = sin error).
        val journey = runCatching { driver.endJourney() }
            .getOrDefault(JourneyOutcome.OFFLINE)
        if (journey == JourneyOutcome.AUTH_FAILED) authFailed = true
        // d. Limpiar la sesión. Si esto lanza, la sesión sigue intacta.
        val cleared = runCatching {
            driver.clearSession()
            true
        }.getOrDefault(false)
        return CloseReport(sent, remaining, authFailed, journey, cleared)
    }
}
