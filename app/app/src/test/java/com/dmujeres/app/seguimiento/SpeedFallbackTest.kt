package com.dmujeres.app.seguimiento

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpeedFallbackTest {
    @Test
    fun caminata_con_velocidad_cero_se_calcula() {
        // 35 m en 11 s caminando con el teléfono diciendo 0.
        assertEquals(35.0 / 11.0, SpeedFallback.impliedSpeedMps(35.0, 11.0, 15.0)!!, 1e-9)
    }

    @Test
    fun deriva_menor_que_la_precision_no_es_movimiento() {
        assertNull(SpeedFallback.impliedSpeedMps(12.0, 10.0, 20.0))
    }

    @Test
    fun salto_imposible_se_descarta() {
        assertNull(SpeedFallback.impliedSpeedMps(3_000.0, 10.0, 10.0))
    }

    @Test
    fun intervalo_largo_no_calcula() {
        assertNull(SpeedFallback.impliedSpeedMps(500.0, 600.0, 10.0))
    }
}
