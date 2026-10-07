package com.dmujeres.app.datos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Casos de vida real del resumen del botón Actualizar. */
class RefreshOutcomeTest {

    @Test
    fun `todo bien dice que el servidor tiene la ubicacion`() {
        val summary = RefreshOutcome().summary()
        assertEquals(RefreshSummary.ALL_GOOD, summary)
        assertTrue(summary.allGood)
    }

    @Test
    fun `sin datos moviles manda sobre todo`() {
        assertEquals(RefreshSummary.NO_NETWORK, RefreshOutcome(online = false, serverOk = false, gpsOn = false).summary())
    }

    @Test
    fun `con red pero servidor caido se reintentara`() {
        assertEquals(RefreshSummary.SERVER_DOWN, RefreshOutcome(serverOk = false, gpsOn = false).summary())
    }

    @Test
    fun `gps apagado manda sobre ahorro y pendientes`() {
        assertEquals(RefreshSummary.GPS_OFF, RefreshOutcome(gpsOn = false, batterySaver = true, pendingAfter = 3).summary())
    }

    @Test
    fun `ahorro de bateria pide quitarlo`() {
        val summary = RefreshOutcome(batterySaver = true, pendingAfter = 2).summary()
        assertEquals(RefreshSummary.BATTERY_SAVER, summary)
        assertFalse(summary.allGood)
    }

    @Test
    fun `pendientes que quedan se reintentaran`() {
        assertEquals(RefreshSummary.PENDING_UNSENT, RefreshOutcome(pendingBefore = 5, pendingAfter = 2).summary())
    }

    @Test
    fun `sin jornada no exige gps ni puntos`() {
        val summary = RefreshOutcome(journeyOpen = false, gpsOn = false, pendingAfter = 0).summary()
        assertEquals(RefreshSummary.ALL_GOOD_NO_JOURNEY, summary)
        assertTrue(summary.allGood)
    }

    @Test
    fun `sin jornada y sin red igual avisa la red`() {
        assertEquals(RefreshSummary.NO_NETWORK, RefreshOutcome(journeyOpen = false, online = false).summary())
    }

    @Test
    fun `los enviados nunca son negativos`() {
        assertEquals(0, RefreshOutcome(pendingBefore = 1, pendingAfter = 4).sent)
        assertEquals(3, RefreshOutcome(pendingBefore = 5, pendingAfter = 2).sent)
    }
}
