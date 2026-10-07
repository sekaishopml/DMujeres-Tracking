package com.dmujeres.app.seguimiento

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionSignalTest {

    @Test
    fun `velocidad del GPS en marcha fuerza movimiento`() {
        assertTrue(MotionSignal.shouldMove(20.0, 0.0))
    }

    @Test
    fun `velocidad implicita entre fixes tambien fuerza movimiento`() {
        // 200 m en 120 s ≈ 3,2 nudos: el sensor puede no notarlo pero se mueve.
        assertTrue(MotionSignal.shouldMove(0.0, 3.2))
    }

    @Test
    fun `quieto real no fuerza movimiento`() {
        assertFalse(MotionSignal.shouldMove(0.0, 0.0))
        assertFalse(MotionSignal.shouldMove(1.5, 1.0))
    }

    @Test
    fun `el umbral exacto cuenta como movimiento`() {
        assertTrue(MotionSignal.shouldMove(MotionSignal.MOVING_SPEED_KN, 0.0))
    }
}
