package com.dmujeres.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import com.dmujeres.app.SessionClosePlan.BatchOutcome
import com.dmujeres.app.SessionClosePlan.JourneyOutcome
import com.dmujeres.app.SessionClosePlan.SendResult
import com.dmujeres.app.journey.JourneyManager
import java.util.ArrayDeque

/**
 * Cierre limpio de sesión, puro JVM (sin Android ni red).
 *
 * - Orden flush → fin → limpieza.
 * - Flush parcial conserva el resto (nunca se borra lo no enviado).
 * - 401 a mitad no pierde datos y sigue al fin con lo que quede.
 * - Entrar con otro usuario no arrastra el anterior.
 * - Tras el cierre la jornada se reconcilia con el servidor.
 */
class SessionCloseTest {

    /** Doble falsificado del entorno Android (cola, jornada, sesión, reloj). */
    private class Fake(
        var pending: Int,
        script: List<SendResult> = emptyList(),
        var journey: JourneyOutcome = JourneyOutcome.CLOSED,
        var failClear: Boolean = false,
        var stepMs: Long = 0L,
    ) : SessionClosePlan.Driver {
        val calls = mutableListOf<String>()
        val queue = ArrayDeque(script)
        var cleared = false
        var fakeNow = 0L
        var confirmedSeen = 0

        override fun pendingCount(): Int {
            calls.add("pending")
            return pending
        }

        override fun sendBatch(maxBatch: Int): SendResult {
            calls.add("send")
            fakeNow += stepMs
            val result = if (queue.isEmpty()) SendResult(0, BatchOutcome.EMPTY) else queue.removeFirst()
            // Solo lo confirmado sale de la cola: el resto queda intacto.
            if (result.outcome == BatchOutcome.SENT) {
                pending = (pending - result.confirmed).coerceAtLeast(0)
                confirmedSeen += result.confirmed
            }
            return result
        }

        override fun endJourney(): JourneyOutcome {
            calls.add("end")
            return journey
        }

        override fun clearSession() {
            calls.add("clear")
            if (failClear) throw RuntimeException("prefs rotas")
            cleared = true
        }

        override fun nowMs(): Long = fakeNow
    }

    @Test
    fun `orden flush fin limpieza`() {
        val fake = Fake(
            pending = 120,
            script = listOf(
                SendResult(50, BatchOutcome.SENT),
                SendResult(50, BatchOutcome.SENT),
                SendResult(20, BatchOutcome.SENT),
            ),
        )
        val report = SessionClosePlan.run(fake)
        assertEquals(120, report.sent)
        assertEquals(0, report.remaining)
        assertTrue(fake.cleared)
        assertTrue(report.sessionCleared)
        assertTrue(report.isComplete())
        val firstSend = fake.calls.indexOf("send")
        val end = fake.calls.indexOf("end")
        val clear = fake.calls.indexOf("clear")
        assertTrue("flush antes que fin", firstSend >= 0 && firstSend < end)
        assertTrue("fin antes que limpieza", end < clear)
        assertEquals("clear una sola vez al final", 1, fake.calls.count { it == "clear" })
        assertEquals("end una sola vez", 1, fake.calls.count { it == "end" })
    }

    @Test
    fun `flush parcial conserva el resto y avisa`() {
        val fake = Fake(
            pending = 100,
            script = listOf(
                SendResult(50, BatchOutcome.SENT),
                SendResult(0, BatchOutcome.RETRY_LATER),
            ),
            journey = JourneyOutcome.CLOSED,
        )
        val report = SessionClosePlan.run(fake)
        // Lo confirmado salió, lo demás sigue guardado para el próximo drenado.
        assertEquals(50, report.sent)
        assertEquals(50, report.remaining)
        assertEquals(50, fake.pending)
        // Aun con resto, el fin se intentó y la sesión se limpió con aviso.
        assertTrue(fake.calls.contains("end"))
        assertTrue(report.sessionCleared)
        assertFalse("no es completo: quedan 50", report.isComplete())
    }

    @Test
    fun `401 a mitad no pierde datos y sigue al fin`() {
        val fake = Fake(
            pending = 100,
            script = listOf(
                SendResult(60, BatchOutcome.SENT),
                SendResult(0, BatchOutcome.AUTH_PAUSED),
                // Tras el 401 no debe pedirse otro lote.
                SendResult(40, BatchOutcome.SENT),
            ),
            journey = JourneyOutcome.AUTH_FAILED,
        )
        val report = SessionClosePlan.run(fake)
        assertEquals(60, report.sent)
        assertEquals(40, report.remaining)
        assertEquals(40, fake.pending)
        assertEquals("un solo intento tras el 401: se para", 2, fake.calls.count { it == "send" })
        assertTrue(report.authFailed)
        assertTrue("el fin se intenta igual", fake.calls.contains("end"))
        assertTrue("la sesión se limpia igual", report.sessionCleared)
        assertFalse(report.isComplete())
    }

