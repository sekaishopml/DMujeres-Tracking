package com.dmujeres.app.seguimiento

import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptiveCadenceTest {

    @Test
    fun `con jornada el GPS es continuo, alta precision y sin filtro de distancia`() {
        val request = AdaptiveCadence.request(journeyOpen = true)
        assertEquals(1_000L, request.intervalMs)
        assertEquals(0f, request.minDistanceM, 0.0f)
        assertEquals(0L, request.maxUpdateDelayMs)
        assertEquals(AdaptiveCadence.Accuracy.HIGH, request.accuracy)
    }

    @Test
    fun `sin jornada el GPS descansa en red cada 120 s`() {
        val request = AdaptiveCadence.request(journeyOpen = false)
        assertEquals(120_000L, request.intervalMs)
        assertEquals(10f, request.minDistanceM, 0.0f)
        assertEquals(0L, request.maxUpdateDelayMs)
        assertEquals(AdaptiveCadence.Accuracy.BALANCED, request.accuracy)
    }

    @Test
    fun `el latido de reporte sigue al estado`() {
        assertEquals(10_000L, AdaptiveCadence.intervalMs(true))
        assertEquals(120_000L, AdaptiveCadence.intervalMs(false))
    }

    @Test
    fun `la frecuencia del panel manda en el latido en movimiento dentro de 10 a 60 s`() {
        assertEquals(30_000L, AdaptiveCadence.movingIntervalMs(30L))
        assertEquals(60_000L, AdaptiveCadence.movingIntervalMs(300L))
        assertEquals(10_000L, AdaptiveCadence.movingIntervalMs(5L))
        assertEquals(10_000L, AdaptiveCadence.movingIntervalMs(null))
    }
}
