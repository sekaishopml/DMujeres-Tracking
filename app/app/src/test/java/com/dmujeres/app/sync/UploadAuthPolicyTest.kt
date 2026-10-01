package com.dmujeres.app.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pausa/reanudación de la cola ante 401/403 y avance del cursor (JVM). */
class UploadAuthPolicyTest {

    @Test
    fun `401 con token no latchea (reintenta con la compartida)`() {
        assertFalse(UploadAuthPolicy.shouldLatchPause(401, hadToken = true))
    }

    @Test
    fun `401 sin token y 403 latchean hasta cambio de auth o refresco`() {
        assertTrue(UploadAuthPolicy.shouldLatchPause(401, hadToken = false))
        assertTrue(UploadAuthPolicy.shouldLatchPause(403, hadToken = true))
        assertTrue(UploadAuthPolicy.shouldLatchPause(403, hadToken = false))
    }

    @Test
    fun `entrar de nuevo reanuda sin refresco manual`() {
        // Pausada con el token muerto "viejo": tras el login el token es
        // "nuevo" -> la próxima patada reanuda sola.
        assertTrue(
            UploadAuthPolicy.shouldResumeAfterAuthChange(
                pausedToken = "viejo", pausedApiKey = "clave",
                currentToken = "nuevo", currentApiKey = "clave",
            ),
        )
    }

    @Test
    fun `corregir la clave compartida reanuda`() {
        assertTrue(
            UploadAuthPolicy.shouldResumeAfterAuthChange(
                pausedToken = "", pausedApiKey = "mala",
                currentToken = "", currentApiKey = "buena",
            ),
        )
    }

    @Test
    fun `sin cambio no se reanuda (no buclear el mismo 401)`() {
        assertFalse(
            UploadAuthPolicy.shouldResumeAfterAuthChange(
                pausedToken = "t", pausedApiKey = "clave",
                currentToken = "t", currentApiKey = "clave",
            ),
        )
        assertFalse(
            UploadAuthPolicy.shouldResumeAfterAuthChange(
                pausedToken = "", pausedApiKey = "clave",
                currentToken = "", currentApiKey = "clave",
            ),
        )
    }

    @Test
    fun `lote 2xx sin avance hace backoff (no reenvia en bucle)`() {
        assertEquals(
            UploadPolicy.BatchFollowUp.BACKOFF,
            UploadPolicy.followUpAfterBatch(confirmed = 0, dead = 0),
        )
        assertEquals(
            UploadPolicy.BatchFollowUp.CONTINUE,
            UploadPolicy.followUpAfterBatch(confirmed = 3, dead = 0),
        )
        assertEquals(
            UploadPolicy.BatchFollowUp.CONTINUE,
            UploadPolicy.followUpAfterBatch(confirmed = 0, dead = 2),
        )
    }

    @Test
    fun `emparejado 1-a-1 por seq en orden`() {
        val batch = listOf(11L to 1L, 22L to 2L, 33L to 3L)
        val match = UploadPolicy.matchBatchResults(
            batch,
            listOf(1L to "accepted", 2L to "duplicate", 3L to "invalid"),
        )
        assertEquals(listOf(11L, 22L), match.confirmedIds)
        assertEquals(listOf(33L), match.deadIds)
    }

    @Test
    fun `lo no mencionado no se borra y lo desconocido se reintenta`() {
        val batch = listOf(11L to 1L, 22L to 2L)
        val match = UploadPolicy.matchBatchResults(
            batch,
            listOf(1L to "accepted", 2L to "otra-cosa"),
        )
        assertEquals(listOf(11L), match.confirmedIds)
        assertTrue(match.deadIds.isEmpty())
    }

    @Test
    fun `seq duplicada consume una fila por mencion (cursor siempre avanza)`() {
        // Dos filas comparten seq por una carrera de identidad: antes la
        // primera no se confirmaba nunca (reenvío infinito del mismo lote).
        val batch = listOf(11L to 7L, 22L to 7L)
        val match = UploadPolicy.matchBatchResults(
            batch,
            listOf(7L to "accepted", 7L to "accepted"),
        )
        assertEquals(listOf(11L, 22L), match.confirmedIds)
    }

    @Test
    fun `mencion sin fila se ignora`() {
        val batch = listOf(11L to 1L)
        val match = UploadPolicy.matchBatchResults(
            batch,
            listOf(9L to "accepted", 1L to "accepted"),
        )
        assertEquals(listOf(11L), match.confirmedIds)
    }
}
