package com.dmujeres.app.seguimiento

import org.junit.Assert.assertEquals
import org.junit.Test

class LocationWatchdogTest {

    private val stale = 4 * 60_000L

    @Test
    fun `sin fix nuevo no hace nada`() {
        val watchdog = LocationWatchdog(stale)
        watchdog.start(0L)
        assertEquals(LocationWatchdog.Action.NONE, watchdog.tick(60_000L))
        assertEquals(LocationWatchdog.Action.NONE, watchdog.tick(stale - 1))
    }

    @Test
    fun `fix viejo re-solicita y luego cae al gps del sistema`() {
        val watchdog = LocationWatchdog(stale, maxReRequests = 2)
        watchdog.start(0L)
        assertEquals(LocationWatchdog.Action.RE_REQUEST, watchdog.tick(stale))
        assertEquals(LocationWatchdog.Action.RE_REQUEST, watchdog.tick(stale * 2))
        assertEquals(LocationWatchdog.Action.FALLBACK, watchdog.tick(stale * 3))
        assertEquals(LocationWatchdog.Action.FALLBACK, watchdog.tick(stale * 4))
    }

    @Test
    fun `un fix nuevo reinicia el contador`() {
        val watchdog = LocationWatchdog(stale, maxReRequests = 2)
        watchdog.start(0L)
        assertEquals(LocationWatchdog.Action.RE_REQUEST, watchdog.tick(stale))
        watchdog.noteFix(stale + 1)
        assertEquals(LocationWatchdog.Action.NONE, watchdog.tick(stale + 2))
        assertEquals(LocationWatchdog.Action.RE_REQUEST, watchdog.tick(stale * 2 + 1))
    }
}
