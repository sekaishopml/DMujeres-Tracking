package com.dmujeres.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PowerEventsTest {
    @Test
    fun apagado_con_bateria_agotada() {
        assertEquals("battery", PowerEvents.causeFor(2, charging = false))
    }

    @Test
    fun apagado_manual_con_bateria() {
        assertEquals("manual", PowerEvents.causeFor(64, charging = false))
        assertEquals("manual", PowerEvents.causeFor(2, charging = true))
    }

    @Test
    fun muerte_subita_con_bateria_baja_se_infiere() {
        assertTrue(PowerEvents.inferredBatteryDeath(lastBattery = 4, lastBatteryAt = 1_000, shutdownRecordedAt = 0))
    }

    @Test
    fun no_se_infiere_si_ya_se_registro_el_apagado_o_habia_bateria() {
        assertFalse(PowerEvents.inferredBatteryDeath(4, 1_000, shutdownRecordedAt = 2_000))
        assertFalse(PowerEvents.inferredBatteryDeath(40, 1_000, 0))
    }
}
