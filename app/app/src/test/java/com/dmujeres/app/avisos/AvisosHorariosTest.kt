package com.dmujeres.app.avisos

import com.dmujeres.app.avisos.AvisosHorarios.Novedad
import com.dmujeres.app.cronograma.TipoActividad
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AvisosHorariosTest {

    private val bien = AvisosHorarios.Estado(
        jornadaAbierta = true, hayRed = true, servidorFalla = false, pendientes = 0, gpsEncendido = true,
        permisoUbicacion = true, permisoTodoElTiempo = true, bateriaRestringida = false, ahorroDeBateria = false,
        tiposDeHoy = emptySet(),
    )

    @Test
    fun conTodoEnOrdenNoSeAvisaNada() {
        AvisosHorarios.FRANJAS.forEach { assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(it, bien)) }
    }

    @Test
    fun sinJornadaSeAvisaSoloALasOchoYALasTres() {
        val sin = bien.copy(jornadaAbierta = false, gpsEncendido = false)
        assertEquals(listOf(Novedad.SIN_JORNADA), AvisosHorarios.novedades(8 * 60, sin))
        assertEquals(listOf(Novedad.SIN_JORNADA), AvisosHorarios.novedades(15 * 60, sin))
        assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(14 * 60, sin))
        assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(17 * 60, sin))
    }

    @Test
    fun enJornadaSeAvisanLasNovedadesALasOchoLasDosYLasCinco() {
        val mal = bien.copy(gpsEncendido = false, bateriaRestringida = true, hayRed = false)
        val esperado = listOf(Novedad.GPS_APAGADO, Novedad.BATERIA_RESTRINGIDA, Novedad.SIN_CONEXION)
        listOf(8, 14, 17).forEach { assertEquals(esperado, AvisosHorarios.novedades(it * 60, mal)) }
        // A las tres solo se mira la jornada, y está abierta.
        assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(15 * 60, mal))
    }

    @Test
    fun conRedPeroColaLargaEsSenalDebilYSinRedEsSinConexion() {
        assertEquals(listOf(Novedad.SENAL_DEBIL), AvisosHorarios.novedades(8 * 60, bien.copy(pendientes = 30)))
        assertEquals(listOf(Novedad.SIN_CONEXION), AvisosHorarios.novedades(8 * 60, bien.copy(pendientes = 30, servidorFalla = true)))
        assertEquals(listOf(Novedad.SIN_TODO_EL_TIEMPO), AvisosHorarios.novedades(8 * 60, bien.copy(permisoTodoElTiempo = false)))
        assertEquals(listOf(Novedad.SIN_PERMISO), AvisosHorarios.novedades(8 * 60, bien.copy(permisoUbicacion = false, permisoTodoElTiempo = false)))
    }

    @Test
    fun vacacionesPermisoONovedadSilencianAlmuerzoYVisitaNo() {
        val sin = bien.copy(jornadaAbierta = false)
        listOf(TipoActividad.VACACIONES, TipoActividad.PERMISO_MEDICO, TipoActividad.PERMISO, TipoActividad.NOVEDAD).forEach {
            assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(8 * 60, sin.copy(tiposDeHoy = setOf(it))))
            assertEquals(emptyList<Novedad>(), AvisosHorarios.novedades(8 * 60, bien.copy(gpsEncendido = false, tiposDeHoy = setOf(it))))
        }
        val conVisita = setOf(TipoActividad.VISITA, TipoActividad.ALMUERZO)
        assertEquals(listOf(Novedad.SIN_JORNADA), AvisosHorarios.novedades(8 * 60, sin.copy(tiposDeHoy = conVisita)))
        assertEquals(listOf(Novedad.GPS_APAGADO), AvisosHorarios.novedades(14 * 60, bien.copy(gpsEncendido = false, tiposDeHoy = conVisita)))
    }

    @Test
    fun laHoraQueTocaYCuantoFaltaParaLaSiguiente() {
        assertEquals(8 * 60, AvisosHorarios.franjaVigente(8 * 60 + 20))
        assertNull(AvisosHorarios.franjaVigente(9 * 60))
        assertNull(AvisosHorarios.franjaVigente(7 * 60 + 59))
        assertEquals(15 * 60, AvisosHorarios.franjaVigente(15 * 60 + 5))
        assertEquals(1, AvisosHorarios.minutosHastaLaProxima(7 * 60 + 59))
        assertEquals(60, AvisosHorarios.minutosHastaLaProxima(14 * 60))
        // Después de las cinco, la próxima es mañana a las ocho.
        assertEquals(15 * 60, AvisosHorarios.minutosHastaLaProxima(17 * 60))
    }
}
