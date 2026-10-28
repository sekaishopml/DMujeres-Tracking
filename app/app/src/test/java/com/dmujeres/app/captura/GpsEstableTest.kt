package com.dmujeres.app.captura

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** GPS estable (JVM): el arranque en frío del ZTE no cuenta como listo. */
class GpsEstableTest {

    private val t0 = 1_790_718_000_000L

    @Test
    fun `diez posiciones coherentes y precisas lo dejan listo`() {
        val g = GpsEstable()
        var lat = -2.2389
        repeat(10) { i ->
            g.anotar(t0 + i * 1_000L, lat, -79.9, 5.0, 13.0)
            lat -= 0.00012 // ~13 m por segundo
        }
        assertTrue(g.listo(t0 + 9_000L))
        assertFalse("viejo ya no sirve", g.listo(t0 + 20_000L))
    }

    @Test
    fun `arranque en frio del ZTE no queda listo`() {
        // 25/10 18:46:41-18:47:16: dice 5 m de precisión pero rebota cientos de metros.
        val fixes = listOf(
            Triple(0, -2.23889, -79.90199), Triple(4, -2.23861, -79.90233), Triple(5, -2.23871, -79.90240),
            Triple(8, -2.23816, -79.90279), Triple(9, -2.23821, -79.90289), Triple(10, -2.23824, -79.90298),
            Triple(12, -2.23819, -79.90315), Triple(13, -2.23812, -79.90330), Triple(18, -2.24046, -79.90369),
            Triple(19, -2.24045, -79.90391), Triple(20, -2.24033, -79.90407), Triple(21, -2.24021, -79.90420),
            Triple(22, -2.24007, -79.90428), Triple(23, -2.23993, -79.90441), Triple(24, -2.23983, -79.90456),
            Triple(25, -2.23971, -79.90479), Triple(26, -2.23973, -79.90493), Triple(27, -2.23961, -79.90496),
            Triple(30, -2.23953, -79.90547), Triple(31, -2.23941, -79.90551), Triple(34, -2.24089, -79.90553),
            Triple(35, -2.24084, -79.90566),
        )
        val velocidades = listOf(32, 35, 30, 41, 48, 49, 48, 47, 52, 58, 56, 57, 54, 52, 56, 54, 41, 42, 46, 40, 36, 42)
        val g = GpsEstable()
        val listos = fixes.mapIndexed { i, (s, lat, lon) ->
            val ms = t0 + s * 1_000L
            g.anotar(ms, lat, lon, 5.0, velocidades[i] / 3.6)
            g.listo(ms)
        }
        // Tras el rebote de 18:47:15 no está listo.
        assertFalse(listos.last())
        assertFalse(listos.take(8).any { it })
    }
}
