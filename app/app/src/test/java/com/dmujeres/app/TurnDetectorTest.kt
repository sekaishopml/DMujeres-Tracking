package com.dmujeres.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnDetectorTest {

    private val detector = TurnDetector()

    @Test
    fun `giro sostenido a velocidad dispara una sola vez`() {
        assertFalse(detector.onSample(30.0, 5.0, 0))
        assertFalse(detector.onSample(32.0, 5.0, 200))
        assertTrue(detector.onSample(35.0, 5.0, 350))
        // Sigue girando: no vuelve a disparar mientras no baje del umbral.
        assertFalse(detector.onSample(35.0, 5.0, 400))
        assertFalse(detector.onSample(35.0, 5.0, 1_000))
    }

    @Test
    fun `tambien dispara girando al otro lado`() {
        assertFalse(detector.onSample(-30.0, 5.0, 0))
        assertTrue(detector.onSample(-30.0, 5.0, 350))
    }

    @Test
    fun `pico de una sola muestra no dispara`() {
        assertFalse(detector.onSample(40.0, 5.0, 0))
        assertFalse(detector.onSample(0.0, 5.0, 150))
        assertFalse(detector.onSample(40.0, 5.0, 300))
        assertFalse(detector.onSample(0.0, 5.0, 450))
    }

    @Test
    fun `sin velocidad suficiente no dispara`() {
        assertFalse(detector.onSample(40.0, 2.0, 0))
        assertFalse(detector.onSample(40.0, 2.0, 500))
        assertFalse(detector.onSample(40.0, 2.0, 1_000))
    }

    @Test
    fun `tras el enfriamiento un giro nuevo vuelve a disparar`() {
        assertFalse(detector.onSample(30.0, 5.0, 0))
        assertTrue(detector.onSample(30.0, 5.0, 350))
        // Baja del umbral antes del enfriamiento: no se re-arma todavía.
        assertFalse(detector.onSample(0.0, 5.0, 500))
        assertFalse(detector.onSample(30.0, 5.0, 1_000))
        assertFalse(detector.onSample(30.0, 5.0, 1_200))
        // Pasado el enfriamiento (2 s) se re-arma y vuelve a sostener la ventana.
        assertFalse(detector.onSample(30.0, 5.0, 2_500))
        assertTrue(detector.onSample(30.0, 5.0, 2_900))
    }

    @Test
    fun `reset vuelve a armar el detector`() {
        assertFalse(detector.onSample(30.0, 5.0, 0))
        assertTrue(detector.onSample(30.0, 5.0, 350))
        detector.reset()
        assertFalse(detector.onSample(30.0, 5.0, 400))
        assertTrue(detector.onSample(30.0, 5.0, 750))
    }
}
