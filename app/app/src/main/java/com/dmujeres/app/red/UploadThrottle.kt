package com.dmujeres.app.red

/**
 * Ahorro de batería en la SUBIDA (pura, testeable en JVM). Los fixes se
 * capturan y guardan todos igual (la ruta queda completa); lo que se espacia
 * es despertar la radio, que es de lo que más batería gasta:
 * - en movimiento, en lote a lo sumo cada 30 s (antes salía cada punto, uno
 *   cada ~4 s);
 * - con batería baja y sin cargador, a lo sumo cada minuto;
 * - quieta o cargando, al momento (son pocos puntos o sobra energía).
 * Si no entran puntos, el pulso de cada minuto vacía lo que quede.
 */
object UploadThrottle {
    const val LOW_BATTERY_PCT = 15.0
    const val LOW_BATTERY_GAP_MS = 60_000L
    const val MOVING_GAP_MS = 30_000L

    fun shouldKick(nowMs: Long, lastKickMs: Long, batteryPct: Double, charging: Boolean, moving: Boolean = false): Boolean {
        if (charging) return true
        val gap = when {
            batteryPct in 0.0..LOW_BATTERY_PCT -> LOW_BATTERY_GAP_MS
            moving -> MOVING_GAP_MS
            else -> return true
        }
        return lastKickMs <= 0L || nowMs - lastKickMs >= gap || nowMs < lastKickMs
    }
}
