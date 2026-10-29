package com.dmujeres.app.reporte

import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Excel (.xlsx) de una hoja, escrito a mano: un .xlsx es un zip con unos
 * pocos XML. Sin librerías (sumaban megas a la app). Textos en línea, una
 * sola letra sencilla, colores de fondo, bordes, celdas combinadas y anchos
 * de columna.
 */
object Xlsx {

    /** Cómo se ve una celda: una sola letra (Calibri 11), negrita o no, color de fondo y borde. */
    data class Estilo(
        val negrita: Boolean = false,
        val relleno: String? = null,
        val borde: Boolean = true,
        val centrado: Boolean = false,
    )

    data class Celda(val texto: String, val estilo: Estilo = Estilo())

    /**
     * [filaEncabezado] (desde 1): queda congelada y con filtro hasta la última fila.
     * [combinadas]: rangos como "A1:H1".
     */
    fun escribir(
        out: OutputStream,
        hoja: String,
        filas: List<List<Celda>>,
        anchos: List<Double>,
        combinadas: List<String> = emptyList(),
        filaEncabezado: Int? = null,
    ) {
        ZipOutputStream(out).use { zip ->
            fun parte(nombre: String, xml: String) {
                zip.putNextEntry(ZipEntry(nombre))
                zip.write(xml.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
            parte("[Content_Types].xml", CONTENT_TYPES)
            parte("_rels/.rels", RELS)
            parte("xl/workbook.xml", workbook(hoja))
            parte("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
            val estilos = listOf(Estilo(borde = false)) + filas.flatten().map { it.estilo }.distinct().filter { it != Estilo(borde = false) }
            parte("xl/styles.xml", estilosXml(estilos))
            parte("xl/worksheets/sheet1.xml", hojaXml(filas, anchos, combinadas, filaEncabezado, estilos))
        }
    }

    /** "A", "B", … "Z", "AA". */
    fun columna(i: Int): String = if (i < 26) ('A' + i).toString() else columna(i / 26 - 1) + ('A' + i % 26)

    fun escapar(s: String): String = buildString {
        for (ch in s) when {
            ch == '&' -> append("&amp;")
            ch == '<' -> append("&lt;")
            ch == '>' -> append("&gt;")
            ch == '"' -> append("&quot;")
            // XML no admite caracteres de control (salvo tab y salto de línea).
            ch < ' ' && ch != '\t' && ch != '\n' -> Unit
            else -> append(ch)
        }
    }

    private fun hojaXml(filas: List<List<Celda>>, anchos: List<Double>, combinadas: List<String>, encabezado: Int?, estilos: List<Estilo>): String = buildString {
        append(XML_DECL)
        append("<worksheet xmlns=\"$NS_MAIN\" xmlns:r=\"$NS_REL\">")
        if (encabezado != null) {
            append("<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"$encabezado\" topLeftCell=\"A${encabezado + 1}\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>")
        }
        append("<cols>")
        anchos.forEachIndexed { i, w -> append("<col min=\"${i + 1}\" max=\"${i + 1}\" width=\"$w\" customWidth=\"1\"/>") }
        append("</cols><sheetData>")
        filas.forEachIndexed { r, fila ->
            append("<row r=\"${r + 1}\">")
            fila.forEachIndexed { c, celda ->
                val ref = "${columna(c)}${r + 1}"
                val s = estilos.indexOf(celda.estilo)
                if (celda.texto.isEmpty()) {
                    append("<c r=\"$ref\" s=\"$s\"/>")
                } else {
                    append("<c r=\"$ref\" t=\"inlineStr\" s=\"$s\"><is><t xml:space=\"preserve\">${escapar(celda.texto)}</t></is></c>")
                }
            }
            append("</row>")
        }
        append("</sheetData>")
        if (encabezado != null && filas.size > encabezado) {
            append("<autoFilter ref=\"A$encabezado:${columna(anchos.size - 1)}${filas.size}\"/>")
        }
        if (combinadas.isNotEmpty()) {
            append("<mergeCells count=\"${combinadas.size}\">")
            combinadas.forEach { append("<mergeCell ref=\"$it\"/>") }
            append("</mergeCells>")
        }
        append("<pageMargins left=\"0.5\" right=\"0.5\" top=\"0.6\" bottom=\"0.6\" header=\"0.3\" footer=\"0.3\"/>")
        append("<pageSetup orientation=\"landscape\"/>")
        append("</worksheet>")
    }

    private fun workbook(hoja: String) = XML_DECL +
        "<workbook xmlns=\"$NS_MAIN\" xmlns:r=\"$NS_REL\"><sheets>" +
        "<sheet name=\"${escapar(hoja.take(31).replace(Regex("[\\\\/?*\\[\\]:]"), " "))}\" sheetId=\"1\" r:id=\"rId1\"/>" +
        "</sheets></workbook>"

    private const val XML_DECL = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
    private const val NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    private const val NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

    private const val CONTENT_TYPES = XML_DECL +
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
        "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
        "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
        "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
        "</Types>"

    private const val RELS = XML_DECL +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
        "</Relationships>"

    private const val WORKBOOK_RELS = XML_DECL +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
        "</Relationships>"

    /** Una sola fuente (Calibri 11, normal o negrita), los rellenos que se usen y un borde fino gris. */
    private fun estilosXml(estilos: List<Estilo>): String {
        val colores = estilos.mapNotNull { it.relleno }.distinct()
        return buildString {
            append(XML_DECL)
            append("<styleSheet xmlns=\"$NS_MAIN\">")
            append("<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>")
            append("<fills count=\"${colores.size + 2}\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>")
            colores.forEach { append("<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF$it\"/><bgColor indexed=\"64\"/></patternFill></fill>") }
            append("</fills>")
            append("<borders count=\"2\"><border><left/><right/><top/><bottom/><diagonal/></border>")
            append("<border>")
            for (lado in listOf("left", "right", "top", "bottom")) append("<$lado style=\"thin\"><color rgb=\"FFBFC7D3\"/></$lado>")
            append("<diagonal/></border></borders>")
            append("<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>")
            append("<cellXfs count=\"${estilos.size}\">")
            for (e in estilos) {
                val relleno = e.relleno?.let { colores.indexOf(it) + 2 } ?: 0
                append("<xf numFmtId=\"0\" fontId=\"${if (e.negrita) 1 else 0}\" fillId=\"$relleno\" borderId=\"${if (e.borde) 1 else 0}\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\">")
                append("<alignment vertical=\"top\" wrapText=\"1\"${if (e.centrado) " horizontal=\"center\"" else ""}/></xf>")
            }
            append("</cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>")
        }
    }
}
