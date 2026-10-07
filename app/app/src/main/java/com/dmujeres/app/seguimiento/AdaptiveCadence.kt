package com.dmujeres.app.seguimiento

/**
 * Cada cuánto se captura (sin Android, se prueba en la JVM).
 *
 * Dos decisiones:
 * - El PEDIDO al GPS: con jornada abierta, alta precisión cada 1 s, se mueva
 *   o no. Bajar a red cada 120 s estando quieta dependía de que el sensor
 *   avisara la salida, y en algunos teléfonos el sensor se duerme y se
 *   perdían kilómetros. Sin jornada, el GPS descansa (red, 120 s).
 * - Lo que se GUARDA: lo filtra PositionProvider por distancia, giro y
 *   latido. En movimiento el latido es la "Frecuencia" del panel; quieta,
 *   120 s.
 */
object AdaptiveCadence {

    /** Petición al GPS con jornada abierta: continua, 1 Hz. */
    const val TRACKING_GPS_INTERVAL_MS = 1_000L

    /** Latido de reporte en movimiento por defecto (sin distancia recorrida). */
    const val MOVING_INTERVAL_MS = 10_000L

    /** Límites del control remoto "Frecuencia" para el latido en movimiento. */
    const val MIN_MOVING_S = 10L
    const val MAX_MOVING_S = 60L

    /** Latido de reporte en quietud, y petición de red sin jornada. */
    const val STATIONARY_INTERVAL_MS = 120_000L

    /** Desplazamiento mínimo entre fixes sin jornada (m). */
    const val MIN_DISTANCE_M = 10f

    enum class Accuracy { HIGH, BALANCED, LOW }

    data class Request(
        val intervalMs: Long,
        val minDistanceM: Float,
        val maxUpdateDelayMs: Long,
        val accuracy: Accuracy,
    )

    /** Latido de reporte según el estado de movimiento. */
    fun intervalMs(moving: Boolean): Long =
        if (moving) MOVING_INTERVAL_MS else STATIONARY_INTERVAL_MS

    /**
     * Latido en movimiento según la "Frecuencia" del panel
     * (`mobile.intervalSeconds`), acotado a [10, 60] s.
     */
    fun movingIntervalMs(configuredSeconds: Long?): Long {
        val seconds = configuredSeconds?.takeIf { it > 0 } ?: (MOVING_INTERVAL_MS / 1000)
        return seconds.coerceIn(MIN_MOVING_S, MAX_MOVING_S) * 1000
    }

    /**
     * Pedido al GPS. Con jornada: alta precisión cada 1 s, sin distancia
     * mínima ni envíos agrupados (`mobile.accuracy` no lo baja: una ruta que se
     * audita no se captura con antenas). Sin jornada: red cada 120 s.
     */
    fun request(journeyOpen: Boolean): Request = if (journeyOpen) {
        Request(
            intervalMs = TRACKING_GPS_INTERVAL_MS,
            minDistanceM = 0f,
            maxUpdateDelayMs = 0L,
            accuracy = Accuracy.HIGH,
        )
    } else {
        Request(
            intervalMs = STATIONARY_INTERVAL_MS,
            minDistanceM = MIN_DISTANCE_M,
            maxUpdateDelayMs = 0L,
            accuracy = Accuracy.BALANCED,
        )
    }
}
