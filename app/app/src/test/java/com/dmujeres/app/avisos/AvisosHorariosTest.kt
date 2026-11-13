package com.dmujeres.app.avisos

import com.dmujeres.app.avisos.AvisosHorarios.Novedad
import com.dmujeres.app.cronograma.TipoActividad
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class AvisosHorariosTest {

    private val bien = AvisosHorarios.Estado(
        jornadaAbierta = true, gpsEncendido = true, permisoUbicacion = true, permisoTodoElTiempo = true,
        bateriaRestringida = false, hayActualizacion = false, tiposDeHoy = emptySet(),
    )
    private val sieteYMedia = 7 * 60 + 30

    @Test
    fun conTodoEnOrdenNoSeAvisaNada() {
        AvisosHorarios.FRANJAS.forEach { assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(it, bien)) }
    }

    @Test
    fun sinJornadaSeRecuerdaALasSieteYMediaOchoYCuartoYALasTres() {
        val sin = bien.copy(jornadaAbierta = false)
        assertEquals(listOf(Novedad.SIN_JORNADA), AvisosHorarios.novedades(sieteYMedia, sin))
        assertEquals(listOf(Novedad.SIN_JORNADA), AvisosHorarios.novedades(8 * 60 + 15, sin))
        assertEquals(listOf(Novedad.SIN_JORNADA), AvisosHorarios.novedades(15 * 60, sin))
        assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(12 * 60, sin))
    }

    @Test
    fun unPermisoQuitadoYLaActualizacionSeAvisanALasTresHoras() {
        listOf(
            bien.copy(gpsEncendido = false), bien.copy(permisoUbicacion = false),
            bien.copy(permisoTodoElTiempo = false), bien.copy(bateriaRestringida = true),
        ).forEach { e ->
            listOf(sieteYMedia, 12 * 60, 15 * 60).forEach { assertEquals(listOf(Novedad.PERMISO_QUITADO), AvisosHorarios.novedades(it, e)) }
        }
        // A las 08:15 solo se recuerda la jornada.
        assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(8 * 60 + 15, bien.copy(gpsEncendido = false, hayActualizacion = true)))
        val todo = bien.copy(jornadaAbierta = false, gpsEncendido = false, hayActualizacion = true)
        assertEquals(
            listOf(Novedad.SIN_JORNADA, Novedad.PERMISO_QUITADO, Novedad.ACTUALIZAR),
            AvisosHorarios.novedades(sieteYMedia, todo),
        )
        assertEquals(listOf(Novedad.PERMISO_QUITADO, Novedad.ACTUALIZAR), AvisosHorarios.novedades(12 * 60, todo))
    }

    @Test
    fun vacacionesPermisoONovedadSilencianAlmuerzoYVisitaNo() {
        val mal = bien.copy(jornadaAbierta = false, gpsEncendido = false, hayActualizacion = true)
        listOf(TipoActividad.VACACIONES, TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO, TipoActividad.NOVEDAD).forEach {
            assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(sieteYMedia, mal.copy(tiposDeHoy = setOf(it))))
        }
        val conVisita = setOf(TipoActividad.VISITA, TipoActividad.ALMUERZO)
        assertEquals(listOf(Novedad.SIN_JORNADA), AvisosHorarios.novedades(sieteYMedia, bien.copy(jornadaAbierta = false, tiposDeHoy = conVisita)))
    }

    @Test
    fun deLunesASabado() {
        assertTrue(AvisosHorarios.diaHabil(Calendar.MONDAY))
        assertTrue(AvisosHorarios.diaHabil(Calendar.FRIDAY))
        assertTrue(AvisosHorarios.diaHabil(Calendar.SATURDAY))
        assertFalse(AvisosHorarios.diaHabil(Calendar.SUNDAY))
    }

    @Test
    fun laHoraQueTocaYCuantoFaltaParaLaSiguiente() {
        assertEquals(sieteYMedia, AvisosHorarios.franjaVigente(7 * 60 + 50))
        assertNull(AvisosHorarios.franjaVigente(9 * 60 + 10))
        assertEquals(15 * 60, AvisosHorarios.franjaVigente(15 * 60 + 5))
        // Lunes 07:00: la próxima es a las 07:30; a las 08:00, las 08:15.
        assertEquals(30, AvisosHorarios.minutosHastaLaProxima(7 * 60, Calendar.MONDAY))
        assertEquals(15, AvisosHorarios.minutosHastaLaProxima(8 * 60, Calendar.MONDAY))
        assertEquals(8 * 60 + 15, AvisosHorarios.franjaVigente(8 * 60 + 20))
        // Martes 12:30: a las 15:00.
        assertEquals(150, AvisosHorarios.minutosHastaLaProxima(12 * 60 + 30, Calendar.TUESDAY))
        // Martes 17:00: miércoles a las 07:30 (nada en la tarde ni de noche).
        assertEquals(24 * 60 - 17 * 60 + sieteYMedia, AvisosHorarios.minutosHastaLaProxima(17 * 60, Calendar.TUESDAY))
        // Viernes 16:00: el sábado a las 07:30.
        assertEquals(24 * 60 - 16 * 60 + sieteYMedia, AvisosHorarios.minutosHastaLaProxima(16 * 60, Calendar.FRIDAY))
        // Sábado 10:00: a las 12:00; sábado 17:00: el lunes a las 07:30.
        assertEquals(120, AvisosHorarios.minutosHastaLaProxima(10 * 60, Calendar.SATURDAY))
        assertEquals(2 * 24 * 60 - 17 * 60 + sieteYMedia, AvisosHorarios.minutosHastaLaProxima(17 * 60, Calendar.SATURDAY))
    }
}
