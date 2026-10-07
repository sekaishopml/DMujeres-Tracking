package com.dmujeres.app.jornada

import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import com.dmujeres.app.datos.DatabaseHelper

/**
 * Jornada local persistida (Robolectric: prefs + SQLite reales).
 *
 * - Sin marca de apertura no se asume abierta (jornada fantasma con id viejo).
 * - Cerrar persiste cerrado en ambos lados y reconcilia sin duplicar.
 */
@Config(application = com.dmujeres.app.sistema.MainApplication::class,
    sdk = [Build.VERSION_CODES.P])
@RunWith(RobolectricTestRunner::class)
class JourneyLocalTest {

    @Test
    fun `meta sin marca de apertura no es jornada abierta`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = DatabaseHelper(context)
        db.putMeta(DatabaseHelper.KEY_JOURNEY_ID, "123")
        db.putMeta(DatabaseHelper.KEY_JOURNEY_STARTED_AT, "1000")
        // Sin escribir journey_open (corte a medias o meta heredada).
        val local = JourneyManager(context).local()
        assertEquals("123", local?.journeyId)
        assertFalse("sin marca no se asume abierta", local?.open == true)
    }

    @Test
    fun `persistir abierta y cerrada se refleja en meta y prefs`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val manager = JourneyManager(context)
        manager.persistLocal("7", 7000L, open = true)
        assertTrue(manager.local()?.open == true)
        manager.persistLocal("7", 7000L, open = false)
        val closed = manager.local()
        assertFalse(closed?.open == true)
        // Cerrada en local + abierta en servidor = se adopta (sin duplicar).
        assertEquals(
            JourneyManager.ReconcileOutcome.ADOPTED_REMOTE,
            JourneyManager.decide(closed, JourneyManager.RemoteJourney(true, "9", 9000L)),
        )
    }

    @Test
    fun `sin nada guardado no hay jornada local`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertNull(JourneyManager(context).local())
    }
}
