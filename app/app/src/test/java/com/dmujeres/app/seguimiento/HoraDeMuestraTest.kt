package com.dmujeres.app.seguimiento

import org.junit.Assert.assertEquals
import org.junit.Test

class HoraDeMuestraTest {
    @Test
    fun `muestra que llega en tanda conserva su hora real`() {
        assertEquals(1_000_000L - 4_000, MotionMonitor.horaDeMuestra(1_000_000L, 50_000_000_000L, 46_000_000_000L))
    }

    @Test
    fun `hora del sensor no creible usa la de llegada`() {
        assertEquals(1_000_000L, MotionMonitor.horaDeMuestra(1_000_000L, 50_000_000_000L, 51_000_000_000L))
        assertEquals(1_000_000L, MotionMonitor.horaDeMuestra(1_000_000L, 500_000_000_000L, 1_000L))
    }
}