    @Test
    fun `sin red no se borra nada y la sesion se limpia con aviso`() {
        val fake = Fake(
            pending = 30,
            script = listOf(SendResult(0, BatchOutcome.RETRY_LATER)),
            journey = JourneyOutcome.OFFLINE,
        )
        val report = SessionClosePlan.run(fake)
        assertEquals(0, report.sent)
        assertEquals(30, report.remaining)
        assertEquals(30, fake.pending)
        assertTrue(report.sessionCleared)
        assertFalse(report.isComplete())
    }

    @Test
    fun `el tope detiene el flush pero igual cierra jornada y sesion`() {
        val script = List(100) { SendResult(50, BatchOutcome.SENT) }
        val fake = Fake(pending = 5_000, script = script, stepMs = 10L)
        val report = SessionClosePlan.run(fake, timeoutMs = 25L)
        assertTrue("el tope cortó con resto", report.remaining > 0)
        assertTrue(fake.calls.contains("end"))
        assertTrue(report.sessionCleared)
        assertFalse(report.isComplete())
    }

    @Test
    fun `si la limpieza falla la sesion sigue intacta`() {
        val fake = Fake(pending = 0, failClear = true)
        val report = SessionClosePlan.run(fake)
        assertFalse(report.sessionCleared)
        assertFalse(fake.cleared)
        assertFalse(report.isComplete())
    }

    @Test
    fun `entrar con otro usuario no arrastra el anterior`() {
        val first = SessionStore.State().saved("token-1", "ana", "Ana", 100L)
        val second = first.saved("token-2", "luis", "Luis", 200L)
        assertEquals("token-2", second.token)
        assertEquals("luis", second.user)
        assertEquals("Luis", second.displayName)
        assertEquals(200L, second.expiresAtMs)
        assertTrue(second.hasSession())
    }

    @Test
    fun `mismo usuario no repite el cierre y otro usuario si lo exige`() {
        // Mismo usuario (normalizado): la ruta en curso sigue, sin cierre.
        assertFalse(SessionClosePlan.requiresCleanCloseBeforeLogin(true, "ana", "Ana"))
        // Otro usuario: cierre limpio con el equipo anterior antes del login.
        assertTrue(SessionClosePlan.requiresCleanCloseBeforeLogin(true, "ana", "luis"))
        // Sin sesión guardada no hay nada que cerrar.
        assertFalse(SessionClosePlan.requiresCleanCloseBeforeLogin(false, "", "ana"))
        // Sesión sin usuario legible: se cierra por precaución (es "otro").
        assertTrue(SessionClosePlan.requiresCleanCloseBeforeLogin(true, "", "ana"))
    }

    @Test
    fun `nuevo login tras 401 tampoco arrastra sesion vencida`() {
        val expired = SessionStore.State()
            .saved("viejo", "ana", "Ana", 100L)
            .clearedOnUnauthorized()
        assertTrue(expired.authFailed)
        val fresh = expired.saved("nuevo", "luis", "Luis", 200L)
        assertEquals("luis", fresh.user)
        assertEquals("", expired.token.ifBlank { "" })
        assertFalse("el login nuevo baja la marca de pedir login", fresh.authFailed)
        assertTrue(fresh.hasSession())
    }

    @Test
    fun `tras el cierre la jornada se reconcilia con el servidor`() {
        // Cierre limpio = nada abierto en local: si el equipo sigue abierto,
        // se continúa; si está cerrada, en sincronía (nunca dos abiertas).
        assertEquals(
            JourneyManager.ReconcileOutcome.ADOPTED_REMOTE,
            JourneyManager.decide(null, JourneyManager.RemoteJourney(true, "9", 900L)),
        )
        assertEquals(
            JourneyManager.ReconcileOutcome.IN_SYNC,
            JourneyManager.decide(null, JourneyManager.RemoteJourney(false, "", 0L)),
        )
        // Por eso el cierre siempre deja lo local cerrado: una local abierta
        // nunca se pisa (el servidor reconcilia cada hora).
        val localOpen = JourneyManager.LocalJourney("1", 100L, true)
        assertEquals(
            JourneyManager.ReconcileOutcome.KEPT_LOCAL,
            JourneyManager.decide(localOpen, JourneyManager.RemoteJourney(true, "2", 200L)),
        )
    }
}
