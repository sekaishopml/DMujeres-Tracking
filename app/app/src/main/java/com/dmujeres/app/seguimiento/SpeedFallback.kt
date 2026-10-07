package com.dmujeres.app.seguimiento

/**
 * Velocidad calculada entre dos puntos aceptados (sin Android, se prueba en
 * la JVM). Solo se usa si el tramo supera el error del GPS (el mayor entre
 * 8 m y la precisión) y pasaron entre 1 y 120 s; si no, null y queda la
 * velocidad que informó el teléfono.
 */
object SpeedFallback {
    private const val MIN_LEG_M = 8.0
    private const val MAX_DT_S = 120.0
    /** 180 km/h: por encima es un salto del GPS, no movimiento. */
    private const val MAX_SPEED_MPS = 50.0

    fun impliedSpeedMps(legMeters: Double, dtSeconds: Double, accuracyMeters: Double): Double? {
        if (dtSeconds < 1.0 || dtSeconds > MAX_DT_S) return null
        if (legMeters < maxOf(MIN_LEG_M, accuracyMeters)) return null
        val speed = legMeters / dtSeconds
        return if (speed > MAX_SPEED_MPS) null else speed
    }
}
