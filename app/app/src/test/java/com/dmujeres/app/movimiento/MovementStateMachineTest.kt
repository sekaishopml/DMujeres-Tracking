package com.dmujeres.app.movimiento

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import com.dmujeres.app.movimiento.MovementStateMachine.Companion.MOVING_DISTANCE_M
import com.dmujeres.app.movimiento.MovementStateMachine.Companion.MOVING_SPEED_KN
import com.dmujeres.app.movimiento.MovementStateMachine.Companion.NO_FIX_RECOVER_MS
import com.dmujeres.app.movimiento.MovementStateMachine.Companion.STATIONARY_AFTER_MS
import com.dmujeres.app.movimiento.MovementStateMachine.State

/** Unit tests puros de la máquina (JVM, sin dispositivo). */
class MovementStateMachineTest {

    private fun started(at: Long = 0L): MovementStateMachine =
        MovementStateMachine().also {
            assertEquals(State.STARTING, it.onJourneyStarted(at))
        }

    @Test
    fun `primer fix aceptado lleva a ACTIVE`() {
        val machine = started()
        assertEquals(State.ACTIVE, machine.onFix(1_000L, 0.0, 0.0, null))
        assertTrue(machine.wantsFineCadence())
    }

    @Test
    fun `velocidad sobre 3kn manda aunque el IMU diga quieto`() {
        val machine = started()
        machine.onFix(1_000L, 0.0, 0.0, false)
        // El IMU quieto no baja a lento por sí solo...
        assertEquals(State.ACTIVE, machine.onFix(2_000L, MOVING_SPEED_KN, 0.0, false))
        // ...y la velocidad saca de STATIONARY aunque el sensor no lo note.
        val parked = started()
        parked.onFix(1_000L, 0.0, 0.0, false)
        parked.onFix(1_000L + STATIONARY_AFTER_MS, 0.0, 0.0, false)
        assertEquals(State.STATIONARY, parked.state)
        assertEquals(State.ACTIVE, parked.onFix(2_000L + STATIONARY_AFTER_MS, 10.0, 0.0, false))
    }

    @Test
    fun `desplazamiento sobre 150m suple velocidad nula`() {
        val machine = started()
        assertEquals(State.ACTIVE, machine.onFix(1_000L, 0.0, MOVING_DISTANCE_M, false))
    }

    @Test
    fun `STATIONARY exige 3 min de evidencia consistente`() {
        val machine = started()
        machine.onFix(0L, 0.0, 0.0, false)
        // A los 2:59 sigue en fino (seguro).
        assertEquals(State.ACTIVE, machine.onFix(STATIONARY_AFTER_MS - 1_000L, 0.0, 0.0, false))
        assertTrue(machine.wantsFineCadence())
        // A los 3:00 recién puede ser STATIONARY.
        assertEquals(State.STATIONARY, machine.onFix(STATIONARY_AFTER_MS, 0.0, 0.0, false))
        assertFalse(machine.wantsFineCadence())
    }

    @Test
    fun `UNKNOWN del sensor no estaciona solo y un fix aislado queda en ACTIVE`() {
        val machine = started()
        // Un fix quieto sin datos del IMU: no hay evidencia consistente, fino.
        assertEquals(State.ACTIVE, machine.onFix(60_000L, 0.0, 0.0, null))
        // El pulso UNKNOWN del IMU entre fixes tampoco cambia nada solo.
        assertEquals(State.ACTIVE, machine.onImuHint(90_000L, null))
    }

    @Test
    fun `el IMU solo no lleva a STATIONARY si el GPS dice que hay desplazamiento`() {
        val machine = started()
        machine.onFix(0L, 0.0, 0.0, null)
        // Desplazamiento real con IMU quieto: el GPS manda, no estaciona.
        assertEquals(State.ACTIVE, machine.onFix(60_000L, 0.0, MOVING_DISTANCE_M, false))
    }

    @Test
    fun `sin fix nuevo no se degrada a lento y a los 4 min entra RECOVERING`() {
        val machine = started()
        machine.onFix(0L, 5.0, 0.0, true)
        assertEquals(State.ACTIVE, machine.onTick(NO_FIX_RECOVER_MS - 1_000L))
        assertEquals(State.RECOVERING, machine.onTick(NO_FIX_RECOVER_MS))
        assertTrue(machine.wantsFineCadence())
    }

