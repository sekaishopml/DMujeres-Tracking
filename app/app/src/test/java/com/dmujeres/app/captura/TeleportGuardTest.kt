package com.dmujeres.app.captura

import org.junit.Assert.assertEquals
import org.junit.Test
import com.dmujeres.app.captura.TeleportGuard.Candidate
import com.dmujeres.app.captura.TeleportGuard.Reference
import com.dmujeres.app.captura.TeleportGuard.Verdict

/**
 * Guardia de teleport (JVM, sin dispositivo).
 *
 * Caso real (dispositivo 50, 2026-09-28 17:18:02): salto de ~70 m con
 * velocidad reportada 0.0 que se almacenó tal cual. Son ~19,4 km/h
 * implícitos: no llegan a 200 km/h, pero quieto es imposible (sub-regla T2).
 */
class TeleportGuardTest {

    private val baseLat = -0.1807
    private val baseLon = -78.4678
    private val t0 = 1_790_718_000_000L

    private fun ref(
        atMs: Long = t0,
        lat: Double = baseLat,
        lon: Double = baseLon,
        acc: Double = 10.0,
    ) = Reference(atMs, lat, lon, acc)

    private fun cand(
        atMs: Long,
        lat: Double,
        lon: Double,
        acc: Double = 10.0,
        speedKn: Double = 0.0,
    ) = Candidate(atMs, lat, lon, acc, speedKn)

    @Test
    fun `sin referencia se acepta`() {
        val (lat, lon) = Geo.offset(baseLat, baseLon, 5_000.0, 0.0)
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(cand(t0, lat, lon), null))
    }

    @Test
    fun `referencia vieja se acepta aunque el salto sea enorme`() {
        val (lat, lon) = Geo.offset(baseLat, baseLon, 5_000.0, 0.0)
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(cand(t0 + 61_000L, lat, lon), ref()))
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(cand(t0 + 600_000L, lat, lon), ref()))
    }

    @Test
    fun `salto absurdo fresco se descarta`() {
        // 2 km en 10 s = 720 km/h contra referencia de hace 10 s.
        val (lat, lon) = Geo.offset(baseLat, baseLon, 2_000.0, 0.0)
        assertEquals(Verdict.REJECT, TeleportGuard.evaluate(cand(t0 + 10_000L, lat, lon), ref()))
    }

    @Test
    fun `salto absurdo con precision que lo justifica se acepta`() {
        // Error combinado de 3 km: el salto cabe en la incertidumbre, no es
        // un teleport juzgable (lo tratará el colapso en parado).
        val (lat, lon) = Geo.offset(baseLat, baseLon, 2_000.0, 0.0)
        val candidate = cand(t0 + 10_000L, lat, lon, acc = 1_500.0)
        val reference = ref(acc = 1_500.0)
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(candidate, reference))
    }

    @Test
    fun `caso real 70 m en 13 s con vel 0 se descarta`() {
        val (lat, lon) = Geo.offset(baseLat, baseLon, 70.0, 0.0)
        assertEquals(
            Verdict.REJECT,
            TeleportGuard.evaluate(cand(t0 + 13_000L, lat, lon, acc = 12.0, speedKn = 0.0), ref()),
        )
    }

    @Test
    fun `el mismo salto con precision pobre se acepta`() {
        // 70 m dentro de 50 + 50 m de error: ruido con mala señal, no teleport.
        val (lat, lon) = Geo.offset(baseLat, baseLon, 70.0, 0.0)
        val candidate = cand(t0 + 13_000L, lat, lon, acc = 50.0, speedKn = 0.0)
        val reference = ref(acc = 50.0)
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(candidate, reference))
    }

    @Test
    fun `caminata coherente se acepta`() {
        // 14 m en 10 s (≈5 km/h) con velocidad reportada acorde.
        val (lat, lon) = Geo.offset(baseLat, baseLon, 14.0, 0.0)
        assertEquals(
            Verdict.ACCEPT,
            TeleportGuard.evaluate(cand(t0 + 10_000L, lat, lon, speedKn = 2.7), ref()),
        )
    }

    @Test
    fun `sin orden temporal se acepta y lo decide el antiduplicado`() {
        val (lat, lon) = Geo.offset(baseLat, baseLon, 2_000.0, 0.0)
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(cand(t0, lat, lon), ref()))
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(cand(t0 - 5_000L, lat, lon), ref()))
    }

    @Test
    fun `rebote del GPS recien encendido se descarta`() {
        // ZTE, 25/10 18:46:54 -> 18:46:59: 263 m en 5 s (190 km/h) con el GPS
        // diciendo 52 km/h y 5 m de precisión.
        val r = ref(lat = -2.23812, lon = -79.90330, acc = 5.0)
        val c = cand(t0 + 5_000L, -2.24046, -79.90369, acc = 5.0, speedKn = 52 / 1.852)
        assertEquals(Verdict.REJECT, TeleportGuard.evaluate(c, r))
    }

    @Test
    fun `avance coherente con la velocidad del GPS se acepta`() {
        // 70 m en 5 s (50 km/h) con el GPS diciendo 48 km/h.
        val (lat, lon) = Geo.offset(baseLat, baseLon, 70.0, 90.0)
        assertEquals(Verdict.ACCEPT, TeleportGuard.evaluate(cand(t0 + 5_000L, lat, lon, acc = 5.0, speedKn = 48 / 1.852), ref(acc = 5.0)))
    }

    @Test
    fun `salto caminando de 17 s se descarta`() {
        // Jeremy, 27/10 18:51:28 -> 18:51:45: 618 m en 17 s con el GPS
        // diciendo 4 km/h y 9 m de precisión.
        val (lat, lon) = Geo.offset(baseLat, baseLon, 618.0, 180.0)
        assertEquals(Verdict.REJECT, TeleportGuard.evaluate(cand(t0 + 17_000L, lat, lon, acc = 9.0, speedKn = 4 / 1.852), ref(acc = 10.0)))
    }
}
