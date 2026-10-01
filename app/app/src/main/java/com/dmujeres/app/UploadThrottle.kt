package com.dmujeres.app

/**
 * Ahorro de batería en la SUBIDA (pura, testeable en JVM). Con batería baja
 * y sin cargador, los fixes nuevos se siguen capturando y guardando igual
 * (el GPS no se toca: la ruta queda completa), pero la radio se despierta
 * para subirlos como máximo una vez por minuto, en lote. Encender la radio
 * por cada punto es de lo que más batería gasta.
 */
object UploadThrottle {
    const val LOW_BATTERY_PCT = 15.0
    const val LOW_BATTERY_GAP_MS = 60_000L

    fun shouldKick(nowMs: Long, lastKickMs: Long, batteryPct: Double, charging: Boolean): Boolean {
        val low = batteryPct in 0.0..LOW_BATTERY_PCT && !charging
        if (!low) return true
        return lastKickMs <= 0L || nowMs - lastKickMs >= LOW_BATTERY_GAP_MS || nowMs < lastKickMs
    }
}
