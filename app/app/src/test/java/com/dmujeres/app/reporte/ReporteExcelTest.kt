package com.dmujeres.app.reporte

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipInputStream

class ReporteExcelTest {

    @Test
    fun elXlsxTraeSusPartesYLosTextosEscapados() {
        val r = DatosReporte.armar(
            Periodo.DIA, "2026-10-28", "Santi",
            { listOf(FilaActividad("09:00", "10:00", "Visita", "Tía & Cía <Sur>", "nota")) },
            mapOf("2026-10-28" to listOf(JornadaDia("08:00", "15:30", false, "Cita médica"))),
        )
        val bytes = ReporteExcel.bytes(r, "28/10/2026 22:00")
        val partes = mutableMapOf<String, String>()
        ZipInputStream(bytes.inputStream()).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                partes[e.name] = zip.readBytes().toString(Charsets.UTF_8)
            }
        }
        assertEquals(
            setOf("[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"),
            partes.keys,
        )
        val hoja = partes.getValue("xl/worksheets/sheet1.xml")
        assertTrue(hoja.contains("Tía &amp; Cía &lt;Sur&gt;"))
        assertTrue(hoja.contains("08:00 a 15:30 (motivo de cierre: Cita médica)"))
        assertTrue(hoja.contains("<autoFilter ref=\"A4:H5\"/>"))
        // Para abrirlo a mano si hace falta revisar el formato.
        File("build/capturas").mkdirs()
        File("build/capturas/reporte-prueba.xlsx").writeBytes(bytes)
    }

    @Test
    fun columnas() {
        assertEquals("A", Xlsx.columna(0))
        assertEquals("H", Xlsx.columna(7))
        assertEquals("AA", Xlsx.columna(26))
    }
}
