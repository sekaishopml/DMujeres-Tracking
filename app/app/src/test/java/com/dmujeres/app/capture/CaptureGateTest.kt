package com.dmujeres.app.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Orquestador de filtros de captura (JVM, sin dispositivo), con los casos
 * reales del dispositivo 50 (2026-09-28).
 */
class CaptureGateTest {

    private val baseLat = -0.1807
    private val baseLon = -78.4678
    private val t0 = 1_790_718_000_000L

    @Test
    fun `primer fix sin siembra siempre se almacena`() {
        val gate = CaptureGate()
        val outcome = gate.evaluate(baseLat, baseLon, 0.0, 8.0, 0.0, t0, true, t0)
        assertTrue(outcome.store)
        assertEquals(CaptureGate.Reason.STORE_FIRST, outcome.reason)
    }

    @Test
    fun `caso real deriva parada 17-20-16 a 17-20-57 colapsa a 1 punto`() {
        // ~15 fixes en 41 s, velocidad 0.0, jitter dentro de la banda (<15 m
        // del almacenado): solo queda el punto sembrado, nada nuevo.
        val gate = CaptureGate()
        gate.seed(t0, baseLat, baseLon, 40.0, 8.0)
        val jitter = listOf(
            3.0 to 4.0, -5.0 to 6.0, 7.0 to -3.0, -4.0 to -8.0, 9.0 to 2.0,
            -7.0 to 5.0, 4.0 to -6.0, -3.0 to 9.0, 6.0 to 7.0, -8.0 to -2.0,
            2.0 to 10.0, -6.0 to -9.0, 8.0 to -5.0, -2.0 to 3.0, 5.0 to -7.0,
        )
        var stored = 0
        jitter.forEachIndexed { i, (east, north) ->
            val (lat, lon) = Geo.offset(baseLat, baseLon, north, east)
            // Rumbo con ruido parado (salta), pero sin velocidad no hay giro.
            val outcome = gate.evaluate(lat, lon, (i * 47) % 360.0, 8.0, 0.0, t0 + 3_000L + i * 2_700L, true, t0 + 3_000L + i * 2_700L)
            if (outcome.store) stored++
            assertEquals(CaptureGate.Reason.DROP_COLLAPSE, outcome.reason)
        }
        // 15 fixes de puro ruido → 0 puntos nuevos (queda el sembrado: 1 punto).
        assertEquals(0, stored)
    }

    @Test
    fun `pico de deriva de 25 m se guarda como avance`() {
        // Límite documentado: el umbral es 15 m, así que un pico de 25 m no se
        // puede distinguir de un arranque real y se guarda (captura primero).
        val gate = CaptureGate()
        gate.seed(t0, baseLat, baseLon, 40.0, 8.0)
        val (lat, lon) = Geo.offset(baseLat, baseLon, 25.0, 0.0)
        val outcome = gate.evaluate(lat, lon, 40.0, 8.0, 0.0, t0 + 10_000L, true, t0 + 10_000L)
        assertTrue(outcome.store)
        assertEquals(CaptureGate.Reason.STORE_MOVE, outcome.reason)
    }

    @Test
    fun `latido cada 5 min en parado`() {
        val gate = CaptureGate()
        gate.seed(t0, baseLat, baseLon, 40.0, 8.0)
        val (lat, lon) = Geo.offset(baseLat, baseLon, 2.0, 1.0)
        val early = gate.evaluate(lat, lon, 40.0, 8.0, 0.0, t0 + 299_000L, true, t0 + 299_000L)
        assertFalse(early.store)
        val beat = gate.evaluate(lat, lon, 40.0, 8.0, 0.0, t0 + 300_000L, true, t0 + 300_000L)
        assertTrue(beat.store)
        assertEquals(CaptureGate.Reason.STORE_HEARTBEAT, beat.reason)
    }

    @Test
    fun `giro de 90 grados en paseo es punto extra aunque no haya 15 m`() {
        // Caminata a 2,7 kn (<3 kn) en STATIONARY: sin giro se colapsaría (10 m
        // < 15 m, sin 5 min), con giro de 90° se guarda la esquina.
        val gate = CaptureGate()
        gate.seed(t0, baseLat, baseLon, 10.0, 8.0)
        val (lat, lon) = Geo.offset(baseLat, baseLon, 10.0, 0.0)
        val straight = gate.evaluate(lat, lon, 12.0, 8.0, 2.7, t0 + 60_000L, true, t0 + 60_000L)
        assertFalse(straight.store)
        val turn = gate.evaluate(lat, lon, 100.0, 8.0, 2.7, t0 + 70_000L, true, t0 + 70_000L)
        assertTrue(turn.store)
        assertEquals(CaptureGate.Reason.STORE_TURN, turn.reason)
        // 1 s después, otro giro igual: enfriamiento, no hay ráfaga.
        val again = gate.evaluate(lat, lon, 190.0, 8.0, 2.7, t0 + 71_000L, true, t0 + 71_000L)
        assertFalse(again.store)
    }

    @Test
    fun `caso real salto 70 m en 13 s con vel 0 es teleport`() {
        val gate = CaptureGate()
        gate.seed(t0, baseLat, baseLon, 40.0, 10.0)
        val (lat, lon) = Geo.offset(baseLat, baseLon, 70.0, 0.0)
        assertTrue(gate.isTeleport(lat, lon, t0 + 13_000L, 12.0, 0.0))
    }

    @Test
    fun `salto absurdo fresco es teleport y viejo no`() {
        val gate = CaptureGate()
        gate.seed(t0, baseLat, baseLon, 40.0, 10.0)
        val (lat, lon) = Geo.offset(baseLat, baseLon, 2_000.0, 0.0)
        assertTrue(gate.isTeleport(lat, lon, t0 + 10_000L, 10.0, 8.0))
        assertFalse(gate.isTeleport(lat, lon, t0 + 61_000L, 10.0, 8.0))
    }

    @Test
    fun `en marcha todo se almacena`() {
        val gate = CaptureGate()
        gate.seed(t0, baseLat, baseLon, 90.0, 8.0)
        val (lat, lon) = Geo.offset(baseLat, baseLon, 0.0, 40.0)
        val outcome = gate.evaluate(lat, lon, 90.0, 8.0, 8.0, t0 + 10_000L, false, t0 + 10_000L)
        assertTrue(outcome.store)
        assertEquals(CaptureGate.Reason.STORE_MOVE, outcome.reason)
    }
}
