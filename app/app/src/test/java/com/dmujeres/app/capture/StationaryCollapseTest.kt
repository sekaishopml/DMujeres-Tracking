package com.dmujeres.app.capture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colapso en parado (JVM, sin dispositivo). */
class StationaryCollapseTest {

    @Test
    fun `sin referencia siempre se almacena`() {
        assertTrue(
            StationaryCollapse.shouldStore(
                stationary = true, stillSustained = false, speedKn = 0.0,
                distFromStoredM = 0.0, msSinceStored = 0L, hasReference = false,
            ),
        )
    }

    @Test
    fun `en parado se guarda con avance real de 15 m o mas`() {
        assertTrue(
            StationaryCollapse.shouldStore(
                stationary = true, stillSustained = false, speedKn = 0.0,
                distFromStoredM = 15.0, msSinceStored = 60_000L, hasReference = true,
            ),
        )
        assertTrue(
            StationaryCollapse.shouldStore(
                stationary = true, stillSustained = false, speedKn = 0.0,
                distFromStoredM = 70.0, msSinceStored = 13_000L, hasReference = true,
            ),
        )
    }

    @Test
    fun `en parado el ruido bajo 15 m no se guarda`() {
        assertFalse(
            StationaryCollapse.shouldStore(
                stationary = true, stillSustained = false, speedKn = 0.0,
                distFromStoredM = 5.0, msSinceStored = 60_000L, hasReference = true,
            ),
        )
        assertFalse(
            StationaryCollapse.shouldStore(
                stationary = true, stillSustained = false, speedKn = 0.0,
                distFromStoredM = 14.9, msSinceStored = 299_000L, hasReference = true,
            ),
        )
    }

    @Test
    fun `latido cada 5 min aunque no haya avance`() {
        assertTrue(
            StationaryCollapse.shouldStore(
                stationary = true, stillSustained = false, speedKn = 0.0,
                distFromStoredM = 2.0, msSinceStored = 300_000L, hasReference = true,
            ),
        )
    }

    @Test
    fun `en movimiento siempre se almacena`() {
        assertTrue(
            StationaryCollapse.shouldStore(
                stationary = false, stillSustained = false, speedKn = 8.0,
                distFromStoredM = 2.0, msSinceStored = 10_000L, hasReference = true,
            ),
        )
    }

    @Test
    fun `velocidad 0 sostenida en ACTIVE tambien colapsa`() {
        // Semáforo de 2 min: la máquina aún no es STATIONARY, pero el ruido ya
        // no se guarda punto a punto.
        assertFalse(
            StationaryCollapse.shouldStore(
                stationary = false, stillSustained = true, speedKn = 0.2,
                distFromStoredM = 5.0, msSinceStored = 90_000L, hasReference = true,
            ),
        )
        // ...salvo avance real o latido.
        assertTrue(
            StationaryCollapse.shouldStore(
                stationary = false, stillSustained = true, speedKn = 0.2,
                distFromStoredM = 20.0, msSinceStored = 90_000L, hasReference = true,
            ),
        )
    }

    @Test
    fun `pico aislado de 0 en marcha no colapsa`() {
        assertTrue(
            StationaryCollapse.shouldStore(
                stationary = false, stillSustained = false, speedKn = 0.2,
                distFromStoredM = 3.0, msSinceStored = 10_000L, hasReference = true,
            ),
        )
    }
}
