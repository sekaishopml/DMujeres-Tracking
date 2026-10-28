package com.dmujeres.app.cronograma

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
    fun laActividadEnCursoSeAcomodaYNoSeCierraSola() {
        // En curso desde las 9:00; son las 11:30.
        val enCurso = listOf(A("visita", AgendaDia.tramoEnCurso(m("09:00"), m("11:30"))))
        // Una ya pasada, dentro de ella, la parte en dos: la segunda parte sigue en curso.
        val dentro = ajustes(enCurso, t("10:00", "10:30"))
        assertEquals(Cruce.DIVIDIR, dentro[0].cruce)
        assertEquals(m("10:00"), dentro[0].tramos[0].fin)
        assertEquals(m("10:30"), dentro[0].tramos[1].inicio)
        // Una anterior que la pisa le corre el inicio; sigue en curso.
        val antes = ajustes(enCurso, t("08:00", "09:30"))
        assertEquals(Cruce.CORRER_INICIO, antes[0].cruce)
        assertEquals(m("09:30"), antes[0].tramos[0].inicio)
        // Una que empieza ahora la termina a esa hora, a la vista.
        val ahora = ajustes(enCurso, t("11:30", "12:30"))
        assertEquals(Cruce.RECORTAR_FIN, ahora[0].cruce)
        assertEquals(m("11:30"), ahora[0].tramos[0].fin)
        // Las programadas para más tarde no la tocan.
        assertEquals(emptyList<Any>(), ajustes(enCurso, t("11:31", "12:00")))
        assertEquals(emptyList<Any>(), ajustes(enCurso, t("14:00", "15:00")))
    }

    @Test
    fun elHorarioSugeridoEsElPrimerRatoLibre() {
        val ocupados = listOf(t("09:00", "10:00"), t("10:00", "11:15"), t("13:00", "14:00"))
        // Libre de entrada: se propone tal cual.
        assertEquals(m("08:00"), AgendaDia.proximoLibre(ocupados, m("08:00"), 60))
        // Si choca, empieza cuando termina la que estorba (aunque sean dos seguidas).
        assertEquals(m("11:15"), AgendaDia.proximoLibre(ocupados, m("09:30"), 60))
        // No cabe antes de la siguiente: salta después de ella.
        assertEquals(m("14:00"), AgendaDia.proximoLibre(ocupados, m("11:30"), 120))
        // Ya no cabe en el día.
        assertNull(AgendaDia.proximoLibre(listOf(t("20:00", "23:59")), m("19:30"), 60))
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

    @Test
    fun arrastrarEnLaReglaVaPorCuartosDeHoraYNoPisaOtraActividad() {
        assertEquals(600, AgendaDia.alCuarto(607))
        assertEquals(615, AgendaDia.alCuarto(608))
        assertEquals(AgendaDia.FIN_DEL_DIA, AgendaDia.alCuarto(AgendaDia.FIN_DEL_DIA + 40))
        val ocupados = listOf(AgendaDia.Tramo(600, 660))
        assertTrue(AgendaDia.seCruza(ocupados, 645, 700))
        // Tocarse en el borde no es cruzarse.
        assertFalse(AgendaDia.seCruza(ocupados, 660, 720))
    }

    @Test
    fun elDiaSeCorrigeHastaLasOnceYCuartoDelDiaSiguiente() {
        val ayer = "2026-10-10"
        // Hoy y los días que vienen siempre se pueden cambiar.
        assertFalse(AgendaDia.diaCerrado("2026-10-11", ayer, 23 * 60))
        assertFalse(AgendaDia.diaCerrado("2026-10-12", ayer, 0))
        // Ayer: hasta las 11:14 sí; desde las 11:15 ya no.
        assertFalse(AgendaDia.diaCerrado(ayer, ayer, 11 * 60 + 14))
        assertTrue(AgendaDia.diaCerrado(ayer, ayer, 11 * 60 + 15))
        // Anteayer y antes, cerrado a cualquier hora.
        assertTrue(AgendaDia.diaCerrado("2026-10-09", ayer, 8 * 60))
    }
}
