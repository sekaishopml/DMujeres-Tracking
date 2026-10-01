package com.dmujeres.app.capture

/**
 * Filtros de captura de cada punto (sin Android, se prueba en la JVM).
 *
 * Orden (lo usa `TrackingController`):
 * 1. [isTeleport]: un salto imposible se descarta antes de que afecte a la
 *    máquina, al último punto o al vigilante.
 * 2. [evaluate]: el punto pasa a ser la referencia para el siguiente (se
 *    guarde o no) y se decide si se guarda: un giro obliga a guardarlo, el
 *    movimiento lo guarda, estando quieta se descarta el temblor del GPS, y
 *    cada 5 min se guarda uno igual.
 *
 * Las ventanas de salto, quietud y latido usan la hora del GPS; la espera
 * entre giros (3 s) usa el reloj del teléfono, porque limita entregas
 * seguidas.
 *
 * No toca la frecuencia, el protocolo, la jornada ni la recuperación: solo
 * dice si guardar o descartar. [DuplicateFixGuard] sigue revisando al
 * guardar.
 */
class CaptureGate {

    /** Último fix ALMACENADO (referencia de distancia, latido y rumbo). */
    data class Stored(
        val capturedAtMs: Long,
        val lat: Double,
        val lon: Double,
        val courseDeg: Double,
    )

    /** Por qué se guardó o tiró el fix (diagnóstico, sin datos fabricados). */
    enum class Reason {
        STORE_FIRST,
        STORE_MOVE,
        STORE_TURN,
        STORE_HEARTBEAT,
        DROP_COLLAPSE,
        DROP_TELEPORT,
    }

    data class Outcome(val store: Boolean, val reason: Reason)

    private var lastStored: Stored? = null
    private var lastAccepted: TeleportGuard.Reference? = null
    private var lastTurnExtraMs: Long = Long.MIN_VALUE
    private var stillSinceMs: Long? = null

    /** Siembra con el último almacenado del historial (cero queries en régimen). */
    fun seed(capturedAtMs: Long, lat: Double, lon: Double, courseDeg: Double, accuracyM: Double) {
        lastStored = Stored(capturedAtMs, lat, lon, courseDeg)
        lastAccepted = TeleportGuard.Reference(capturedAtMs, lat, lon, accuracyM)
        stillSinceMs = null
        lastTurnExtraMs = Long.MIN_VALUE
    }

    /** ¿Es un salto imposible? Solo lo juzga, no cambia nada. */
    fun isTeleport(
        lat: Double,
        lon: Double,
        capturedAtMs: Long,
        accuracyM: Double,
        speedKn: Double,
    ): Boolean {
        val verdict = TeleportGuard.evaluate(
            TeleportGuard.Candidate(capturedAtMs, lat, lon, accuracyM, speedKn),
            lastAccepted,
        )
        return verdict == TeleportGuard.Verdict.REJECT
    }

    /**
     * Decide si el punto (que ya no es un salto) se guarda.
     *
     * @param stationary la máquina está en STATIONARY para este punto.
     * @param nowMs reloj del teléfono (espera entre giros).
     */
    fun evaluate(
        lat: Double,
        lon: Double,
        courseDeg: Double,
        accuracyM: Double,
        speedKn: Double,
        capturedAtMs: Long,
        stationary: Boolean,
        nowMs: Long,
    ): Outcome {
        // Referencia para detectar el próximo salto, se guarde o no.
        lastAccepted = TeleportGuard.Reference(capturedAtMs, lat, lon, accuracyM)
        // Quietud sostenida: un 0 suelto no cuenta, tiene que durar 60 s.
        val still = speedKn < StationaryCollapse.STILL_SPEED_KN
        val since = stillSinceMs
        if (still) {
            if (since == null) stillSinceMs = capturedAtMs
        } else {
            stillSinceMs = null
        }
        val sustained = still && since != null &&
            capturedAtMs - since >= StationaryCollapse.STILL_SUSTAINED_MS
        val stored = lastStored
        if (stored == null) {
            lastStored = Stored(capturedAtMs, lat, lon, courseDeg)
            return Outcome(true, Reason.STORE_FIRST)
        }
        val distM = Geo.distanceM(stored.lat, stored.lon, lat, lon)
        val elapsedMs = capturedAtMs - stored.capturedAtMs
        // El giro se guarda aunque esté quieta (la esquina no se pierde).
        val sinceTurn = if (lastTurnExtraMs == Long.MIN_VALUE) Long.MAX_VALUE else nowMs - lastTurnExtraMs
        if (TurnCapture.isTurn(stored.courseDeg, courseDeg, speedKn, sinceTurn, true)) {
            lastStored = Stored(capturedAtMs, lat, lon, courseDeg)
            lastTurnExtraMs = nowMs
            return Outcome(true, Reason.STORE_TURN)
        }
        val keep = StationaryCollapse.shouldStore(
            stationary = stationary,
            stillSustained = sustained,
            speedKn = speedKn,
            distFromStoredM = distM,
            msSinceStored = elapsedMs,
            hasReference = true,
        )
        if (!keep) return Outcome(false, Reason.DROP_COLLAPSE)
        lastStored = Stored(capturedAtMs, lat, lon, courseDeg)
        val reason = if ((stationary || sustained) && elapsedMs >= StationaryCollapse.HEARTBEAT_MS) {
            Reason.STORE_HEARTBEAT
        } else {
            Reason.STORE_MOVE
        }
        return Outcome(true, reason)
    }
}
