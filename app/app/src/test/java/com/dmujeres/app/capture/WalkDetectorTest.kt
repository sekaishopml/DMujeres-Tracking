package com.dmujeres.app.capture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Detector de caminata (JVM, sin dispositivo).
 *
 * 5 km/h = 1,3889 m/s: tramos de ~13,9 m cada 10 s. La deriva parada usa
 * jitter determinista que va y viene (neto bajo, suma alta).
 */
class WalkDetectorTest {

    private val baseLat = -0.1807
    private val baseLon = -78.4678

    /** Avanza al norte a [speedMps] con fixes cada [stepMs]. */
    private fun walk(detector: WalkDetector, speedMps: Double, fixes: Int, stepMs: Long = 10_000L): Boolean {
        var lat = baseLat
        var lon = baseLon
        var walking = false
        for (i in 0 until fixes) {
            walking = detector.add(i * stepMs, lat, lon)
            val next = Geo.offset(lat, lon, speedMps * stepMs / 1000.0, 0.0)
            lat = next.first
            lon = next.second
        }
        return walking
    }

    @Test
    fun `caminata 5 kmh sostenida se detecta y al inicio no`() {
        val detector = WalkDetector()
        var lat = baseLat
        var lon = baseLon
        var walkingAt30s = true
        var walkingAt50s = true
        var walkingAt60s = false
        for (i in 0..23) {
            val walking = detector.add(i * 10_000L, lat, lon)
            val next = Geo.offset(lat, lon, 13.889, 0.0)
            lat = next.first
            lon = next.second
            if (i * 10_000L == 30_000L) walkingAt30s = walking
            if (i * 10_000L == 50_000L) walkingAt50s = walking
            if (i * 10_000L == 60_000L) walkingAt60s = walking
        }
        // Con 30-50 s de tramo aún no hay paseo juzgable (mínimo 60 s).
        assertFalse(walkingAt30s)
        assertFalse(walkingAt50s)
        // A los 60 s el neto (≈83 m a 5 km/h) ya sostiene la caminata.
        assertTrue(walkingAt60s)
        assertTrue(detector.walking)
    }

    @Test
    fun `deriva parada que va y viene no es caminata`() {
        val detector = WalkDetector()
        // 3 min de jitter alternado: suma ~300 m, neto ~10 m.
        val steps = listOf(
            10.0 to 3.0, -10.0 to 9.0, 11.0 to -4.0, -9.0 to -7.0, 5.0 to 10.0,
            -12.0 to 2.0, 9.0 to -8.0, -7.0 to 6.0, 12.0 to 1.0,
            -11.0 to -3.0, 8.0 to 7.0, -6.0 to -9.0, 10.0 to 4.0,
            -10.0 to 5.0, 7.0 to -6.0, -8.0 to 8.0, 11.0 to -2.0, -9.0 to -5.0,
        )
        var lat = baseLat
        var lon = baseLon
        steps.forEachIndexed { i, (east, north) ->
            detector.add(i * 10_000L, lat, lon)
            val next = Geo.offset(lat, lon, north, east)
            lat = next.first
            lon = next.second
        }
        assertFalse(detector.walking)
    }

    @Test
    fun `detenido total no es caminata`() {
        val detector = WalkDetector()
        for (i in 0..11) {
            detector.add(i * 10_000L, baseLat, baseLon)
        }
        assertFalse(detector.walking)
    }

    @Test
    fun `vehiculo a 15 kmh no es caminata (ya manda la velocidad GPS)`() {
        val detector = WalkDetector()
        // 41,667 m cada 10 s durante 3 min: neto enorme pero fuera de banda.
        assertFalse(walk(detector, 15.0 / 3.6, 18))
    }

    @Test
    fun `paso muy lento bajo 2 kmh no alcanza`() {
        val detector = WalkDetector()
        // 1,5 km/h durante 4 min: el neto roza el mínimo pero el promedio no
        // distingue de la deriva, así que no se marca (documentado).
        assertFalse(walk(detector, 1.5 / 3.6, 24))
    }

    @Test
    fun `al detenerse la caminata caduca con la ventana`() {
        val detector = WalkDetector()
        assertTrue(walk(detector, 5.0 / 3.6, 8))
        // 200 s quieto en el mismo punto: la ventana de 3 min olvida el paseo.
        val lastT = 7 * 10_000L
        var lat = baseLat
        var lon = baseLon
        // Reconstruye el punto donde quedó el paseo (8 tramos de 13,889 m).
        repeat(8) {
            val next = Geo.offset(lat, lon, 13.889, 0.0)
            lat = next.first
            lon = next.second
        }
        for (i in 1..20) {
            detector.add(lastT + i * 10_000L, lat, lon)
        }
        assertFalse(detector.walking)
    }
}
