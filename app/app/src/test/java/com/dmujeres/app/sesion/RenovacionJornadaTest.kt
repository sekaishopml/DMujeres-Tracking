package com.dmujeres.app.sesion

import com.dmujeres.app.red.DmujeresApi
import org.junit.Assert.assertEquals
import org.junit.Test

class RenovacionJornadaTest {

    @Test
    fun medianocheEsLaDeEcuador() {
        // 2026-10-01 04:30 UTC = 2026-09-30 23:30 en Ecuador.
        val tarde = 1790829000000L
        assertEquals(1790744400000L, DmujeresApi.inicioDelDia(tarde)) // 2026-09-30 00:00 -05
        // 2026-10-01 05:30 UTC = 2026-10-01 00:30 en Ecuador: ya es otro día.
        assertEquals(1790830800000L, DmujeresApi.inicioDelDia(tarde + 3_600_000L))
    }
}
