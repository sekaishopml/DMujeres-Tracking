package com.dmujeres.app.jornada

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReglasJornadaTest {

    @Test
    fun deSieteACincoPideNota() {
        assertFalse(ReglasJornada.pideNota(6 * 60 + 59))
        assertTrue(ReglasJornada.pideNota(7 * 60))
        assertTrue(ReglasJornada.pideNota(16 * 60 + 59))
        assertFalse(ReglasJornada.pideNota(17 * 60))
        assertFalse(ReglasJornada.notaValida("  ok  "))
        assertTrue(ReglasJornada.notaValida("Cita médica"))
    }

    @Test
    fun iniciarTardePideNota() {
        val nueve = 9 * 60
        assertFalse(ReglasJornada.pideNotaInicio(8 * 60 + 59, nueve, true))
        assertTrue(ReglasJornada.pideNotaInicio(10 * 60, nueve, true))
        assertFalse(ReglasJornada.pideNotaInicio(17 * 60, nueve, true))
        assertFalse(ReglasJornada.pideNotaInicio(10 * 60, nueve, false))
        assertFalse(ReglasJornada.pideNotaInicio(10 * 60, 0, true))
    }

    @Test
    fun seIniciaUnaHoraAntesDeLaPrimera() {
        val horas = listOf(10 * 60, 9 * 60, 14 * 60)
        assertEquals(8 * 60, ReglasJornada.minutoDeInicio(horas))
        assertEquals(0, ReglasJornada.minutoDeInicio(listOf(30)))
        assertNull(ReglasJornada.minutoDeInicio(emptyList()))
        assertFalse(ReglasJornada.tocaIniciar(horas, 7 * 60 + 59))
        assertTrue(ReglasJornada.tocaIniciar(horas, 8 * 60))
        // Si el teléfono estaba apagado a esa hora, se inicia al prenderlo.
        assertTrue(ReglasJornada.tocaIniciar(horas, 10 * 60 + 30))
        assertFalse(ReglasJornada.tocaIniciar(horas, 11 * 60))
        assertFalse(ReglasJornada.tocaIniciar(emptyList(), 9 * 60))
    }
}
