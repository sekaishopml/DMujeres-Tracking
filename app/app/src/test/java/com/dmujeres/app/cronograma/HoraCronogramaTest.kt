package com.dmujeres.app.cronograma

import org.junit.Assert.assertEquals
import org.junit.Test

class HoraCronogramaTest {
    @Test
    fun suma_sin_pasar_de_medianoche() {
        assertEquals("17:30", HoraCronograma.sumar("17:00", 30))
        assertEquals("23:59", HoraCronograma.sumar("23:50", 60))
        assertEquals("00:00", HoraCronograma.sumar("00:10", -15))
    }

    @Test
    fun duracionYRangoCorto() {
        assertEquals("45 min", HoraCronograma.duracion(45))
        assertEquals("1 h", HoraCronograma.duracion(60))
        assertEquals("2 h 30 min", HoraCronograma.duracion(150))
        assertEquals("08:00 – 09:30", HoraCronograma.rangoCorto("08:00", "09:30"))
        assertEquals("11:00 – 13:00", HoraCronograma.rangoCorto("11:00", "13:00"))
        assertEquals("14:30", HoraCronograma.rangoCorto("14:30", null))
    }
}
