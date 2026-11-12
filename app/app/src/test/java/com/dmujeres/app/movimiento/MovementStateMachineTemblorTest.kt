package com.dmujeres.app.movimiento

import com.dmujeres.app.movimiento.MovementStateMachine.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Temblor del GPS bajo techo (caso real: Sonnia, ZTE de prueba): el punto
 * salta 20-60 m alrededor del sitio con velocidad de 5-46 km/h sin salir de
 * él. Antes cada salto reiniciaba la espera de quietud y nunca quedaba quieta.
 */
class MovementStateMachineTemblorTest {

    private val lat0 = -2.1113
    private val lon0 = -79.9919
    private val gradoM = 111_320.0

    private fun arrancar(machine: MovementStateMachine) {
        machine.onJourneyStarted(0L)
        machine.onFixWithPosition(0L, 0.0, 0.0, lat0, lon0, false, accuracyM = 10.0)
    }

    @Test
    fun `con saltos de 40-60 m y velocidad en el mismo sitio queda quieta a los 3 min`() {
        val machine = MovementStateMachine()
        arrancar(machine)
        // Un punto cada 5 s durante 4 min, alternando a un lado y al otro.
        for (i in 1..48) {
            val salto = (if (i % 2 == 0) 1 else -1) * (40.0 + (i % 3) * 10.0)
            machine.onFixWithPosition(
                i * 5_000L, 10.0, 50.0, lat0 + salto / gradoM, lon0, false, accuracyM = 15.0,
            )
        }
        assertEquals(State.STATIONARY, machine.state)
    }

    @Test
    fun `al salir en carro se detecta antes de los 50 m`() {
        val machine = MovementStateMachine()
        arrancar(machine)
        for (i in 1..40) machine.onFixWithPosition(i * 5_000L, 0.0, 0.0, lat0, lon0, false, accuracyM = 5.0)
        assertEquals(State.STATIONARY, machine.state)
        // 30 km/h = 8,3 m/s = 16 kn, un punto por segundo.
        var recorrido = 0.0
        var t = 200_000L
        while (machine.state == State.STATIONARY && recorrido < 500) {
            t += 1_000L
            recorrido += 8.3
            machine.onFixWithPosition(t, 16.0, 8.3, lat0 + recorrido / gradoM, lon0, false, accuracyM = 5.0)
        }
        assertEquals(State.ACTIVE, machine.state)
        assertTrue("detectó a $recorrido m", recorrido < 50)
    }

    @Test
    fun `sin velocidad, dos puntos seguidos a mas de 80 m son salida`() {
        val machine = MovementStateMachine()
        arrancar(machine)
        for (i in 1..40) machine.onFixWithPosition(i * 5_000L, 0.0, 0.0, lat0, lon0, false, accuracyM = 5.0)
        // Un salto suelto de 85 m no basta; dos puntos seguidos alejándose sí.
        machine.onFixWithPosition(205_000L, 0.0, 85.0, lat0 + 85.0 / gradoM, lon0, false, accuracyM = 5.0)
        assertEquals(State.STATIONARY, machine.state)
        machine.onFixWithPosition(210_000L, 0.0, 10.0, lat0 + 95.0 / gradoM, lon0, false, accuracyM = 5.0)
        assertEquals(State.ACTIVE, machine.state)
    }

    @Test
    fun `quieta, lecturas de wifi y antenas lejos del sitio no son salida`() {
        val machine = MovementStateMachine()
        arrancar(machine)
        for (i in 1..40) machine.onFixWithPosition(i * 5_000L, 0.0, 0.0, lat0, lon0, false, accuracyM = 5.0)
        // Con el GPS apagado la lectura cae a 90-300 m y se queda ahí.
        for (i in 1..30) {
            machine.onFixWithPosition(
                200_000L + i * 10_000L, 0.0, 10.0, lat0 + (90.0 + i * 7) / gradoM, lon0, false, accuracyM = 100.0, gpsApagadoEnQuieta = true,
            )
        }
        assertEquals(State.STATIONARY, machine.state)
        // Dos lecturas precisas lejos del sitio sí son salida.
        machine.onFixWithPosition(510_000L, 0.0, 0.0, lat0 + 120.0 / gradoM, lon0, false, accuracyM = 10.0, gpsApagadoEnQuieta = true)
        machine.onFixWithPosition(520_000L, 0.0, 10.0, lat0 + 130.0 / gradoM, lon0, false, accuracyM = 10.0, gpsApagadoEnQuieta = true)
        assertEquals(State.ACTIVE, machine.state)
    }
}
