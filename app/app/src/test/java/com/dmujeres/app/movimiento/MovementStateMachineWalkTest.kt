package com.dmujeres.app.movimiento

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import com.dmujeres.app.captura.Geo
import com.dmujeres.app.movimiento.MovementStateMachine.State

/**
 * Modo caminata de la máquina (JVM, sin dispositivo).
 *
 * Caso real: paseos a 2-8 km/h sostenidos con instantánea <3 kn que caían a
 * STATIONARY (cadencia 120 s) y quedaban ralos. 5 km/h = 2,7 kn: tramos de
 * ~13,9 m cada 10 s, muy bajo el umbral de 150 m y de 3 kn.
 */
class MovementStateMachineWalkTest {

    private val baseLat = -0.1807
    private val baseLon = -78.4678

    private fun started(): MovementStateMachine =
        MovementStateMachine().also {
            assertEquals(State.STARTING, it.onJourneyStarted(0L))
        }

    @Test
    fun `caminata 5 kmh sostenida mantiene cadencia fina y marca caminando`() {
        val machine = started()
        var lat = baseLat
        var lon = baseLon
        var walkingAt50s = true
        var walkingAt60s = false
        // 6 min a pie, teléfono estable (IMU quieto): solo el avance sostiene.
        for (i in 0..36) {
            val now = i * 10_000L
            val state = machine.onFixWithPosition(now, 2.7, 13.9, lat, lon, false)
            assertEquals("sigue en fino en t=${now / 1000}s", State.ACTIVE, state)
            assertTrue(machine.wantsFineCadence())
            if (now == 50_000L) walkingAt50s = machine.isWalking
            if (now == 60_000L) walkingAt60s = machine.isWalking
            val next = Geo.offset(lat, lon, 13.889, 0.0)
            lat = next.first
            lon = next.second
        }
        // Pasados los 3 min que antes estacionaban, sigue en fino y caminando.
        assertEquals(State.ACTIVE, machine.state)
        assertFalse(walkingAt50s)
        assertTrue(walkingAt60s)
        assertTrue(machine.isWalking)
        assertTrue(machine.wantsFineCadence())
    }

    @Test
    fun `deriva parada termina en STATIONARY sin marcar caminata`() {
        val machine = started()
        var lat = baseLat
        var lon = baseLon
        val jitter = listOf(3.0 to 2.0, -4.0 to 3.0, 2.0 to -4.0, -3.0 to -2.0)
        for (i in 0..24) {
            val now = i * 10_000L
            machine.onFixWithPosition(now, 0.0, 3.0, lat, lon, false)
            val (east, north) = jitter[i % jitter.size]
            val next = Geo.offset(lat, lon, north, east)
            lat = next.first
            lon = next.second
        }
        // 4 min de ruido quieto: STATIONARY, sin caminata, cadencia gruesa.
        assertEquals(State.STATIONARY, machine.state)
        assertFalse(machine.isWalking)
        assertFalse(machine.wantsFineCadence())
    }

    @Test
    fun `arrancar a pie desde STATIONARY vuelve a fino`() {
        val machine = started()
        machine.onFixWithPosition(0L, 0.0, 0.0, baseLat, baseLon, false)
        machine.onFixWithPosition(MovementStateMachine.STATIONARY_AFTER_MS, 0.0, 0.0, baseLat, baseLon, false)
        assertEquals(State.STATIONARY, machine.state)
        var lat = baseLat
        var lon = baseLon
        var now = MovementStateMachine.STATIONARY_AFTER_MS
        // 2 min a pie a 5 km/h con el teléfono estable.
        for (i in 1..12) {
            now += 10_000L
            machine.onFixWithPosition(now, 2.7, 13.9, lat, lon, false)
            val next = Geo.offset(lat, lon, 13.889, 0.0)
            lat = next.first
            lon = next.second
        }
        assertEquals(State.ACTIVE, machine.state)
        assertTrue(machine.isWalking)
        assertTrue(machine.wantsFineCadence())
    }

    @Test
    fun `la entrada legada sin coordenadas no rompe nada`() {
        // Sin posiciones el historial de avance no existe: comportamiento previo.
        val machine = started()
        machine.onFix(0L, 0.0, 0.0, false)
        assertEquals(State.ACTIVE, machine.state)
        assertFalse(machine.isWalking)
    }
}
