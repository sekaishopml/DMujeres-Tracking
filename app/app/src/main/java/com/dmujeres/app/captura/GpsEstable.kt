package com.dmujeres.app.captura

/**
 * ¿El GPS del teléfono ya da posiciones confiables? (sin Android, se prueba
 * en la JVM).
 *
 * Recién encendido, el GPS entrega durante minutos posiciones que dicen 5 m
 * de precisión pero saltan cientos de metros de ida y vuelta (ZTE, 25/10:
 * 260 m en 5 s yendo a 52 km/h). Se considera estable cuando lleva
 * [RACHA_MINIMA] posiciones seguidas coherentes entre sí, la última es
 * reciente y precisa.
 */
class GpsEstable {

    private data class Fix(val recibidoMs: Long, val lat: Double, val lon: Double, val precisionM: Double, val velocidadMps: Double)

    private var ultimo: Fix? = null
    private var racha = 0

    fun reiniciar() {
        ultimo = null
        racha = 0
    }

    fun anotar(recibidoMs: Long, lat: Double, lon: Double, precisionM: Double, velocidadMps: Double) {
        val nuevo = Fix(recibidoMs, lat, lon, precisionM, velocidadMps)
        val previo = ultimo
        racha = if (previo != null && coherente(previo, nuevo)) racha + 1 else 1
        ultimo = nuevo
    }

    fun listo(nowMs: Long): Boolean {
        val u = ultimo ?: return false
        return racha >= RACHA_MINIMA && u.precisionM in 0.0..PRECISION_MAX_M && nowMs - u.recibidoMs <= FRESCO_MS
    }

    private fun coherente(a: Fix, b: Fix): Boolean {
        val segundos = (b.recibidoMs - a.recibidoMs) / 1000.0
        if (segundos <= 0.0 || segundos > 15.0) return false
        val distM = Geo.distanceM(a.lat, a.lon, b.lat, b.lon)
        if (distM <= a.precisionM + b.precisionM) return true
        val implicitaKmh = distM / segundos * 3.6
        if (implicitaKmh > MAX_KMH) return false
        val reportadaKmh = maxOf(a.velocidadMps, b.velocidadMps) * 3.6
        return reportadaKmh <= 0.0 || implicitaKmh <= 3 * reportadaKmh + 15
    }

    companion object {
        const val RACHA_MINIMA = 10
        const val PRECISION_MAX_M = 20.0
        const val FRESCO_MS = 5_000L
        const val MAX_KMH = 160.0
    }
}
