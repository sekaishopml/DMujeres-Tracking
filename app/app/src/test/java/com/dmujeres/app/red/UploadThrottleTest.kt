package com.dmujeres.app.red

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadThrottleTest {
    @Test
    fun con_bateria_normal_sube_siempre() {
        assertTrue(UploadThrottle.shouldKick(10_000, 9_000, batteryPct = 60.0, charging = false))
    }

    @Test
    fun con_bateria_baja_sube_a_lo_sumo_cada_minuto() {
        assertFalse(UploadThrottle.shouldKick(30_000, 1_000, batteryPct = 10.0, charging = false))
        assertTrue(UploadThrottle.shouldKick(61_001, 1_000, batteryPct = 10.0, charging = false))
    }

    @Test
    fun cargando_no_se_limita() {
        assertTrue(UploadThrottle.shouldKick(2_000, 1_000, batteryPct = 5.0, charging = true))
    }

    @Test
    fun primera_subida_siempre() {
        assertTrue(UploadThrottle.shouldKick(2_000, 0, batteryPct = 5.0, charging = false))
    }
}
