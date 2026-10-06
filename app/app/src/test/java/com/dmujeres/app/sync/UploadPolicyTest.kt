package com.dmujeres.app.sync

import org.junit.Assert.assertEquals
import org.junit.Test

/** Unit tests puros de la clasificación HTTP y el backoff (JVM). */
class UploadPolicyTest {

    @Test
    fun `2xx confirma`() {
        assertEquals(UploadPolicy.HttpClass.CONFIRMED, UploadPolicy.classifyHttp(200))
        assertEquals(UploadPolicy.HttpClass.CONFIRMED, UploadPolicy.classifyHttp(201))
    }

    @Test
    fun `400 404 413 y 422 son DEAD sin reintento`() {
        for (code in listOf(400, 404, 413, 422)) {
            assertEquals("código $code", UploadPolicy.HttpClass.DEAD, UploadPolicy.classifyHttp(code))
        }
    }

    @Test
    fun `401 y 403 pausan con aviso`() {
        assertEquals(UploadPolicy.HttpClass.PAUSED, UploadPolicy.classifyHttp(401))
        assertEquals(UploadPolicy.HttpClass.PAUSED, UploadPolicy.classifyHttp(403))
    }

    @Test
    fun `408 429 5xx reintentan`() {
        for (code in listOf(408, 429, 500, 502, 503)) {
            assertEquals("código $code", UploadPolicy.HttpClass.RETRY, UploadPolicy.classifyHttp(code))
        }
    }

    @Test
    fun `backoff exponencial con tope de 5 min`() {
        // jitter 0.5 = sin desvío: valores exactos base×2^fallos.
        assertEquals(5_000L, UploadPolicy.backoffMs(0, 0.5))
        assertEquals(10_000L, UploadPolicy.backoffMs(1, 0.5))
        assertEquals(20_000L, UploadPolicy.backoffMs(2, 0.5))
        // Tope 5 min con jitter ±20 %: entre 240 s y 360 s.
        assertEquals(240_000L, UploadPolicy.backoffMs(30, 0.0))
        assertEquals(360_000L, UploadPolicy.backoffMs(30, 1.0))
    }

    @Test
    fun `resultado por evento accepted duplicate invalid dead`() {
        assertEquals(UploadPolicy.EventResult.CONFIRMED, UploadPolicy.classifyEvent("accepted"))
        assertEquals(UploadPolicy.EventResult.CONFIRMED, UploadPolicy.classifyEvent("duplicate"))
        assertEquals(UploadPolicy.EventResult.DEAD, UploadPolicy.classifyEvent("invalid"))
        assertEquals(UploadPolicy.EventResult.DEAD, UploadPolicy.classifyEvent("dead"))
        assertEquals(UploadPolicy.EventResult.UNKNOWN, UploadPolicy.classifyEvent("otra-cosa"))
    }

    @Test
    fun `un paso de cola con mas de 2 min ocupado se da por colgado`() {
        assertEquals(false, UploadPolicy.isBusyStuck(0L, 500_000L))
        assertEquals(false, UploadPolicy.isBusyStuck(100_000L, 100_000L + 119_999L))
        assertEquals(true, UploadPolicy.isBusyStuck(100_000L, 100_000L + 120_000L))
    }
}
