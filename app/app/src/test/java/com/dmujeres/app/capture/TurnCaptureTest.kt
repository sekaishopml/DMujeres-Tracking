package com.dmujeres.app.capture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Captura en giro por rumbo GPS (JVM, sin dispositivo). */
class TurnCaptureTest {

    @Test
    fun `giro de 90 grados obliga a almacenar`() {
        assertTrue(TurnCapture.isTurn(10.0, 100.0, 8.0, Long.MAX_VALUE, true))
    }

    @Test
    fun `en el limite de 30 grados ya cuenta`() {
        assertTrue(TurnCapture.isTurn(0.0, 30.0, 5.0, Long.MAX_VALUE, true))
        assertTrue(TurnCapture.isTurn(350.0, 20.0, 5.0, Long.MAX_VALUE, true))
    }

    @Test
    fun `bajo 30 grados no es giro`() {
        assertFalse(TurnCapture.isTurn(0.0, 20.0, 8.0, Long.MAX_VALUE, true))
    }

    @Test
    fun `enfriamiento de 3 s entre extras`() {
        assertFalse(TurnCapture.isTurn(0.0, 90.0, 8.0, 2_000L, true))
        assertFalse(TurnCapture.isTurn(0.0, 90.0, 8.0, 2_999L, true))
        assertTrue(TurnCapture.isTurn(0.0, 90.0, 8.0, 3_000L, true))
    }

    @Test
    fun `quieto el rumbo no dispara aunque salte`() {
        // Parado el rumbo del GPS es ruido: sin velocidad no hay esquina.
        assertFalse(TurnCapture.isTurn(0.0, 180.0, 0.0, Long.MAX_VALUE, true))
        assertFalse(TurnCapture.isTurn(0.0, 180.0, 1.9, Long.MAX_VALUE, true))
    }

    @Test
    fun `a paso de caminata si cuenta`() {
        assertTrue(TurnCapture.isTurn(0.0, 90.0, 2.7, Long.MAX_VALUE, true))
    }

    @Test
    fun `sin referencia no hay giro`() {
        assertFalse(TurnCapture.isTurn(0.0, 90.0, 8.0, Long.MAX_VALUE, false))
    }
}
