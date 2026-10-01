package com.dmujeres.app.capture

import org.junit.Assert.assertEquals
import org.junit.Test
import com.dmujeres.app.capture.TeleportGuard.Candidate
import com.dmujeres.app.capture.TeleportGuard.Reference
import com.dmujeres.app.capture.TeleportGuard.Verdict

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
}
