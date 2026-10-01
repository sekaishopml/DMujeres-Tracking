package com.dmujeres.app.cronograma

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import com.dmujeres.app.cronograma.AgendaDia.Cruce
import com.dmujeres.app.cronograma.AgendaDia.Tramo

class AgendaDiaTest {
    private fun m(hora: String) = HoraCronograma.aMinutos(hora)
    private fun t(desde: String, hasta: String) = Tramo(m(desde), m(hasta))
    private data class A(val nombre: String, val tramo: Tramo?)

    private fun ajustes(otras: List<A>, nuevo: Tramo) = AgendaDia.ajustes(otras, nuevo) { it.tramo }

    @Test
    fun laAnteriorTerminaCuandoEmpiezaEsta() {
        // 8:00–9:01 y luego 9:00–10:00: la primera queda 8:00–9:00.
        val r = ajustes(listOf(A("visita", t("08:00", "09:01"))), t("09:00", "10:00"))
        assertEquals(1, r.size)
        assertEquals(Cruce.RECORTAR_FIN, r[0].cruce)
        assertEquals(listOf(t("08:00", "09:00")), r[0].tramos)
        assertEquals(t("09:01", "10:00"), AgendaDia.alternativa(r, t("09:00", "10:00")))
    }

    @Test
    fun laSiguienteEmpiezaCuandoTerminaEsta() {
        val r = ajustes(listOf(A("almuerzo", t("12:30", "13:30"))), t("11:00", "13:00"))
        assertEquals(Cruce.CORRER_INICIO, r[0].cruce)
        assertEquals(listOf(t("13:00", "13:30")), r[0].tramos)
        assertEquals(t("11:00", "12:30"), AgendaDia.alternativa(r, t("11:00", "13:00")))
    }

    @Test
    fun dentroDeOtraLaParteEnDos() {
        val r = ajustes(listOf(A("visita", t("08:00", "17:00"))), t("12:00", "13:00"))
        assertEquals(Cruce.DIVIDIR, r[0].cruce)
        assertEquals(listOf(t("08:00", "12:00"), t("13:00", "17:00")), r[0].tramos)
        assertNull(AgendaDia.alternativa(r, t("12:00", "13:00")))
    }

    @Test
    fun taparOtraNoSeResuelveSola() {
        val r = ajustes(listOf(A("visita", t("09:00", "10:00"))), t("08:00", "17:00"))
        assertEquals(Cruce.CUBIERTA, r[0].cruce)
        assertEquals(emptyList<Tramo>(), r[0].tramos)
    }

    @Test
    fun contiguasYSinFinNoSeCruzan() {
        val otras = listOf(A("antes", t("08:00", "09:00")), A("despues", t("10:00", "11:00")), A("vieja", null))
        assertEquals(emptyList<Any>(), ajustes(otras, t("09:00", "10:00")))
    }

    @Test
    fun huecosDesdeElInicioDeJornadaHastaAhora() {
        // Jornada desde las 8:00, son las 13:00 y solo hay 9:00–10:00.
        val h = AgendaDia.huecos(listOf(t("09:00", "10:00")), m("08:00"), m("13:00"))
        assertEquals(listOf(t("08:00", "09:00"), t("10:00", "13:00")), h)
        // Menos de 15 min no cuenta; otro día no hay "ahora".
        assertEquals(emptyList<Tramo>(), AgendaDia.huecos(listOf(t("09:00", "10:00"), t("10:10", "11:00")), null, null))
        // Lo planificado para más tarde no corta el hueco de "hasta ahora".
        assertEquals(listOf(t("08:00", "13:00")), AgendaDia.huecos(listOf(t("15:00", "16:00")), m("08:00"), m("13:00")))
    }

    @Test
    fun sinHoraDeFinDuraHastaLaSiguiente() {
        data class X(val h: String, val f: String?)
        val tramos = AgendaDia.tramosDelDia(listOf(X("09:00", null), X("11:00", "12:00"), X("14:00", null)), { it.h }, { it.f })
        assertEquals(listOf(t("09:00", "11:00"), t("11:00", "12:00"), Tramo(m("14:00"), AgendaDia.FIN_DEL_DIA)), tramos)
        assertEquals(60 + 30, AgendaDia.cubiertos(listOf(t("09:00", "10:00"), t("09:30", "10:30"))))
    }
}
