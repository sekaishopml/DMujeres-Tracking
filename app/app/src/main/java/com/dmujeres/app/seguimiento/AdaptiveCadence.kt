package com.dmujeres.app.seguimiento

import com.dmujeres.app.datos.Ajustes

/**
 * Cada cuánto se captura (sin Android, se prueba en la JVM).
 *
 * Dos decisiones:
 * - El PEDIDO al GPS: con jornada abierta, alta precisión cada 1 s. Quieta
 *   (3 min sin moverse según GPS y sensor) sigue en GPS pero cada 10 s, para
 *   que descanse entre lecturas; la salida la ve el propio GPS, no depende
 *   del sensor (que en algunos teléfonos se duerme). Bajar a red estando
 *   quieta perdía kilómetros. Sin jornada, el GPS descansa (red, 120 s).
 * - Lo que se GUARDA: lo filtra PositionProvider por distancia, giro y
 *   latido. En movimiento el latido es la "Frecuencia" del panel; quieta,
 *   120 s.
 */
object AdaptiveCadence {

    /** Latido de reporte en movimiento por defecto (sin distancia recorrida). */
    const val MOVING_INTERVAL_MS = 10_000L

    /** Límites del control remoto "Frecuencia" para el latido en movimiento. */
    const val MIN_MOVING_S = 10L
    const val MAX_MOVING_S = 60L

    /** Latido de reporte en quietud, y petición de red sin jornada. */
    const val STATIONARY_INTERVAL_MS = 120_000L

    /**
     * Filtro de reporte en quietud con jornada abierta: deja pasar una lectura
     * por minuto. Así el latido de 5 min cae en 5 y no en 6: antes solo pasaba
     * una lectura cada 120 s, y el primer paso >= 300 s llegaba a los 360 s.
     */
    const val QUIETA_REPORTE_INTERVAL_MS = 60_000L

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
    fun request(journeyOpen: Boolean, quieta: Boolean = false): Request = if (journeyOpen) {
        // Los tiempos pueden llegar del servidor (ver Ajustes); sin ellos, 1 s y 10 s.
        Request(
            intervalMs = if (quieta) {
                Ajustes.valor(Ajustes.Clave.GPS_QUIETA_MS)
            } else {
                Ajustes.valor(Ajustes.Clave.GPS_MARCHA_MS)
            },
            minDistanceM = 0f,
            maxUpdateDelayMs = 0L,
            accuracy = if (quieta && Ajustes.valor(Ajustes.Clave.QUIETA_BAJO_CONSUMO) == 1L) {
                Accuracy.BALANCED
            } else {
                Accuracy.HIGH
            },
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
