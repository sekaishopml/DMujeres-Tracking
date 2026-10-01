package com.dmujeres.app.journey

import org.junit.Assert.assertEquals
import org.junit.Test
import com.dmujeres.app.journey.JourneyManager.Companion.decide
import com.dmujeres.app.journey.JourneyManager.LocalJourney
import com.dmujeres.app.journey.JourneyManager.ReconcileOutcome
import com.dmujeres.app.journey.JourneyManager.RemoteJourney

/** Unit tests puros de la decisión de reconciliación (JVM). */
class JourneyDecideTest {

    @Test
    fun `sin remoto se conserva lo local`() {
        assertEquals(
            ReconcileOutcome.FALLBACK_LOCAL,
            decide(LocalJourney("1", 100L, true), null),
        )
    }

    @Test
    fun `local abierta nunca se pisa`() {
        val local = LocalJourney("1", 100L, true)
        // Remota distinta o cerrada: se mantiene la local (el servidor reconcilia).
        assertEquals(ReconcileOutcome.KEPT_LOCAL, decide(local, RemoteJourney(true, "2", 200L)))
        assertEquals(ReconcileOutcome.KEPT_LOCAL, decide(local, RemoteJourney(false, "", 0L)))
        assertEquals(ReconcileOutcome.IN_SYNC, decide(local, RemoteJourney(true, "1", 100L)))
    }

    @Test
    fun `sin local abierta se adopta la remota abierta`() {
        assertEquals(
            ReconcileOutcome.ADOPTED_REMOTE,
            decide(null, RemoteJourney(true, "9", 900L)),
        )
        assertEquals(
            ReconcileOutcome.ADOPTED_REMOTE,
            decide(LocalJourney("1", 100L, false), RemoteJourney(true, "9", 900L)),
        )
    }

    @Test
    fun `ambas cerradas es sincronia`() {
        assertEquals(
            ReconcileOutcome.IN_SYNC,
            decide(null, RemoteJourney(false, "", 0L)),
        )
    }
}
