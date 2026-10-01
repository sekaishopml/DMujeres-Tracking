package com.dmujeres.app.cronograma

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HoraInterpretarTest {
    private fun leer(texto: String, pm: Boolean) = HoraCronograma.interpretar(texto, pm)

    @Test
    fun formato24DetectaPmSolo() {
        assertEquals(HoraCronograma.Lectura("14:30", true), leer("14:30", false))
        assertEquals(HoraCronograma.Lectura("23:05", true), leer("2305", false))
        assertEquals(HoraCronograma.Lectura("00:15", false), leer("0:15", true))
    }

    @Test
    fun formato12UsaElAmPmElegido() {
        assertEquals(HoraCronograma.Lectura("09:30", false), leer("9:30", false))
        assertEquals(HoraCronograma.Lectura("21:30", true), leer("930", true))
        assertEquals(HoraCronograma.Lectura("12:00", true), leer("12", true))
        assertEquals(HoraCronograma.Lectura("00:00", false), leer("12", false))
        assertEquals(HoraCronograma.Lectura("08:05", false), leer("8.05", false))
    }

    @Test
    fun rechazaLoQueNoEsHora() {
        assertNull(leer("25:00", false))
        assertNull(leer("9:75", false))
        assertNull(leer("abc", false))
        assertNull(leer("12345", false))
    }

    @Test
    fun muestraEn24Horas() {
        assertEquals("14:30", HoraCronograma.legible("14:30"))
        assertEquals("09:05", HoraCronograma.legible("9:5"))
        assertEquals("09:00 – 11:30", HoraCronograma.rango("09:00", "11:30"))
    }

    private data class A(val hora: String, val fin: String?)
    private val dia = listOf(A("09:00", "11:30"), A("12:30", null), A("15:00", "16:00"))
    private fun curso(t: String) = HoraCronograma.enCurso(dia, t, { it.hora }, { it.fin })

    @Test
    fun actividadEnCursoYSiguiente() {
        assertEquals(dia[0], curso("10:15"))
        assertNull(curso("11:45"))
        assertEquals(dia[1], HoraCronograma.siguiente(dia, "11:45") { it.hora })
        assertEquals(dia[1], curso("13:00"))
        assertEquals(dia[2], curso("15:30"))
        assertNull(curso("16:10"))
        assertNull(HoraCronograma.siguiente(dia, "16:10") { it.hora })
    }
}

class HoraNaturalTest {
    private fun leer(texto: String, pm: Boolean? = null, despuesDe: String? = null) =
        HoraCronograma.interpretarNatural(texto, pm, despuesDe?.let { HoraCronograma.aMinutos(it) })?.hora24

    @Test
    fun deduceElAmPmDeUnaJornada() {
        assertEquals("08:00", leer("8"))
        assertEquals("11:30", leer("1130"))
        assertEquals("12:00", leer("12"))
        assertEquals("15:00", leer("3"))
        assertEquals("17:45", leer("5:45"))
        assertEquals("14:30", leer("14:30"))
    }

    @Test
    fun hastaQuedaDespuesDelInicio() {
        assertEquals("14:00", leer("2", despuesDe = "11:00"))
        assertEquals("09:00", leer("9", despuesDe = "08:00"))
        assertEquals("12:00", leer("12", despuesDe = "08:00"))
        assertEquals("21:00", leer("9", despuesDe = "20:00"))
    }

    @Test
    fun horaCompletaSeTomaTalCual() {
        assertEquals("03:00", leer("03:00"))
        assertEquals("02:30", leer("0230"))
        assertEquals("10:00", leer("10:00", despuesDe = "11:00"))
        assertEquals("13:30", leer("1:30", despuesDe = "11:00"))
        assertEquals("15:00", leer("3"))
    }

    @Test
    fun loTocadoAManoManda() {
        assertEquals("19:00", leer("7", pm = true))
        assertEquals("03:00", leer("3", pm = false))
        assertEquals("02:00", leer("2", pm = false, despuesDe = "11:00"))
    }
}
