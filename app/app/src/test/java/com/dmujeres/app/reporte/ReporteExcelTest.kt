package com.dmujeres.app.reporte

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipInputStream

class ReporteExcelTest {

    private fun semana() = DatosReporte.armar(
        Periodo.SEMANA, "2026-10-28", "Santi",
        { f ->
            if (f == "2026-10-28") listOf(
                FilaActividad("09:00", "10:00", "Visita", "Tía & Cía <Sur>", null),
                FilaActividad("13:00", "14:00", "Almuerzo", null, null),
            ) else emptyList()
        },
        mapOf("2026-10-28" to listOf(JornadaDia("08:00", "15:30", false, "Cita médica"))),
    )

    private fun partes(bytes: ByteArray): Map<String, String> {
        val partes = mutableMapOf<String, String>()
        ZipInputStream(bytes.inputStream()).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                partes[e.name] = zip.readBytes().toString(Charsets.UTF_8)
            }
        }
        return partes
    }

    @Test
    fun planillaSemanalConUnaColumnaPorDia() {
        val bytes = ReporteExcel.bytes(semana(), "28/10/2026 22:00")
        val p = partes(bytes)
        assertEquals(
            setOf("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"),
            p.keys,
        )
        val hoja = p.getValue("xl/worksheets/sheet1.xml")
        assertTrue(hoja.contains("Miércoles 28/10"))
        assertTrue(hoja.contains("Tía &amp; Cía &lt;Sur&gt;"))
        assertTrue(hoja.contains("Fin de jornada: Cita médica"))
        // Lunes a domingo: 14 columnas, cada día combinado en dos.
        assertTrue(hoja.contains("<mergeCell ref=\"M3:N3\"/>"))
        // Una sola letra: Calibri 11, normal o negrita, nada más.
        val estilos = p.getValue("xl/styles.xml")
        assertEquals(2, Regex("<font>").findAll(estilos).count())
        File("build/capturas").mkdirs()
        File("build/capturas/reporte-prueba.xlsx").writeBytes(bytes)
    }

    @Test
    fun elFinDeJornadaQuedaEnLaUltimaFila() {
        val b = PlanillaReporte.bloques(semana()).single()
        val miercoles = b.columnas[2]
        assertEquals(4, b.filas)
        assertEquals("Inicio de jornada", miercoles.filas.first().plan)
        assertEquals("Tía & Cía <Sur>", miercoles.filas[1].plan)
        assertEquals("Almuerzo", miercoles.filas[2].plan)
        assertEquals("15:30", miercoles.filas.last().hora)
        assertEquals("Sin jornada", b.columnas[0].filas.first().plan)
    }

    @Test
    fun columnasYTintes() {
        assertEquals("A", Xlsx.columna(0))
        assertEquals("AA", Xlsx.columna(26))
        assertEquals("FFFFFF", PlanillaReporte.tinte("F4B183", 0))
        assertEquals("F4B183", PlanillaReporte.tinte("F4B183", 100))
    }
}
