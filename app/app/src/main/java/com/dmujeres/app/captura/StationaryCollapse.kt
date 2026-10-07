package com.dmujeres.app.captura

/**
 * Qué guardar estando quieta (sin Android, se prueba en la JVM).
 *
 * Detenido, el GPS tiembla (±25 m) y se guardaba cada punto. Estando quieta
 * solo se guarda si avanzó de verdad desde el último guardado (15 m o más) o
 * si pasaron 5 min (para saber que sigue ahí). Así el temblor no se guarda y
 * una salida real sí.
 *
 * Se aplica en STATIONARY, o con velocidad cero sostenida aunque la máquina
 * siga en ACTIVE (un semáforo de 2 min). Un 0 suelto no cuenta: la quietud
 * tiene que durar 60 s.
 *
 * Nunca inventa ni mueve puntos: solo decide si se guarda el punto tal cual.
 */
object StationaryCollapse {

    /** Avance real desde el último almacenado que siempre se guarda (m). */
    const val MIN_DISTANCE_M = 15.0

    /** Estando quieta, un punto cada 5 min aunque no se mueva. */
    const val HEARTBEAT_MS = 5 * 60_000L

    /** Velocidad reportada que cuenta como "~0" (nudos, ≈1,85 km/h). */
    const val STILL_SPEED_KN = 1.0

    /** Cuánto debe sostenerse el ~0 en ACTIVE para colapsar (ms). */
    const val STILL_SUSTAINED_MS = 60_000L

    /**
     * ¿Se guarda el punto?
     *
     * @param stationary la máquina ya está en STATIONARY.
     * @param stillSustained velocidad cero sostenida (la calcula [CaptureGate]).
     * @param speedKn velocidad del punto.
     * @param distFromStoredM distancia desde el último guardado.
     * @param msSinceStored tiempo desde el último guardado.
     * @param hasReference false en el primer punto (sin referencia se guarda).
     */
    fun shouldStore(
        stationary: Boolean,
        stillSustained: Boolean,
        speedKn: Double,
        distFromStoredM: Double,
        msSinceStored: Long,
        hasReference: Boolean,
    ): Boolean {
        if (!hasReference) return true
        val quiet = stationary || (stillSustained && speedKn < STILL_SPEED_KN)
        if (!quiet) return true
        if (distFromStoredM >= MIN_DISTANCE_M) return true
        if (msSinceStored >= HEARTBEAT_MS) return true
        return false
    }
}