    @Test
    fun `RECOVERING vuelve a ACTIVE con fix fresco y cola fluyendo`() {
        val machine = started()
        machine.onFix(0L, 5.0, 0.0, true)
        machine.onTick(NO_FIX_RECOVER_MS)
        assertEquals(State.RECOVERING, machine.state)
        // Cola trabada: sigue en rescate (no se finge normalidad).
        assertEquals(State.RECOVERING, machine.onRecovered(NO_FIX_RECOVER_MS + 1_000L, queueFlowing = false))
        assertEquals(State.ACTIVE, machine.onRecovered(NO_FIX_RECOVER_MS + 1_000L, queueFlowing = true))
    }

    @Test
    fun `significant motion arranca a ACTIVE`() {
        val machine = started()
        machine.onFix(0L, 0.0, 0.0, false)
        assertEquals(State.ACTIVE, machine.onSignificantMotion(1_000L))
    }

    @Test
    fun `sin GPS se entra en DEGRADED con cadencia fina`() {
        val machine = started()
        machine.onFix(0L, 5.0, 0.0, true)
        assertEquals(State.DEGRADED, machine.onPositionUnavailable())
        assertTrue(machine.wantsFineCadence())
    }

    @Test
    fun `fin de jornada lleva a STOPPED y congela entradas`() {
        val machine = started()
        machine.onFix(0L, 5.0, 0.0, true)
        assertEquals(State.STOPPED, machine.onJourneyStopped())
        assertEquals(State.STOPPED, machine.onFix(1_000L, 20.0, 500.0, true))
        assertFalse(machine.wantsFineCadence())
    }

    @Test
    fun `reconstruccion sin historial arranca en ACTIVE seguro`() {
        val machine = MovementStateMachine()
        assertEquals(State.ACTIVE, machine.restore(1_000_000L, journeyOpen = true, history = emptyList()))
    }

    @Test
    fun `reconstruccion sin jornada queda en STOPPED`() {
        val machine = MovementStateMachine()
        assertEquals(State.STOPPED, machine.restore(1_000_000L, journeyOpen = false, history = emptyList()))
    }

    @Test
    fun `reconstruccion con historial en movimiento sigue en ACTIVE`() {
        val machine = MovementStateMachine()
        val now = 1_000_000L
        val history = listOf(
            MovementStateMachine.FixSample(now - 60_000L, 8.0, 200.0),
            MovementStateMachine.FixSample(now - 30_000L, 9.0, 220.0),
        )
        assertEquals(State.ACTIVE, machine.restore(now, journeyOpen = true, history = history))
    }

    @Test
    fun `reconstruccion con historial quieto largo entra en STATIONARY`() {
        val machine = MovementStateMachine()
        val now = 5 * 60_000L
        val history = listOf(
            MovementStateMachine.FixSample(0L, 0.0, 2.0),
            MovementStateMachine.FixSample(60_000L, 0.0, 1.0),
            MovementStateMachine.FixSample(120_000L, 0.0, 3.0),
        )
        assertEquals(State.STATIONARY, machine.restore(now, journeyOpen = true, history = history))
    }

    @Test
    fun `reconstruccion con historial viejo pide rescate`() {
        val machine = MovementStateMachine()
        val now = 60 * 60_000L
        val history = listOf(MovementStateMachine.FixSample(0L, 0.0, 0.0))
        assertEquals(State.RECOVERING, machine.restore(now, journeyOpen = true, history = history))
    }

    @Test
    fun `jornada abierta con el servicio ya vivo saca a la maquina de STOPPED`() {
        // Servicio arrancado al abrir la app (jornada cerrada) y
        // luego "Iniciar jornada". Antes quedaba STOPPED todo el día.
        val machine = MovementStateMachine()
        assertEquals(State.STOPPED, machine.restore(0L, journeyOpen = false, history = emptyList()))
        assertEquals(State.STOPPED, machine.onFixWithPosition(1_000L, 20.0, 300.0, -2.2, -79.9, true))
        assertTrue(machine.syncJourney(2_000L, journeyOpen = true))
        assertEquals(State.ACTIVE, machine.onFixWithPosition(3_000L, 20.0, 300.0, -2.2, -79.9, true))
        assertTrue(machine.wantsFineCadence())
        assertFalse(machine.syncJourney(4_000L, journeyOpen = true))
    }

    @Test
    fun `cerrar la jornada vuelve a STOPPED`() {
        val machine = started()
        machine.onFix(1_000L, 10.0, 0.0, null)
        assertTrue(machine.syncJourney(2_000L, journeyOpen = false))
        assertEquals(State.STOPPED, machine.state)
    }
}
