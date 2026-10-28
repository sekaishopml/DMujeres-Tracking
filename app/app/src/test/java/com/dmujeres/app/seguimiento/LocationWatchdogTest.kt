package com.dmujeres.app.seguimiento

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationWatchdogTest {

    private val stale = 2 * 60_000L

    @Test
    fun `sin fix nuevo no hace nada`() {
        val watchdog = LocationWatchdog(stale)
        watchdog.start(0L)
        assertEquals(LocationWatchdog.Action.NONE, watchdog.tick(60_000L))
        assertEquals(LocationWatchdog.Action.NONE, watchdog.tick(stale - 1))
    }

    @Test
    fun `fix viejo re-solicita y luego rota de proveedor sin rendirse`() {
        val watchdog = LocationWatchdog(stale, maxReRequests = 1)
        watchdog.start(0L)
        assertEquals(LocationWatchdog.Action.RE_REQUEST, watchdog.tick(stale))
        assertEquals(LocationWatchdog.Action.NEXT_PROVIDER, watchdog.tick(stale * 2))
        assertEquals(LocationWatchdog.Action.NEXT_PROVIDER, watchdog.tick(stale * 3))
        assertEquals(LocationWatchdog.Action.NEXT_PROVIDER, watchdog.tick(stale * 10))
    }

    @Test
    fun `un fix nuevo reinicia el contador`() {
        val watchdog = LocationWatchdog(stale, maxReRequests = 1)
        watchdog.start(0L)
        assertEquals(LocationWatchdog.Action.RE_REQUEST, watchdog.tick(stale))
        watchdog.noteFix(stale + 1)
        assertEquals(LocationWatchdog.Action.NONE, watchdog.tick(stale + 2))
        assertEquals(LocationWatchdog.Action.RE_REQUEST, watchdog.tick(stale * 2 + 1))
    }

    @Test
    fun `isStale solo pasado el plazo`() {
        val watchdog = LocationWatchdog(stale)
        watchdog.start(0L)
        assertFalse(watchdog.isStale(stale - 1))
        assertTrue(watchdog.isStale(stale))
    }

    @Test
    fun `en movimiento sube de proveedor al minuto sin reintentar`() {
        val w = LocationWatchdog()
        w.start(0L)
        assertEquals(LocationWatchdog.Action.NONE, w.tick(59_000L, moving = true))
        assertEquals(LocationWatchdog.Action.NEXT_PROVIDER, w.tick(60_000L, moving = true))
    }
}
