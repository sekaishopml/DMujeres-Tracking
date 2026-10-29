package com.dmujeres.app.reporte

import org.junit.Assert.assertEquals
import org.junit.Test

class DatosReporteTest {

    @Test
    fun rangosDeDiaSemanaYMes() {
        // 28/10/2026 es miércoles.
        assertEquals("2026-10-28" to "2026-10-28", DatosReporte.rango(Periodo.DIA, "2026-10-28"))
        assertEquals("2026-10-26" to "2026-11-01", DatosReporte.rango(Periodo.SEMANA, "2026-10-28"))
        assertEquals("2026-10-26" to "2026-11-01", DatosReporte.rango(Periodo.SEMANA, "2026-11-01"))
        assertEquals("2026-10-01" to "2026-10-31", DatosReporte.rango(Periodo.MES, "2026-10-28"))
        assertEquals("2026-02-01" to "2026-02-28", DatosReporte.rango(Periodo.MES, "2026-02-15"))
    }

    @Test
    fun moverYEtiquetas() {
        assertEquals("2026-11-04", DatosReporte.mover(Periodo.SEMANA, "2026-10-28", 1))
        assertEquals("2026-09-01", DatosReporte.mover(Periodo.MES, "2026-10-31", -1))
        assertEquals("Miércoles 28/10", DatosReporte.etiquetaDia("2026-10-28"))
        assertEquals(7, DatosReporte.dias("2026-10-26", "2026-11-01").size)
    }

    @Test
    fun jornadaSinDatoNoSeInventa() {
        assertEquals("—", DatosReporte.textoJornada(null))
        assertEquals("Sin jornada", DatosReporte.textoJornada(emptyList()))
        assertEquals("08:01 a 17:05", DatosReporte.textoJornada(listOf(JornadaDia("08:01", "17:05", false, null))))
        assertEquals("08:01 · en curso", DatosReporte.textoJornada(listOf(JornadaDia("08:01", null, true, null))))
    }

    @Test
    fun armaUnaFilaPorDiaYOrdenaLasActividades() {
        val r = DatosReporte.armar(
            Periodo.SEMANA, "2026-10-28", "Santi",
            { f -> if (f == "2026-10-28") listOf(FilaActividad("14:00", null, "Visita", "B", null), FilaActividad("09:00", "10:00", "Visita", "A", null)) else emptyList() },
            mapOf("2026-10-28" to listOf(JornadaDia("08:00", "17:00", false, null))),
        )
        assertEquals(7, r.dias.size)
        assertEquals(listOf("09:00", "14:00"), r.dias[2].actividades.map { it.hora })
        assertEquals(emptyList<JornadaDia>(), r.dias[0].jornadas)
        assertEquals("Del 26/10/2026 al 01/11/2026", r.rango)
        assertEquals("Reporte semanal Santi 2026-10-26", r.nombreArchivo)
    }

    @Test
    fun esperaDeCincoMinutosEntreDescargas() {
        val t = 1_800_000_000_000L
        assertEquals(0, DatosReporte.minutosParaDescargar(0L, t))
        assertEquals(5, DatosReporte.minutosParaDescargar(t, t + 1_000L))
        assertEquals(1, DatosReporte.minutosParaDescargar(t, t + 4 * 60_000L + 1_000L))
        assertEquals(0, DatosReporte.minutosParaDescargar(t, t + 5 * 60_000L))
        // Reloj del teléfono atrasado: no se bloquea.
        assertEquals(0, DatosReporte.minutosParaDescargar(t, t - 60_000L))
    }
}
