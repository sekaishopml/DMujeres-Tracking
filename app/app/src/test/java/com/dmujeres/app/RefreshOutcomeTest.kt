package com.dmujeres.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Casos de vida real del resumen final del refresco manual. */
class RefreshOutcomeTest {

    @Test
    fun `todo bien termina en todo listo`() {
        val summary = RefreshOutcome().summary()
        assertEquals(RefreshSummary.ALL_GOOD, summary)
        assertEquals(R.string.refresh_step_done, summary.textRes)
        assertTrue(summary.allGood)
    }

    @Test
    fun `sin datos moviles avisa de la conexion`() {
        val summary = RefreshOutcome(online = false, serverOk = false).summary()
        assertEquals(RefreshSummary.NO_NETWORK, summary)
        assertEquals(R.string.refresh_summary_no_net, summary.textRes)
        assertFalse(summary.allGood)
    }

    @Test
    fun `con red pero servidor caido se reintentara`() {
        val summary = RefreshOutcome(serverOk = false).summary()
        assertEquals(RefreshSummary.SERVER_DOWN, summary)
        assertEquals(R.string.refresh_summary_server_off, summary.textRes)
        assertFalse(summary.allGood)
    }

    @Test
    fun `gps apagado pide activarlo`() {
        val summary = RefreshOutcome(gpsOn = false).summary()
        assertEquals(RefreshSummary.GPS_OFF, summary)
        assertEquals(R.string.refresh_summary_gps_off, summary.textRes)
        assertFalse(summary.allGood)
    }

    @Test
    fun `firebase sin token es solo un aviso`() {
        val summary = RefreshOutcome(firebase = FirebaseState.FAIL).summary()
        assertEquals(RefreshSummary.ALL_GOOD_WARNINGS, summary)
        assertEquals(R.string.refresh_summary_all_good_warnings, summary.textRes)
        assertTrue(summary.allGood)
    }

    @Test
    fun `firebase no disponible en la version no es fallo`() {
        val summary = RefreshOutcome(firebase = FirebaseState.NA).summary()
        assertEquals(RefreshSummary.ALL_GOOD, summary)
        assertTrue(summary.allGood)
    }

    @Test
    fun `pendientes que quedan en el buffer se reintentaran`() {
        val summary = RefreshOutcome(pendingBefore = 5, pendingAfter = 1).summary()
        assertEquals(RefreshSummary.PENDING_UNSENT, summary)
        assertEquals(R.string.refresh_summary_pending, summary.textRes)
        assertFalse(summary.allGood)
    }

    @Test
    fun `pendientes enviados no ensucian el resumen`() {
        val outcome = RefreshOutcome(pendingBefore = 4, pendingAfter = 0)
        assertEquals(4, outcome.sent)
        assertEquals(RefreshSummary.ALL_GOOD, outcome.summary())
    }

    @Test
    fun `los enviados nunca son negativos`() {
        val outcome = RefreshOutcome(pendingBefore = 0, pendingAfter = 2)
        assertEquals(0, outcome.sent)
        assertEquals(RefreshSummary.PENDING_UNSENT, outcome.summary())
    }

    @Test
    fun `config sin consultar es solo un aviso`() {
        val summary = RefreshOutcome(config = ConfigState.NA).summary()
        assertEquals(RefreshSummary.ALL_GOOD_CONFIG, summary)
        assertEquals(R.string.refresh_summary_all_good_config, summary.textRes)
        assertTrue(summary.allGood)
    }

    @Test
    fun `config actualizada no ensucia el resumen`() {
        assertEquals(RefreshSummary.ALL_GOOD, RefreshOutcome(config = ConfigState.UPDATED).summary())
    }

    @Test
    fun `jornada cerrada manda sobre todos los fallos`() {
        val summary = RefreshOutcome(
            journeyOpen = false,
            pendingAfter = 3,
            gpsOn = false,
            online = false,
            serverOk = false,
            firebase = FirebaseState.FAIL,
            config = ConfigState.NA,
        ).summary()
        assertEquals(RefreshSummary.JOURNEY_CLOSED, summary)
        assertEquals(R.string.refresh_summary_journey_closed, summary.textRes)
        assertFalse(summary.allGood)
    }

    @Test
    fun `sin red manda sobre servidor y gps`() {
        val summary = RefreshOutcome(online = false, serverOk = false, gpsOn = false).summary()
        assertEquals(RefreshSummary.NO_NETWORK, summary)
    }

    @Test
    fun `servidor manda sobre gps y pendientes`() {
        val summary = RefreshOutcome(serverOk = false, gpsOn = false, pendingAfter = 2).summary()
        assertEquals(RefreshSummary.SERVER_DOWN, summary)
    }

    @Test
    fun `gps manda sobre pendientes y avisos`() {
        val summary = RefreshOutcome(
            gpsOn = false,
            pendingAfter = 2,
            firebase = FirebaseState.FAIL,
            config = ConfigState.NA,
        ).summary()
        assertEquals(RefreshSummary.GPS_OFF, summary)
    }

    @Test
    fun `pendientes mandan sobre avisos y config`() {
        val summary = RefreshOutcome(
            pendingAfter = 2,
            firebase = FirebaseState.FAIL,
            config = ConfigState.NA,
        ).summary()
        assertEquals(RefreshSummary.PENDING_UNSENT, summary)
    }

    @Test
    fun `avisos mandan sobre config sin revisar`() {
        val summary = RefreshOutcome(firebase = FirebaseState.FAIL, config = ConfigState.NA).summary()
        assertEquals(RefreshSummary.ALL_GOOD_WARNINGS, summary)
    }
}
