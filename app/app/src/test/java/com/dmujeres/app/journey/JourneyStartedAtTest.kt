package com.dmujeres.app.journey

import org.junit.Assert.assertEquals
import org.junit.Test
import com.dmujeres.app.journey.JourneyManager.Companion.parseStartedAt

/** La hora de inicio que manda el servidor se lee bien (JVM). */
class JourneyStartedAtTest {

    @Test
    fun `texto ISO en UTC`() {
        assertEquals(1790798614000L, parseStartedAt("2026-09-30T20:03:34.000Z"))
    }

    @Test
    fun `milisegundos como numero o como texto`() {
        assertEquals(1790798614000L, parseStartedAt(1790798614000L))
        assertEquals(1790798614000L, parseStartedAt("1790798614000"))
    }

    @Test
    fun `dato ausente o raro da cero`() {
        assertEquals(0L, parseStartedAt(null))
        assertEquals(0L, parseStartedAt("ayer"))
    }
}
