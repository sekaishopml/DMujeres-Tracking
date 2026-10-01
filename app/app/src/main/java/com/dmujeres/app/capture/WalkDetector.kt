package com.dmujeres.app.capture

/**
 * Detecta caminata por avance acumulado (sin Android, se prueba en la JVM).
 *
 * Caminando (2 a 8 km/h) la velocidad queda por debajo del umbral de 3 nudos
 * (unos 5,5 km/h) y la máquina podía pasar a STATIONARY y capturar cada
 * 120 s. Este detector mira cuánto avanzó en línea recta en 3 min: un avance
 * lento pero constante cuenta como movimiento.
 *
 * Se usa el avance neto porque el temblor del GPS estando quieta (±25 m) suma
 * metros pero va y viene; caminando se avanza en una dirección.
 *
 * Por debajo de 2 km/h no se distingue del temblor; por encima de 8,5 km/h
 * ya manda la velocidad del GPS. Una vuelta en U a pie puede confundirlo un
 * momento, pero la máquina necesita 3 min de quietud para cambiar de estado.
 */
class WalkDetector(
    private val windowMs: Long = WINDOW_MS,
    private val minNetM: Double = MIN_NET_M,
    private val minKmh: Double = MIN_KMH,
    private val maxKmh: Double = MAX_KMH,
    private val minRatio: Double = MIN_RATIO,
    private val minSpanMs: Long = MIN_SPAN_MS,
) {

    private data class Point(val atMs: Long, val lat: Double, val lon: Double)

    private val points = ArrayDeque<Point>()

    /** ¿Hay avance lento pero constante ahora? */
    var walking: Boolean = false
        private set

    /** Agrega un fix y reevalúa. Devuelve [walking]. */
    fun add(atMs: Long, lat: Double, lon: Double): Boolean {
        points.addLast(Point(atMs, lat, lon))
        evict(atMs)
        return walking
    }

    /** Poda por tiempo y reevalúa (reloj entre fixes o tras agregar). */
    fun evict(nowMs: Long) {
        while (points.isNotEmpty() && nowMs - points.first().atMs > windowMs) {
            points.removeFirst()
        }
        recompute()
    }

    /** Limpia el historial (fin de jornada, recuperación, restauración). */
    fun reset() {
        points.clear()
        walking = false
    }

    private fun recompute() {
        if (points.size < 2) {
            walking = false
            return
        }
        val oldest = points.first()
        val newest = points.last()
        val spanMs = newest.atMs - oldest.atMs
        if (spanMs < minSpanMs) {
            walking = false
            return
        }
        val netM = Geo.distanceM(oldest.lat, oldest.lon, newest.lat, newest.lon)
        if (netM < minNetM) {
            walking = false
            return
        }
        var sumM = 0.0
        for (i in 1 until points.size) {
            val a = points[i - 1]
            val b = points[i]
            sumM += Geo.distanceM(a.lat, a.lon, b.lat, b.lon)
        }
        val ratio = if (sumM > 0.0) netM / sumM else 0.0
        if (ratio < minRatio) {
            walking = false
            return
        }
        val avgKmh = netM / (spanMs / 1000.0) * 3.6
        walking = avgKmh in minKmh..maxKmh
    }

    companion object {
        /** Ventana de avance: el mismo horizonte que exige STATIONARY. */
        const val WINDOW_MS = 180_000L

        /** Avance neto mínimo en la ventana (m): la deriva rara vez lo sostiene. */
        const val MIN_NET_M = 80.0

        /** Banda de caminata (km/h): 2-8 km/h del encargo con tolerancia GPS. */
        const val MIN_KMH = 2.0
        const val MAX_KMH = 8.5

        /** Rectitud mínima neto/suma: el paseo avanza, la deriva va y viene. */
        const val MIN_RATIO = 0.4

        /** Tiempo mínimo para juzgar (ms): un solo tramo no es caminata. */
        const val MIN_SPAN_MS = 60_000L
    }
}
